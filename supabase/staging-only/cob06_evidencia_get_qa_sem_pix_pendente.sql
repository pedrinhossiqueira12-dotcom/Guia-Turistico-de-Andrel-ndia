-- COB-06 / PR #39: candidato de trilha imutavel de GET negativo QA.
-- NAO e migration de producao e NAO deve ser instalado automaticamente.
-- O unico objetivo e persistir metadados minimizados de uma consulta
-- que uma Edge CONFIAVEL venha a realizar com credencial do servidor.
-- ESTA RPC NAO CONSULTA ASAAS. Um hash entregue por caller nao constitui
-- prova independente de que o banco respondeu ou de inexistencia futura.
-- Mesmo com evidencia persistida: Pix, POST, baixa, estorno e repasse HOLD.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

DO $guard$
BEGIN
 IF current_user IS DISTINCT FROM 'postgres'
 OR pg_catalog.current_database() NOT IN ('postgres','catalogo_cob06_ci')
 THEN RAISE EXCEPTION 'COB06_GET_EVIDENCIA_QA_ONLY: owner ou banco inesperado'
  USING ERRCODE='42501'; END IF;
 IF pg_catalog.to_regclass('catalogo_private.catalogo_asaas_tentativas_qa_sem_pix') IS NULL
 OR pg_catalog.to_regprocedure(
  'public.catalogo_asaas_conferir_vinculo_tentativa_qa_sem_pix(uuid)') IS NULL
 THEN RAISE EXCEPTION 'COB06_GET_EVIDENCIA_QA_ONLY: gate previo ausente'
  USING ERRCODE='42501'; END IF;
 -- Nao basta que o nome do banco seja postgres: exige o lote ficticio
 -- ja reservado no alvo staging. Clone descartavel tem fixture propria.
 IF pg_catalog.current_database()='postgres' AND NOT EXISTS (
  SELECT 1
  FROM catalogo_private.catalogo_asaas_tentativas_qa_sem_pix t
  JOIN public.catalogo_asaas_acumulo_lotes l ON l.id=t.lote_id
  JOIN public.catalogo_asaas_acumulo_referencias r ON r.lote_id=t.lote_id
  WHERE t.lote_id='583d761a-ecb9-49be-b484-e43f6183971e'::uuid
   AND t.comercio_id='asaas-cob02' AND l.comercio_id=t.comercio_id
   AND l.estado='preparado' AND l.total_centavos=560
   AND t.valor_centavos=560 AND r.valor_centavos=560
   AND r.estado='reservado' AND r.payment_id IS NULL
   AND r.referencia=t.referencia
   AND t.post_executado=false AND t.pode_emitir_pix=false
   AND r.pode_emitir_pix=false
 ) THEN RAISE EXCEPTION 'COB06_GET_EVIDENCIA_QA_ONLY: alvo ficticio ausente'
  USING ERRCODE='42501'; END IF;
END;
$guard$;

-- Marcador atomico PERMANENTE ANTES da rede: a transacao confirma a
-- intencao de GET uma unica vez por lote, inclusive apos timeout/falha.
-- Sem rotina automatica de limpeza, renovacao, lease ou segunda consulta.
CREATE TABLE catalogo_private.catalogo_asaas_inicios_get_qa_sem_pix (
 lote_id uuid PRIMARY KEY
  REFERENCES catalogo_private.catalogo_asaas_tentativas_qa_sem_pix(lote_id)
  ON DELETE RESTRICT,
 operacao_id uuid NOT NULL UNIQUE,
 referencia text NOT NULL UNIQUE,
 cliente_id text NOT NULL,
 valor_centavos bigint NOT NULL CHECK(valor_centavos BETWEEN 500 AND 2147483647),
 metodo text NOT NULL DEFAULT 'GET' CHECK(metodo='GET'),
 ambiente text NOT NULL DEFAULT 'sandbox' CHECK(ambiente='sandbox'),
 iniciado_em timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 pode_repetir_get boolean NOT NULL DEFAULT false CHECK(pode_repetir_get=false),
 pode_emitir_pix boolean NOT NULL DEFAULT false CHECK(pode_emitir_pix=false),
 pode_quitar boolean NOT NULL DEFAULT false CHECK(pode_quitar=false),
 pode_estornar boolean NOT NULL DEFAULT false CHECK(pode_estornar=false),
 pode_liberar_motoboy boolean NOT NULL DEFAULT false CHECK(pode_liberar_motoboy=false),
 CONSTRAINT catalogo_asaas_inicio_get_qa_referencia
  CHECK(referencia='guia-acumulo-'||lote_id::text)
);
ALTER TABLE catalogo_private.catalogo_asaas_inicios_get_qa_sem_pix
 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON catalogo_private.catalogo_asaas_inicios_get_qa_sem_pix
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER catalogo_asaas_inicio_get_qa_imutavel
 BEFORE UPDATE OR DELETE ON catalogo_private.catalogo_asaas_inicios_get_qa_sem_pix
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_acumulo_referencia_imutavel();

CREATE TABLE catalogo_private.catalogo_asaas_evidencias_get_qa_sem_pix (
 lote_id uuid PRIMARY KEY
  REFERENCES catalogo_private.catalogo_asaas_tentativas_qa_sem_pix(lote_id)
  ON DELETE RESTRICT,
 operacao_id uuid NOT NULL UNIQUE,
 referencia text NOT NULL UNIQUE,
 cliente_id text NOT NULL,
 valor_centavos bigint NOT NULL CHECK(valor_centavos BETWEEN 500 AND 2147483647),
 endpoint text NOT NULL DEFAULT '/v3/payments'
  CHECK(endpoint='/v3/payments'),
 metodo text NOT NULL DEFAULT 'GET' CHECK(metodo='GET'),
 ambiente text NOT NULL DEFAULT 'sandbox' CHECK(ambiente='sandbox'),
 http_status integer NOT NULL CHECK(http_status=200),
 resultado text NOT NULL DEFAULT 'nenhuma_cobranca_localizada'
  CHECK(resultado='nenhuma_cobranca_localizada'),
 total_count integer NOT NULL CHECK(total_count=0),
 itens_count integer NOT NULL CHECK(itens_count=0),
 has_more boolean NOT NULL CHECK(has_more=false),
 -- Digest de corpo de resposta, fornecido pela Edge confiavel (nao pelo navegador).
 -- Sem segredo, token, nome, URL assinada ou corpo bruto do provedor.
 resposta_sha256 text NOT NULL CHECK(resposta_sha256 ~ '^[0-9a-f]{64}$'),
 registrada_em timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 -- A falta de cobranca nesta consulta nao autoriza emitir uma nova.
 prova_bancaria_suficiente boolean NOT NULL DEFAULT false
  CHECK(prova_bancaria_suficiente=false),
 pode_emitir_pix boolean NOT NULL DEFAULT false CHECK(pode_emitir_pix=false),
 pode_quitar boolean NOT NULL DEFAULT false CHECK(pode_quitar=false),
 pode_estornar boolean NOT NULL DEFAULT false CHECK(pode_estornar=false),
 pode_liberar_motoboy boolean NOT NULL DEFAULT false CHECK(pode_liberar_motoboy=false),
 CONSTRAINT catalogo_asaas_evidencia_get_qa_referencia
  CHECK(referencia='guia-acumulo-'||lote_id::text)
);
ALTER TABLE catalogo_private.catalogo_asaas_evidencias_get_qa_sem_pix
 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON catalogo_private.catalogo_asaas_evidencias_get_qa_sem_pix
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER catalogo_asaas_evidencia_get_qa_imutavel
 BEFORE UPDATE OR DELETE ON catalogo_private.catalogo_asaas_evidencias_get_qa_sem_pix
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_acumulo_referencia_imutavel();

-- O ACK desta RPC apenas permite UMA chamada GET; jamais permite POST/PIX.
-- PostgreSQL serializa concorrentes no lock da loja antes do INSERT unico.
-- Falha/timeout depois do commit => reconciliacao manual; nunca retry.
CREATE FUNCTION public.catalogo_asaas_iniciar_get_unico_qa_sem_pix(
 p_lote uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $iniciar$
DECLARE
 v_comercio text;
 v_l public.catalogo_asaas_acumulo_lotes%ROWTYPE;
 v_t catalogo_private.catalogo_asaas_tentativas_qa_sem_pix%ROWTYPE;
 v_r public.catalogo_asaas_acumulo_referencias%ROWTYPE;
 v_inicio catalogo_private.catalogo_asaas_inicios_get_qa_sem_pix%ROWTYPE;
 v_conferencia jsonb;
BEGIN
 IF pg_catalog.current_database() NOT IN ('postgres','catalogo_cob06_ci')
 OR p_lote IS NULL OR (pg_catalog.current_database()='postgres' AND
  p_lote IS DISTINCT FROM '583d761a-ecb9-49be-b484-e43f6183971e'::uuid)
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,
  'motivo','fora_do_ensaio','pode_consultar_asaas',false,'pode_emitir_pix',false); END IF;
 -- O GET deste lote ja ocorreu em STAGING em 19/10/2026, sem recibo persistido.
 -- Nunca criar uma marcacao retroativa nem repetir consulta; o relato do
 -- operador nao constitui prova bancaria. O clone CI testa apenas casos novos.
 IF pg_catalog.current_database()='postgres'
  AND p_lote='583d761a-ecb9-49be-b484-e43f6183971e'::uuid
 THEN RETURN pg_catalog.jsonb_build_object(
  'ok',false,'lote_id',p_lote,'motivo','get_historico_sem_prova',
  'nova_consulta',false,'pode_consultar_asaas',false,
  'pode_emitir_pix',false,'pode_quitar',false,'pode_estornar',false,
  'pode_liberar_motoboy',false,'hold_obrigatorio',true);
 END IF;
 SELECT comercio_id INTO v_comercio FROM public.catalogo_asaas_acumulo_lotes
 WHERE id=p_lote;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false,
  'motivo','lote_inexistente','pode_consultar_asaas',false,'pode_emitir_pix',false); END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('catalogo-fatura:'||v_comercio,0));
 SELECT * INTO v_l FROM public.catalogo_asaas_acumulo_lotes
 WHERE id=p_lote FOR UPDATE;
 SELECT * INTO v_t FROM catalogo_private.catalogo_asaas_tentativas_qa_sem_pix
 WHERE lote_id=p_lote FOR UPDATE;
 SELECT * INTO v_r FROM public.catalogo_asaas_acumulo_referencias
 WHERE lote_id=p_lote FOR UPDATE;
 IF v_l.id IS NULL OR v_t.lote_id IS NULL OR v_r.lote_id IS NULL
 OR v_l.comercio_id IS DISTINCT FROM v_comercio
 OR v_t.comercio_id IS DISTINCT FROM v_comercio
 OR v_r.comercio_id IS DISTINCT FROM v_comercio
 OR v_t.operacao_id IS DISTINCT FROM v_r.operacao_id
 OR v_t.referencia IS DISTINCT FROM v_r.referencia
 OR v_t.valor_centavos IS DISTINCT FROM v_l.total_centavos
 OR v_t.valor_centavos IS DISTINCT FROM v_r.valor_centavos
 OR v_l.estado IS DISTINCT FROM 'preparado'
 OR v_r.estado IS DISTINCT FROM 'reservado'
 OR v_r.payment_id IS NOT NULL
 OR v_t.post_executado IS DISTINCT FROM false
 OR v_t.pode_emitir_pix IS DISTINCT FROM false
 OR v_r.pode_emitir_pix IS DISTINCT FROM false
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,
  'motivo','vinculo_divergente','pode_consultar_asaas',false,'pode_emitir_pix',false); END IF;
 v_conferencia:=public.catalogo_asaas_conferir_vinculo_tentativa_qa_sem_pix(p_lote);
 IF v_conferencia->>'ok' IS DISTINCT FROM 'true'
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,
  'motivo','integridade_divergente','pode_consultar_asaas',false,'pode_emitir_pix',false); END IF;
 SELECT * INTO v_inicio
 FROM catalogo_private.catalogo_asaas_inicios_get_qa_sem_pix
 WHERE lote_id=p_lote;
 IF FOUND THEN RETURN pg_catalog.jsonb_build_object(
  'ok',false,'lote_id',p_lote,'motivo','get_ja_iniciado',
  'nova_consulta',false,'pode_consultar_asaas',false,
  'pode_emitir_pix',false,'pode_quitar',false,'pode_estornar',false,
  'pode_liberar_motoboy',false,'hold_obrigatorio',true); END IF;
 IF EXISTS(SELECT 1 FROM catalogo_private.catalogo_asaas_evidencias_get_qa_sem_pix
   WHERE lote_id=p_lote)
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,
  'motivo','evidencia_preexistente','pode_consultar_asaas',false,
  'pode_emitir_pix',false,'hold_obrigatorio',true); END IF;
 INSERT INTO catalogo_private.catalogo_asaas_inicios_get_qa_sem_pix (
  lote_id,operacao_id,referencia,cliente_id,valor_centavos
 ) VALUES (
  p_lote,v_t.operacao_id,v_t.referencia,v_t.cliente_id,v_t.valor_centavos
 );
 RETURN pg_catalog.jsonb_build_object(
  'ok',true,'lote_id',p_lote,'operacao_id',v_t.operacao_id,
  'referencia',v_t.referencia,'nova_consulta',true,'pode_consultar_asaas',true,
  'pode_repetir_get',false,'pode_emitir_pix',false,'pode_quitar',false,
  'pode_estornar',false,'pode_liberar_motoboy',false,
  'hold_obrigatorio',true);
END;
$iniciar$;
REVOKE ALL ON FUNCTION public.catalogo_asaas_iniciar_get_unico_qa_sem_pix(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_iniciar_get_unico_qa_sem_pix(uuid)
 TO service_role;

-- service_role pode chamar SOMENTE esta RPC; nao recebe permissao de INSERT
-- na tabela. O backend precisa validar admin e origem autenticada do GET.
-- Os parametros de metadata devem ser extraidos da resposta do Asaas, mas
-- mesmo valores validos representam apenas trilha local, nao autorizacao.
CREATE FUNCTION public.catalogo_asaas_registrar_get_negativo_qa_sem_pix(
 p_lote uuid, p_http_status integer, p_total_count integer,
 p_itens_count integer, p_has_more boolean, p_resposta_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $registrar$
DECLARE
 v_comercio text;
 v_l public.catalogo_asaas_acumulo_lotes%ROWTYPE;
 v_t catalogo_private.catalogo_asaas_tentativas_qa_sem_pix%ROWTYPE;
 v_r public.catalogo_asaas_acumulo_referencias%ROWTYPE;
 v_anterior catalogo_private.catalogo_asaas_evidencias_get_qa_sem_pix%ROWTYPE;
 v_inicio catalogo_private.catalogo_asaas_inicios_get_qa_sem_pix%ROWTYPE;
 v_conferencia jsonb;
BEGIN
 IF pg_catalog.current_database() NOT IN ('postgres','catalogo_cob06_ci')
 OR p_lote IS NULL OR (pg_catalog.current_database()='postgres' AND
  p_lote IS DISTINCT FROM '583d761a-ecb9-49be-b484-e43f6183971e'::uuid)
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,
  'motivo','fora_do_ensaio','pode_emitir_pix',false); END IF;
 IF p_http_status IS DISTINCT FROM 200 OR p_total_count IS DISTINCT FROM 0
 OR p_itens_count IS DISTINCT FROM 0 OR p_has_more IS DISTINCT FROM false
 OR p_resposta_sha256 IS NULL
 OR p_resposta_sha256 !~ '^[0-9a-f]{64}$'
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,
  'motivo','get_inconclusivo','pode_emitir_pix',false); END IF;

 SELECT comercio_id INTO v_comercio FROM public.catalogo_asaas_acumulo_lotes
 WHERE id=p_lote;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false,
  'motivo','lote_inexistente','pode_emitir_pix',false); END IF;
 -- Ordem do gate existente: trava de comercio -> lote -> tentativa -> ref.
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('catalogo-fatura:'||v_comercio,0));
 SELECT * INTO v_l FROM public.catalogo_asaas_acumulo_lotes
 WHERE id=p_lote FOR UPDATE;
 SELECT * INTO v_t FROM catalogo_private.catalogo_asaas_tentativas_qa_sem_pix
 WHERE lote_id=p_lote FOR UPDATE;
 SELECT * INTO v_r FROM public.catalogo_asaas_acumulo_referencias
 WHERE lote_id=p_lote FOR UPDATE;
 IF v_l.id IS NULL OR v_t.lote_id IS NULL OR v_r.lote_id IS NULL
 OR v_l.comercio_id IS DISTINCT FROM v_comercio
 OR v_t.comercio_id IS DISTINCT FROM v_comercio
 OR v_r.comercio_id IS DISTINCT FROM v_comercio
 OR v_t.operacao_id IS DISTINCT FROM v_r.operacao_id
 OR v_t.referencia IS DISTINCT FROM v_r.referencia
 OR v_t.cliente_id IS DISTINCT FROM (
  SELECT cliente_id FROM public.catalogo_asaas_clientes
  WHERE comercio_id=v_comercio)
 OR v_t.valor_centavos IS DISTINCT FROM v_l.total_centavos
 OR v_t.valor_centavos IS DISTINCT FROM v_r.valor_centavos
 OR v_l.estado IS DISTINCT FROM 'preparado'
 OR v_r.estado IS DISTINCT FROM 'reservado'
 OR v_r.payment_id IS NOT NULL
 OR v_t.post_executado IS DISTINCT FROM false
 OR v_t.pode_emitir_pix IS DISTINCT FROM false
 OR v_r.pode_emitir_pix IS DISTINCT FROM false
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,
  'motivo','vinculo_divergente','pode_emitir_pix',false); END IF;

 v_conferencia:=public.catalogo_asaas_conferir_vinculo_tentativa_qa_sem_pix(p_lote);
 IF v_conferencia->>'ok' IS DISTINCT FROM 'true'
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,
  'motivo','integridade_divergente','pode_emitir_pix',false); END IF;

 -- A evidencia so pode ser ligada a uma intencao de GET ja confirmada.
 SELECT * INTO v_inicio
 FROM catalogo_private.catalogo_asaas_inicios_get_qa_sem_pix WHERE lote_id=p_lote;
 IF v_inicio.lote_id IS NULL OR v_inicio.operacao_id IS DISTINCT FROM v_t.operacao_id
 OR v_inicio.referencia IS DISTINCT FROM v_t.referencia
 OR v_inicio.cliente_id IS DISTINCT FROM v_t.cliente_id
 OR v_inicio.valor_centavos IS DISTINCT FROM v_t.valor_centavos
 OR v_inicio.pode_repetir_get IS DISTINCT FROM false
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,
  'motivo','get_sem_marcacao_previa','pode_emitir_pix',false); END IF;

 SELECT * INTO v_anterior
 FROM catalogo_private.catalogo_asaas_evidencias_get_qa_sem_pix
 WHERE lote_id=p_lote;
 IF FOUND THEN
  RETURN pg_catalog.jsonb_build_object(
   'ok',v_anterior.resposta_sha256=p_resposta_sha256,'lote_id',p_lote,
   'motivo',CASE WHEN v_anterior.resposta_sha256=p_resposta_sha256
      THEN 'evidencia_ja_registrada' ELSE 'evidencia_divergente' END,
   'evidencia_get_persistida',true,'nova_evidencia',false,
   'prova_get_externa',false,'pode_emitir_pix',false,
   'pode_quitar',false,'pode_estornar',false,
   'pode_liberar_motoboy',false,'hold_obrigatorio',true);
 END IF;

 INSERT INTO catalogo_private.catalogo_asaas_evidencias_get_qa_sem_pix (
  lote_id,operacao_id,referencia,cliente_id,valor_centavos,
  http_status,total_count,itens_count,has_more,resposta_sha256
 ) VALUES (
  p_lote,v_t.operacao_id,v_t.referencia,v_t.cliente_id,v_t.valor_centavos,
  p_http_status,p_total_count,p_itens_count,p_has_more,p_resposta_sha256
 );
 RETURN pg_catalog.jsonb_build_object(
  'ok',true,'lote_id',p_lote,'nova_evidencia',true,
  'evidencia_get_persistida',true,'prova_get_externa',false,
  'post_executado',false,'pode_emitir_pix',false,'pode_quitar',false,
  'pode_estornar',false,'pode_liberar_motoboy',false,
  'hold_obrigatorio',true);
END;
$registrar$;
REVOKE ALL ON FUNCTION
 public.catalogo_asaas_registrar_get_negativo_qa_sem_pix(uuid,integer,integer,integer,boolean,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION
 public.catalogo_asaas_registrar_get_negativo_qa_sem_pix(uuid,integer,integer,integer,boolean,text)
 TO service_role;

-- Estado administrativo SOMENTE LEITURA: nao marca um GET, nao cria
-- evidencia retroativa e nao autoriza nova consulta ao Asaas. Tambem
-- identifica explicitamente o caso historico sem digest de 19/10.
CREATE FUNCTION public.catalogo_asaas_consultar_estado_get_qa_sem_pix(
 p_lote uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $estado$
DECLARE
 v_l public.catalogo_asaas_acumulo_lotes%ROWTYPE;
 v_t catalogo_private.catalogo_asaas_tentativas_qa_sem_pix%ROWTYPE;
 v_r public.catalogo_asaas_acumulo_referencias%ROWTYPE;
 v_inicio catalogo_private.catalogo_asaas_inicios_get_qa_sem_pix%ROWTYPE;
 v_evidencia catalogo_private.catalogo_asaas_evidencias_get_qa_sem_pix%ROWTYPE;
 v_historico boolean;
 v_inicio_ok boolean;
 v_evidencia_ok boolean;
 v_estado text;
BEGIN
 IF pg_catalog.current_database() NOT IN ('postgres','catalogo_cob06_ci')
 OR p_lote IS NULL
 OR (pg_catalog.current_database()='postgres'
  AND p_lote IS DISTINCT FROM '583d761a-ecb9-49be-b484-e43f6183971e'::uuid)
 THEN RETURN pg_catalog.jsonb_build_object(
   'ok',false,'motivo','fora_do_ensaio','hold_obrigatorio',true,
   'pode_consultar_asaas',false,'pode_emitir_pix',false); END IF;

 SELECT * INTO v_l FROM public.catalogo_asaas_acumulo_lotes WHERE id=p_lote;
 SELECT * INTO v_t FROM catalogo_private.catalogo_asaas_tentativas_qa_sem_pix
 WHERE lote_id=p_lote;
 SELECT * INTO v_r FROM public.catalogo_asaas_acumulo_referencias
 WHERE lote_id=p_lote;
 IF v_l.id IS NULL OR v_t.lote_id IS NULL OR v_r.lote_id IS NULL
 OR v_l.estado IS DISTINCT FROM 'preparado'
 OR v_t.comercio_id IS DISTINCT FROM v_l.comercio_id
 OR v_r.comercio_id IS DISTINCT FROM v_l.comercio_id
 OR v_t.operacao_id IS DISTINCT FROM v_r.operacao_id
 OR v_t.referencia IS DISTINCT FROM v_r.referencia
 OR v_r.referencia IS DISTINCT FROM 'guia-acumulo-'||p_lote::text
 OR v_t.valor_centavos IS DISTINCT FROM v_l.total_centavos
 OR v_t.valor_centavos IS DISTINCT FROM v_r.valor_centavos
 OR v_t.post_executado IS DISTINCT FROM false
 OR v_t.pode_emitir_pix IS DISTINCT FROM false
 OR v_r.pode_emitir_pix IS DISTINCT FROM false
 OR v_r.payment_id IS NOT NULL
 THEN RETURN pg_catalog.jsonb_build_object(
  'ok',false,'motivo','vinculo_qa_inconsistente','hold_obrigatorio',true,
  'pode_consultar_asaas',false,'pode_emitir_pix',false); END IF;

 SELECT * INTO v_inicio
 FROM catalogo_private.catalogo_asaas_inicios_get_qa_sem_pix
 WHERE lote_id=p_lote;
 SELECT * INTO v_evidencia
 FROM catalogo_private.catalogo_asaas_evidencias_get_qa_sem_pix
 WHERE lote_id=p_lote;
 v_inicio_ok := v_inicio.lote_id IS NOT NULL;
 v_evidencia_ok := v_evidencia.lote_id IS NOT NULL;
 IF (v_inicio_ok AND (
    v_inicio.operacao_id IS DISTINCT FROM v_t.operacao_id
    OR v_inicio.referencia IS DISTINCT FROM v_t.referencia
    OR v_inicio.cliente_id IS DISTINCT FROM v_t.cliente_id
    OR v_inicio.valor_centavos IS DISTINCT FROM v_t.valor_centavos
    OR v_inicio.pode_repetir_get IS DISTINCT FROM false
    OR v_inicio.pode_emitir_pix IS DISTINCT FROM false))
 OR (v_evidencia_ok AND (
    NOT v_inicio_ok
    OR v_evidencia.operacao_id IS DISTINCT FROM v_t.operacao_id
    OR v_evidencia.referencia IS DISTINCT FROM v_t.referencia
    OR v_evidencia.cliente_id IS DISTINCT FROM v_t.cliente_id
    OR v_evidencia.valor_centavos IS DISTINCT FROM v_t.valor_centavos
    OR v_evidencia.http_status IS DISTINCT FROM 200
    OR v_evidencia.total_count IS DISTINCT FROM 0
    OR v_evidencia.itens_count IS DISTINCT FROM 0
    OR v_evidencia.has_more IS DISTINCT FROM false
    OR v_evidencia.prova_bancaria_suficiente IS DISTINCT FROM false
    OR v_evidencia.pode_emitir_pix IS DISTINCT FROM false))
 THEN RETURN pg_catalog.jsonb_build_object(
  'ok',false,'motivo','trilha_qa_inconsistente',
  'hold_obrigatorio',true,'pode_consultar_asaas',false,
  'pode_emitir_pix',false); END IF;

 v_historico := pg_catalog.current_database()='postgres'
  AND p_lote='583d761a-ecb9-49be-b484-e43f6183971e'::uuid;
 v_estado:=CASE
  WHEN v_historico AND NOT v_evidencia_ok THEN 'get_historico_sem_prova'
  WHEN v_evidencia_ok THEN 'evidencia_local_registrada'
  WHEN v_inicio_ok THEN 'get_iniciado_sem_evidencia'
  ELSE 'sem_get_registrado'
 END;
 RETURN pg_catalog.jsonb_build_object(
  'ok',true,'lote_id',p_lote,'estado',v_estado,
  'get_iniciado',v_inicio_ok,
  'evidencia_get_persistida',v_evidencia_ok,
  'get_historico_sem_prova',v_historico AND NOT v_evidencia_ok,
  'prova_get_externa',false,
  'pode_consultar_asaas',false,'pode_repetir_get',false,
  'post_executado',false,'pode_emitir_pix',false,
  'pode_quitar',false,'pode_estornar',false,
  'pode_liberar_motoboy',false,'hold_obrigatorio',true);
END;
$estado$;
REVOKE ALL ON FUNCTION
 public.catalogo_asaas_consultar_estado_get_qa_sem_pix(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION
 public.catalogo_asaas_consultar_estado_get_qa_sem_pix(uuid)
 TO service_role;
COMMIT;
