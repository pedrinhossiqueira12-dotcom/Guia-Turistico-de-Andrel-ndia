-- COB-06: preparar livros retidos para GET -> RECEIVED -> baixa -> REFUNDED.
-- COMMIT exclusivo do PostgreSQL efemero catalogo_cob06_ci, destruido na CI.
-- Nunca usar contra Supabase, STAGING, producao ou bancos persistentes.
BEGIN;
DO $fixture$
DECLARE
 v_p1 uuid;
 v_p2 uuid;
 v_r1 uuid;
 v_r2 uuid;
BEGIN
 IF pg_catalog.current_database() IS DISTINCT FROM 'catalogo_cob06_ci'
    OR pg_catalog.inet_server_port() IS DISTINCT FROM 5432
    OR current_user IS DISTINCT FROM 'postgres'
 THEN RAISE EXCEPTION 'COB06_LIQUIDACAO_GET_CI_ONLY' USING ERRCODE='42501'; END IF;
 SELECT id INTO STRICT v_p1 FROM public.catalogo_pedidos
 WHERE referencia_externa='ci-cob06-gate-race-100';
 SELECT id INTO STRICT v_p2 FROM public.catalogo_pedidos
 WHERE referencia_externa='ci-cob06-gate-race-400';
 IF (SELECT pg_catalog.count(*) FROM public.catalogo_asaas_acumulo_lotes
     WHERE comercio_id='comercio-de-exemplo' AND total_centavos=500 AND estado='preparado')<>1
    OR (SELECT pg_catalog.count(*) FROM public.catalogo_asaas_acumulo_tentativas_emissao_ci)<>1
    OR EXISTS(SELECT 1 FROM public.catalogo_remuneracoes_v2
              WHERE pedido_id IN (v_p1,v_p2))
    OR EXISTS(SELECT 1 FROM public.catalogo_lancamentos_financeiros_v2
              WHERE pedido_id IN (v_p1,v_p2))
    OR EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_observacoes)
    OR EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_eventos)
 THEN RAISE EXCEPTION 'COB06_LIQUIDACAO_GET: fixture inicial divergente'; END IF;

 INSERT INTO auth.users(id) VALUES
  ('00000000-0000-4000-8000-000000000099'::uuid)
 ON CONFLICT(id) DO NOTHING;
 INSERT INTO public.catalogo_remuneracoes_v2(
   pedido_id,comercio_id,motoboy_id,valor_centavos,status,financiamento_comprovado)
 VALUES(v_p1,'comercio-de-exemplo',
   '00000000-0000-4000-8000-000000000099'::uuid,29,'retido',false)
 RETURNING id INTO v_r1;
 INSERT INTO public.catalogo_remuneracoes_v2(
   pedido_id,comercio_id,motoboy_id,valor_centavos,status,financiamento_comprovado)
 VALUES(v_p2,'comercio-de-exemplo',
   '00000000-0000-4000-8000-000000000099'::uuid,114,'retido',false)
 RETURNING id INTO v_r2;
 INSERT INTO public.catalogo_lancamentos_financeiros_v2(
   pedido_id,tipo,valor_centavos,status,chave_idempotencia)
 VALUES(v_p1,'comissao_plataforma',71,'retido','ci-cob06-get-plataforma-1'),
       (v_p2,'comissao_plataforma',286,'retido','ci-cob06-get-plataforma-2');
 INSERT INTO public.catalogo_lancamentos_financeiros_v2(
   pedido_id,remuneracao_id,beneficiario_id,tipo,
   valor_centavos,status,chave_idempotencia)
 VALUES(v_p1,v_r1,'00000000-0000-4000-8000-000000000099'::uuid,
        'remuneracao_motoboy',29,'retido','ci-cob06-get-entrega-1'),
       (v_p2,v_r2,'00000000-0000-4000-8000-000000000099'::uuid,
        'remuneracao_motoboy',114,'retido','ci-cob06-get-entrega-2');
 RAISE NOTICE 'COB06_LIQUIDACAO_GET_LIVROS_RETIDOS_CI_OK';
END;
$fixture$;
COMMIT;
