#!/usr/bin/env bash
# COB-06: duas conexoes contra o gate de tentativa unica CI-only.
# Roda exclusivamente no PostgreSQL local DESCARTAVEL. Nenhum POST Asaas.
set -euo pipefail

test "${PGHOST:-}" = "localhost"
test "${PGDATABASE:-}" = "catalogo_ci"
test -z "${DATABASE_URL:-}"
test -z "${PGSERVICE:-}"
test -z "${PGHOSTADDR:-}"
test "$(psql -X -d catalogo_cob06_ci -Atqc 'SELECT current_database()')" = "catalogo_cob06_ci"
test "$(psql -X -d catalogo_cob06_ci -Atqc 'SELECT inet_server_port()')" = "5432"

primeiro_log="$(mktemp -t cob06-gate-first.XXXXXXXX)"
segundo_log="$(mktemp -t cob06-gate-second.XXXXXXXX)"
primeiro_pid=""
segundo_pid=""
cleanup() {
  if [[ -n "$primeiro_pid" ]]; then
    kill "$primeiro_pid" 2>/dev/null || true
    wait "$primeiro_pid" 2>/dev/null || true
  fi
  if [[ -n "$segundo_pid" ]]; then
    kill "$segundo_pid" 2>/dev/null || true
    wait "$segundo_pid" 2>/dev/null || true
  fi
  rm -f "$primeiro_log" "$segundo_log"
}
trap cleanup EXIT

psql -X -d catalogo_cob06_ci -v ON_ERROR_STOP=1 \
  -f supabase/tests/isolated/asaas-cob06-gate-concorrencia-fixture-ci.sql

lote="$(psql -X -d catalogo_cob06_ci -Atqc \
  "SELECT id FROM public.catalogo_asaas_acumulo_lotes
   WHERE comercio_id='comercio-de-exemplo' AND competencia_corte='2040-04-01'")"
[[ "$lote" =~ ^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$ ]]

# A registra a primeira autorizacao POSITIVA MOCKADA em CI e mantem o lock.
timeout 14s psql -X -d catalogo_cob06_ci -v ON_ERROR_STOP=1 -Atq \
  -c "BEGIN;
      SELECT (x->>'ok')||'|'||(x->>'nova_tentativa')||'|'||(x->>'pode_emitir_pix')
      FROM (SELECT catalogo_private.catalogo_asaas_autorizar_post_mock_ci('$lote','guia-acumulo-$lote','cus_cob06_gate_race_123',500,0,true) x) t;
      SELECT pg_catalog.pg_sleep(4);
      COMMIT;" > "$primeiro_log" 2>&1 &
primeiro_pid=$!

# A deve adquirir o lock da loja antes de B iniciar: concorrencia real.
lock_adquirido="false"
for tentativa in $(seq 1 80); do
  if [[ "$(psql -X -d catalogo_cob06_ci -Atqc \
    "SELECT NOT pg_catalog.pg_try_advisory_lock(
      pg_catalog.hashtextextended('catalogo-fatura:comercio-de-exemplo',0))")" = "t" ]]; then
    lock_adquirido="true"
    break
  fi
  sleep 0.05
done
if [[ "$lock_adquirido" != "true" ]]; then
  echo "COB06_GATE_RACE: primeira conexao nao obteve lock" >&2
  exit 1
fi

# B disputa a mesma autorizacao CI, espera o COMMIT e recebe so replay.
timeout 14s psql -X -d catalogo_cob06_ci -v ON_ERROR_STOP=1 -Atq \
  -c "SELECT (x->>'ok')||'|'||(x->>'nova_tentativa')||'|'||(x->>'pode_emitir_pix')
      FROM (SELECT catalogo_private.catalogo_asaas_autorizar_post_mock_ci('$lote','guia-acumulo-$lote','cus_cob06_gate_race_123',500,0,true) x) t" \
  > "$segundo_log" 2>&1 &
segundo_pid=$!

# Confirma que B ficou de fato bloqueada por outra transacao SQL.
esperou_lock="false"
for tentativa in $(seq 1 60); do
  if [[ "$(psql -X -d catalogo_cob06_ci -Atqc \
    "SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_activity
      WHERE datname='catalogo_cob06_ci' AND wait_event_type='Lock'
      AND query LIKE '%catalogo_asaas_autorizar_post_mock_ci%')")" = "t" ]]; then
    esperou_lock="true"
    break
  fi
  sleep 0.05
done
if [[ "$esperou_lock" != "true" ]]; then
  echo "COB06_GATE_RACE: concorrente nao aguardou lock" >&2
  exit 1
fi

wait "$primeiro_pid"
primeiro_pid=""
wait "$segundo_pid"
segundo_pid=""
grep -Fx 'true|true|true' "$primeiro_log"
grep -Fx 'false|false|false' "$segundo_log"

test "$(psql -X -d catalogo_cob06_ci -Atqc \
  "SELECT count(*)||'|'||bool_and(pode_repetir_post=false)||'|'||
          bool_and(post_externo_comprovado=false)
   FROM public.catalogo_asaas_acumulo_tentativas_emissao_ci")" = '1|true|true'
test "$(psql -X -d catalogo_cob06_ci -Atqc \
  "SELECT (t.operacao_id=r.operacao_id)::text||'|'||
          (t.valor_centavos=r.valor_centavos)::text||'|'||
          (r.payment_id IS NULL)::text
   FROM public.catalogo_asaas_acumulo_tentativas_emissao_ci t
   JOIN public.catalogo_asaas_acumulo_referencias r ON r.lote_id=t.lote_id")" = 'true|true|true'
test "$(psql -X -d catalogo_cob06_ci -Atqc \
  "SELECT count(*) FROM public.catalogo_fatura_cobrancas
   WHERE order_id='legacy-cob06-ci' AND status='pago' AND valor_centavos=700")" = '1'
test "$(psql -X -d catalogo_cob06_ci -Atqc \
  "SELECT count(*) FROM public.catalogo_asaas_emissoes")" = '0'
test "$(psql -X -d catalogo_cob06_ci -Atqc \
  "SELECT (x->>'ok')||'|'||(x->>'nova_tentativa')||'|'||(x->>'pode_emitir_pix')
   FROM (SELECT catalogo_private.catalogo_asaas_autorizar_post_mock_ci('$lote','guia-acumulo-$lote','cus_cob06_gate_race_123',500,0,true) x) t")" = 'false|false|false'

echo 'COB06_AUTORIZACAO_MOCK_RACE_POSITIVA_UNICA_SEM_POST_OK'
