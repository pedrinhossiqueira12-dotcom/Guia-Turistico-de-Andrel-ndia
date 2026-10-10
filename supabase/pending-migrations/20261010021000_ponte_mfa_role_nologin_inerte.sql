-- #42 | CANAL PRIVADO DOCUMENTAL INERTE: SOMENTE ROLE NOLOGIN DE LABORATORIO.
-- Esta migration fica PENDENTE na branch PR #39. NAO aplicar em STAGING/PROD.
-- Nao implementa autenticacao Auth, conexao Pg, segredo, endpoint ou Pix.
-- Funcoes SECURITY DEFINER abaixo chamam apenas APIs documentais que
-- retornam HOLD, NAO acessam nem autorizam saques, faturas ou pagamentos.
-- O backend futuro DEVE verificar JWT assinada/sessao AAL1 real antes de
-- passar user_id/session_id; o proprio PostgreSQL NAO verifica JWT.
-- BLOQUEIO MATERIAL: este arquivo NAO pode ser aplicado em STAGING/PROD,
-- nem por engano via push de TODAS as pending-migrations.
BEGIN;
DO $ci_only_bridge$
BEGIN
 IF current_database() IS DISTINCT FROM 'catalogo_asaas_guards_ci'
  OR current_setting('app.catalogo_ci_mfa_bridge',true) IS DISTINCT FROM 'enabled'
  OR session_user IS DISTINCT FROM 'postgres'
 THEN
  RAISE EXCEPTION
   'CI_ONLY_MFA_BRIDGE: recusa instalacao fora de clone efemero e opt-in';
 END IF;
END $ci_only_bridge$;

-- Criar papel sem LOGIN e sem qualquer capacidade privilegiada de banco.
-- NUNCA conceder membership a anon, authenticated, service_role,
-- authenticator ou qualquer conta utilizada pela Data API.
CREATE ROLE catalogo_mfa_ponte_ci_inerte NOLOGIN NOINHERIT NOSUPERUSER
 NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
-- Um schema NOVO, dedicado somente a 5 wrappers, evita conceder
-- USAGE sobre todas as demais funcoes privadas ja existentes.
CREATE SCHEMA catalogo_mfa_ponte_ci_inerte AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA catalogo_mfa_ponte_ci_inerte
 FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA catalogo_mfa_ponte_ci_inerte TO catalogo_mfa_ponte_ci_inerte;

-- Opcao documental do livro: catalogo_asaas_reservar_inicio_principal_vinculado_inerte.
-- SECURITY DEFINER isola as leituras internas, mas acesso ao wrapper
-- exige EXECUTE exclusivo do papel NOLOGIN, sem nenhuma credencial criada.
CREATE FUNCTION catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_reservar_principal_inerte(p_contexto uuid,p_usuario uuid,p_sessao uuid)
 RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=''
 AS $bridge$ SELECT catalogo_private.catalogo_asaas_reservar_inicio_principal_vinculado_inerte(p_contexto,p_usuario,p_sessao); $bridge$;
REVOKE ALL ON FUNCTION catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_reservar_principal_inerte(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_reservar_principal_inerte(uuid,uuid,uuid)
 TO catalogo_mfa_ponte_ci_inerte;

-- Opcao documental do livro: catalogo_asaas_ler_contexto_prechallenge_inerte.
-- SECURITY DEFINER isola as leituras internas, mas acesso ao wrapper
-- exige EXECUTE exclusivo do papel NOLOGIN, sem nenhuma credencial criada.
CREATE FUNCTION catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_ler_contexto_inerte(p_contexto uuid)
 RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=''
 AS $bridge$ SELECT catalogo_private.catalogo_asaas_ler_contexto_prechallenge_inerte(p_contexto); $bridge$;
REVOKE ALL ON FUNCTION catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_ler_contexto_inerte(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_ler_contexto_inerte(uuid)
 TO catalogo_mfa_ponte_ci_inerte;

-- Opcao documental do livro: catalogo_asaas_registrar_desafio_compartilhado_inerte.
-- SECURITY DEFINER isola as leituras internas, mas acesso ao wrapper
-- exige EXECUTE exclusivo do papel NOLOGIN, sem nenhuma credencial criada.
CREATE FUNCTION catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_registrar_desafio_inerte(p_nonce uuid,p_challenge uuid,p_tentativa uuid)
 RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=''
 AS $bridge$ SELECT catalogo_private.catalogo_asaas_registrar_desafio_compartilhado_inerte(p_nonce,p_challenge,p_tentativa); $bridge$;
REVOKE ALL ON FUNCTION catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_registrar_desafio_inerte(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_registrar_desafio_inerte(uuid,uuid,uuid)
 TO catalogo_mfa_ponte_ci_inerte;

-- Opcao documental do livro: catalogo_asaas_ler_tentativa_prechallenge_inerte.
-- SECURITY DEFINER isola as leituras internas, mas acesso ao wrapper
-- exige EXECUTE exclusivo do papel NOLOGIN, sem nenhuma credencial criada.
CREATE FUNCTION catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_ler_tentativa_inerte(p_tentativa uuid)
 RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=''
 AS $bridge$ SELECT catalogo_private.catalogo_asaas_ler_tentativa_prechallenge_inerte(p_tentativa); $bridge$;
REVOKE ALL ON FUNCTION catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_ler_tentativa_inerte(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_ler_tentativa_inerte(uuid)
 TO catalogo_mfa_ponte_ci_inerte;

-- Opcao documental do livro: catalogo_asaas_consumir_desafio_compartilhado_inerte.
-- SECURITY DEFINER isola as leituras internas, mas acesso ao wrapper
-- exige EXECUTE exclusivo do papel NOLOGIN, sem nenhuma credencial criada.
CREATE FUNCTION catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_consumir_desafio_inerte(p_nonce uuid,p_challenge uuid,p_tentativa uuid)
 RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=''
 AS $bridge$ SELECT catalogo_private.catalogo_asaas_consumir_desafio_compartilhado_inerte(p_nonce,p_challenge,p_tentativa); $bridge$;
REVOKE ALL ON FUNCTION catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_consumir_desafio_inerte(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_consumir_desafio_inerte(uuid,uuid,uuid)
 TO catalogo_mfa_ponte_ci_inerte;

-- Defensiva: sem TABLE GRANT, sem LOGIN, sem membership dos 4 papeis
-- Supabase. Erro de instalacao se o isolamento nao for exatamente este.
DO $guard$
DECLARE v_name text; v_sql text;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles
  WHERE rolname='catalogo_mfa_ponte_ci_inerte' AND
   (rolcanlogin OR rolsuper OR rolinherit OR rolcreatedb OR rolcreaterole
    OR rolreplication OR rolbypassrls))
 THEN RAISE EXCEPTION 'CI: o papel MFA nao pode ter login/privilégio'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m
  JOIN pg_catalog.pg_roles member ON member.oid=m.member
  JOIN pg_catalog.pg_roles target ON target.oid=m.roleid
  WHERE target.rolname='catalogo_mfa_ponte_ci_inerte'
    AND member.rolname IN ('anon','authenticated','service_role','authenticator'))
 THEN RAISE EXCEPTION 'CI: role MFA foi associado a Data API'; END IF;
 -- pg_auth_members direto NAO basta: um papel pode chegar aqui
 -- por heranca ou SET ROLE atraves de membros INTERMEDIARIOS. Em PG17,
 -- NOLOGIN nao impede esse caminho; pg_has_role MEMBER segue toda a cadeia.
 IF EXISTS(
  SELECT 1 FROM pg_catalog.pg_roles parent
  JOIN pg_catalog.pg_roles bridge
    ON bridge.rolname='catalogo_mfa_ponte_ci_inerte'
  WHERE parent.rolname IN ('anon','authenticated','service_role','authenticator')
    AND pg_catalog.pg_has_role(parent.oid,bridge.oid,'MEMBER')
 ) THEN RAISE EXCEPTION
  'CI: papel MFA alcançavel por membership indireta de Data API'; END IF;
 IF has_schema_privilege('catalogo_mfa_ponte_ci_inerte','catalogo_private','USAGE')
  OR has_schema_privilege('catalogo_mfa_ponte_ci_inerte','catalogo_mfa_ponte_ci_inerte','CREATE')
 THEN RAISE EXCEPTION 'CI: role MFA ganhou acesso a schema bruto ou CREATE'; END IF;
 IF has_table_privilege('catalogo_mfa_ponte_ci_inerte',
    'public.catalogo_asaas_reservas_prechallenge_compartilhadas_inertes','SELECT')
  OR has_table_privilege('catalogo_mfa_ponte_ci_inerte',
    'public.catalogo_asaas_desafios_prechallenge_compartilhados_inertes','INSERT')
  OR has_table_privilege('catalogo_mfa_ponte_ci_inerte','auth.users','SELECT')
 THEN RAISE EXCEPTION 'CI: role MFA ganhou acesso a tabela bruta'; END IF;
END $guard$;

COMMIT;
