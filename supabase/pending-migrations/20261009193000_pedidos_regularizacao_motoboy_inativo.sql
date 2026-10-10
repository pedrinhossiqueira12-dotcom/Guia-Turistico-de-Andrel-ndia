-- Pedidos de regularizacao de entregador totalmente inativo, com >=R$100.
-- So registra revisao; NAO movimenta saldo, remuneração, Pix ou repasses.
-- STAGING primeiro. A conclusao monetaria precisa de conciliacao independente.
BEGIN;

CREATE TABLE IF NOT EXISTS public.catalogo_asaas_regularizacoes_inativos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  motoboy_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  saldo_snapshot_centavos bigint NOT NULL CHECK(saldo_snapshot_centavos >= 10000),
  motivo text NOT NULL CHECK(motivo IN ('encerramento','inatividade')),
  status text NOT NULL DEFAULT 'pendente'
    CHECK(status IN ('pendente','em_analise','recusada')),
  justificativa text,
  revisado_por uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  solicitado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  finalizado_em timestamptz,
  CHECK((status='recusada')=(revisado_por IS NOT NULL)),
  CHECK((status='recusada')=(finalizado_em IS NOT NULL)),
  CHECK(status <> 'recusada' OR char_length(btrim(coalesce(justificativa,''))) >= 20)
);

CREATE UNIQUE INDEX IF NOT EXISTS catalogo_asaas_regularizacoes_inativos_abertos_idx
ON public.catalogo_asaas_regularizacoes_inativos(motoboy_id)
WHERE status IN ('pendente','em_analise');

CREATE INDEX IF NOT EXISTS catalogo_asaas_regularizacoes_inativos_data_idx
ON public.catalogo_asaas_regularizacoes_inativos(solicitado_em DESC);

ALTER TABLE public.catalogo_asaas_regularizacoes_inativos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_asaas_regularizacoes_inativos
  FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.catalogo_asaas_regularizacoes_inativos
  TO service_role;

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_guardar_regularizacao_inativo()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $guard$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.status<>'pendente' OR NEW.revisado_por IS NOT NULL
      OR NEW.finalizado_em IS NOT NULL OR NEW.justificativa IS NOT NULL THEN
     RAISE EXCEPTION 'Pedido inicial de regularizacao deve ser pendente'
       USING ERRCODE='23514';
   END IF;
   RETURN NEW;
 END IF;

 -- Identidade, valor e momento da solicitacao sao evidencias imutaveis.
 IF NEW.motoboy_id IS DISTINCT FROM OLD.motoboy_id
    OR NEW.saldo_snapshot_centavos IS DISTINCT FROM OLD.saldo_snapshot_centavos
    OR NEW.motivo IS DISTINCT FROM OLD.motivo
    OR NEW.solicitado_em IS DISTINCT FROM OLD.solicitado_em
    OR OLD.status='recusada' THEN
   RAISE EXCEPTION 'Historico financeiro da solicitacao e imutavel'
     USING ERRCODE='23514';
 END IF;
 IF NOT (
   (OLD.status='pendente' AND NEW.status IN ('em_analise','recusada'))
   OR (OLD.status='em_analise' AND NEW.status='recusada')
 ) THEN
   RAISE EXCEPTION 'Mudanca de estado nao autorizada'
     USING ERRCODE='23514';
 END IF;
 IF NEW.status='recusada' AND
    (NEW.revisado_por IS NULL OR NEW.finalizado_em IS NULL
     OR char_length(btrim(coalesce(NEW.justificativa,'')))<20) THEN
   RAISE EXCEPTION 'Recusa exige revisor, data e justificativa'
     USING ERRCODE='23514';
 END IF;
 IF NEW.status='em_analise' AND
    (NEW.revisado_por IS NOT NULL OR NEW.finalizado_em IS NOT NULL) THEN
   RAISE EXCEPTION 'Analise em aberto nao representa decisao financeira'
     USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$guard$;

REVOKE ALL ON FUNCTION catalogo_private.catalogo_guardar_regularizacao_inativo()
 FROM PUBLIC,anon,authenticated,service_role;

DROP TRIGGER IF EXISTS catalogo_asaas_regularizacoes_inativos_guard
 ON public.catalogo_asaas_regularizacoes_inativos;
CREATE TRIGGER catalogo_asaas_regularizacoes_inativos_guard
 BEFORE INSERT OR UPDATE ON public.catalogo_asaas_regularizacoes_inativos
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_guardar_regularizacao_inativo();

COMMENT ON TABLE public.catalogo_asaas_regularizacoes_inativos IS
 'Regularizacao administrativa, NAO pagamento, de creditos >=R$100 de entregadores sem vinculo ativo.';
COMMIT;
