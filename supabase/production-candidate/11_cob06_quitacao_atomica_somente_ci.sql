-- COB-06 / PR #39: ensaio de BAIXA ATOMICA multi-competencias.
-- EXCLUSIVAMENTE no banco efemero catalogo_cob06_ci: NUNCA instalar no STAGING/PROD.
-- Mesmo que copiado por engano, a funcao recusa qualquer outro banco/usuario.
-- O recibo/evento sao SINTETICOS: nenhum parametro SQL prova autenticidade Asaas.
-- So o dono postgres na CI pode executar; nenhuma Edge, RPC publica ou Pix.
BEGIN;

CREATE FUNCTION catalogo_private.catalogo_asaas_quitar_lote_atomico_ci(
 p_lote uuid,p_evento_id bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $quitacao$
DECLARE
 v_comercio text;
 v_lote public.catalogo_asaas_acumulo_lotes%ROWTYPE;
 v_ref public.catalogo_asaas_acumulo_referencias%ROWTYPE;
 v_obs public.catalogo_asaas_acumulo_observacoes%ROWTYPE;
 v_ev public.catalogo_asaas_acumulo_eventos%ROWTYPE;
 v_apuracao jsonb;
 v_preflight jsonb;
 v_projecao jsonb;
 v_qtd bigint;
 v_pedidos bigint;
 v_alterados bigint;
 v_creditos_invalidos bigint;
BEGIN
 IF pg_catalog.current_database() IS DISTINCT FROM 'catalogo_cob06_ci'
    OR pg_catalog.inet_server_port() IS DISTINCT FROM 5432
    OR current_user IS DISTINCT FROM 'postgres'
 THEN RAISE EXCEPTION 'COB06_CI_ONLY: quitação proibida fora da CI'
      USING ERRCODE='42501'; END IF;
 IF p_lote IS NULL OR p_evento_id IS NULL THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','argumentos_invalidos');
 END IF;

 -- Mesma ordem de trava da reserva mensal: comercio, lote, origens, comissoes.
 SELECT comercio_id INTO v_comercio
 FROM public.catalogo_asaas_acumulo_lotes WHERE id=p_lote;
 IF NOT FOUND THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','lote_inexistente');
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('catalogo-fatura:'||v_comercio,0));
 SELECT * INTO v_lote FROM public.catalogo_asaas_acumulo_lotes
 WHERE id=p_lote FOR UPDATE;
 IF v_lote.comercio_id IS DISTINCT FROM v_comercio
    OR v_lote.estado NOT IN ('preparado','emitido') THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','lote_nao_aberto');
 END IF;
 PERFORM 1 FROM public.catalogo_fechamentos_offline f
 JOIN public.catalogo_asaas_acumulo_fontes af ON af.fechamento_id=f.id
 WHERE af.lote_id=p_lote ORDER BY f.id FOR UPDATE OF f;
 PERFORM 1 FROM public.catalogo_comissoes_offline c
 WHERE EXISTS(
  SELECT 1 FROM public.catalogo_asaas_acumulo_fontes af
  WHERE af.lote_id=p_lote AND af.competencia=c.competencia
    AND c.comercio_id=v_lote.comercio_id)
 ORDER BY c.pedido_id FOR UPDATE OF c;

 IF EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_quitacoes_isoladas
           WHERE lote_id=p_lote) THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','quitacao_ja_existente');
 END IF;
 SELECT * INTO v_ref FROM public.catalogo_asaas_acumulo_referencias
 WHERE lote_id=p_lote FOR UPDATE;
 SELECT * INTO v_obs FROM public.catalogo_asaas_acumulo_observacoes
 WHERE lote_id=p_lote FOR UPDATE;
 SELECT * INTO v_ev FROM public.catalogo_asaas_acumulo_eventos
 WHERE id=p_evento_id AND lote_id=p_lote FOR UPDATE;
 IF v_ref.lote_id IS NULL OR v_obs.lote_id IS NULL OR v_ev.id IS NULL
    OR v_ev.estado IS DISTINCT FROM 'RECEIVED'
    OR v_ev.payment_id IS DISTINCT FROM v_obs.payment_id
    OR v_obs.referencia IS DISTINCT FROM v_ref.referencia
    OR v_obs.valor_centavos IS DISTINCT FROM v_lote.total_centavos
    OR v_ref.valor_centavos IS DISTINCT FROM v_lote.total_centavos
    OR v_ref.comercio_id IS DISTINCT FROM v_lote.comercio_id
    OR v_ref.payment_id IS NOT NULL
    OR v_ref.pode_emitir_pix IS DISTINCT FROM false
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','comprovante_inconsistente'); END IF;

 v_preflight:=public.catalogo_asaas_conferir_conciliacao_acumulo(p_lote);
 v_apuracao:=public.catalogo_asaas_apurar_estados_acumulo_inerte(p_lote);
 v_projecao:=public.catalogo_asaas_projetar_baixa_acumulo_inerte(p_lote);
 IF v_preflight->>'integridade_contabil_ok' IS DISTINCT FROM 'true'
    OR v_apuracao->>'candidato_a_conferencia_manual' IS DISTINCT FROM 'true'
    OR (v_apuracao->>'ultimo_evento_id')::bigint IS DISTINCT FROM p_evento_id
    OR v_projecao->>'projecao_contabil_consistente' IS DISTINCT FROM 'true'
    OR (v_projecao->>'valor_centavos')::bigint IS DISTINCT FROM v_lote.total_centavos
    OR (v_projecao->>'quantidade_competencias')::bigint < 2
    OR (v_projecao->>'parcelas_ja_liberadas')::bigint <> 0
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','preflight_ou_livro_de_creditos_incompleto'); END IF;

 SELECT pg_catalog.count(*) INTO v_qtd FROM public.catalogo_asaas_acumulo_fontes
 WHERE lote_id=p_lote;
 -- Somente pedidos faturados no snapshot; outros pedidos da mesma
 -- competencia nao devem bloquear a baixa nem ser quitados.
 SELECT pg_catalog.count(DISTINCT c.pedido_id) INTO v_pedidos
 FROM public.catalogo_asaas_acumulo_fontes af
 JOIN public.catalogo_fatura_componentes_v2 cp
   ON cp.fechamento_id=af.fechamento_id
 JOIN public.catalogo_comissoes_offline c
   ON c.pedido_id=cp.pedido_id
  AND c.comercio_id=v_lote.comercio_id
  AND c.competencia=af.competencia
 WHERE af.lote_id=p_lote;
 IF v_qtd IS DISTINCT FROM (v_projecao->>'quantidade_competencias')::bigint
    OR v_pedidos IS DISTINCT FROM (v_projecao->>'pedidos')::bigint
    OR v_pedidos<1 THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','quantidades_divergentes');
 END IF;

 -- O INSERT vem primeiro: triggers legados so reconhecem pagamento quando
 -- o recibo unico E TODAS as faturas/comissoes originais estao pagas.
 -- Qualquer erro posterior LANCARA EXCECAO e desfara TUDO na mesma instrucao.
 INSERT INTO public.catalogo_asaas_acumulo_quitacoes_isoladas(
  lote_id,payment_id,evento_recebimento_id,valor_centavos)
 VALUES(p_lote,v_obs.payment_id,p_evento_id,v_lote.total_centavos);

 UPDATE public.catalogo_fechamentos_offline f
 SET status='pago',pago_em=pg_catalog.now(),
     referencia_pagamento=v_ref.referencia
 WHERE f.id IN(SELECT af.fechamento_id FROM public.catalogo_asaas_acumulo_fontes af
               WHERE af.lote_id=p_lote)
 AND f.status IN ('faturado','vencido','bloqueado');
 GET DIAGNOSTICS v_alterados = ROW_COUNT;
 IF v_alterados IS DISTINCT FROM v_qtd THEN
  RAISE EXCEPTION 'COB06_ATOMICO: fechamento parcial, abortar tudo'
    USING ERRCODE='23514'; END IF;

 UPDATE public.catalogo_comissoes_offline c
 SET status='paga',pago_em=pg_catalog.now(),
     referencia_pagamento=v_ref.referencia
 WHERE c.comercio_id=v_lote.comercio_id
 AND c.status IN ('faturada','aberta','bloqueado')
 AND EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_fontes af
            JOIN public.catalogo_fatura_componentes_v2 cp
              ON cp.fechamento_id=af.fechamento_id
            WHERE af.lote_id=p_lote AND cp.pedido_id=c.pedido_id
              AND af.competencia=c.competencia);
 GET DIAGNOSTICS v_alterados = ROW_COUNT;
 IF v_alterados IS DISTINCT FROM v_pedidos THEN
  RAISE EXCEPTION 'COB06_ATOMICO: comissoes parciais, abortar tudo'
    USING ERRCODE='23514'; END IF;

 UPDATE public.catalogo_asaas_acumulo_lotes
 SET estado='pago' WHERE id=p_lote;
 -- Revalidar TODOS os creditos apos disparar os triggers legados. Nenhum
 -- pedido pode ficar pago com saldo incompleto ou liberacao apenas parcial.
 SELECT pg_catalog.count(*) INTO v_creditos_invalidos
 FROM public.catalogo_asaas_acumulo_fontes af
 JOIN public.catalogo_fatura_componentes_v2 cp ON cp.fechamento_id=af.fechamento_id
 LEFT JOIN public.catalogo_remuneracoes_v2 r ON r.pedido_id=cp.pedido_id
 LEFT JOIN public.catalogo_lancamentos_financeiros_v2 l
   ON l.pedido_id=cp.pedido_id
   AND l.tipo=CASE WHEN cp.tipo='plataforma' THEN 'comissao_plataforma'
                   ELSE 'remuneracao_motoboy' END
 WHERE af.lote_id=p_lote AND (
   NOT catalogo_private.catalogo_v2_parcela_recebida(cp.pedido_id,cp.tipo)
   OR NOT catalogo_private.catalogo_v2_financiado(cp.pedido_id)
   OR l.id IS NULL OR l.status IS DISTINCT FROM 'disponivel'
   OR l.valor_centavos IS DISTINCT FROM cp.valor_centavos
   OR (cp.tipo='logistica' AND (r.id IS NULL OR r.status IS DISTINCT FROM 'disponivel'
     OR r.financiamento_comprovado IS DISTINCT FROM true
     OR r.valor_centavos IS DISTINCT FROM cp.valor_centavos))
 );
 IF v_creditos_invalidos<>0 THEN
  RAISE EXCEPTION 'COB06_ATOMICO: credito incompleto, abortar tudo'
    USING ERRCODE='23514'; END IF;
 RETURN pg_catalog.jsonb_build_object('ok',true,
   'lote_id',p_lote,'competencias',v_qtd,'pedidos',v_pedidos,
   'valor_centavos',v_lote.total_centavos,
   'prova_bancaria_real',false,'transferencias_autorizadas',false);
END;
$quitacao$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_quitar_lote_atomico_ci(uuid,bigint)
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
