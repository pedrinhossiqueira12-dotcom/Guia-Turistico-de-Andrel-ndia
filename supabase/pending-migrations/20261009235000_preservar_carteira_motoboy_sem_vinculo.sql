-- Mantem historico financeiro visivel mesmo sem qualquer linha em catalogo_motoboys.
-- As remuneracoes guardam motoboy_id de auth.users com FK ON DELETE RESTRICT.
-- Nenhuma reativacao, liberacao de credito, mudanca de status ou Pix.
-- RPCs somente service_role; a Edge valida a identidade autenticada.
BEGIN;

CREATE OR REPLACE FUNCTION public.catalogo_asaas_saldo_historico(
  p_motoboy uuid
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $history$
  SELECT jsonb_build_object(
    'disponivel_centavos',coalesce(sum(r.valor_centavos::bigint),0),
    'creditos',count(*)
  )
  FROM public.catalogo_remuneracoes_v2 r
  JOIN public.catalogo_pedidos p ON p.id=r.pedido_id
  JOIN public.catalogo_comissoes_offline c ON c.pedido_id=p.id
  JOIN public.catalogo_fechamentos_offline f
    ON f.comercio_id=c.comercio_id AND f.competencia=c.competencia
  JOIN public.catalogo_fatura_cobrancas b ON b.fechamento_id=f.id
  WHERE r.motoboy_id=p_motoboy
    AND r.status='disponivel' AND r.financiamento_comprovado
    AND r.repasse_id IS NULL AND r.valor_centavos>0
    AND p.provedor='offline' AND p.entrega_status='entregue'
    AND NOT p.reembolso_pendente AND NOT p.pagamento_revisao_pendente
    AND c.status='paga' AND f.status='pago'
    AND b.gateway='asaas' AND b.status='pago' AND b.pago_em IS NOT NULL
    AND NOT EXISTS(
      SELECT 1 FROM public.catalogo_asaas_saque_itens i
      WHERE i.remuneracao_id=r.id AND i.ativo
    );
$history$;

-- SECURITY DEFINER permanece acessivel somente ao backend autenticador da Edge,
-- nunca diretamente ao usuario/anon (o argumento UUID nao seria confiavel).
REVOKE ALL ON FUNCTION public.catalogo_asaas_saldo_historico(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_saldo_historico(uuid)
  TO service_role;
-- As comissões ainda retidas (aguardando faturamento, pagamento ou
-- conciliação) também devem continuar visíveis depois da inativação.
CREATE OR REPLACE FUNCTION public.catalogo_asaas_pendencias_historicas(
  p_motoboy uuid
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $pending$
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'comercio_id',t.comercio_id,
   'competencia',t.competencia,
   'valor_centavos',t.total,
   'situacao',t.situacao,
   'quantidade',t.quantidade
 ) ORDER BY t.comercio_id,t.competencia),'[]'::jsonb)
 FROM (
  SELECT r.comercio_id,c.competencia,
   coalesce(sum(r.valor_centavos::bigint),0) AS total,
   count(*) AS quantidade,
   CASE WHEN bool_or(f.status IN ('bloqueado','vencido')) THEN 'fatura_vencida'
     WHEN bool_or(f.status='faturado') THEN 'aguardando_pagamento'
     WHEN bool_or(f.status='pago') THEN 'pagamento_em_conferencia'
     ELSE 'aguardando_fechamento' END AS situacao
  FROM public.catalogo_remuneracoes_v2 r
  JOIN public.catalogo_pedidos p ON p.id=r.pedido_id
  JOIN public.catalogo_comissoes_offline c ON c.pedido_id=p.id
  LEFT JOIN public.catalogo_fechamentos_offline f
    ON f.comercio_id=c.comercio_id AND f.competencia=c.competencia
  WHERE r.motoboy_id=p_motoboy
    AND r.status='retido' AND r.financiamento_comprovado=false
    AND p.provedor='offline' AND p.entrega_status='entregue'
    AND c.taxa_motoboy_centavos>0
  GROUP BY r.comercio_id,c.competencia
 ) t;
$pending$;

REVOKE ALL ON FUNCTION public.catalogo_asaas_pendencias_historicas(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_pendencias_historicas(uuid)
  TO service_role;
COMMIT;
