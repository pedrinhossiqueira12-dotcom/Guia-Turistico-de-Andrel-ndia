-- Baixa presencial exclusiva do painel autenticado. Não altera pedidos existentes.
-- Revoga a RPC antiga baseada somente no token do comprador.
BEGIN;

REVOKE ALL ON FUNCTION public.catalogo_confirmar_pedido_offline(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.catalogo_confirmar_entrega_autenticada(
  p_operador_id uuid,
  p_comercio_id text,
  p_pedido_id uuid,
  p_codigo_hash text,
  p_entregador text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pedido public.catalogo_pedidos%ROWTYPE;
  v_now timestamptz := pg_catalog.now();
  v_entregador text := pg_catalog.left(coalesce(nullif(pg_catalog.btrim(p_entregador), ''), 'não informado'), 120);
BEGIN
  -- O UUID vem do JWT verificado na Edge Function, nunca do corpo da requisição.
  IF p_operador_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.catalogos c
     WHERE c.comercio_id = p_comercio_id
       AND (c.proprietario_id = p_operador_id
            OR p_operador_id = '4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'http_status', 403, 'mensagem', 'Acesso não autorizado.');
  END IF;
  IF p_codigo_hash IS NULL OR p_codigo_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'http_status', 400, 'mensagem', 'Código de entrega inválido.');
  END IF;

  SELECT p.* INTO v_pedido
    FROM public.catalogo_pedidos p
   WHERE p.id = p_pedido_id AND p.comercio_id = p_comercio_id AND p.provedor = 'offline'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'http_status', 404, 'mensagem', 'Pedido não encontrado.');
  END IF;
  IF v_pedido.status NOT IN ('aguardando_pagamento', 'em_preparo', 'pronto')
     OR v_pedido.status_pagamento <> 'pendente'
     OR v_pedido.codigo_entrega_usado_em IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'http_status', 409, 'mensagem', 'Este pedido não pode mais ser concluído.');
  END IF;
  IF v_pedido.codigo_entrega_expira_em IS NULL OR v_pedido.codigo_entrega_expira_em <= v_now THEN
    RETURN jsonb_build_object('ok', false, 'http_status', 410, 'mensagem', 'O código de entrega expirou.');
  END IF;
  IF v_pedido.codigo_entrega_tentativas >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'http_status', 429, 'mensagem', 'Limite de tentativas atingido.');
  END IF;

  UPDATE public.catalogo_pedidos
     SET codigo_entrega_tentativas = codigo_entrega_tentativas + 1
   WHERE id = v_pedido.id;
  IF v_pedido.codigo_entrega_hash IS DISTINCT FROM p_codigo_hash THEN
    RETURN jsonb_build_object('ok', false, 'http_status', 403, 'mensagem', 'Código de entrega incorreto.');
  END IF;

  UPDATE public.catalogo_pedidos
     SET status = 'entregue', status_pagamento = 'aprovado', pago_em = v_now,
         concluido_em = v_now, concluido_por = p_operador_id::text,
         codigo_entrega_usado_em = v_now,
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'offline_confirmado', true, 'operador_id', p_operador_id,
           'entregador', v_entregador, 'confirmacao', 'painel_autenticado')
   WHERE id = v_pedido.id;

  INSERT INTO public.catalogo_comissoes_offline (
    pedido_id, comercio_id, competencia, subtotal_produtos_centavos, valor_comissao_centavos, metadata
  ) VALUES (
    v_pedido.id, v_pedido.comercio_id,
    date_trunc('month', v_now AT TIME ZONE 'America/Sao_Paulo')::date,
    v_pedido.subtotal_produtos_centavos, round(v_pedido.subtotal_produtos_centavos * 0.05)::integer,
    jsonb_build_object('origem', 'codigo_entrega', 'operador_id', p_operador_id)
  ) ON CONFLICT ON CONSTRAINT catalogo_comissoes_offline_pedido_id_key DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'pedido_id', v_pedido.id,
    'status', 'entregue', 'status_pagamento', 'aprovado', 'comissao_registrada', true);
END;
$$;

REVOKE ALL ON FUNCTION public.catalogo_confirmar_entrega_autenticada(uuid, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_confirmar_entrega_autenticada(uuid, text, uuid, text, text)
  TO service_role;
COMMENT ON FUNCTION public.catalogo_confirmar_entrega_autenticada(uuid, text, uuid, text, text)
  IS 'Somente backend service_role, operador verificado por JWT, propriedade e pedido revalidados no banco, código de uso único.';

-- Reutiliza o trigger existente, sem gerar um segundo evento de baixa.
CREATE OR REPLACE FUNCTION public.catalogo_pedido_status_auditar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_operador_id uuid;
  v_ator_tipo text := 'sistema';
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'entregue' AND NEW.provedor = 'offline'
       AND NEW.metadata->>'confirmacao' = 'painel_autenticado'
       AND NEW.metadata->>'operador_id' ~ '^[0-9a-f-]{36}$'
       AND NEW.concluido_por = NEW.metadata->>'operador_id' THEN
      v_operador_id := (NEW.metadata->>'operador_id')::uuid;
      v_ator_tipo := CASE WHEN v_operador_id = '4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid THEN 'admin' ELSE 'comercio' END;
    END IF;
    INSERT INTO public.catalogo_pedido_eventos (pedido_id, comercio_id, de_status, para_status, ator_tipo, ator_id, motivo, metadata)
    VALUES (NEW.id, NEW.comercio_id, OLD.status, NEW.status, v_ator_tipo, v_operador_id, NULL,
      jsonb_build_object('status_pagamento', NEW.status_pagamento, 'confirmacao', NEW.metadata->>'confirmacao'));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.catalogo_pedido_status_auditar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_pedido_status_auditar() TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
