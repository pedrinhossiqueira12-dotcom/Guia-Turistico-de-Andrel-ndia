-- #42 | Filtro de identidade/atribuições de revisores, somente CI descartavel.
-- NENHUMA autenticacao criptografica GoTrue, MFA real, credenciamento formal,
-- parecer financeiro, pagamento ou transferencia. Nao e uma migration.
DO $guard$
BEGIN
 IF pg_catalog.current_database() IS DISTINCT FROM 'catalogo_asaas_race_ci'
 OR pg_catalog.current_setting('app.catalogo_ci_revisores_test',true)
    IS DISTINCT FROM 'enabled'
 OR session_user IS DISTINCT FROM 'postgres'
 THEN RAISE EXCEPTION 'Revisores sintéticos somente no clone CI'
  USING ERRCODE='23514';
 END IF;
END $guard$;

CREATE SCHEMA catalogo_ci_revisores_inertes;
REVOKE ALL ON SCHEMA catalogo_ci_revisores_inertes
 FROM PUBLIC,anon,authenticated,service_role;

-- Atribuicoes ficticias/locais: NAO correspondem a cargo de administracao.
CREATE TABLE catalogo_ci_revisores_inertes.credenciais_ci(
 revisor_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
 papel text NOT NULL CHECK (papel IN ('revisor_escrow','leitor')),
 situacao text NOT NULL CHECK (situacao IN ('habilitado','revogado')),
 valido_ate timestamptz NOT NULL
);
CREATE TABLE catalogo_ci_revisores_inertes.sessoes_mock_ci(
 sessao_id uuid PRIMARY KEY,
 revisor_id uuid NOT NULL REFERENCES
  catalogo_ci_revisores_inertes.credenciais_ci(revisor_id) ON DELETE RESTRICT,
 fator_id uuid NOT NULL,
 aal_mock text NOT NULL CHECK (aal_mock IN ('aal1','aal2')),
 fator_estado_mock text NOT NULL CHECK (
  fator_estado_mock IN ('verified','unverified','revoked')),
 ultimo_desafio_mock_em timestamptz,
 expira_em timestamptz NOT NULL,
 revogada_em timestamptz,
 UNIQUE(sessao_id,revisor_id)
);
-- Cada revisor registra no maximo uma opiniao sobre uma versao de reserva.
-- Esses pareceres nao sao assinados, autenticados ou autorizacoes de pagamento.
CREATE TABLE catalogo_ci_revisores_inertes.pareceres_mock_ci(
 id uuid PRIMARY KEY,
 separacao_id uuid NOT NULL REFERENCES
  public.catalogo_asaas_separacoes_excepcionais(id) ON DELETE RESTRICT,
 revisor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 sessao_id uuid NOT NULL,
 fingerprint_creditos_sha256 text NOT NULL
  CHECK (fingerprint_creditos_sha256 ~ '^[a-f0-9]{64}$'),
 resultado text NOT NULL CHECK (
  resultado IN ('manter_hold','solicitar_documentos','apontar_divergencia')),
 expira_em timestamptz NOT NULL,
 UNIQUE(separacao_id,revisor_id),
 FOREIGN KEY(sessao_id,revisor_id)
  REFERENCES catalogo_ci_revisores_inertes.sessoes_mock_ci(sessao_id,revisor_id)
  ON DELETE RESTRICT
);
ALTER TABLE catalogo_ci_revisores_inertes.credenciais_ci ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogo_ci_revisores_inertes.sessoes_mock_ci ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogo_ci_revisores_inertes.pareceres_mock_ci ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA catalogo_ci_revisores_inertes
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION catalogo_ci_revisores_inertes.diagnosticar_elegibilidade_mock(
 p_separacao uuid,p_dados_cliente jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $revisores$
DECLARE
 v_titular uuid;
 v_escrow public.catalogo_asaas_separacoes_excepcionais%ROWTYPE;
 v_total bigint:=0;
 v_validos bigint:=0;
 v_distintos bigint:=0;
 v_conflictos bigint:=0;
BEGIN
 IF p_separacao IS NULL THEN
  RETURN pg_catalog.jsonb_build_object(
   'ok',false,'motivo','separacao_ausente',
   'status_operacional','HOLD_OBRIGATORIO',
   'duas_credenciais_sinteticas_elegiveis',false,
   'mfa_real_validado',false,'dupla_aprovacao_financeira',false,
   'pagamento_autorizado',false,'liberacao_autorizada',false,
   'baixa_realizada',false,'movimenta_dinheiro',false);
 END IF;
 SELECT motoboy_id INTO v_titular
 FROM public.catalogo_asaas_separacoes_excepcionais WHERE id=p_separacao;
 IF v_titular IS NULL THEN
  RETURN pg_catalog.jsonb_build_object(
   'ok',false,'motivo','separacao_inexistente',
   'status_operacional','HOLD_OBRIGATORIO',
   'duas_credenciais_sinteticas_elegiveis',false,
   'mfa_real_validado',false,'dupla_aprovacao_financeira',false,
   'pagamento_autorizado',false,'liberacao_autorizada',false,
   'baixa_realizada',false,'movimenta_dinheiro',false);
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('asaas-saque:'||v_titular::text,0));
 SELECT * INTO v_escrow
 FROM public.catalogo_asaas_separacoes_excepcionais
 WHERE id=p_separacao FOR UPDATE;
 IF NOT FOUND OR v_escrow.situacao IS DISTINCT FROM 'congelada' THEN
  RETURN pg_catalog.jsonb_build_object(
   'ok',false,'motivo','escrow_nao_congelado',
   'status_operacional','HOLD_OBRIGATORIO',
   'duas_credenciais_sinteticas_elegiveis',false,
   'mfa_real_validado',false,'dupla_aprovacao_financeira',false,
   'pagamento_autorizado',false,'liberacao_autorizada',false,
   'baixa_realizada',false,'movimenta_dinheiro',false);
 END IF;

 -- Fonte unica de atributos e MOCK LOCAL, nunca p_dados_cliente.
 -- CTE materializada adquire FOR SHARE sobre as credenciais/sessoes.
 -- Revogacoes/expiracoes tornam imediatamente invalido o diagnostico.
 WITH candidatos AS MATERIALIZED (
  SELECT p.revisor_id,p.sessao_id,p.fingerprint_creditos_sha256,
   p.expira_em AS parecer_expira,
   p.resultado,c.papel,c.situacao,c.valido_ate,
   s.aal_mock,s.fator_estado_mock,s.ultimo_desafio_mock_em,
   s.expira_em AS sessao_expira,s.revogada_em
  FROM catalogo_ci_revisores_inertes.pareceres_mock_ci p
  JOIN catalogo_ci_revisores_inertes.credenciais_ci c
   ON c.revisor_id=p.revisor_id
  JOIN catalogo_ci_revisores_inertes.sessoes_mock_ci s
   ON s.sessao_id=p.sessao_id AND s.revisor_id=p.revisor_id
  WHERE p.separacao_id=p_separacao
  ORDER BY p.revisor_id,p.sessao_id
  FOR SHARE OF p,c,s
 ), classificados AS (
  SELECT reviewer.revisor_id,
  (
   reviewer.revisor_id IS DISTINCT FROM v_titular
   AND reviewer.papel='revisor_escrow'
   AND reviewer.situacao='habilitado'
   AND reviewer.valido_ate>pg_catalog.clock_timestamp()
   AND reviewer.parecer_expira>pg_catalog.clock_timestamp()
   AND reviewer.fingerprint_creditos_sha256=v_escrow.fingerprint_sha256
   AND reviewer.aal_mock='aal2'
   AND reviewer.fator_estado_mock='verified'
   AND reviewer.sessao_expira>pg_catalog.clock_timestamp()
   AND reviewer.revogada_em IS NULL
   AND reviewer.ultimo_desafio_mock_em IS NOT NULL
   AND reviewer.ultimo_desafio_mock_em<=pg_catalog.clock_timestamp()
   AND reviewer.ultimo_desafio_mock_em >
    pg_catalog.clock_timestamp()-interval '5 minutes'
   AND NOT EXISTS (
    SELECT 1 FROM public.catalogo_asaas_escrow_dossie_eventos d
    WHERE d.separacao_id=p_separacao AND d.autor_id=reviewer.revisor_id
   )
  ) AS elegivel
  FROM candidatos reviewer
 )
 SELECT count(*)::bigint,
  count(*) FILTER (WHERE elegivel)::bigint,
  count(DISTINCT revisor_id) FILTER (WHERE elegivel)::bigint,
  count(*) FILTER (WHERE NOT elegivel)::bigint
 INTO v_total,v_validos,v_distintos,v_conflictos
 FROM classificados;
 RETURN pg_catalog.jsonb_build_object(
  'ok',true,
  'pareceres_mock_encontrados',v_total,
  'pareceres_mock_elegiveis',v_validos,
  'revisores_mock_distintos',v_distintos,
  'pareceres_mock_recusados',v_conflictos,
  'duas_credenciais_sinteticas_elegiveis',v_distintos>=2,
  -- AAL2/fator aqui SAO CAMPOS DE TESTE, nao sessao GoTrue verificada.
  'mfa_real_validado',false,
  'credenciamento_formal_confirmado',false,
  'dupla_aprovacao_financeira',false,
  'status_operacional','HOLD_OBRIGATORIO',
  'pagamento_autorizado',false,'liberacao_autorizada',false,
  'baixa_realizada',false,'movimenta_dinheiro',false
 );
END
$revisores$;
REVOKE ALL ON FUNCTION
 catalogo_ci_revisores_inertes.diagnosticar_elegibilidade_mock(uuid,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
-- Nunca conceder GRANT ou criar papel de login/API neste schema.
