-- COB-06 / PR #39: preflight contábil multi-competências (INERTE).
-- Aplicar SOMENTE no PostgreSQL descartável de CI, DEPOIS do candidato 03.
-- Não integra o pacote seletivo congelado de nove fontes para produção.
-- NUNCA confirmar liquidação, estorno ou habilitar crédito por esta função.
BEGIN;

CREATE FUNCTION public.catalogo_asaas_conferir_conciliacao_acumulo(
 p_lote uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $conferir$
DECLARE
 v_lote public.catalogo_asaas_acumulo_lotes%ROWTYPE;
 v_fontes jsonb;
 v_qtd bigint := 0;
 v_total bigint := 0;
 v_fonte_divergente bigint := 0;
 v_snapshot_divergente bigint := 0;
 v_parcelas_invalidas bigint := 0;
 v_ok boolean := false;
BEGIN
 IF p_lote IS NULL THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','lote_invalido');
 END IF;

 SELECT * INTO v_lote FROM public.catalogo_asaas_acumulo_lotes
 WHERE id=p_lote;
 IF NOT FOUND THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','lote_inexistente');
 END IF;

 -- Cruzar cada competência ORIGINAL com seus componentes e comissões.
 -- A existência de um lote nunca comprova que houve pagamento bancário.
 SELECT pg_catalog.count(*),
        coalesce(pg_catalog.sum(q.valor_centavos),0),
        pg_catalog.count(*) FILTER(WHERE q.fonte_divergente),
        pg_catalog.count(*) FILTER(WHERE q.snapshot_divergente),
        coalesce(pg_catalog.sum(q.parcelas_invalidas),0),
        coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'fechamento_id',q.fechamento_id,
          'competencia',q.competencia,
          'valor_centavos',q.valor_centavos,
          'parcelas',q.parcelas,
          'pedidos',q.pedidos,
          'origem_consistente',NOT (q.fonte_divergente OR
                    q.snapshot_divergente OR q.parcelas_invalidas>0)
         ) ORDER BY q.competencia,q.fechamento_id),'[]'::jsonb)
 INTO v_qtd,v_total,v_fonte_divergente,v_snapshot_divergente,
      v_parcelas_invalidas,v_fontes
 FROM (
   SELECT a.fechamento_id,a.competencia,a.valor_centavos,
      (f.id IS NULL
       OR f.comercio_id IS DISTINCT FROM v_lote.comercio_id
       OR f.competencia IS DISTINCT FROM a.competencia
       OR f.total_comissao_centavos IS DISTINCT FROM a.valor_centavos
       OR f.status NOT IN ('faturado','vencido','bloqueado')
       OR EXISTS(SELECT 1 FROM public.catalogo_fatura_cobrancas old
                 WHERE old.fechamento_id=a.fechamento_id)
       OR EXISTS(SELECT 1 FROM public.catalogo_asaas_emissoes old
                 WHERE old.fechamento_id=a.fechamento_id)
      ) AS fonte_divergente,
      (s.parcelas=0 OR s.soma<>a.valor_centavos
         OR f.total_pedidos IS DISTINCT FROM s.pedidos
      ) AS snapshot_divergente,
      s.parcelas,s.pedidos,s.parcelas_invalidas
   FROM public.catalogo_asaas_acumulo_fontes a
   LEFT JOIN public.catalogo_fechamentos_offline f ON f.id=a.fechamento_id
   LEFT JOIN LATERAL (
     SELECT pg_catalog.count(*) AS parcelas,
            coalesce(pg_catalog.sum(fc.valor_centavos),0) AS soma,
            pg_catalog.count(DISTINCT fc.pedido_id) AS pedidos,
            pg_catalog.count(*) FILTER(WHERE
              c.pedido_id IS NULL
              OR c.comercio_id IS DISTINCT FROM v_lote.comercio_id
              OR c.competencia IS DISTINCT FROM a.competencia
              OR c.status NOT IN ('faturada','aberta','bloqueado')
              OR p.id IS NULL
              OR p.comercio_id IS DISTINCT FROM v_lote.comercio_id
              OR p.provedor IS DISTINCT FROM 'offline'
              OR p.status IS DISTINCT FROM 'entregue'
              OR p.entrega_status IS DISTINCT FROM 'entregue'
              OR p.status_pagamento IS DISTINCT FROM 'aprovado'
              OR p.codigo_entrega_usado_em IS NULL
              OR (fc.tipo='plataforma'
                  AND fc.valor_centavos IS DISTINCT FROM c.taxa_plataforma_centavos)
              OR (fc.tipo='logistica'
                  AND (fc.valor_centavos IS DISTINCT FROM c.taxa_motoboy_centavos
                       OR p.modalidade IS DISTINCT FROM 'entrega'))
              OR fc.tipo NOT IN ('plataforma','logistica')
            ) AS parcelas_invalidas
     FROM public.catalogo_fatura_componentes_v2 fc
     LEFT JOIN public.catalogo_comissoes_offline c
       ON c.pedido_id=fc.pedido_id AND c.comercio_id=v_lote.comercio_id
          AND c.competencia=a.competencia
     LEFT JOIN public.catalogo_pedidos p ON p.id=fc.pedido_id
     WHERE fc.fechamento_id=a.fechamento_id
   ) s ON TRUE
   WHERE a.lote_id=p_lote
 ) q;

 v_ok:=v_qtd>=2 AND v_total=v_lote.total_centavos
   AND v_total>=500 AND v_fonte_divergente=0
   AND v_snapshot_divergente=0 AND v_parcelas_invalidas=0;

 RETURN pg_catalog.jsonb_build_object(
   'ok',true,'lote_id',v_lote.id,
   'comercio_id',v_lote.comercio_id,
   'estado',v_lote.estado,'valor_lote_centavos',v_lote.total_centavos,
   'valor_fontes_centavos',v_total,'quantidade_fontes',v_qtd,
   'fontes_divergentes',v_fonte_divergente,
   'snapshots_divergentes',v_snapshot_divergente,
   'parcelas_invalidas',v_parcelas_invalidas,
   'integridade_contabil_ok',v_ok,'origens',v_fontes,
   'motivo',CASE WHEN NOT v_ok THEN 'integridade_contabil_incompleta'
                 ELSE 'aguardando_evidencia_bancaria_verificada' END,
   'pode_emitir_pix',false,'pode_quitar',false,
   'pode_estornar',false,'pode_liberar_motoboy',false
 );
END;
$conferir$;

REVOKE ALL ON FUNCTION public.catalogo_asaas_conferir_conciliacao_acumulo(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_conferir_conciliacao_acumulo(uuid)
 TO service_role;

-- ESTA ENTREGA NÃO CRIA:
-- - emissão/reserva bancária Asaas
-- - escrita de pago/estornado/contestado
-- - transferências Money Out, saque, crédito de motoboy
-- - permissões de escrita para anon/authenticated/service_role
COMMIT;
