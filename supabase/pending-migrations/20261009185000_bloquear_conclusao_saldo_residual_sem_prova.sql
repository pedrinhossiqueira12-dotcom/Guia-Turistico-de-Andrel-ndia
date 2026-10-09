-- Solicitacoes residuais ainda nao tem um fluxo de repasse com comprovacao.
-- Ate que haja conciliacao idempotente comprovada, nao permitir concluir como pago.
-- STAGING apenas: nao cria transferencia Pix nem reduz saldo da carteira.
BEGIN;

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_guardar_analise_residual()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $guard$
BEGIN
  IF NEW.status = 'concluida' THEN
    RAISE EXCEPTION
      'Conclusao indisponivel sem conciliacao financeira e comprovante de pagamento'
      USING ERRCODE='23514';
  END IF;

  IF TG_OP='UPDATE' THEN
    IF OLD.status IN ('concluida','recusada') THEN
      RAISE EXCEPTION 'Historico de analise finalizada e imutavel'
        USING ERRCODE='23514';
    END IF;

    IF NEW.motoboy_id IS DISTINCT FROM OLD.motoboy_id
       OR NEW.saldo_snapshot_centavos IS DISTINCT FROM OLD.saldo_snapshot_centavos
       OR NEW.motivo IS DISTINCT FROM OLD.motivo
       OR NEW.solicitado_em IS DISTINCT FROM OLD.solicitado_em THEN
      RAISE EXCEPTION 'Identidade e valores originais da analise sao imutaveis'
        USING ERRCODE='23514';
    END IF;
  END IF;

  IF NEW.status = 'recusada'
    AND nullif(btrim(coalesce(NEW.detalhe_revisao,'')), '') IS NULL THEN
    RAISE EXCEPTION 'Recusa de saldo residual exige justificativa'
      USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END;
$guard$;

REVOKE ALL ON FUNCTION catalogo_private.catalogo_guardar_analise_residual()
  FROM PUBLIC,anon,authenticated,service_role;

DROP TRIGGER IF EXISTS catalogo_asaas_saldo_residual_sem_quitacao_falsa
  ON public.catalogo_asaas_saldos_residuais;
CREATE TRIGGER catalogo_asaas_saldo_residual_sem_quitacao_falsa
BEFORE INSERT OR UPDATE ON public.catalogo_asaas_saldos_residuais
FOR EACH ROW
EXECUTE FUNCTION catalogo_private.catalogo_guardar_analise_residual();
COMMIT;
