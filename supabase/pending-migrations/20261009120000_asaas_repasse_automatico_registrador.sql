-- STAGING ONLY: corrigir baixa financeira automática de Pix Asaas
-- sem simular a presença de um operador humano.
-- Preserva a exigência de registrado_por nos repasses manuais por CHECK.
BEGIN;

ALTER TABLE public.catalogo_repasses_v2
  ALTER COLUMN registrado_por DROP NOT NULL;

ALTER TABLE public.catalogo_repasses_v2
  DROP CONSTRAINT IF EXISTS catalogo_repasses_v2_registro_automatico_check;
ALTER TABLE public.catalogo_repasses_v2
  ADD CONSTRAINT catalogo_repasses_v2_registro_automatico_check
  CHECK (registrado_por IS NOT NULL OR (
    referencia LIKE 'asaas:%'
    AND comprovante = 'Pix confirmado pela API Asaas'
    AND metadata->>'origem' = 'asaas_pix_automatico'
    AND metadata->>'confirmacao' = 'consulta_asaas_DONE'
    AND metadata->>'transferencia_id' = substr(referencia, 7)
    AND metadata ? 'saque_asaas_id'
    AND metadata ? 'solicitante_id'
  ) IS TRUE);

CREATE OR REPLACE FUNCTION public.catalogo_asaas_atualizar_saque(
 p_saque uuid,p_estado text,p_transferencia text DEFAULT NULL,p_mensagem text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.catalogo_asaas_saques%ROWTYPE;
 v_credito record;v_qtd integer:=0;v_total integer:=0;v_repasse uuid;v_atualizados integer:=0;
BEGIN
 SELECT * INTO v FROM public.catalogo_asaas_saques WHERE id=p_saque FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'mensagem','Saque não encontrado.'); END IF;
 IF v.status IN ('concluido','falhou') THEN
   RETURN jsonb_build_object('ok',v.status=p_estado,'status',v.status,'idempotente',true);
 END IF;
 IF p_estado NOT IN ('enviado','concluido','falhou','revisao') THEN
   RETURN jsonb_build_object('ok',false,'mensagem','Estado não permitido.');
 END IF;
 IF v.transferencia_id IS NOT NULL AND (p_transferencia IS NULL OR p_transferencia<>v.transferencia_id) THEN
   RETURN jsonb_build_object('ok',false,'mensagem','ID de transferência divergente.');
 END IF;
 IF p_estado='enviado' THEN
   IF v.status<>'reservado' OR coalesce(length(p_transferencia),0)<4 THEN
     RETURN jsonb_build_object('ok',false,'mensagem','Transferência inválida.');
   END IF;
   UPDATE public.catalogo_asaas_saques SET status='enviado',transferencia_id=p_transferencia,
    atualizado_em=now() WHERE id=v.id;
   RETURN jsonb_build_object('ok',true,'status','enviado');
 END IF;
 IF p_estado='falhou' THEN
   -- Falha só pode ser marcada quando a API efetivamente informa FAILED/CANCELLED.
   UPDATE public.catalogo_asaas_saque_itens SET ativo=false WHERE saque_id=v.id;
   UPDATE public.catalogo_asaas_saques SET status='falhou',transferencia_id=coalesce(v.transferencia_id,p_transferencia),
    mensagem=left(p_mensagem,500),atualizado_em=now() WHERE id=v.id;
   RETURN jsonb_build_object('ok',true,'status','falhou');
 END IF;
 IF p_estado='revisao' THEN
   UPDATE public.catalogo_asaas_saques SET status='revisao',
    transferencia_id=coalesce(v.transferencia_id,p_transferencia),mensagem=left(p_mensagem,500),
    atualizado_em=now() WHERE id=v.id;
   RETURN jsonb_build_object('ok',true,'status','revisao');
 END IF;
 IF v.status NOT IN ('enviado','revisao') OR coalesce(v.transferencia_id,p_transferencia) IS NULL THEN
   RETURN jsonb_build_object('ok',false,'mensagem','Transferência ainda não identificada.');
 END IF;
 -- Alinha com a operação administrativa existente: pagamento só após confirmação.
 PERFORM 1 FROM public.catalogo_pedidos p
 WHERE p.id IN (SELECT r.pedido_id FROM public.catalogo_remuneracoes_v2 r
 JOIN public.catalogo_asaas_saque_itens i ON i.remuneracao_id=r.id WHERE i.saque_id=v.id AND i.ativo)
 ORDER BY p.id FOR UPDATE;
 FOR v_credito IN SELECT r.* FROM public.catalogo_remuneracoes_v2 r
   JOIN public.catalogo_asaas_saque_itens i ON i.remuneracao_id=r.id
   WHERE i.saque_id=v.id AND i.ativo ORDER BY r.pedido_id FOR UPDATE OF r
 LOOP
   IF v_credito.motoboy_id<>v.motoboy_id OR v_credito.status<>'disponivel'
     OR v_credito.repasse_id IS NOT NULL OR NOT v_credito.financiamento_comprovado
     OR NOT catalogo_private.catalogo_v2_financiado(v_credito.pedido_id) THEN
     UPDATE public.catalogo_asaas_saques SET status='revisao',atualizado_em=now(),
       mensagem='Crédito alterado após transferência bancária. Revisar manualmente.'
       WHERE id=v.id;
     RETURN jsonb_build_object('ok',false,'status','revisao','mensagem','Transferência executada: há divergência no saldo.');
   END IF;
   v_qtd:=v_qtd+1;v_total:=v_total+v_credito.valor_centavos;
 END LOOP;
 IF v_qtd=0 OR v_total<>v.valor_centavos THEN
   UPDATE public.catalogo_asaas_saques SET status='revisao',atualizado_em=now(),
     mensagem='Composição do saque alterada. Revisar manualmente.' WHERE id=v.id;
   RETURN jsonb_build_object('ok',false,'status','revisao');
 END IF;
 -- A liquidação veio do banco, não de um operador humano; registrado_por fica NULL.
 -- O solicitante está identificado por motoboy_id e metadata.solicitante_id.
 INSERT INTO public.catalogo_repasses_v2(motoboy_id,valor_centavos,referencia,comprovante,registrado_por,metadata)
 VALUES(v.motoboy_id,v_total,'asaas:'||coalesce(v.transferencia_id,p_transferencia),
   'Pix confirmado pela API Asaas',NULL,
   jsonb_build_object('saque_asaas_id',v.id,
    'origem','asaas_pix_automatico','confirmacao','consulta_asaas_DONE',
    'transferencia_id',coalesce(v.transferencia_id,p_transferencia),
    'solicitante_id',v.motoboy_id))
 RETURNING id INTO v_repasse;
 UPDATE public.catalogo_remuneracoes_v2 SET status='pago',repasse_id=v_repasse,pago_em=now()
 WHERE id IN (SELECT remuneracao_id FROM public.catalogo_asaas_saque_itens WHERE saque_id=v.id AND ativo);
 GET DIAGNOSTICS v_atualizados=ROW_COUNT;
 IF v_atualizados<>v_qtd THEN RAISE EXCEPTION 'Divergência entre créditos e transferência; operação abortada'; END IF;
 UPDATE public.catalogo_lancamentos_financeiros_v2 SET status='pago',
  referencia='asaas:'||coalesce(v.transferencia_id,p_transferencia),atualizado_em=now()
 WHERE remuneracao_id IN
   (SELECT remuneracao_id FROM public.catalogo_asaas_saque_itens WHERE saque_id=v.id AND ativo);
 UPDATE public.catalogo_asaas_saques SET status='concluido',
  transferencia_id=coalesce(v.transferencia_id,p_transferencia),comprovante='Pix confirmado pela API Asaas',
  atualizado_em=now(),concluido_em=now() WHERE id=v.id;
 RETURN jsonb_build_object('ok',true,'status','concluido','repasse_id',v_repasse);
END; $$;

-- Função somente para o backend de confiança; nenhum cliente pode dar baixa diretamente.
REVOKE ALL ON FUNCTION public.catalogo_asaas_atualizar_saque(uuid,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_atualizar_saque(uuid,text,text,text)
  TO service_role;

COMMIT;
