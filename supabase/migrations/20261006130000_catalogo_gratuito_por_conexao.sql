BEGIN;
-- Catálogo gratuito: conexão OAuth ativa do Mercado Pago é o requisito de ativação.
-- Assinaturas antigas permanecem apenas como histórico e não controlam o acesso.
CREATE OR REPLACE FUNCTION catalogo_private.catalogo_esta_ativo(p_comercio_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.comercios_publicados cp
    JOIN public.catalogos c ON c.comercio_id = cp.local_id
    JOIN public.catalogo_recebedores r ON r.comercio_id = c.comercio_id
    WHERE cp.local_id = p_comercio_id
      AND cp.status = 'ativo'
      AND NOT c.bloqueado
      AND r.status = 'ativo'
      AND r.conta_externa_id IS NOT NULL
  );
$$;
COMMENT ON FUNCTION catalogo_private.catalogo_esta_ativo(text)
  IS 'Catálogo gratuito: ativo quando publicado, desbloqueado e com recebedor Mercado Pago OAuth ativo.';
COMMIT;
