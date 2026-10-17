-- Teste Auth fake local de fase prechallenge: proibido em STAGING/PROD.
-- Banco descartavel com transacao ROLLBACK, opt-in explicito.
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'catalogo_asaas_guards_ci'
  OR current_setting('app.catalogo_ci_mfa_test',true) IS DISTINCT FROM 'enabled'
  OR to_regprocedure('catalogo_private.catalogo_asaas_ler_sessao_aal1_inerte(uuid)') IS NULL
 THEN RAISE EXCEPTION 'AAL1 SQL tests require explicit ephemeral CI DB'; END IF;
 IF has_function_privilege('anon',
    'catalogo_private.catalogo_asaas_ler_sessao_aal1_inerte(uuid)','EXECUTE')
   OR has_function_privilege('authenticated',
    'catalogo_private.catalogo_asaas_ler_sessao_aal1_inerte(uuid)','EXECUTE')
   OR has_function_privilege('service_role',
    'catalogo_private.catalogo_asaas_ler_sessao_aal1_inerte(uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Sessao AAL1 foi exposta aos usuarios'; END IF;
END $guard$;

SET LOCAL ROLE authenticated;
DO $deny$
BEGIN
 BEGIN
  PERFORM catalogo_private.catalogo_asaas_ler_sessao_aal1_inerte(
   'fae10000-0000-4000-8000-000000000003'::uuid);
  RAISE EXCEPTION 'authenticated obteve acesso ao leitor AAL1 privado';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $deny$;
RESET ROLE;

DO $test$
DECLARE
 v_uid uuid:='fae10000-0000-4000-8000-000000000001';
 v_other uuid:='fae10000-0000-4000-8000-000000000002';
 v_sid uuid:='fae10000-0000-4000-8000-000000000003';
 v_fid uuid:='fae10000-0000-4000-8000-000000000004';
 v_r jsonb;
BEGIN
 INSERT INTO auth.users(id) VALUES(v_uid),(v_other);
 INSERT INTO auth.sessions(id,user_id,aal,factor_id,not_after)
 VALUES(v_sid,v_uid,'aal1',NULL,now()+interval '30 minutes');
 SELECT catalogo_private.catalogo_asaas_ler_sessao_aal1_inerte(v_sid)
 INTO v_r;
 IF v_r->>'id' IS DISTINCT FROM v_sid::text
  OR v_r->>'userId' IS DISTINCT FROM v_uid::text
  OR v_r->>'aal' IS DISTINCT FROM 'aal1'
  OR v_r->>'usuarioBloqueado' IS DISTINCT FROM 'false'
  OR (v_r->>'notAfterMs')::bigint <=
     (extract(epoch FROM now())*1000)::bigint
 THEN RAISE EXCEPTION 'AAL1 basico valido recusado: %',v_r; END IF;
 IF v_r ? 'factorId' OR v_r ? 'factorUserId' OR v_r ? 'factorStatus'
 THEN RAISE EXCEPTION 'Leitor AAL1 declarou falso fator validado: %',v_r; END IF;

 UPDATE auth.sessions SET factor_id=v_fid WHERE id=v_sid;
 IF catalogo_private.catalogo_asaas_ler_sessao_aal1_inerte(v_sid)
 IS NOT NULL THEN RAISE EXCEPTION 'Fator associado antes de AAL2'; END IF;

 UPDATE auth.sessions SET factor_id=NULL,aal='aal2' WHERE id=v_sid;
 IF catalogo_private.catalogo_asaas_ler_sessao_aal1_inerte(v_sid)
 IS NOT NULL THEN RAISE EXCEPTION 'Sessao AAL2 passou por porta AAL1'; END IF;

 UPDATE auth.sessions SET aal='aal1',not_after=now()-interval '1 minute'
 WHERE id=v_sid;
 IF catalogo_private.catalogo_asaas_ler_sessao_aal1_inerte(v_sid)
 IS NOT NULL THEN RAISE EXCEPTION 'Sessao AAL1 expirada foi aceita'; END IF;

 UPDATE auth.sessions SET not_after=now()+interval '30 minutes' WHERE id=v_sid;
 UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=v_uid;
 IF catalogo_private.catalogo_asaas_ler_sessao_aal1_inerte(v_sid)
 IS NOT NULL THEN RAISE EXCEPTION 'Usuario banido foi aceito para challenge'; END IF;
 UPDATE auth.users SET banned_until=NULL WHERE id=v_uid;
 DELETE FROM auth.sessions WHERE id=v_sid;
 IF catalogo_private.catalogo_asaas_ler_sessao_aal1_inerte(v_sid)
 IS NOT NULL THEN RAISE EXCEPTION 'Sessao revogada AAL1 passou'; END IF;
 IF catalogo_private.catalogo_asaas_ler_sessao_aal1_inerte(NULL)
 IS NOT NULL THEN RAISE EXCEPTION 'Sessao NULL foi aceita'; END IF;
 RAISE NOTICE 'PASS: AAL1 owner-only nao afirma MFA e nega sessao revogada, banida, vencida, AAL2 e fator incoerente';
END $test$;
ROLLBACK;
