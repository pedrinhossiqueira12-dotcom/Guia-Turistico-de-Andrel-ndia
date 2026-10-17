-- #42: livro transacional de DESAFIOS DOCUMENTAIS apenas em clone PostgreSQL CI.
-- Nao valida GoTrue/JWT/OTP verdadeiro; dados MFA sao MOCK e NUNCA autorizam Pix.
-- Nao aplicar como migration em PROD/STAGING nem criar Edge/RPC real.
DO $guard$
BEGIN
 IF pg_catalog.current_database() IS DISTINCT FROM 'catalogo_asaas_race_ci'
 OR pg_catalog.current_setting('app.catalogo_ci_vinculo_test',true)
    IS DISTINCT FROM 'enabled'
 OR session_user IS DISTINCT FROM 'postgres'
 THEN RAISE EXCEPTION 'Vinculo persistente simulado somente em CI descartavel'
  USING ERRCODE='23514';
 END IF;
END $guard$;

CREATE SCHEMA catalogo_ci_vinculo_mfa_inerte;
REVOKE ALL ON SCHEMA catalogo_ci_vinculo_mfa_inerte
 FROM PUBLIC,anon,authenticated,service_role;

-- A versao do dossie vem de uma TABELA CONTROLADA PELA CI, NAO do cliente.
-- Apenas o teste a muda para simular um novo dossie.
CREATE TABLE catalogo_ci_vinculo_mfa_inerte.dossies_ci (
 separacao_id uuid PRIMARY KEY REFERENCES
  public.catalogo_asaas_separacoes_excepcionais(id) ON DELETE RESTRICT,
 versao bigint NOT NULL CHECK(versao>0),
 hash_sha256 text NOT NULL CHECK(hash_sha256 ~ '^[a-f0-9]{64}$')
);
CREATE TABLE catalogo_ci_vinculo_mfa_inerte.intencoes_ci (
 id uuid PRIMARY KEY,
 separacao_id uuid NOT NULL REFERENCES
  catalogo_ci_vinculo_mfa_inerte.dossies_ci(separacao_id) ON DELETE RESTRICT,
 revisor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 sessao_id uuid NOT NULL,
 fator_id uuid NOT NULL,
 fingerprint_creditos_sha256 text NOT NULL CHECK(fingerprint_creditos_sha256 ~ '^[a-f0-9]{64}$'),
 dossie_versao bigint NOT NULL CHECK(dossie_versao>0),
 dossie_hash_sha256 text NOT NULL CHECK(dossie_hash_sha256 ~ '^[a-f0-9]{64}$'),
 criada_em timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 UNIQUE(separacao_id,revisor_id),
 UNIQUE(id,revisor_id,sessao_id,fator_id),
 FOREIGN KEY(sessao_id,revisor_id)
  REFERENCES catalogo_ci_revisores_inertes.sessoes_mock_ci(sessao_id,revisor_id)
  ON DELETE RESTRICT
);
CREATE TABLE catalogo_ci_vinculo_mfa_inerte.observacoes_ci (
 intencao_id uuid PRIMARY KEY,
 revisor_id uuid NOT NULL,
 sessao_id uuid NOT NULL,
 fator_id uuid NOT NULL,
 challenge_id uuid NOT NULL UNIQUE,
 observada_em timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 CHECK(challenge_id<>'00000000-0000-0000-0000-000000000000'::uuid),
 FOREIGN KEY(intencao_id,revisor_id,sessao_id,fator_id)
 REFERENCES catalogo_ci_vinculo_mfa_inerte.intencoes_ci(id,revisor_id,sessao_id,fator_id)
 ON DELETE RESTRICT
);
ALTER TABLE catalogo_ci_vinculo_mfa_inerte.dossies_ci ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogo_ci_vinculo_mfa_inerte.intencoes_ci ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogo_ci_vinculo_mfa_inerte.observacoes_ci ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA catalogo_ci_vinculo_mfa_inerte
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION catalogo_ci_vinculo_mfa_inerte.rejeitar_alteracao_ci()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $reject$
BEGIN
 RAISE EXCEPTION 'Registro de vinculo MFA CI e append-only'
  USING ERRCODE='23514';
END
$reject$;
CREATE TRIGGER intencao_ci_imutavel BEFORE UPDATE OR DELETE
 ON catalogo_ci_vinculo_mfa_inerte.intencoes_ci
 FOR EACH ROW EXECUTE FUNCTION catalogo_ci_vinculo_mfa_inerte.rejeitar_alteracao_ci();
CREATE TRIGGER observacao_ci_imutavel BEFORE UPDATE OR DELETE
 ON catalogo_ci_vinculo_mfa_inerte.observacoes_ci
 FOR EACH ROW EXECUTE FUNCTION catalogo_ci_vinculo_mfa_inerte.rejeitar_alteracao_ci();

-- Registro ANTES do challenge ficticio. Uma tentativa por revisor e escrow.
CREATE FUNCTION catalogo_ci_vinculo_mfa_inerte.reservar_ci(
 p_separacao uuid,p_revisor uuid,p_sessao uuid,p_fator uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $reserve$
DECLARE
 v_owner uuid;
 v_escrow public.catalogo_asaas_separacoes_excepcionais%ROWTYPE;
 v_doc catalogo_ci_vinculo_mfa_inerte.dossies_ci%ROWTYPE;
 v_cred catalogo_ci_revisores_inertes.credenciais_ci%ROWTYPE;
 v_sess catalogo_ci_revisores_inertes.sessoes_mock_ci%ROWTYPE;
 v_nonce uuid;
 v_motivo text:='identidade_ou_papel_recusados';
BEGIN
 IF p_separacao IS NULL OR p_revisor IS NULL OR p_sessao IS NULL OR p_fator IS NULL
 THEN RETURN jsonb_build_object('ok',false,'motivo','ids_invalidos',
   'status_operacional','HOLD_OBRIGATORIO','mfa_real_validado',false,
   'pode_pagar',false,'pode_liberar',false,'movimenta_dinheiro',false); END IF;
 SELECT motoboy_id INTO v_owner
 FROM public.catalogo_asaas_separacoes_excepcionais WHERE id=p_separacao;
 IF v_owner IS NULL THEN
  RETURN jsonb_build_object('ok',false,'motivo','reserva_inexistente',
    'status_operacional','HOLD_OBRIGATORIO','mfa_real_validado',false,
    'pode_pagar',false,'pode_liberar',false,'movimenta_dinheiro',false);
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('asaas-saque:'||v_owner::text,0));
 SELECT * INTO v_escrow FROM public.catalogo_asaas_separacoes_excepcionais
 WHERE id=p_separacao FOR UPDATE;
 SELECT * INTO v_doc FROM catalogo_ci_vinculo_mfa_inerte.dossies_ci
 WHERE separacao_id=p_separacao FOR SHARE;
 SELECT * INTO v_cred FROM catalogo_ci_revisores_inertes.credenciais_ci
 WHERE revisor_id=p_revisor FOR SHARE;
 SELECT * INTO v_sess FROM catalogo_ci_revisores_inertes.sessoes_mock_ci
 WHERE sessao_id=p_sessao AND revisor_id=p_revisor FOR SHARE;
 IF v_escrow.id IS NULL OR v_escrow.situacao IS DISTINCT FROM 'congelada'
 OR v_doc.separacao_id IS NULL OR v_cred.revisor_id IS NULL
 OR v_sess.sessao_id IS NULL OR p_revisor=v_owner
 OR v_cred.papel IS DISTINCT FROM 'revisor_escrow'
 OR v_cred.situacao IS DISTINCT FROM 'habilitado'
 OR v_cred.valido_ate<=pg_catalog.clock_timestamp()
 OR v_sess.fator_id IS DISTINCT FROM p_fator
 OR v_sess.aal_mock IS DISTINCT FROM 'aal2'
 OR v_sess.fator_estado_mock IS DISTINCT FROM 'verified'
 OR v_sess.expira_em<=pg_catalog.clock_timestamp()
 OR v_sess.revogada_em IS NOT NULL
 OR v_sess.ultimo_desafio_mock_em IS NULL
 OR v_sess.ultimo_desafio_mock_em<=pg_catalog.clock_timestamp()-interval '5 minutes'
 OR v_sess.ultimo_desafio_mock_em>pg_catalog.clock_timestamp()
 OR EXISTS(SELECT 1 FROM public.catalogo_asaas_escrow_dossie_eventos d
   WHERE d.separacao_id=p_separacao AND d.autor_id=p_revisor)
 THEN
  RETURN jsonb_build_object('ok',false,'motivo',v_motivo,
   'status_operacional','HOLD_OBRIGATORIO','mfa_real_validado',false,
   'pode_pagar',false,'pode_liberar',false,'movimenta_dinheiro',false);
 END IF;
 IF EXISTS(SELECT 1 FROM catalogo_ci_vinculo_mfa_inerte.intencoes_ci
  WHERE separacao_id=p_separacao AND revisor_id=p_revisor) THEN
  RETURN jsonb_build_object('ok',false,'motivo','vinculo_ja_reservado',
   'status_operacional','HOLD_OBRIGATORIO','mfa_real_validado',false,
   'pode_pagar',false,'pode_liberar',false,'movimenta_dinheiro',false);
 END IF;
 v_nonce:=pg_catalog.gen_random_uuid();
 INSERT INTO catalogo_ci_vinculo_mfa_inerte.intencoes_ci(
 id,separacao_id,revisor_id,sessao_id,fator_id,
 fingerprint_creditos_sha256,dossie_versao,dossie_hash_sha256
 ) VALUES(v_nonce,p_separacao,p_revisor,p_sessao,p_fator,
  v_escrow.fingerprint_sha256,v_doc.versao,v_doc.hash_sha256);
 RETURN jsonb_build_object('ok',true,'motivo','vinculo_ci_reservado',
  'nonce_ci',v_nonce,'status_operacional','HOLD_OBRIGATORIO',
  'mfa_real_validado',false,'pode_pagar',false,'pode_liberar',false,
  'movimenta_dinheiro',false);
END
$reserve$;

-- O recebimento de challenge_id e registro documental; NAO valida TOTP!
CREATE FUNCTION catalogo_ci_vinculo_mfa_inerte.observar_ci(
 p_nonce uuid,p_revisor uuid,p_sessao uuid,p_fator uuid,p_challenge uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $observe$
DECLARE
 v_binding catalogo_ci_vinculo_mfa_inerte.intencoes_ci%ROWTYPE;
 v_owner uuid;
 v_escrow public.catalogo_asaas_separacoes_excepcionais%ROWTYPE;
 v_doc catalogo_ci_vinculo_mfa_inerte.dossies_ci%ROWTYPE;
 v_cred catalogo_ci_revisores_inertes.credenciais_ci%ROWTYPE;
 v_sess catalogo_ci_revisores_inertes.sessoes_mock_ci%ROWTYPE;
 v_motivo text:='nonce_ou_identidade_divergente';
BEGIN
 IF p_nonce IS NULL OR p_revisor IS NULL OR p_sessao IS NULL
  OR p_fator IS NULL OR p_challenge IS NULL THEN
  RETURN jsonb_build_object('ok',false,'motivo','ids_invalidos',
  'status_operacional','HOLD_OBRIGATORIO','mfa_real_validado',false,
  'pode_pagar',false,'pode_liberar',false,'movimenta_dinheiro',false);
 END IF;
 SELECT * INTO v_binding FROM catalogo_ci_vinculo_mfa_inerte.intencoes_ci
 WHERE id=p_nonce;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('ok',false,'motivo','nonce_desconhecido',
   'status_operacional','HOLD_OBRIGATORIO','mfa_real_validado',false,
   'pode_pagar',false,'pode_liberar',false,'movimenta_dinheiro',false);
 END IF;
 SELECT motoboy_id INTO v_owner
 FROM public.catalogo_asaas_separacoes_excepcionais WHERE id=v_binding.separacao_id;
 IF v_owner IS NULL THEN
  RETURN jsonb_build_object('ok',false,'motivo','reserva_ausente',
   'status_operacional','HOLD_OBRIGATORIO','mfa_real_validado',false,
   'pode_pagar',false,'pode_liberar',false,'movimenta_dinheiro',false);
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('asaas-saque:'||v_owner::text,0));
 SELECT * INTO v_binding FROM catalogo_ci_vinculo_mfa_inerte.intencoes_ci
 WHERE id=p_nonce FOR SHARE;
 SELECT * INTO v_escrow FROM public.catalogo_asaas_separacoes_excepcionais
 WHERE id=v_binding.separacao_id FOR UPDATE;
 SELECT * INTO v_doc FROM catalogo_ci_vinculo_mfa_inerte.dossies_ci
 WHERE separacao_id=v_binding.separacao_id FOR SHARE;
 SELECT * INTO v_cred FROM catalogo_ci_revisores_inertes.credenciais_ci
 WHERE revisor_id=p_revisor FOR SHARE;
 SELECT * INTO v_sess FROM catalogo_ci_revisores_inertes.sessoes_mock_ci
 WHERE sessao_id=p_sessao AND revisor_id=p_revisor FOR SHARE;
 IF v_binding.revisor_id IS DISTINCT FROM p_revisor
 OR v_binding.sessao_id IS DISTINCT FROM p_sessao
 OR v_binding.fator_id IS DISTINCT FROM p_fator
 OR v_doc.hash_sha256 IS DISTINCT FROM v_binding.dossie_hash_sha256
 OR v_doc.versao IS DISTINCT FROM v_binding.dossie_versao
 OR v_escrow.situacao IS DISTINCT FROM 'congelada'
 OR v_escrow.fingerprint_sha256 IS DISTINCT FROM v_binding.fingerprint_creditos_sha256
 OR v_cred.papel IS DISTINCT FROM 'revisor_escrow'
 OR v_cred.situacao IS DISTINCT FROM 'habilitado'
 OR v_cred.valido_ate<=pg_catalog.clock_timestamp()
 OR v_sess.fator_id IS DISTINCT FROM p_fator
 OR v_sess.aal_mock IS DISTINCT FROM 'aal2'
 OR v_sess.fator_estado_mock IS DISTINCT FROM 'verified'
 OR v_sess.expira_em<=pg_catalog.clock_timestamp()
 OR v_sess.revogada_em IS NOT NULL
 OR v_sess.ultimo_desafio_mock_em IS NULL
 OR v_sess.ultimo_desafio_mock_em<=pg_catalog.clock_timestamp()-interval '5 minutes'
 OR v_sess.ultimo_desafio_mock_em>pg_catalog.clock_timestamp()
 OR v_binding.criada_em<=pg_catalog.clock_timestamp()-interval '2 minutes'
 OR EXISTS(SELECT 1 FROM public.catalogo_asaas_escrow_dossie_eventos d
    WHERE d.separacao_id=v_binding.separacao_id AND d.autor_id=p_revisor)
 THEN
  RETURN jsonb_build_object('ok',false,'motivo',v_motivo,
   'status_operacional','HOLD_OBRIGATORIO','mfa_real_validado',false,
   'pode_pagar',false,'pode_liberar',false,'movimenta_dinheiro',false);
 END IF;
 IF EXISTS(SELECT 1 FROM catalogo_ci_vinculo_mfa_inerte.observacoes_ci
  WHERE intencao_id=p_nonce OR challenge_id=p_challenge) THEN
  RETURN jsonb_build_object('ok',false,'motivo','replay_ou_challenge_usado',
   'status_operacional','HOLD_OBRIGATORIO','mfa_real_validado',false,
   'pode_pagar',false,'pode_liberar',false,'movimenta_dinheiro',false);
 END IF;
 INSERT INTO catalogo_ci_vinculo_mfa_inerte.observacoes_ci(
  intencao_id,revisor_id,sessao_id,fator_id,challenge_id
 ) VALUES(p_nonce,p_revisor,p_sessao,p_fator,p_challenge);
 RETURN jsonb_build_object('ok',true,'motivo','challenge_local_documentado_sem_prova_mfa',
  'status_operacional','HOLD_OBRIGATORIO','mfa_real_validado',false,
  'pode_pagar',false,'pode_liberar',false,'movimenta_dinheiro',false);
END
$observe$;

CREATE FUNCTION catalogo_ci_vinculo_mfa_inerte.diagnosticar_ci(
 p_separacao uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $diagnose$
DECLARE
 v_owner uuid;
 v_escrow public.catalogo_asaas_separacoes_excepcionais%ROWTYPE;
 v_doc catalogo_ci_vinculo_mfa_inerte.dossies_ci%ROWTYPE;
 v_total bigint:=0;
 v_validos bigint:=0;
BEGIN
 SELECT motoboy_id INTO v_owner
 FROM public.catalogo_asaas_separacoes_excepcionais WHERE id=p_separacao;
 IF v_owner IS NOT NULL THEN
  PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('asaas-saque:'||v_owner::text,0));
  SELECT * INTO v_escrow FROM public.catalogo_asaas_separacoes_excepcionais
  WHERE id=p_separacao FOR UPDATE;
  SELECT * INTO v_doc FROM catalogo_ci_vinculo_mfa_inerte.dossies_ci
  WHERE separacao_id=p_separacao FOR SHARE;
  WITH registrados AS MATERIALIZED (
   SELECT i.id,i.revisor_id,i.criada_em,
    i.fingerprint_creditos_sha256,i.dossie_versao,i.dossie_hash_sha256,
    c.papel,c.situacao,c.valido_ate,s.aal_mock,s.fator_estado_mock,
    s.expira_em AS sessao_expira,s.revogada_em,s.ultimo_desafio_mock_em,
    o.intencao_id
   FROM catalogo_ci_vinculo_mfa_inerte.intencoes_ci i
   JOIN catalogo_ci_vinculo_mfa_inerte.observacoes_ci o ON o.intencao_id=i.id
   JOIN catalogo_ci_revisores_inertes.credenciais_ci c ON c.revisor_id=i.revisor_id
   JOIN catalogo_ci_revisores_inertes.sessoes_mock_ci s
    ON s.sessao_id=i.sessao_id AND s.revisor_id=i.revisor_id
    AND s.fator_id=i.fator_id
   WHERE i.separacao_id=p_separacao
   ORDER BY i.revisor_id
   FOR SHARE OF i,o,c,s
  )
  SELECT count(*)::bigint,count(DISTINCT revisor_id) FILTER(WHERE
   v_escrow.situacao='congelada'
   AND revisor_id IS DISTINCT FROM v_owner
   AND fingerprint_creditos_sha256=v_escrow.fingerprint_sha256
   AND dossie_versao=v_doc.versao AND dossie_hash_sha256=v_doc.hash_sha256
   AND papel='revisor_escrow' AND situacao='habilitado'
   AND valido_ate>pg_catalog.clock_timestamp()
   AND aal_mock='aal2' AND fator_estado_mock='verified'
   AND sessao_expira>pg_catalog.clock_timestamp() AND revogada_em IS NULL
   AND ultimo_desafio_mock_em>pg_catalog.clock_timestamp()-interval '5 minutes'
   AND ultimo_desafio_mock_em<=pg_catalog.clock_timestamp()
   AND NOT EXISTS(SELECT 1 FROM public.catalogo_asaas_escrow_dossie_eventos d
    WHERE d.separacao_id=p_separacao AND d.autor_id=revisor_id)
  )::bigint
  INTO v_total,v_validos FROM registrados;
 END IF;
 RETURN jsonb_build_object(
  'observacoes_documentais_mock_total',v_total,
  'revisores_documentais_mock_distintos_vigentes',v_validos,
  'duas_observacoes_mock_de_mesma_versao',v_validos>=2,
  'credenciamento_formal_confirmado',false,
  'mfa_real_validado',false,'dupla_aprovacao_financeira',false,
  'status_operacional','HOLD_OBRIGATORIO',
  'pode_pagar',false,'pode_liberar',false,
  'baixa_realizada',false,'movimenta_dinheiro',false);
END
$diagnose$;

REVOKE ALL ON FUNCTION
 catalogo_ci_vinculo_mfa_inerte.reservar_ci(uuid,uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION
 catalogo_ci_vinculo_mfa_inerte.observar_ci(uuid,uuid,uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION catalogo_ci_vinculo_mfa_inerte.diagnosticar_ci(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION catalogo_ci_vinculo_mfa_inerte.rejeitar_alteracao_ci()
 FROM PUBLIC,anon,authenticated,service_role;
-- Habilitacao REAL depende de #41 banco, #42 dois humanos MFA, #43 executor.
