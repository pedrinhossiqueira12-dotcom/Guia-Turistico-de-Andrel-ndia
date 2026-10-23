-- COB-06: dados sinteticos duraveis APENAS ate destruir catalogo_cob06_ci.
-- Exclusivamente para duas transacoes PostgreSQL concorrentes na CI.
-- Nenhuma consulta Asaas, pagamento, saque ou mutacao STAGING/PROD.
BEGIN;
DO $fixture$
DECLARE
 v_p1 uuid; v_p2 uuid; v_f1 uuid; v_f2 uuid;
 v_r jsonb; v_lote uuid; v_ref jsonb;
BEGIN
 IF pg_catalog.current_database() IS DISTINCT FROM 'catalogo_cob06_ci'
    OR pg_catalog.inet_server_port() IS DISTINCT FROM 5432
    OR current_user IS DISTINCT FROM 'postgres'
 THEN RAISE EXCEPTION 'COB06_GATE_RACE_CI_ONLY'; END IF;
 IF EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_lotes)
    OR EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_tentativas_emissao_ci)
 THEN RAISE EXCEPTION 'COB06_GATE_RACE: banco nao vazio'; END IF;

 INSERT INTO public.catalogo_pedidos(
  comercio_id,referencia_externa,provedor,idempotency_key,status,
  status_pagamento,modalidade,forma_pagamento,subtotal_produtos_centavos,
  entrega_centavos,total_centavos,taxa_plataforma_centavos,
  repasse_bruto_comercio_centavos,cliente_nome,cliente_telefone,
  versao_financeira,taxa_motoboy_centavos,taxa_total_centavos,
  entrega_status,metadata,codigo_entrega_usado_em
 ) VALUES(
  'comercio-de-exemplo','ci-cob06-gate-race-100','offline',pg_catalog.gen_random_uuid(),
  'entregue','aprovado','entrega','dinheiro',1429,0,1429,71,1329,
  'Pedido CI','00000000000',2,29,100,'entregue',
  '{"cob06":"gate-race"}'::jsonb,pg_catalog.now()) RETURNING id INTO v_p1;
 INSERT INTO public.catalogo_pedidos(
  comercio_id,referencia_externa,provedor,idempotency_key,status,
  status_pagamento,modalidade,forma_pagamento,subtotal_produtos_centavos,
  entrega_centavos,total_centavos,taxa_plataforma_centavos,
  repasse_bruto_comercio_centavos,cliente_nome,cliente_telefone,
  versao_financeira,taxa_motoboy_centavos,taxa_total_centavos,
  entrega_status,metadata,codigo_entrega_usado_em
 ) VALUES(
  'comercio-de-exemplo','ci-cob06-gate-race-400','offline',pg_catalog.gen_random_uuid(),
  'entregue','aprovado','entrega','dinheiro',5714,0,5714,286,5314,
  'Pedido CI','00000000000',2,114,400,'entregue',
  '{"cob06":"gate-race"}'::jsonb,pg_catalog.now()) RETURNING id INTO v_p2;

 INSERT INTO public.catalogo_fechamentos_offline(
  comercio_id,competencia,total_pedidos,total_comissao_centavos,status)
 VALUES('comercio-de-exemplo','2040-03-01',1,100,'faturado') RETURNING id INTO v_f1;
 INSERT INTO public.catalogo_fechamentos_offline(
  comercio_id,competencia,total_pedidos,total_comissao_centavos,status)
 VALUES('comercio-de-exemplo','2040-04-01',1,400,'faturado') RETURNING id INTO v_f2;
 INSERT INTO public.catalogo_fatura_componentes_v2(fechamento_id,pedido_id,tipo,valor_centavos)
 VALUES(v_f1,v_p1,'plataforma',71),(v_f1,v_p1,'logistica',29),
       (v_f2,v_p2,'plataforma',286),(v_f2,v_p2,'logistica',114);
 INSERT INTO public.catalogo_comissoes_offline(
  pedido_id,comercio_id,competencia,subtotal_produtos_centavos,
  taxa_percentual,valor_comissao_centavos,status,
  taxa_plataforma_centavos,taxa_motoboy_centavos,valor_total_centavos,
  versao_financeira,motoboy_id,financiamento_logistica_comprovado
 ) VALUES
  (v_p1,'comercio-de-exemplo','2040-03-01',1429,5,100,'faturada',
   71,29,100,2,'00000000-0000-4000-8000-000000000099'::uuid,false),
  (v_p2,'comercio-de-exemplo','2040-04-01',5714,5,400,'faturada',
   286,114,400,2,'00000000-0000-4000-8000-000000000099'::uuid,false);
 IF NOT EXISTS(SELECT 1 FROM public.catalogo_asaas_clientes
  WHERE comercio_id='comercio-de-exemplo')
 THEN INSERT INTO public.catalogo_asaas_clientes(comercio_id,cliente_id)
  VALUES('comercio-de-exemplo','cus_cob06_gate_race_123'); END IF;

 v_r:=public.catalogo_asaas_reservar_acumulo('comercio-de-exemplo','2040-04-01');
 IF v_r->>'ok' IS DISTINCT FROM 'true' OR
    (v_r->>'total_centavos')::bigint IS DISTINCT FROM 500
 THEN RAISE EXCEPTION 'COB06_GATE_RACE: reserva recusada: %',v_r; END IF;
 v_lote:=(v_r->>'lote_id')::uuid;
 IF (public.catalogo_asaas_conferir_conciliacao_acumulo(v_lote)
   ->>'integridade_contabil_ok') IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'COB06_GATE_RACE: origens sem integridade'; END IF;
 v_ref:=public.catalogo_asaas_reservar_referencia_acumulo(v_lote);
 IF v_ref->>'ok' IS DISTINCT FROM 'true' OR
    v_ref->>'pode_emitir_pix' IS DISTINCT FROM 'false'
 THEN RAISE EXCEPTION 'COB06_GATE_RACE: referencia recusada: %',v_ref; END IF;
 IF (SELECT pg_catalog.count(*) FROM public.catalogo_asaas_acumulo_fontes
    WHERE lote_id=v_lote) IS DISTINCT FROM 2
 THEN RAISE EXCEPTION 'COB06_GATE_RACE: fontes divergentes'; END IF;
 RAISE NOTICE 'COB06_GATE_RACE_FIXTURE_CI_OK';
END;
$fixture$;
COMMIT;
