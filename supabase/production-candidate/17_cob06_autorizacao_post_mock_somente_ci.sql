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
