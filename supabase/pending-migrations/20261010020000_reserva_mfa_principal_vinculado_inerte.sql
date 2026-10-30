-- #42 | Reserva documental estritamente vinculada ao principal Auth AAL1.
-- O nonce original segue OWNER-ONLY. Nenhum GRANT a API/Edge/service_role.
-- p_usuario e p_sessao DEVEM vir de JWT ASSINADO e sessao Auth consultada
-- por backend privado, NUNCA de parametros do browser. Funcao nao autentica.
-- Apenas melhora a vinculacao previa e reduz risco de queima de contexto.
-- Mantem todas as negacoes financeiras: HARD HOLD, sem Pix/MFA real.
BEGIN;

CREATE FUNCTION catalogo_private.catalogo_asaas_reservar_inicio_principal_vinculado_inerte(
 p_contexto uuid, p_usuario uuid, p_sessao uuid
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $bound$
DECLARE
 v_c public.catalogo_asaas_contextos_pre_mfa_inertes%ROWTYPE;
BEGIN
 IF p_contexto IS NULL OR p_usuario IS NULL OR p_sessao IS NULL THEN
  RETURN catalogo_private.catalogo_asaas_resposta_prechallenge_compartilhada_inerte(
   false,'principal_ou_contexto_invalido');
 END IF;
 -- O lock protege o contexto antes da verificacao e da chamada à
 -- reserva original, na MESMA transacao. Quem nao e revisor nao insere nonce.
 SELECT * INTO v_c FROM public.catalogo_asaas_contextos_pre_mfa_inertes
 WHERE id=p_contexto FOR UPDATE;
 IF NOT FOUND OR v_c.revisor_id IS DISTINCT FROM p_usuario
  OR v_c.sessao_id IS DISTINCT FROM p_sessao THEN
  RETURN catalogo_private.catalogo_asaas_resposta_prechallenge_compartilhada_inerte(
   false,'principal_ou_contexto_divergente');
 END IF;
 -- A funcao original verifica novamente escrows, TOTP, sessao AAL1 e expira.
 RETURN catalogo_private.catalogo_asaas_reservar_inicio_compartilhado_inerte(
  p_contexto);
END $bound$;
REVOKE ALL ON FUNCTION
 catalogo_private.catalogo_asaas_reservar_inicio_principal_vinculado_inerte(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;

COMMENT ON FUNCTION
 catalogo_private.catalogo_asaas_reservar_inicio_principal_vinculado_inerte(uuid,uuid,uuid)
 IS 'CI owner-only: recusa reserva por principal/sessao divergentes antes de gerar nonce; parametros so de backend JWT assinado; sem MFA real e sem Pix.';
COMMIT;
