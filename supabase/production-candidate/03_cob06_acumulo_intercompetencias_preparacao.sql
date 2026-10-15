-- COB-06: candidato INERTE. Nao usar como migracao produtiva.
-- PRIMEIRO gate: estrutura de vinculos + previsualizacao de saldos.
-- Nao cria pagamentos, nao concede INSERT nem cria RPC de emissao/quitacao.
-- Exige pacote minimo de 9 SQL ANTES desta preparacao.
BEGIN;

CREATE TABLE public.catalogo_asaas_acumulo_lotes (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 comercio_id text NOT NULL REFERENCES public.catalogos(comercio_id) ON DELETE RESTRICT,
 competencia_corte date NOT NULL,
 total_centavos bigint NOT NULL CHECK (total_centavos >= 500),
 estado text NOT NULL DEFAULT 'preparado'
   CHECK (estado IN ('preparado','emitido','pago','estornado','contestado','revisao')),
 criado_em timestamptz NOT NULL DEFAULT pg_catalog.now(),
 UNIQUE (comercio_id, competencia_corte),
 CONSTRAINT catalogo_acumulo_competencia_primeiro_dia
   CHECK (pg_catalog.extract(day FROM competencia_corte)=1)
);

-- Uma fatura de origem nunca pode pertencer a dois lotes diferentes.
-- Nao duplicar componentes nem mudar as competencias originais.
CREATE TABLE public.catalogo_asaas_acumulo_fontes (
 fechamento_id uuid PRIMARY KEY
   REFERENCES public.catalogo_fechamentos_offline(id) ON DELETE RESTRICT,
 lote_id uuid NOT NULL
   REFERENCES public.catalogo_asaas_acumulo_lotes(id) ON DELETE RESTRICT,
 competencia date NOT NULL,
 valor_centavos integer NOT NULL CHECK (valor_centavos > 0),
 criado_em timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE INDEX catalogo_asaas_acumulo_fontes_lote_idx
 ON public.catalogo_asaas_acumulo_fontes(lote_id);

ALTER TABLE public.catalogo_asaas_acumulo_lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_asaas_acumulo_fontes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_asaas_acumulo_lotes,
 public.catalogo_asaas_acumulo_fontes FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.catalogo_asaas_acumulo_lotes,
 public.catalogo_asaas_acumulo_fontes TO service_role;

-- Apenas diagnostico de elegibilidade. NENHUMA reserva bancária.
-- Faturas com cobranca/claim existente, quitadas ou ja agrupadas nao entram.
-- A soma de componentes precisa bater exatamente com cada fechamento.
CREATE FUNCTION public.catalogo_asaas_previsualizar_acumulo(
 p_comercio text,p_competencia_corte date
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $preview$
DECLARE
 v_fontes jsonb := '[]'::jsonb;
 v_total bigint := 0;
 v_count bigint := 0;
 v_pequenas bigint := 0;
 v_inconsistentes bigint := 0;
BEGIN
 IF p_comercio IS NULL OR pg_catalog.length(p_comercio)=0
    OR pg_catalog.length(p_comercio)>180
    OR p_competencia_corte IS NULL
    OR pg_catalog.extract(day FROM p_competencia_corte)<>1 THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','argumentos_invalidos');
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.catalogos
                 WHERE comercio_id=p_comercio) THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','comercio_inexistente');
 END IF;
 SELECT
   coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('fechamento_id',c.id,
        'competencia',c.competencia,'valor_centavos',c.total_comissao_centavos)
      ORDER BY c.competencia,c.id), '[]'::jsonb),
   pg_catalog.count(*),
   coalesce(pg_catalog.sum(c.total_comissao_centavos),0),
   pg_catalog.count(*) FILTER (WHERE c.total_comissao_centavos<500),
   pg_catalog.count(*) FILTER (WHERE c.componentes_count=0
                         OR c.componentes_soma<>c.total_comissao_centavos)
 INTO v_fontes,v_count,v_total,v_pequenas,v_inconsistentes
 FROM (
   SELECT f.id,f.competencia,f.total_comissao_centavos,
     (SELECT pg_catalog.count(*) FROM public.catalogo_fatura_componentes_v2 fc
       WHERE fc.fechamento_id=f.id) AS componentes_count,
     (SELECT coalesce(pg_catalog.sum(fc.valor_centavos),0)
       FROM public.catalogo_fatura_componentes_v2 fc
       WHERE fc.fechamento_id=f.id) AS componentes_soma
   FROM public.catalogo_fechamentos_offline f
   WHERE f.comercio_id=p_comercio
     AND f.competencia<=p_competencia_corte
     AND f.status IN ('faturado','vencido','bloqueado')
     AND f.total_comissao_centavos>0
     AND NOT EXISTS (SELECT 1 FROM public.catalogo_fatura_cobrancas co
                     WHERE co.fechamento_id=f.id)
     AND NOT EXISTS (SELECT 1 FROM public.catalogo_asaas_emissoes e
                     WHERE e.fechamento_id=f.id)
     AND NOT EXISTS (SELECT 1 FROM public.catalogo_asaas_acumulo_fontes af
                     WHERE af.fechamento_id=f.id)
 ) c;

 RETURN pg_catalog.jsonb_build_object(
   'ok',true,'comercio_id',p_comercio,
   'competencia_corte',p_competencia_corte,
   'total_centavos',v_total,'quantidade_faturas',v_count,
   'quantidade_abaixo_minimo',v_pequenas,
   'snapshots_inconsistentes',v_inconsistentes,
   'pronto_para_preparar',v_total>=500 AND v_count>=2
                           AND v_pequenas>0 AND v_inconsistentes=0,
   'fontes',v_fontes,
   'reserva_criada',false,'pix_emitido',false
 );
END;
$preview$;
REVOKE ALL ON FUNCTION public.catalogo_asaas_previsualizar_acumulo(text,date)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_previsualizar_acumulo(text,date)
 TO service_role;

-- A proxima etapa devera instituir a reserva transacional da composicao,
-- bloqueio contra emissao direta concorrente e conciliacao de pagamentos/
-- estornos em todas as competencias. Ate la, este SQL NAO pode operar Pix.
COMMIT;
