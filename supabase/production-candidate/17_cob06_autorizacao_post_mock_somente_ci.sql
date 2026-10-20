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

-- Uma resposta GET mockada so pode fundamentar o recibo CI se sua
-- identidade for persistida ANTES da reserva POST. Nenhum parametro
-- de request atua sozinho como prova bancaria. Esta tabela nao existe
-- fora do banco local descartavel catalogo_cob06_ci.
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
 resposta_sha256 text NOT NULL CHECK(resposta_sha256 ~ '^[0-9a-f]{64}
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

 -- Nao aceitar GET vazio declarado so por parametros da RPC: a fixture
 -- deve conter evidencia append-only vinculada ao LOTE/OPERACAO/CLIENTE.
 -- A existencia deste MOCK nunca vale como prova bancaria externa.
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
    OR v_get.resposta_sha256 !~ '^[0-9a-f]{64}
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
COMMIT;
),
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
COMMIT;

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
COMMIT;
),
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
COMMIT;
