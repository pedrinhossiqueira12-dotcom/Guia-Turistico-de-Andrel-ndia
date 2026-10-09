-- HOLD por evidência bancária excepcional, inclusive se a solicitação foi recusada.
-- O estado 'DONE' observado NÃO é quitação; o vínculo bancário não pode ser
-- esquecido e permitir que o mesmo saldo volte a ser sacado.
-- NÃO emite Pix, reserva créditos ou atualiza remuneração. Só bloqueia.
-- Remoção do hold exigirá FUTURA conciliação documental/contábil auditável.
BEGIN;

DO $preflight$
BEGIN
 IF EXISTS (
   SELECT 1
   FROM public.catalogo_asaas_saques s
   JOIN public.catalogo_asaas_transferencias_excepcionais_auditoria e
    ON e.motoboy_id=s.motoboy_id
   WHERE s.status IN ('reservado','enviado','revisao')
 ) THEN
  RAISE EXCEPTION 'Há transferência excepcional observada e saque comum em aberto; bloquear implantação e conciliar.'
   USING ERRCODE='23514';
 END IF;
END $preflight$;

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_reter_creditos_com_evidencia_excepcional()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $hold$
BEGIN
 IF NEW.motoboy_id IS NULL THEN
  RAISE EXCEPTION 'Titular do registro financeiro ausente'
   USING ERRCODE='23514';
 END IF;

 -- Mesmo lock usado pelo saque comum e pelo pedido de revisão.
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('asaas-saque:'||NEW.motoboy_id::text,0)
 );

 IF EXISTS(
  SELECT 1
  FROM public.catalogo_asaas_transferencias_excepcionais_auditoria e
  WHERE e.motoboy_id=NEW.motoboy_id
 ) THEN
  RAISE EXCEPTION 'Há evidência bancária excepcional não conciliada. Manter saldos bloqueados até revisão financeira.'
   USING ERRCODE='23514';
 END IF;

 RETURN NEW;
END
$hold$;

REVOKE ALL ON FUNCTION catalogo_private.catalogo_reter_creditos_com_evidencia_excepcional()
 FROM PUBLIC,anon,authenticated,service_role;

-- 'zz_' sempre roda DEPOIS das verificações anteriores (A->B).
DROP TRIGGER IF EXISTS zz_catalogo_hold_saque_evidencia_excepcional
 ON public.catalogo_asaas_saques;
CREATE TRIGGER zz_catalogo_hold_saque_evidencia_excepcional
 BEFORE INSERT ON public.catalogo_asaas_saques
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_reter_creditos_com_evidencia_excepcional();

DROP TRIGGER IF EXISTS zz_catalogo_hold_residual_evidencia_excepcional
 ON public.catalogo_asaas_saldos_residuais;
CREATE TRIGGER zz_catalogo_hold_residual_evidencia_excepcional
 BEFORE INSERT ON public.catalogo_asaas_saldos_residuais
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_reter_creditos_com_evidencia_excepcional();

DROP TRIGGER IF EXISTS zz_catalogo_hold_saida_evidencia_excepcional
 ON public.catalogo_asaas_regularizacoes_inativos;
CREATE TRIGGER zz_catalogo_hold_saida_evidencia_excepcional
 BEFORE INSERT ON public.catalogo_asaas_regularizacoes_inativos
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_reter_creditos_com_evidencia_excepcional();

-- Um saque regular já criado também não pode passar para 'concluido'
-- enquanto existe uma evidência excepcional ainda não conciliada.
DROP TRIGGER IF EXISTS zz_catalogo_hold_conclusao_saque_evidencia_excepcional
 ON public.catalogo_asaas_saques;
CREATE TRIGGER zz_catalogo_hold_conclusao_saque_evidencia_excepcional
 BEFORE UPDATE OF status ON public.catalogo_asaas_saques
 FOR EACH ROW
 WHEN (NEW.status='concluido' AND OLD.status IS DISTINCT FROM NEW.status)
 EXECUTE FUNCTION catalogo_private.catalogo_reter_creditos_com_evidencia_excepcional();

COMMIT;
