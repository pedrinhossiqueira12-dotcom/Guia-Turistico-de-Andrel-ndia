#!/usr/bin/env bash
# COB-06: teste de duas conexoes PostgreSQL reais em base DESCARTAVEL.
# Nao consulta nem modifica STAGING/PROD, Asaas ou credenciais.
set -euo pipefail

test "${PGHOST:-}" = "localhost"
test "${PGDATABASE:-}" = "catalogo_ci"
test -z "${DATABASE_URL:-}"
test -z "${PGSERVICE:-}"
test -z "${PGHOSTADDR:-}"
race_db="catalogo_cob06_race_ci"
hold_log="/tmp/cob06-competencia-hold-ci.log"
delivery_log="/tmp/cob06-competencia-delivery-ci.log"
accept_log="/tmp/cob06-competencia-accept-ci.log"
holder_pid=""

cleanup() {
  if [[ -n "$holder_pid" ]]; then
    kill "$holder_pid" 2>/dev/null || true
    wait "$holder_pid" 2>/dev/null || true
  fi
  dropdb --if-exists --force "$race_db"
  rm -f "$hold_log" "$delivery_log" "$accept_log"
}
trap cleanup EXIT

createdb --template=catalogo_cob06_ci "$race_db"
psql -X -d "$race_db" -v ON_ERROR_STOP=1 \
  -f supabase/tests/isolated/asaas-cob06-competencia-concorrencia-fixture.sql

# A mantem o lock de fechamento durante quatro segundos, em transacao
# real e paralela, depois congela a fatura sem incluir pedido pendente.
psql -X -d "$race_db" -v ON_ERROR_STOP=1 -Atq \
  -c "BEGIN;
      SELECT pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('catalogo-fatura:comercio-de-exemplo',0));
      SELECT pg_catalog.pg_sleep(4);
      SELECT public.catalogo_gerar_fechamento_offline('comercio-de-exemplo','2040-01-01');
      COMMIT;" > "$hold_log" 2>&1 &
holder_pid=$!

# Aguarda evidencia objetiva de lock adquirido, sem ler dados remotos.
locked="false"
for attempt in $(seq 1 70); do
  if [[ "$(psql -X -d "$race_db" -Atqc \
    "SELECT NOT pg_catalog.pg_try_advisory_lock(
      pg_catalog.hashtextextended('catalogo-fatura:comercio-de-exemplo',0))")" = "t" ]]; then
    locked="true"
    break
  fi
  sleep 0.05
done
if [[ "$locked" != "true" ]]; then
  echo "COB06_CI: holder nao adquiriu lock" >&2
  exit 1
fi

# B: entrega tardia. O trigger tem de falhar RAPIDO por 55P03, sem
# aguardar o fechamento e sem deixar status de entrega gravado pela metade.
if timeout 2s psql -X -d "$race_db" -v ON_ERROR_STOP=1 \
   -c "UPDATE public.catalogo_pedidos SET status='entregue',
       entrega_status='entregue',status_pagamento='aprovado',
       codigo_entrega_usado_em='2040-01-20T12:00:00Z'
       WHERE id='00000000-0000-4000-8000-00000000c702'" \
   > "$delivery_log" 2>&1; then
  echo "COB06_CI: entrega nao foi bloqueada pelo fechamento concorrente" >&2
  exit 1
fi
grep -F 'COB06_CI_ONLY: competencia em fechamento; tente novamente' "$delivery_log"

# B: aceite da mesma loja com comissao ainda nao registrada.
if timeout 2s psql -X -d "$race_db" -v ON_ERROR_STOP=1 \
   -c "SELECT catalogo_private.catalogo_v2_registrar_plataforma(
     '00000000-0000-4000-8000-00000000c703','aceite')" \
   > "$accept_log" 2>&1; then
  echo "COB06_CI: aceite nao foi bloqueado pelo fechamento concorrente" >&2
  exit 1
fi
grep -F 'COB06_CI_ONLY: competencia em fechamento; tente novamente' "$accept_log"

test "$(psql -X -d "$race_db" -Atqc \
  "SELECT status||'|'||entrega_status FROM public.catalogo_pedidos
   WHERE id='00000000-0000-4000-8000-00000000c702'")" = "em_preparo|nao_atribuido"
test "$(psql -X -d "$race_db" -Atqc \
  "SELECT count(*) FROM public.catalogo_comissoes_offline
   WHERE pedido_id='00000000-0000-4000-8000-00000000c703'")" = "0"
test "$(psql -X -d "$race_db" -Atqc \
  "SELECT count(*) FROM public.catalogo_lancamentos_financeiros_v2
   WHERE pedido_id='00000000-0000-4000-8000-00000000c703'")" = "0"

# A encerra, B pode repetir com nova transacao sem duplicacao.
wait "$holder_pid"
holder_pid=""
test "$(psql -X -d "$race_db" -Atqc \
  "SELECT total_pedidos||'|'||total_comissao_centavos||'|'||status
   FROM public.catalogo_fechamentos_offline
   WHERE comercio_id='comercio-de-exemplo' AND competencia='2040-01-01'")" = "1|280|faturado"

psql -X -d "$race_db" -v ON_ERROR_STOP=1 -q \
  -c "UPDATE public.catalogo_pedidos SET status='entregue',
      entrega_status='entregue',status_pagamento='aprovado',
      codigo_entrega_usado_em='2040-01-20T12:00:00Z'
      WHERE id='00000000-0000-4000-8000-00000000c702'"
psql -X -d "$race_db" -v ON_ERROR_STOP=1 -q \
  -c "SELECT catalogo_private.catalogo_v2_registrar_plataforma(
    '00000000-0000-4000-8000-00000000c703','aceite')"
psql -X -d "$race_db" -v ON_ERROR_STOP=1 -q \
  -c "UPDATE public.catalogo_pedidos SET status='entregue',
      entrega_status='entregue',status_pagamento='aprovado',
      codigo_entrega_usado_em='2040-01-20T13:00:00Z'
      WHERE id='00000000-0000-4000-8000-00000000c703'"

test "$(psql -X -d "$race_db" -Atqc \
  "SELECT count(*)||'|'||coalesce(sum(valor_comissao_centavos),0)
   FROM public.catalogo_comissoes_offline
   WHERE competencia='2040-02-01'
     AND pedido_id IN ('00000000-0000-4000-8000-00000000c702',
                       '00000000-0000-4000-8000-00000000c703')")" = "2|560"
test "$(psql -X -d "$race_db" -Atqc \
  "SELECT count(*)||'|'||coalesce(sum(valor_centavos),0)
   FROM public.catalogo_logistica_offline_v2
   WHERE competencia='2040-02-01'
     AND pedido_id IN ('00000000-0000-4000-8000-00000000c702',
                       '00000000-0000-4000-8000-00000000c703')")" = "2|160"

psql -X -d "$race_db" -v ON_ERROR_STOP=1 -Atq \
 -c "SELECT public.catalogo_gerar_fechamento_offline(
      'comercio-de-exemplo','2040-02-01')" > /dev/null

test "$(psql -X -d "$race_db" -Atqc \
  "SELECT total_pedidos||'|'||total_comissao_centavos||'|'||status
   FROM public.catalogo_fechamentos_offline
   WHERE comercio_id='comercio-de-exemplo' AND competencia='2040-02-01'")" = "2|560|faturado"
test "$(psql -X -d "$race_db" -Atqc \
  "SELECT (x->>'pronto_para_preparar')||'|'||(x->>'total_centavos')
        ||'|'||(x->>'quantidade_faturas')||'|'||(x->>'snapshots_inconsistentes')
   FROM (SELECT public.catalogo_asaas_previsualizar_acumulo(
        'comercio-de-exemplo','2040-02-01') x) s")" = "true|840|2|0"
test "$(psql -X -d "$race_db" -Atqc \
  "SELECT count(*) FROM public.catalogo_fatura_cobrancas
   WHERE order_id='legacy-cob06-ci' AND status='pago'")" = "1"
test "$(psql -X -d "$race_db" -Atqc \
  "SELECT count(*) FROM public.catalogo_asaas_emissoes")" = "0"
test "$(psql -X -d "$race_db" -Atqc \
  "SELECT count(*) FROM public.catalogo_asaas_acumulo_lotes")" = "0"

echo "COB06_COMPETENCIA_CONCORRENTE_CI_RETRY_SEM_DEADLOCK_OK"
