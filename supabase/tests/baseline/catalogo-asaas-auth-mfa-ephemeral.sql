-- SOMENTE TESTE: minimo necessario de auth.sessions e auth.jwt() local.
-- NAO copiar para Supabase; NAO expor como migration.
DO $guard$
BEGIN
 IF pg_catalog.current_database()<>'catalogo_asaas_guards_ci'
  OR pg_catalog.current_setting('app.catalogo_ci_mfa_mock',true) IS DISTINCT FROM 'enabled'
  OR pg_catalog.to_regclass('auth.sessions') IS NOT NULL
  OR pg_catalog.to_regprocedure('auth.jwt()') IS NOT NULL
  OR pg_catalog.to_regclass('public.catalogos') IS NULL
  OR pg_catalog.to_regclass('public.catalogo_asaas_escrow_pareceres_preliminares') IS NOT NULL
 THEN
  RAISE EXCEPTION 'Fixture Auth MFA apenas catalogo_asaas_guards_ci com baseline local e opt-in'
   USING ERRCODE='23514';
 END IF;
END $guard$;

CREATE TABLE auth.sessions (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id),
 aal text,
 factor_id uuid,
 not_after timestamptz,
 created_at timestamptz DEFAULT now(),
 updated_at timestamptz DEFAULT now()
);
CREATE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $local_jwt$
 SELECT NULLIF(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb
$local_jwt$;
-- MOCK nunca faz verificacao de JWT assinada. PostgREST/Auth REAL validam
-- token antes de emitir os claims; estes ensaios so exercitam o predicado SQL.
