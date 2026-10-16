-- COB-06 / PR #39: gate duravel de UMA tentativa de emissao agregada.
-- CANDIDATO APENAS PARA CI DESCARTAVEL: NUNCA aplicar em STAGING/PROD.
-- NAO concede autorizacao bancaria, nao chama Asaas e nao muda SQL 05
-- (pode_emitir_pix=false). O GET externo negativo ainda precisa ser provado
-- por futura Edge administrativa antes de qualquer tentativa real de POST.
BEGIN;

CREATE TABLE public.catalogo_asaas_acumulo_tentativas_emissao_ci (
 lote_id uuid PRIMARY KEY
   REFERENCES public.catalogo_asaas_acumulo_referencias(lote_id) ON DELETE RESTRICT,
 operacao_id uuid NOT NULL UNIQUE,
 comercio_id text NOT NULL,
 referencia text NOT NULL UNIQUE,
 cliente_id text NOT NULL,
 valor_centavos bigint NOT NULL
   CHECK(valor_centavos>=500 AND valor_centavos<=2147483647),
 tentativa_iniciada_em timestamptz NOT NULL DEFAULT pg_catalog.now(),
 -- Falha/timeout nao permite repetir POST; somente reconciliacao GET/manual.
 pode_repetir_post boolean NOT NULL DEFAULT false CHECK(pode_repetir_post=false),
 post_externo_comprovado boolean NOT NULL DEFAULT false CHECK(post_externo_comprovado=false),
 CONSTRAINT catalogo_acumulo_tentativa_ref_exata_ci
   CHECK(referencia='guia-acumulo-'||lote_id::text),
 CONSTRAINT catalogo_acumulo_tentativa_cliente_ci
   CHECK(cliente_id ~ '^cus_[A-Za-z0-9_-]{3,120}$')
);
ALTER TABLE public.catalogo_asaas_acumulo_tentativas_emissao_ci
 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_asaas_acumulo_tentativas_emissao_ci
 FROM PUBLIC,anon,authenticated,service_role;

-- Reutiliza a trava imutavel do SQL 05: nenhum ator altera ou apaga
-- a tentativa apos sua insercao, incluindo owner fora do roteiro de CI.
CREATE TRIGGER catalogo_asaas_acumulo_tentativa_imutavel_ci
 BEFORE UPDATE OR DELETE ON public.catalogo_asaas_acumulo_tentativas_emissao_ci
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_acumulo_referencia_imutavel();

-- SECURITY INVOKER, schema privado, somente owner postgres no banco efemero.
-- A funcao produz um recibo da primeira tentativa, nao permissao de emitir Pix.
CREATE FUNCTION catalogo_private.catalogo_asaas_autorizar_tentativa_emissao_ci(
 p_lote uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $gate$
DECLARE
 v_comercio text;
 v_lote public.catalogo_asaas_acumulo_lotes%ROWTYPE;
 v_ref public.catalogo_asaas_acumulo_referencias%ROWTYPE;
 v_ja public.catalogo_asaas_acumulo_tentativas_emissao_ci%ROWTYPE;
 v_preflight jsonb;
 v_cliente text;
 v_count bigint;
 v_competencias bigint;
 v_menores bigint;
 v_total bigint;
BEGIN
 IF pg_catalog.current_database() IS DISTINCT FROM 'catalogo_cob06_ci'
    OR pg_catalog.inet_server_port() IS DISTINCT FROM 5432
    OR current_user IS DISTINCT FROM 'postgres'
 THEN RAISE EXCEPTION 'COB06_CI_ONLY: tentativa de emissao proibida fora da CI'
      USING ERRCODE='42501'; END IF;
 IF p_lote IS NULL THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','lote_invalido',
    'pode_emitir_pix',false);
 END IF;

 SELECT comercio_id INTO v_comercio FROM public.catalogo_asaas_acumulo_lotes
 WHERE id=p_lote;
 IF NOT FOUND THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','lote_inexistente',
    'pode_emitir_pix',false);
 END IF;
 -- Lock pela loja primeiro: mesma ordem do reconciliador atomico 11/12.
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('catalogo-fatura:'||v_comercio,0));
 SELECT * INTO v_lote FROM public.catalogo_asaas_acumulo_lotes
 WHERE id=p_lote FOR UPDATE;
 IF v_lote.comercio_id IS DISTINCT FROM v_comercio
    OR v_lote.estado IS DISTINCT FROM 'preparado'
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,
    'motivo','lote_nao_preparado','pode_emitir_pix',false); END IF;

 -- Primeiro bloquear replay persistente, inclusive depois de POST perdido.
 SELECT * INTO v_ja FROM public.catalogo_asaas_acumulo_tentativas_emissao_ci
 WHERE lote_id=p_lote FOR UPDATE;
 IF FOUND THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,
    'motivo','tentativa_ja_iniciada','nova_tentativa',false,
    'reconciliar_por_get',true,'pode_emitir_pix',false);
 END IF;
 SELECT * INTO v_ref FROM public.catalogo_asaas_acumulo_referencias
 WHERE lote_id=p_lote FOR UPDATE;
 IF v_ref.lote_id IS NULL
   OR v_ref.comercio_id IS DISTINCT FROM v_lote.comercio_id
   OR v_ref.estado IS DISTINCT FROM 'reservado'
   OR v_ref.referencia IS DISTINCT FROM 'guia-acumulo-'||p_lote::text
   OR v_ref.valor_centavos IS DISTINCT FROM v_lote.total_centavos
   OR v_ref.payment_id IS NOT NULL
   OR v_ref.pode_emitir_pix IS DISTINCT FROM false
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,
   'motivo','referencia_invalida','pode_emitir_pix',false); END IF;

 IF EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_observacoes
   WHERE lote_id=p_lote)
 OR EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_eventos
   WHERE lote_id=p_lote)
 OR EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_quitacoes_isoladas
   WHERE lote_id=p_lote)
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,
   'motivo','banco_ja_observado','pode_emitir_pix',false); END IF;

 SELECT cliente_id INTO v_cliente FROM public.catalogo_asaas_clientes
 WHERE comercio_id=v_lote.comercio_id;
 IF v_cliente IS NULL OR v_cliente !~ '^cus_[A-Za-z0-9_-]{3,120}$'
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,
   'motivo','cliente_invalido','pode_emitir_pix',false); END IF;

 -- Revalidar todo o livro sem aceitar quantidade ou valor do navegador.
 SELECT pg_catalog.count(*),pg_catalog.count(DISTINCT competencia),
        pg_catalog.count(*) FILTER (WHERE valor_centavos<500),
        coalesce(pg_catalog.sum(valor_centavos),0)
 INTO v_count,v_competencias,v_menores,v_total
 FROM public.catalogo_asaas_acumulo_fontes WHERE lote_id=p_lote;
 v_preflight:=public.catalogo_asaas_conferir_conciliacao_acumulo(p_lote);
 IF v_count<2 OR v_competencias<2 OR v_menores<1
    OR v_total IS DISTINCT FROM v_lote.total_centavos
    OR v_preflight->>'ok' IS DISTINCT FROM 'true'
    OR v_preflight->>'integridade_contabil_ok' IS DISTINCT FROM 'true'
    OR (v_preflight->>'valor_fontes_centavos')::bigint
       IS DISTINCT FROM v_lote.total_centavos
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,
    'motivo','origens_invalidas','pode_emitir_pix',false); END IF;

 INSERT INTO public.catalogo_asaas_acumulo_tentativas_emissao_ci (
  lote_id,operacao_id,comercio_id,referencia,cliente_id,valor_centavos
 ) VALUES (
  p_lote,v_ref.operacao_id,v_ref.comercio_id,v_ref.referencia,
  v_cliente,v_ref.valor_centavos
 );
 RETURN pg_catalog.jsonb_build_object(
   'ok',true,'nova_tentativa',true,'lote_id',p_lote,
   'referencia',v_ref.referencia,'operacao_id',v_ref.operacao_id,
   'cliente_id',v_cliente,'valor_centavos',v_ref.valor_centavos,
   'candidato_post_unico_ci',true,'reconciliar_por_get',true,
   'prova_get_externa',false,'autorizacao_externa',false,
   'pode_emitir_pix',false,'pode_quitar',false,
   'pode_liberar_motoboy',false);
END;
$gate$;
REVOKE ALL ON FUNCTION
 catalogo_private.catalogo_asaas_autorizar_tentativa_emissao_ci(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
