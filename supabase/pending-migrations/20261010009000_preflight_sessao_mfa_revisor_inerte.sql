-- #42 - preflight somente LEITURA da sessao do proprio revisor.
-- Mesmo JWT recente AAL2 NAO comprova recencia do desafio MFA.
-- Nenhum endpoint de aprovacao, nenhuma baixa, Pix ou liberacao financeira.
BEGIN;

CREATE FUNCTION public.catalogo_asaas_preflight_sessao_revisor_inerte()
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
  'aviso','JWT aal2 e sessao ativa nao comprovam momento do desafio MFA. Preflight nao autentica um aprovador nem autoriza Pix.'
 );
END $self_check$;

REVOKE ALL ON FUNCTION public.catalogo_asaas_preflight_sessao_revisor_inerte()
 FROM PUBLIC,anon,authenticated,service_role;
-- Contrato autoconsulta: sem parametro revisor_id que possa ser forjado.
-- Nao expor a anon/service_role; a resposta nao contem dados de terceiros.
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_preflight_sessao_revisor_inerte()
 TO authenticated;
COMMENT ON FUNCTION public.catalogo_asaas_preflight_sessao_revisor_inerte() IS
 'Autoconsulta de MFA AAL2 e sessao Auth. Sem autoridade financeira ou prova de step-up recente.';
COMMIT;
