-- Modelo de marketplace para pedidos Pix com split Mercado Pago.
-- Esta migração não cria cobranças, não ativa split e não armazena tokens privados.
BEGIN;

CREATE TABLE IF NOT EXISTS public.catalogo_recebedores (
  comercio_id text PRIMARY KEY REFERENCES public.catalogos(comercio_id) ON DELETE RESTRICT,
  provedor text NOT NULL DEFAULT 'mercadopago' CHECK (provedor = 'mercadopago'),
  conta_externa_id text NULL CHECK (conta_externa_id IS NULL OR char_length(trim(conta_externa_id)) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','em_analise','ativo','bloqueado','desconectado')),
  percentual_plataforma numeric(5,2) NOT NULL DEFAULT 5.00
    CHECK (percentual_plataforma = 5.00),
  conectado_em timestamptz NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS catalogo_recebedores_status_idx
  ON public.catalogo_recebedores (status, provedor);

CREATE TABLE IF NOT EXISTS public.catalogo_pedidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comercio_id text NOT NULL REFERENCES public.catalogos(comercio_id) ON DELETE RESTRICT,
  referencia_externa text NOT NULL UNIQUE,
  provedor text NOT NULL DEFAULT 'mercadopago' CHECK (provedor = 'mercadopago'),
  order_id text NULL UNIQUE,
  payment_id text NULL UNIQUE,
  idempotency_key uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'aguardando_pagamento'
    CHECK (status IN ('aguardando_pagamento','pago','em_preparo','pronto','entregue','cancelado','expirado','estornado','contestado')),
  status_pagamento text NOT NULL DEFAULT 'pendente'
    CHECK (status_pagamento IN ('pendente','processando','aprovado','recusado','cancelado','expirado','estornado','contestado')),
  modalidade text NOT NULL CHECK (modalidade IN ('entrega','retirada','consumo_local')),
  forma_pagamento text NOT NULL DEFAULT 'pix' CHECK (forma_pagamento = 'pix'),
  subtotal_produtos_centavos integer NOT NULL CHECK (subtotal_produtos_centavos > 0),
  entrega_centavos integer NOT NULL DEFAULT 0 CHECK (entrega_centavos >= 0),
  total_centavos integer NOT NULL CHECK (total_centavos = subtotal_produtos_centavos + entrega_centavos),
  taxa_plataforma_centavos integer NOT NULL CHECK (taxa_plataforma_centavos = round(subtotal_produtos_centavos * 0.05)),
  tarifa_provedor_centavos integer NULL CHECK (tarifa_provedor_centavos IS NULL OR tarifa_provedor_centavos >= 0),
  repasse_bruto_comercio_centavos integer NOT NULL CHECK (repasse_bruto_comercio_centavos = subtotal_produtos_centavos - taxa_plataforma_centavos + entrega_centavos),
  repasse_liquido_comercio_centavos integer NULL CHECK (repasse_liquido_comercio_centavos IS NULL OR repasse_liquido_comercio_centavos >= 0),
  cliente_nome text NOT NULL CHECK (char_length(trim(cliente_nome)) BETWEEN 1 AND 140),
  cliente_telefone text NOT NULL CHECK (char_length(trim(cliente_telefone)) BETWEEN 3 AND 40),
  cliente_endereco text NULL CHECK (cliente_endereco IS NULL OR char_length(cliente_endereco) <= 240),
  cliente_numero text NULL CHECK (cliente_numero IS NULL OR char_length(cliente_numero) <= 30),
  cliente_bairro text NULL CHECK (cliente_bairro IS NULL OR char_length(cliente_bairro) <= 120),
  cliente_complemento text NULL CHECK (cliente_complemento IS NULL OR char_length(cliente_complemento) <= 160),
  cliente_referencia text NULL CHECK (cliente_referencia IS NULL OR char_length(cliente_referencia) <= 240),
  cliente_cidade text NOT NULL DEFAULT 'Andrelândia-MG' CHECK (char_length(cliente_cidade) <= 120),
  observacoes text NULL CHECK (observacoes IS NULL OR char_length(observacoes) <= 1000),
  pix_codigo text NULL,
  pix_qr_code_base64 text NULL,
  pix_expira_em timestamptz NULL,
  pago_em timestamptz NULL,
  cancelado_em timestamptz NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS catalogo_pedidos_comercio_criado_idx
  ON public.catalogo_pedidos (comercio_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS catalogo_pedidos_pagamento_status_idx
  ON public.catalogo_pedidos (status_pagamento, criado_em DESC);

CREATE TABLE IF NOT EXISTS public.catalogo_pedido_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL REFERENCES public.catalogo_pedidos(id) ON DELETE RESTRICT,
  produto_id uuid NULL,
  nome_produto text NOT NULL CHECK (char_length(trim(nome_produto)) BETWEEN 1 AND 120),
  descricao_produto text NOT NULL DEFAULT '' CHECK (char_length(descricao_produto) <= 600),
  preco_unitario_centavos integer NOT NULL CHECK (preco_unitario_centavos >= 0),
  quantidade integer NOT NULL CHECK (quantidade BETWEEN 1 AND 99),
  total_item_centavos integer NOT NULL CHECK (total_item_centavos = preco_unitario_centavos * quantidade),
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalogo_pedido_itens_pedido_idx
  ON public.catalogo_pedido_itens (pedido_id);

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

DROP TRIGGER IF EXISTS catalogo_recebedores_atualizado_em ON public.catalogo_recebedores;
CREATE TRIGGER catalogo_recebedores_atualizado_em
  BEFORE UPDATE ON public.catalogo_recebedores
  FOR EACH ROW EXECUTE FUNCTION public.catalogo_marketplace_atualizar_data();

DROP TRIGGER IF EXISTS catalogo_pedidos_atualizado_em ON public.catalogo_pedidos;
CREATE TRIGGER catalogo_pedidos_atualizado_em
  BEFORE UPDATE ON public.catalogo_pedidos
  FOR EACH ROW EXECUTE FUNCTION public.catalogo_marketplace_atualizar_data();

ALTER TABLE public.catalogo_recebedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_pedido_itens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.catalogo_recebedores FROM anon, authenticated;
REVOKE ALL ON TABLE public.catalogo_pedidos FROM anon, authenticated;
REVOKE ALL ON TABLE public.catalogo_pedido_itens FROM anon, authenticated;
GRANT ALL ON TABLE public.catalogo_recebedores TO service_role;
GRANT ALL ON TABLE public.catalogo_pedidos TO service_role;
GRANT ALL ON TABLE public.catalogo_pedido_itens TO service_role;

REVOKE ALL ON FUNCTION public.catalogo_marketplace_atualizar_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_marketplace_atualizar_data() TO service_role;

COMMIT;
