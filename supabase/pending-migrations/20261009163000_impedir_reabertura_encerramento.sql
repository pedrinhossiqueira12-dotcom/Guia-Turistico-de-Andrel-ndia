-- Impede reabertura acidental por automações antigas enquanto houver encerramento registrado.
BEGIN;
CREATE OR REPLACE FUNCTION catalogo_private.catalogo_impedir_reabertura_encerrada()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF OLD.bloqueado=true AND NEW.bloqueado=false
 AND EXISTS(SELECT 1 FROM public.catalogo_encerramentos_comercio e
  WHERE e.comercio_id=OLD.comercio_id)
 THEN RAISE EXCEPTION 'Comércio com encerramento registrado não pode reabrir automaticamente'
  USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $f$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_impedir_reabertura_encerrada()
 FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS catalogo_encerramento_sem_reabertura ON public.catalogos;
CREATE TRIGGER catalogo_encerramento_sem_reabertura
 BEFORE UPDATE OF bloqueado ON public.catalogos
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_impedir_reabertura_encerrada();

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_impedir_republicacao_encerrada()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF OLD.status='arquivado' AND NEW.status='ativo'
 AND EXISTS(SELECT 1 FROM public.catalogo_encerramentos_comercio e
  WHERE e.comercio_id=OLD.local_id)
 THEN RAISE EXCEPTION 'Reativação de comércio arquivado exige novo processo de cadastro'
  USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $f$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_impedir_republicacao_encerrada()
 FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS catalogo_encerramento_sem_republicacao ON public.comercios_publicados;
CREATE TRIGGER catalogo_encerramento_sem_republicacao
 BEFORE UPDATE OF status ON public.comercios_publicados
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_impedir_republicacao_encerrada();
COMMIT;