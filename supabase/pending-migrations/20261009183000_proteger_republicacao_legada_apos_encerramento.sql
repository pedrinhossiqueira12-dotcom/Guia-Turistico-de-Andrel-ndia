-- Protecao complementar para o endpoint legado whatsapp-bot.
-- Impede republicacao mesmo quando a publicacao antiga foi marcada "deletado",
-- "pendente" ou foi removida. Requer as migrations de encerramento anteriores.
-- STAGING apenas; sem deploy automatico e sem tocar em dados financeiros.
BEGIN;

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_impedir_republicacao_encerrada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $guard$
BEGIN
  -- Serializa com catalogo_solicitar_encerramento_financeiro, que bloqueia
  -- o mesmo catalogo antes de registrar a solicitacao de encerramento.
  PERFORM 1 FROM public.catalogos
  WHERE comercio_id = NEW.local_id FOR UPDATE;

  IF NEW.status = 'ativo'
     AND EXISTS (
       SELECT 1 FROM public.catalogo_encerramentos_comercio AS e
       WHERE e.comercio_id = NEW.local_id
         AND e.situacao IN (
           'aguardando_quitacao',
           'pendente_arquivamento',
           'arquivado'
         )
     )
  THEN
    RAISE EXCEPTION
      'Comercio com encerramento registrado nao pode ser republicado por rota legada'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$guard$;

REVOKE ALL ON FUNCTION catalogo_private.catalogo_impedir_republicacao_encerrada()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS catalogo_encerramento_sem_republicacao
  ON public.comercios_publicados;

-- Cobre tambem o UPSERT do whatsapp-bot que insere status=ativo.
CREATE TRIGGER catalogo_encerramento_sem_republicacao
BEFORE INSERT OR UPDATE OF status ON public.comercios_publicados
FOR EACH ROW
EXECUTE FUNCTION catalogo_private.catalogo_impedir_republicacao_encerrada();

COMMIT;
