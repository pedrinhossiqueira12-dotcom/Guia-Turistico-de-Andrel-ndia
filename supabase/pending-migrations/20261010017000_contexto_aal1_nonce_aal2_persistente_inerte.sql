-- #42: vinculo documental AAL1 -> nonce AAL2, SEM prova GoTrue.
-- SECURITY: banco OWNER somente. Toda resposta permanece HARD HOLD.
-- O contexto não inclui OTP/JWT/refresh_token nem cria desafio externo.
BEGIN;

CREATE TABLE public.catalogo_asaas_contextos_pre_mfa_inertes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 separacao_id uuid NOT NULL REFERENCES public.catalogo_asaas_separacoes_excepcionais(id)
  ON DELETE RESTRICT,
 revisor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 sessao_id uuid NOT NULL,
 fator_id uuid NOT NULL,
 fingerprint_creditos_sha256 text NOT NULL
  CHECK(fingerprint_creditos_sha256 ~ '^[a-f0-9]{64}$'),
 dossie_seq bigint NOT NULL CHECK(dossie_seq>0),
 dossie_hash_sha256 text NOT NULL CHECK(dossie_hash_sha256 ~ '^[a-f0-9]{64}$'),
 matriz_hash_sha256 text NOT NULL CHECK(matriz_hash_sha256 ~ '^[a-f0-9]{64}$'),
 preparado_em timestamptz NOT NULL,
 expira_em timestamptz NOT NULL,
 estado text NOT NULL DEFAULT 'preparado_sem_challenge'
  CHECK(estado='preparado_sem_challenge'),
 CHECK(expira_em>preparado_em AND expira_em<=preparado_em+interval '2 minutes'),
 UNIQUE(separacao_id,revisor_id,sessao_id)
);

CREATE TABLE public.catalogo_asaas_vinculos_pre_mfa_nonce_inertes (
 contexto_id uuid PRIMARY KEY
  REFERENCES public.catalogo_asaas_contextos_pre_mfa_inertes(id)
  ON DELETE RESTRICT,
 nonce uuid NOT NULL UNIQUE
  REFERENCES public.catalogo_asaas_intencoes_mfa_documentais_ensaio(nonce)
  ON DELETE RESTRICT,
 vinculado_em timestamptz NOT NULL,
 resultado text NOT NULL DEFAULT 'comparacao_documental_sem_prova_mfa'
  CHECK(resultado='comparacao_documental_sem_prova_mfa')
);
ALTER TABLE public.catalogo_asaas_contextos_pre_mfa_inertes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_asaas_vinculos_pre_mfa_nonce_inertes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_asaas_contextos_pre_mfa_inertes
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.catalogo_asaas_vinculos_pre_mfa_nonce_inertes
 FROM PUBLIC,anon,authenticated,service_role;

-- O dono SQL pede só sessao/fator/escrow; identidade, fingerprints,
-- tempos e versão do dossiê são TODOS reobtidos do banco.
CREATE FUNCTION catalogo_private.catalogo_asaas_fixar_contexto_pre_mfa_inerte()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $snapshot$
DECLARE
 v_fator jsonb;
 v_uid uuid;
 v_e public.catalogo_asaas_separacoes_excepcionais%ROWTYPE;
 v_doc jsonb;
 v_mat jsonb;
 v_fin jsonb;
 v_r timestamptz;
 v_agora timestamptz;
BEGIN
 IF NEW.separacao_id IS NULL OR NEW.sessao_id IS NULL OR NEW.fator_id IS NULL THEN
  RAISE EXCEPTION 'Contexto exige escrow, sessao AAL1 e fator TOTP'
   USING ERRCODE='23514';
 END IF;
 v_fator:=catalogo_private.catalogo_asaas_checar_fator_totp_aal1_inerte(
  NEW.sessao_id,NEW.fator_id);
 IF v_fator->>'elegivel' IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'Sessao AAL1 nao e titular do TOTP verificado'
   USING ERRCODE='23514';
 END IF;
 v_uid:=(v_fator->>'userId')::uuid;
 SELECT r.valido_ate INTO v_r
 FROM public.catalogo_asaas_revisores_escrow_ensaio r
 WHERE r.revisor_id=v_uid FOR UPDATE;
 IF v_r IS NULL OR v_r<=pg_catalog.clock_timestamp()
  OR EXISTS(SELECT 1 FROM public.catalogo_asaas_revisores_escrow_revogacoes_ensaio x
    WHERE x.revisor_id=v_uid) THEN
  RAISE EXCEPTION 'Revisor de ensaio ausente/expirado/revogado'
   USING ERRCODE='23514';
 END IF;
 SELECT * INTO v_e FROM public.catalogo_asaas_separacoes_excepcionais
 WHERE id=NEW.separacao_id;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Separacao excepcional ausente' USING ERRCODE='23514';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('asaas-saque:'||v_e.motoboy_id::text,0));
 SELECT * INTO v_e FROM public.catalogo_asaas_separacoes_excepcionais
 WHERE id=NEW.separacao_id FOR UPDATE;
 IF v_e.situacao IS DISTINCT FROM 'congelada'
  OR v_e.motoboy_id=v_uid
  OR EXISTS(SELECT 1 FROM public.catalogo_asaas_escrow_dossie_eventos d
    WHERE d.separacao_id=v_e.id AND d.autor_id=v_uid)
  OR EXISTS(
    SELECT 1 FROM public.catalogo_asaas_separacoes_excepcionais_itens i
    JOIN public.catalogo_remuneracoes_v2 cr ON cr.id=i.remuneracao_id
    JOIN public.catalogos c ON c.comercio_id=cr.comercio_id
    WHERE i.separacao_id=v_e.id AND c.proprietario_id=v_uid)
 THEN
  RAISE EXCEPTION 'Escrow nao congelado ou conflito de interesses'
   USING ERRCODE='23514';
 END IF;
 -- Rechecar AAL1 depois de adquirir locks longos.
 v_fator:=catalogo_private.catalogo_asaas_checar_fator_totp_aal1_inerte(
   NEW.sessao_id, NEW.fator_id);
 IF v_fator->>'elegivel' IS DISTINCT FROM 'true'
  OR v_fator->>'userId' IS DISTINCT FROM v_uid::text THEN
  RAISE EXCEPTION 'Sessao ou fator foi alterado durante o preparo'
   USING ERRCODE='23514';
 END IF;
 v_doc:=public.catalogo_asaas_verificar_integridade_dossie_escrow(v_e.id);
 v_mat:=public.catalogo_asaas_matriz_conciliacao_escrow(v_e.id);
 v_fin:=public.catalogo_asaas_diagnosticar_separacao_excepcional(v_e.id);
 IF v_doc->>'integridade_valida' IS DISTINCT FROM 'true'
  OR coalesce((v_doc->>'numero_eventos')::bigint,0)<1
  OR v_doc->>'hash_final_registrado_sha256' IS NULL
  OR v_mat->>'ok' IS DISTINCT FROM 'true'
  OR v_fin->>'composicao_inalterada_e_financiada' IS DISTINCT FROM 'true'
 THEN
  RAISE EXCEPTION 'Dossie ou matriz nao estao validos para comparar'
   USING ERRCODE='23514';
 END IF;
 v_agora:=pg_catalog.clock_timestamp();
 NEW.id:=pg_catalog.gen_random_uuid();
 NEW.revisor_id:=v_uid;
 NEW.fingerprint_creditos_sha256:=v_e.fingerprint_sha256;
 NEW.dossie_seq:=(v_doc->>'numero_eventos')::bigint;
 NEW.dossie_hash_sha256:=v_doc->>'hash_final_registrado_sha256';
 NEW.matriz_hash_sha256:=pg_catalog.encode(pg_catalog.sha256(
   pg_catalog.convert_to(v_mat::text,'UTF8')),'hex');
 NEW.preparado_em:=v_agora;
 NEW.expira_em:=v_agora+interval '2 minutes';
 NEW.estado:='preparado_sem_challenge';
 RETURN NEW;
END $snapshot$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_fixar_contexto_pre_mfa_inerte()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER aa_catalogo_asaas_fixar_contexto_pre_mfa_inerte
 BEFORE INSERT ON public.catalogo_asaas_contextos_pre_mfa_inertes
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_fixar_contexto_pre_mfa_inerte();

-- Comparação depois da emissão do nonce AAL2, mas não da prova OTP.
-- Mesmo "compativel=true" NUNCA significa challenge verificado.
CREATE FUNCTION catalogo_private.catalogo_asaas_diagnosticar_vinculo_pre_mfa_nonce_inerte(
 p_contexto uuid,p_nonce uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''
AS $diagnose$
DECLARE
 v_c public.catalogo_asaas_contextos_pre_mfa_inertes%ROWTYPE;
 v_n public.catalogo_asaas_intencoes_mfa_documentais_ensaio%ROWTYPE;
 v_auth jsonb;
 v_esc public.catalogo_asaas_separacoes_excepcionais%ROWTYPE;
 v_doc jsonb;
 v_mat jsonb;
 v_fin jsonb;
 v_ok boolean:=false;
BEGIN
 SELECT * INTO v_c FROM public.catalogo_asaas_contextos_pre_mfa_inertes
 WHERE id=p_contexto;
 SELECT * INTO v_n FROM public.catalogo_asaas_intencoes_mfa_documentais_ensaio
 WHERE nonce=p_nonce;
 IF v_c.id IS NOT NULL AND v_n.nonce IS NOT NULL THEN
  v_auth:=catalogo_private.catalogo_asaas_ler_sessao_fator_auth_inerte(v_c.sessao_id);
  SELECT * INTO v_esc FROM public.catalogo_asaas_separacoes_excepcionais
  WHERE id=v_c.separacao_id;
  IF v_esc.id IS NOT NULL THEN
   v_doc:=public.catalogo_asaas_verificar_integridade_dossie_escrow(v_c.separacao_id);
   v_mat:=public.catalogo_asaas_matriz_conciliacao_escrow(v_c.separacao_id);
   v_fin:=public.catalogo_asaas_diagnosticar_separacao_excepcional(v_c.separacao_id);
   v_ok:=coalesce(
    v_c.expira_em>pg_catalog.clock_timestamp()
    AND v_n.gerado_em>=v_c.preparado_em
    AND v_n.gerado_em<=v_c.expira_em
    AND v_n.expira_em>pg_catalog.clock_timestamp()
    AND v_c.estado='preparado_sem_challenge'
    AND v_n.finalidade='consulta_documental_ensaio'
    AND v_c.revisor_id=v_n.revisor_id
    AND v_c.sessao_id=v_n.sessao_id
    AND v_c.separacao_id=v_n.separacao_id
    AND v_auth->>'id'=v_c.sessao_id::text
    AND v_auth->>'userId'=v_c.revisor_id::text
    AND v_auth->>'factorId'=v_c.fator_id::text
    AND v_auth->>'aal'='aal2'
    AND v_esc.situacao='congelada'
    AND v_esc.fingerprint_sha256=v_c.fingerprint_creditos_sha256
    AND v_c.fingerprint_creditos_sha256=v_n.fingerprint_creditos_sha256
    AND v_c.dossie_seq=v_n.dossie_seq
    AND v_c.dossie_hash_sha256=v_n.dossie_hash_sha256
    AND v_c.matriz_hash_sha256=v_n.matriz_hash_sha256
    AND v_doc->>'integridade_valida'='true'
    AND (v_doc->>'numero_eventos')::bigint=v_c.dossie_seq
    AND v_doc->>'hash_final_registrado_sha256'=v_c.dossie_hash_sha256
    AND v_mat->>'ok'='true'
    AND pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(v_mat::text,'UTF8')),'hex')=v_c.matriz_hash_sha256
    AND v_fin->>'composicao_inalterada_e_financiada'='true'
    AND EXISTS (
     SELECT 1 FROM public.catalogo_asaas_revisores_escrow_ensaio r
     WHERE r.revisor_id=v_c.revisor_id
      AND r.valido_ate>pg_catalog.clock_timestamp()
      AND NOT EXISTS(
        SELECT 1 FROM public.catalogo_asaas_revisores_escrow_revogacoes_ensaio x
        WHERE x.revisor_id=r.revisor_id)),false);
  END IF;
 END IF;
 RETURN pg_catalog.jsonb_build_object(
  'ok',v_ok, 'vinculo_documental_compativel',v_ok,
  'challenge_go_true_verificado',false,
  'desafio_mfa_da_sessao_comprovado',false,
  'dupla_aprovacao_financeira',false,
  'pode_registrar_parecer',false,
  'pagamento_autorizado',false,
  'liberacao_autorizada',false,
  'baixa_realizada',false,
  'movimenta_dinheiro',false,
  'status_operacional','HOLD_OBRIGATORIO'
 );
END $diagnose$;
REVOKE ALL ON FUNCTION
 catalogo_private.catalogo_asaas_diagnosticar_vinculo_pre_mfa_nonce_inerte(uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;

-- Protege mapeamento 1:1. Qualquer dono SQL que associe pre-contexto
-- e nonce de outra operacao, sessao, fator ou evidencia recebe erro.
CREATE FUNCTION catalogo_private.catalogo_asaas_guardar_vinculo_pre_mfa_nonce_inerte()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $link$
DECLARE v_result jsonb;
BEGIN
 SELECT 1 FROM public.catalogo_asaas_contextos_pre_mfa_inertes c
 WHERE id=NEW.contexto_id FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Contexto AAL1 inexistente' USING ERRCODE='23514';
 END IF;
 v_result:=catalogo_private.catalogo_asaas_diagnosticar_vinculo_pre_mfa_nonce_inerte(
   NEW.contexto_id,NEW.nonce);
 IF v_result->>'vinculo_documental_compativel' IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'Contexto AAL1 e nonce AAL2 nao sao compativeis'
   USING ERRCODE='23514';
 END IF;
 NEW.vinculado_em:=pg_catalog.clock_timestamp();
 NEW.resultado:='comparacao_documental_sem_prova_mfa';
 RETURN NEW;
END $link$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_guardar_vinculo_pre_mfa_nonce_inerte()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER aa_catalogo_asaas_guardar_vinculo_pre_mfa_nonce_inerte
 BEFORE INSERT ON public.catalogo_asaas_vinculos_pre_mfa_nonce_inertes
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_guardar_vinculo_pre_mfa_nonce_inerte();

CREATE FUNCTION catalogo_private.catalogo_asaas_pre_mfa_append_only_inerte()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $immutable$
BEGIN
 RAISE EXCEPTION 'Contexto AAL1 e vinculo AAL2 sao append-only'
  USING ERRCODE='23514';
END $immutable$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_pre_mfa_append_only_inerte()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER catalogo_asaas_contexto_pre_mfa_imutavel
 BEFORE UPDATE OR DELETE ON public.catalogo_asaas_contextos_pre_mfa_inertes
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_pre_mfa_append_only_inerte();
CREATE TRIGGER catalogo_asaas_vinculo_pre_mfa_imutavel
 BEFORE UPDATE OR DELETE ON public.catalogo_asaas_vinculos_pre_mfa_nonce_inertes
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_pre_mfa_append_only_inerte();

COMMENT ON TABLE public.catalogo_asaas_contextos_pre_mfa_inertes IS
 'Contexto forense AAL1, sem challenge real nem MFA da operacao. Nenhum dinheiro.';
COMMENT ON TABLE public.catalogo_asaas_vinculos_pre_mfa_nonce_inertes IS
 'Pareamento 1:1 de contexto AAL1 e nonce documental AAL2. NAO e prova do TOTP ou autorizacao financeira.';
COMMIT;
