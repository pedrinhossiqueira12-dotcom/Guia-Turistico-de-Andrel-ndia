-- #42: revisor de ensaio/revogacao. NAO HA credenciamento REAL ou MFA.
-- Nenhum revisor recebe poder de autorizacao financeira. Sem writes pela Edge.
-- Nenhum Pix/baixa/liberacao. Schema aplicado em STAGING depois de testes.
BEGIN;

CREATE TABLE public.catalogo_asaas_revisores_escrow_ensaio (
 revisor_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
 indicado_por uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 justificativa text NOT NULL CHECK(length(btrim(justificativa)) BETWEEN 40 AND 600),
 instrumento_sha256 text NOT NULL CHECK(instrumento_sha256 ~ '^[a-f0-9]{64}$'),
 cadastrado_em timestamptz NOT NULL,
 valido_ate timestamptz NOT NULL,
 CHECK(indicado_por<>revisor_id),
 CHECK(valido_ate>cadastrado_em)
);
CREATE TABLE public.catalogo_asaas_revisores_escrow_revogacoes_ensaio (
 revisor_id uuid PRIMARY KEY REFERENCES public.catalogo_asaas_revisores_escrow_ensaio(revisor_id)
  ON DELETE RESTRICT,
 revogado_por uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 motivo text NOT NULL CHECK(length(btrim(motivo)) BETWEEN 40 AND 600),
 revogado_em timestamptz NOT NULL,
 CHECK(revisor_id<>revogado_por)
);
ALTER TABLE public.catalogo_asaas_revisores_escrow_ensaio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_asaas_revisores_escrow_revogacoes_ensaio ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_asaas_revisores_escrow_ensaio
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.catalogo_asaas_revisores_escrow_revogacoes_ensaio
 FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.catalogo_asaas_revisores_escrow_ensaio TO service_role;
GRANT SELECT ON public.catalogo_asaas_revisores_escrow_revogacoes_ensaio TO service_role;

-- Apenas PostgreSQL OWNER (massa ficticia transacional em CI) tem INSERT.
-- O servidor fixa o horario/validade e bloqueia identidade autopatrocinada.
CREATE FUNCTION catalogo_private.catalogo_asaas_fixar_revisor_ensaio()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $guard$
BEGIN
 IF NEW.revisor_id IS NULL OR NEW.indicado_por IS NULL
  OR NEW.revisor_id=NEW.indicado_por OR NEW.justificativa IS NULL
  OR length(btrim(NEW.justificativa)) NOT BETWEEN 40 AND 600
  OR NEW.justificativa ~ '[[:cntrl:]]' THEN
  RAISE EXCEPTION 'Indicacao de revisor de laboratorio invalida' USING ERRCODE='23514';
 END IF;
 NEW.justificativa:=btrim(NEW.justificativa);
 NEW.cadastrado_em:=pg_catalog.clock_timestamp();
 NEW.valido_ate:=NEW.cadastrado_em+interval '7 days';
 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_fixar_revisor_ensaio()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER catalogo_asaas_fixar_revisor_ensaio
 BEFORE INSERT ON public.catalogo_asaas_revisores_escrow_ensaio
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_fixar_revisor_ensaio();

CREATE FUNCTION catalogo_private.catalogo_asaas_revogar_revisor_ensaio()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $guard$
BEGIN
 IF NEW.revisor_id IS NULL OR NEW.revogado_por IS NULL
  OR NEW.revisor_id=NEW.revogado_por OR NEW.motivo IS NULL
  OR length(btrim(NEW.motivo)) NOT BETWEEN 40 AND 600
  OR NEW.motivo ~ '[[:cntrl:]]' THEN
  RAISE EXCEPTION 'Revogacao de revisor de laboratorio invalida' USING ERRCODE='23514';
 END IF;
 -- Mesma linha bloqueada por review antes de snapshot; evita registrar
 -- parecer pendente quando a revogacao venceu a disputa pelo lock.
 PERFORM 1 FROM public.catalogo_asaas_revisores_escrow_ensaio r
 WHERE r.revisor_id=NEW.revisor_id FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Revogacao sem revisor de laboratorio' USING ERRCODE='23514';
 END IF;
 NEW.motivo:=btrim(NEW.motivo);
 NEW.revogado_em:=pg_catalog.clock_timestamp();
 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_revogar_revisor_ensaio()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER catalogo_asaas_revogar_revisor_ensaio
 BEFORE INSERT ON public.catalogo_asaas_revisores_escrow_revogacoes_ensaio
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_revogar_revisor_ensaio();

CREATE FUNCTION catalogo_private.catalogo_asaas_registro_revisor_ensaio_imutavel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $immutable$
BEGIN
 RAISE EXCEPTION 'Registro de revisor e revogacao sao append-only'
  USING ERRCODE='23514';
END $immutable$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_registro_revisor_ensaio_imutavel()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER catalogo_asaas_revisor_ensaio_imutavel
 BEFORE UPDATE OR DELETE ON public.catalogo_asaas_revisores_escrow_ensaio
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_registro_revisor_ensaio_imutavel();
CREATE TRIGGER catalogo_asaas_revogacao_ensaio_imutavel
 BEFORE UPDATE OR DELETE ON public.catalogo_asaas_revisores_escrow_revogacoes_ensaio
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_registro_revisor_ensaio_imutavel();

-- Trigger zz: a fotografia e tirada ANTES pelo trigger ja instalado,
-- mas a insercao do parecer exige que o revisor conste da lista limitada
-- e nao tenha sido revogado. Banco assume responsabilidade pelo lock.
CREATE FUNCTION catalogo_private.catalogo_asaas_parecer_exigir_revisor_ensaio()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $guard$
DECLARE
 v_validade timestamptz;
BEGIN
 SELECT r.valido_ate INTO v_validade
 FROM public.catalogo_asaas_revisores_escrow_ensaio r
 WHERE r.revisor_id=NEW.revisor_id
 FOR UPDATE;
 IF v_validade IS NULL OR v_validade<=pg_catalog.clock_timestamp() OR EXISTS (
   SELECT 1 FROM public.catalogo_asaas_revisores_escrow_revogacoes_ensaio x
   WHERE x.revisor_id=NEW.revisor_id
 ) THEN
  RAISE EXCEPTION 'Revisor nao esta vigente para ensaio documental'
   USING ERRCODE='23514';
 END IF;
 -- Proibir parecer do proprietario de QUALQUER comercio presente
 -- nos itens financiadores desta mesma separacao excepcional.
 IF EXISTS (
  SELECT 1
  FROM public.catalogo_asaas_separacoes_excepcionais_itens i
  JOIN public.catalogo_remuneracoes_v2 r ON r.id=i.remuneracao_id
  JOIN public.catalogos c ON c.comercio_id=r.comercio_id
  WHERE i.separacao_id=NEW.separacao_id AND c.proprietario_id=NEW.revisor_id
 ) THEN
  RAISE EXCEPTION 'Proprietario do comercio envolvido nao pode revisar propria operacao'
   USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_parecer_exigir_revisor_ensaio()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zz_catalogo_asaas_parecer_exigir_revisor_ensaio
 BEFORE INSERT ON public.catalogo_asaas_escrow_pareceres_preliminares
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_parecer_exigir_revisor_ensaio();

-- Atualizacao INCREMENTAL da leitura (#42), nao altera o histórico.
-- Revisor retirado, revogado ou com prazo vencido deixa de compor quorum.
-- Mesmo 2 revisores de laboratorio NAO SAO MFA nem aprovacao financeira.
CREATE OR REPLACE FUNCTION public.catalogo_asaas_diagnosticar_dupla_conferencia_inerte(
 p_separacao uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $diagnostico$
DECLARE
 v_e public.catalogo_asaas_separacoes_excepcionais%ROWTYPE;
 v_dossie jsonb;
 v_matriz jsonb;
 v_mat_hash text;
 v_head text;
 v_seq bigint;
 v_total bigint;
 v_validos bigint;
 v_revisores bigint;
 v_divergencias bigint;
 v_revogados bigint;
BEGIN
 SELECT * INTO v_e FROM public.catalogo_asaas_separacoes_excepcionais
 WHERE id=p_separacao;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Separacao nao encontrada.',
   'pagamento_autorizado',false,'liberacao_autorizada',false,'baixa_realizada',false);
 END IF;
 v_dossie:=public.catalogo_asaas_verificar_integridade_dossie_escrow(p_separacao);
 v_matriz:=public.catalogo_asaas_matriz_conciliacao_escrow(p_separacao);
 v_head:=v_dossie->>'hash_final_registrado_sha256';
 v_seq:=coalesce((v_dossie->>'numero_eventos')::bigint,0);
 v_mat_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
  v_matriz::text,'UTF8')),'hex');

 SELECT count(*)::bigint,
  count(*) FILTER(WHERE r.revisor_id IS NOT NULL
   AND r.valido_ate>now() AND x.revisor_id IS NULL
   AND p.expira_em>now() AND p.fingerprint_creditos_sha256=v_e.fingerprint_sha256
   AND p.dossie_sequencia=v_seq AND p.dossie_hash_sha256=v_head
   AND p.matriz_hash_sha256=v_mat_hash)::bigint,
  count(DISTINCT p.revisor_id) FILTER(WHERE r.revisor_id IS NOT NULL
   AND r.valido_ate>now() AND x.revisor_id IS NULL
   AND p.expira_em>now() AND p.fingerprint_creditos_sha256=v_e.fingerprint_sha256
   AND p.dossie_sequencia=v_seq AND p.dossie_hash_sha256=v_head
   AND p.matriz_hash_sha256=v_mat_hash)::bigint,
  count(*) FILTER(WHERE p.resultado='apontar_divergencia'
   AND p.expira_em>now() AND p.dossie_sequencia=v_seq
   AND p.dossie_hash_sha256=v_head AND p.matriz_hash_sha256=v_mat_hash)::bigint,
  count(*) FILTER(WHERE x.revisor_id IS NOT NULL)::bigint
 INTO v_total,v_validos,v_revisores,v_divergencias,v_revogados
 FROM public.catalogo_asaas_escrow_pareceres_preliminares p
 LEFT JOIN public.catalogo_asaas_revisores_escrow_ensaio r
  ON r.revisor_id=p.revisor_id
 LEFT JOIN public.catalogo_asaas_revisores_escrow_revogacoes_ensaio x
  ON x.revisor_id=p.revisor_id
 WHERE p.separacao_id=p_separacao;

 RETURN jsonb_build_object(
  'ok',true,'separacao_id',p_separacao,
  'pareceres_historicos',v_total,
  'pareceres_da_versao_ainda_nao_expirados',
    CASE WHEN v_dossie->>'integridade_valida'='true' THEN v_validos ELSE 0 END,
  'revisores_distintos_da_mesma_versao',
    CASE WHEN v_dossie->>'integridade_valida'='true' THEN v_revisores ELSE 0 END,
  'duas_conferencias_documentais_registradas',
    v_dossie->>'integridade_valida'='true' AND v_revisores>=2,
  'divergencias_documentais_da_versao',v_divergencias,
  'pareceres_com_revisor_revogado',v_revogados,
  'dossie_integro_localmente',v_dossie->>'integridade_valida'='true',
  'evidencia_bancaria_externa_suficiente',false,
  'revisores_credenciados_e_autenticados',false,
  'mfa_recente_comprovado',false,
  'dupla_aprovacao_financeira',false,
  'pagamento_autorizado',false,
  'liberacao_autorizada',false,
  'baixa_realizada',false,
  'movimenta_dinheiro',false,
  'status_operacional','HOLD_OBRIGATORIO',
  'aviso','Indicacoes de laboratorio nao representam identidade autenticada, MFA ou autorizacao de Pix.'
 );
END $diagnostico$;

REVOKE ALL ON FUNCTION public.catalogo_asaas_diagnosticar_dupla_conferencia_inerte(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_diagnosticar_dupla_conferencia_inerte(uuid)
 TO service_role;
COMMENT ON TABLE public.catalogo_asaas_revisores_escrow_ensaio IS
 'Pessoas FICTICIAS indicadas em banco de ensaio. Nao contem MFA ou credencial financeira real.';
COMMIT;
