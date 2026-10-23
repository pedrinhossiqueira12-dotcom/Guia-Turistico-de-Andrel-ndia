-- #42 | Livro de tentativas MFA DOCUMENTAIS ficticias e sem OTP.
-- NAO registra MFA verificado, NAO chama Auth, NAO habilita parecer/Pix.
-- Somente dono PostgreSQL; sem grants publicos, backend ou usuarios.
BEGIN;

CREATE TABLE public.catalogo_asaas_stepup_tentativas_inertes (
 challenge_id uuid PRIMARY KEY
  REFERENCES public.catalogo_asaas_stepup_desafios_documentais_ensaio(challenge_id)
  ON DELETE RESTRICT,
 nonce uuid NOT NULL UNIQUE
  REFERENCES public.catalogo_asaas_intencoes_mfa_documentais_ensaio(nonce)
  ON DELETE RESTRICT,
 revisor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 sessao_id uuid NOT NULL,
 tentativa_em timestamptz NOT NULL,
 resultado text NOT NULL CHECK(resultado='tentativa_reservada_sem_verificacao')
);
CREATE INDEX catalogo_asaas_stepup_tentativas_revisor_hora_idx
 ON public.catalogo_asaas_stepup_tentativas_inertes(revisor_id,tentativa_em);

ALTER TABLE public.catalogo_asaas_stepup_tentativas_inertes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_asaas_stepup_tentativas_inertes
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION catalogo_private.catalogo_asaas_tentativa_stepup_imutavel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $immutable$
BEGIN
 RAISE EXCEPTION 'Tentativa documental e historico imutavel: sem UPDATE/DELETE'
  USING ERRCODE='23514';
END $immutable$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_tentativa_stepup_imutavel()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER catalogo_asaas_tentativa_stepup_append_only
 BEFORE UPDATE OR DELETE ON public.catalogo_asaas_stepup_tentativas_inertes
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_tentativa_stepup_imutavel();

-- Reserva para ENSAIO, NAO verifica um TOTP e NAO permite enviar OTP.
-- Um uso por challenge; no maximo 3 desafios tentados pelo mesmo revisor
-- na hora movel. Exigiria OUTRO nonce + desafio para cada nova tentativa.
-- Ordem de travas: advisory do revisor -> row challenge FOR UPDATE.
-- Esse protocolo de locks e restrito ao livro de laboratorio.
CREATE FUNCTION catalogo_private.catalogo_asaas_reservar_tentativa_stepup_inerte(
 p_challenge uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $attempt$
DECLARE
 v_ch public.catalogo_asaas_stepup_desafios_documentais_ensaio%ROWTYPE;
 v_i public.catalogo_asaas_intencoes_mfa_documentais_ensaio%ROWTYPE;
 v_e public.catalogo_asaas_separacoes_excepcionais%ROWTYPE;
 v_pf jsonb;
 v_doc jsonb;
 v_matriz jsonb;
 v_fin jsonb;
 v_hora timestamptz;
 v_quantidade integer;
BEGIN
 IF p_challenge IS NULL THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','desafio_ausente',
   'pagamento_autorizado',false,'status_operacional','HOLD_OBRIGATORIO');
 END IF;
 -- Lookup sem lock serve so para descobrir revisor. Revalidar DEPOIS
 -- de serializar por revisor e trancar a linha especifica.
 SELECT * INTO v_ch FROM public.catalogo_asaas_stepup_desafios_documentais_ensaio
 WHERE challenge_id=p_challenge;
 IF NOT FOUND THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','desafio_desconhecido',
   'pagamento_autorizado',false,'status_operacional','HOLD_OBRIGATORIO');
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('asaas-stepup-ci-tentativa:'||v_ch.revisor_id::text,0)
 );
 SELECT * INTO v_ch FROM public.catalogo_asaas_stepup_desafios_documentais_ensaio
 WHERE challenge_id=p_challenge FOR UPDATE;
 IF NOT FOUND THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','desafio_inexistente',
   'pagamento_autorizado',false,'status_operacional','HOLD_OBRIGATORIO');
 END IF;
 IF EXISTS(
  SELECT 1 FROM public.catalogo_asaas_stepup_tentativas_inertes t
  WHERE t.challenge_id=p_challenge
 ) THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','tentativa_ja_registrada',
   'pagamento_autorizado',false,'status_operacional','HOLD_OBRIGATORIO');
 END IF;
 v_hora:=pg_catalog.clock_timestamp();
 SELECT * INTO v_i FROM public.catalogo_asaas_intencoes_mfa_documentais_ensaio
 WHERE nonce=v_ch.nonce;
 IF NOT FOUND OR v_ch.estado IS DISTINCT FROM 'desafio_emitido_sem_verificacao'
  OR v_ch.expira_em<=v_hora OR v_i.expira_em<=v_hora
  OR EXISTS(
   SELECT 1 FROM public.catalogo_asaas_usos_nonce_documentais_ensaio u
   WHERE u.nonce=v_ch.nonce
  ) THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','nonce_ou_desafio_invalido',
   'pagamento_autorizado',false,'status_operacional','HOLD_OBRIGATORIO');
 END IF;
 IF v_ch.revisor_id IS DISTINCT FROM v_i.revisor_id
  OR v_ch.sessao_id IS DISTINCT FROM v_i.sessao_id
  OR v_ch.separacao_id IS DISTINCT FROM v_i.separacao_id
  OR v_ch.dossie_hash_sha256 IS DISTINCT FROM v_i.dossie_hash_sha256
  OR v_ch.finalidade IS DISTINCT FROM 'consulta_documental_ensaio' THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','vinculo_de_evidencia_divergente',
   'pagamento_autorizado',false,'status_operacional','HOLD_OBRIGATORIO');
 END IF;
 -- Preflight Auth so indica AAL2 na sessao; nao indica step-up recente.
 v_pf:=public.catalogo_asaas_preflight_sessao_revisor_inerte();
 IF v_pf->>'sessao_aal2_confirmada' IS DISTINCT FROM 'true'
  OR v_pf->>'indicacao_ensaio_vigente' IS DISTINCT FROM 'true'
  OR v_pf->>'jwt_recente_confirmado' IS DISTINCT FROM 'true'
  OR auth.uid() IS DISTINCT FROM v_ch.revisor_id
  OR auth.jwt()->>'session_id' IS DISTINCT FROM v_ch.sessao_id::text
  OR NOT EXISTS (
   SELECT 1 FROM auth.sessions s
   JOIN auth.mfa_factors f ON f.id=s.factor_id
   WHERE s.id=v_ch.sessao_id AND s.user_id=v_ch.revisor_id
    AND s.factor_id=v_ch.fator_id
    AND s.aal::text='aal2'
    AND (s.not_after IS NULL OR s.not_after>v_hora)
    AND f.user_id=v_ch.revisor_id AND f.status::text='verified'
    AND f.factor_type::text='totp'
  ) THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','sessao_revisor_ou_fator_invalido',
   'pagamento_autorizado',false,'status_operacional','HOLD_OBRIGATORIO');
 END IF;
 SELECT * INTO v_e FROM public.catalogo_asaas_separacoes_excepcionais
 WHERE id=v_ch.separacao_id;
 v_doc:=public.catalogo_asaas_verificar_integridade_dossie_escrow(v_ch.separacao_id);
 v_matriz:=public.catalogo_asaas_matriz_conciliacao_escrow(v_ch.separacao_id);
 v_fin:=public.catalogo_asaas_diagnosticar_separacao_excepcional(v_ch.separacao_id);
 IF v_e.situacao IS DISTINCT FROM 'congelada'
  OR v_e.fingerprint_sha256 IS DISTINCT FROM v_i.fingerprint_creditos_sha256
  OR v_doc->>'integridade_valida' IS DISTINCT FROM 'true'
  OR v_doc->>'hash_final_registrado_sha256' IS DISTINCT FROM v_i.dossie_hash_sha256
  OR v_matriz->>'ok' IS DISTINCT FROM 'true'
  OR pg_catalog.encode(pg_catalog.sha256(
     pg_catalog.convert_to(v_matriz::text,'UTF8')),'hex')
    IS DISTINCT FROM v_i.matriz_hash_sha256
  OR v_fin->>'composicao_inalterada_e_financiada' IS DISTINCT FROM 'true'
 THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','escrow_evidencias_divergentes',
   'pagamento_autorizado',false,'status_operacional','HOLD_OBRIGATORIO');
 END IF;

 -- Advisory lock por revisor impede a janela TOCTOU entre COUNT e INSERT,
 -- mesmo se os tres desafios forem de nonces diferentes.
 SELECT count(*)::integer INTO v_quantidade
 FROM public.catalogo_asaas_stepup_tentativas_inertes t
 WHERE t.revisor_id=v_ch.revisor_id
   AND t.tentativa_em>v_hora-interval '1 hour';
 IF v_quantidade>=3 THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','limite_tres_por_hora',
   'pagamento_autorizado',false,'status_operacional','HOLD_OBRIGATORIO');
 END IF;

 INSERT INTO public.catalogo_asaas_stepup_tentativas_inertes(
  challenge_id,nonce,revisor_id,sessao_id,tentativa_em,resultado
 ) VALUES(
  v_ch.challenge_id,v_ch.nonce,v_ch.revisor_id,v_ch.sessao_id,
  v_hora,'tentativa_reservada_sem_verificacao'
 );
 RETURN pg_catalog.jsonb_build_object(
  'ok',true,'tentativa_documental_registrada',true,
  'desafio_mfa_da_sessao_comprovado',false,
  'verificacao_otp_realizada',false,'pode_registrar_parecer',false,
  'pagamento_autorizado',false,'dupla_aprovacao_financeira',false,
  'liberacao_autorizada',false,'baixa_realizada',false,'movimenta_dinheiro',false,
  'status_operacional','HOLD_OBRIGATORIO');
END $attempt$;

REVOKE ALL ON FUNCTION
 catalogo_private.catalogo_asaas_reservar_tentativa_stepup_inerte(uuid)
 FROM PUBLIC,anon,authenticated,service_role;

COMMENT ON TABLE public.catalogo_asaas_stepup_tentativas_inertes IS
 'Um consumo ficticio por desafio, com ate 3/hora por revisor de laboratorio. Nao guarda OTP nem atesta Auth MFA, nem libera dinheiro.';
COMMIT;
