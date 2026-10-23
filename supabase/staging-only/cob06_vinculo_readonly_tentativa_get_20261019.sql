-- COB-06 / PR #39: somente leitura do recibo QA ja reservado.
-- NAO e migracao de producao, NAO cria outra tentativa, NAO autoriza PIX.
-- Arquivo candidato: ainda nao aplicado no STAGING; validar na CI isolada.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

DO $guard$
BEGIN
 IF current_user IS DISTINCT FROM 'postgres'
 OR pg_catalog.current_database() NOT IN ('postgres','catalogo_cob06_ci')
 THEN RAISE EXCEPTION 'COB06_VINCULO_QA_ONLY: banco ou owner inesperado'
  USING ERRCODE='42501'; END IF;
 IF pg_catalog.to_regclass('catalogo_private.catalogo_asaas_tentativas_qa_sem_pix') IS NULL
 THEN RAISE EXCEPTION 'COB06_VINCULO_QA_ONLY: livro imutavel ausente'
  USING ERRCODE='42501'; END IF;
 -- Em Supabase o banco costuma chamar-se postgres em STAGING e PROD.
 -- Exigir o alvo sintetico exato antes de criar qualquer RPC nesse banco.
 IF pg_catalog.current_database()='postgres' AND NOT EXISTS (
  SELECT 1 FROM catalogo_private.catalogo_asaas_tentativas_qa_sem_pix t
  JOIN public.catalogo_asaas_acumulo_lotes l ON l.id=t.lote_id
  JOIN public.catalogo_asaas_acumulo_referencias r ON r.lote_id=t.lote_id
  WHERE t.lote_id='583d761a-ecb9-49be-b484-e43f6183971e'::uuid
   AND t.comercio_id='asaas-cob02' AND l.comercio_id=t.comercio_id
   AND l.estado='preparado' AND l.total_centavos=560
   AND t.valor_centavos=560 AND r.valor_centavos=560
   AND t.referencia='guia-acumulo-583d761a-ecb9-49be-b484-e43f6183971e'
   AND r.referencia=t.referencia AND r.estado='reservado'
   AND r.payment_id IS NULL AND r.pode_emitir_pix=false
   AND t.post_executado=false AND t.pode_emitir_pix=false
   AND t.pode_quitar=false AND t.pode_liberar_motoboy=false
 ) THEN RAISE EXCEPTION 'COB06_VINCULO_QA_ONLY: recibo STAGING nao comprovado'
   USING ERRCODE='42501'; END IF;
END;
$guard$;

-- RLS privado permanece; API publica expõe SOMENTE a RPC restrita a service_role.
-- Funcao STABLE: sem UPDATE, INSERT, DELETE nem chamada ao Asaas.
CREATE OR REPLACE FUNCTION public.catalogo_asaas_conferir_vinculo_tentativa_qa_sem_pix(p_lote uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $vinculo$
DECLARE
 v_t catalogo_private.catalogo_asaas_tentativas_qa_sem_pix%ROWTYPE;
 v_l public.catalogo_asaas_acumulo_lotes%ROWTYPE;
 v_r public.catalogo_asaas_acumulo_referencias%ROWTYPE;
 v_cliente text;
 v_preflight jsonb;
BEGIN
 IF p_lote IS NULL OR pg_catalog.current_database() NOT IN ('postgres','catalogo_cob06_ci')
 OR (pg_catalog.current_database()='postgres' AND
  p_lote IS DISTINCT FROM '583d761a-ecb9-49be-b484-e43f6183971e'::uuid)
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','fora_do_ensaio'); END IF;
 SELECT * INTO v_t FROM catalogo_private.catalogo_asaas_tentativas_qa_sem_pix
 WHERE lote_id=p_lote;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','sem_reserva'); END IF;
 SELECT * INTO v_l FROM public.catalogo_asaas_acumulo_lotes WHERE id=p_lote;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','lote_ausente'); END IF;
 SELECT * INTO v_r FROM public.catalogo_asaas_acumulo_referencias WHERE lote_id=p_lote;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','referencia_ausente'); END IF;
 SELECT cliente_id INTO v_cliente FROM public.catalogo_asaas_clientes
 WHERE comercio_id=v_l.comercio_id;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','cliente_ausente'); END IF;

 IF v_t.operacao_id IS DISTINCT FROM v_r.operacao_id
 OR v_t.comercio_id IS DISTINCT FROM v_l.comercio_id
 OR v_r.comercio_id IS DISTINCT FROM v_l.comercio_id
 OR v_t.referencia IS DISTINCT FROM v_r.referencia
 OR v_t.referencia IS DISTINCT FROM 'guia-acumulo-'||p_lote::text
 OR v_t.cliente_id IS DISTINCT FROM v_cliente
 OR v_t.cliente_id !~ '^cus_[A-Za-z0-9_-]{3,120}$'
 OR v_t.valor_centavos IS DISTINCT FROM v_l.total_centavos
 OR v_t.valor_centavos IS DISTINCT FROM v_r.valor_centavos
 OR v_t.valor_centavos NOT BETWEEN 500 AND 2147483647
 OR v_l.estado IS DISTINCT FROM 'preparado'
 OR v_r.estado IS DISTINCT FROM 'reservado'
 OR v_r.payment_id IS NOT NULL OR v_r.pode_emitir_pix IS DISTINCT FROM false
 OR v_t.post_executado IS DISTINCT FROM false
 OR v_t.pode_emitir_pix IS DISTINCT FROM false
 OR v_t.pode_quitar IS DISTINCT FROM false
 OR v_t.pode_liberar_motoboy IS DISTINCT FROM false
 OR v_t.reservada_em IS NULL
 OR EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_observacoes WHERE lote_id=p_lote)
 OR EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_eventos WHERE lote_id=p_lote)
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','estado_divergente'); END IF;
 v_preflight:=public.catalogo_asaas_conferir_conciliacao_acumulo(p_lote);
 IF v_preflight->>'ok' IS DISTINCT FROM 'true'
 OR v_preflight->>'integridade_contabil_ok' IS DISTINCT FROM 'true'
 OR (v_preflight->>'valor_fontes_centavos')::bigint IS DISTINCT FROM v_t.valor_centavos
 OR v_preflight->>'pode_emitir_pix' IS DISTINCT FROM 'false'
 OR v_preflight->>'pode_quitar' IS DISTINCT FROM 'false'
 OR v_preflight->>'pode_liberar_motoboy' IS DISTINCT FROM 'false'
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','fontes_divergentes'); END IF;

 RETURN pg_catalog.jsonb_build_object('ok',true,'lote_id',p_lote,
  'operacao_id',v_t.operacao_id,'comercio_id',v_t.comercio_id,
  'referencia',v_t.referencia,'cliente_id',v_t.cliente_id,
  'valor_centavos',v_t.valor_centavos,'reservada_em',v_t.reservada_em,
  'post_executado',false,'pode_emitir_pix',false,'pode_quitar',false,
  'pode_liberar_motoboy',false,'hold_obrigatorio',true);
END;
$vinculo$;
REVOKE ALL ON FUNCTION public.catalogo_asaas_conferir_vinculo_tentativa_qa_sem_pix(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_conferir_vinculo_tentativa_qa_sem_pix(uuid)
 TO service_role;
COMMIT;
