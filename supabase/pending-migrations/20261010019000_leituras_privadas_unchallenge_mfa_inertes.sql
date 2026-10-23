-- #42 | Ponte de LEITURA owner-only entre o livro de nonce e o
-- orquestrador MFA de CI. SEM Edge financeira, sem mfa.verify e sem PIX.
-- No STAGING, owner SQL apenas. Nenhum GRANT para Data API/service_role.
BEGIN;

-- Recupera exclusivamente o snapshot imutavel fixado por trigger na
-- migration 17000 e reservado no livro da migration 18000. Nao aceita
-- userId/factorId/hash/nonce fornecido pelo cliente, apenas contexto_id.
CREATE FUNCTION catalogo_private.catalogo_asaas_ler_contexto_prechallenge_inerte(
 p_contexto uuid
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $read_context$
DECLARE
 v_c public.catalogo_asaas_contextos_pre_mfa_inertes%ROWTYPE;
 v_r public.catalogo_asaas_reservas_prechallenge_compartilhadas_inertes%ROWTYPE;
BEGIN
 IF p_contexto IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO v_c FROM public.catalogo_asaas_contextos_pre_mfa_inertes
 WHERE id=p_contexto;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO v_r FROM public.catalogo_asaas_reservas_prechallenge_compartilhadas_inertes
 WHERE contexto_id=v_c.id;
 IF NOT FOUND OR v_r.expira_em<=pg_catalog.clock_timestamp()
  OR v_c.expira_em IS DISTINCT FROM v_r.expira_em
  OR NOT catalogo_private.catalogo_asaas_prechallenge_elegivel_inerte(v_c.id)
 THEN RETURN NULL; END IF;
 RETURN pg_catalog.jsonb_build_object(
  'id',v_c.id::text,
  'userId',v_c.revisor_id::text,
  'sessionId',v_c.sessao_id::text,
  'factorId',v_c.fator_id::text,
  'separationId',v_c.separacao_id::text,
  'evidenceHash',v_c.fingerprint_creditos_sha256,
  'expiresAt',(EXTRACT(EPOCH FROM v_r.expira_em)*1000)::bigint
 );
EXCEPTION WHEN OTHERS THEN
 -- Falhas de Auth/snapshot/leitura NUNCA retornam contexto.
 RETURN NULL;
END $read_context$;
REVOKE ALL ON FUNCTION
 catalogo_private.catalogo_asaas_ler_contexto_prechallenge_inerte(uuid)
 FROM PUBLIC,anon,authenticated,service_role;

-- Lookup interinstancias. Uma tentativa SO pode ser lida se ela foi
-- registrada por challenge e nao consumida nem expirada. Esta leitura
-- NAO significa que o challenge GoTrue foi criptograficamente verificado.
CREATE FUNCTION catalogo_private.catalogo_asaas_ler_tentativa_prechallenge_inerte(
 p_tentativa uuid
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $read_attempt$
DECLARE
 v_id uuid;
 v_nonce uuid;
 v_challenge uuid;
 v_contexto jsonb;
BEGIN
 IF p_tentativa IS NULL THEN RETURN NULL; END IF;
 SELECT r.contexto_id,r.nonce,d.challenge_id
  INTO v_id,v_nonce,v_challenge
 FROM public.catalogo_asaas_desafios_prechallenge_compartilhados_inertes d
 JOIN public.catalogo_asaas_reservas_prechallenge_compartilhadas_inertes r
   ON r.nonce=d.nonce
 WHERE d.tentativa=p_tentativa
  AND r.expira_em>pg_catalog.clock_timestamp()
  AND NOT EXISTS(
    SELECT 1 FROM public.catalogo_asaas_consumos_prechallenge_compartilhados_inertes used
    WHERE used.tentativa=d.tentativa OR used.nonce=d.nonce
     OR used.challenge_id=d.challenge_id
  );
 IF NOT FOUND THEN RETURN NULL; END IF;
 v_contexto:=catalogo_private.catalogo_asaas_ler_contexto_prechallenge_inerte(v_id);
 IF v_contexto IS NULL THEN RETURN NULL; END IF;
 RETURN pg_catalog.jsonb_build_object(
  'nonce',v_nonce::text,
  'tentativa',p_tentativa::text,
  'challengeId',v_challenge::text,
  'contexto',v_contexto
 );
EXCEPTION WHEN OTHERS THEN
 RETURN NULL;
END $read_attempt$;
REVOKE ALL ON FUNCTION
 catalogo_private.catalogo_asaas_ler_tentativa_prechallenge_inerte(uuid)
 FROM PUBLIC,anon,authenticated,service_role;

COMMENT ON FUNCTION
 catalogo_private.catalogo_asaas_ler_contexto_prechallenge_inerte(uuid)
 IS 'Somente owner: snapshot AAL1 do contexto ja reservado. Nao autoriza parecer, MFA real ou transferencia.';
COMMENT ON FUNCTION
 catalogo_private.catalogo_asaas_ler_tentativa_prechallenge_inerte(uuid)
 IS 'Somente owner: challenge nao consumido+contexto AAL1 vigente, sem OTP, JWT ou autorizacao financeira.';
COMMIT;
