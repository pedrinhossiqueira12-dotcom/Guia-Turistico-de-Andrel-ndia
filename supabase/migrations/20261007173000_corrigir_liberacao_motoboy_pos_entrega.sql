-- Corrige a liberação da remuneração do motoboy na confirmação financeira.
-- Regra vigente:
--   * entrega: 5% plataforma + 2% motoboy, independentemente de Pix/cartão/dinheiro;
--   * retirada/consumo local: 5% plataforma e 0% motoboy;
--   * os 2% só ficam disponíveis após a confirmação física da entrega;
--   * pagamento confirmado antes da entrega NÃO libera os 2%;
--   * pagamento confirmado depois da entrega pode liberar uma remuneração que já
--     estava retida, pois a entrega já foi comprovada.
BEGIN;

CREATE OR REPLACE FUNCTION public.catalogo_aplicar_pagamento_v2(
 p_pedido_id uuid,p_status text,p_valor_centavos integer,p_taxa_centavos integer,p_referencia text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_pedido public.catalogo_pedidos%ROWTYPE; v_old public.catalogo_pagamentos_v2%ROWTYPE;
 v_status text:=lower(trim(coalesce(p_status,''))); v_funded boolean; v_exists boolean; v_idempotente boolean:=false;
BEGIN
 IF p_pedido_id IS NULL OR p_referencia IS NULL OR char_length(trim(p_referencia))=0 OR char_length(p_referencia)>180
  OR p_valor_centavos IS NULL OR p_valor_centavos<0 OR p_taxa_centavos<0 THEN
  RETURN jsonb_build_object('ok',false,'http_status',400,'mensagem','Referência/valor inválido.');
 END IF;
 IF v_status='approved' THEN v_status:='aprovado'; END IF;
 IF v_status='refunded' THEN v_status:='estornado'; END IF;
 IF v_status NOT IN ('aprovado','estornado','charged_back','cancelado','recusado','revisao_parcial') THEN
  RETURN jsonb_build_object('ok',false,'http_status',400,'mensagem','Estado inválido.');
 END IF;

 SELECT * INTO v_pedido FROM public.catalogo_pedidos WHERE id=p_pedido_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'http_status',404,'mensagem','Pedido não encontrado.'); END IF;
 IF v_pedido.provedor<>'mercadopago' THEN
  RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Recebimento do cliente presencial não é receita recebida pela plataforma.');
 END IF;

 SELECT * INTO v_old FROM public.catalogo_pagamentos_v2 WHERE pedido_id=p_pedido_id FOR UPDATE;
 v_exists:=FOUND;

 IF EXISTS(SELECT 1 FROM public.catalogo_pagamentos_v2 WHERE referencia=p_referencia AND pedido_id<>p_pedido_id) THEN
  RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Referência pertence a outro pedido.');
 END IF;
 IF p_valor_centavos<>v_pedido.total_centavos THEN
  RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Valor não confere com o pedido.');
 END IF;
 IF p_taxa_centavos IS NOT NULL AND p_taxa_centavos<>v_pedido.taxa_total_centavos THEN
  RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Taxa não confere com o snapshot.');
 END IF;

 IF v_exists THEN
  IF v_old.referencia<>p_referencia OR v_old.valor_centavos<>p_valor_centavos
     OR (v_old.taxa_centavos IS NOT NULL AND p_taxa_centavos IS NOT NULL AND v_old.taxa_centavos<>p_taxa_centavos) THEN
   RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Pagamento já conciliado com fatos diferentes.');
  END IF;
  IF v_old.status IN ('estornado','charged_back') AND v_status NOT IN ('estornado','charged_back') THEN
   RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Pagamento revertido não pode ser reaberto.');
  END IF;
  IF v_old.status='revisao_parcial' AND v_status NOT IN ('revisao_parcial','estornado','charged_back') THEN
   RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Reembolso parcial requer revisão antes de liberar créditos.');
  END IF;
  IF v_old.status='aprovado' AND v_status IN ('cancelado','recusado') THEN
   RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Aprovação somente é revertida por refund/chargeback.');
  END IF;
  v_idempotente:=v_old.status=v_status AND (p_taxa_centavos IS NULL OR v_old.taxa_centavos=p_taxa_centavos);
  IF v_idempotente THEN
   RETURN jsonb_build_object('ok',true,'idempotente',true,'pedido_id',p_pedido_id,'status_pagamento',v_pedido.status_pagamento);
  END IF;
  UPDATE public.catalogo_pagamentos_v2
     SET status=v_status,taxa_centavos=coalesce(taxa_centavos,p_taxa_centavos),
         metadata=metadata||jsonb_build_object('status_anterior',v_old.status,'atualizado_em',pg_catalog.now(),'taxa_comprovada',coalesce(v_old.taxa_centavos,p_taxa_centavos) IS NOT NULL)
   WHERE pedido_id=p_pedido_id;
 ELSE
  INSERT INTO public.catalogo_pagamentos_v2(pedido_id,status,valor_centavos,taxa_centavos,referencia,metadata)
  VALUES(p_pedido_id,v_status,p_valor_centavos,p_taxa_centavos,p_referencia,jsonb_build_object('taxa_comprovada',p_taxa_centavos IS NOT NULL));
 END IF;

 INSERT INTO public.catalogo_pagamento_eventos_v2(pedido_id,status,valor_centavos,taxa_centavos,referencia)
 VALUES(p_pedido_id,v_status,p_valor_centavos,coalesce(v_old.taxa_centavos,p_taxa_centavos),p_referencia)
 ON CONFLICT DO NOTHING;

 IF v_status='revisao_parcial' THEN
  UPDATE public.catalogo_pedidos
     SET status_pagamento='contestado',pagamento_revisao_pendente=true
   WHERE id=p_pedido_id;
  UPDATE public.catalogo_remuneracoes_v2
     SET status='pendencia_revisao',financiamento_comprovado=false,
         metadata=metadata||jsonb_build_object('revisao_parcial',true,'status_anterior',status)
   WHERE pedido_id=p_pedido_id AND status IN ('retido','disponivel','pago');
  UPDATE public.catalogo_lancamentos_financeiros_v2
     SET status='pendencia_revisao',atualizado_em=pg_catalog.now(),
         metadata=metadata||jsonb_build_object('revisao_parcial',true,'status_anterior',status)
   WHERE pedido_id=p_pedido_id AND tipo IN ('comissao_plataforma','reserva_logistica','remuneracao_motoboy') AND status<>'estornado';
  INSERT INTO public.catalogo_ocorrencias_v2(pedido_id,comercio_id,origem,categoria,motivo)
  VALUES(p_pedido_id,v_pedido.comercio_id,'sistema','outro','Reembolso parcial informado pelo provedor; revisão financeira sem imputar culpa.')
  ON CONFLICT(pedido_id,motoboy_id,origem,categoria) DO NOTHING;
  RETURN jsonb_build_object('ok',true,'pedido_id',p_pedido_id,'revisao_parcial',true,'status_pagamento','contestado','transferencia_executada',false);
 END IF;

 IF v_status='aprovado' THEN
  v_funded:=coalesce(v_old.taxa_centavos,p_taxa_centavos)=v_pedido.taxa_total_centavos;
  v_funded:=coalesce(v_funded,false);

  UPDATE public.catalogo_pedidos
     SET status_pagamento='aprovado',
         pago_em=coalesce(pago_em,pg_catalog.now()),
         status=CASE WHEN status='aguardando_pagamento' THEN 'pago' ELSE status END,
         pagamento_revisao_pendente=NOT v_funded,
         reembolso_pendente=reembolso_pendente OR status IN ('cancelado','estornado','expirado') OR entrega_status='cancelado'
   WHERE id=p_pedido_id;

  -- A comissão de 5% é registrada no aceite. O pagamento pode torná-la disponível.
  PERFORM catalogo_private.catalogo_v2_registrar_plataforma(p_pedido_id,'pagamento');

  UPDATE public.catalogo_lancamentos_financeiros_v2
     SET status=CASE WHEN v_funded AND NOT v_pedido.reembolso_pendente THEN 'disponivel' ELSE 'pendencia_revisao' END,
         atualizado_em=pg_catalog.now(),
         metadata=metadata||jsonb_build_object('taxa_comprovada',v_funded)
   WHERE pedido_id=p_pedido_id AND tipo='comissao_plataforma' AND status IN ('retido','pendencia_revisao');

  -- IMPORTANTE: pagamento não comprova entrega.
  -- Para entrega, a remuneração de 2% só pode ser liberada depois que
  -- entrega_status='entregue'. A confirmação da entrega cria a remuneração
  -- quando necessário; este bloco trata apenas o caso em que a entrega já
  -- foi confirmada e o pagamento chegou depois.
  IF v_funded
     AND NOT v_pedido.reembolso_pendente
     AND v_pedido.status NOT IN ('cancelado','estornado','expirado')
     AND v_pedido.entrega_status='entregue'
     AND v_pedido.modalidade='entrega' THEN
   UPDATE public.catalogo_remuneracoes_v2
      SET status='disponivel',financiamento_comprovado=true,
          disponibilizado_em=coalesce(disponibilizado_em,pg_catalog.now())
    WHERE pedido_id=p_pedido_id AND status='retido';
   UPDATE public.catalogo_lancamentos_financeiros_v2
      SET status='disponivel',atualizado_em=pg_catalog.now()
    WHERE pedido_id=p_pedido_id AND tipo='remuneracao_motoboy' AND status='retido';
  END IF;

  RETURN jsonb_build_object('ok',true,'pedido_id',p_pedido_id,'status_pagamento','aprovado',
    'financiamento_comprovado',v_funded,
    'taxa_enriquecida',v_exists AND v_old.taxa_centavos IS NULL AND p_taxa_centavos IS NOT NULL);
 END IF;

 UPDATE public.catalogo_pedidos
    SET status_pagamento=CASE WHEN v_status='charged_back' THEN 'contestado' WHEN v_status='estornado' THEN 'estornado' WHEN v_status='recusado' THEN 'recusado' ELSE 'cancelado' END,
        reembolso_pendente=(v_status='charged_back'),pagamento_revisao_pendente=(v_status='charged_back')
  WHERE id=p_pedido_id;

 -- Nunca altera a fase física. Valor pago anterior continua auditado no repasse,
 -- sem inventar dinheiro devolvido.
 UPDATE public.catalogo_remuneracoes_v2
    SET status=CASE WHEN repasse_id IS NOT NULL THEN 'pendencia_revisao' ELSE 'estornado' END,
        financiamento_comprovado=false
  WHERE pedido_id=p_pedido_id AND status<>'estornado';

 UPDATE public.catalogo_lancamentos_financeiros_v2
    SET status=CASE
      WHEN status IN ('pago','pendencia_revisao')
       AND EXISTS(SELECT 1 FROM public.catalogo_remuneracoes_v2 r WHERE r.pedido_id=p_pedido_id AND r.repasse_id IS NOT NULL)
      THEN 'pendencia_revisao' ELSE 'estornado' END,
        atualizado_em=pg_catalog.now()
  WHERE pedido_id=p_pedido_id AND tipo IN ('comissao_plataforma','reserva_logistica','remuneracao_motoboy');

 INSERT INTO public.catalogo_lancamentos_financeiros_v2(pedido_id,beneficiario_id,tipo,valor_centavos,status,chave_idempotencia,referencia,metadata)
 SELECT r.pedido_id,r.motoboy_id,'pendencia_revisao',-r.valor_centavos,'pendencia_revisao',
        'estorno-revisao:'||r.pedido_id::text,p_referencia,
        jsonb_build_object('motivo','Crédito já repassado antes da reversão; revisão sem transferência fictícia','repasse_id',r.repasse_id)
 FROM public.catalogo_remuneracoes_v2 r
 WHERE r.pedido_id=p_pedido_id AND r.repasse_id IS NOT NULL
 ON CONFLICT(chave_idempotencia) DO NOTHING;

 RETURN jsonb_build_object('ok',true,'pedido_id',p_pedido_id,'status_pagamento',v_status,'transferencia_executada',false);

EXCEPTION WHEN unique_violation THEN
 RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Referência de pagamento já utilizada por outro pedido.');
END;
$$;

REVOKE ALL ON FUNCTION public.catalogo_aplicar_pagamento_v2(uuid,text,integer,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_aplicar_pagamento_v2(uuid,text,integer,integer,text) TO service_role;

COMMIT;
