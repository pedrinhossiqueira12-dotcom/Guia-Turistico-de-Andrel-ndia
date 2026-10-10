-- #42 | Ponte NOLOGIN para prechallenge exclusivamente em DB CI descartavel.
-- Nao abre Data API, nao testa senha/conexao real, nao faz Pix.
BEGIN;

DO $preflight$
DECLARE v_role record;
BEGIN
 IF current_database()<>'catalogo_asaas_guards_ci'
   OR current_setting('app.catalogo_ci_mfa_test',true) IS DISTINCT FROM 'enabled'
 THEN RAISE EXCEPTION 'Ponte MFA: SQL nao esta em clone CI autorizado'; END IF;
 SELECT rolcanlogin,rolsuper,rolinherit,rolcreatedb,rolcreaterole,
        rolreplication,rolbypassrls
 INTO v_role
 FROM pg_catalog.pg_roles WHERE rolname='catalogo_mfa_ponte_ci_inerte';
 IF NOT FOUND OR v_role.rolcanlogin OR v_role.rolsuper OR v_role.rolinherit
   OR v_role.rolcreatedb OR v_role.rolcreaterole OR v_role.rolreplication
   OR v_role.rolbypassrls
 THEN RAISE EXCEPTION 'Ponte MFA nao e NOLOGIN sem privilegios'; END IF;

 IF NOT has_schema_privilege('catalogo_mfa_ponte_ci_inerte',
       'catalogo_private','USAGE')
   OR has_table_privilege('catalogo_mfa_ponte_ci_inerte',
       'auth.users','SELECT')
   OR has_table_privilege('catalogo_mfa_ponte_ci_inerte',
       'public.catalogo_asaas_desafios_prechallenge_compartilhados_inertes','INSERT')
   OR has_table_privilege('catalogo_mfa_ponte_ci_inerte',
       'public.catalogo_asaas_consumos_prechallenge_compartilhados_inertes','DELETE')
 THEN RAISE EXCEPTION 'Ponte MFA ganhou privilegio de tabela bruta'; END IF;

 IF EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m
  JOIN pg_catalog.pg_roles member ON member.oid=m.member
  JOIN pg_catalog.pg_roles target ON target.oid=m.roleid
  WHERE target.rolname='catalogo_mfa_ponte_ci_inerte'
   AND member.rolname IN('anon','authenticated','service_role','authenticator'))
 THEN RAISE EXCEPTION 'Data API ganhou papel MFA por membership'; END IF;

 IF (SELECT count(*) FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace ns ON ns.oid=p.pronamespace
  WHERE ns.nspname='catalogo_private'
   AND p.proname LIKE 'catalogo_asaas_ponte_%_inerte'
   AND p.prosecdef AND p.provolatile='v'
   AND p.proconfig @> ARRAY['search_path=']::text[])<>5
 THEN RAISE EXCEPTION 'A ponte MFA nao tem 5 wrappers DEFINER seguros'; END IF;
END $preflight$;

-- Testar invocacao real com SET ROLE, NAO autenticacao externa.
SET LOCAL ROLE catalogo_mfa_ponte_ci_inerte;
DO $bridge_role$
DECLARE v_resp jsonb; v_contexto jsonb;
BEGIN
 v_resp:=catalogo_private.catalogo_asaas_ponte_reservar_principal_inerte(
  NULL,NULL,NULL);
 IF v_resp->>'ok' IS DISTINCT FROM 'false'
  OR v_resp->>'motivo' IS DISTINCT FROM 'principal_ou_contexto_invalido'
  OR v_resp->>'status_operacional' IS DISTINCT FROM 'HOLD_OBRIGATORIO'
  OR v_resp->>'pagamento_autorizado' IS DISTINCT FROM 'false'
  OR v_resp->>'pode_registrar_parecer' IS DISTINCT FROM 'false'
  OR v_resp->>'movimenta_dinheiro' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Ponte NOLOGIN liberou estado financeiro: %',v_resp; END IF;

 v_resp:=catalogo_private.catalogo_asaas_ponte_reservar_principal_inerte(
  '11111111-1111-4111-8111-111111111111'::uuid,
  '22222222-2222-4222-8222-222222222222'::uuid,
  '33333333-3333-4333-8333-333333333333'::uuid);
 IF v_resp->>'ok' IS DISTINCT FROM 'false'
  OR v_resp->>'motivo' IS DISTINCT FROM 'principal_ou_contexto_divergente'
 THEN RAISE EXCEPTION 'Ponte aceitou contexto alheio: %',v_resp; END IF;

 v_contexto:=catalogo_private.catalogo_asaas_ponte_ler_contexto_inerte(
  '11111111-1111-4111-8111-111111111111'::uuid);
 IF v_contexto IS NOT NULL THEN
  RAISE EXCEPTION 'Ponte leu contexto sem reserva'; END IF;

 v_contexto:=catalogo_private.catalogo_asaas_ponte_ler_tentativa_inerte(
  '44444444-4444-4444-8444-444444444444'::uuid);
 IF v_contexto IS NOT NULL THEN
  RAISE EXCEPTION 'Ponte leu tentativa alheia'; END IF;

 v_resp:=catalogo_private.catalogo_asaas_ponte_registrar_desafio_inerte(
  '55555555-5555-4555-8555-555555555555'::uuid,
  '66666666-6666-4666-8666-666666666666'::uuid,
  '77777777-7777-4777-8777-777777777777'::uuid);
 IF v_resp->>'ok' IS DISTINCT FROM 'false'
  OR v_resp->>'pagamento_autorizado' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Ponte registrou challenge sem reserva: %',v_resp; END IF;

 v_resp:=catalogo_private.catalogo_asaas_ponte_consumir_desafio_inerte(
  '55555555-5555-4555-8555-555555555555'::uuid,
  '66666666-6666-4666-8666-666666666666'::uuid,
  '77777777-7777-4777-8777-777777777777'::uuid);
 IF v_resp->>'ok' IS DISTINCT FROM 'false'
  OR v_resp->>'movimenta_dinheiro' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'Ponte consumiu challenge nao registrado: %',v_resp; END IF;

 BEGIN
  PERFORM catalogo_private.catalogo_asaas_reservar_inicio_principal_vinculado_inerte(
    NULL,NULL,NULL);
  RAISE EXCEPTION 'Ponte ganhou acesso direto a funcao owner';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  PERFORM 1 FROM public.catalogo_asaas_reservas_prechallenge_compartilhadas_inertes;
  RAISE EXCEPTION 'Ponte ganhou acesso direto a tabela';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $bridge_role$;
RESET ROLE;

DO $deny_public$
DECLARE vfn text; v_role text;
BEGIN
 FOR vfn IN
  SELECT p.oid::pg_catalog.regprocedure::text FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace ns ON ns.oid=p.pronamespace
  WHERE ns.nspname='catalogo_private'
   AND p.proname LIKE 'catalogo_asaas_ponte_%_inerte'
 LOOP
  IF NOT has_function_privilege('catalogo_mfa_ponte_ci_inerte',vfn,'EXECUTE')
  THEN RAISE EXCEPTION 'Papel NOLOGIN nao pode executar: %',vfn; END IF;
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   IF has_function_privilege(v_role,vfn,'EXECUTE')
   THEN RAISE EXCEPTION '% ganhou ponte privada %',v_role,vfn; END IF;
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.catalogo_asaas_reservas_prechallenge_compartilhadas_inertes)
 THEN RAISE EXCEPTION 'Ponte bloqueada gravou nonce'; END IF;
 IF EXISTS(SELECT 1 FROM public.catalogo_asaas_desafios_prechallenge_compartilhados_inertes)
 THEN RAISE EXCEPTION 'Ponte bloqueada gravou challenge'; END IF;
 IF EXISTS(SELECT 1 FROM public.catalogo_asaas_consumos_prechallenge_compartilhados_inertes)
 THEN RAISE EXCEPTION 'Ponte bloqueada consumiu OTP'; END IF;
 RAISE NOTICE 'PASS: NOLOGIN, 5 wrappers, raw tables/private funcs negadas, HOLD, sem nonce ou Pix';
END $deny_public$;
ROLLBACK;
