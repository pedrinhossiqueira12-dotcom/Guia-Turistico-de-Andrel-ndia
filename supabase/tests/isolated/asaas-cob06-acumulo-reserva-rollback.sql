-- COB-06: teste da reserva LOCAL, sem Asaas, sem webhook, sem saque.
-- Apenas no PostgreSQL sintetico catalogo_cob06_ci, com ROLLBACK.
BEGIN;
DO $teste$
DECLARE
 v_p1 uuid; v_p2 uuid;
 v_f1 uuid; v_f2 uuid;
 v_r jsonb; v_outro jsonb; v_id uuid;
 v_negativas integer:=0;
BEGIN
 IF pg_catalog.current_database()<>'catalogo_cob06_ci'
 OR pg_catalog.inet_server_port()<>5432
 OR pg_catalog.to_regprocedure('public.catalogo_asaas_reservar_acumulo(text,date)') IS NULL
 THEN RAISE EXCEPTION 'COB06_RESERVA: somente catalogo_cob06_ci'; END IF;
 IF pg_catalog.has_function_privilege('anon',
  'public.catalogo_asaas_reservar_acumulo(text,date)','EXECUTE')
 OR pg_catalog.has_function_privilege('authenticated',
  'public.catalogo_asaas_reservar_acumulo(text,date)','EXECUTE')
 OR NOT pg_catalog.has_function_privilege('service_role',
  'public.catalogo_asaas_reservar_acumulo(text,date)','EXECUTE')
 THEN RAISE EXCEPTION 'COB06_RESERVA: privilegios incorretos'; END IF;

 INSERT INTO public.catalogo_pedidos(
  comercio_id,referencia_externa,provedor,idempotency_key,status,
  status_pagamento,modalidade,forma_pagamento,subtotal_produtos_centavos,
  entrega_centavos,total_centavos,taxa_plataforma_centavos,
  repasse_bruto_comercio_centavos,cliente_nome,cliente_telefone,
  versao_financeira,taxa_motoboy_centavos,taxa_total_centavos,
  entrega_status,metadata
 ) VALUES(
  'comercio-de-exemplo','ci-cob06-acumulo-100','offline',pg_catalog.gen_random_uuid(),
  'entregue','aprovado','entrega','dinheiro',1600,
  0,1600,80,1500,'Pedido sintetico','00000000000',2,20,100,
  'entregue','{"cob06":"acumulo-R1"}'::jsonb)
 RETURNING id INTO v_p1;
 INSERT INTO public.catalogo_pedidos(
  comercio_id,referencia_externa,provedor,idempotency_key,status,
  status_pagamento,modalidade,forma_pagamento,subtotal_produtos_centavos,
  entrega_centavos,total_centavos,taxa_plataforma_centavos,
  repasse_bruto_comercio_centavos,cliente_nome,cliente_telefone,
  versao_financeira,taxa_motoboy_centavos,taxa_total_centavos,
  entrega_status,metadata
 ) VALUES(
  'comercio-de-exemplo','ci-cob06-acumulo-400','offline',pg_catalog.gen_random_uuid(),
  'entregue','aprovado','entrega','dinheiro',6400,
  0,6400,320,6000,'Pedido sintetico','00000000000',2,80,400,
  'entregue','{"cob06":"acumulo-R4"}'::jsonb)
 RETURNING id INTO v_p2;

 INSERT INTO public.catalogo_fechamentos_offline(
  comercio_id,competencia,total_pedidos,total_comissao_centavos,status)
 VALUES('comercio-de-exemplo','2040-03-01',1,100,'faturado')
 RETURNING id INTO v_f1;
 INSERT INTO public.catalogo_fechamentos_offline(
  comercio_id,competencia,total_pedidos,total_comissao_centavos,status)
 VALUES('comercio-de-exemplo','2040-04-01',1,400,'faturado')
 RETURNING id INTO v_f2;

 INSERT INTO public.catalogo_fatura_componentes_v2(
  fechamento_id,pedido_id,tipo,valor_centavos)
 VALUES(v_f1,v_p1,'plataforma',80),(v_f1,v_p1,'logistica',20),
       (v_f2,v_p2,'plataforma',320),(v_f2,v_p2,'logistica',80);

 v_r:=public.catalogo_asaas_reservar_acumulo(
  'comercio-de-exemplo','2040-03-01');
 IF v_r->>'ok'<>'false'
    OR v_r->>'motivo'<>'minimo_ou_fontes_insuficientes'
 THEN RAISE EXCEPTION 'COB06_RESERVA: R1 nao bloqueado: %',v_r; END IF;
 v_r:=public.catalogo_asaas_reservar_acumulo(
  'comercio-de-exemplo','2040-04-01');
 IF v_r->>'ok'<>'true' OR v_r->>'ja_reservado'<>'false'
 OR (v_r->>'total_centavos')::bigint<>500
 OR (v_r->>'quantidade_faturas')::integer<>2
 OR v_r->>'pix_emitido'<>'false'
 THEN RAISE EXCEPTION 'COB06_RESERVA: R1+R4 falhou: %',v_r; END IF;
 v_id:=(v_r->>'lote_id')::uuid;
 v_outro:=public.catalogo_asaas_reservar_acumulo(
  'comercio-de-exemplo','2040-04-01');
 IF v_outro->>'ja_reservado'<>'true'
 OR (v_outro->>'lote_id')::uuid IS DISTINCT FROM v_id
 OR (SELECT pg_catalog.sum(valor_centavos)
    FROM public.catalogo_asaas_acumulo_fontes WHERE lote_id=v_id)<>500
 OR (SELECT pg_catalog.count(*) FROM public.catalogo_asaas_acumulo_fontes
    WHERE lote_id=v_id)<>2
 THEN RAISE EXCEPTION 'COB06_RESERVA: idempotencia ou fontes divergentes'; END IF;

 BEGIN
  INSERT INTO public.catalogo_asaas_emissoes(fechamento_id) VALUES(v_f1);
  RAISE EXCEPTION 'COB06_RESERVA: emissao individual aceita';
 EXCEPTION WHEN SQLSTATE '23514' THEN v_negativas:=v_negativas+1;
 END;
 BEGIN
  INSERT INTO public.catalogo_fatura_cobrancas(
    fechamento_id,comercio_id,competencia,gateway,
    order_id,status,valor_centavos)
  VALUES(v_f2,'comercio-de-exemplo','2040-04-01',
    'asaas','ci-cob06-nao-cobrar','pendente',400);
  RAISE EXCEPTION 'COB06_RESERVA: cobranca individual aceita';
 EXCEPTION WHEN SQLSTATE '23514' THEN v_negativas:=v_negativas+1;
 END;
 BEGIN
  UPDATE public.catalogo_fechamentos_offline SET total_comissao_centavos=101
  WHERE id=v_f1;
  RAISE EXCEPTION 'COB06_RESERVA: total do fechamento alterado';
 EXCEPTION WHEN SQLSTATE '23514' THEN v_negativas:=v_negativas+1;
 END;
 BEGIN
  DELETE FROM public.catalogo_fatura_componentes_v2
  WHERE fechamento_id=v_f2;
  RAISE EXCEPTION 'COB06_RESERVA: componentes alterados';
 EXCEPTION WHEN SQLSTATE '23514' THEN v_negativas:=v_negativas+1;
 END;
 IF v_negativas<>4
 OR (SELECT valor_centavos FROM public.catalogo_fatura_componentes_v2
       WHERE fechamento_id=v_f1 AND tipo='plataforma')<>80
 OR (SELECT status FROM public.catalogo_fechamentos_offline WHERE id=v_f1)<>'faturado'
 OR (SELECT status FROM public.catalogo_fatura_cobrancas
       WHERE order_id='legacy-cob06-ci')<>'pago'
 THEN RAISE EXCEPTION 'COB06_RESERVA: historico alterado ou bloqueios nao atuaram'; END IF;
 RAISE NOTICE 'COB06_RESERVA_R1_R4_TRANSACIONAL_SEM_PIX_OK';
END;
$teste$;
ROLLBACK;
