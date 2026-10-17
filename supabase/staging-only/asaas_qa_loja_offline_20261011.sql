-- COB-02 / STAGING ONLY: loja asaas-homologacao sem MP, apenas para ensaio
-- NAO executar em PRODUCAO; NAO copiar para pending-migrations ou migrations.
-- Conserva verificacao de publicacao e bloqueio, e todas as outras lojas
-- continuam exigindo recebedor Mercado Pago ativo.
CREATE OR REPLACE FUNCTION catalogo_private.catalogo_esta_ativo(p_comercio_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.comercios_publicados cp
      JOIN public.catalogos c ON c.comercio_id=cp.local_id
      LEFT JOIN public.catalogo_recebedores r ON r.comercio_id=c.comercio_id
     WHERE cp.local_id=p_comercio_id
       AND cp.status='ativo'
       AND NOT c.bloqueado
       AND c.proprietario_id IS NOT NULL
       AND (
          (r.status='ativo' AND r.conta_externa_id IS NOT NULL)
          OR (p_comercio_id='asaas-homologacao')
       )
  );
$function$;
-- Rollback operado pelo DBA: restituir a definicao de catalogo_esta_ativo
-- da migration original, retirando apenas o OR de homologacao.
