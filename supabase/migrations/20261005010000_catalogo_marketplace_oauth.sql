-- OAuth Mercado Pago para recebedores do marketplace.
-- Tokens são armazenados cifrados pelo callback; nunca são enviados ao navegador.
BEGIN;

ALTER TABLE public.catalogo_recebedores
  ADD COLUMN IF NOT EXISTS oauth_user_id text NULL,
  ADD COLUMN IF NOT EXISTS oauth_access_token_enc text NULL,
  ADD COLUMN IF NOT EXISTS oauth_refresh_token_enc text NULL,
  ADD COLUMN IF NOT EXISTS oauth_expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS oauth_scope text NULL,
  ADD COLUMN IF NOT EXISTS oauth_public_key text NULL,
  ADD COLUMN IF NOT EXISTS oauth_live_mode boolean NULL,
  ADD COLUMN IF NOT EXISTS oauth_conectado_em timestamptz NULL;

CREATE UNIQUE INDEX IF NOT EXISTS catalogo_recebedores_oauth_user_idx
  ON public.catalogo_recebedores (oauth_user_id)
  WHERE oauth_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.catalogo_oauth_estados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estado_hash text NOT NULL UNIQUE,
  comercio_id text NOT NULL REFERENCES public.catalogos(comercio_id) ON DELETE CASCADE,
  proprietario_id uuid NOT NULL,
  code_verifier text NOT NULL,
  expira_em timestamptz NOT NULL,
  usado_em timestamptz NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS catalogo_oauth_estados_expira_idx
  ON public.catalogo_oauth_estados (expira_em);

ALTER TABLE public.catalogo_oauth_estados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.catalogo_oauth_estados FROM anon, authenticated;
GRANT ALL ON TABLE public.catalogo_oauth_estados TO service_role;

COMMIT;
