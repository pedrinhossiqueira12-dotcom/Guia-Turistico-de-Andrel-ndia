-- Etapa #41: defesa transacional final contra baixa de saque sem
-- compromisso ORIGINAL prospectivo (HMAC + carimbo local).
-- Impede inclusive RPC service_role de atualizar saque para 'concluido'
-- e, consequentemente, de persistir repasse/remuneracoes na mesma transacao.
-- NAO comprova Pix, titularidade ou liquidacao; nao cria pagamento.
BEGIN;

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_asaas_guardar_baixa_sem_compromisso_pix()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $guard$
BEGIN
 IF OLD.status IS DISTINCT FROM 'concluido'
  AND NEW.status='concluido'
  AND (
   OLD.pix_destino_sha256 IS NULL
   OR OLD.pix_destino_sha256 !~ '^[a-f0-9]{64}$'
   OR OLD.pix_destino_registrado_em IS NULL
   OR NEW.pix_destino_sha256 IS DISTINCT FROM OLD.pix_destino_sha256
   OR NEW.pix_destino_registrado_em IS DISTINCT FROM OLD.pix_destino_registrado_em
  )
 THEN
  RAISE EXCEPTION 'Baixa de saque bloqueada: falta compromisso Pix original com carimbo local'
   USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $guard$;

REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_guardar_baixa_sem_compromisso_pix()
 FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS catalogo_asaas_baixa_exigir_compromisso_pix
 ON public.catalogo_asaas_saques;
CREATE TRIGGER catalogo_asaas_baixa_exigir_compromisso_pix
 BEFORE UPDATE OF status ON public.catalogo_asaas_saques
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_guardar_baixa_sem_compromisso_pix();
COMMENT ON FUNCTION catalogo_private.catalogo_asaas_guardar_baixa_sem_compromisso_pix() IS
 'Exige compromisso local anterior ao concluir saque. NAO atesta Pix bancario nem titularidade.';
COMMIT;
