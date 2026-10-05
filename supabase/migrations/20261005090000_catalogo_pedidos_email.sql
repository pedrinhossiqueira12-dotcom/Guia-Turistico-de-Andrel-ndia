BEGIN;

ALTER TABLE public.catalogo_pedidos
  ADD COLUMN IF NOT EXISTS cliente_email text NULL
    CHECK (cliente_email IS NULL OR char_length(trim(cliente_email)) BETWEEN 5 AND 180);

COMMIT;
