-- Revalidacao FINANCEIRA de webhook de autorizacao, inclusive decisoes
-- antigas. Uma decisao APPROVED armazenada jamais ignora hold posterior.
-- Nao transfere valores, nao libera credito, nao atualiza repasses.
-- Requer migrations de pedidos excepcionais e trilha de evidencia.
BEGIN;

CREATE OR REPLACE FUNCTION public.catalogo_asaas_validar_reserva_saque(p_saque uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $verify$
DECLARE
 v_saque public.catalogo_asaas_saques%ROWTYPE;
 v_qtd bigint;
 v_ativos bigint;
 v_total bigint;
 v_elegiveis boolean;
 v_bloqueio boolean;
 v_perfil_apto boolean;
BEGIN
 SELECT * INTO v_saque
 FROM public.catalogo_asaas_saques WHERE id=p_saque;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Saque não encontrado.');
 END IF;

 -- Unica instrução SQL: os três controles são avaliados no banco,
 -- sem paginação de PostgREST ou confiança em dados do webhook.
 SELECT EXISTS (
   SELECT 1 FROM public.catalogo_asaas_saldos_residuais r
   WHERE r.motoboy_id=v_saque.motoboy_id
    AND r.status IN ('pendente','em_analise')
 ) OR EXISTS (
   SELECT 1 FROM public.catalogo_asaas_regularizacoes_inativos s
   WHERE s.motoboy_id=v_saque.motoboy_id
    AND s.status IN ('pendente','em_analise')
 ) OR EXISTS (
   SELECT 1 FROM public.catalogo_asaas_transferencias_excepcionais_auditoria e
   WHERE e.motoboy_id=v_saque.motoboy_id
 )
 INTO v_bloqueio;

 -- Uma aprovacao antiga nao permite pagar um motoboy suspenso, inativo,
 -- com perfil em analise ou chave Pix em investigacao.
 SELECT EXISTS (
   SELECT 1 FROM public.catalogo_motoboy_perfis perfil
   WHERE perfil.usuario_id=v_saque.motoboy_id
    AND perfil.apto AND NOT perfil.em_analise
 ) AND EXISTS (
   SELECT 1 FROM public.catalogo_motoboys m
   WHERE m.usuario_id=v_saque.motoboy_id AND m.ativo
 ) INTO v_perfil_apto;

 SELECT count(*),count(*) FILTER (WHERE i.ativo),
  coalesce(sum(r.valor_centavos::bigint) FILTER (WHERE i.ativo),0),
  coalesce(bool_and(
   i.ativo AND r.motoboy_id=v_saque.motoboy_id
   AND r.status='disponivel' AND r.financiamento_comprovado
   AND r.repasse_id IS NULL AND r.valor_centavos>0
   AND catalogo_private.catalogo_v2_financiado(r.pedido_id)
  ),false)
 INTO v_qtd,v_ativos,v_total,v_elegiveis
 FROM public.catalogo_asaas_saque_itens i
 JOIN public.catalogo_remuneracoes_v2 r ON r.id=i.remuneracao_id
 WHERE i.saque_id=p_saque;

 RETURN jsonb_build_object(
  'ok',true,
  'bloqueio_excepcional',v_bloqueio,
  'perfil_atualmente_apto',v_perfil_apto,
  'elegivel',(
   v_saque.status='enviado' AND NOT v_bloqueio AND v_perfil_apto
   AND v_qtd>0 AND v_ativos=v_qtd
   AND v_elegiveis AND v_total=v_saque.valor_centavos
  ),
  'quantidade',v_qtd,
  'valor_centavos',v_total
 );
END;
$verify$;

REVOKE ALL ON FUNCTION public.catalogo_asaas_validar_reserva_saque(uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_validar_reserva_saque(uuid)
 TO service_role;
COMMIT;
