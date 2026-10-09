-- Fotografia contábil SEM pagamento vinculada a evidência bancária.
-- Snapshot é observado depois do GET, não na emissão real do Pix.
-- Não autoriza, não baixa crédito, não confere destinatário e não remove HOLD.
BEGIN;
ALTER TABLE public.catalogo_asaas_transferencias_excepcionais_auditoria
 ADD COLUMN IF NOT EXISTS creditos_fingerprint_observado_sha256 text
  CHECK(creditos_fingerprint_observado_sha256 ~ '^[a-f0-9]{64}$'),
 ADD COLUMN IF NOT EXISTS creditos_observados bigint CHECK(creditos_observados>=0),
 ADD COLUMN IF NOT EXISTS valor_creditos_observados_centavos bigint CHECK(valor_creditos_observados_centavos>=0),
 ADD COLUMN IF NOT EXISTS composicao_conferida_na_observacao boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS fotografia_observada_em timestamptz;
CREATE OR REPLACE FUNCTION catalogo_private.catalogo_asaas_evidencia_excepcional_serializada()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $guard$
DECLARE
 v_motoboy uuid;
 v_valor bigint;
 v_fotografia jsonb;
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

 -- Fotografia da carteira no momento de OBSERVAR a transferencia.
 -- Pode ser posterior a transferencia; nao e comprovante de pagamento.
 -- Captura feita NO BANCO: ignorar fingerprint enviada pelo cliente.
 -- Se preconferencia falhar, manter a evidência e deixar fotografia vazia.
 BEGIN
  v_fotografia:=public.catalogo_asaas_preconferir_pagamento_excepcional(
   NEW.tipo,NEW.solicitacao_id);
 EXCEPTION WHEN OTHERS THEN
  v_fotografia:=NULL;
 END;
 NEW.creditos_fingerprint_observado_sha256:=
  CASE WHEN (v_fotografia->>'fingerprint_creditos_sha256') ~ '^[a-f0-9]{64}
 -- bancaria posterior. O conflito permanece registrado para apuracao;
 -- nunca marcar credito como pago por esta rotina.
 RETURN NEW;
END
$guard$;
   THEN v_fotografia->>'fingerprint_creditos_sha256' ELSE NULL END;
 NEW.creditos_observados:=
  CASE WHEN (v_fotografia->>'creditos_individuais_validos') ~ '^[0-9]{1,18}
 -- bancaria posterior. O conflito permanece registrado para apuracao;
 -- nunca marcar credito como pago por esta rotina.
 RETURN NEW;
END
$guard$;
   THEN (v_fotografia->>'creditos_individuais_validos')::bigint ELSE NULL END;
 NEW.valor_creditos_observados_centavos:=
  CASE WHEN (v_fotografia->>'valor_creditos_individuais_centavos') ~ '^[0-9]{1,18}
 -- bancaria posterior. O conflito permanece registrado para apuracao;
 -- nunca marcar credito como pago por esta rotina.
 RETURN NEW;
END
$guard$;
   THEN (v_fotografia->>'valor_creditos_individuais_centavos')::bigint ELSE NULL END;
 NEW.composicao_conferida_na_observacao:=coalesce(
  (v_fotografia->>'composicao_creditos_integra')::boolean,false)
  AND NEW.valor_creditos_observados_centavos=NEW.valor_centavos
  AND NEW.creditos_fingerprint_observado_sha256 IS NOT NULL;
 NEW.fotografia_observada_em:=pg_catalog.now();

 -- Mesmo quando um saque comum ja foi concluido, NAO descartar prova
 -- bancaria posterior. O conflito permanece registrado para apuracao;
 -- nunca marcar credito como pago por esta rotina.
 RETURN NEW;
END
$guard$;
COMMENT ON COLUMN public.catalogo_asaas_transferencias_excepcionais_auditoria.creditos_fingerprint_observado_sha256 IS
 'SHA-256 dos creditos quando uma transferencia e observada, nao prova de destinatario nem de pagamento.';
COMMIT;
