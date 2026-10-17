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


-- #41 + #42 + #43: porta de DIAGNOSTICO, nunca uma autorizacao.
-- Conecta as duas RPCs SOMENTE-LEITURA existentes ao journal de CI.
-- p_sinais_cliente simula JSON falsificado e e IGNORADO deliberadamente.
CREATE FUNCTION catalogo_ci_intencao_pix_inerte.diagnosticar_portas_hold(
 p_separacao uuid,p_sinais_cliente jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $diagnosticar$
DECLARE
 v_uid uuid;
 v_escrow public.catalogo_asaas_separacoes_excepcionais%ROWTYPE;
 v_matriz jsonb:='{}'::jsonb;
 v_revisores jsonb:='{}'::jsonb;
 v_contagem bigint:=0;
 v_marcos bigint:=0;
 v_banco_ok boolean:=false;
 v_revisoes_documentais boolean:=false;
 v_matriz_ok boolean:=false;
 v_revisores_ok boolean:=false;
BEGIN
 IF p_separacao IS NULL THEN
  RETURN jsonb_build_object('ok',false,'motivo','separacao_invalida',
   'status_operacional','HOLD_OBRIGATORIO','pode_enviar_post',false,
   'pode_reenviar_post',false,
   'evidencia_independente_bancaria_suficiente',false,
   'revisores_mfa_credenciados_confirmados',false,
   'dupla_aprovacao_financeira_confirmada',false,
   'transacao_de_baixa_habilitada',false,
   'pagamento_autorizado',false,
   'liberacao_autorizada',false,'baixa_realizada',false,'movimenta_dinheiro',false);
 END IF;
 SELECT motoboy_id INTO v_uid
 FROM public.catalogo_asaas_separacoes_excepcionais WHERE id=p_separacao;
 IF v_uid IS NULL THEN
  RETURN jsonb_build_object('ok',false,'motivo','separacao_ausente',
   'status_operacional','HOLD_OBRIGATORIO','pode_enviar_post',false,
   'pode_reenviar_post',false,
   'evidencia_independente_bancaria_suficiente',false,
   'revisores_mfa_credenciados_confirmados',false,
   'dupla_aprovacao_financeira_confirmada',false,
   'transacao_de_baixa_habilitada',false,
   'pagamento_autorizado',false,
   'liberacao_autorizada',false,'baixa_realizada',false,'movimenta_dinheiro',false);
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('asaas-saque:'||v_uid::text,0));
 SELECT * INTO v_escrow FROM public.catalogo_asaas_separacoes_excepcionais
 WHERE id=p_separacao FOR UPDATE;
 IF NOT FOUND OR v_escrow.motoboy_id IS DISTINCT FROM v_uid
 OR v_escrow.situacao IS DISTINCT FROM 'congelada' THEN
  RETURN jsonb_build_object('ok',false,'motivo','separacao_nao_congelada',
   'status_operacional','HOLD_OBRIGATORIO','pode_enviar_post',false,
   'pode_reenviar_post',false,
   'evidencia_independente_bancaria_suficiente',false,
   'revisores_mfa_credenciados_confirmados',false,
   'dupla_aprovacao_financeira_confirmada',false,
   'transacao_de_baixa_habilitada',false,
   'pagamento_autorizado',false,
   'liberacao_autorizada',false,'baixa_realizada',false,'movimenta_dinheiro',false);
 END IF;

 SELECT count(*)::bigint INTO v_contagem
 FROM catalogo_ci_intencao_pix_inerte.intencoes i
 WHERE i.separacao_id=p_separacao AND i.motoboy_id=v_escrow.motoboy_id
 AND i.valor_centavos=v_escrow.valor_centavos
 AND i.fingerprint_sha256=v_escrow.fingerprint_sha256
 AND i.referencia_externa=
  'guia-exc:'||v_escrow.tipo||':'||v_escrow.solicitacao_id::text;
 SELECT count(*)::bigint INTO v_marcos
 FROM catalogo_ci_intencao_pix_inerte.marcos_inicio m
 JOIN catalogo_ci_intencao_pix_inerte.intencoes i
 ON i.tentativa_id=m.tentativa_id
 WHERE i.separacao_id=p_separacao;

 -- Cada diagnostico pode falhar se nao houver evidencias locais; nesse
 -- caso o erro vira HOLD e nunca uma permissao implicita.
 BEGIN
  v_matriz:=public.catalogo_asaas_matriz_conciliacao_escrow(p_separacao);
  v_matriz_ok:=(v_matriz->>'ok'='true');
 EXCEPTION WHEN OTHERS THEN
  v_matriz_ok:=false;
  v_matriz:='{}'::jsonb;
 END;
 BEGIN
  v_revisores:=public.catalogo_asaas_diagnosticar_dupla_conferencia_inerte(
   p_separacao);
  v_revisores_ok:=(v_revisores->>'ok'='true');
 EXCEPTION WHEN OTHERS THEN
  v_revisores_ok:=false;
  v_revisores:='{}'::jsonb;
 END;

 v_banco_ok:=v_matriz_ok
  AND v_matriz->>'evidencia_suficiente_para_liquidar'='true'
  AND v_matriz->>'destino_pix_original_vinculado_com_prova'='true'
  AND v_matriz->>'destino_pix_confirmado_no_provedor'='true'
  AND v_matriz->>'ausencia_de_pix_anterior_comprovada'='true';
 v_revisoes_documentais:=v_revisores_ok
  AND v_revisores->>'duas_conferencias_documentais_registradas'='true';
 RETURN jsonb_build_object(
  'ok',true,
  'journal_intencoes_validas_no_ci',v_contagem,
  'journal_marcos_de_inicio_no_ci',v_marcos,
  'diagnostico_matriz_disponivel',v_matriz_ok,
  'diagnostico_pareceres_disponivel',v_revisores_ok,
  'duas_conferencias_documentais_observadas',v_revisoes_documentais,
  -- Conta auditorias do banco: nenhuma prova independente surge de GET.
  'evidencia_independente_bancaria_suficiente',v_banco_ok,
  'revisores_mfa_credenciados_confirmados',false,
  'dupla_aprovacao_financeira_confirmada',false,
  'transacao_de_baixa_habilitada',false,
  'status_operacional','HOLD_OBRIGATORIO',
  'pode_enviar_post',false,'pode_reenviar_post',false,
  'pagamento_autorizado',false,'liberacao_autorizada',false,
  'baixa_realizada',false,'movimenta_dinheiro',false
 );
END
$diagnosticar$;

REVOKE ALL ON FUNCTION
 catalogo_ci_intencao_pix_inerte.diagnosticar_portas_hold(uuid,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
-- Esta funcao nao toma qualquer decisao, nao consome sinais do cliente e
-- nunca retorna dados pessoais nem credenciais bancarias.
