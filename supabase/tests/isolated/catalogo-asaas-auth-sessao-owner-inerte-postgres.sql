-- #42 — somente clone PostgreSQL CI + Auth fake.
-- ROLLBACK SEMPRE. Nao envia JWT, OTP nem acessa Supabase remoto.
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'catalogo_asaas_guards_ci'
  OR current_setting('app.catalogo_ci_mfa_test',true) IS DISTINCT FROM 'enabled'
  OR to_regprocedure(
   'catalogo_private.catalogo_asaas_ler_sessao_fator_auth_inerte(uuid)'
  ) IS NULL THEN
  RAISE EXCEPTION 'Consulta Auth so pode rodar em clone local descartavel';
 END IF;
 IF has_function_privilege('anon',
   'catalogo_private.catalogo_asaas_ler_sessao_fator_auth_inerte(uuid)','EXECUTE')
  OR has_function_privilege('authenticated',
   'catalogo_private.catalogo_asaas_ler_sessao_fator_auth_inerte(uuid)','EXECUTE')
  OR has_function_privilege('service_role',
   'catalogo_private.catalogo_asaas_ler_sessao_fator_auth_inerte(uuid)','EXECUTE')
  OR has_function_privilege('authenticated',
   'public.catalogo_asaas_preflight_sessao_revisor_inerte()','EXECUTE')
  OR has_function_privilege('anon',
   'public.catalogo_asaas_preflight_sessao_revisor_inerte()','EXECUTE')
  OR has_function_privilege('service_role',
   'public.catalogo_asaas_preflight_sessao_revisor_inerte()','EXECUTE')
 THEN RAISE EXCEPTION 'Funcoes MFA nao estao owner-only'; END IF;
END $guard$;

SET LOCAL ROLE authenticated;
DO $call_denied$
BEGIN
 BEGIN
  PERFORM public.catalogo_asaas_preflight_sessao_revisor_inerte();
  RAISE EXCEPTION 'authenticated consegue invocar preflight RPC';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  PERFORM catalogo_private.catalogo_asaas_ler_sessao_fator_auth_inerte(
   'a0010000-0000-4000-8000-000000000003'::uuid);
  RAISE EXCEPTION 'authenticated consegue ler auth.sessions';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $call_denied$;
RESET ROLE;

DO $owner$
DECLARE
 v_user uuid:='a0010000-0000-4000-8000-000000000001'::uuid;
 v_other uuid:='a0010000-0000-4000-8000-000000000002'::uuid;
 v_sid uuid:='a0010000-0000-4000-8000-000000000003'::uuid;
 v_factor uuid:='a0010000-0000-4000-8000-000000000004'::uuid;
 v_result jsonb;
 v_exp bigint;
BEGIN
 INSERT INTO auth.users(id) VALUES(v_user),(v_other);
 INSERT INTO auth.sessions(id,user_id,aal,factor_id,not_after)
 VALUES(v_sid,v_user,'aal2',v_factor,now()+interval '30 minutes');
 -- Uma sessao AAL2 em auth.sessions sem fator registrado nao basta.
 SELECT catalogo_private.catalogo_asaas_ler_sessao_fator_auth_inerte(v_sid)
 INTO v_result;
 IF v_result IS NOT NULL THEN
  RAISE EXCEPTION 'Sessao sem MFA verificado passou no leitor: %',v_result;
 END IF;
 INSERT INTO auth.mfa_factors(id,user_id,factor_type,status)
 VALUES(v_factor,v_user,'totp','unverified');
 SELECT catalogo_private.catalogo_asaas_ler_sessao_fator_auth_inerte(v_sid)
 INTO v_result;
 IF v_result IS NOT NULL THEN
  RAISE EXCEPTION 'Fator TOTP unverified aceito';
 END IF;
 UPDATE auth.mfa_factors SET status='verified' WHERE id=v_factor;
 SELECT catalogo_private.catalogo_asaas_ler_sessao_fator_auth_inerte(v_sid)
 INTO v_result;
 IF v_result->>'id' IS DISTINCT FROM v_sid::text
  OR v_result->>'userId' IS DISTINCT FROM v_user::text
  OR v_result->>'aal' IS DISTINCT FROM 'aal2'
  OR v_result->>'factorId' IS DISTINCT FROM v_factor::text
  OR v_result->>'factorUserId' IS DISTINCT FROM v_user::text
  OR v_result->>'factorType' IS DISTINCT FROM 'totp'
  OR v_result->>'factorStatus' IS DISTINCT FROM 'verified'
  OR (v_result->>'notAfterMs')::bigint
     < (extract(epoch FROM now())*1000)::bigint
 THEN
  RAISE EXCEPTION 'Leitor auth.sessions nao retornou formato esperado: %',v_result;
 END IF;
 UPDATE auth.sessions SET aal='aal1' WHERE id=v_sid;
 IF catalogo_private.catalogo_asaas_ler_sessao_fator_auth_inerte(v_sid)
    IS NOT NULL THEN RAISE EXCEPTION 'Sessao AAL1 permitida'; END IF;
 UPDATE auth.sessions SET aal='aal2',not_after=now()-interval '10 seconds'
 WHERE id=v_sid;
 IF catalogo_private.catalogo_asaas_ler_sessao_fator_auth_inerte(v_sid)
    IS NOT NULL THEN RAISE EXCEPTION 'Sessao expirada permitida'; END IF;
 UPDATE auth.sessions SET not_after=now()+interval '30 minutes' WHERE id=v_sid;
 UPDATE auth.mfa_factors SET user_id=v_other WHERE id=v_factor;
 IF catalogo_private.catalogo_asaas_ler_sessao_fator_auth_inerte(v_sid)
    IS NOT NULL THEN RAISE EXCEPTION 'Fator pertence a outro usuario'; END IF;
 UPDATE auth.mfa_factors SET user_id=v_user, factor_type='phone'
 WHERE id=v_factor;
 IF catalogo_private.catalogo_asaas_ler_sessao_fator_auth_inerte(v_sid)
    IS NOT NULL THEN RAISE EXCEPTION 'Fator nao TOTP aceito'; END IF;
 UPDATE auth.mfa_factors SET factor_type='totp' WHERE id=v_factor;
 UPDATE auth.users SET banned_until=now()+interval '1 day'
 WHERE id=v_user;
 IF catalogo_private.catalogo_asaas_ler_sessao_fator_auth_inerte(v_sid)
    IS NOT NULL THEN RAISE EXCEPTION 'Usuario bloqueado teve sessao validada'; END IF;
 UPDATE auth.users SET banned_until=NULL WHERE id=v_user;
 DELETE FROM auth.sessions WHERE id=v_sid;
 IF catalogo_private.catalogo_asaas_ler_sessao_fator_auth_inerte(v_sid)
    IS NOT NULL THEN RAISE EXCEPTION 'Sessao revogada/ausente passou'; END IF;
 IF catalogo_private.catalogo_asaas_ler_sessao_fator_auth_inerte(NULL)
    IS NOT NULL THEN RAISE EXCEPTION 'Sessao nula passou'; END IF;
 RAISE NOTICE 'PASS: leitor owner-only consulta Auth ficticio, nega fator ausente, unverified, AAL1, vencido, cruzado, revogado e usuario banido';
END $owner$;
ROLLBACK;
