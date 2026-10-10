-- #41: uma transferencia Asaas ja vinculada a uma evidencia excepcional
-- nao pode ser reclamada por NOVO saque regular, mesmo em outro motoboy.
-- IMPORTANTE: evidencias excepcionais tardias continuam permitidas, inclusive
-- quando o mesmo ID ja aparece em saque regular concluido. Isto e FORENSE:
-- nao suprimir provas tardias e nao inferir quitação nem titularidade.
-- Nenhum endpoint de Pix, nenhuma baixa ou desbloqueio.
BEGIN;

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_asaas_impedir_reuso_bancario_em_saque_regular()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $guard$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.transferencia_id IS NOT NULL
   AND NEW.transferencia_id IS DISTINCT FROM OLD.transferencia_id THEN
   RAISE EXCEPTION 'ID bancario associado a saque regular e imutavel'
    USING ERRCODE='23514';
  END IF;
  IF NEW.transferencia_id IS NOT DISTINCT FROM OLD.transferencia_id THEN
   RETURN NEW;
  END IF;
 END IF;

 IF NEW.transferencia_id IS NULL THEN RETURN NEW; END IF;

 IF NEW.motoboy_id IS NULL
  OR NEW.transferencia_id !~ '^[A-Za-z0-9_-]{4,130}$' THEN
  RAISE EXCEPTION 'Identificador de saque ou ID bancario invalido'
   USING ERRCODE='23514';
 END IF;

 -- Mesmo lock de motoboy das reservas e observacoes, ANTES do lock por ID
 -- bancario. Funciona para IDs coincidentes de titulares DIFERENTES.
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('asaas-saque:'||NEW.motoboy_id::text,0)
 );
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('asaas-transfer-claim:'||NEW.transferencia_id,0)
 );
 IF EXISTS(
  SELECT 1 FROM public.catalogo_asaas_transferencias_excepcionais_auditoria e
  WHERE e.transferencia_id=NEW.transferencia_id
 ) THEN
  RAISE EXCEPTION 'ID bancario ja consta em evidencia excepcional: manter HOLD'
   USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION
 catalogo_private.catalogo_asaas_impedir_reuso_bancario_em_saque_regular()
 FROM PUBLIC,anon,authenticated,service_role;

DROP TRIGGER IF EXISTS yy_catalogo_asaas_nao_reusar_transferencia_regular
 ON public.catalogo_asaas_saques;
CREATE TRIGGER yy_catalogo_asaas_nao_reusar_transferencia_regular
 BEFORE INSERT OR UPDATE OF transferencia_id ON public.catalogo_asaas_saques
 FOR EACH ROW
 EXECUTE FUNCTION catalogo_private.catalogo_asaas_impedir_reuso_bancario_em_saque_regular();

-- Trava no ID (mesma ordem motoboy -> banco) antes de inserir evidencia.
-- Nao comparar nem rejeitar pela existencia do saque comum: se o evento
-- for descoberto tarde, deve permanecer registrado para apuracao.
CREATE OR REPLACE FUNCTION catalogo_private.catalogo_asaas_serializar_id_evidencia_tardia()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $guard$
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('asaas-saque:'||NEW.motoboy_id::text,0)
 );
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('asaas-transfer-claim:'||NEW.transferencia_id,0)
 );
 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION
 catalogo_private.catalogo_asaas_serializar_id_evidencia_tardia()
 FROM PUBLIC,anon,authenticated,service_role;

-- Nome "zy" executa APOS catalogo_asaas_serializar_evidencia_excepcional:
-- locks sao adquiridos na mesma ordem em ambos os fluxos.
DROP TRIGGER IF EXISTS zy_catalogo_asaas_serializar_id_evidencia_tardia
 ON public.catalogo_asaas_transferencias_excepcionais_auditoria;
CREATE TRIGGER zy_catalogo_asaas_serializar_id_evidencia_tardia
 BEFORE INSERT ON public.catalogo_asaas_transferencias_excepcionais_auditoria
 FOR EACH ROW
 EXECUTE FUNCTION catalogo_private.catalogo_asaas_serializar_id_evidencia_tardia();

-- Uma vez aceita, a prova de observacao nao pode trocar ID, titular, valor,
-- nem ser apagada e mascarar divergencia posterior.
CREATE OR REPLACE FUNCTION catalogo_private.catalogo_asaas_evidencia_bancaria_imutavel()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $immutable$
BEGIN
 RAISE EXCEPTION 'Evidencia bancaria excepcional e append-only'
  USING ERRCODE='23514';
END $immutable$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_evidencia_bancaria_imutavel()
 FROM PUBLIC,anon,authenticated,service_role;

DROP TRIGGER IF EXISTS zz_catalogo_asaas_evidencia_bancaria_imutavel
 ON public.catalogo_asaas_transferencias_excepcionais_auditoria;
CREATE TRIGGER zz_catalogo_asaas_evidencia_bancaria_imutavel
 BEFORE UPDATE OR DELETE ON public.catalogo_asaas_transferencias_excepcionais_auditoria
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_evidencia_bancaria_imutavel();

COMMENT ON FUNCTION catalogo_private.catalogo_asaas_impedir_reuso_bancario_em_saque_regular() IS
 'Barra saque regular que tenta usar evidencia excepcional preexistente; nao impede inserir prova tardia nem libera dinheiro.';
COMMIT;
