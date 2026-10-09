-- Evidencias de consultas ao Asaas Sandbox para transferencias excepcionais.
-- NAO cria Pix, NAO marca solicitacao concluida e NAO altera remuneracoes.
-- A inscricao so pode ser chamada por service_role DEPOIS de GET /transfers/id.
-- Exige externalReference 'guia-exc:<tipo>:<uuid>' e valor exato da solicitacao.
BEGIN;

CREATE TABLE IF NOT EXISTS public.catalogo_asaas_transferencias_excepcionais_auditoria (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tipo text NOT NULL CHECK(tipo IN ('residual','saida')),
 solicitacao_id uuid NOT NULL,
 motoboy_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 valor_centavos bigint NOT NULL CHECK(valor_centavos>0),
 transferencia_id text NOT NULL UNIQUE
   CHECK(length(transferencia_id) BETWEEN 4 AND 130),
 referencia_externa text NOT NULL UNIQUE,
 criado_em timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tipo,solicitacao_id),
 CHECK(referencia_externa='guia-exc:'||tipo||':'||solicitacao_id::text)
);

CREATE TABLE IF NOT EXISTS public.catalogo_asaas_observacoes_excepcionais_auditoria (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 vinculo_id uuid NOT NULL REFERENCES public.catalogo_asaas_transferencias_excepcionais_auditoria(id)
   ON DELETE RESTRICT,
 estado_banco text NOT NULL CHECK(estado_banco IN (
   'PENDING','IN_BANK_PROCESSING','BLOCKED','DONE','FAILED','CANCELLED'
 )),
 observado_em timestamptz NOT NULL DEFAULT now(),
 UNIQUE(vinculo_id,estado_banco)
);

ALTER TABLE public.catalogo_asaas_transferencias_excepcionais_auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_asaas_observacoes_excepcionais_auditoria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_asaas_transferencias_excepcionais_auditoria
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.catalogo_asaas_observacoes_excepcionais_auditoria
 FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.catalogo_asaas_transferencias_excepcionais_auditoria TO service_role;
GRANT SELECT,INSERT ON public.catalogo_asaas_observacoes_excepcionais_auditoria TO service_role;

-- Apende apenas evidências recebidas de uma CONSULTA do provedor.
-- A identidade e o valor são validados no PostgreSQL; não existe baixa.
CREATE OR REPLACE FUNCTION public.catalogo_asaas_registrar_observacao_excepcional(
 p_tipo text,p_solicitacao uuid,p_transferencia text,
 p_referencia text,p_valor_centavos bigint,p_estado text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $record$
DECLARE
 v_owner uuid;
 v_expected bigint;
 v_link uuid;
 v_transfer text;
 v_ref text;
 v_inserted integer;
BEGIN
 IF p_tipo IS NULL OR p_tipo NOT IN ('residual','saida')
 OR p_solicitacao IS NULL
 OR p_transferencia IS NULL OR p_transferencia !~ '^[A-Za-z0-9_-]{4,130}$'
 OR p_referencia IS DISTINCT FROM
   ('guia-exc:'||p_tipo||':'||p_solicitacao::text)
 OR p_valor_centavos IS NULL OR p_valor_centavos<=0
 OR p_estado IS NULL OR p_estado NOT IN (
   'PENDING','IN_BANK_PROCESSING','BLOCKED','DONE','FAILED','CANCELLED'
 ) THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Observacao bancaria invalida.');
 END IF;

 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('guia-exc-banco:'||p_tipo||':'||p_solicitacao::text,0)
 );

 IF p_tipo='residual' THEN
  SELECT r.motoboy_id,r.saldo_snapshot_centavos::bigint
   INTO v_owner,v_expected
  FROM public.catalogo_asaas_saldos_residuais r WHERE r.id=p_solicitacao;
 ELSE
  SELECT r.motoboy_id,r.saldo_snapshot_centavos
   INTO v_owner,v_expected
  FROM public.catalogo_asaas_regularizacoes_inativos r WHERE r.id=p_solicitacao;
 END IF;

 IF v_owner IS NULL OR v_expected<>p_valor_centavos THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Valor ou solicitacao divergente.');
 END IF;

 INSERT INTO public.catalogo_asaas_transferencias_excepcionais_auditoria
  (tipo,solicitacao_id,motoboy_id,valor_centavos,transferencia_id,referencia_externa)
 VALUES(p_tipo,p_solicitacao,v_owner,v_expected,p_transferencia,p_referencia)
 ON CONFLICT (tipo,solicitacao_id) DO NOTHING;

 SELECT id,transferencia_id,referencia_externa INTO v_link,v_transfer,v_ref
 FROM public.catalogo_asaas_transferencias_excepcionais_auditoria
 WHERE tipo=p_tipo AND solicitacao_id=p_solicitacao;

 IF v_link IS NULL OR v_transfer IS DISTINCT FROM p_transferencia
 OR v_ref IS DISTINCT FROM p_referencia THEN
  RETURN jsonb_build_object('ok',false,
   'mensagem','Outra transferencia ja esta vinculada. Bloqueado para revisao.');
 END IF;

 INSERT INTO public.catalogo_asaas_observacoes_excepcionais_auditoria
  (vinculo_id,estado_banco) VALUES(v_link,p_estado)
 ON CONFLICT (vinculo_id,estado_banco) DO NOTHING;
 GET DIAGNOSTICS v_inserted=ROW_COUNT;

 RETURN jsonb_build_object('ok',true,'vinculo_id',v_link,
  'observacao_nova',v_inserted=1,
  'estado_observado',p_estado,'pagamento_baixado',false,
  'transferencia_gerada',false,'requer_validacao_destinatario',true,
  'mensagem','Estado observado no provedor; sem comprovacao completa de beneficiario ou baixa de credito.');
END
$record$;

REVOKE ALL ON FUNCTION public.catalogo_asaas_registrar_observacao_excepcional(
 text,uuid,text,text,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_registrar_observacao_excepcional(
 text,uuid,text,text,bigint,text) TO service_role;

COMMENT ON TABLE public.catalogo_asaas_transferencias_excepcionais_auditoria IS
 'Vinculo de observacao Asaas Sandbox; nao constitui autorizacao ou conciliacao de pagamento.';
COMMENT ON TABLE public.catalogo_asaas_observacoes_excepcionais_auditoria IS
 'Estados observados de GET do banco; DONE nao baixa comissoes nem confirma destinatario.';

COMMIT;
