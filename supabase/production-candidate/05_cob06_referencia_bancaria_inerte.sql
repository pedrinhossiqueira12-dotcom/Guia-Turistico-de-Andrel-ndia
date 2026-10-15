-- COB-06 / PR #39: reserva IMUTAVEL de referencia bancária por lote.
-- CANDIDATO ISOLADO: executar somente no PostgreSQL descartavel da CI,
-- após os candidatos 03 (livro) e 04 (conferência de componentes).
-- Nenhuma API Asaas, webhook, baixa, estorno, saque ou direito de POST Pix.
BEGIN;

CREATE TABLE public.catalogo_asaas_acumulo_referencias (
 lote_id uuid PRIMARY KEY
   REFERENCES public.catalogo_asaas_acumulo_lotes(id) ON DELETE RESTRICT,
 comercio_id text NOT NULL
   REFERENCES public.catalogos(comercio_id) ON DELETE RESTRICT,
 referencia text NOT NULL UNIQUE,
 operacao_id uuid NOT NULL UNIQUE DEFAULT pg_catalog.gen_random_uuid(),
 valor_centavos bigint NOT NULL CHECK(valor_centavos>=500 AND valor_centavos<=2147483647),
 estado text NOT NULL DEFAULT 'reservado'
   CHECK(estado IN ('reservado','observado','revisao','concluido')),
 payment_id text UNIQUE,
 -- Trava de seguranca: nem mesmo inserir na tabela permite emitir Pix.
 pode_emitir_pix boolean NOT NULL DEFAULT false CHECK (pode_emitir_pix=false),
 criado_em timestamptz NOT NULL DEFAULT pg_catalog.now(),
 CONSTRAINT catalogo_acumulo_referencia_formato
   CHECK(referencia='guia-acumulo-'||lote_id::text),
 CONSTRAINT catalogo_acumulo_identificador_sem_prova
   CHECK(payment_id IS NULL)
);
-- Enquanto uma emissao bancaria estiver pendente/revisao, a mesma loja
-- nao pode iniciar outra intencao de pagamento de acumulo.
CREATE UNIQUE INDEX catalogo_asaas_acumulo_referencia_loja_pendente
 ON public.catalogo_asaas_acumulo_referencias(comercio_id)
 WHERE estado IN ('reservado','observado','revisao');

-- Depois de reservada, a referencia nao pode ser trocada, apagada
-- nem alterada via qualquer caminho SQL legado ou retry.
CREATE FUNCTION catalogo_private.catalogo_asaas_acumulo_referencia_imutavel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $imutavel$
BEGIN
 RAISE EXCEPTION 'Referencia financeira acumulada imutavel: revisar manualmente'
   USING ERRCODE='23514';
END;
$imutavel$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_acumulo_referencia_imutavel()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER catalogo_asaas_acumulo_referencia_nao_alterar
 BEFORE UPDATE OR DELETE ON public.catalogo_asaas_acumulo_referencias
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_acumulo_referencia_imutavel();

ALTER TABLE public.catalogo_asaas_acumulo_referencias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_asaas_acumulo_referencias
 FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.catalogo_asaas_acumulo_referencias TO service_role;

-- A unica operacao de escrita disponivel ao backend e criar a intencao
-- imutavel e recuperavel. Nao autoriza chamada POST; se o processo cair,
-- devolve sempre a mesma referencia para reconciliacao MANUAL/GET futuro.
CREATE FUNCTION public.catalogo_asaas_reservar_referencia_acumulo(
 p_lote uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $reservar$
DECLARE
 v_lote public.catalogo_asaas_acumulo_lotes%ROWTYPE;
 v_op public.catalogo_asaas_acumulo_referencias%ROWTYPE;
 v_check jsonb;
BEGIN
 IF p_lote IS NULL THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','lote_invalido');
 END IF;

 SELECT * INTO v_lote FROM public.catalogo_asaas_acumulo_lotes
 WHERE id=p_lote FOR UPDATE;
 IF NOT FOUND THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','lote_inexistente');
 END IF;
 -- A trava transacional do mesmo comercio protege contra lotes paralelos.
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('catalogo-acumulo-banco:'||v_lote.comercio_id,0));

 SELECT * INTO v_op FROM public.catalogo_asaas_acumulo_referencias
 WHERE lote_id=p_lote FOR UPDATE;
 IF FOUND THEN
   RETURN pg_catalog.jsonb_build_object(
     'ok',true,'ja_reservada',true,'lote_id',v_op.lote_id,
     'referencia',v_op.referencia,'operacao_id',v_op.operacao_id,
     'valor_centavos',v_op.valor_centavos,'estado',v_op.estado,
     'pode_emitir_pix',false,'payment_id',v_op.payment_id);
 END IF;

 IF v_lote.estado IS DISTINCT FROM 'preparado' THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','estado_lote_invalido');
 END IF;
 v_check:=public.catalogo_asaas_conferir_conciliacao_acumulo(p_lote);
 IF v_check->>'ok' IS DISTINCT FROM 'true'
    OR v_check->>'integridade_contabil_ok' IS DISTINCT FROM 'true'
    OR (v_check->>'valor_fontes_centavos')::bigint IS DISTINCT FROM v_lote.total_centavos
 THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,
     'motivo','integridade_contabil_incompleta',
     'parcelas_invalidas',v_check->'parcelas_invalidas');
 END IF;
 IF EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_referencias
           WHERE comercio_id=v_lote.comercio_id
             AND estado IN ('reservado','observado','revisao'))
 THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,
     'motivo','outra_referencia_da_loja_em_conferencia');
 END IF;

 INSERT INTO public.catalogo_asaas_acumulo_referencias
   (lote_id,comercio_id,referencia,valor_centavos)
 VALUES(p_lote,v_lote.comercio_id,'guia-acumulo-'||p_lote::text,v_lote.total_centavos)
 RETURNING * INTO v_op;

 RETURN pg_catalog.jsonb_build_object(
   'ok',true,'ja_reservada',false,'lote_id',v_op.lote_id,
   'referencia',v_op.referencia,'operacao_id',v_op.operacao_id,
   'valor_centavos',v_op.valor_centavos,'estado',v_op.estado,
   'pode_emitir_pix',false,'payment_id',null);
END;
$reservar$;
REVOKE ALL ON FUNCTION public.catalogo_asaas_reservar_referencia_acumulo(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_reservar_referencia_acumulo(uuid)
 TO service_role;

-- A vinculação a um ID de pagamento real depende de GET remoto verificado,
-- do mesmo cliente, referencia, valor, estado e chave de idempotencia.
-- NENHUMA função de registrar payment_id ou criar Pix existe nesta etapa.
COMMIT;
