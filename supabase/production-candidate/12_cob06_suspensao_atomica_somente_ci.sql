-- COB-06 / PR #39: suspensao atomica de saldo apos evento adverso.
-- EXCLUSIVAMENTE no Postgres efemero catalogo_cob06_ci. NUNCA STAGING/PROD.
-- Eventos do diario sao sinteticos; nao ha prova de webhook/GET Asaas aqui.
-- Nenhum estorno financeiro ou transferencia real e executado.
BEGIN;

CREATE FUNCTION catalogo_private.catalogo_asaas_suspender_lote_atomico_ci(
 p_lote uuid,p_evento_id bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $suspensao$
DECLARE
 v_comercio text;
 v_lote public.catalogo_asaas_acumulo_lotes%ROWTYPE;
 v_q public.catalogo_asaas_acumulo_quitacoes_isoladas%ROWTYPE;
 v_ref public.catalogo_asaas_acumulo_referencias%ROWTYPE;
 v_obs public.catalogo_asaas_acumulo_observacoes%ROWTYPE;
 v_ev public.catalogo_asaas_acumulo_eventos%ROWTYPE;
 v_estado_alvo text;
 v_qtd bigint;
 v_pedidos bigint;
 v_comissoes bigint;
 v_invalidos bigint;
 v_alterados bigint;
 v_creditos_expostos bigint;
BEGIN
 IF pg_catalog.current_database() IS DISTINCT FROM 'catalogo_cob06_ci'
    OR pg_catalog.inet_server_port() IS DISTINCT FROM 5432
    OR current_user IS DISTINCT FROM 'postgres'
 THEN RAISE EXCEPTION 'COB06_CI_ONLY: suspensao proibida fora da CI'
      USING ERRCODE='42501'; END IF;
 IF p_lote IS NULL OR p_evento_id IS NULL THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','argumentos_invalidos');
 END IF;

 SELECT comercio_id INTO v_comercio FROM public.catalogo_asaas_acumulo_lotes
 WHERE id=p_lote;
 IF NOT FOUND THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','lote_inexistente');
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('catalogo-fatura:'||v_comercio,0));
 SELECT * INTO v_lote FROM public.catalogo_asaas_acumulo_lotes
 WHERE id=p_lote FOR UPDATE;
 SELECT * INTO v_q FROM public.catalogo_asaas_acumulo_quitacoes_isoladas
 WHERE lote_id=p_lote FOR UPDATE;
 IF v_lote.comercio_id IS DISTINCT FROM v_comercio
    OR v_lote.estado IS DISTINCT FROM 'pago'
    OR v_q.lote_id IS NULL OR v_q.estado IS DISTINCT FROM 'pago'
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','quitacao_nao_ativa'); END IF;

 -- Serializar com observacoes e novos eventos, e travar origens originais.
 SELECT * INTO v_ref FROM public.catalogo_asaas_acumulo_referencias
 WHERE lote_id=p_lote FOR UPDATE;
 SELECT * INTO v_obs FROM public.catalogo_asaas_acumulo_observacoes
 WHERE lote_id=p_lote FOR UPDATE;
 SELECT * INTO v_ev FROM public.catalogo_asaas_acumulo_eventos
 WHERE id=p_evento_id AND lote_id=p_lote FOR UPDATE;
 IF v_ref.lote_id IS NULL OR v_obs.lote_id IS NULL OR v_ev.id IS NULL
    OR v_ev.payment_id IS DISTINCT FROM v_q.payment_id
    OR v_obs.payment_id IS DISTINCT FROM v_q.payment_id
    OR v_ref.referencia IS DISTINCT FROM v_obs.referencia
    OR v_ref.valor_centavos IS DISTINCT FROM v_q.valor_centavos
    OR v_obs.valor_centavos IS DISTINCT FROM v_q.valor_centavos
    OR v_lote.total_centavos IS DISTINCT FROM v_q.valor_centavos
    OR v_ev.estado NOT IN (
      'REFUNDED','PARTIALLY_REFUNDED','REFUND_IN_PROGRESS',
      'CHARGEBACK_REQUESTED','DELETED')
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','evento_adverso_nao_vinculado'); END IF;
 v_estado_alvo:=CASE WHEN v_ev.estado='REFUNDED' THEN 'estornado' ELSE 'contestado' END;

 PERFORM 1 FROM public.catalogo_fechamentos_offline f
 JOIN public.catalogo_asaas_acumulo_fontes af ON af.fechamento_id=f.id
 WHERE af.lote_id=p_lote ORDER BY f.id FOR UPDATE OF f;
 PERFORM 1 FROM public.catalogo_comissoes_offline c
 WHERE c.comercio_id=v_comercio AND EXISTS (
    SELECT 1 FROM public.catalogo_asaas_acumulo_fontes af
    JOIN public.catalogo_fatura_componentes_v2 cp ON cp.fechamento_id=af.fechamento_id
    WHERE af.lote_id=p_lote AND cp.pedido_id=c.pedido_id)
 ORDER BY c.pedido_id FOR UPDATE OF c;

 SELECT pg_catalog.count(*),coalesce(pg_catalog.sum(af.valor_centavos),0),
        pg_catalog.count(*) FILTER (WHERE
          f.id IS NULL OR f.comercio_id IS DISTINCT FROM v_comercio
          OR f.competencia IS DISTINCT FROM af.competencia
          OR f.total_comissao_centavos IS DISTINCT FROM af.valor_centavos
          OR f.status IS DISTINCT FROM 'pago'
          OR f.referencia_pagamento IS DISTINCT FROM v_ref.referencia
          OR f.pago_em IS NULL
          OR EXISTS(SELECT 1 FROM public.catalogo_fatura_cobrancas b
                    WHERE b.fechamento_id=af.fechamento_id)
          OR (SELECT coalesce(pg_catalog.sum(cp.valor_centavos),0)
              FROM public.catalogo_fatura_componentes_v2 cp
              WHERE cp.fechamento_id=af.fechamento_id) IS DISTINCT FROM af.valor_centavos)
 INTO v_qtd,v_alterados,v_invalidos
 FROM public.catalogo_asaas_acumulo_fontes af
 LEFT JOIN public.catalogo_fechamentos_offline f ON f.id=af.fechamento_id
 WHERE af.lote_id=p_lote;
 IF v_qtd<2 OR v_alterados IS DISTINCT FROM v_q.valor_centavos OR v_invalidos<>0
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','origens_quitadas_inconsistentes'); END IF;

 SELECT pg_catalog.count(DISTINCT cp.pedido_id),
        pg_catalog.count(DISTINCT c.pedido_id) FILTER (WHERE
         c.status='paga' AND c.comercio_id=v_comercio
         AND c.referencia_pagamento=v_ref.referencia AND c.pago_em IS NOT NULL)
 INTO v_pedidos,v_comissoes
 FROM public.catalogo_asaas_acumulo_fontes af
 JOIN public.catalogo_fatura_componentes_v2 cp ON cp.fechamento_id=af.fechamento_id
 LEFT JOIN public.catalogo_comissoes_offline c ON c.pedido_id=cp.pedido_id
 WHERE af.lote_id=p_lote;
 IF v_pedidos<1 OR v_comissoes IS DISTINCT FROM v_pedidos THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','comissoes_quitadas_inconsistentes'); END IF;

 -- Primeiro revoga a prova isolada; triggers existentes veem o financiamento
 -- como falso ao alterar os status das faturas e comissoes.
 UPDATE public.catalogo_asaas_acumulo_quitacoes_isoladas
 SET estado=v_estado_alvo WHERE lote_id=p_lote AND estado='pago';
 GET DIAGNOSTICS v_alterados = ROW_COUNT;
 IF v_alterados<>1 THEN
  RAISE EXCEPTION 'COB06_SUSPENSAO: recibo nao atualizado' USING ERRCODE='23514'; END IF;
 UPDATE public.catalogo_asaas_acumulo_lotes
 SET estado=v_estado_alvo WHERE id=p_lote AND estado='pago';
 GET DIAGNOSTICS v_alterados = ROW_COUNT;
 IF v_alterados<>1 THEN
  RAISE EXCEPTION 'COB06_SUSPENSAO: lote nao atualizado' USING ERRCODE='23514'; END IF;

 -- Bloqueio, nao nova divida nem nova cobranca: conservar pago_em/referencia
 -- para auditoria. Fontes seguem reservadas; regularizacao exige revisao.
 UPDATE public.catalogo_fechamentos_offline f SET status='bloqueado'
 WHERE f.id IN(SELECT af.fechamento_id FROM public.catalogo_asaas_acumulo_fontes af
               WHERE af.lote_id=p_lote) AND f.status='pago';
 GET DIAGNOSTICS v_alterados = ROW_COUNT;
 IF v_alterados IS DISTINCT FROM v_qtd THEN
  RAISE EXCEPTION 'COB06_SUSPENSAO: faturas parcialmente bloqueadas' USING ERRCODE='23514'; END IF;

 UPDATE public.catalogo_comissoes_offline c SET status='contestada'
 WHERE c.comercio_id=v_comercio AND c.status='paga'
   AND EXISTS (
     SELECT 1 FROM public.catalogo_asaas_acumulo_fontes af
     JOIN public.catalogo_fatura_componentes_v2 cp ON cp.fechamento_id=af.fechamento_id
     WHERE af.lote_id=p_lote AND cp.pedido_id=c.pedido_id);
 GET DIAGNOSTICS v_alterados = ROW_COUNT;
 IF v_alterados IS DISTINCT FROM v_pedidos THEN
  RAISE EXCEPTION 'COB06_SUSPENSAO: comissoes parcialmente contestadas' USING ERRCODE='23514'; END IF;

 -- Se ja houve saque, o legado marca pendencia_revisao e cria ajuste
 -- negativo em livro, mas NAO desfaz transferencia financeira.
 SELECT pg_catalog.count(*) INTO v_creditos_expostos
 FROM public.catalogo_asaas_acumulo_fontes af
 JOIN public.catalogo_fatura_componentes_v2 cp ON cp.fechamento_id=af.fechamento_id
 LEFT JOIN public.catalogo_remuneracoes_v2 r ON r.pedido_id=cp.pedido_id
 LEFT JOIN public.catalogo_lancamentos_financeiros_v2 l
   ON l.pedido_id=cp.pedido_id
   AND l.tipo=CASE WHEN cp.tipo='plataforma' THEN 'comissao_plataforma'
                   ELSE 'remuneracao_motoboy' END
 WHERE af.lote_id=p_lote AND (
   catalogo_private.catalogo_v2_parcela_recebida(cp.pedido_id,cp.tipo)
   OR catalogo_private.catalogo_v2_financiado(cp.pedido_id)
   OR l.id IS NULL OR l.status='disponivel'
   OR (cp.tipo='logistica' AND
       (r.id IS NULL OR r.status='disponivel'
        OR r.financiamento_comprovado=true))
 );
 IF v_creditos_expostos<>0 THEN
  RAISE EXCEPTION 'COB06_SUSPENSAO: saldos ainda disponiveis' USING ERRCODE='23514'; END IF;
 RETURN pg_catalog.jsonb_build_object('ok',true,'lote_id',p_lote,
   'estado',v_estado_alvo,'evento',v_ev.estado,'competencias',v_qtd,
   'pedidos',v_pedidos,'transferencias_compensadas',false,
   'prova_bancaria_real',false);
END;
$suspensao$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_suspender_lote_atomico_ci(uuid,bigint)
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
