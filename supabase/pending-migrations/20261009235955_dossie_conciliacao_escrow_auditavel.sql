-- Dossie append-only de conciliação EXCEPCIONAL, sem dinheiro e sem quitação.
-- Uma anotação/parecer jamais autoriza saque, crédito, liquidação ou liberação.
-- Hash encadeado ajuda a identificar alterações casuais, NÃO é prova externa
-- nem impede que um administrador do PostgreSQL reescreva o próprio histórico.
BEGIN;
CREATE TABLE IF NOT EXISTS public.catalogo_asaas_escrow_dossie_eventos(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 separacao_id uuid NOT NULL REFERENCES public.catalogo_asaas_separacoes_excepcionais(id)
  ON DELETE RESTRICT,
 seq bigint NOT NULL CHECK(seq>0),
 chave_idempotencia uuid NOT NULL UNIQUE,
 autor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 categoria text NOT NULL CHECK(categoria IN(
  'verificacao_banco','verificacao_destinatario','comprovante_externo',
  'contestacao','divergencia','parecer_pendente'
 )),
 descricao text NOT NULL CHECK(length(btrim(descricao)) BETWEEN 30 AND 1000),
 documento_sha256 text
  CHECK(documento_sha256 IS NULL OR documento_sha256 ~ '^[a-f0-9]{64}$'),
 hash_anterior_sha256 text NOT NULL CHECK(hash_anterior_sha256 ~ '^[a-f0-9]{64}$'),
 evento_sha256 text NOT NULL CHECK(evento_sha256 ~ '^[a-f0-9]{64}$'),
 criado_em timestamptz NOT NULL DEFAULT now(),
 UNIQUE(separacao_id,seq),
 CHECK(categoria<>'comprovante_externo' OR documento_sha256 IS NOT NULL)
);
ALTER TABLE public.catalogo_asaas_escrow_dossie_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_asaas_escrow_dossie_eventos
 FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.catalogo_asaas_escrow_dossie_eventos TO service_role;

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
REVOKE ALL ON FUNCTION public.catalogo_asaas_registrar_evento_dossie_escrow(
 uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_registrar_evento_dossie_escrow(
 uuid,uuid,uuid,text,text,text) TO service_role;

COMMENT ON TABLE public.catalogo_asaas_escrow_dossie_eventos IS
 'Historico sequencial de verificacoes administrativas. Hash local NAO prova banco, identidade ou liquidação. Sem liberar, pagar ou excluir credito.';
COMMIT;
