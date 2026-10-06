-- Correção da confirmação de entrega offline.
-- A versão anterior usava `ON CONFLICT (pedido_id)`. Como a função declara um
-- parâmetro de saída chamado `pedido_id` (RETURNS TABLE), o PL/pgSQL não consegue
-- decidir se o alvo do conflito é a coluna ou a variável e aborta a execução com
-- `column reference "pedido_id" is ambiguous`. O efeito prático é que toda
-- confirmação válida falhava ao registrar a comissão e devolvia erro ao entregador.
-- O alvo passa a ser a constraint única nomeada, o que resolve a ambiguidade sem
-- alterar nomes devolvidos pela função nem o contrato usado pela Edge Function.
BEGIN;

CREATE OR REPLACE FUNCTION public.catalogo_confirmar_pedido_offline(
  p_cliente_token_hash text,
  p_codigo_hash text,
  p_entregador text
)
RETURNS TABLE(ok boolean, pedido_id uuid, status text, status_pagamento text, mensagem text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pedido record;
  v_now timestamptz := pg_catalog.now();
BEGIN
  SELECT p.id, p.comercio_id, p.status, p.status_pagamento, p.codigo_entrega_hash,
         p.codigo_entrega_expira_em, p.codigo_entrega_usado_em,
         p.codigo_entrega_tentativas, p.subtotal_produtos_centavos
    INTO v_pedido
    FROM public.catalogo_pedidos p
   WHERE p.cliente_token_hash = p_cliente_token_hash
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::text, 'Pedido não encontrado.'::text;
    RETURN;
  END IF;
  IF v_pedido.status NOT IN ('aguardando_pagamento', 'em_preparo', 'pronto') OR v_pedido.codigo_entrega_usado_em IS NOT NULL THEN
    RETURN QUERY SELECT false, v_pedido.id, v_pedido.status, v_pedido.status_pagamento, 'Este pedido não pode mais ser concluído.'::text;
    RETURN;
  END IF;
  IF v_pedido.codigo_entrega_expira_em IS NULL OR v_pedido.codigo_entrega_expira_em < v_now THEN
    RETURN QUERY SELECT false, v_pedido.id, v_pedido.status, v_pedido.status_pagamento, 'O código de entrega expirou.'::text;
    RETURN;
  END IF;
  IF v_pedido.codigo_entrega_tentativas >= 5 THEN
    RETURN QUERY SELECT false, v_pedido.id, v_pedido.status, v_pedido.status_pagamento, 'Limite de tentativas atingido.'::text;
    RETURN;
  END IF;

  UPDATE public.catalogo_pedidos
     SET codigo_entrega_tentativas = codigo_entrega_tentativas + 1
   WHERE id = v_pedido.id;

  IF v_pedido.codigo_entrega_hash IS DISTINCT FROM p_codigo_hash THEN
    RETURN QUERY SELECT false, v_pedido.id, v_pedido.status, v_pedido.status_pagamento, 'Código de entrega incorreto.'::text;
    RETURN;
  END IF;

  UPDATE public.catalogo_pedidos
     SET status = 'entregue', status_pagamento = 'aprovado', pago_em = v_now,
         concluido_em = v_now, concluido_por = left(coalesce(p_entregador, 'não informado'), 120),
         codigo_entrega_usado_em = v_now,
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('offline_confirmado', true, 'entregador', left(coalesce(p_entregador, 'não informado'), 120))
   WHERE id = v_pedido.id;

  INSERT INTO public.catalogo_comissoes_offline (
    pedido_id, comercio_id, competencia, subtotal_produtos_centavos, valor_comissao_centavos, metadata
  ) VALUES (
    v_pedido.id, v_pedido.comercio_id, pg_catalog.date_trunc('month', CURRENT_DATE)::date,
    v_pedido.subtotal_produtos_centavos,
    round(v_pedido.subtotal_produtos_centavos * 0.05)::integer,
    jsonb_build_object('origem', 'codigo_entrega')
  ) ON CONFLICT ON CONSTRAINT catalogo_comissoes_offline_pedido_id_key DO NOTHING;

  RETURN QUERY SELECT true, v_pedido.id, 'entregue'::text, 'aprovado'::text, 'Pedido concluído e comissão registrada.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.catalogo_confirmar_pedido_offline(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_confirmar_pedido_offline(text, text, text) TO service_role;

COMMIT;