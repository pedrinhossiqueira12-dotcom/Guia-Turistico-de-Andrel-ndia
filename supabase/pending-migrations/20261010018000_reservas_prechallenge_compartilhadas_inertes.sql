-- #42 | Livro duravel de laboratorio do pre-challenge MFA.
-- SOMENTE owner SQL: nao ha REST/RPC de acesso da Edge, MFA real ou Pix.
-- Contexto AAL1 original (migration 17000) e a fonte independente.
BEGIN;

CREATE TABLE public.catalogo_asaas_reservas_prechallenge_compartilhadas_inertes (
 contexto_id uuid PRIMARY KEY REFERENCES public.catalogo_asaas_contextos_pre_mfa_inertes(id) ON DELETE RESTRICT,
 nonce uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 reservado_em timestamptz NOT NULL,
 expira_em timestamptz NOT NULL,
 resultado text NOT NULL CHECK(resultado='nonce_reservado_sem_mfa'),
 CHECK(expira_em>reservado_em AND expira_em<=reservado_em+interval '2 minutes')
);
CREATE TABLE public.catalogo_asaas_desafios_prechallenge_compartilhados_inertes (
 nonce uuid PRIMARY KEY REFERENCES public.catalogo_asaas_reservas_prechallenge_compartilhadas_inertes(nonce) ON DELETE RESTRICT,
 challenge_id uuid NOT NULL UNIQUE,
 tentativa uuid NOT NULL UNIQUE,
 registrado_em timestamptz NOT NULL,
 resultado text NOT NULL CHECK(resultado='challenge_registrado_sem_verificacao')
);
CREATE TABLE public.catalogo_asaas_consumos_prechallenge_compartilhados_inertes (
 challenge_id uuid PRIMARY KEY REFERENCES public.catalogo_asaas_desafios_prechallenge_compartilhados_inertes(challenge_id) ON DELETE RESTRICT,
 nonce uuid NOT NULL UNIQUE REFERENCES public.catalogo_asaas_desafios_prechallenge_compartilhados_inertes(nonce) ON DELETE RESTRICT,
 tentativa uuid NOT NULL UNIQUE REFERENCES public.catalogo_asaas_desafios_prechallenge_compartilhados_inertes(tentativa) ON DELETE RESTRICT,
 consumido_em timestamptz NOT NULL,
 resultado text NOT NULL CHECK(resultado='tentativa_consumida_sem_verificacao')
);
ALTER TABLE public.catalogo_asaas_reservas_prechallenge_compartilhadas_inertes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_asaas_desafios_prechallenge_compartilhados_inertes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_asaas_consumos_prechallenge_compartilhados_inertes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_asaas_reservas_prechallenge_compartilhadas_inertes FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.catalogo_asaas_desafios_prechallenge_compartilhados_inertes FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.catalogo_asaas_consumos_prechallenge_compartilhados_inertes FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER catalogo_asaas_reserva_prechallenge_append_only
 BEFORE UPDATE OR DELETE ON public.catalogo_asaas_reservas_prechallenge_compartilhadas_inertes
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_pre_mfa_append_only_inerte();
CREATE TRIGGER catalogo_asaas_desafio_prechallenge_append_only
 BEFORE UPDATE OR DELETE ON public.catalogo_asaas_desafios_prechallenge_compartilhados_inertes
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_pre_mfa_append_only_inerte();
CREATE TRIGGER catalogo_asaas_consumo_prechallenge_append_only
 BEFORE UPDATE OR DELETE ON public.catalogo_asaas_consumos_prechallenge_compartilhados_inertes
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_pre_mfa_append_only_inerte();

-- Um unico formato de resposta. Mesmo sucesso documental nao comprova MFA.
CREATE FUNCTION catalogo_private.catalogo_asaas_resposta_prechallenge_compartilhada_inerte(
 p_ok boolean,p_motivo text,p_nonce uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=''
AS $response$
 SELECT pg_catalog.jsonb_build_object(
  'ok',p_ok,'motivo',p_motivo,'nonce',CASE WHEN p_ok THEN p_nonce ELSE NULL END,
  'challenge_go_true_verificado',false,'desafio_mfa_da_sessao_comprovado',false,
  'pode_registrar_parecer',false,'pagamento_autorizado',false,
  'dupla_aprovacao_financeira',false,'liberacao_autorizada',false,
  'baixa_realizada',false,'movimenta_dinheiro',false,
  'status_operacional','HOLD_OBRIGATORIO'
 );
$response$;
REVOKE ALL ON FUNCTION
 catalogo_private.catalogo_asaas_resposta_prechallenge_compartilhada_inerte(boolean,text,uuid)
 FROM PUBLIC,anon,authenticated,service_role;

-- Verifica o contexto AAL1 original, sessao/fator e versao das evidencias.
-- SEM confiar em claims JWT de cliente, TOTP ou snapshot submetido por HTTP.
CREATE FUNCTION catalogo_private.catalogo_asaas_prechallenge_elegivel_inerte(p_contexto uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $eligibility$
DECLARE
 v_c public.catalogo_asaas_contextos_pre_mfa_inertes%ROWTYPE;
 v_e public.catalogo_asaas_separacoes_excepcionais%ROWTYPE;
 v_auth jsonb;
 v_doc jsonb;
 v_mat jsonb;
 v_fin jsonb;
 v_agora timestamptz;
BEGIN
 v_agora:=pg_catalog.clock_timestamp();
 SELECT * INTO v_c FROM public.catalogo_asaas_contextos_pre_mfa_inertes
 WHERE id=p_contexto;
 IF NOT FOUND OR v_c.expira_em<=v_agora OR v_c.estado<>'preparado_sem_challenge'
 THEN RETURN false; END IF;
 v_auth:=catalogo_private.catalogo_asaas_checar_fator_totp_aal1_inerte(
  v_c.sessao_id,v_c.fator_id);
 IF v_auth->>'elegivel' IS DISTINCT FROM 'true'
  OR v_auth->>'userId' IS DISTINCT FROM v_c.revisor_id::text
  OR NOT EXISTS(SELECT 1 FROM public.catalogo_asaas_revisores_escrow_ensaio rr
    WHERE rr.revisor_id=v_c.revisor_id AND rr.valido_ate>v_agora)
  OR EXISTS(SELECT 1 FROM public.catalogo_asaas_revisores_escrow_revogacoes_ensaio rr
    WHERE rr.revisor_id=v_c.revisor_id)
 THEN RETURN false; END IF;
 SELECT * INTO v_e FROM public.catalogo_asaas_separacoes_excepcionais
 WHERE id=v_c.separacao_id;
 IF NOT FOUND OR v_e.situacao IS DISTINCT FROM 'congelada'
  OR v_e.fingerprint_sha256 IS DISTINCT FROM v_c.fingerprint_creditos_sha256
 THEN RETURN false; END IF;
 v_doc:=public.catalogo_asaas_verificar_integridade_dossie_escrow(v_c.separacao_id);
 v_mat:=public.catalogo_asaas_matriz_conciliacao_escrow(v_c.separacao_id);
 v_fin:=public.catalogo_asaas_diagnosticar_separacao_excepcional(v_c.separacao_id);
 RETURN COALESCE(
  v_doc->>'integridade_valida'='true'
  AND (v_doc->>'numero_eventos')::bigint=v_c.dossie_seq
  AND v_doc->>'hash_final_registrado_sha256'=v_c.dossie_hash_sha256
  AND v_mat->>'ok'='true'
  AND pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(v_mat::text,'UTF8')),'hex')=v_c.matriz_hash_sha256
  AND v_fin->>'composicao_inalterada_e_financiada'='true',false);
EXCEPTION WHEN OTHERS THEN
 -- Erro de Auth/escrow/integridade nunca pode ser interpretado como elegivel.
 RETURN false;
END $eligibility$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_prechallenge_elegivel_inerte(uuid)
 FROM PUBLIC,anon,authenticated,service_role;

-- A linha imutavel do contexto e o mutex transacional entre instancias.
CREATE FUNCTION catalogo_private.catalogo_asaas_reservar_inicio_compartilhado_inerte(
 p_contexto uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $start$
DECLARE
 v_c public.catalogo_asaas_contextos_pre_mfa_inertes%ROWTYPE;
 v_nonce uuid;
 v_agora timestamptz;
BEGIN
 IF p_contexto IS NULL THEN
  RETURN catalogo_private.catalogo_asaas_resposta_prechallenge_compartilhada_inerte(false,'contexto_ausente');
 END IF;
 SELECT * INTO v_c FROM public.catalogo_asaas_contextos_pre_mfa_inertes
 WHERE id=p_contexto FOR UPDATE;
 IF NOT FOUND OR NOT catalogo_private.catalogo_asaas_prechallenge_elegivel_inerte(p_contexto) THEN
  RETURN catalogo_private.catalogo_asaas_resposta_prechallenge_compartilhada_inerte(false,'contexto_aal1_invalido');
 END IF;
 IF EXISTS(SELECT 1 FROM public.catalogo_asaas_reservas_prechallenge_compartilhadas_inertes
   WHERE contexto_id=p_contexto) THEN
  RETURN catalogo_private.catalogo_asaas_resposta_prechallenge_compartilhada_inerte(false,'nonce_ja_reservado');
 END IF;
 v_agora:=pg_catalog.clock_timestamp();
 IF v_agora>=v_c.expira_em THEN
  RETURN catalogo_private.catalogo_asaas_resposta_prechallenge_compartilhada_inerte(false,'contexto_expirado');
 END IF;
 INSERT INTO public.catalogo_asaas_reservas_prechallenge_compartilhadas_inertes(
  contexto_id,nonce,reservado_em,expira_em,resultado
 ) VALUES(p_contexto,pg_catalog.gen_random_uuid(),v_agora,v_c.expira_em,'nonce_reservado_sem_mfa')
 RETURNING nonce INTO v_nonce;
 RETURN catalogo_private.catalogo_asaas_resposta_prechallenge_compartilhada_inerte(true,'nonce_reservado',v_nonce);
END $start$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_reservar_inicio_compartilhado_inerte(uuid)
 FROM PUBLIC,anon,authenticated,service_role;

-- UNIQUE challenge_id garante unicidade GERAL, mesmo contra outro contexto.
CREATE FUNCTION catalogo_private.catalogo_asaas_registrar_desafio_compartilhado_inerte(
 p_nonce uuid,p_challenge uuid,p_tentativa uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $challenge$
DECLARE
 v_r public.catalogo_asaas_reservas_prechallenge_compartilhadas_inertes%ROWTYPE;
 v_ch uuid;
BEGIN
 IF p_nonce IS NULL OR p_challenge IS NULL OR p_tentativa IS NULL THEN
  RETURN catalogo_private.catalogo_asaas_resposta_prechallenge_compartilhada_inerte(false,'identificador_ausente');
 END IF;
 SELECT * INTO v_r FROM public.catalogo_asaas_reservas_prechallenge_compartilhadas_inertes
 WHERE nonce=p_nonce FOR UPDATE;
 IF NOT FOUND OR v_r.expira_em<=pg_catalog.clock_timestamp()
  OR NOT catalogo_private.catalogo_asaas_prechallenge_elegivel_inerte(v_r.contexto_id)
 THEN RETURN catalogo_private.catalogo_asaas_resposta_prechallenge_compartilhada_inerte(false,'reserva_expirada_ou_invalida');
 END IF;
 INSERT INTO public.catalogo_asaas_desafios_prechallenge_compartilhados_inertes(
  nonce,challenge_id,tentativa,registrado_em,resultado
 ) VALUES(p_nonce,p_challenge,p_tentativa,pg_catalog.clock_timestamp(),
  'challenge_registrado_sem_verificacao')
 ON CONFLICT DO NOTHING RETURNING challenge_id INTO v_ch;
 IF v_ch IS NULL THEN
  RETURN catalogo_private.catalogo_asaas_resposta_prechallenge_compartilhada_inerte(false,'challenge_duplicado');
 END IF;
 RETURN catalogo_private.catalogo_asaas_resposta_prechallenge_compartilhada_inerte(true,'challenge_registrado',p_nonce);
END $challenge$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_registrar_desafio_compartilhado_inerte(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;

-- Resgate unico antes de tentar verificar OTP; NAO realiza mfa.verify.
CREATE FUNCTION catalogo_private.catalogo_asaas_consumir_desafio_compartilhado_inerte(
 p_nonce uuid,p_challenge uuid,p_tentativa uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $consume$
DECLARE
 v_d public.catalogo_asaas_desafios_prechallenge_compartilhados_inertes%ROWTYPE;
 v_r public.catalogo_asaas_reservas_prechallenge_compartilhadas_inertes%ROWTYPE;
 v_saved uuid;
BEGIN
 IF p_nonce IS NULL OR p_challenge IS NULL OR p_tentativa IS NULL THEN
  RETURN catalogo_private.catalogo_asaas_resposta_prechallenge_compartilhada_inerte(false,'identificador_ausente');
 END IF;
 SELECT * INTO v_d FROM public.catalogo_asaas_desafios_prechallenge_compartilhados_inertes
 WHERE challenge_id=p_challenge FOR UPDATE;
 IF NOT FOUND OR v_d.nonce IS DISTINCT FROM p_nonce
  OR v_d.tentativa IS DISTINCT FROM p_tentativa THEN
  RETURN catalogo_private.catalogo_asaas_resposta_prechallenge_compartilhada_inerte(false,'challenge_sessao_ou_tentativa_divergente');
 END IF;
 SELECT * INTO v_r FROM public.catalogo_asaas_reservas_prechallenge_compartilhadas_inertes
 WHERE nonce=p_nonce;
 IF NOT FOUND OR v_r.expira_em<=pg_catalog.clock_timestamp()
  OR NOT catalogo_private.catalogo_asaas_prechallenge_elegivel_inerte(v_r.contexto_id)
 THEN RETURN catalogo_private.catalogo_asaas_resposta_prechallenge_compartilhada_inerte(false,'contexto_ou_reserva_expirada');
 END IF;
 INSERT INTO public.catalogo_asaas_consumos_prechallenge_compartilhados_inertes(
  challenge_id,nonce,tentativa,consumido_em,resultado
 ) VALUES(p_challenge,p_nonce,p_tentativa,pg_catalog.clock_timestamp(),
  'tentativa_consumida_sem_verificacao')
 ON CONFLICT DO NOTHING RETURNING challenge_id INTO v_saved;
 IF v_saved IS NULL THEN
  RETURN catalogo_private.catalogo_asaas_resposta_prechallenge_compartilhada_inerte(false,'tentativa_ja_consumida');
 END IF;
 RETURN catalogo_private.catalogo_asaas_resposta_prechallenge_compartilhada_inerte(true,'tentativa_documental_consumida',p_nonce);
END $consume$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_consumir_desafio_compartilhado_inerte(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;

COMMENT ON TABLE public.catalogo_asaas_reservas_prechallenge_compartilhadas_inertes IS
 'Owner-only CI: nonce unico antes do Auth, baseado no contexto AAL1 imutavel. Nao concede autorizacao.';
COMMENT ON TABLE public.catalogo_asaas_desafios_prechallenge_compartilhados_inertes IS
 'Owner-only CI: challenge_id unico entre operacoes. SEM mfa.verify real e SEM aprovacao financeira.';
COMMENT ON TABLE public.catalogo_asaas_consumos_prechallenge_compartilhados_inertes IS
 'Owner-only CI: consumo at-most-once anterior ao OTP; nao comprova MFA ou autoriza PIX.';
COMMIT;
