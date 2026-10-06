-- Estrutura mínima que as migrations de pagamentos presenciais esperam encontrar
-- (o restante do schema do marketplace não é necessário para validar este bloco).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Papéis equivalentes aos do Supabase, exigidos pelos REVOKE/GRANT das migrations.
DO $$
DECLARE v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', v_role);
    END IF;
  END LOOP;
END $$;

CREATE TABLE public.catalogos (
  comercio_id text PRIMARY KEY,
  nome text,
  proprietario_id uuid,
  bloqueado boolean NOT NULL DEFAULT false,
  motivo_bloqueio text,
  modalidades jsonb NOT NULL DEFAULT '[]'::jsonb,
  metodos_pagamento jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE public.catalogo_pedidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comercio_id text NOT NULL REFERENCES public.catalogos(comercio_id),
  provedor text NOT NULL DEFAULT 'offline',
  forma_pagamento text NOT NULL DEFAULT 'dinheiro',
  status text NOT NULL DEFAULT 'aguardando_pagamento',
  status_pagamento text NOT NULL DEFAULT 'pendente',
  subtotal_produtos_centavos integer NOT NULL DEFAULT 0,
  entrega_centavos integer NOT NULL DEFAULT 0,
  total_centavos integer NOT NULL DEFAULT 0,
  taxa_plataforma_centavos integer NOT NULL DEFAULT 0,
  pago_em timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);
