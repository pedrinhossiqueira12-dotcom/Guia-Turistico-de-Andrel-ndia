-- #42 — contrato factor ownership fake Auth, disposable PostgreSQL only.
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'catalogo_asaas_guards_ci'
  OR current_setting('app.catalogo_ci_mfa_test',true) IS DISTINCT FROM 'enabled'
  OR to_regprocedure(
    'catalogo_private.catalogo_asaas_checar_fator_totp_aal1_inerte(uuid,uuid)'
   ) IS NULL
 THEN RAISE EXCEPTION 'Preflight factor tests somente DB de CI descartavel'; END IF;
 IF has_function_privilege('anon',
    'catalogo_private.catalogo_asaas_checar_fator_totp_aal1_inerte(uuid,uuid)','EXECUTE')
  OR has_function_privilege('authenticated',
    'catalogo_private.catalogo_asaas_checar_fator_totp_aal1_inerte(uuid,uuid)','EXECUTE')
  OR has_function_privilege('service_role',
    'catalogo_private.catalogo_asaas_checar_fator_totp_aal1_inerte(uuid,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Preflight de fator exposto a Data API'; END IF;
END $guard$;
SET LOCAL ROLE authenticated;
DO $deny$
BEGIN
 BEGIN
  PERFORM catalogo_private.catalogo_asaas_checar_fator_totp_aal1_inerte(
   'fac10000-0000-4000-8000-000000000003'::uuid,
   'fac10000-0000-4000-8000-000000000004'::uuid
  );
  RAISE EXCEPTION 'authenticated le fator TOTP por funcao privada';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $deny$;
RESET ROLE;

DO $owner$
DECLARE
 v_uid uuid:='fac10000-0000-4000-8000-000000000001';
 v_other uuid:='fac10000-0000-4000-8000-000000000002';
 v_sid uuid:='fac10000-0000-4000-8000-000000000003';
 v_factor uuid:='fac10000-0000-4000-8000-000000000004';
 v_other_factor uuid:='fac10000-0000-4000-8000-000000000005';
 v_result jsonb;
BEGIN
 INSERT INTO auth.users(id) VALUES(v_uid),(v_other);
 INSERT INTO auth.sessions(id,user_id,aal,factor_id,not_after)
 VALUES(v_sid,v_uid,'aal1',NULL,now()+interval '30 minutes');
 INSERT INTO auth.mfa_factors(id,user_id,factor_type,status)
 VALUES(v_factor,v_uid,'totp','verified'),
       (v_other_factor,v_other,'totp','verified');

 SELECT catalogo_private.catalogo_asaas_checar_fator_totp_aal1_inerte(
   v_sid,v_factor) INTO v_result;
 IF v_result->>'elegivel' IS DISTINCT FROM 'true'
  OR v_result->>'userId' IS DISTINCT FROM v_uid::text
  OR v_result->>'sessionId' IS DISTINCT FROM v_sid::text
  OR v_result->>'factorId' IS DISTINCT FROM v_factor::text
  OR v_result->>'mfa_ja_verificado' IS DISTINCT FROM 'false'
  OR v_result->>'desafio_ja_emitido' IS DISTINCT FROM 'false'
  OR v_result->>'pagamento_autorizado' IS DISTINCT FROM 'false'
  OR v_result->>'status_operacional' IS DISTINCT FROM 'HOLD_OBRIGATORIO'
 THEN RAISE EXCEPTION 'Preflight marcou TOTP incorretamente: %',v_result; END IF;

 SELECT catalogo_private.catalogo_asaas_checar_fator_totp_aal1_inerte(
   v_sid,v_other_factor) INTO v_result;
 IF v_result->>'elegivel' IS DISTINCT FROM 'false'
  OR v_result ? 'userId' OR v_result ? 'factorId'
 THEN RAISE EXCEPTION 'Fator de outro usuario passou ou vazou ID'; END IF;

 SELECT catalogo_private.catalogo_asaas_checar_fator_totp_aal1_inerte(
   v_sid,NULL) INTO v_result;
 IF v_result->>'elegivel' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Fator NULL passou'; END IF;

 UPDATE auth.mfa_factors SET status='unverified' WHERE id=v_factor;
 IF (catalogo_private.catalogo_asaas_checar_fator_totp_aal1_inerte(
   v_sid,v_factor)->>'elegivel') IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'TOTP unverified passou'; END IF;

 UPDATE auth.mfa_factors SET status='verified',factor_type='phone'
 WHERE id=v_factor;
 IF (catalogo_private.catalogo_asaas_checar_fator_totp_aal1_inerte(
   v_sid,v_factor)->>'elegivel') IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Fator SMS/phone passou'; END IF;

 UPDATE auth.mfa_factors SET factor_type='totp' WHERE id=v_factor;
 UPDATE auth.sessions SET aal='aal2' WHERE id=v_sid;
 IF (catalogo_private.catalogo_asaas_checar_fator_totp_aal1_inerte(
   v_sid,v_factor)->>'elegivel') IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Porta prechallenge aceitou AAL2'; END IF;

 UPDATE auth.sessions SET aal='aal1',factor_id=v_factor WHERE id=v_sid;
 IF (catalogo_private.catalogo_asaas_checar_fator_totp_aal1_inerte(
   v_sid,v_factor)->>'elegivel') IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Sessao AAL1 com factor_id associado passou'; END IF;

 UPDATE auth.sessions SET factor_id=NULL,not_after=now()-interval '1 minute'
 WHERE id=v_sid;
 IF (catalogo_private.catalogo_asaas_checar_fator_totp_aal1_inerte(
   v_sid,v_factor)->>'elegivel') IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Sessao expirada AAL1 passou'; END IF;

 UPDATE auth.sessions SET not_after=now()+interval '30 minutes' WHERE id=v_sid;
 UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=v_uid;
 IF (catalogo_private.catalogo_asaas_checar_fator_totp_aal1_inerte(
   v_sid,v_factor)->>'elegivel') IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Usuario banido passou'; END IF;

 UPDATE auth.users SET banned_until=NULL WHERE id=v_uid;
 DELETE FROM auth.sessions WHERE id=v_sid;
 IF (catalogo_private.catalogo_asaas_checar_fator_totp_aal1_inerte(
   v_sid,v_factor)->>'elegivel') IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Sessao revogada passou'; END IF;
 RAISE NOTICE 'PASS: TOTP owner-only exige mesmo uid/AAL1/fator verificado, nega terceiro, revogacao, phone, banimento, vencimento, zero Pix';
END $owner$;
ROLLBACK;
