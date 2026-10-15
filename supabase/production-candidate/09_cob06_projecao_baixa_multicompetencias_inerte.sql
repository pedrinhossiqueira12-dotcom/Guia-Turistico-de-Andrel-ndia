-- COB-06 / PR39: PROJECAO de baixa por fonte e por parcela, SOMENTE LEITURA.
-- Aplicar apenas na CI descartavel depois dos candidatos 03-08.
-- O helper legado catalogo_v2_parcela_recebida depende de uma cobranca
-- individual PAGA por competencia. Esta projecao nao cria cobrancas falsas,
-- nao marca fechamento pago e nao muda credito/saque/repasse.
BEGIN;

CREATE FUNCTION public.catalogo_asaas_projetar_baixa_acumulo_inerte(
 p_lote uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $projetar$
DECLARE
 v_apuracao jsonb;
 v_origens jsonb;
 v_qtd bigint:=0;
 v_total bigint:=0;
 v_plataforma bigint:=0;
 v_logistica bigint:=0;
 v_pedidos bigint:=0;
 v_parcelas bigint:=0;
 v_falhas bigint:=0;
 v_ja_liberadas bigint:=0;
 v_consistente boolean:=false;
BEGIN
 v_apuracao:=public.catalogo_asaas_apurar_estados_acumulo_inerte(p_lote);
 IF v_apuracao->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_apuracao; END IF;

 -- Cada linha de componente representa uma parcela EXATA da fatura original.
 -- LATERAL evita multiplicar valores quando existem lancamentos duplicados.
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'fechamento_id',z.fechamento_id,'competencia',z.competencia,
    'total_centavos',z.total_centavos,'plataforma_centavos',z.plataforma,
    'logistica_centavos',z.logistica,'pedidos',z.pedidos,
    'parcelas_sem_credito_seguro',z.falhas,
    'parcelas_ja_liberadas',z.ja_liberadas
 ) ORDER BY z.competencia,z.fechamento_id),'[]'::jsonb),
 pg_catalog.count(*),coalesce(pg_catalog.sum(z.total_centavos),0),
 coalesce(pg_catalog.sum(z.plataforma),0),coalesce(pg_catalog.sum(z.logistica),0),
 coalesce(pg_catalog.sum(z.pedidos),0),coalesce(pg_catalog.sum(z.parcelas),0),
 coalesce(pg_catalog.sum(z.falhas),0),coalesce(pg_catalog.sum(z.ja_liberadas),0)
 INTO v_origens,v_qtd,v_total,v_plataforma,v_logistica,v_pedidos,v_parcelas,
      v_falhas,v_ja_liberadas
 FROM (
   SELECT af.fechamento_id,af.competencia,af.valor_centavos AS total_centavos,
     coalesce(pg_catalog.sum(fc.valor_centavos) FILTER (WHERE fc.tipo='plataforma'),0) AS plataforma,
     coalesce(pg_catalog.sum(fc.valor_centavos) FILTER (WHERE fc.tipo='logistica'),0) AS logistica,
     pg_catalog.count(DISTINCT fc.pedido_id) AS pedidos,
     pg_catalog.count(*) AS parcelas,
     pg_catalog.count(*) FILTER(WHERE
       p.versao_financeira IS DISTINCT FROM 2 OR c.pedido_id IS NULL
       OR c.status NOT IN ('faturada','bloqueado')
       OR CASE WHEN fc.tipo='plataforma' THEN
         lp.qtd IS DISTINCT FROM 1 OR lp.retidas IS DISTINCT FROM 1
         ELSE fc.tipo IS DISTINCT FROM 'logistica'
           OR r.id IS NULL OR r.valor_centavos IS DISTINCT FROM fc.valor_centavos
           OR r.status IS DISTINCT FROM 'retido'
           OR r.repasse_id IS NOT NULL OR r.financiamento_comprovado IS DISTINCT FROM false
           OR c.motoboy_id IS DISTINCT FROM r.motoboy_id
           OR lm.qtd IS DISTINCT FROM 1 OR lm.retidas IS DISTINCT FROM 1
       END
     ) AS falhas,
     pg_catalog.count(*) FILTER(WHERE
       lp.liberadas>0 OR lm.liberadas>0
       OR (fc.tipo='logistica' AND (r.status IN ('disponivel','pago') OR r.repasse_id IS NOT NULL))
     ) AS ja_liberadas
   FROM public.catalogo_asaas_acumulo_fontes af
   JOIN public.catalogo_fatura_componentes_v2 fc ON fc.fechamento_id=af.fechamento_id
   LEFT JOIN public.catalogo_pedidos p ON p.id=fc.pedido_id
   LEFT JOIN public.catalogo_comissoes_offline c
     ON c.pedido_id=fc.pedido_id AND c.comercio_id=p.comercio_id
        AND c.competencia=af.competencia
   LEFT JOIN public.catalogo_remuneracoes_v2 r ON r.pedido_id=fc.pedido_id
   LEFT JOIN LATERAL (
     SELECT pg_catalog.count(*) AS qtd,
       pg_catalog.count(*) FILTER(WHERE l.status='retido'
         AND l.valor_centavos=fc.valor_centavos) AS retidas,
       pg_catalog.count(*) FILTER(WHERE l.status IN ('disponivel','pago')) AS liberadas
     FROM public.catalogo_lancamentos_financeiros_v2 l
     WHERE l.pedido_id=fc.pedido_id AND l.tipo='comissao_plataforma'
   ) lp ON fc.tipo='plataforma'
   LEFT JOIN LATERAL (
     SELECT pg_catalog.count(*) AS qtd,
       pg_catalog.count(*) FILTER(WHERE l.status='retido'
         AND l.valor_centavos=fc.valor_centavos AND l.remuneracao_id=r.id) AS retidas,
       pg_catalog.count(*) FILTER(WHERE l.status IN ('disponivel','pago')) AS liberadas
     FROM public.catalogo_lancamentos_financeiros_v2 l
     WHERE l.pedido_id=fc.pedido_id AND l.tipo='remuneracao_motoboy'
   ) lm ON fc.tipo='logistica'
   WHERE af.lote_id=p_lote
   GROUP BY af.fechamento_id,af.competencia,af.valor_centavos
 ) z;

 v_consistente:=v_apuracao->>'integridade_contabil_ok'='true'
  AND v_apuracao->>'identidade_local_ok'='true'
  AND v_qtd>=2 AND v_parcelas>0 AND v_falhas=0 AND v_ja_liberadas=0
  AND v_total=(v_apuracao->>'valor_centavos')::bigint
  AND v_plataforma+v_logistica=v_total;

 RETURN pg_catalog.jsonb_build_object(
  'ok',true,'lote_id',p_lote,'valor_centavos',v_total,
  'plataforma_centavos',v_plataforma,'logistica_centavos',v_logistica,
  'quantidade_competencias',v_qtd,'pedidos',v_pedidos,'parcelas',v_parcelas,
  'parcelas_sem_credito_seguro',v_falhas,'parcelas_ja_liberadas',v_ja_liberadas,
  'origens',v_origens,'projecao_contabil_consistente',v_consistente,
  'recebimento_observado_sem_prova_autonoma',
    (v_apuracao->>'candidato_a_conferencia_manual'='true'),
  'exige_revisao',v_apuracao->'exige_revisao',
  'helper_legado_incompativel_sem_cobranca_individual',true,
  'motivo','conciliacao_multi_competencia_e_prova_bancaria_ainda_nao_habilitadas',
  'pode_quitar',false,'pode_estornar',false,'pode_liberar_motoboy',false,
  'pode_emitir_pix',false
 );
END;
$projetar$;

REVOKE ALL ON FUNCTION public.catalogo_asaas_projetar_baixa_acumulo_inerte(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_projetar_baixa_acumulo_inerte(uuid)
 TO service_role;
COMMIT;
