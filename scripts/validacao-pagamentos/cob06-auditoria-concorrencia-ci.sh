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
