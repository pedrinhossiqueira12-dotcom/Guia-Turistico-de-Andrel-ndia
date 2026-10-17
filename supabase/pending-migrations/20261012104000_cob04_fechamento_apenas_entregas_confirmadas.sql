-- COB-04: evitar cobrança de comissão por pedido apenas aceito/pronto.
-- Origem: definição inspecionada em STAGING em 12/10/2026.
-- Reaproveita a RPC existente e preserva as travas financeiras e histórico pago.
-- Migration PENDENTE para revisão; NÃO aplicar em produção automaticamente.
-- Em STAGING, somente pedidos físicos entregues, confirmados pelo código
-- e pagamento offline aprovado entram em totais, componentes e baixa de fatura.
-- Incompletos permanecem abertos/retidos; não são apagados nem faturados.
CREATE OR REPLACE FUNCTION public.catalogo_gerar_fechamento_offline(p_comercio_id text, p_competencia date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_id uuid; v_comp date:=date_trunc('month',p_competencia)::date; v_status text; v_total integer; v_count integer;
BEGIN
 -- Serializa a geração por comércio sem expor identidade do comprador.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('catalogo-fatura:'||p_comercio_id,0));
 SELECT id,status INTO v_id,v_status FROM public.catalogo_fechamentos_offline WHERE comercio_id=p_comercio_id AND competencia=v_comp FOR UPDATE;
 IF v_status='pago' OR EXISTS(SELECT 1 FROM public.catalogo_fatura_cobrancas WHERE fechamento_id=v_id) THEN RETURN v_id; END IF;
 SELECT coalesce(sum(valor),0)::integer,count(DISTINCT pedido_id)::integer INTO v_total,v_count FROM (
 SELECT pedido_id,valor_comissao_centavos valor FROM public.catalogo_comissoes_offline WHERE comercio_id=p_comercio_id AND competencia=v_comp AND status NOT IN ('cancelada','contestada') AND EXISTS (
   SELECT 1 FROM public.catalogo_pedidos p
   WHERE p.id=public.catalogo_comissoes_offline.pedido_id
     AND p.comercio_id=public.catalogo_comissoes_offline.comercio_id
     AND p.provedor='offline'
     AND p.status='entregue'
     AND p.entrega_status='entregue'
     AND p.status_pagamento='aprovado'
     AND p.codigo_entrega_usado_em IS NOT NULL
 )) parcelas;
 IF v_count=0 AND v_id IS NULL THEN RETURN NULL; END IF;
 INSERT INTO public.catalogo_fechamentos_offline(comercio_id,competencia,total_pedidos,total_comissao_centavos,status,vencimento_em)
 VALUES(p_comercio_id,v_comp,v_count,v_total,'faturado',(v_comp+interval '1 month 5 days')::date)
 ON CONFLICT(comercio_id,competencia) DO UPDATE SET total_pedidos=excluded.total_pedidos,total_comissao_centavos=excluded.total_comissao_centavos,
 status=CASE WHEN public.catalogo_fechamentos_offline.status IN ('vencido','bloqueado') THEN public.catalogo_fechamentos_offline.status ELSE 'faturado' END
 RETURNING id INTO v_id;
 DELETE FROM public.catalogo_fatura_componentes_v2 WHERE fechamento_id=v_id;
 INSERT INTO public.catalogo_fatura_componentes_v2(fechamento_id,pedido_id,tipo,valor_centavos)
 SELECT v_id,pedido_id,'plataforma',taxa_plataforma_centavos FROM public.catalogo_comissoes_offline WHERE comercio_id=p_comercio_id AND competencia=v_comp AND status NOT IN ('cancelada','contestada') AND EXISTS (
   SELECT 1 FROM public.catalogo_pedidos p
   WHERE p.id=public.catalogo_comissoes_offline.pedido_id
     AND p.comercio_id=public.catalogo_comissoes_offline.comercio_id
     AND p.provedor='offline'
     AND p.status='entregue'
     AND p.entrega_status='entregue'
     AND p.status_pagamento='aprovado'
     AND p.codigo_entrega_usado_em IS NOT NULL
 )
 UNION ALL SELECT v_id,pedido_id,'logistica',taxa_motoboy_centavos FROM public.catalogo_comissoes_offline WHERE comercio_id=p_comercio_id AND competencia=v_comp AND status NOT IN ('cancelada','contestada') AND EXISTS (
   SELECT 1 FROM public.catalogo_pedidos p
   WHERE p.id=public.catalogo_comissoes_offline.pedido_id
     AND p.comercio_id=public.catalogo_comissoes_offline.comercio_id
     AND p.provedor='offline'
     AND p.status='entregue'
     AND p.entrega_status='entregue'
     AND p.status_pagamento='aprovado'
     AND p.codigo_entrega_usado_em IS NOT NULL
 ) AND taxa_motoboy_centavos>0;
 UPDATE public.catalogo_comissoes_offline SET status='faturada' WHERE comercio_id=p_comercio_id AND competencia=v_comp AND status='aberta' AND EXISTS (
   SELECT 1 FROM public.catalogo_pedidos p
   WHERE p.id=public.catalogo_comissoes_offline.pedido_id
     AND p.comercio_id=public.catalogo_comissoes_offline.comercio_id
     AND p.provedor='offline'
     AND p.status='entregue'
     AND p.entrega_status='entregue'
     AND p.status_pagamento='aprovado'
     AND p.codigo_entrega_usado_em IS NOT NULL
 );
 UPDATE public.catalogo_logistica_offline_v2 SET status='faturada' WHERE comercio_id=p_comercio_id AND competencia=v_comp AND status='aberta' AND EXISTS (
   SELECT 1 FROM public.catalogo_pedidos p
   WHERE p.id=public.catalogo_logistica_offline_v2.pedido_id
     AND p.comercio_id=public.catalogo_logistica_offline_v2.comercio_id
     AND p.provedor='offline'
     AND p.status='entregue'
     AND p.entrega_status='entregue'
     AND p.status_pagamento='aprovado'
     AND p.codigo_entrega_usado_em IS NOT NULL
 );
 RETURN v_id;
END;
$function$

