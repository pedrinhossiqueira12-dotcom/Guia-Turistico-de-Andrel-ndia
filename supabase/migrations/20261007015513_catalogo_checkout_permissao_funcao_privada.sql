-- Versão aplicada em produção: 20261007015513.
-- A view pública precisa da execução da validação para o serviço de checkout.
-- Não altera RLS, ownership, search_path, SECURITY DEFINER nem permissões públicas.
DO $permission$
BEGIN
  IF to_regprocedure('catalogo_private.catalogo_esta_ativo(text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION catalogo_private.catalogo_esta_ativo(text) TO service_role;
  ELSIF to_regprocedure('public.catalogo_esta_ativo(text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.catalogo_esta_ativo(text) TO service_role;
  ELSE
    RAISE EXCEPTION 'Função de validação do catálogo ausente; nenhuma permissão foi ampliada.';
  END IF;
END;
$permission$;
NOTIFY pgrst, 'reload schema';
