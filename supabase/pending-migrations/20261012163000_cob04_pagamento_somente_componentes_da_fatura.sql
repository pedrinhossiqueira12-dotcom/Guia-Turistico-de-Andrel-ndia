-- COB-04: conciliações alteram apenas os pedidos do snapshot da fatura.
-- Protege comissões abertas de vendas incompletas na mesma competência.
-- Cobertura tanto para pagamento quanto para estorno/contestação.
-- Sem inserts de cobrança, pagamento, saque ou correção retroativa de dados.
CREATE OR REPLACE FUNCTION public.catalogo_confirmar_cobranca_fatura(p_order_id text, p_estado text, p_payment_id text, p_valor_centavos integer, p_detalhe text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_cobranca public.catalogo_fatura_cobrancas%ROWTYPE;
  v_status_anterior text;
  v_desbloqueado boolean := false;
  v_motivo_financeiro constant text := 'Comissão de pagamentos presenciais vencida.';
BEGIN
  IF p_estado NOT IN ('pago','pendente','cancelado','expirado','estornado','contestado') THEN
    RETURN jsonb_build_object('ok',false,'reconhecido',false,'mensagem','Estado de cobrança não reconhecido.');
  END IF;

  SELECT * INTO v_cobranca
    FROM public.catalogo_fatura_cobrancas
   WHERE order_id = btrim(coalesce(p_order_id,''))
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'reconhecido',false,'mensagem','Cobrança não encontrada para esta ordem.');
  END IF;

  v_status_anterior := v_cobranca.status;

  IF p_estado='pendente' THEN
    UPDATE public.catalogo_fatura_cobrancas
       SET payment_id=coalesce(nullif(btrim(coalesce(p_payment_id,'')),''),payment_id),
           ultima_consulta_em=pg_catalog.now()
     WHERE id=v_cobranca.id;
    RETURN jsonb_build_object('ok',true,'reconhecido',true,'status',v_cobranca.status,'alterado',false);
  END IF;

  IF p_estado='pago' THEN
    IF v_cobranca.status='pago' THEN
      RETURN jsonb_build_object('ok',true,'reconhecido',true,'status','pago','ja_confirmado',true,'alterado',false);
    END IF;

    IF p_valor_centavos IS NULL OR p_valor_centavos<>v_cobranca.valor_centavos THEN
      UPDATE public.catalogo_fatura_cobrancas
         SET status='divergente',
             divergencia=left(coalesce(p_detalhe,'Valor confirmado diferente do valor da fatura.'),500),
             ultima_consulta_em=pg_catalog.now()
       WHERE id=v_cobranca.id;
      PERFORM public.catalogo_registrar_evento_fatura(
        v_cobranca.id,v_cobranca.order_id,'divergencia_valor',
        v_status_anterior,'divergente',p_valor_centavos,p_detalhe
      );
      RETURN jsonb_build_object('ok',false,'reconhecido',true,'divergencia',true,
        'mensagem','O valor pago não corresponde à fatura; a conferência é manual.');
    END IF;

    UPDATE public.catalogo_fatura_cobrancas
       SET status='pago',
           pago_em=pg_catalog.now(),
           payment_id=coalesce(nullif(btrim(coalesce(p_payment_id,'')),''),payment_id),
           divergencia=NULL,
           ultima_consulta_em=pg_catalog.now()
     WHERE id=v_cobranca.id;

    UPDATE public.catalogo_fechamentos_offline
       SET status='pago',pago_em=pg_catalog.now(),referencia_pagamento=v_cobranca.order_id
     WHERE id=v_cobranca.fechamento_id;

    UPDATE public.catalogo_comissoes_offline
       SET status='paga',pago_em=pg_catalog.now(),referencia_pagamento=v_cobranca.order_id
     WHERE comercio_id=v_cobranca.comercio_id
       AND competencia=v_cobranca.competencia
       AND status IN ('aberta','faturada','bloqueado')
       AND EXISTS (SELECT 1 FROM public.catalogo_fatura_componentes_v2 fc
         WHERE fc.fechamento_id=v_cobranca.fechamento_id
           AND fc.pedido_id=public.catalogo_comissoes_offline.pedido_id);

    -- Comissão da plataforma: torna-se disponível somente após a fatura.
    UPDATE public.catalogo_lancamentos_financeiros_v2 l
       SET status='disponivel',
           atualizado_em=pg_catalog.now(),
           metadata=coalesce(l.metadata,'{}'::jsonb)||jsonb_build_object(
             'fatura_paga',true,'fatura_order_id',v_cobranca.order_id)
     FROM public.catalogo_pedidos p
     JOIN public.catalogo_comissoes_offline c ON c.pedido_id=p.id
     WHERE l.pedido_id=p.id
       AND l.tipo='comissao_plataforma'
       AND p.provedor='offline'
       AND p.versao_financeira=2
       AND c.comercio_id=v_cobranca.comercio_id
       AND c.competencia=v_cobranca.competencia
       AND c.status='paga'
       AND EXISTS (SELECT 1 FROM public.catalogo_fatura_componentes_v2 fc
         WHERE fc.fechamento_id=v_cobranca.fechamento_id
           AND fc.pedido_id=l.pedido_id
           AND fc.tipo='plataforma'
           AND fc.valor_centavos=l.valor_centavos)
       AND l.status IN ('retido','pendencia_revisao');

    -- Motoboy: só libera créditos de entregas físicas já confirmadas.
    UPDATE public.catalogo_remuneracoes_v2 r
       SET status='disponivel',
           financiamento_comprovado=true,
           disponibilizado_em=coalesce(r.disponibilizado_em,pg_catalog.now()),
           metadata=coalesce(r.metadata,'{}'::jsonb)||jsonb_build_object(
             'fatura_paga',true,'fatura_order_id',v_cobranca.order_id)
     FROM public.catalogo_pedidos p
     JOIN public.catalogo_comissoes_offline c ON c.pedido_id=p.id
     WHERE r.pedido_id=p.id
       AND p.provedor='offline'
       AND p.versao_financeira=2
       AND p.modalidade='entrega'
       AND p.entrega_status='entregue'
       AND p.taxa_motoboy_centavos>0
       AND c.comercio_id=v_cobranca.comercio_id
       AND c.competencia=v_cobranca.competencia
       AND c.status='paga'
       AND EXISTS (SELECT 1 FROM public.catalogo_fatura_componentes_v2 fc
         WHERE fc.fechamento_id=v_cobranca.fechamento_id
           AND fc.pedido_id=r.pedido_id
           AND fc.tipo='logistica'
           AND fc.valor_centavos=r.valor_centavos)
       AND r.status='retido'
       AND r.repasse_id IS NULL;

    UPDATE public.catalogo_lancamentos_financeiros_v2 l
       SET status='disponivel',
           atualizado_em=pg_catalog.now(),
           metadata=coalesce(l.metadata,'{}'::jsonb)||jsonb_build_object(
             'fatura_paga',true,'fatura_order_id',v_cobranca.order_id)
     FROM public.catalogo_pedidos p
     JOIN public.catalogo_comissoes_offline c ON c.pedido_id=p.id
     WHERE l.pedido_id=p.id
       AND l.tipo='remuneracao_motoboy'
       AND p.provedor='offline'
       AND p.versao_financeira=2
       AND p.modalidade='entrega'
       AND p.entrega_status='entregue'
       AND c.comercio_id=v_cobranca.comercio_id
       AND c.competencia=v_cobranca.competencia
       AND c.status='paga'
       AND EXISTS (SELECT 1 FROM public.catalogo_fatura_componentes_v2 fc
         WHERE fc.fechamento_id=v_cobranca.fechamento_id
           AND fc.pedido_id=l.pedido_id
           AND fc.tipo='logistica'
           AND fc.valor_centavos=l.valor_centavos)
       AND l.status IN ('retido','pendencia_revisao');

    UPDATE public.catalogos
       SET bloqueado=false,motivo_bloqueio=NULL
     WHERE comercio_id=v_cobranca.comercio_id
       AND bloqueado=true
       AND motivo_bloqueio=v_motivo_financeiro
     RETURNING true INTO v_desbloqueado;

    PERFORM public.catalogo_registrar_evento_fatura(
      v_cobranca.id,v_cobranca.order_id,'pagamento_confirmado',
      v_status_anterior,'pago',p_valor_centavos,p_detalhe
    );

    RETURN jsonb_build_object(
      'ok',true,'reconhecido',true,'status','pago','alterado',true,
      'catalogo_desbloqueado',coalesce(v_desbloqueado,false)
    );
  END IF;

  IF p_estado IN ('estornado','contestado') THEN
    UPDATE public.catalogo_fatura_cobrancas
       SET status=p_estado,
           pago_em=CASE WHEN p_estado='estornado' THEN NULL ELSE pago_em END,
           divergencia=left(coalesce(p_detalhe,'Pagamento revogado pelo provedor.'),500),
           ultima_consulta_em=pg_catalog.now()
     WHERE id=v_cobranca.id;

    IF v_status_anterior='pago' THEN
      UPDATE public.catalogo_fechamentos_offline
         SET status='vencido',pago_em=NULL,referencia_pagamento=NULL
       WHERE id=v_cobranca.fechamento_id;

      UPDATE public.catalogo_comissoes_offline
         SET status='faturada',pago_em=NULL,referencia_pagamento=NULL
       WHERE comercio_id=v_cobranca.comercio_id
         AND competencia=v_cobranca.competencia
         AND status='paga'
         AND EXISTS (SELECT 1 FROM public.catalogo_fatura_componentes_v2 fc
         WHERE fc.fechamento_id=v_cobranca.fechamento_id
           AND fc.pedido_id=public.catalogo_comissoes_offline.pedido_id);

      -- Se o crédito ainda não foi repassado, volta a ficar retido.
      -- Se já foi pago ao motoboy, não inventamos um estorno automático:
      -- colocamos em revisão administrativa.
      UPDATE public.catalogo_remuneracoes_v2 r
         SET status=CASE WHEN r.repasse_id IS NULL THEN 'retido' ELSE 'pendencia_revisao' END,
             financiamento_comprovado=false,
             disponibilizado_em=CASE WHEN r.repasse_id IS NULL THEN NULL ELSE r.disponibilizado_em END,
             metadata=coalesce(r.metadata,'{}'::jsonb)||jsonb_build_object(
               'fatura_revogada',true,'fatura_order_id',v_cobranca.order_id)
       FROM public.catalogo_pedidos p
       JOIN public.catalogo_comissoes_offline c ON c.pedido_id=p.id
       WHERE r.pedido_id=p.id
         AND p.provedor='offline'
         AND p.versao_financeira=2
         AND c.comercio_id=v_cobranca.comercio_id
         AND c.competencia=v_cobranca.competencia
         AND EXISTS (SELECT 1 FROM public.catalogo_fatura_componentes_v2 fc
         WHERE fc.fechamento_id=v_cobranca.fechamento_id
           AND fc.pedido_id=r.pedido_id);

      UPDATE public.catalogo_lancamentos_financeiros_v2 l
         SET status=CASE
               WHEN EXISTS(
                 SELECT 1 FROM public.catalogo_remuneracoes_v2 r
                  WHERE r.id=l.remuneracao_id AND r.repasse_id IS NOT NULL
               ) THEN 'pendencia_revisao'
               ELSE 'retido'
             END,
             atualizado_em=pg_catalog.now(),
             metadata=coalesce(l.metadata,'{}'::jsonb)||jsonb_build_object(
               'fatura_revogada',true,'fatura_order_id',v_cobranca.order_id)
       WHERE l.pedido_id IN (
         SELECT c.pedido_id
           FROM public.catalogo_comissoes_offline c
          WHERE c.comercio_id=v_cobranca.comercio_id
            AND c.competencia=v_cobranca.competencia
            AND EXISTS (SELECT 1 FROM public.catalogo_fatura_componentes_v2 fc
         WHERE fc.fechamento_id=v_cobranca.fechamento_id
           AND fc.pedido_id=c.pedido_id)
       )
       AND l.tipo IN ('comissao_plataforma','remuneracao_motoboy')
       AND l.status IN ('disponivel','pago','retido','pendencia_revisao');

      UPDATE public.catalogos
         SET bloqueado=true,motivo_bloqueio=v_motivo_financeiro
       WHERE comercio_id=v_cobranca.comercio_id AND bloqueado=false;
    END IF;

    PERFORM public.catalogo_registrar_evento_fatura(
      v_cobranca.id,v_cobranca.order_id,'pagamento_revogado',
      v_status_anterior,p_estado,p_valor_centavos,p_detalhe
    );

    RETURN jsonb_build_object(
      'ok',true,'reconhecido',true,'status',p_estado,'alterado',true,
      'catalogo_desbloqueado',false
    );
  END IF;

  UPDATE public.catalogo_fatura_cobrancas
     SET status=p_estado,
         divergencia=CASE WHEN p_estado='cancelado'
           THEN left(coalesce(p_detalhe,'Cobrança cancelada.'),500)
           ELSE divergencia END,
         ultima_consulta_em=pg_catalog.now()
   WHERE id=v_cobranca.id;

  PERFORM public.catalogo_registrar_evento_fatura(
    v_cobranca.id,v_cobranca.order_id,'cobranca_encerrada',
    v_status_anterior,p_estado,p_valor_centavos,p_detalhe
  );

  RETURN jsonb_build_object('ok',true,'reconhecido',true,'status',p_estado,'alterado',true,'catalogo_desbloqueado',false);
END;
$function$
;
