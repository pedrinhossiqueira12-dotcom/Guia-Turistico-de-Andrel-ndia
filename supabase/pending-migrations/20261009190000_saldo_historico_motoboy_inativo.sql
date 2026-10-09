-- Consulta de carteira do entregador, inclusive depois de ficar INATIVO.
-- Nao altera a RPC de saque comum, que continua exigindo catalogo_v2_autorizado.
-- A Edge verifica o usuario logado; nao conceder EXECUTE publico nesta RPC.
-- STAGING primeiro; saques reais e liquidação residual permanecem desativados.
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
    -- O vinculo historico basta para LEITURA. Ativo=false nao extingue credito.
    AND EXISTS(
      SELECT 1 FROM public.catalogo_motoboys m WHERE m.usuario_id=p_motoboy
    )
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

-- SECURITY DEFINER esta acessivel somente ao backend autenticador da Edge,
-- nunca diretamente ao usuario/anon (o argumento UUID nao seria confiavel).
REVOKE ALL ON FUNCTION public.catalogo_asaas_saldo_historico(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_saldo_historico(uuid)
  TO service_role;
COMMIT;
