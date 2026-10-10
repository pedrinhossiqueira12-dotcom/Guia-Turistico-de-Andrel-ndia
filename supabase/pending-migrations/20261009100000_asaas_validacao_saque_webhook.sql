-- Homologação Asaas: snapshot imutável do destino Pix + trilha de autorizações.
-- RLS ativo, dados privados; NÃO movimenta saques existentes nem altera a produção.
BEGIN;

ALTER TABLE public.catalogo_asaas_saques
  ADD COLUMN IF NOT EXISTS pix_destino_sha256 text;
ALTER TABLE public.catalogo_asaas_saques
  DROP CONSTRAINT IF EXISTS catalogo_asaas_saques_pix_destino_sha256_check;
ALTER TABLE public.catalogo_asaas_saques
  ADD CONSTRAINT catalogo_asaas_saques_pix_destino_sha256_check
  CHECK (pix_destino_sha256 IS NULL OR pix_destino_sha256 ~ '^[a-f0-9]{64}$');

CREATE TABLE IF NOT EXISTS public.catalogo_asaas_validacoes_saque (
  saque_id uuid NOT NULL REFERENCES public.catalogo_asaas_saques(id) ON DELETE RESTRICT,
  transferencia_id text NOT NULL UNIQUE,
  decisao text NOT NULL CHECK(decisao IN ('APPROVED','REFUSED')),
  motivo text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (saque_id, transferencia_id)
);

ALTER TABLE public.catalogo_asaas_validacoes_saque ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_asaas_validacoes_saque FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT ON public.catalogo_asaas_validacoes_saque TO service_role;

COMMIT;
