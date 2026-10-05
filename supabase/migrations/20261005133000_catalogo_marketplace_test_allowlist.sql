BEGIN;

CREATE TABLE IF NOT EXISTS public.catalogo_marketplace_testes (
  comercio_id text PRIMARY KEY REFERENCES public.catalogos(comercio_id) ON DELETE CASCADE,
  ativo boolean NOT NULL DEFAULT true,
  motivo text NOT NULL DEFAULT 'Teste controlado do marketplace',
  criado_em timestamptz NOT NULL DEFAULT pg_catalog.now(),
  atualizado_em timestamptz NOT NULL DEFAULT pg_catalog.now()
);

ALTER TABLE public.catalogo_marketplace_testes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.catalogo_marketplace_testes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.catalogo_marketplace_testes TO service_role;

INSERT INTO public.catalogo_marketplace_testes (comercio_id, ativo, motivo)
VALUES ('comercio-de-exemplo', true, 'Teste controlado do checkout offline marketplace')
ON CONFLICT (comercio_id) DO UPDATE SET ativo = EXCLUDED.ativo, motivo = EXCLUDED.motivo, atualizado_em = pg_catalog.now();

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_esta_ativo(p_comercio_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.comercios_publicados cp
    JOIN public.catalogos c ON c.comercio_id = cp.local_id
    WHERE cp.local_id = p_comercio_id
      AND cp.status = 'ativo'
      AND NOT c.bloqueado
      AND (
        EXISTS (
          SELECT 1 FROM public.catalogo_assinaturas ca
          WHERE ca.comercio_id = cp.local_id
            AND ca.status = 'ativa'
            AND (ca.expira_em IS NULL OR ca.expira_em > pg_catalog.now())
        )
        OR EXISTS (
          SELECT 1 FROM public.catalogo_marketplace_testes mt
          WHERE mt.comercio_id = cp.local_id AND mt.ativo
        )
      )
  );
$$;

COMMIT;
