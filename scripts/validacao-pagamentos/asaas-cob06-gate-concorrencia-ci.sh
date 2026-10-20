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

# Sem prova GET mockada persistida: nem o modo POSITIVO CI autoriza POST.
test "$(psql -X -d catalogo_cob06_ci -Atqc \
  "SELECT (x->>'ok')||'|'||(x->>'nova_tentativa')||'|'||(x->>'pode_emitir_pix')
   FROM (SELECT catalogo_private.catalogo_asaas_autorizar_post_mock_ci('$lote',
    'guia-acumulo-$lote','cus_cob06_gate_race_123',500,0,true) x) t")" = 'false|false|false'
test "$(psql -X -d catalogo_cob06_ci -Atqc \
  "SELECT COUNT(*) FROM public.catalogo_asaas_acumulo_tentativas_emissao_ci")" = 0

# Digest e metadados sinteticos: nao constitui prova de Asaas real.
psql -X -d catalogo_cob06_ci -v ON_ERROR_STOP=1 -Atqc \
  "INSERT INTO catalogo_private.catalogo_asaas_get_negativo_post_mock_ci
    (lote_id,operacao_id,referencia,cliente_id,valor_centavos,http_status,
     total_count,itens_count,has_more,resposta_sha256)
   SELECT r.lote_id,r.operacao_id,r.referencia,
    'cus_cob06_gate_race_123',r.valor_centavos,200,0,0,false,
    repeat('a',64)
   FROM public.catalogo_asaas_acumulo_referencias r
   WHERE r.lote_id='$lote'::uuid"
test "$(psql -X -d catalogo_cob06_ci -Atqc \
  "SELECT COUNT(*) FROM catalogo_private.catalogo_asaas_get_negativo_post_mock_ci
   WHERE lote_id='$lote'::uuid AND evidencia_mockada=true")" = 1

# Mesmo owner nao pode reescrever a trilha depois de confirmada.
if psql -X -d catalogo_cob06_ci -v ON_ERROR_STOP=1 -Atqc \
  "UPDATE catalogo_private.catalogo_asaas_get_negativo_post_mock_ci
   SET resposta_sha256=repeat('b',64) WHERE lote_id='$lote'::uuid" \
  >/dev/null 2>&1; then
  echo 'COB06_POST_MOCK: evidencia GET mutavel' >&2
  exit 1
fi



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

# Mesmo lote ficticio e duas conexoes concorrentes, agora pelo gate STAGING
# realmente instalavel e SEM nenhum campo de autorizacao de Pix em true.
timeout 14s psql -X -d catalogo_cob06_ci -v ON_ERROR_STOP=1 -Atq \
  -c "BEGIN;
      SELECT (x->>'ok')||'|'||(x->>'nova_tentativa')||'|'||(x->>'pode_emitir_pix')
      FROM (SELECT public.catalogo_asaas_reservar_tentativa_qa_sem_pix('$lote') x) t;
      SELECT pg_catalog.pg_sleep(4);
      COMMIT;" > "$primeiro_log" 2>&1 &
primeiro_pid=$!

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
  echo 'COB06_QA_GATE_RACE: primeira conexao nao obteve lock' >&2
  exit 1
fi

timeout 14s psql -X -d catalogo_cob06_ci -v ON_ERROR_STOP=1 -Atq \
  -c "SELECT (x->>'ok')||'|'||(x->>'nova_tentativa')||'|'||(x->>'pode_emitir_pix')
      FROM (SELECT public.catalogo_asaas_reservar_tentativa_qa_sem_pix('$lote') x) t" \
  > "$segundo_log" 2>&1 &
segundo_pid=$!

esperou_lock="false"
for tentativa in $(seq 1 60); do
  if [[ "$(psql -X -d catalogo_cob06_ci -Atqc \
    "SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_activity
      WHERE datname='catalogo_cob06_ci' AND wait_event_type='Lock'
      AND query LIKE '%catalogo_asaas_reservar_tentativa_qa_sem_pix%')")" = "t" ]]; then
    esperou_lock="true"
    break
  fi
  sleep 0.05
done
if [[ "$esperou_lock" != "true" ]]; then
  echo 'COB06_QA_GATE_RACE: concorrente nao aguardou lock' >&2
  exit 1
fi

wait "$primeiro_pid"
primeiro_pid=""
wait "$segundo_pid"
segundo_pid=""
grep -Fx 'true|true|false' "$primeiro_log"
grep -Fx 'false|false|false' "$segundo_log"
test "$(psql -X -d catalogo_cob06_ci -Atqc \
  "SELECT count(*)||'|'||bool_and(NOT pode_emitir_pix AND NOT post_executado
    AND NOT pode_quitar AND NOT pode_liberar_motoboy)
   FROM catalogo_private.catalogo_asaas_tentativas_qa_sem_pix")" = '1|true'
test "$(psql -X -d catalogo_cob06_ci -Atqc \
  "SELECT (x->>'ok')||'|'||(x->>'nova_tentativa')||'|'||(x->>'pode_emitir_pix')
   FROM (SELECT public.catalogo_asaas_reservar_tentativa_qa_sem_pix('$lote') x) t")" = 'false|false|false'
echo 'COB06_STAGING_GATE_RACE_UNICO_PERSISTENTE_SEM_PIX_OK'
