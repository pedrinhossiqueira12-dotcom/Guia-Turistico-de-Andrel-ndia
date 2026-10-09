-- Informa a existencia da separacao contábil e bloqueia nova pre-conferencia
-- como apta. Nao calcula pagamento e nao retira o HOLD.
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
 v_individuais bigint;
 v_total_individual bigint;
 v_fingerprint text;
 v_composicao_integra boolean;
 v_separacoes bigint;
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

 -- Esta segunda apuracao cruza o saldo com os CREDITOS INDIVIDUAIS,
 -- exigindo financiamento real por pedido. Nao usa paginacao nem LIMIT.
 -- O hash pode detectar troca de um credito por outro com mesmo valor.
 SELECT count(*)::bigint,
        coalesce(sum(r.valor_centavos::bigint),0),
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
          pg_catalog.string_agg(r.id::text||':'||r.valor_centavos::text,
            '|' ORDER BY r.id), 'UTF8')), 'hex')
 INTO v_individuais,v_total_individual,v_fingerprint
 FROM public.catalogo_remuneracoes_v2 r
 JOIN public.catalogo_pedidos p ON p.id=r.pedido_id
 JOIN public.catalogo_comissoes_offline c ON c.pedido_id=p.id
 JOIN public.catalogo_fechamentos_offline f
  ON f.comercio_id=c.comercio_id AND f.competencia=c.competencia
 JOIN public.catalogo_fatura_cobrancas b ON b.fechamento_id=f.id
 WHERE r.motoboy_id=v_motoboy
  AND r.status='disponivel' AND r.financiamento_comprovado
  AND r.repasse_id IS NULL AND r.valor_centavos>0
  AND p.provedor='offline' AND p.entrega_status='entregue'
  AND NOT p.reembolso_pendente AND NOT p.pagamento_revisao_pendente
  AND c.status='paga' AND f.status='pago'
  AND b.gateway='asaas' AND b.status='pago' AND b.pago_em IS NOT NULL
  AND catalogo_private.catalogo_v2_financiado(r.pedido_id)
  AND NOT EXISTS(
    SELECT 1 FROM public.catalogo_asaas_saque_itens i
    WHERE i.remuneracao_id=r.id AND i.ativo
  );

 v_composicao_integra:=v_individuais=v_creditos
  AND v_total_individual=v_atual
  AND v_fingerprint IS NOT NULL AND length(v_fingerprint)=64;

 SELECT count(*)::bigint INTO v_separacoes
 FROM public.catalogo_asaas_separacoes_excepcionais e
 WHERE e.motoboy_id=v_motoboy;

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
  AND v_creditos>0 AND v_composicao_integra
  AND v_saques_em_aberto=0 AND v_conflitos=0 AND v_evidencias=0
  AND v_separacoes=0
  AND (p_tipo<>'saida' OR NOT v_tem_vinculo_ativo);

 RETURN jsonb_build_object(
  'ok',true,'tipo',p_tipo,'solicitacao_id',p_solicitacao,
  'situacao',v_estado,
  'saldo_snapshot_centavos',v_snapshot,
  'saldo_atual_centavos',v_atual,
  'creditos_disponiveis',v_creditos,
  'creditos_individuais_validos',v_individuais,
  'valor_creditos_individuais_centavos',v_total_individual,
  'fingerprint_creditos_sha256',v_fingerprint,
  'composicao_creditos_integra',v_composicao_integra,
  'saques_em_aberto',v_saques_em_aberto,
  'solicitacoes_sobrepostas',v_conflitos,
  'evidencias_bancarias_para_conciliar',v_evidencias,
  'separacoes_contabeis_sem_liquidacao',v_separacoes,
  'entregador_possui_vinculo_ativo',v_tem_vinculo_ativo,
  'saldo_confere',v_atual=v_snapshot,
  'sem_impedimentos_identificados',v_consistente,
  'pagamento_autorizado',false,
  'requer_revalidacao_transacional',true,
  'observacao','Pré-conferência read-only. Separação contábil é um HOLD, não autoriza Pix. Fingerprint e observações bancárias não provam liquidação.'
 );
END;
$preflight$;

REVOKE ALL ON FUNCTION public.catalogo_asaas_preconferir_pagamento_excepcional(text,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_preconferir_pagamento_excepcional(text,uuid)
 TO service_role;
COMMIT;
