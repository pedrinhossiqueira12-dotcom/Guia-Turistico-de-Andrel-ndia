-- Consulta privada dos créditos retidos por comércio, sem dados do comprador.
BEGIN;
CREATE OR REPLACE FUNCTION public.catalogo_asaas_pendencias_motoboy(p_motoboy uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $pending$
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'comercio_id',t.comercio_id,
  'competencia',t.competencia,
  'valor_centavos',t.total,
  'situacao',t.situacao,
  'quantidade',t.quantidade
 ) ORDER BY t.comercio_id,t.competencia), '[]'::jsonb)
 FROM (
  SELECT r.comercio_id, c.competencia,
   coalesce(sum(r.valor_centavos),0)::integer AS total,
   count(*)::integer AS quantidade,
   CASE WHEN bool_or(f.status IN ('bloqueado','vencido')) THEN 'fatura_vencida'
    WHEN bool_or(f.status='faturado') THEN 'aguardando_pagamento'
    WHEN bool_or(f.status='pago') THEN 'pagamento_em_conferencia'
    ELSE 'aguardando_fechamento' END AS situacao
  FROM public.catalogo_remuneracoes_v2 r
  JOIN public.catalogo_pedidos p ON p.id=r.pedido_id
  JOIN public.catalogo_comissoes_offline c ON c.pedido_id=p.id
  LEFT JOIN public.catalogo_fechamentos_offline f
    ON f.comercio_id=c.comercio_id AND f.competencia=c.competencia
  WHERE r.motoboy_id=p_motoboy AND catalogo_private.catalogo_v2_autorizado(p_motoboy)
   AND r.status='retido' AND r.financiamento_comprovado=false
   AND p.provedor='offline' AND p.entrega_status='entregue'
   AND c.taxa_motoboy_centavos>0
  GROUP BY r.comercio_id,c.competencia
 ) t;
$pending$;
REVOKE ALL ON FUNCTION public.catalogo_asaas_pendencias_motoboy(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_pendencias_motoboy(uuid) TO service_role;
COMMIT;
