BEGIN;

ALTER TABLE public.catalogo_pedidos
  DROP CONSTRAINT IF EXISTS catalogo_pedidos_status_check;

ALTER TABLE public.catalogo_pedidos
  ADD CONSTRAINT catalogo_pedidos_status_check
  CHECK (status IN ('aguardando_pagamento','pago','em_preparo','pronto','entregue','cancelado','expirado','estornado','contestado'));

CREATE TABLE IF NOT EXISTS public.catalogo_pedido_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL REFERENCES public.catalogo_pedidos(id) ON DELETE RESTRICT,
  comercio_id text NOT NULL REFERENCES public.catalogos(comercio_id) ON DELETE RESTRICT,
  de_status text,
  para_status text NOT NULL,
  ator_tipo text NOT NULL CHECK (ator_tipo IN ('cliente','comercio','entregador','admin','sistema')),
  ator_id uuid,
  motivo text CHECK (motivo IS NULL OR char_length(motivo) <= 500),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalogo_pedido_eventos_pedido_idx
  ON public.catalogo_pedido_eventos (pedido_id, criado_em DESC);

ALTER TABLE public.catalogo_pedido_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.catalogo_pedido_eventos FROM anon, authenticated;
GRANT ALL ON TABLE public.catalogo_pedido_eventos TO service_role;

CREATE OR REPLACE FUNCTION public.catalogo_registrar_evento_pedido(
  p_pedido_id uuid,
  p_para_status text,
  p_ator_tipo text,
  p_ator_id uuid DEFAULT NULL,
  p_motivo text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.catalogo_pedido_eventos (pedido_id, comercio_id, de_status, para_status, ator_tipo, ator_id, motivo, metadata)
  SELECT p.id, p.comercio_id, p.status, p_para_status, p_ator_tipo, p_ator_id, left(p_motivo, 500), coalesce(p_metadata, '{}'::jsonb)
    FROM public.catalogo_pedidos p WHERE p.id = p_pedido_id
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.catalogo_registrar_evento_pedido(uuid, text, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_registrar_evento_pedido(uuid, text, text, uuid, text, jsonb) TO service_role;

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
  ) ON CONFLICT (pedido_id) DO NOTHING;

  RETURN QUERY SELECT true, v_pedido.id, 'entregue'::text, 'aprovado'::text, 'Pedido concluído e comissão registrada.'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.catalogo_confirmar_pedido_offline(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_confirmar_pedido_offline(text, text, text) TO service_role;


CREATE OR REPLACE FUNCTION public.catalogo_pedido_status_auditar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.catalogo_pedido_eventos (pedido_id, comercio_id, de_status, para_status, ator_tipo, motivo, metadata)
    VALUES (NEW.id, NEW.comercio_id, OLD.status, NEW.status, 'sistema', NULL, jsonb_build_object('status_pagamento', NEW.status_pagamento));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS catalogo_pedido_status_auditoria ON public.catalogo_pedidos;
CREATE TRIGGER catalogo_pedido_status_auditoria
  AFTER UPDATE OF status ON public.catalogo_pedidos
  FOR EACH ROW EXECUTE FUNCTION public.catalogo_pedido_status_auditar();

REVOKE ALL ON FUNCTION public.catalogo_pedido_status_auditar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_pedido_status_auditar() TO service_role;

COMMIT;
