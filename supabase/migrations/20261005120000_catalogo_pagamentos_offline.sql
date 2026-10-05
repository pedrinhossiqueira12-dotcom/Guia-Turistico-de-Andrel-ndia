-- Pagamentos presenciais com código de entrega e comissão mensal.
-- Esta migration é somente estrutural: não habilita o checkout nem cria cobrança.
BEGIN;

ALTER TABLE public.catalogo_pedidos
  DROP CONSTRAINT IF EXISTS catalogo_pedidos_provedor_check,
  DROP CONSTRAINT IF EXISTS catalogo_pedidos_forma_pagamento_check;

ALTER TABLE public.catalogo_pedidos
  ADD CONSTRAINT catalogo_pedidos_provedor_check
    CHECK (provedor IN ('mercadopago', 'offline')),
  ADD CONSTRAINT catalogo_pedidos_forma_pagamento_check
    CHECK (forma_pagamento IN ('pix', 'dinheiro', 'cartao_credito', 'cartao_debito', 'pagamento_entrega', 'pagamento_local'));

ALTER TABLE public.catalogo_pedidos
  ADD COLUMN IF NOT EXISTS cliente_token_hash text,
  ADD COLUMN IF NOT EXISTS codigo_entrega_hash text,
  ADD COLUMN IF NOT EXISTS codigo_entrega_expira_em timestamptz,
  ADD COLUMN IF NOT EXISTS codigo_entrega_usado_em timestamptz,
  ADD COLUMN IF NOT EXISTS codigo_entrega_tentativas integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS concluido_em timestamptz,
  ADD COLUMN IF NOT EXISTS concluido_por text,
  ADD COLUMN IF NOT EXISTS motivo_cancelamento text;

CREATE UNIQUE INDEX IF NOT EXISTS catalogo_pedidos_cliente_token_hash_unique
  ON public.catalogo_pedidos (cliente_token_hash)
  WHERE cliente_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS catalogo_pedidos_offline_status_idx
  ON public.catalogo_pedidos (comercio_id, forma_pagamento, status, criado_em DESC)
  WHERE provedor = 'offline';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'catalogo_pedidos_codigo_tentativas_check'
  ) THEN
    ALTER TABLE public.catalogo_pedidos
      ADD CONSTRAINT catalogo_pedidos_codigo_tentativas_check
      CHECK (codigo_entrega_tentativas BETWEEN 0 AND 5);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.catalogo_comissoes_offline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL UNIQUE REFERENCES public.catalogo_pedidos(id) ON DELETE RESTRICT,
  comercio_id text NOT NULL REFERENCES public.catalogos(comercio_id) ON DELETE RESTRICT,
  competencia date NOT NULL,
  subtotal_produtos_centavos integer NOT NULL CHECK (subtotal_produtos_centavos > 0),
  taxa_percentual numeric(5,2) NOT NULL DEFAULT 5.00 CHECK (taxa_percentual = 5.00),
  valor_comissao_centavos integer NOT NULL CHECK (valor_comissao_centavos = round(subtotal_produtos_centavos * taxa_percentual / 100)),
  status text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','faturada','paga','contestada','cancelada','bloqueado')),
  pago_em timestamptz,
  referencia_pagamento text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalogo_comissoes_offline_comercio_status_idx
  ON public.catalogo_comissoes_offline (comercio_id, status, competencia);

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
  IF v_pedido.status <> 'aguardando_pagamento' OR v_pedido.codigo_entrega_usado_em IS NOT NULL THEN
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

CREATE TABLE IF NOT EXISTS public.catalogo_fechamentos_offline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comercio_id text NOT NULL REFERENCES public.catalogos(comercio_id) ON DELETE RESTRICT,
  competencia date NOT NULL,
  total_pedidos integer NOT NULL DEFAULT 0 CHECK (total_pedidos >= 0),
  total_comissao_centavos integer NOT NULL DEFAULT 0 CHECK (total_comissao_centavos >= 0),
  status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','faturado','pago','vencido','bloqueado')),
  vencimento_em date,
  pago_em timestamptz,
  referencia_pagamento text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comercio_id, competencia)
);

CREATE OR REPLACE FUNCTION public.catalogo_gerar_fechamento_offline(
  p_comercio_id text,
  p_competencia date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_competencia date := pg_catalog.date_trunc('month', p_competencia)::date;
BEGIN
  INSERT INTO public.catalogo_fechamentos_offline (
    comercio_id, competencia, total_pedidos, total_comissao_centavos, status, vencimento_em
  )
  SELECT p_comercio_id, v_competencia, count(*)::integer, coalesce(sum(valor_comissao_centavos), 0)::integer,
         'faturado', (v_competencia + interval '1 month' + interval '5 days')::date
    FROM public.catalogo_comissoes_offline
   WHERE comercio_id = p_comercio_id
     AND competencia = v_competencia
     AND status IN ('aberta', 'faturada')
  ON CONFLICT (comercio_id, competencia) DO UPDATE
    SET total_pedidos = excluded.total_pedidos,
        total_comissao_centavos = excluded.total_comissao_centavos,
        status = CASE WHEN public.catalogo_fechamentos_offline.status = 'pago' THEN 'pago' ELSE 'faturado' END,
        vencimento_em = excluded.vencimento_em;
  SELECT id INTO v_id FROM public.catalogo_fechamentos_offline
   WHERE comercio_id = p_comercio_id AND competencia = v_competencia;
  UPDATE public.catalogo_comissoes_offline
     SET status = 'faturada'
   WHERE comercio_id = p_comercio_id AND competencia = v_competencia AND status = 'aberta';
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.catalogo_bloquear_inadimplentes_offline()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.catalogo_fechamentos_offline
     SET status = 'vencido'
   WHERE status = 'faturado' AND vencimento_em IS NOT NULL AND vencimento_em < CURRENT_DATE;
  UPDATE public.catalogo_fechamentos_offline
     SET status = 'bloqueado'
   WHERE status = 'vencido';
  UPDATE public.catalogo_comissoes_offline c
     SET status = 'bloqueado'
   WHERE status IN ('aberta', 'faturada')
     AND EXISTS (
       SELECT 1 FROM public.catalogo_fechamentos_offline f
        WHERE f.comercio_id = c.comercio_id AND f.competencia = c.competencia AND f.status = 'bloqueado'
     );
  UPDATE public.catalogos c
     SET bloqueado = true, motivo_bloqueio = 'Comissão de pagamentos presenciais vencida.'
   WHERE EXISTS (
     SELECT 1 FROM public.catalogo_fechamentos_offline f
      WHERE f.comercio_id = c.comercio_id AND f.status = 'bloqueado'
   ) AND c.bloqueado = false;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.catalogo_gerar_fechamento_offline(text, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.catalogo_bloquear_inadimplentes_offline() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_gerar_fechamento_offline(text, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_bloquear_inadimplentes_offline() TO service_role;

CREATE OR REPLACE FUNCTION public.catalogo_marketplace_atualizar_data()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.atualizado_em := pg_catalog.now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS catalogo_comissoes_offline_atualizado_em ON public.catalogo_comissoes_offline;
CREATE TRIGGER catalogo_comissoes_offline_atualizado_em
  BEFORE UPDATE ON public.catalogo_comissoes_offline
  FOR EACH ROW EXECUTE FUNCTION public.catalogo_marketplace_atualizar_data();

DROP TRIGGER IF EXISTS catalogo_fechamentos_offline_atualizado_em ON public.catalogo_fechamentos_offline;
CREATE TRIGGER catalogo_fechamentos_offline_atualizado_em
  BEFORE UPDATE ON public.catalogo_fechamentos_offline
  FOR EACH ROW EXECUTE FUNCTION public.catalogo_marketplace_atualizar_data();

ALTER TABLE public.catalogo_comissoes_offline ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_fechamentos_offline ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.catalogo_comissoes_offline FROM anon, authenticated;
REVOKE ALL ON TABLE public.catalogo_fechamentos_offline FROM anon, authenticated;
GRANT ALL ON TABLE public.catalogo_comissoes_offline TO service_role;
GRANT ALL ON TABLE public.catalogo_fechamentos_offline TO service_role;

COMMIT;
