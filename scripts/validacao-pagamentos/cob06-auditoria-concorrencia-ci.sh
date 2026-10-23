#!/usr/bin/env bash
# Apenas PostgreSQL descartavel da CI; sem HTTP ou credenciais externas.
set -euo pipefail
test "${PGHOST:-}" = localhost
test "${PGDATABASE:-}" = catalogo_ci
test "${PGPORT:-5432}" = 5432
for key in DATABASE_URL PGSERVICE PGHOSTADDR PGOPTIONS SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD; do
  test -z "${!key:-}"
done
createdb --template=catalogo_ci catalogo_auditoria_ci
tmp=$(mktemp -d)
trap 'dropdb --if-exists --force catalogo_auditoria_ci; rm -rf "$tmp"' EXIT
sql() { psql -X -d catalogo_auditoria_ci -v ON_ERROR_STOP=1 "$@"; }
while IFS= read -r file; do sql -f "$file" > /dev/null; done < <(
 node -e 'for(const f of require("./scripts/validacao-pagamentos/asaas-cob06-billing-only.lock.json").files)console.log(f.path)'
)
sql -f supabase/production-candidate/cob06-auditoria-01-pendencias.sql
sql -f supabase/production-candidate/cob06-auditoria-02-emissao.sql
sql <<'SQL'
INSERT INTO public.catalogo_fechamentos_offline(id,comercio_id,competencia,total_pedidos,total_comissao_centavos,status)
VALUES('00000000-0000-4000-8000-000000000081','comercio-de-exemplo','2045-01-01',1,700,'faturado');
SQL
sql > "$tmp/a.log" 2>&1 <<'SQL' &
BEGIN;
INSERT INTO public.catalogo_asaas_emissoes(fechamento_id) VALUES('00000000-0000-4000-8000-000000000081');
\echo RESERVA_ASAAS_RETIDA
SELECT pg_sleep(3);
COMMIT;
SQL
pid=$!
for i in {1..100}; do
  if grep -q RESERVA_ASAAS_RETIDA "$tmp/a.log"; then break; fi
  sleep 0.02
done
grep -q RESERVA_ASAAS_RETIDA "$tmp/a.log"
if sql > "$tmp/b.log" 2>&1 <<'SQL'
\set VERBOSITY verbose
SET lock_timeout='200ms';
SELECT public.catalogo_reservar_emissao_mp_fatura('00000000-0000-4000-8000-000000000081',700);
SQL
then echo 'ERRO: MP nao esperou pela reserva Asaas' >&2; exit 1; fi
grep -q 55P03 "$tmp/b.log"
wait "$pid"
test "$(sql -Atqc "SELECT catalogo_reservar_emissao_mp_fatura('00000000-0000-4000-8000-000000000081',700)->>'ok'")" = false
test "$(sql -Atqc 'SELECT count(*) FROM catalogo_asaas_emissoes')" = 1
echo COB06_AUDITORIA_P2_RESERVA_COMUM_DUAS_CONEXOES_OK
if sql > "$tmp/snapshot.log" 2>&1 -c "UPDATE catalogo_fechamentos_offline SET total_comissao_centavos=701 WHERE id='00000000-0000-4000-8000-000000000081'"; then
 echo 'ERRO: fechamento alterou total reservado' >&2; exit 1
fi
grep -q 'Snapshot reservado' "$tmp/snapshot.log"
echo COB06_AUDITORIA_P2_SNAPSHOT_RESERVADO_CONGELADO_OK
sql -f supabase/production-candidate/cob06-auditoria-03-inadimplencia.sql
sql <<'SQL'
UPDATE catalogo_fechamentos_offline SET status='vencido',vencimento_em='2020-01-01'
 WHERE id='00000000-0000-4000-8000-000000000081';
SELECT catalogo_asaas_registrar_fatura('00000000-0000-4000-8000-000000000081','pay_audit_race_a',700,NULL,NULL,NULL,NULL);
INSERT INTO public.catalogo_fechamentos_offline(id,comercio_id,competencia,total_pedidos,total_comissao_centavos,status,vencimento_em)
VALUES('00000000-0000-4000-8000-000000000082','comercio-de-exemplo','2045-02-01',1,700,'vencido','2020-01-01');
SELECT catalogo_reservar_emissao_mp_fatura('00000000-0000-4000-8000-000000000082',700);
SELECT catalogo_registrar_cobranca_fatura('00000000-0000-4000-8000-000000000082','mp_audit_race_b',700,NULL,NULL,NULL,NULL,'fixture');
UPDATE catalogos SET bloqueado=true,motivo_bloqueio='Comissão de pagamentos presenciais vencida.' WHERE comercio_id='comercio-de-exemplo';
SELECT catalogo_confirmar_cobranca_fatura('pay_audit_race_a','pago','proof-a',700,'fixture');
SQL
test "$(sql -Atqc "SELECT bloqueado FROM catalogos WHERE comercio_id='comercio-de-exemplo'")" = t
sql > "$tmp/refund.log" 2>&1 <<'SQL' &
BEGIN;
SELECT catalogo_confirmar_cobranca_fatura('pay_audit_race_a','estornado','proof-a',700,'fixture');
\echo ESTORNO_RETIDO
SELECT pg_sleep(3);
COMMIT;
SQL
pid=$!
for i in {1..100}; do
 if grep -q ESTORNO_RETIDO "$tmp/refund.log"; then break; fi
 sleep 0.02
done
grep -q ESTORNO_RETIDO "$tmp/refund.log"
if sql > "$tmp/payment.log" 2>&1 <<'SQL'
\set VERBOSITY verbose
SET lock_timeout='200ms';
SELECT catalogo_confirmar_cobranca_fatura('mp_audit_race_b','pago','proof-b',700,'fixture');
SQL
then echo 'ERRO: quitacao nao esperou pelo estorno da mesma loja' >&2; exit 1; fi
grep -q 55P03 "$tmp/payment.log"
wait "$pid"
sql -c "SELECT catalogo_confirmar_cobranca_fatura('mp_audit_race_b','pago','proof-b',700,'fixture')"
test "$(sql -Atqc "SELECT bloqueado FROM catalogos WHERE comercio_id='comercio-de-exemplo'")" = t
test "$(sql -Atqc "SELECT catalogo_confirmar_cobranca_fatura('pay_audit_race_a','pago','late-proof',700,'fixture')->>'ok'")" = false
echo COB06_AUDITORIA_P3_QUITACAO_ESTORNO_SERIALIZADOS_OK
sql > "$tmp/register.log" 2>&1 <<'SQL' &
BEGIN;
SET statement_timeout='10s';
SELECT id FROM catalogo_fechamentos_offline WHERE id='00000000-0000-4000-8000-000000000082' FOR UPDATE;
\echo REGISTRO_FECHAMENTO_RETIDO
SELECT pg_sleep(2);
UPDATE catalogo_fatura_cobrancas SET ultima_consulta_em=clock_timestamp() WHERE order_id='mp_audit_race_b';
COMMIT;
SQL
pid=$!
for i in {1..100}; do
 if grep -q REGISTRO_FECHAMENTO_RETIDO "$tmp/register.log"; then break; fi
 sleep 0.02
done
grep -q REGISTRO_FECHAMENTO_RETIDO "$tmp/register.log"
sql > "$tmp/settle-register.log" 2>&1 <<'SQL'
SET statement_timeout='10s';
SELECT catalogo_confirmar_cobranca_fatura('mp_audit_race_b','estornado','proof-b',700,'fixture');
SQL
wait "$pid"
echo COB06_AUDITORIA_REGISTRO_CONCILIACAO_SEM_CICLO_DE_LOCK_OK
sql -f supabase/production-candidate/cob06-auditoria-04-vitrine.sql
sql -f supabase/production-candidate/cob06-auditoria-05-andamento.sql
echo COB06_AUDITORIA_CINCO_CANDIDATOS_FORWARD_ONLY_INSTALADOS_NO_CLONE_OK
