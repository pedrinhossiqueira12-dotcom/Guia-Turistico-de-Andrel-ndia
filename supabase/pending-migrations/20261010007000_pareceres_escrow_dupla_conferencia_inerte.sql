-- Etapa #42: prova de conceito de DUAS CONFERENCIAS DOCUMENTAIS.
-- PARECER NAO E APROVACAO: SEM PERMISSAO DE INSERCAO PARA O BACKEND,
-- SEM ENDPOINT DE APLICACAO, SEM PIX, SEM BAIXA OU LIBERACAO.
-- Apenas PostgreSQL de homologacao/operador DBA pode simular registros.
-- Identidade autenticada e designacao de revisores NAO estao implementadas.
BEGIN;

CREATE TABLE public.catalogo_asaas_escrow_pareceres_preliminares (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 separacao_id uuid NOT NULL
  REFERENCES public.catalogo_asaas_separacoes_excepcionais(id) ON DELETE RESTRICT,
 revisor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 resultado text NOT NULL CHECK(resultado IN(
  'manter_hold','solicitar_documentos','apontar_divergencia')),
 justificativa text NOT NULL CHECK(length(btrim(justificativa)) BETWEEN 40 AND 1200),
 documento_sha256 text CHECK(documento_sha256 IS NULL OR documento_sha256 ~ '^[a-f0-9]{64}$'),
 fingerprint_creditos_sha256 text NOT NULL CHECK(fingerprint_creditos_sha256 ~ '^[a-f0-9]{64}$'),
 dossie_sequencia bigint NOT NULL CHECK(dossie_sequencia>0),
 dossie_hash_sha256 text NOT NULL CHECK(dossie_hash_sha256 ~ '^[a-f0-9]{64}$'),
 matriz_hash_sha256 text NOT NULL CHECK(matriz_hash_sha256 ~ '^[a-f0-9]{64}$'),
 registrado_em timestamptz NOT NULL,
 expira_em timestamptz NOT NULL,
 CHECK(expira_em>registrado_em),
 UNIQUE(separacao_id,revisor_id,dossie_hash_sha256,matriz_hash_sha256)
);

CREATE INDEX catalogo_asaas_pareceres_escrow_por_separacao
 ON public.catalogo_asaas_escrow_pareceres_preliminares(separacao_id,registrado_em);

ALTER TABLE public.catalogo_asaas_escrow_pareceres_preliminares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_asaas_escrow_pareceres_preliminares
 FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.catalogo_asaas_escrow_pareceres_preliminares TO service_role;

-- Defesa de integridade para ensaios PRIVILEGIADOS em banco descartavel.
-- Se no futuro houver endpoint, exigir MFA recente, identidade verificada e
-- autorizacao por papeis gerida fora da tabela de pareceres: NAO EXISTE HOJE.
CREATE FUNCTION catalogo_private.catalogo_asaas_fotografar_parecer_inerte()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $snapshot$
DECLARE
 v_separacao public.catalogo_asaas_separacoes_excepcionais%ROWTYPE;
 v_dossie jsonb;
 v_matriz jsonb;
BEGIN
 IF NEW.separacao_id IS NULL OR NEW.revisor_id IS NULL OR
  NEW.justificativa IS NULL OR
  length(btrim(NEW.justificativa)) NOT BETWEEN 40 AND 1200 OR
  NEW.justificativa ~ '[[:cntrl:]]' THEN
  RAISE EXCEPTION 'Parecer documental incompleto ou invalido' USING ERRCODE='23514';
 END IF;
 NEW.justificativa:=btrim(NEW.justificativa);
 SELECT * INTO v_separacao
 FROM public.catalogo_asaas_separacoes_excepcionais
 WHERE id=NEW.separacao_id;
 IF NOT FOUND OR v_separacao.situacao IS DISTINCT FROM 'congelada' THEN
  RAISE EXCEPTION 'Parecer sem separacao excepcional congelada' USING ERRCODE='23514';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('asaas-saque:'||v_separacao.motoboy_id::text,0)
 );
 SELECT * INTO v_separacao FROM public.catalogo_asaas_separacoes_excepcionais
 WHERE id=NEW.separacao_id FOR UPDATE;
 -- Um autor de evidencias ou o beneficiario nao pode revisar seu proprio caso.
 IF NEW.revisor_id=v_separacao.motoboy_id OR EXISTS(
  SELECT 1 FROM public.catalogo_asaas_escrow_dossie_eventos d
  WHERE d.separacao_id=NEW.separacao_id AND d.autor_id=NEW.revisor_id
 ) THEN
  RAISE EXCEPTION 'Conflito de interesse na revisao documental' USING ERRCODE='23514';
 END IF;
 v_dossie:=public.catalogo_asaas_verificar_integridade_dossie_escrow(NEW.separacao_id);
 v_matriz:=public.catalogo_asaas_matriz_conciliacao_escrow(NEW.separacao_id);
 IF v_dossie->>'integridade_valida' IS DISTINCT FROM 'true'
  OR coalesce((v_dossie->>'numero_eventos')::bigint,0)<1
  OR v_dossie->>'hash_final_registrado_sha256' IS NULL
  OR v_matriz->>'ok' IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'Parecer sem versao de evidencia integra' USING ERRCODE='23514';
 END IF;

 -- NUNCA aceitar fotos/hora apresentadas pelo cliente. O banco fixa os campos.
 NEW.fingerprint_creditos_sha256:=v_separacao.fingerprint_sha256;
 NEW.dossie_sequencia:=(v_dossie->>'numero_eventos')::bigint;
 NEW.dossie_hash_sha256:=v_dossie->>'hash_final_registrado_sha256';
 NEW.matriz_hash_sha256:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
  v_matriz::text,'UTF8')),'hex');
 NEW.registrado_em:=pg_catalog.clock_timestamp();
 NEW.expira_em:=NEW.registrado_em+interval '24 hours';
 RETURN NEW;
END $snapshot$;

REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_fotografar_parecer_inerte()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER catalogo_asaas_fotografar_parecer_inerte
 BEFORE INSERT ON public.catalogo_asaas_escrow_pareceres_preliminares
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_fotografar_parecer_inerte();

CREATE FUNCTION catalogo_private.catalogo_asaas_parecer_inerte_imutavel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $immutable$
BEGIN
 RAISE EXCEPTION 'Parecer preliminar e append-only; sem UPDATE/DELETE'
  USING ERRCODE='23514';
END $immutable$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_parecer_inerte_imutavel()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER catalogo_asaas_parecer_inerte_imutavel
 BEFORE UPDATE OR DELETE ON public.catalogo_asaas_escrow_pareceres_preliminares
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_parecer_inerte_imutavel();

-- Diagnostico somente leitura. Dois pareceres nao sao autorizacoes.
-- Uma nova evidencia invalida a correspondencia dos pareceres anteriores;
-- o registro antigo permanece para auditoria (nao e apagado).
CREATE FUNCTION public.catalogo_asaas_diagnosticar_dupla_conferencia_inerte(
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
  count(*) FILTER(WHERE p.expira_em>now()
   AND p.fingerprint_creditos_sha256=v_e.fingerprint_sha256
   AND p.dossie_sequencia=v_seq AND p.dossie_hash_sha256=v_head
   AND p.matriz_hash_sha256=v_mat_hash)::bigint,
  count(DISTINCT p.revisor_id) FILTER(WHERE p.expira_em>now()
   AND p.fingerprint_creditos_sha256=v_e.fingerprint_sha256
   AND p.dossie_sequencia=v_seq AND p.dossie_hash_sha256=v_head
   AND p.matriz_hash_sha256=v_mat_hash)::bigint,
  count(*) FILTER(WHERE p.resultado='apontar_divergencia'
   AND p.expira_em>now() AND p.dossie_sequencia=v_seq
   AND p.dossie_hash_sha256=v_head AND p.matriz_hash_sha256=v_mat_hash)::bigint
 INTO v_total,v_validos,v_revisores,v_divergencias
 FROM public.catalogo_asaas_escrow_pareceres_preliminares p
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
  'dossie_integro_localmente',v_dossie->>'integridade_valida'='true',
  'evidencia_bancaria_externa_suficiente',false,
  'revisores_credenciados_e_autenticados',false,
  'dupla_aprovacao_financeira',false,
  'pagamento_autorizado',false,
  'liberacao_autorizada',false,
  'baixa_realizada',false,
  'movimenta_dinheiro',false,
  'status_operacional','HOLD_OBRIGATORIO',
  'aviso','Pareceres de homologacao nao representam autorizacao financeira nem prova do destino Pix.'
 );
END $diagnostico$;

REVOKE ALL ON FUNCTION public.catalogo_asaas_diagnosticar_dupla_conferencia_inerte(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_diagnosticar_dupla_conferencia_inerte(uuid)
 TO service_role;
COMMENT ON TABLE public.catalogo_asaas_escrow_pareceres_preliminares IS
 'Protótipo forense sem capacidade de escrita pelo backend. Parecer nao aprova ou paga Pix.';
COMMIT;
