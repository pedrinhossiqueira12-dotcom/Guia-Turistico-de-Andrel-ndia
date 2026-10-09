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
  -- A loja pode ter sido apagada da publicação pelo fluxo legado depois do
  -- encerramento. Nesse caso, o tombstone financeiro ainda deve ocultá-la.
  -- Não devolver linhas para IDs ausentes nos dois registros: muitos comércios
  -- do JSON editorial não possuem linha em comercios_publicados.
  RETURN QUERY
    SELECT ids.id::text,
      CASE WHEN e.situacao = 'arquivado' THEN 'arquivado'
           ELSE c.status::text END
    FROM (SELECT DISTINCT unnest(p_ids) AS id) AS ids
    LEFT JOIN public.comercios_publicados AS c ON c.local_id = ids.id
    LEFT JOIN public.catalogo_encerramentos_comercio AS e
      ON e.comercio_id = ids.id AND e.situacao = 'arquivado'
    WHERE c.local_id IS NOT NULL OR e.comercio_id IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.catalogo_status_publicacao(text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_status_publicacao(text[]) TO anon,authenticated;
COMMIT;
