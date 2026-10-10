-- Teste REAL PostgreSQL efemero, so com auth.jwt stub SEM assinatura.
-- Nunca rodar contra STAGING/PROD. BEGIN/ROLLBACK sem efeito persistente.
BEGIN;
DO $guard$
BEGIN
 IF pg_catalog.current_database()<>'catalogo_asaas_guards_ci'
  OR pg_catalog.current_setting('app.catalogo_ci_mfa_test',true)
    IS DISTINCT FROM 'enabled'
  OR pg_catalog.to_regclass('auth.sessions') IS NULL
  OR pg_catalog.to_regprocedure('public.catalogo_asaas_preflight_sessao_revisor_inerte()') IS NULL
 THEN
  RAISE EXCEPTION 'MFA SQL fixture deve usar banco CI descartavel e opt-in'
   USING ERRCODE='23514';
 END IF;
END $guard$;

INSERT INTO auth.users(id)
VALUES ('fa900000-0000-4000-8000-000000000001'::uuid),
 ('fa900000-0000-4000-8000-000000000002'::uuid);

-- Uma sessao AAL2 registrada no servidor CI, sem JWT autenticado na rede.
INSERT INTO auth.sessions(id,user_id,aal,factor_id,not_after)
VALUES ('fa900000-0000-4000-8000-000000000010'::uuid,
 'fa900000-0000-4000-8000-000000000001'::uuid,
 'aal2','fa900000-0000-4000-8000-000000000020'::uuid,
 now()+interval '3 hours');

DO $guard$
BEGIN
 IF has_function_privilege('anon',
  'public.catalogo_asaas_preflight_sessao_revisor_inerte()','EXECUTE')
 OR has_function_privilege('service_role',
  'public.catalogo_asaas_preflight_sessao_revisor_inerte()','EXECUTE')
 OR NOT has_function_privilege('authenticated',
  'public.catalogo_asaas_preflight_sessao_revisor_inerte()','EXECUTE')
 THEN RAISE EXCEPTION 'Preflight expos uso anonimo ou service role'; END IF;
END $guard$;

SET LOCAL ROLE authenticated;
DO $jwt_cases$
DECLARE
 v_uid text:='fa900000-0000-4000-8000-000000000001';
 v_sid text:='fa900000-0000-4000-8000-000000000010';
 v_now bigint:=(extract(epoch FROM now()))::bigint;
 v_claims jsonb;
 v_result jsonb;
BEGIN
 -- Nao ha JWT em nenhum request => nao informar ID nem habilitar.
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claims','',true);
 SELECT public.catalogo_asaas_preflight_sessao_revisor_inerte() INTO v_result;
 IF v_result->>'sessao_aal2_confirmada' IS DISTINCT FROM 'false'
  OR v_result->>'pagamento_autorizado' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Sessao sem JWT passou no preflight: %',v_result; END IF;

 PERFORM set_config('request.jwt.claim.sub',v_uid,true);
 v_claims:=jsonb_build_object(
  'sub',v_uid,'role','authenticated','aal','aal2',
  'session_id',v_sid,'iat',v_now,'exp',v_now+1800,'is_anonymous',false
 );
 PERFORM set_config('request.jwt.claims',v_claims::text,true);
 SELECT public.catalogo_asaas_preflight_sessao_revisor_inerte() INTO v_result;
 IF v_result->>'sessao_aal2_confirmada' IS DISTINCT FROM 'true'
  OR v_result->>'jwt_recente_confirmado' IS DISTINCT FROM 'true'
  OR v_result->>'indicacao_ensaio_vigente' IS DISTINCT FROM 'false'
  OR v_result->>'mfa_com_desafio_recente_comprovado' IS DISTINCT FROM 'false'
  OR v_result->>'apto_a_registrar_parecer' IS DISTINCT FROM 'false'
  OR v_result->>'pagamento_autorizado' IS DISTINCT FROM 'false'
  OR v_result->>'status_operacional' IS DISTINCT FROM 'HOLD_OBRIGATORIO'
 THEN RAISE EXCEPTION 'Preflight AAL2 nao deveria significar autorizacao: %',v_result; END IF;

 PERFORM set_config('request.jwt.claims',
  (v_claims||jsonb_build_object('aal','aal1'))::text,true);
 SELECT public.catalogo_asaas_preflight_sessao_revisor_inerte() INTO v_result;
 IF v_result->>'sessao_aal2_confirmada' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'AAL1 aceito'; END IF;

 PERFORM set_config('request.jwt.claims',
  (v_claims||jsonb_build_object('iat',v_now-3600))::text,true);
 SELECT public.catalogo_asaas_preflight_sessao_revisor_inerte() INTO v_result;
 IF v_result->>'sessao_aal2_confirmada' IS DISTINCT FROM 'false'
 OR v_result->>'jwt_recente_confirmado' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'JWT antigo aceito'; END IF;

 PERFORM set_config('request.jwt.claims',
  (v_claims||jsonb_build_object('sub','fa900000-0000-4000-8000-000000000002'))::text,true);
 SELECT public.catalogo_asaas_preflight_sessao_revisor_inerte() INTO v_result;
 IF v_result->>'sessao_aal2_confirmada' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'JWT de outro usuario aceito'; END IF;

 PERFORM set_config('request.jwt.claims',
  (v_claims||jsonb_build_object('is_anonymous',true))::text,true);
 SELECT public.catalogo_asaas_preflight_sessao_revisor_inerte() INTO v_result;
 IF v_result->>'sessao_aal2_confirmada' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Identidade anonima aceitou revisao AAL2'; END IF;

 PERFORM set_config('request.jwt.claims',
  (v_claims||jsonb_build_object('session_id','fa900000-0000-4000-8000-000000000099'))::text,true);
 SELECT public.catalogo_asaas_preflight_sessao_revisor_inerte() INTO v_result;
 IF v_result->>'sessao_aal2_confirmada' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Sessao inexistente aceita'; END IF;

 PERFORM set_config('request.jwt.claims',v_claims::text,true);
 RAISE NOTICE 'PASS: Auth preflight self-only rejeitou AAL1, stale, anon, session inexistente, mismatch';
END $jwt_cases$;
RESET ROLE;

-- MFA verified_at vem por FATOR, nao por sessao. Outro usuario
-- nao pode satisfazer o fator registrado na sessao do revisor.
INSERT INTO auth.mfa_factors(id,user_id,factor_type,status)
VALUES
 ('fa900000-0000-4000-8000-000000000020'::uuid,
  'fa900000-0000-4000-8000-000000000001'::uuid,'totp','verified'),
 ('fa900000-0000-4000-8000-000000000021'::uuid,
  'fa900000-0000-4000-8000-000000000002'::uuid,'totp','verified');
INSERT INTO auth.mfa_challenges(id,factor_id,created_at,verified_at)
VALUES
 ('fa900000-0000-4000-8000-000000000031'::uuid,
  'fa900000-0000-4000-8000-000000000021'::uuid,
  now()-interval '2 minutes',now()-interval '10 seconds');

SET LOCAL ROLE authenticated;
DO $wrong_user_challenge$
DECLARE
 v_n bigint:=(extract(epoch FROM now()))::bigint;
 v_r jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claim.sub',
  'fa900000-0000-4000-8000-000000000001',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object(
  'sub','fa900000-0000-4000-8000-000000000001',
  'role','authenticated','aal','aal2',
  'session_id','fa900000-0000-4000-8000-000000000010',
  'iat',v_n,'exp',v_n+1800,'is_anonymous',false
 )::text,true);
 SELECT public.catalogo_asaas_preflight_sessao_revisor_inerte() INTO v_r;
 IF v_r->>'desafio_recente_observado_no_fator_sem_vinculo_sessao'
    IS DISTINCT FROM 'false'
  OR v_r->>'pagamento_autorizado' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Desafio MFA de outro usuario aceito: %',v_r; END IF;
END $wrong_user_challenge$;
RESET ROLE;

INSERT INTO auth.mfa_challenges(id,factor_id,created_at,verified_at)
VALUES
 ('fa900000-0000-4000-8000-000000000032'::uuid,
  'fa900000-0000-4000-8000-000000000020'::uuid,
  now()-interval '2 minutes',now()-interval '10 seconds');

SET LOCAL ROLE authenticated;
DO $mfa_recent_factor$
DECLARE
 v_n bigint:=(extract(epoch FROM now()))::bigint;
 v_r jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claim.sub',
  'fa900000-0000-4000-8000-000000000001',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object(
  'sub','fa900000-0000-4000-8000-000000000001',
  'role','authenticated','aal','aal2',
  'session_id','fa900000-0000-4000-8000-000000000010',
  'iat',v_n,'exp',v_n+1800,'is_anonymous',false
 )::text,true);
 SELECT public.catalogo_asaas_preflight_sessao_revisor_inerte() INTO v_r;
 IF v_r->>'desafio_recente_observado_no_fator_sem_vinculo_sessao'
    IS DISTINCT FROM 'true'
  OR v_r->>'desafio_recente_comprovado_na_sessao_atual'
    IS DISTINCT FROM 'false'
  OR v_r->>'mfa_com_desafio_recente_comprovado'
    IS DISTINCT FROM 'false'
  OR v_r->>'apto_a_registrar_parecer' IS DISTINCT FROM 'false'
  OR v_r->>'pagamento_autorizado' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Challenge verificado no fator autorizou indevidamente: %',v_r; END IF;
 RAISE NOTICE 'PASS: verified_at de factor recente e observavel, nao prova session_id nem libera Pix';
END $mfa_recent_factor$;
RESET ROLE;

-- Mesmo fator, mas prova fora da janela: um JWT recem-renovado nao altera isso.
UPDATE auth.mfa_challenges SET verified_at=now()-interval '15 minutes'
WHERE id='fa900000-0000-4000-8000-000000000032'::uuid;
SET LOCAL ROLE authenticated;
DO $mfa_stale$
DECLARE
 v_n bigint:=(extract(epoch FROM now()))::bigint;
 v_r jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claim.sub',
  'fa900000-0000-4000-8000-000000000001',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object(
  'sub','fa900000-0000-4000-8000-000000000001',
  'role','authenticated','aal','aal2',
  'session_id','fa900000-0000-4000-8000-000000000010',
  'iat',v_n,'exp',v_n+1800,'is_anonymous',false
 )::text,true);
 SELECT public.catalogo_asaas_preflight_sessao_revisor_inerte() INTO v_r;
 IF v_r->>'desafio_recente_observado_no_fator_sem_vinculo_sessao'
    IS DISTINCT FROM 'false'
  OR v_r->>'pagamento_autorizado' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Challenge MFA antigo aceito por JWT renovado: %',v_r; END IF;
END $mfa_stale$;
RESET ROLE;

-- Revisor da propria sessao indicado SOMENTE no CI, continua SEM poder financeiro.
INSERT INTO public.catalogo_asaas_revisores_escrow_ensaio(
 revisor_id,indicado_por,justificativa,instrumento_sha256,cadastrado_em,valido_ate
) VALUES('fa900000-0000-4000-8000-000000000001'::uuid,
 'fa900000-0000-4000-8000-000000000002'::uuid,
 'Indicacao ficticia para demonstrar revogacao do preflight MFA sem aprovar Pix.',
 repeat('a',64),now(),now()+interval '30 days');

SET LOCAL ROLE authenticated;
DO $active$
DECLARE
 v_now bigint:=(extract(epoch FROM now()))::bigint;
 v_result jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claim.sub',
   'fa900000-0000-4000-8000-000000000001',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object(
   'sub','fa900000-0000-4000-8000-000000000001',
   'role','authenticated','aal','aal2',
   'session_id','fa900000-0000-4000-8000-000000000010',
   'iat',v_now,'exp',v_now+1800,'is_anonymous',false
 )::text,true);
 SELECT public.catalogo_asaas_preflight_sessao_revisor_inerte() INTO v_result;
 IF v_result->>'indicacao_ensaio_vigente' IS DISTINCT FROM 'true'
  OR v_result->>'sessao_aal2_confirmada' IS DISTINCT FROM 'true'
  OR v_result->>'apto_a_registrar_parecer' IS DISTINCT FROM 'false'
  OR v_result->>'mfa_com_desafio_recente_comprovado' IS DISTINCT FROM 'false'
  OR v_result->>'pagamento_autorizado' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Indicacao de laboratorio virou autoridade: %',v_result; END IF;
END $active$;
RESET ROLE;

INSERT INTO public.catalogo_asaas_revisores_escrow_revogacoes_ensaio(
 revisor_id,revogado_por,motivo,revogado_em)
VALUES('fa900000-0000-4000-8000-000000000001'::uuid,
 'fa900000-0000-4000-8000-000000000002'::uuid,
 'Revogacao ficticia de laboratorio que deve retirar indicacao vigente no preflight.',
 now()-interval '20 years');

SET LOCAL ROLE authenticated;
DO $revoked$
DECLARE
 v_now bigint:=(extract(epoch FROM now()))::bigint;
 v_result jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claim.sub',
   'fa900000-0000-4000-8000-000000000001',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object(
   'sub','fa900000-0000-4000-8000-000000000001',
   'role','authenticated','aal','aal2',
   'session_id','fa900000-0000-4000-8000-000000000010',
   'iat',v_now,'exp',v_now+1800,'is_anonymous',false
 )::text,true);
 SELECT public.catalogo_asaas_preflight_sessao_revisor_inerte() INTO v_result;
 IF v_result->>'indicacao_ensaio_vigente' IS DISTINCT FROM 'false'
  OR v_result->>'sessao_aal2_confirmada' IS DISTINCT FROM 'true'
  OR v_result->>'pagamento_autorizado' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Revogacao nao invalidou elegibilidade: %',v_result; END IF;
 RAISE NOTICE 'PASS: revogacao derruba indicacao com JWT AAL2 ainda valido; zero Pix';
END $revoked$;
RESET ROLE;
ROLLBACK;
