-- Solicitação de avaliação de saldo residual. NÃO autoriza Pix nem liquida remuneração.
-- STAGING exclusivamente; trilha de auditoria imutável das solicitações.
BEGIN;
CREATE TABLE IF NOT EXISTS public.catalogo_asaas_saldos_residuais(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 motoboy_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 saldo_snapshot_centavos integer NOT NULL CHECK(saldo_snapshot_centavos BETWEEN 1 AND 9999),
 motivo text NOT NULL CHECK(motivo IN ('encerramento','inatividade')),
 status text NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','em_analise','concluida','recusada')),
 detalhe_revisao text,
 analisado_por uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 solicitado_em timestamptz NOT NULL DEFAULT now(),
 atualizado_em timestamptz NOT NULL DEFAULT now(),
 finalizado_em timestamptz,
 CHECK ((status IN ('concluida','recusada'))=(finalizado_em IS NOT NULL)),
 CHECK ((status IN ('concluida','recusada'))=(analisado_por IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS catalogo_asaas_saldo_residual_aberto_idx
 ON public.catalogo_asaas_saldos_residuais(motoboy_id)
 WHERE status IN ('pendente','em_analise');
CREATE INDEX IF NOT EXISTS catalogo_asaas_saldos_residuais_motoboy_idx
 ON public.catalogo_asaas_saldos_residuais(motoboy_id,solicitado_em DESC);
ALTER TABLE public.catalogo_asaas_saldos_residuais ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_asaas_saldos_residuais FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.catalogo_asaas_saldos_residuais TO service_role;
COMMENT ON TABLE public.catalogo_asaas_saldos_residuais IS 'Pedidos de revisão de saldo abaixo de R$100; não são repasses, créditos novos nem comprovantes de pagamento.';
COMMIT;
