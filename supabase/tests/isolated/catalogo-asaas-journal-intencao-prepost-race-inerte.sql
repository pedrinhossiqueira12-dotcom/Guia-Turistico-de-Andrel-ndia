-- #43: prova de JOURNAL DURAVEL DE INTENCAO PRE-ENVIO no CLONE DESCARTAVEL.
-- NAO importar para migrations, producao, staging, Edge ou gateway.
-- A simulacao registra um marco LOCAL antes de um POST FICTICIO; ZERO POST.
DO $guard$
BEGIN
 IF pg_catalog.current_database()<>'catalogo_asaas_race_ci'
 OR pg_catalog.current_setting('app.catalogo_ci_intencao_test',true)<>'enabled'
 THEN RAISE EXCEPTION 'Journal CI apenas em DB descartavel'
  USING ERRCODE='23514';
 END IF;
END $guard$;

CREATE SCHEMA catalogo_ci_intencao_pix_inerte;
REVOKE ALL ON SCHEMA catalogo_ci_intencao_pix_inerte
 FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE catalogo_ci_intencao_pix_inerte.intencoes (
 tentativa_id uuid PRIMARY KEY,
 separacao_id uuid NOT NULL UNIQUE REFERENCES
  public.catalogo_asaas_separacoes_excepcionais(id) ON DELETE RESTRICT,
 motoboy_id uuid NOT NULL,
 referencia_externa text NOT NULL,
 valor_centavos bigint NOT NULL CHECK(valor_centavos>0),
 fingerprint_sha256 text NOT NULL CHECK(fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
 criada_em timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
CREATE TABLE catalogo_ci_intencao_pix_inerte.marcos_inicio (
 tentativa_id uuid PRIMARY KEY REFERENCES
  catalogo_ci_intencao_pix_inerte.intencoes(tentativa_id) ON DELETE RESTRICT,
 marco_id uuid NOT NULL UNIQUE,
 marcado_em timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
ALTER TABLE catalogo_ci_intencao_pix_inerte.intencoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogo_ci_intencao_pix_inerte.marcos_inicio ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON catalogo_ci_intencao_pix_inerte.intencoes
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON catalogo_ci_intencao_pix_inerte.marcos_inicio
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION catalogo_ci_intencao_pix_inerte.rejeitar_mutacao()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $immutable$
BEGIN
 RAISE EXCEPTION 'Journal de CI e append-only' USING ERRCODE='23514';
END
$immutable$;
CREATE TRIGGER impedir_edicao_intencao BEFORE UPDATE OR DELETE
 ON catalogo_ci_intencao_pix_inerte.intencoes
 FOR EACH ROW EXECUTE FUNCTION catalogo_ci_intencao_pix_inerte.rejeitar_mutacao();
CREATE TRIGGER impedir_edicao_marco BEFORE UPDATE OR DELETE
 ON catalogo_ci_intencao_pix_inerte.marcos_inicio
 FOR EACH ROW EXECUTE FUNCTION catalogo_ci_intencao_pix_inerte.rejeitar_mutacao();

CREATE FUNCTION catalogo_ci_intencao_pix_inerte.preparar(
 p_separacao uuid,p_tentativa uuid,p_ref text,
 p_valor bigint,p_hash text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $prepare$
DECLARE
 v_owner uuid;
 v_escrow public.catalogo_asaas_separacoes_excepcionais%ROWTYPE;
 v_anterior catalogo_ci_intencao_pix_inerte.intencoes%ROWTYPE;
 v_ok boolean:=false;
 v_replay boolean:=false;
 v_motivo text:='intencao_invalida';
BEGIN
 IF p_separacao IS NULL OR p_tentativa IS NULL OR p_ref IS NULL
 OR p_valor IS NULL OR p_valor<=0 OR p_hash IS NULL
 OR p_hash !~ '^[a-f0-9]{64}$'
 THEN
  RETURN jsonb_build_object('ok',false,'motivo',v_motivo,
   'status_operacional','HOLD_OBRIGATORIO','pode_enviar_post',false,
   'pode_reenviar_post',false,'pagamento_autorizado',false,
   'liberacao_autorizada',false,'baixa_realizada',false,'movimenta_dinheiro',false);
 END IF;
 SELECT motoboy_id INTO v_owner
 FROM public.catalogo_asaas_separacoes_excepcionais
 WHERE id=p_separacao;
 IF v_owner IS NULL THEN
  RETURN jsonb_build_object('ok',false,'motivo','reserva_ausente',
   'status_operacional','HOLD_OBRIGATORIO','pode_enviar_post',false,
   'pode_reenviar_post',false,'pagamento_autorizado',false,
   'liberacao_autorizada',false,'baixa_realizada',false,'movimenta_dinheiro',false);
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('asaas-saque:'||v_owner::text,0));
 SELECT * INTO v_escrow FROM public.catalogo_asaas_separacoes_excepcionais
 WHERE id=p_separacao FOR UPDATE;
 IF NOT FOUND OR v_escrow.situacao IS DISTINCT FROM 'congelada'
 OR v_escrow.motoboy_id IS DISTINCT FROM v_owner
 OR v_escrow.valor_centavos IS DISTINCT FROM p_valor
 OR v_escrow.fingerprint_sha256 IS DISTINCT FROM p_hash
 OR p_ref IS DISTINCT FROM
  ('guia-exc:'||v_escrow.tipo||':'||v_escrow.solicitacao_id::text)
 THEN
  RETURN jsonb_build_object('ok',false,'motivo','reserva_ou_versao_divergente',
   'status_operacional','HOLD_OBRIGATORIO','pode_enviar_post',false,
   'pode_reenviar_post',false,'pagamento_autorizado',false,
   'liberacao_autorizada',false,'baixa_realizada',false,'movimenta_dinheiro',false);
 END IF;
 SELECT * INTO v_anterior FROM catalogo_ci_intencao_pix_inerte.intencoes
 WHERE tentativa_id=p_tentativa OR separacao_id=p_separacao;
 IF FOUND THEN
  v_ok:=v_anterior.tentativa_id=p_tentativa
   AND v_anterior.separacao_id=p_separacao
   AND v_anterior.motoboy_id=v_owner
   AND v_anterior.referencia_externa=p_ref
   AND v_anterior.valor_centavos=p_valor
   AND v_anterior.fingerprint_sha256=p_hash;
  v_replay:=v_ok;
  v_motivo:=CASE WHEN v_ok THEN 'replay_de_intencao_sem_envio'
   ELSE 'id_ou_separacao_ja_utilizado' END;
 ELSE
  INSERT INTO catalogo_ci_intencao_pix_inerte.intencoes(
   tentativa_id,separacao_id,motoboy_id,referencia_externa,
   valor_centavos,fingerprint_sha256
  ) VALUES(p_tentativa,p_separacao,v_owner,p_ref,p_valor,p_hash);
  v_ok:=true;
  v_motivo:='intencao_documental_registrada';
 END IF;
 RETURN jsonb_build_object('ok',v_ok,'replay',v_replay,'motivo',v_motivo,
  'status_operacional','HOLD_OBRIGATORIO',
  'pode_enviar_post',false,'pode_reenviar_post',false,
  'pagamento_autorizado',false,'liberacao_autorizada',false,
  'baixa_realizada',false,'movimenta_dinheiro',false);
END
$prepare$;

CREATE FUNCTION catalogo_ci_intencao_pix_inerte.marcar_inicio(
 p_tentativa uuid,p_marco uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $mark$
DECLARE
 v_intencao catalogo_ci_intencao_pix_inerte.intencoes%ROWTYPE;
 v_escrow public.catalogo_asaas_separacoes_excepcionais%ROWTYPE;
 v_mark catalogo_ci_intencao_pix_inerte.marcos_inicio%ROWTYPE;
 v_motivo text:='intencao_ausente';
BEGIN
 IF p_tentativa IS NULL OR p_marco IS NULL THEN
  RETURN jsonb_build_object('ok',false,'motivo','ids_invalidos',
   'status_operacional','HOLD_OBRIGATORIO','pode_enviar_post',false,
   'pode_reenviar_post',false,'pagamento_autorizado',false,
   'liberacao_autorizada',false,'baixa_realizada',false,'movimenta_dinheiro',false);
 END IF;
 SELECT * INTO v_intencao FROM catalogo_ci_intencao_pix_inerte.intencoes
 WHERE tentativa_id=p_tentativa;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('ok',false,'motivo',v_motivo,
   'status_operacional','HOLD_OBRIGATORIO','pode_enviar_post',false,
   'pode_reenviar_post',false,'pagamento_autorizado',false,
   'liberacao_autorizada',false,'baixa_realizada',false,'movimenta_dinheiro',false);
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('asaas-saque:'||v_intencao.motoboy_id::text,0));
 SELECT * INTO v_escrow FROM public.catalogo_asaas_separacoes_excepcionais
 WHERE id=v_intencao.separacao_id FOR UPDATE;
 IF NOT FOUND OR v_escrow.situacao IS DISTINCT FROM 'congelada'
 OR v_escrow.motoboy_id IS DISTINCT FROM v_intencao.motoboy_id
 OR v_escrow.valor_centavos IS DISTINCT FROM v_intencao.valor_centavos
 OR v_escrow.fingerprint_sha256 IS DISTINCT FROM v_intencao.fingerprint_sha256
 THEN
  RETURN jsonb_build_object('ok',false,'motivo','reserva_alterada',
   'status_operacional','HOLD_OBRIGATORIO','pode_enviar_post',false,
   'pode_reenviar_post',false,'pagamento_autorizado',false,
   'liberacao_autorizada',false,'baixa_realizada',false,'movimenta_dinheiro',false);
 END IF;
 SELECT * INTO v_mark FROM catalogo_ci_intencao_pix_inerte.marcos_inicio
 WHERE tentativa_id=p_tentativa;
 IF FOUND THEN
  v_motivo:=CASE WHEN v_mark.marco_id=p_marco
   THEN 'marco_ja_existente_sem_novo_envio'
   ELSE 'tentativa_ja_tem_marco_diferente' END;
  RETURN jsonb_build_object('ok',false,'motivo',v_motivo,
   'status_operacional','HOLD_OBRIGATORIO','pode_enviar_post',false,
   'pode_reenviar_post',false,'pagamento_autorizado',false,
   'liberacao_autorizada',false,'baixa_realizada',false,'movimenta_dinheiro',false);
 END IF;
 INSERT INTO catalogo_ci_intencao_pix_inerte.marcos_inicio(
  tentativa_id,marco_id) VALUES(p_tentativa,p_marco);
 RETURN jsonb_build_object('ok',true,'motivo','inicio_documental_gravado',
  'status_operacional','HOLD_OBRIGATORIO',
  'pode_enviar_post',false,'pode_reenviar_post',false,
  'pagamento_autorizado',false,'liberacao_autorizada',false,
  'baixa_realizada',false,'movimenta_dinheiro',false);
END
$mark$;
REVOKE ALL ON FUNCTION
 catalogo_ci_intencao_pix_inerte.preparar(uuid,uuid,text,bigint,text)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION
 catalogo_ci_intencao_pix_inerte.marcar_inicio(uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION
 catalogo_ci_intencao_pix_inerte.rejeitar_mutacao()
 FROM PUBLIC,anon,authenticated,service_role;
-- Marco de envio nao e POST, e nao e evidencia de liquidacao.
