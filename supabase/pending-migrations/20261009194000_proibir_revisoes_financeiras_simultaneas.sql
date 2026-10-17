-- Impede duas solicitacoes financeiras abertas do mesmo entregador em fluxos
-- diferentes (< R$100 residual e >= R$100 saida) quando o saldo muda.
-- Apenas trava pedidos. Nao reserva, paga ou altera qualquer credito.
-- STAGING primeiro. Revisar conflitos existentes antes de migrar producao.
BEGIN;

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.catalogo_asaas_saldos_residuais r
    JOIN public.catalogo_asaas_regularizacoes_inativos s
      ON s.motoboy_id=r.motoboy_id
    WHERE r.status IN ('pendente','em_analise')
      AND s.status IN ('pendente','em_analise')
  ) THEN
    RAISE EXCEPTION 'Existem revisoes financeiras simultaneas; concilie as solicitacoes antes de aplicar a migration'
      USING ERRCODE='23514';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_impedir_revisoes_sobrepostas()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $guard$
BEGIN
  -- Ambas as tabelas usam o MESMO lock do titular, em transacao: chamadas
  -- concorrentes nao podem passar simultaneamente pela verificacao.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('revisao-financeira-motoboy:'||NEW.motoboy_id::text,0)
  );

  IF TG_TABLE_NAME='catalogo_asaas_saldos_residuais' THEN
    IF EXISTS (
      SELECT 1 FROM public.catalogo_asaas_regularizacoes_inativos s
      WHERE s.motoboy_id=NEW.motoboy_id
        AND s.status IN ('pendente','em_analise')
    ) THEN
      RAISE EXCEPTION 'Existe regularizacao de saida em aberto. Consulte a administracao antes de criar nova analise.'
        USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='catalogo_asaas_regularizacoes_inativos' THEN
    IF EXISTS (
      SELECT 1 FROM public.catalogo_asaas_saldos_residuais r
      WHERE r.motoboy_id=NEW.motoboy_id
        AND r.status IN ('pendente','em_analise')
    ) THEN
      RAISE EXCEPTION 'Existe analise residual em aberto. Consulte a administracao antes de criar nova regularizacao.'
        USING ERRCODE='23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Tabela de solicitacoes nao autorizada'
      USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION catalogo_private.catalogo_impedir_revisoes_sobrepostas()
  FROM PUBLIC,anon,authenticated,service_role;

DROP TRIGGER IF EXISTS catalogo_asaas_residual_sem_sobreposicao
  ON public.catalogo_asaas_saldos_residuais;
CREATE TRIGGER catalogo_asaas_residual_sem_sobreposicao
BEFORE INSERT ON public.catalogo_asaas_saldos_residuais
FOR EACH ROW
EXECUTE FUNCTION catalogo_private.catalogo_impedir_revisoes_sobrepostas();

DROP TRIGGER IF EXISTS catalogo_asaas_regularizacao_sem_sobreposicao
  ON public.catalogo_asaas_regularizacoes_inativos;
CREATE TRIGGER catalogo_asaas_regularizacao_sem_sobreposicao
BEFORE INSERT ON public.catalogo_asaas_regularizacoes_inativos
FOR EACH ROW
EXECUTE FUNCTION catalogo_private.catalogo_impedir_revisoes_sobrepostas();

COMMIT;
