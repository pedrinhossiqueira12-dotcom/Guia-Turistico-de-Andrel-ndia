-- Etapa #41: prova local prospectiva e IMUTAVEL do destino escolhido para
-- saques regulares. O HMAC ja e calculado no backend ANTES do POST Asaas.
-- Esta trava nao e prova de titularidade, de liquidacao, nem atesta pagamentos
-- excepcionais ou legados. Nenhuma migracao move dinheiro ou libera escrow.
BEGIN;

ALTER TABLE public.catalogo_asaas_saques
 ADD COLUMN IF NOT EXISTS pix_destino_registrado_em timestamptz;

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_asaas_guardar_compromisso_pix_original()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $guard$
BEGIN
 IF TG_OP='INSERT' THEN
  -- Não aceitar "prova" inserida retroativamente no mesmo INSERT do saque.
  IF NEW.pix_destino_sha256 IS NOT NULL
   OR NEW.pix_destino_registrado_em IS NOT NULL
   OR NEW.status IS DISTINCT FROM 'reservado'
   OR NEW.transferencia_id IS NOT NULL THEN
   RAISE EXCEPTION 'Compromisso Pix deve ser registrado apos criar reserva, antes da transferencia'
    USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;

 -- A reserva recém-criada jamais pode associar uma transferência ou
 -- passar a ENVIADO antes de ter um HMAC local com hora fixada. Este bloqueio
 -- não equivale a confirmação do provedor, e os registros anteriores à migração
 -- continuam como legados sem alegação de prova independente.
 IF OLD.status='reservado' AND OLD.transferencia_id IS NULL
  AND (NEW.transferencia_id IS NOT NULL
       OR NEW.status IN ('enviado','concluido'))
  AND (OLD.pix_destino_sha256 IS NULL OR OLD.pix_destino_registrado_em IS NULL) THEN
  RAISE EXCEPTION 'Saque sem HMAC original imutavel nao pode ser enviado nem vinculado ao banco'
   USING ERRCODE='23514';
 END IF;

 -- Nunca permitir que o cliente/admin invente ou mude a hora da prova.
 IF NEW.pix_destino_sha256 IS DISTINCT FROM OLD.pix_destino_sha256 THEN
  IF OLD.pix_destino_sha256 IS NOT NULL OR OLD.pix_destino_registrado_em IS NOT NULL
   OR NEW.pix_destino_sha256 IS NULL
   OR NEW.pix_destino_sha256 !~ '^[a-f0-9]{64}$'
   OR OLD.status IS DISTINCT FROM 'reservado'
   OR NEW.status IS DISTINCT FROM 'reservado'
   OR OLD.transferencia_id IS NOT NULL OR NEW.transferencia_id IS NOT NULL
   OR OLD.concluido_em IS NOT NULL OR NEW.concluido_em IS NOT NULL
   OR NEW.id IS DISTINCT FROM OLD.id
   OR NEW.motoboy_id IS DISTINCT FROM OLD.motoboy_id
   OR NEW.valor_centavos IS DISTINCT FROM OLD.valor_centavos THEN
   RAISE EXCEPTION 'Compromisso Pix so pode ser fixado uma vez com reserva ainda nao enviada'
    USING ERRCODE='23514';
  END IF;
  NEW.pix_destino_registrado_em:=pg_catalog.clock_timestamp();
 ELSIF NEW.pix_destino_registrado_em IS DISTINCT FROM OLD.pix_destino_registrado_em THEN
  RAISE EXCEPTION 'Timestamp do compromisso Pix e imutavel'
   USING ERRCODE='23514';
 END IF;

 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_guardar_compromisso_pix_original()
 FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS catalogo_asaas_guard_compromisso_pix_original
 ON public.catalogo_asaas_saques;
CREATE TRIGGER catalogo_asaas_guard_compromisso_pix_original
 BEFORE INSERT OR UPDATE ON public.catalogo_asaas_saques
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_guardar_compromisso_pix_original();

-- Expor apenas atributos de auditoria, exclusivamente service_role.
-- Recusa inferir que uma foto antiga (sem carimbo confiavel local) ocorreu
-- antes do Pix. Este relatorio NUNCA e criterio de baixa/repasse.
CREATE OR REPLACE FUNCTION public.catalogo_asaas_diagnosticar_compromisso_pix_saque(
 p_saque uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $read$
DECLARE
 v_s public.catalogo_asaas_saques%ROWTYPE;
BEGIN
 SELECT * INTO v_s FROM public.catalogo_asaas_saques WHERE id=p_saque;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Saque nao localizado.');
 END IF;
 RETURN jsonb_build_object(
  'ok',true,'saque_id',v_s.id,
  'compromisso_hmac_presente',v_s.pix_destino_sha256 IS NOT NULL,
  'compromisso_com_carimbo_prospectivo',
   v_s.pix_destino_sha256 IS NOT NULL AND
   v_s.pix_destino_registrado_em IS NOT NULL,
  'registro_local_sem_transferencia_associada_agora',
   v_s.pix_destino_sha256 IS NOT NULL AND
   v_s.pix_destino_registrado_em IS NOT NULL AND
   v_s.transferencia_id IS NULL,
  'prova_bancaria_independente',false,
  'titularidade_original_comprovada',false,
  'confirmacao_de_liquidacao',false,
  'pagamento_autorizado',false,
  'baixa_autorizada',false,
  'creditos_liberados',false,
  'aviso','HMAC protege destino cadastrado para saque regular futuro; nao prova identidade nem Pix recebido.'
 );
END $read$;
REVOKE ALL ON FUNCTION public.catalogo_asaas_diagnosticar_compromisso_pix_saque(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_diagnosticar_compromisso_pix_saque(uuid)
 TO service_role;
COMMENT ON COLUMN public.catalogo_asaas_saques.pix_destino_registrado_em IS
 'Carimbo local do primeiro HMAC criado ANTES do POST Asaas. Nao e atestado do provedor.';
COMMENT ON FUNCTION public.catalogo_asaas_diagnosticar_compromisso_pix_saque(uuid) IS
 'Leitura local prospectiva de compromisso de destino; nenhuma liquidacao, titularidade ou prova externa.';
COMMIT;
