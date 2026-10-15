-- COB-06: teste da reserva LOCAL, sem Asaas, sem webhook, sem saque.
-- Apenas no PostgreSQL sintetico catalogo_cob06_ci, com ROLLBACK.
BEGIN;
DO $teste$
DECLARE
 v_p1 uuid; v_p2 uuid;
 v_f1 uuid; v_f2 uuid;
 v_r jsonb; v_outro jsonb; v_id uuid;
 v_negativas integer:=0;
 v_i integer;
 v_mais_pedido uuid;
 v_mais_fatura uuid;
 v_mais_comp date;
 v_valor integer;
 v_subtotal integer;
 v_plataforma integer;
 v_logistica integer;
 v_lote_extra uuid;
 v_referencia jsonb;
 v_repeticao jsonb;
 v_id_operacao uuid;
 v_negativas_ref integer:=0;
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
  'entregue','aprovado','entrega','dinheiro',1429,
  0,1429,71,1329,'Pedido sintetico','00000000000',2,29,100,
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
  'entregue','aprovado','entrega','dinheiro',5714,
  0,5714,286,5314,'Pedido sintetico','00000000000',2,114,400,
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
 VALUES(v_f1,v_p1,'plataforma',71),(v_f1,v_p1,'logistica',29),
       (v_f2,v_p2,'plataforma',286),(v_f2,v_p2,'logistica',114);

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
 -- Segundo cenário aprovado: três competências R$2 + R$2 + R$1,
 -- sem reutilizar as fontes de R$1+R$4 já reservadas.
 FOR v_i IN 1..3 LOOP
   v_mais_comp:=pg_catalog.make_date(2040,4+v_i,1);
   v_valor:=CASE WHEN v_i<=2 THEN 200 ELSE 100 END;
   v_subtotal:=CASE WHEN v_i<=2 THEN 2857 ELSE 1429 END;
   v_plataforma:=CASE WHEN v_i<=2 THEN 143 ELSE 71 END;
   v_logistica:=CASE WHEN v_i<=2 THEN 57 ELSE 29 END;
   INSERT INTO public.catalogo_pedidos(
     comercio_id,referencia_externa,provedor,idempotency_key,status,
     status_pagamento,modalidade,forma_pagamento,subtotal_produtos_centavos,
     entrega_centavos,total_centavos,taxa_plataforma_centavos,
     repasse_bruto_comercio_centavos,cliente_nome,cliente_telefone,
     versao_financeira,taxa_motoboy_centavos,taxa_total_centavos,
     entrega_status,metadata
   ) VALUES(
     'comercio-de-exemplo','ci-cob06-acumulo-extra-'||v_i,'offline',
     pg_catalog.gen_random_uuid(),'entregue','aprovado','entrega','dinheiro',
     v_subtotal,0,v_subtotal,v_plataforma,v_subtotal-v_valor,
     'Pedido sintetico','00000000000',2,v_logistica,v_valor,
     'entregue','{"cob06":"acumulo-tres-meses"}'::jsonb)
   RETURNING id INTO v_mais_pedido;
   INSERT INTO public.catalogo_fechamentos_offline(
     comercio_id,competencia,total_pedidos,total_comissao_centavos,status)
   VALUES('comercio-de-exemplo',v_mais_comp,1,v_valor,'faturado')
   RETURNING id INTO v_mais_fatura;
   INSERT INTO public.catalogo_fatura_componentes_v2(
     fechamento_id,pedido_id,tipo,valor_centavos)
   VALUES(v_mais_fatura,v_mais_pedido,'plataforma',v_plataforma),
         (v_mais_fatura,v_mais_pedido,'logistica',v_logistica);
 END LOOP;
 v_outro:=public.catalogo_asaas_reservar_acumulo(
   'comercio-de-exemplo','2040-07-01');
 IF v_outro->>'ok'<>'true' OR v_outro->>'ja_reservado'<>'false'
 OR (v_outro->>'total_centavos')::bigint<>500
 OR (v_outro->>'quantidade_faturas')::integer<>3
 OR v_outro->>'pix_emitido'<>'false'
 THEN RAISE EXCEPTION 'COB06_RESERVA: R2+R2+R1 falhou: %',v_outro; END IF;
 v_lote_extra:=(v_outro->>'lote_id')::uuid;
 IF v_lote_extra IS NOT DISTINCT FROM v_id
    OR (SELECT pg_catalog.count(*) FROM public.catalogo_asaas_acumulo_fontes
        WHERE lote_id=v_lote_extra)<>3
    OR (SELECT pg_catalog.sum(valor_centavos) FROM public.catalogo_asaas_acumulo_fontes
        WHERE lote_id=v_lote_extra)<>500
    OR (SELECT pg_catalog.count(*) FROM public.catalogo_asaas_acumulo_fontes
        WHERE lote_id=v_id)<>2
 THEN RAISE EXCEPTION 'COB06_RESERVA: fonte duplicada entre lotes'; END IF;

 -- A conferência de liquidação analisa parcelas por pedido e competência.
 -- A fixture propositalmente não tem comissão confirmada nem código usado:
 -- mesmo havendo R$5 reservados, a liquidação e o crédito são recusados.
 v_outro:=public.catalogo_asaas_conferir_conciliacao_acumulo(v_id);
 IF v_outro->>'ok'<>'true'
    OR (v_outro->>'valor_fontes_centavos')::bigint<>500
    OR (v_outro->>'quantidade_fontes')::bigint<>2
    OR (v_outro->>'parcelas_invalidas')::bigint<>4
    OR v_outro->>'integridade_contabil_ok'<>'false'
    OR v_outro->>'pode_quitar'<>'false'
    OR v_outro->>'pode_estornar'<>'false'
    OR v_outro->>'pode_liberar_motoboy'<>'false'
 THEN RAISE EXCEPTION 'COB06_CONCILIACAO: R1+R4 sem pedido valido autorizou liquidacao: %',v_outro; END IF;
 v_outro:=public.catalogo_asaas_conferir_conciliacao_acumulo(v_lote_extra);
 IF v_outro->>'ok'<>'true'
    OR (v_outro->>'valor_fontes_centavos')::bigint<>500
    OR (v_outro->>'quantidade_fontes')::bigint<>3
    OR (v_outro->>'parcelas_invalidas')::bigint<>6
    OR v_outro->>'integridade_contabil_ok'<>'false'
    OR v_outro->>'pode_emitir_pix'<>'false'
 THEN RAISE EXCEPTION 'COB06_CONCILIACAO: R2+R2+R1 com parcelas sem prova: %',v_outro; END IF;
 v_outro:=public.catalogo_asaas_conferir_conciliacao_acumulo(pg_catalog.gen_random_uuid());
 IF v_outro->>'ok'<>'false' OR v_outro->>'motivo'<>'lote_inexistente'
 THEN RAISE EXCEPTION 'COB06_CONCILIACAO: lote inexistente aceito'; END IF;
 RAISE NOTICE 'COB06_CONCILIACAO_ORIGENS_INCOMPLETAS_BLOQUEADAS_SEM_CREDITO_OK';

 -- Candidato 05: referencia bancaria APENAS no livro local.
 IF pg_catalog.has_function_privilege('anon',
    'public.catalogo_asaas_reservar_referencia_acumulo(uuid)','EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated',
    'public.catalogo_asaas_reservar_referencia_acumulo(uuid)','EXECUTE')
    OR pg_catalog.has_table_privilege('service_role',
    'public.catalogo_asaas_acumulo_referencias','INSERT')
 THEN RAISE EXCEPTION 'COB06_REFERENCIA: privilegios inseguros'; END IF;

 -- Com origem incompleta, nao sequer criar a referencia financeira.
 v_referencia:=public.catalogo_asaas_reservar_referencia_acumulo(v_id);
 IF v_referencia->>'ok'<>'false'
 OR v_referencia->>'motivo'<>'integridade_contabil_incompleta'
 OR EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_referencias)
 THEN RAISE EXCEPTION 'COB06_REFERENCIA: lote incompleto reservou banco: %',v_referencia; END IF;

 -- Somente no ROLLBACK: comprovacao sintética de entrega e comissoes originais.
 UPDATE public.catalogo_pedidos
 SET codigo_entrega_usado_em=pg_catalog.now()
 WHERE id IN (v_p1,v_p2);

 INSERT INTO public.catalogo_comissoes_offline(
  pedido_id,comercio_id,competencia,subtotal_produtos_centavos,
  taxa_percentual,valor_comissao_centavos,status,
  taxa_plataforma_centavos,taxa_motoboy_centavos,valor_total_centavos,
  versao_financeira,motoboy_id,financiamento_logistica_comprovado
 ) VALUES
  (v_p1,'comercio-de-exemplo','2040-03-01',1429,
   5,100,'faturada',71,29,100,2,'00000000-0000-4000-8000-000000000099'::uuid,false),
  (v_p2,'comercio-de-exemplo','2040-04-01',5714,
   5,400,'faturada',286,114,400,2,'00000000-0000-4000-8000-000000000099'::uuid,false);

 v_outro:=public.catalogo_asaas_conferir_conciliacao_acumulo(v_id);
 IF v_outro->>'integridade_contabil_ok'<>'true'
   OR (v_outro->>'valor_fontes_centavos')::bigint<>500
 THEN RAISE EXCEPTION 'COB06_REFERENCIA: origens completas rejeitadas: %',v_outro; END IF;

 v_referencia:=public.catalogo_asaas_reservar_referencia_acumulo(v_id);
 IF v_referencia->>'ok'<>'true'
 OR v_referencia->>'ja_reservada'<>'false'
 OR v_referencia->>'referencia' IS DISTINCT FROM 'guia-acumulo-'||v_id::text
 OR (v_referencia->>'valor_centavos')::bigint<>500
 OR v_referencia->>'pode_emitir_pix'<>'false'
 OR v_referencia->>'payment_id' IS NOT NULL
 THEN RAISE EXCEPTION 'COB06_REFERENCIA: reserva imutavel incorreta: %',v_referencia; END IF;
 v_id_operacao:=(v_referencia->>'operacao_id')::uuid;
 v_repeticao:=public.catalogo_asaas_reservar_referencia_acumulo(v_id);
 IF v_repeticao->>'ok'<>'true' OR v_repeticao->>'ja_reservada'<>'true'
 OR (v_repeticao->>'operacao_id')::uuid IS DISTINCT FROM v_id_operacao
 OR v_repeticao->>'referencia' IS DISTINCT FROM v_referencia->>'referencia'
 OR (SELECT pg_catalog.count(*) FROM public.catalogo_asaas_acumulo_referencias)<>1
 THEN RAISE EXCEPTION 'COB06_REFERENCIA: retry duplicou referencia: %',v_repeticao; END IF;

 -- A outra competencia/lote da mesma loja tem reserva ainda em conferencia.
 -- A trava em indice unico deve impedir a criacao paralela.
 BEGIN
  INSERT INTO public.catalogo_asaas_acumulo_referencias(
    lote_id,comercio_id,referencia,valor_centavos)
  VALUES(v_lote_extra,'comercio-de-exemplo',
    'guia-acumulo-'||v_lote_extra::text,500);
  RAISE EXCEPTION 'COB06_REFERENCIA: segunda intencao da loja permitida';
 EXCEPTION WHEN unique_violation THEN v_negativas_ref:=v_negativas_ref+1;
 END;
 BEGIN
  UPDATE public.catalogo_asaas_acumulo_referencias
  SET referencia='outra-referencia' WHERE lote_id=v_id;
  RAISE EXCEPTION 'COB06_REFERENCIA: ref alterada';
 EXCEPTION WHEN SQLSTATE '23514' THEN v_negativas_ref:=v_negativas_ref+1;
 END;
 BEGIN
  DELETE FROM public.catalogo_asaas_acumulo_referencias WHERE lote_id=v_id;
  RAISE EXCEPTION 'COB06_REFERENCIA: ref apagada';
 EXCEPTION WHEN SQLSTATE '23514' THEN v_negativas_ref:=v_negativas_ref+1;
 END;

 IF v_negativas_ref<>3
 OR (SELECT payment_id FROM public.catalogo_asaas_acumulo_referencias
     WHERE lote_id=v_id) IS NOT NULL
 OR (SELECT status FROM public.catalogo_fechamentos_offline WHERE id=v_f1)<>'faturado'
 OR (SELECT status FROM public.catalogo_fatura_cobrancas
     WHERE order_id='legacy-cob06-ci')<>'pago'
 THEN RAISE EXCEPTION 'COB06_REFERENCIA: retorno mudou fatura, Pix ou intencao'; END IF;
 RAISE NOTICE 'COB06_REFERENCIA_UNICA_IDEMPOTENTE_SEM_PIX_OK';

 IF v_negativas<>4
 OR (SELECT valor_centavos FROM public.catalogo_fatura_componentes_v2
       WHERE fechamento_id=v_f1 AND tipo='plataforma')<>71
 OR (SELECT status FROM public.catalogo_fechamentos_offline WHERE id=v_f1)<>'faturado'
 OR (SELECT status FROM public.catalogo_fatura_cobrancas
       WHERE order_id='legacy-cob06-ci')<>'pago'
 THEN RAISE EXCEPTION 'COB06_RESERVA: historico alterado ou bloqueios nao atuaram'; END IF;
 RAISE NOTICE 'COB06_RESERVA_R1_R4_R2_R2_R1_TRANSACIONAL_SEM_PIX_OK';
END;
$teste$;
ROLLBACK;
