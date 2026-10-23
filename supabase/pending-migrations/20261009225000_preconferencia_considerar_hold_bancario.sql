-- Amplia preconferencia read-only para considerar evidencias bancarias
-- excepcionais observadas. Um estado DONE observado jamais constitui baixa.
-- Aplicar DEPOIS da migration 20261009220500 (tabela de evidencias).
BEGIN;

CREATE OR REPLACE FUNCTION public.catalogo_asaas_preconferir_pagamento_excepcional(
 p_tipo text, p_solicitacao uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $preflight$
DECLARE
 v_motoboy uuid;
 v_snapshot bigint;
 v_estado text;
 v_balance jsonb;
 v_atual bigint;
 v_creditos bigint;
 v_saques_em_aberto integer;
 v_conflitos integer;
 v_evidencias integer;
 v_tem_vinculo_ativo boolean;
 v_consistente boolean;
BEGIN
 IF p_solicitacao IS NULL OR p_tipo IS NULL OR p_tipo NOT IN ('residual','saida') THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Tipo ou identificador inválido.');
 END IF;

 IF p_tipo='residual' THEN
  SELECT r.motoboy_id,r.saldo_snapshot_centavos::bigint,r.status
   INTO v_motoboy,v_snapshot,v_estado
  FROM public.catalogo_asaas_saldos_residuais r WHERE r.id=p_solicitacao;
 ELSE
  SELECT s.motoboy_id,s.saldo_snapshot_centavos::bigint,s.status
   INTO v_motoboy,v_snapshot,v_estado
  FROM public.catalogo_asaas_regularizacoes_inativos s WHERE s.id=p_solicitacao;
 END IF;

 IF v_motoboy IS NULL THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Solicitação não encontrada.');
 END IF;

 v_balance:=public.catalogo_asaas_saldo_historico(v_motoboy);
 v_atual:=coalesce((v_balance->>'disponivel_centavos')::bigint,0);
 v_creditos:=coalesce((v_balance->>'creditos')::bigint,0);

 SELECT count(*)::integer INTO v_saques_em_aberto
 FROM public.catalogo_asaas_saques s
 WHERE s.motoboy_id=v_motoboy
   AND s.status IN ('reservado','enviado','revisao');

 SELECT count(*)::integer INTO v_evidencias
 FROM public.catalogo_asaas_transferencias_excepcionais_auditoria e
 WHERE e.motoboy_id=v_motoboy;

 SELECT EXISTS(
  SELECT 1 FROM public.catalogo_motoboys m
  WHERE m.usuario_id=v_motoboy AND m.ativo
 ) INTO v_tem_vinculo_ativo;

 IF p_tipo='residual' THEN
  SELECT count(*)::integer INTO v_conflitos
  FROM public.catalogo_asaas_regularizacoes_inativos s
  WHERE s.motoboy_id=v_motoboy AND s.status IN ('pendente','em_analise');
 ELSE
  SELECT count(*)::integer INTO v_conflitos
  FROM public.catalogo_asaas_saldos_residuais r
  WHERE r.motoboy_id=v_motoboy AND r.status IN ('pendente','em_analise');
 END IF;

 v_consistente:=v_estado IN ('pendente','em_analise')
  AND v_atual=v_snapshot AND v_atual>0
  AND v_creditos>0
  AND v_saques_em_aberto=0 AND v_conflitos=0 AND v_evidencias=0
  AND (p_tipo<>'saida' OR NOT v_tem_vinculo_ativo);

 RETURN jsonb_build_object(
  'ok',true,'tipo',p_tipo,'solicitacao_id',p_solicitacao,
  'situacao',v_estado,
  'saldo_snapshot_centavos',v_snapshot,
  'saldo_atual_centavos',v_atual,
  'creditos_disponiveis',v_creditos,
  'saques_em_aberto',v_saques_em_aberto,
  'solicitacoes_sobrepostas',v_conflitos,
  'evidencias_bancarias_para_conciliar',v_evidencias,
  'entregador_possui_vinculo_ativo',v_tem_vinculo_ativo,
  'saldo_confere',v_atual=v_snapshot,
  'sem_impedimentos_identificados',v_consistente,
  'pagamento_autorizado',false,
  'requer_revalidacao_transacional',true,
  'observacao','Pré-conferência administrativa, sem transferência ou comprovação bancária. Evidência bancária mantém HOLD até conciliação.'
 );
END;
$preflight$;

REVOKE ALL ON FUNCTION public.catalogo_asaas_preconferir_pagamento_excepcional(text,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_preconferir_pagamento_excepcional(text,uuid)
 TO service_role;
COMMIT;
