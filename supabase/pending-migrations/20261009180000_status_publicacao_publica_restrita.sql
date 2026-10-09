-- Apenas o status da publicação é público; nunca conceder SELECT da tabela.
-- PENDENTE: aplicar somente em STAGING antes de habilitar frontend.
BEGIN;
CREATE OR REPLACE FUNCTION public.catalogo_status_publicacao(p_ids text[])
RETURNS TABLE(local_id text, status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) > 100 OR
     EXISTS(SELECT 1 FROM unnest(p_ids) AS id WHERE id IS NULL OR length(id)>200 OR length(id)=0)
  THEN
    RAISE EXCEPTION 'Lote inválido (máximo 100 IDs)' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
    SELECT c.local_id::text, c.status::text
    FROM public.comercios_publicados c
    WHERE c.local_id = ANY(p_ids);
END;
$$;
REVOKE ALL ON FUNCTION public.catalogo_status_publicacao(text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_status_publicacao(text[]) TO anon,authenticated;
COMMIT;
