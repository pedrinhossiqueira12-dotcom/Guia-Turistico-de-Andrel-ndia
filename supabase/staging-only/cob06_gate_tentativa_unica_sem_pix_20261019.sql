-- COB-06: reserva transacional de uma unica tentativa, SEM EMISSAO.
-- Instalacao manual autorizada SOMENTE em STAGING jbttwihctuibchhcyqtl,
-- apos CI. Nao pertence a supabase/pending-migrations e NAO vai para PROD.
-- SQL13/17 sao CI-only e nao sao instalados por este script.
-- Nenhum resultado deste gate autoriza POST ao Asaas, Pix, baixa ou saque.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

DO $guard_instalacao$
BEGIN
 IF current_user IS DISTINCT FROM 'postgres'
 OR pg_catalog.current_database() NOT IN ('postgres','catalogo_cob06_ci')
 THEN RAISE EXCEPTION 'COB06_QA_ONLY: owner ou banco inesperado'
   USING ERRCODE='42501'; END IF;
 -- No projeto real, a presenca de um lote QA exato e obrigatoria.
 -- Ela impede instalar acidentalmente na producao que nao possui este lote.
 IF pg_catalog.current_database()='postgres' AND NOT EXISTS (
   SELECT 1 FROM public.catalogo_asaas_acumulo_lotes l
   JOIN public.catalogo_asaas_acumulo_referencias r ON r.lote_id=l.id
   WHERE l.id='583d761a-ecb9-49be-b484-e43f6183971e'::uuid
    AND l.comercio_id='asaas-cob02' AND l.estado='preparado'
    AND l.total_centavos=560 AND r.estado='reservado'
    AND r.referencia='guia-acumulo-583d761a-ecb9-49be-b484-e43f6183971e'
    AND r.valor_centavos=560 AND r.payment_id IS NULL
    AND r.pode_emitir_pix=false
 ) THEN RAISE EXCEPTION 'COB06_QA_ONLY: alvo STAGING ficticio nao comprovado'
   USING ERRCODE='42501'; END IF;
END;
$guard_instalacao$;

CREATE TABLE catalogo_private.catalogo_asaas_tentativas_qa_sem_pix (
 lote_id uuid PRIMARY KEY
   REFERENCES public.catalogo_asaas_acumulo_referencias(lote_id) ON DELETE RESTRICT,
 operacao_id uuid NOT NULL UNIQUE,
 comercio_id text NOT NULL,
 referencia text NOT NULL UNIQUE,
 cliente_id text NOT NULL,
 valor_centavos bigint NOT NULL CHECK (valor_centavos BETWEEN 500 AND 2147483647),
 reservada_em timestamptz NOT NULL DEFAULT pg_catalog.now(),
 pode_emitir_pix boolean NOT NULL DEFAULT false CHECK (pode_emitir_pix=false),
 post_executado boolean NOT NULL DEFAULT false CHECK (post_executado=false),
 pode_quitar boolean NOT NULL DEFAULT false CHECK (pode_quitar=false),
 pode_liberar_motoboy boolean NOT NULL DEFAULT false CHECK (pode_liberar_motoboy=false),
 CONSTRAINT catalogo_asaas_tentativa_qa_referencia_exata
   CHECK(referencia='guia-acumulo-'||lote_id::text),
 CONSTRAINT catalogo_asaas_tentativa_qa_cliente_valido
   CHECK(cliente_id ~ '^cus_[A-Za-z0-9_-]{3,120}$')
);
ALTER TABLE catalogo_private.catalogo_asaas_tentativas_qa_sem_pix
 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON catalogo_private.catalogo_asaas_tentativas_qa_sem_pix
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER catalogo_asaas_tentativa_qa_imutavel
 BEFORE UPDATE OR DELETE ON catalogo_private.catalogo_asaas_tentativas_qa_sem_pix
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_acumulo_referencia_imutavel();

-- PUBLIC apenas para acesso RPC via service_role backend (sem navegador).
-- SECURITY DEFINER necessario para inserir na tabela privada sem grants diretos.
-- O backend autenticado deve conferir o administrador: esta RPC por si so
-- registra a tentativa no livro, sem chamar ou autorizar o Asaas.
CREATE FUNCTION public.catalogo_asaas_reservar_tentativa_qa_sem_pix(p_lote uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $gate$
DECLARE
 v_comercio text;
 v_lote public.catalogo_asaas_acumulo_lotes%ROWTYPE;
 v_ref public.catalogo_asaas_acumulo_referencias%ROWTYPE;
 v_ja catalogo_private.catalogo_asaas_tentativas_qa_sem_pix%ROWTYPE;
 v_preflight jsonb;
 v_cliente text;
 v_count bigint;
 v_competencias bigint;
 v_menores bigint;
 v_total bigint;
 v_quitacao_existente boolean := false;
BEGIN
 IF pg_catalog.current_database() NOT IN ('postgres','catalogo_cob06_ci')
 THEN RAISE EXCEPTION 'COB06_QA_ONLY: banco inesperado' USING ERRCODE='42501'; END IF;
 -- No STAGING, somente o lote QA exato pode registrar uma tentativa.
 IF p_lote IS NULL OR (
   pg_catalog.current_database()='postgres'
   AND p_lote IS DISTINCT FROM '583d761a-ecb9-49be-b484-e43f6183971e'::uuid
 ) THEN RETURN pg_catalog.jsonb_build_object('ok',false,
   'motivo','lote_fora_do_ensaio','nova_tentativa',false,
   'pode_emitir_pix',false,'pode_quitar',false,'pode_liberar_motoboy',false); END IF;

 SELECT comercio_id INTO v_comercio FROM public.catalogo_asaas_acumulo_lotes
 WHERE id=p_lote;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false,
   'motivo','lote_inexistente','nova_tentativa',false,
   'pode_emitir_pix',false,'pode_quitar',false,'pode_liberar_motoboy',false); END IF;
 -- Mesma ordem de locks do reconciliador: comercio -> lote -> referencia.
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('catalogo-fatura:'||v_comercio,0));
 SELECT * INTO v_lote FROM public.catalogo_asaas_acumulo_lotes
 WHERE id=p_lote FOR UPDATE;
 IF v_lote.comercio_id IS DISTINCT FROM v_comercio
 OR v_lote.estado IS DISTINCT FROM 'preparado'
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,
   'motivo','lote_nao_preparado','nova_tentativa',false,
   'pode_emitir_pix',false,'pode_quitar',false,'pode_liberar_motoboy',false); END IF;

 SELECT * INTO v_ja FROM catalogo_private.catalogo_asaas_tentativas_qa_sem_pix
 WHERE lote_id=p_lote FOR UPDATE;
 IF FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false,
   'motivo','tentativa_ja_reservada','nova_tentativa',false,
   'ja_reservado',true,'reconciliar_manualmente',true,
   'pode_emitir_pix',false,'pode_quitar',false,'pode_liberar_motoboy',false); END IF;

 SELECT * INTO v_ref FROM public.catalogo_asaas_acumulo_referencias
 WHERE lote_id=p_lote FOR UPDATE;
 IF v_ref.lote_id IS NULL OR v_ref.comercio_id IS DISTINCT FROM v_lote.comercio_id
 OR v_ref.estado IS DISTINCT FROM 'reservado'
 OR v_ref.referencia IS DISTINCT FROM 'guia-acumulo-'||p_lote::text
 OR v_ref.valor_centavos IS DISTINCT FROM v_lote.total_centavos
 OR v_ref.payment_id IS NOT NULL OR v_ref.pode_emitir_pix IS DISTINCT FROM false
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,
   'motivo','referencia_invalida','nova_tentativa',false,
   'pode_emitir_pix',false,'pode_quitar',false,'pode_liberar_motoboy',false); END IF;

 IF pg_catalog.current_database()='postgres' AND (
   v_lote.comercio_id IS DISTINCT FROM 'asaas-cob02'
   OR v_lote.total_centavos IS DISTINCT FROM 560
 ) THEN RETURN pg_catalog.jsonb_build_object('ok',false,
   'motivo','alvo_qa_divergente','nova_tentativa',false,
   'pode_emitir_pix',false,'pode_quitar',false,'pode_liberar_motoboy',false); END IF;
 -- STAGING ainda nao instalou a tabela de quitacoes do candidato futuro.
 -- Se existir (como na CI), consulta obrigatoria com identificador fixo;
 -- sem tabela, nenhuma quitacao isolada desse modelo pode existir.
 IF pg_catalog.to_regclass('public.catalogo_asaas_acumulo_quitacoes_isoladas') IS NOT NULL THEN
   EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_quitacoes_isoladas WHERE lote_id=$1)'
      INTO v_quitacao_existente USING p_lote;
 END IF;
 IF EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_observacoes WHERE lote_id=p_lote)
 OR EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_eventos WHERE lote_id=p_lote)
 OR v_quitacao_existente
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,
   'motivo','banco_ja_observado','nova_tentativa',false,
   'pode_emitir_pix',false,'pode_quitar',false,'pode_liberar_motoboy',false); END IF;

 SELECT cliente_id INTO v_cliente FROM public.catalogo_asaas_clientes
 WHERE comercio_id=v_lote.comercio_id;
 IF v_cliente IS NULL OR v_cliente !~ '^cus_[A-Za-z0-9_-]{3,120}$'
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,
   'motivo','cliente_invalido','nova_tentativa',false,
   'pode_emitir_pix',false,'pode_quitar',false,'pode_liberar_motoboy',false); END IF;

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
   'motivo','origens_invalidas','nova_tentativa',false,
   'pode_emitir_pix',false,'pode_quitar',false,'pode_liberar_motoboy',false); END IF;

 INSERT INTO catalogo_private.catalogo_asaas_tentativas_qa_sem_pix (
   lote_id,operacao_id,comercio_id,referencia,cliente_id,valor_centavos
 ) VALUES(p_lote,v_ref.operacao_id,v_ref.comercio_id,
   v_ref.referencia,v_cliente,v_ref.valor_centavos);
 RETURN pg_catalog.jsonb_build_object('ok',true,
   'nova_tentativa',true,'ja_reservado',false,'lote_id',p_lote,
   'reconciliar_manualmente',true,'prova_get_externa',false,
   'autorizacao_externa',false,'post_executado',false,
   'pode_emitir_pix',false,'pode_quitar',false,'pode_liberar_motoboy',false);
END;
$gate$;
REVOKE ALL ON FUNCTION public.catalogo_asaas_reservar_tentativa_qa_sem_pix(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_reservar_tentativa_qa_sem_pix(uuid)
 TO service_role;
COMMIT;
