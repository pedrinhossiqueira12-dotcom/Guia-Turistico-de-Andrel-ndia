-- COB-06 / PR #39: EXCLUSIVAMENTE CI DESCARTAVEL, NUNCA STAGING/PROD.
-- Testa a transicao GET vazio FICTICIO -> gate SQL13 -> UMA autorizacao
-- positiva de POST SIMULADO. O Asaas nao e consultado neste SQL.
-- ATENCAO: os indicadores "prova_get_externa=true" e "autorizacao_externa=true"
-- do recibo abaixo sao apenas dados de fixture! Nao comprovam Asaas real.
-- A Edge real NAO importa este modulo e o POST CI-only nao tem rede nativa.
BEGIN;

DO $ci$
BEGIN
 IF pg_catalog.current_database() IS DISTINCT FROM 'catalogo_cob06_ci'
    OR pg_catalog.inet_server_port() IS DISTINCT FROM 5432
    OR current_user IS DISTINCT FROM 'postgres'
 THEN RAISE EXCEPTION 'COB06_CI_ONLY: instalacao do gate positivo simulado proibida'
    USING ERRCODE='42501'; END IF;
END;
$ci$;

-- Evidencia de GET NEGATIVO ficticia, vinculada ao livro.
-- Apenas o clone CI pode gravar; NAO e prova bancaria Asaas.
CREATE TABLE catalogo_private.catalogo_asaas_get_negativo_post_mock_ci (
 lote_id uuid PRIMARY KEY
   REFERENCES public.catalogo_asaas_acumulo_referencias(lote_id) ON DELETE RESTRICT,
 operacao_id uuid NOT NULL UNIQUE,
 referencia text NOT NULL UNIQUE,
 cliente_id text NOT NULL,
 valor_centavos bigint NOT NULL CHECK (valor_centavos BETWEEN 500 AND 2147483647),
 http_status integer NOT NULL CHECK(http_status=200),
 total_count integer NOT NULL CHECK(total_count=0),
 itens_count integer NOT NULL CHECK(itens_count=0),
 has_more boolean NOT NULL CHECK(has_more=false),
 resposta_sha256 text NOT NULL CHECK(resposta_sha256 ~ '^[0-9a-f]{64}$'),
 evidencia_mockada boolean NOT NULL DEFAULT true CHECK(evidencia_mockada=true),
 registrada_em timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 CONSTRAINT catalogo_cob06_post_get_ref_mock_ci
  CHECK(referencia='guia-acumulo-'||lote_id::text)
);
ALTER TABLE catalogo_private.catalogo_asaas_get_negativo_post_mock_ci
 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON catalogo_private.catalogo_asaas_get_negativo_post_mock_ci
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER catalogo_asaas_get_negativo_post_mock_imutavel_ci
 BEFORE UPDATE OR DELETE ON catalogo_private.catalogo_asaas_get_negativo_post_mock_ci
 FOR EACH ROW EXECUTE FUNCTION
 catalogo_private.catalogo_asaas_acumulo_referencia_imutavel();

CREATE FUNCTION catalogo_private.catalogo_asaas_autorizar_post_mock_ci(
 p_lote uuid,
 p_referencia text,
 p_cliente text,
 p_valor_centavos bigint,
 p_get_total_simulado integer,
 p_get_paginacao_completa_simulada boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $gate$
DECLARE
 v_ref public.catalogo_asaas_acumulo_referencias%ROWTYPE;
 v_cliente text;
 v_get catalogo_private.catalogo_asaas_get_negativo_post_mock_ci%ROWTYPE;
 v_recibo jsonb;
BEGIN
 IF pg_catalog.current_database() IS DISTINCT FROM 'catalogo_cob06_ci'
    OR pg_catalog.inet_server_port() IS DISTINCT FROM 5432
    OR current_user IS DISTINCT FROM 'postgres'
 THEN RAISE EXCEPTION 'COB06_CI_ONLY: autorizacao simulada fora da CI'
   USING ERRCODE='42501'; END IF;

 -- Os dois campos GET representam SOMENTE um resultado mockado na CI.
 -- Lista ambigua, paginada, nao comprovada ou com cobranca EXISTENTE:
 -- NENHUMA tentativa SQL deve ser reservada.
 IF p_lote IS NULL OR p_get_total_simulado IS DISTINCT FROM 0
    OR p_get_paginacao_completa_simulada IS DISTINCT FROM true
 THEN RETURN pg_catalog.jsonb_build_object(
    'ok',false,'motivo','get_simulado_inconclusivo','nova_tentativa',false,
    'pode_emitir_pix',false,'pode_quitar',false,
    'pode_liberar_motoboy',false,'reconciliar_por_get',true); END IF;

 SELECT * INTO v_ref FROM public.catalogo_asaas_acumulo_referencias
 WHERE lote_id=p_lote;
 SELECT cliente_id INTO v_cliente FROM public.catalogo_asaas_clientes
 WHERE comercio_id=v_ref.comercio_id;
 IF v_ref.lote_id IS NULL
    OR v_ref.referencia IS DISTINCT FROM p_referencia
    OR v_ref.valor_centavos IS DISTINCT FROM p_valor_centavos
    OR v_cliente IS NULL OR v_cliente IS DISTINCT FROM p_cliente
 THEN RETURN pg_catalog.jsonb_build_object(
    'ok',false,'motivo','identidade_simulada_divergente',
    'nova_tentativa',false,'pode_emitir_pix',false,
    'pode_quitar',false,'pode_liberar_motoboy',false); END IF;

 -- Afirmacoes GET da propria RPC NAO bastam. Antes do claim unico,
 -- exigir a trilha mock persistida e imutavel no livro local efemero.
 SELECT * INTO v_get
 FROM catalogo_private.catalogo_asaas_get_negativo_post_mock_ci
 WHERE lote_id=p_lote;
 IF v_get.lote_id IS NULL
    OR v_get.operacao_id IS DISTINCT FROM v_ref.operacao_id
    OR v_get.referencia IS DISTINCT FROM p_referencia
    OR v_get.cliente_id IS DISTINCT FROM p_cliente
    OR v_get.valor_centavos IS DISTINCT FROM p_valor_centavos
    OR v_get.http_status IS DISTINCT FROM 200
    OR v_get.total_count IS DISTINCT FROM 0
    OR v_get.itens_count IS DISTINCT FROM 0
    OR v_get.has_more IS DISTINCT FROM false
    OR v_get.evidencia_mockada IS DISTINCT FROM true
    OR v_get.resposta_sha256 !~ '^[0-9a-f]{64}$'
    OR v_get.registrada_em > pg_catalog.clock_timestamp()
    OR v_get.registrada_em < pg_catalog.clock_timestamp() - INTERVAL '5 minutes'
 THEN RETURN pg_catalog.jsonb_build_object(
    'ok',false,'motivo','evidencia_get_mock_ci_ausente_ou_divergente',
    'nova_tentativa',false,'pode_emitir_pix',false,
    'pode_quitar',false,'pode_liberar_motoboy',false,
    'reconciliar_por_get',true); END IF;

 -- SQL13 segura lock transacional POR COMERCIO, revalida origens,
 -- reserva apenas a primeira tentativa e impede qualquer replay.
 v_recibo:=catalogo_private.catalogo_asaas_autorizar_tentativa_emissao_ci(p_lote);
 IF v_recibo->>'ok' IS DISTINCT FROM 'true'
    OR v_recibo->>'nova_tentativa' IS DISTINCT FROM 'true'
 THEN RETURN coalesce(v_recibo,'{}'::jsonb) ||
   pg_catalog.jsonb_build_object('pode_emitir_pix',false,
     'pode_quitar',false,'pode_liberar_motoboy',false); END IF;

 -- Conferir de novo a identidade retornada DO BANCO apos o lock.
 -- Erro reverte tambem o INSERT da tentativa feito pelo SQL13.
 IF v_recibo->>'lote_id' IS DISTINCT FROM p_lote::text
    OR v_recibo->>'referencia' IS DISTINCT FROM p_referencia
    OR v_recibo->>'cliente_id' IS DISTINCT FROM p_cliente
    OR (v_recibo->>'valor_centavos')::bigint IS DISTINCT FROM p_valor_centavos
    OR v_recibo->>'operacao_id' IS NULL
 THEN RAISE EXCEPTION 'COB06_CI_ONLY: recibo de identidade divergente'
    USING ERRCODE='23514'; END IF;

 -- O recibo positivo e SOMENTE uma prova de contrato SQL<->TS na CI:
 -- nenhuma instalacao STAGING, nenhuma Edge publicada, nenhum POST real.
 RETURN v_recibo || pg_catalog.jsonb_build_object(
   'simulacao_ci',true,'prova_get_externa',true,
   'autorizacao_externa',true,'pode_emitir_pix',true,
   'pode_repetir_post',false,'pode_quitar',false,
   'pode_liberar_motoboy',false);
END;
$gate$;
REVOKE ALL ON FUNCTION
 catalogo_private.catalogo_asaas_autorizar_post_mock_ci(
   uuid,text,text,bigint,integer,boolean)
 FROM PUBLIC,anon,authenticated,service_role;

-- O recibo positivo do claim pode ser copiado/reutilizado. Um segundo
-- marco de inicio, persistido ANTES de qualquer transporte HTTP simulado,
-- impede que o MESMO recibo cause dois POSTs entre processos/reinicios.
-- Somente CI: o banco real nao tem nem a tabela nem esta RPC.
CREATE TABLE catalogo_private.catalogo_asaas_inicio_post_mock_ci (
 lote_id uuid PRIMARY KEY
   REFERENCES public.catalogo_asaas_acumulo_tentativas_emissao_ci(lote_id)
   ON DELETE RESTRICT,
 operacao_id uuid NOT NULL UNIQUE,
 referencia text NOT NULL UNIQUE,
 cliente_id text NOT NULL,
 valor_centavos bigint NOT NULL CHECK(valor_centavos BETWEEN 500 AND 2147483647),
 iniciado_em timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 CONSTRAINT catalogo_cob06_inicio_ref_mock_ci
  CHECK(referencia='guia-acumulo-'||lote_id::text)
);
ALTER TABLE catalogo_private.catalogo_asaas_inicio_post_mock_ci
 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON catalogo_private.catalogo_asaas_inicio_post_mock_ci
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER catalogo_asaas_inicio_post_mock_imutavel_ci
 BEFORE UPDATE OR DELETE ON catalogo_private.catalogo_asaas_inicio_post_mock_ci
 FOR EACH ROW EXECUTE FUNCTION
 catalogo_private.catalogo_asaas_acumulo_referencia_imutavel();

CREATE FUNCTION catalogo_private.catalogo_asaas_marcar_inicio_post_mock_ci(
 p_lote uuid,p_operacao uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $inicio$
DECLARE
 v_comercio text;
 v_lote public.catalogo_asaas_acumulo_lotes%ROWTYPE;
 v_ref public.catalogo_asaas_acumulo_referencias%ROWTYPE;
 v_tentativa public.catalogo_asaas_acumulo_tentativas_emissao_ci%ROWTYPE;
 v_get catalogo_private.catalogo_asaas_get_negativo_post_mock_ci%ROWTYPE;
BEGIN
 IF pg_catalog.current_database() IS DISTINCT FROM 'catalogo_cob06_ci'
    OR pg_catalog.inet_server_port() IS DISTINCT FROM 5432
    OR current_user IS DISTINCT FROM 'postgres'
 THEN RAISE EXCEPTION 'COB06_CI_ONLY: inicio POST simulado fora da CI'
   USING ERRCODE='42501'; END IF;
 IF p_lote IS NULL OR p_operacao IS NULL THEN
  RETURN pg_catalog.jsonb_build_object(
   'ok',false,'motivo','argumentos_invalidos',
   'marco_persistido',false,'pode_enviar_post_mock',false); END IF;

 SELECT comercio_id INTO v_comercio FROM public.catalogo_asaas_acumulo_lotes
 WHERE id=p_lote;
 IF v_comercio IS NULL THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','lote_ausente',
   'marco_persistido',false,'pode_enviar_post_mock',false); END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('catalogo-fatura:'||v_comercio,0));
 SELECT * INTO v_lote FROM public.catalogo_asaas_acumulo_lotes
 WHERE id=p_lote FOR UPDATE;
 SELECT * INTO v_tentativa FROM public.catalogo_asaas_acumulo_tentativas_emissao_ci
 WHERE lote_id=p_lote FOR UPDATE;
 SELECT * INTO v_ref FROM public.catalogo_asaas_acumulo_referencias
 WHERE lote_id=p_lote FOR UPDATE;
 SELECT * INTO v_get FROM catalogo_private.catalogo_asaas_get_negativo_post_mock_ci
 WHERE lote_id=p_lote;

 IF EXISTS(SELECT 1 FROM catalogo_private.catalogo_asaas_inicio_post_mock_ci
  WHERE lote_id=p_lote)
 THEN RETURN pg_catalog.jsonb_build_object(
   'ok',false,'motivo','envio_ja_iniciado','marco_persistido',false,
   'pode_enviar_post_mock',false,'pode_repetir_post',false,
   'reconciliar_por_get',true); END IF;

 -- Todas as identidades sao recuperadas DO BANCO, nunca de navegador.
 -- Prova GET mockada recente e indispensavel; nada libera dinheiro real.
 IF v_lote.estado IS DISTINCT FROM 'preparado'
    OR v_lote.comercio_id IS DISTINCT FROM v_comercio
    OR v_tentativa.lote_id IS NULL
    OR v_tentativa.operacao_id IS DISTINCT FROM p_operacao
    OR v_tentativa.comercio_id IS DISTINCT FROM v_comercio
    OR v_tentativa.pode_repetir_post IS DISTINCT FROM false
    OR v_tentativa.post_externo_comprovado IS DISTINCT FROM false
    OR v_ref.estado IS DISTINCT FROM 'reservado'
    OR v_ref.payment_id IS NOT NULL
    OR v_ref.pode_emitir_pix IS DISTINCT FROM false
    OR v_ref.operacao_id IS DISTINCT FROM p_operacao
    OR v_ref.referencia IS DISTINCT FROM v_tentativa.referencia
    OR v_ref.valor_centavos IS DISTINCT FROM v_tentativa.valor_centavos
    OR v_ref.comercio_id IS DISTINCT FROM v_comercio
    OR v_tentativa.referencia IS DISTINCT FROM 'guia-acumulo-'||p_lote::text
    OR v_get.lote_id IS NULL
    OR v_get.operacao_id IS DISTINCT FROM p_operacao
    OR v_get.referencia IS DISTINCT FROM v_ref.referencia
    OR v_get.cliente_id IS DISTINCT FROM v_tentativa.cliente_id
    OR v_get.valor_centavos IS DISTINCT FROM v_ref.valor_centavos
    OR v_get.http_status IS DISTINCT FROM 200
    OR v_get.total_count IS DISTINCT FROM 0
    OR v_get.itens_count IS DISTINCT FROM 0
    OR v_get.has_more IS DISTINCT FROM false
    OR v_get.evidencia_mockada IS DISTINCT FROM true
    OR v_get.resposta_sha256 !~ '^[0-9a-f]{64}

    OR v_get.registrada_em > pg_catalog.clock_timestamp()
    OR v_get.registrada_em < pg_catalog.clock_timestamp() - INTERVAL '5 minutes'
 THEN RETURN pg_catalog.jsonb_build_object(
    'ok',false,'motivo','livro_ou_get_mock_inconsistente',
    'marco_persistido',false,'pode_enviar_post_mock',false,
    'reconciliar_por_get',true); END IF;

 -- Esta insercao COMMITADA consome irreversivelmente a permissao mock.
 -- TIMEOUT, crash ou HTTP perdido NUNCA removem o marco.
 INSERT INTO catalogo_private.catalogo_asaas_inicio_post_mock_ci(
   lote_id,operacao_id,referencia,cliente_id,valor_centavos
 ) VALUES (
   p_lote,p_operacao,v_ref.referencia,v_tentativa.cliente_id,v_ref.valor_centavos
 );
 RETURN pg_catalog.jsonb_build_object(
   'ok',true,'simulacao_ci',true,'marco_persistido',true,
   'lote_id',p_lote,'operacao_id',p_operacao,
   'referencia',v_ref.referencia,'cliente_id',v_tentativa.cliente_id,
   'valor_centavos',v_ref.valor_centavos,
   'pode_enviar_post_mock',true,'pode_repetir_post',false,
   'pode_quitar',false,'pode_liberar_motoboy',false,
   'reconciliar_por_get',true);
END;
$inicio$;
REVOKE ALL ON FUNCTION
 catalogo_private.catalogo_asaas_marcar_inicio_post_mock_ci(uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
