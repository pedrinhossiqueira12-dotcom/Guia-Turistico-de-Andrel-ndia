BEGIN;

ALTER TABLE public.catalogos
  ADD COLUMN IF NOT EXISTS banner_url text NULL
  CHECK (banner_url IS NULL OR char_length(banner_url) BETWEEN 1 AND 2048);

CREATE OR REPLACE VIEW public.catalogo_publicado WITH (security_invoker = true) AS
SELECT
  c.comercio_id,
  c.modalidades,
  c.metodos_pagamento,
  c.banner_url
FROM public.catalogos c
WHERE catalogo_private.catalogo_esta_ativo(c.comercio_id);

GRANT SELECT ON public.catalogo_publicado TO anon, authenticated;
-- A view security_invoker precisa da permissão de leitura da coluna nova; as permissões existentes permanecem.
GRANT SELECT (banner_url) ON public.catalogos TO anon, authenticated;

COMMIT;
