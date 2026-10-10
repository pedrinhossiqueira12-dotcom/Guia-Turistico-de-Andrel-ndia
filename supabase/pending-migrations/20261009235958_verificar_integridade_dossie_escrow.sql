-- Verifica eventos do dossiê no PostgreSQL sem liberar comissões.
-- Checa cadeia do primeiro evento ao último e recusa novos registros
-- se houver adulteração, descontinuidade de sequencia ou hash inválido.
-- Não é uma âncora externa: exclusão do SUFIXO completo pode passar
-- despercebida sem cópia independente periódica do hash final.
BEGIN;
CREATE OR REPLACE FUNCTION public.catalogo_asaas_verificar_integridade_dossie_escrow(
 p_separacao uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $verify$
DECLARE
 v_row public.catalogo_asaas_escrow_dossie_eventos%ROWTYPE;
 v_seq bigint:=1;
 v_total bigint:=0;
 v_prev text:=repeat('0',64);
 v_hash text;
 v_issues text[]:=ARRAY[]::text[];
 v_first_bad bigint;
BEGIN
 IF p_separacao IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.catalogo_asaas_separacoes_excepcionais WHERE id=p_separacao
 ) THEN
  RETURN jsonb_build_object('ok',false,'integridade_valida',false,
   'mensagem','Separacao inexistente.');
 END IF;
 FOR v_row IN SELECT * FROM public.catalogo_asaas_escrow_dossie_eventos
  WHERE separacao_id=p_separacao ORDER BY seq,id LOOP
  v_total:=v_total+1;
  IF v_row.seq IS DISTINCT FROM v_seq THEN
   v_issues:=array_append(v_issues,'sequencia_nao_contigua');
   v_first_bad:=coalesce(v_first_bad,v_row.seq);
  END IF;
  IF v_row.hash_anterior_sha256 IS DISTINCT FROM v_prev THEN
   v_issues:=array_append(v_issues,'hash_anterior_divergente');
   v_first_bad:=coalesce(v_first_bad,v_row.seq);
  END IF;
  v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
   jsonb_build_object(
    'separacao_id',v_row.separacao_id,'seq',v_row.seq,
    'chave_idempotencia',v_row.chave_idempotencia,
    'autor_id',v_row.autor_id,'categoria',v_row.categoria,
    'descricao',v_row.descricao,'documento_sha256',v_row.documento_sha256,
    'criado_em',v_row.criado_em,
    'hash_anterior_sha256',v_row.hash_anterior_sha256
   )::text,'UTF8')),'hex');
  IF v_row.evento_sha256 IS DISTINCT FROM v_hash THEN
   v_issues:=array_append(v_issues,'conteudo_ou_hash_adulterado');
   v_first_bad:=coalesce(v_first_bad,v_row.seq);
  END IF;
  v_seq:=v_row.seq+1;
  v_prev:=v_row.evento_sha256;
 END LOOP;
 RETURN jsonb_build_object('ok',true,
  'separacao_id',p_separacao,
  'integridade_valida',cardinality(v_issues)=0,
  'numero_eventos',v_total,
  'primeira_sequencia_incorreta',v_first_bad,
  'tipos_inconsistencia',to_jsonb(v_issues),
  'hash_final_registrado_sha256',CASE WHEN v_total>0 THEN v_prev ELSE NULL END,
  'sem_ancora_externa',true,
  'pagamento_autorizado',false,'liberacao_autorizada',false,
  'baixa_realizada',false,
  'observacao','Verificacao local de hashes. Nao prova identidade, liquidação bancaria nem inexistencia de eventos suprimidos.');
END $verify$;
REVOKE ALL ON FUNCTION public.catalogo_asaas_verificar_integridade_dossie_escrow(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_verificar_integridade_dossie_escrow(uuid)
 TO service_role;

-- Defender contra atualizações/acertos acidentais mesmo por credenciais
-- técnicas. Somente DB owner com poderes de desligar trigger contorna.
CREATE OR REPLACE FUNCTION catalogo_private.catalogo_asaas_bloquear_mutacao_dossie()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $guard$
BEGIN
 RAISE EXCEPTION 'Evento de dossie e append-only; alteracao ou exclusao proibida.'
 USING ERRCODE='23514';
END $guard$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_bloquear_mutacao_dossie()
 FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS catalogo_asaas_dossie_append_only
 ON public.catalogo_asaas_escrow_dossie_eventos;
CREATE TRIGGER catalogo_asaas_dossie_append_only
 BEFORE UPDATE OR DELETE ON public.catalogo_asaas_escrow_dossie_eventos
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_bloquear_mutacao_dossie();

-- Reinstala append sem modificar regras anteriores e exige log íntegro.
CREATE OR REPLACE FUNCTION public.catalogo_asaas_registrar_evento_dossie_escrow(
 p_separacao uuid,p_autor uuid,p_chave uuid,p_categoria text,
 p_descricao text,p_documento_sha256 text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $event$
DECLARE
 v_escrow public.catalogo_asaas_separacoes_excepcionais%ROWTYPE;
 v_existente public.catalogo_asaas_escrow_dossie_eventos%ROWTYPE;
 v_seq bigint;
 v_prev text;
 v_hash text;
 v_hora timestamptz;
 v_new_id uuid;
 v_descricao text;
BEGIN
 IF p_separacao IS NULL OR p_autor IS NULL OR p_chave IS NULL OR
  p_categoria IS NULL OR p_categoria NOT IN(
    'verificacao_banco','verificacao_destinatario','comprovante_externo',
    'contestacao','divergencia','parecer_pendente'
  ) OR p_descricao IS NULL THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Dados do registro invalidos.');
 END IF;
 v_descricao:=btrim(p_descricao);
 IF length(v_descricao)<30 OR length(v_descricao)>1000 OR
    v_descricao ~ '[[:cntrl:]]' OR
    (p_documento_sha256 IS NOT NULL AND
      p_documento_sha256 !~ '^[a-f0-9]{64}$') OR
    (p_categoria='comprovante_externo' AND p_documento_sha256 IS NULL) THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Justificativa ou SHA-256 invalido.');
 END IF;
 IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=p_autor) THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Autor inexistente.');
 END IF;
 SELECT * INTO v_escrow FROM public.catalogo_asaas_separacoes_excepcionais
 WHERE id=p_separacao;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Separacao inexistente.');
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('asaas-saque:'||v_escrow.motoboy_id::text,0)
 );
 -- A trava do TITULAR e um FOR UPDATE no cabeçalho impedem sequências
 -- concorrentes desordenadas. Chave idempotente evita eventos duplicados.
 SELECT * INTO v_escrow FROM public.catalogo_asaas_separacoes_excepcionais
 WHERE id=p_separacao FOR UPDATE;

 -- Nunca continuar uma trilha adulterada, mesmo em replay idempotente.
 -- Comparacao serializada pela trava e pelo FOR UPDATE do cabeçalho.
 IF NOT (public.catalogo_asaas_verificar_integridade_dossie_escrow(
   p_separacao)->>'integridade_valida')::boolean THEN
  RETURN jsonb_build_object('ok',false,
   'mensagem','Integridade do dossie comprometida. Bloqueada nova escrita.');
 END IF;
 SELECT * INTO v_existente FROM public.catalogo_asaas_escrow_dossie_eventos
 WHERE chave_idempotencia=p_chave;
 IF FOUND THEN
  IF v_existente.separacao_id IS DISTINCT FROM p_separacao
   OR v_existente.autor_id IS DISTINCT FROM p_autor
   OR v_existente.categoria IS DISTINCT FROM p_categoria
   OR v_existente.descricao IS DISTINCT FROM v_descricao
   OR v_existente.documento_sha256 IS DISTINCT FROM p_documento_sha256 THEN
   RETURN jsonb_build_object('ok',false,'mensagem','Chave idempotente usada para outro evento.');
  END IF;
  RETURN jsonb_build_object('ok',true,'repetido',true,'evento_id',v_existente.id,
   'seq',v_existente.seq,'hash_sha256',v_existente.evento_sha256,
   'pagamento_autorizado',false,'baixa_realizada',false,'liberacao_autorizada',false);
 END IF;
 SELECT e.seq,e.evento_sha256 INTO v_seq,v_prev
 FROM public.catalogo_asaas_escrow_dossie_eventos e
 WHERE e.separacao_id=p_separacao ORDER BY e.seq DESC LIMIT 1;
 v_seq:=coalesce(v_seq,0)+1;
 v_prev:=coalesce(v_prev,repeat('0',64));
 v_hora:=pg_catalog.clock_timestamp();
 v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
  jsonb_build_object(
    'separacao_id',p_separacao,'seq',v_seq,'chave_idempotencia',p_chave,
    'autor_id',p_autor,'categoria',p_categoria,'descricao',v_descricao,
    'documento_sha256',p_documento_sha256,'criado_em',v_hora,
    'hash_anterior_sha256',v_prev
  )::text,'UTF8')),'hex');
 INSERT INTO public.catalogo_asaas_escrow_dossie_eventos(
  separacao_id,seq,chave_idempotencia,autor_id,categoria,descricao,
  documento_sha256,hash_anterior_sha256,evento_sha256,criado_em)
 VALUES(p_separacao,v_seq,p_chave,p_autor,p_categoria,v_descricao,
  p_documento_sha256,v_prev,v_hash,v_hora)
 RETURNING id INTO v_new_id;
 RETURN jsonb_build_object('ok',true,'repetido',false,'evento_id',v_new_id,
   'seq',v_seq,'hash_sha256',v_hash,'pagamento_autorizado',false,
   'baixa_realizada',false,'liberacao_autorizada',false);
END $event$;
COMMENT ON FUNCTION public.catalogo_asaas_verificar_integridade_dossie_escrow(uuid) IS
 'Recalcula hash e continuidade, so leitura. Sem ancora externa nem qualquer autorizacao financeira.';
COMMIT;
