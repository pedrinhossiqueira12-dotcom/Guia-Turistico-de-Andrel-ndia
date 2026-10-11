#!/usr/bin/env bash
# Executado SOMENTE na CI, com PostgreSQL localhost descartavel.
# Simula STAGING que aplicou a migration Asaas antes da inbox duravel.
set -euo pipefail
test "$PGHOST" = localhost
test "$PGDATABASE" = catalogo_ci
test -z "$(printenv DATABASE_URL || :)"
test -z "$(printenv SUPABASE_ACCESS_TOKEN || :)"
test -z "$(printenv SUPABASE_DB_PASSWORD || :)"
db=catalogo_asaas_inbox_upgrade_ci
tmp=$(mktemp)
cleanup() {
  rm -f "$tmp"
  dropdb --if-exists --force "$db" >/dev/null 2>&1 || true
}
trap cleanup EXIT
createdb --template=catalogo_ci "$db"
# Reconstroi o esquema historico do Asaas antes da inbox duravel.
awk '/^-- Webhook inbox de producao/{exit} {print}' \
  supabase/pending-migrations/20261008180000_asaas_faturas_saques_controlados.sql > "$tmp"
printf '\nCOMMIT;\n' >> "$tmp"
psql -X -d "$db" -v ON_ERROR_STOP=1 -f "$tmp" >/dev/null
psql -X -d "$db" -v ON_ERROR_STOP=1 -c \
  "INSERT INTO public.catalogo_asaas_webhook_eventos(id,evento,recurso_id)
   VALUES('ci-evento-historico-001','PAYMENT_RECEIVED','pay-ci-historico-001')" >/dev/null
test "$(psql -X -d "$db" -Atqc \
  "SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
   AND table_name='catalogo_asaas_webhook_eventos' AND column_name='estado'")" = 0
test "$(psql -X -d "$db" -At -f \
  scripts/validacao-pagamentos/asaas-preflight-schema-readonly.sql | cut -d '|' -f1)" = f
# Aplicar duas vezes prova idempotencia sem apagar ou reenfileirar historico.
patch=supabase/pending-migrations/20261011234500_asaas_webhook_inbox_incremental_staging.sql
psql -X -d "$db" -v ON_ERROR_STOP=1 -f "$patch" >/dev/null
psql -X -d "$db" -v ON_ERROR_STOP=1 -f "$patch" >/dev/null
test "$(psql -X -d "$db" -At -f \
  scripts/validacao-pagamentos/asaas-preflight-schema-readonly.sql | cut -d '|' -f1)" = t
test "$(psql -X -d "$db" -Atqc \
  "SELECT estado FROM public.catalogo_asaas_webhook_eventos WHERE id='ci-evento-historico-001'")" = concluido
test "$(psql -X -d "$db" -Atqc \
  "SELECT count(*) FROM public.catalogo_asaas_webhook_eventos WHERE id='ci-evento-historico-001'")" = 1
test "$(psql -X -d "$db" -Atqc \
  "SELECT has_function_privilege('anon','public.catalogo_asaas_webhook_receber(text,text,text,text)','EXECUTE')")" = f
test "$(psql -X -d "$db" -Atqc \
  "SELECT has_function_privilege('authenticated','public.catalogo_asaas_webhook_claim(integer)','EXECUTE')")" = f
test "$(psql -X -d "$db" -Atqc \
  "SELECT has_function_privilege('service_role','public.catalogo_asaas_webhook_receber(text,text,text,text)','EXECUTE')")" = t
# Exercita RPCs reais com IDs ficticios, sem rede.
psql -X -d "$db" -v ON_ERROR_STOP=1 <<'SQL'
DO $test$
DECLARE
  novo jsonb; repetido jsonb; reserva jsonb; resultado jsonb;
  item jsonb; token uuid;
BEGIN
  novo:=public.catalogo_asaas_webhook_receber(
    'ci-evento-novo-001','PAYMENT_RECEIVED','pay-ci-novo-001',null);
  IF novo->>'novo' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Falha ao persistir evento novo';
  END IF;
  repetido:=public.catalogo_asaas_webhook_receber(
    'ci-evento-novo-001','PAYMENT_RECEIVED','pay-ci-novo-001',null);
  IF repetido->>'duplicado' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Webhook repetido nao foi deduplicado';
  END IF;
  reserva:=public.catalogo_asaas_webhook_claim(10);
  SELECT elem INTO item FROM jsonb_array_elements(reserva) AS elem
    WHERE elem->>'id'='ci-evento-novo-001';
  IF item IS NULL THEN
    RAISE EXCEPTION 'Evento novo nao entrou na fila';
  END IF;
  token:=(item->>'tentativa_token')::uuid;
  resultado:=public.catalogo_asaas_webhook_finalizar(
    'ci-evento-novo-001',token,true);
  IF resultado->>'ok' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Nao concluiu inbox com token original';
  END IF;
  resultado:=public.catalogo_asaas_webhook_finalizar(
    'ci-evento-novo-001',token,true);
  IF resultado->>'ok' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'Token reutilizado concluiu evento novamente';
  END IF;
  IF (SELECT estado FROM public.catalogo_asaas_webhook_eventos
      WHERE id='ci-evento-novo-001') IS DISTINCT FROM 'concluido' THEN
    RAISE EXCEPTION 'Estado nao finalizado';
  END IF;
  IF (SELECT estado FROM public.catalogo_asaas_webhook_eventos
      WHERE id='ci-evento-historico-001') IS DISTINCT FROM 'concluido' THEN
    RAISE EXCEPTION 'Evento historico indevidamente reenfileirado';
  END IF;
END
$test$;
SQL
echo "PASS: inbox legada atualizada sem perder eventos; dedupe, RPCs e permissoes seguras."
