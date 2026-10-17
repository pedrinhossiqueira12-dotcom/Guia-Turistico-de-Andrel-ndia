-- Emergencia / COB-06: restaurar EXATAMENTE as funcoes anteriores ao deploy QA.
-- Executar somente em Supabase STAGING jbttwihctuibchhcyqtl sob revisao humana.
-- NAO executar com pedidos novos em 2027-03-01: exigiria reconciliacao primeiro.
DO $rollback_guard$
BEGIN
 IF pg_catalog.current_database()<>'postgres' OR current_user<>'postgres'
 OR NOT EXISTS(SELECT 1 FROM public.catalogo_fechamentos_offline WHERE
   comercio_id='asaas-cob02' AND competencia='2027-02-01' AND status='faturado'
   AND total_comissao_centavos=280)
 OR EXISTS(SELECT 1 FROM public.catalogo_comissoes_offline WHERE
   comercio_id='asaas-cob02' AND competencia='2027-03-01')
 OR pg_catalog.strpos(pg_catalog.pg_get_functiondef(
     'catalogo_private.catalogo_v2_registrar_plataforma(uuid,text)'::regprocedure),
     'COB06_STAGING_COMPETENCIA')=0
 THEN RAISE EXCEPTION 'COB06_STAGING_ROLLBACK: base mudou, revisao manual obrigatoria'; END IF;
END;
$rollback_guard$;
DROP TRIGGER catalogo_cob06_realocar_entrega_congelada_staging ON public.catalogo_pedidos;
DROP FUNCTION catalogo_private.catalogo_cob06_realocar_entrega_congelada_staging();

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_v2_registrar_plataforma(p_pedido_id uuid, p_origem text DEFAULT 'aceite'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_pedido public.catalogo_pedidos%ROWTYPE;
  v_recebido boolean;
  v_comp date;
BEGIN
  SELECT * INTO v_pedido
    FROM public.catalogo_pedidos
   WHERE id = p_pedido_id
   FOR UPDATE;

  IF NOT FOUND OR v_pedido.versao_financeira <> 2 THEN RETURN false; END IF;
  IF v_pedido.aceito_em IS NULL THEN RETURN false; END IF;

  v_recebido := catalogo_private.catalogo_v2_financiado(v_pedido.id)
    OR (
      v_pedido.provedor = 'offline'
      AND catalogo_private.catalogo_v2_parcela_recebida(v_pedido.id,'plataforma')
    );

  IF v_pedido.taxa_plataforma_centavos > 0 THEN
    INSERT INTO public.catalogo_lancamentos_financeiros_v2(
      pedido_id,tipo,valor_centavos,status,chave_idempotencia,referencia,metadata
    )
    VALUES(
      v_pedido.id,'comissao_plataforma',v_pedido.taxa_plataforma_centavos,
      CASE WHEN v_recebido THEN 'disponivel' ELSE 'retido' END,
      'plataforma:'||v_pedido.id::text,p_origem,
      jsonb_build_object(
        'versao_financeira',2,
        'origem',p_origem,
        'recebimento_plataforma',v_recebido
      )
    )
    ON CONFLICT(chave_idempotencia) DO UPDATE
      SET status = CASE
        WHEN public.catalogo_lancamentos_financeiros_v2.status IN ('retido','pendencia_revisao')
             AND v_recebido
        THEN 'disponivel'
        ELSE public.catalogo_lancamentos_financeiros_v2.status
      END,
      atualizado_em = pg_catalog.now();
  END IF;

  IF v_pedido.provedor = 'offline' THEN
    v_comp := date_trunc(
      'month',
      v_pedido.aceito_em AT TIME ZONE 'America/Sao_Paulo'
    )::date;

    WHILE EXISTS(
      SELECT 1
        FROM public.catalogo_fechamentos_offline f
       WHERE f.comercio_id = v_pedido.comercio_id
         AND f.competencia = v_comp
         AND (
           f.status = 'pago'
           OR EXISTS(
             SELECT 1
               FROM public.catalogo_fatura_cobrancas b
              WHERE b.fechamento_id = f.id
           )
         )
    ) LOOP
      v_comp := (v_comp + interval '1 month')::date;
    END LOOP;

    INSERT INTO public.catalogo_comissoes_offline(
      pedido_id,comercio_id,competencia,subtotal_produtos_centavos,
      taxa_percentual,valor_comissao_centavos,versao_financeira,modalidade,
      taxa_plataforma_centavos,taxa_motoboy_centavos,valor_total_centavos,metadata
    )
    VALUES(
      v_pedido.id,v_pedido.comercio_id,v_comp,v_pedido.subtotal_produtos_centavos,
      7.00,v_pedido.taxa_total_centavos,2,v_pedido.modalidade,
      v_pedido.taxa_plataforma_centavos,v_pedido.taxa_motoboy_centavos,
      v_pedido.taxa_total_centavos,
      jsonb_build_object(
        'origem','aceite',
        'snapshot',true,
        'reserva_logistica',v_pedido.taxa_motoboy_centavos > 0
      )
    )
    ON CONFLICT(pedido_id) DO NOTHING;

    IF v_pedido.taxa_motoboy_centavos > 0 THEN
      INSERT INTO public.catalogo_logistica_offline_v2(
        pedido_id,comercio_id,competencia,valor_centavos
      )
      VALUES(
        v_pedido.id,v_pedido.comercio_id,v_comp,v_pedido.taxa_motoboy_centavos
      )
      ON CONFLICT(pedido_id) DO NOTHING;
    END IF;
  END IF;

  IF v_pedido.taxa_motoboy_centavos > 0 THEN
    INSERT INTO public.catalogo_lancamentos_financeiros_v2(
      pedido_id,tipo,valor_centavos,status,chave_idempotencia,metadata
    )
    VALUES(
      v_pedido.id,'reserva_logistica',v_pedido.taxa_motoboy_centavos,'retido',
      'reserva:'||v_pedido.id::text,
      jsonb_build_object(
        'reserva_nao_receita',true,
        'remuneracao_exige_codigo',true
      )
    )
    ON CONFLICT(chave_idempotencia) DO NOTHING;
  END IF;

  UPDATE public.catalogo_pedidos
     SET comissao_plataforma_registrada = true
   WHERE id = v_pedido.id;

  RETURN true;
END;
$function$
;

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
;
