-- Etapa #42: prototipo INERTE de intencao de consulta documental.
-- Um nonce associa revisor + sessao Auth + separacao + versao do dossie.
-- Nao prova MFA step-up na sessao, nao grava parecer, NAO AUTORIZA PIX.
-- Sem EXECUTE de funcoes de escrita por anon/authenticated/service_role.
-- Apenas ensaio como PostgreSQL owner em banco CI com ROLLBACK.
BEGIN;

CREATE TABLE public.catalogo_asaas_intencoes_mfa_documentais_ensaio (
 nonce uuid PRIMARY KEY,
 separacao_id uuid NOT NULL
  REFERENCES public.catalogo_asaas_separacoes_excepcionais(id) ON DELETE RESTRICT,
 revisor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 sessao_id uuid NOT NULL,
 finalidade text NOT NULL CHECK(finalidade='consulta_documental_ensaio'),
 fingerprint_creditos_sha256 text NOT NULL CHECK(fingerprint_creditos_sha256 ~ '^[a-f0-9]{64}$'),
 dossie_seq bigint NOT NULL CHECK(dossie_seq>0),
 dossie_hash_sha256 text NOT NULL CHECK(dossie_hash_sha256 ~ '^[a-f0-9]{64}$'),
 matriz_hash_sha256 text NOT NULL CHECK(matriz_hash_sha256 ~ '^[a-f0-9]{64}$'),
 gerado_em timestamptz NOT NULL,
 expira_em timestamptz NOT NULL,
 CHECK(expira_em>gerado_em),
 UNIQUE(nonce,revisor_id,sessao_id,separacao_id)
);
CREATE INDEX catalogo_asaas_intencoes_mfa_doc_separacao_idx
 ON public.catalogo_asaas_intencoes_mfa_documentais_ensaio(separacao_id,gerado_em);

-- Uso do nonce significa SOMENTE que a intencao documental foi observada.
-- Nao significa que o revisor fez MFA recente, aprovou ou movimentou reais.
CREATE TABLE public.catalogo_asaas_usos_nonce_documentais_ensaio (
 nonce uuid PRIMARY KEY
  REFERENCES public.catalogo_asaas_intencoes_mfa_documentais_ensaio(nonce)
   ON DELETE RESTRICT,
 observado_em timestamptz NOT NULL,
 resultado text NOT NULL CHECK(resultado='vinculo_documental_observado')
);

ALTER TABLE public.catalogo_asaas_intencoes_mfa_documentais_ensaio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_asaas_usos_nonce_documentais_ensaio ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_asaas_intencoes_mfa_documentais_ensaio
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.catalogo_asaas_usos_nonce_documentais_ensaio
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION catalogo_private.catalogo_asaas_nonce_doc_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $immutable$
BEGIN
 RAISE EXCEPTION 'Intencoes e usos documentais sao append-only'
  USING ERRCODE='23514';
END $immutable$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_nonce_doc_append_only()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER catalogo_asaas_intencao_doc_append_only
 BEFORE UPDATE OR DELETE ON public.catalogo_asaas_intencoes_mfa_documentais_ensaio
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_nonce_doc_append_only();
CREATE TRIGGER catalogo_asaas_uso_nonce_doc_append_only
 BEFORE UPDATE OR DELETE ON public.catalogo_asaas_usos_nonce_documentais_ensaio
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_nonce_doc_append_only();

CREATE FUNCTION catalogo_private.catalogo_asaas_iniciar_intencao_mfa_documental_ensaio(
 p_separacao uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $intent$
DECLARE
 v_preflight jsonb;
 v_e public.catalogo_asaas_separacoes_excepcionais%ROWTYPE;
 v_dossie jsonb;
 v_matriz jsonb;
 v_financeiro jsonb;
 v_uid uuid;
 v_sid uuid;
 v_nonce uuid;
 v_seq bigint;
 v_head text;
 v_mat_hash text;
 v_hora timestamptz;
BEGIN
 -- Nao chamar via Data API. Este SECURITY DEFINER NAO concede EXECUTE
 -- a usuarios, service_role nem anon. Testes usam somente PostgreSQL owner.
 v_preflight:=public.catalogo_asaas_preflight_sessao_revisor_inerte();
 IF v_preflight->>'sessao_aal2_confirmada' IS DISTINCT FROM 'true'
  OR v_preflight->>'indicacao_ensaio_vigente' IS DISTINCT FROM 'true'
  OR v_preflight->>'jwt_recente_confirmado' IS DISTINCT FROM 'true' THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,
   'motivo','identidade_ou_sessao_inadequada',
   'pagamento_autorizado',false,'status_operacional','HOLD_OBRIGATORIO');
 END IF;

 v_uid:=auth.uid();
 v_sid:=(auth.jwt()->>'session_id')::uuid;
 SELECT * INTO v_e FROM public.catalogo_asaas_separacoes_excepcionais
 WHERE id=p_separacao;
 IF NOT FOUND OR v_e.situacao IS DISTINCT FROM 'congelada'
  OR v_e.motoboy_id=v_uid THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','escrow_ou_conflito_invalido',
   'pagamento_autorizado',false,'status_operacional','HOLD_OBRIGATORIO');
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('asaas-saque:'||v_e.motoboy_id::text,0)
 );
 SELECT * INTO v_e FROM public.catalogo_asaas_separacoes_excepcionais
 WHERE id=p_separacao FOR UPDATE;
 IF v_e.situacao IS DISTINCT FROM 'congelada' THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','escrow_nao_congelado',
   'pagamento_autorizado',false,'status_operacional','HOLD_OBRIGATORIO');
 END IF;

 IF EXISTS(
  SELECT 1 FROM public.catalogo_asaas_escrow_dossie_eventos d
  WHERE d.separacao_id=p_separacao AND d.autor_id=v_uid
 ) OR EXISTS(
  SELECT 1 FROM public.catalogo_asaas_separacoes_excepcionais_itens i
  JOIN public.catalogo_remuneracoes_v2 r ON r.id=i.remuneracao_id
  JOIN public.catalogos c ON c.comercio_id=r.comercio_id
  WHERE i.separacao_id=p_separacao AND c.proprietario_id=v_uid
 ) THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','conflito_de_interesses',
   'pagamento_autorizado',false,'status_operacional','HOLD_OBRIGATORIO');
 END IF;
 v_dossie:=public.catalogo_asaas_verificar_integridade_dossie_escrow(p_separacao);
 v_matriz:=public.catalogo_asaas_matriz_conciliacao_escrow(p_separacao);
 v_financeiro:=public.catalogo_asaas_diagnosticar_separacao_excepcional(p_separacao);
 IF v_dossie->>'integridade_valida' IS DISTINCT FROM 'true'
  OR coalesce((v_dossie->>'numero_eventos')::bigint,0)<1
  OR v_dossie->>'hash_final_registrado_sha256' IS NULL
  OR v_matriz->>'ok' IS DISTINCT FROM 'true'
  OR v_financeiro->>'composicao_inalterada_e_financiada' IS DISTINCT FROM 'true'
 THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','evidencia_ou_creditos_invalidos',
   'pagamento_autorizado',false,'status_operacional','HOLD_OBRIGATORIO');
 END IF;

 v_seq:=(v_dossie->>'numero_eventos')::bigint;
 v_head:=v_dossie->>'hash_final_registrado_sha256';
 v_mat_hash:=pg_catalog.encode(pg_catalog.sha256(
  pg_catalog.convert_to(v_matriz::text,'UTF8')),'hex');
 v_nonce:=pg_catalog.gen_random_uuid();  -- nunca receber nonce escolhido pelo cliente
 v_hora:=pg_catalog.clock_timestamp();
 INSERT INTO public.catalogo_asaas_intencoes_mfa_documentais_ensaio(
  nonce,separacao_id,revisor_id,sessao_id,finalidade,fingerprint_creditos_sha256,
  dossie_seq,dossie_hash_sha256,matriz_hash_sha256,gerado_em,expira_em
 ) VALUES(
  v_nonce,p_separacao,v_uid,v_sid,'consulta_documental_ensaio',
  v_e.fingerprint_sha256,v_seq,v_head,v_mat_hash,v_hora,v_hora+interval '5 minutes'
 );
 RETURN pg_catalog.jsonb_build_object(
  'ok',true,'nonce',v_nonce,'expira_em',v_hora+interval '5 minutes',
  'somente_intencao_documental',true,'desafio_mfa_da_sessao_comprovado',false,
  'pode_registrar_parecer',false,'pagamento_autorizado',false,
  'liberacao_autorizada',false,'baixa_realizada',false,
  'status_operacional','HOLD_OBRIGATORIO');
END $intent$;
REVOKE ALL ON FUNCTION
 catalogo_private.catalogo_asaas_iniciar_intencao_mfa_documental_ensaio(uuid)
 FROM PUBLIC,anon,authenticated,service_role;

-- Unico uso puramente documental do nonce. Trava FOR UPDATE no header,
-- revalida identidade, versao de creditos/evidencias e expiracao antes
-- de adicionar um evento. Funcao nao concede qualquer autorizacao.
CREATE FUNCTION catalogo_private.catalogo_asaas_observar_nonce_documental_ensaio(
 p_nonce uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $observe$
DECLARE
 v_i public.catalogo_asaas_intencoes_mfa_documentais_ensaio%ROWTYPE;
 v_preflight jsonb;
 v_dossie jsonb;
 v_matriz jsonb;
 v_financeiro jsonb;
 v_e public.catalogo_asaas_separacoes_excepcionais%ROWTYPE;
 v_hash text;
BEGIN
 IF p_nonce IS NULL THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','nonce_ausente',
   'pagamento_autorizado',false,'status_operacional','HOLD_OBRIGATORIO');
 END IF;
 SELECT * INTO v_i FROM public.catalogo_asaas_intencoes_mfa_documentais_ensaio
 WHERE nonce=p_nonce FOR UPDATE;
 IF NOT FOUND THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','nonce_desconhecido',
   'pagamento_autorizado',false,'status_operacional','HOLD_OBRIGATORIO');
 END IF;
 IF EXISTS(
  SELECT 1 FROM public.catalogo_asaas_usos_nonce_documentais_ensaio
  WHERE nonce=p_nonce
 ) THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','nonce_ja_observado',
   'pagamento_autorizado',false,'status_operacional','HOLD_OBRIGATORIO');
 END IF;
 v_preflight:=public.catalogo_asaas_preflight_sessao_revisor_inerte();
 IF v_preflight->>'sessao_aal2_confirmada' IS DISTINCT FROM 'true'
  OR v_preflight->>'indicacao_ensaio_vigente' IS DISTINCT FROM 'true'
  OR v_preflight->>'jwt_recente_confirmado' IS DISTINCT FROM 'true'
  OR v_i.revisor_id IS DISTINCT FROM auth.uid()
  OR v_i.sessao_id::text IS DISTINCT FROM auth.jwt()->>'session_id'
 THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','sessao_ou_revisor_divergente',
   'pagamento_autorizado',false,'status_operacional','HOLD_OBRIGATORIO');
 END IF;
 IF v_i.expira_em<=pg_catalog.clock_timestamp() THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','nonce_expirado',
   'pagamento_autorizado',false,'status_operacional','HOLD_OBRIGATORIO');
 END IF;
 -- O nonce e travado para recusar replay; este ensaio NAO
 -- marca pagamento nem possui operacao bancaria. Financeiro e reavaliado
 -- a cada tentativa, independentemente do snapshot da intencao.
 SELECT * INTO v_e FROM public.catalogo_asaas_separacoes_excepcionais
 WHERE id=v_i.separacao_id;
 IF NOT FOUND THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','escrow_ausente',
   'pagamento_autorizado',false,'status_operacional','HOLD_OBRIGATORIO');
 END IF;
 v_dossie:=public.catalogo_asaas_verificar_integridade_dossie_escrow(v_i.separacao_id);
 v_matriz:=public.catalogo_asaas_matriz_conciliacao_escrow(v_i.separacao_id);
 v_financeiro:=public.catalogo_asaas_diagnosticar_separacao_excepcional(v_i.separacao_id);
 v_hash:=pg_catalog.encode(pg_catalog.sha256(
  pg_catalog.convert_to(v_matriz::text,'UTF8')),'hex');
 IF v_e.situacao IS DISTINCT FROM 'congelada'
  OR v_financeiro->>'composicao_inalterada_e_financiada' IS DISTINCT FROM 'true'
  OR v_e.fingerprint_sha256 IS DISTINCT FROM v_i.fingerprint_creditos_sha256
  OR v_dossie->>'integridade_valida' IS DISTINCT FROM 'true'
  OR coalesce((v_dossie->>'numero_eventos')::bigint,0) IS DISTINCT FROM v_i.dossie_seq
  OR v_dossie->>'hash_final_registrado_sha256' IS DISTINCT FROM v_i.dossie_hash_sha256
  OR v_hash IS DISTINCT FROM v_i.matriz_hash_sha256 THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','versao_evidencia_divergente',
   'pagamento_autorizado',false,'status_operacional','HOLD_OBRIGATORIO');
 END IF;
 INSERT INTO public.catalogo_asaas_usos_nonce_documentais_ensaio(nonce,observado_em,resultado)
 VALUES(p_nonce,pg_catalog.clock_timestamp(),'vinculo_documental_observado');
 RETURN pg_catalog.jsonb_build_object(
  'ok',true,'nonce_observado_uma_vez',true,'desafio_mfa_da_sessao_comprovado',false,
  'pode_registrar_parecer',false,'pagamento_autorizado',false,
  'liberacao_autorizada',false,'baixa_realizada',false,
  'status_operacional','HOLD_OBRIGATORIO');
END $observe$;
REVOKE ALL ON FUNCTION
 catalogo_private.catalogo_asaas_observar_nonce_documental_ensaio(uuid)
 FROM PUBLIC,anon,authenticated,service_role;

COMMENT ON TABLE public.catalogo_asaas_intencoes_mfa_documentais_ensaio IS
 'Nonce de ensaio vinculado a sessao e evidencias; nao comprova MFA step-up da propria sessao.';
COMMENT ON TABLE public.catalogo_asaas_usos_nonce_documentais_ensaio IS
 'Observacao unica de nonce, sem autorizacao financeira. Nao permite Pix ou baixa.';
COMMIT;
