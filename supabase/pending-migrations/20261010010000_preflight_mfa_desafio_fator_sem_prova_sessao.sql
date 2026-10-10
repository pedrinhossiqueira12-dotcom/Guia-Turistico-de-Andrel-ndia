-- #42: auth.mfa_challenges.verified_at permite observar ultimo desafio TOTP.
-- WARNING: desafio nao tem session_id; outros dispositivos/sessoes podem
-- usar o mesmo factor_id. PROIBIDO converter essa observacao em aprovacao.
-- Funcao SECURITY DEFINER ja auditada como risco no Security Advisor.
-- Nenhuma nova GRANT a usuarios; nao altera saldo, saques ou liberacao.
-- #42 - preflight somente LEITURA da sessao do proprio revisor.
-- Mesmo JWT recente AAL2 NAO comprova recencia do desafio MFA.
-- Nenhum endpoint de aprovacao, nenhuma baixa, Pix ou liberacao financeira.
BEGIN;

CREATE OR REPLACE FUNCTION public.catalogo_asaas_preflight_sessao_revisor_inerte()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $self_check$
DECLARE
 v_user_id uuid;
 v_jwt jsonb;
 v_session_txt text;
 v_session_id uuid;
 v_iat_txt text;
 v_exp_txt text;
 v_iat bigint;
 v_exp bigint;
 v_now bigint;
 v_fresh boolean:=false;
 v_session_ok boolean:=false;
 v_factor_challenge_observed boolean:=false;
 v_ensaio_ok boolean:=false;
 v_restricoes text[]:=ARRAY[]::text[];
BEGIN
 -- Apenas o sujeito da sessao apresentada pelo gateway Auth (sem UUID input).
 -- PostgREST valida a assinatura do JWT ANTES de definir request.jwt.*.
 v_user_id:=auth.uid();
 v_jwt:=auth.jwt();
 IF v_user_id IS NULL OR v_jwt IS NULL
   OR v_jwt->>'sub' IS DISTINCT FROM v_user_id::text
   OR v_jwt->>'role' IS DISTINCT FROM 'authenticated'
   OR pg_catalog.current_setting('request.jwt.claim.role',true)
     IS DISTINCT FROM 'authenticated'
 THEN
  v_restricoes:=pg_catalog.array_append(v_restricoes,'identidade_de_sessao_nao_confirmada');
 ELSE
  v_session_txt:=v_jwt->>'session_id';
  v_iat_txt:=v_jwt->>'iat';
  v_exp_txt:=v_jwt->>'exp';
  IF coalesce(v_session_txt,'') !~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR coalesce(v_iat_txt,'') !~ '^[0-9]{10,11}$'
    OR coalesce(v_exp_txt,'') !~ '^[0-9]{10,11}$'
  THEN
   v_restricoes:=pg_catalog.array_append(v_restricoes,'claims_de_sessao_incompletas');
  ELSE
   v_session_id:=v_session_txt::uuid;
   v_iat:=v_iat_txt::bigint;
   v_exp:=v_exp_txt::bigint;
   v_now:=pg_catalog.floor(extract(epoch FROM pg_catalog.now()))::bigint;
   -- IAT recente demonstra JWT recem-emitido, nao fator MFA recem-verificado.
   v_fresh:=v_iat>=v_now-300 AND v_iat<=v_now+30 AND v_exp>v_now;
   IF NOT v_fresh THEN
    v_restricoes:=pg_catalog.array_append(v_restricoes,'jwt_expirado_ou_nao_recente');
   END IF;
   IF v_jwt->>'aal' IS DISTINCT FROM 'aal2'
     OR (v_jwt->>'is_anonymous') IS DISTINCT FROM 'false'
   THEN
    v_restricoes:=pg_catalog.array_append(v_restricoes,'aal2_ausente');
   ELSIF v_fresh THEN
    SELECT EXISTS (
     SELECT 1 FROM auth.sessions s
     JOIN auth.users u ON u.id=s.user_id
     WHERE s.id=v_session_id
       AND s.user_id=v_user_id
       AND s.aal::text='aal2'
       AND s.factor_id IS NOT NULL
       AND (s.not_after IS NULL OR s.not_after>pg_catalog.now())
       AND (u.banned_until IS NULL OR u.banned_until<=pg_catalog.now())
    ) INTO v_session_ok;
    IF NOT v_session_ok THEN
     v_restricoes:=pg_catalog.array_append(v_restricoes,'sessao_mfa_revogada_ou_nao_confirmada');
    ELSE
     -- auth.mfa_challenges possui factor_id e verified_at, NAO session_id.
     -- Observar verificacao TOTP recente do FATOR da sessao, mas
     -- outra sessao do mesmo usuario pode ter realizado essa verificacao.
     -- Nunca tratar este sinal como MFA recente da SESSAO atual.
     SELECT EXISTS (
      SELECT 1 FROM auth.mfa_challenges ch
      JOIN auth.mfa_factors f ON f.id=ch.factor_id
      JOIN auth.sessions s ON s.factor_id=f.id
      WHERE s.id=v_session_id
        AND s.user_id=v_user_id
        AND s.aal::text='aal2'
        AND f.user_id=v_user_id
        AND f.status::text='verified'
        AND f.factor_type::text='totp'
        AND ch.verified_at IS NOT NULL
        AND ch.verified_at>=pg_catalog.now()-interval '2 minutes'
        AND ch.verified_at<=pg_catalog.now()+interval '30 seconds'
        AND ch.verified_at>=ch.created_at
        AND ch.verified_at<=ch.created_at+interval '10 minutes'
     ) INTO v_factor_challenge_observed;
     IF NOT v_factor_challenge_observed THEN
      v_restricoes:=pg_catalog.array_append(v_restricoes,'desafio_recente_do_fator_nao_observado');
     END IF;
    END IF;
   END IF;
  END IF;
  SELECT EXISTS (
   SELECT 1 FROM public.catalogo_asaas_revisores_escrow_ensaio r
   WHERE r.revisor_id=v_user_id AND r.valido_ate>pg_catalog.now()
     AND NOT EXISTS (
      SELECT 1 FROM public.catalogo_asaas_revisores_escrow_revogacoes_ensaio x
      WHERE x.revisor_id=r.revisor_id
     )
  ) INTO v_ensaio_ok;
  IF NOT v_ensaio_ok THEN
   v_restricoes:=pg_catalog.array_append(v_restricoes,'indicacao_ensaio_ausente_ou_revogada');
  END IF;
 END IF;

 RETURN pg_catalog.jsonb_build_object(
  'ok',true,
  'sessao_aal2_confirmada',v_session_ok,
  'jwt_recente_confirmado',v_fresh,
  'indicacao_ensaio_vigente',v_ensaio_ok,
  'desafio_recente_observado_no_fator_sem_vinculo_sessao',v_factor_challenge_observed,
  'desafio_recente_comprovado_na_sessao_atual',false,
  'mfa_com_desafio_recente_comprovado',false,
  'revisor_real_credenciado',false,
  'apto_a_registrar_parecer',false,
  'dupla_aprovacao_financeira',false,
  'pagamento_autorizado',false,
  'baixa_realizada',false,
  'liberacao_autorizada',false,
  'movimenta_dinheiro',false,
  'status_operacional','HOLD_OBRIGATORIO',
  'impedimentos_de_checagem',pg_catalog.to_jsonb(v_restricoes),
  'aviso','Auth mostra verified_at por fator MFA, sem session_id de desafio. Pode haver outra sessao. Sinal nao autoriza parecer ou Pix.'
 );
END $self_check$;

REVOKE ALL ON FUNCTION public.catalogo_asaas_preflight_sessao_revisor_inerte()
 FROM PUBLIC,anon,authenticated,service_role;
-- Contrato autoconsulta: sem parametro revisor_id que possa ser forjado.
-- Nao expor a anon/service_role; a resposta nao contem dados de terceiros.
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_preflight_sessao_revisor_inerte()
 TO authenticated;
COMMENT ON FUNCTION public.catalogo_asaas_preflight_sessao_revisor_inerte() IS
 'Autoconsulta AAL2 e sinal de desafio TOTP recente por fator, NAO vinculado a sessao. Sem autorizacao financeira.';
COMMIT;
