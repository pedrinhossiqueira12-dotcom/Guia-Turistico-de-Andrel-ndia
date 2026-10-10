-- Qualquer evidencia de pagamento excepcional deve disputar a MESMA trava
-- do saque comum e de sua conclusao. Sem essa trava, o INSERT bancario
-- poderia acontecer entre validacao de saldo e baixa de transferencia.
-- A evidencia e FORENSE: nao autoriza novo pagamento, nem remove HOLD.
BEGIN;

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_asaas_evidencia_excepcional_serializada()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $guard$
DECLARE
 v_motoboy uuid;
 v_valor bigint;
BEGIN
 IF NEW.motoboy_id IS NULL THEN
  RAISE EXCEPTION 'Titular da evidencia bancaria ausente' USING ERRCODE='23514';
 END IF;

 -- Mesmo advisory lock utilizado na reserva/baixa do saque comum,
 -- revisoes excepcionais e checks de HOLD (asaas-saque:<uuid>).
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('asaas-saque:'||NEW.motoboy_id::text,0)
 );

 -- Nao basta conferir parametros da RPC: inserts de service_role
 -- precisam provar que a referencia pertence a esse titular e valor.
 IF NEW.tipo='residual' THEN
  SELECT r.motoboy_id,r.saldo_snapshot_centavos::bigint
  INTO v_motoboy,v_valor
  FROM public.catalogo_asaas_saldos_residuais r
  WHERE r.id=NEW.solicitacao_id;
 ELSIF NEW.tipo='saida' THEN
  SELECT r.motoboy_id,r.saldo_snapshot_centavos
  INTO v_motoboy,v_valor
  FROM public.catalogo_asaas_regularizacoes_inativos r
  WHERE r.id=NEW.solicitacao_id;
 ELSE
  RAISE EXCEPTION 'Tipo de evidencia excepcional desconhecido' USING ERRCODE='23514';
 END IF;

 IF v_motoboy IS DISTINCT FROM NEW.motoboy_id
  OR v_valor IS DISTINCT FROM NEW.valor_centavos THEN
  RAISE EXCEPTION 'Evidencia nao pertence ao titular ou valor da solicitacao'
   USING ERRCODE='23514';
 END IF;

 -- Mesmo quando um saque comum ja foi concluido, NAO descartar prova
 -- bancaria posterior. O conflito permanece registrado para apuracao;
 -- nunca marcar credito como pago por esta rotina.
 RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_evidencia_excepcional_serializada()
 FROM PUBLIC,anon,authenticated,service_role;

DROP TRIGGER IF EXISTS catalogo_asaas_serializar_evidencia_excepcional
 ON public.catalogo_asaas_transferencias_excepcionais_auditoria;
CREATE TRIGGER catalogo_asaas_serializar_evidencia_excepcional
 BEFORE INSERT ON public.catalogo_asaas_transferencias_excepcionais_auditoria
 FOR EACH ROW
 EXECUTE FUNCTION catalogo_private.catalogo_asaas_evidencia_excepcional_serializada();

COMMIT;
