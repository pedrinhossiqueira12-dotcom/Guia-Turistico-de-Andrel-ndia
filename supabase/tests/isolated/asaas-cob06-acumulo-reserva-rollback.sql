-- COB-06: teste da reserva LOCAL, sem Asaas, sem webhook, sem saque.
-- Apenas no PostgreSQL sintetico catalogo_cob06_ci, com ROLLBACK.
BEGIN;
DO $teste$
DECLARE
 v_p1 uuid; v_p2 uuid; v_p_pendente uuid;
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
 v_cliente_obs text;
 v_obs jsonb;
 v_obs_repetida jsonb;
 v_negativas_obs integer:=0;
 v_evento jsonb;
 v_evento_id bigint;
 v_apuracao jsonb;
 v_projecao jsonb;
 v_ponte_rollback boolean:=false;
 v_atomico_rollback boolean:=false;
 v_atomico jsonb;
 v_rem1 uuid; v_rem2 uuid;
 v_reverso jsonb;
 v_evento_reverso_id bigint;
 v_referencia_paga text;
 v_pago_em_antes timestamptz;
 v_disputa_rollback boolean:=false;
 v_estado_disputa text;
 v_repasse_teste jsonb;
 v_repasse_id uuid;
 v_pago_em_repasse timestamptz;
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

 -- Candidato 06: resposta GET SIMULADA entregue somente a RPC restrita.
 -- Isto testa o livro e NAO equivale a observacao bancaria real autenticada.
 SELECT cliente_id INTO v_cliente_obs
 FROM public.catalogo_asaas_clientes
 WHERE comercio_id='comercio-de-exemplo';
 IF v_cliente_obs IS NULL THEN
   v_cliente_obs:='cus_cob06_observado_1234';
   INSERT INTO public.catalogo_asaas_clientes(comercio_id,cliente_id)
   VALUES('comercio-de-exemplo',v_cliente_obs);
 END IF;
 IF v_cliente_obs !~ '^cus_[A-Za-z0-9_-]{3,120}$'
 THEN RAISE EXCEPTION 'COB06_OBSERVACAO: cliente CI fora do contrato'; END IF;

 IF pg_catalog.has_function_privilege('authenticated',
     'public.catalogo_asaas_registrar_observacao_acumulo(uuid,text,text,text,bigint,text)','EXECUTE')
  OR pg_catalog.has_function_privilege('anon',
     'public.catalogo_asaas_registrar_observacao_acumulo(uuid,text,text,text,bigint,text)','EXECUTE')
  OR NOT pg_catalog.has_function_privilege('service_role',
     'public.catalogo_asaas_registrar_observacao_acumulo(uuid,text,text,text,bigint,text)','EXECUTE')
  OR pg_catalog.has_table_privilege('service_role',
     'public.catalogo_asaas_acumulo_observacoes','INSERT')
 THEN RAISE EXCEPTION 'COB06_OBSERVACAO: privilegios inseguros'; END IF;

 v_obs:=public.catalogo_asaas_registrar_observacao_acumulo(
   v_id,'pay_cob06_obs_123456',v_cliente_obs,v_referencia->>'referencia',499,'RECEIVED');
 IF v_obs->>'ok'<>'false' OR v_obs->>'motivo'<>'evidencia_invalida'
 THEN RAISE EXCEPTION 'COB06_OBSERVACAO: total invalido aceito'; END IF;
 v_obs:=public.catalogo_asaas_registrar_observacao_acumulo(
   v_id,'pay_cob06_obs_123456',v_cliente_obs,
   'guia-acumulo-outra',500,'RECEIVED');
 IF v_obs->>'ok'<>'false' OR v_obs->>'motivo'<>'referencia_ou_valor_divergente'
 THEN RAISE EXCEPTION 'COB06_OBSERVACAO: referencia divergente aceita'; END IF;
 v_obs:=public.catalogo_asaas_registrar_observacao_acumulo(
   v_id,'pay_cob06_obs_123456','cus_outro_456',
   v_referencia->>'referencia',500,'RECEIVED');
 IF v_obs->>'ok'<>'false' OR v_obs->>'motivo'<>'cliente_divergente'
 THEN RAISE EXCEPTION 'COB06_OBSERVACAO: cliente divergente aceito'; END IF;

 -- A primeira observacao tambem reconhece disputa sem habilitar baixa.
 -- Cada estado e revertido em sua propria subtransacao.
 FOREACH v_estado_disputa IN ARRAY ARRAY[
   'CHARGEBACK_DISPUTE','AWAITING_CHARGEBACK_REVERSAL'
 ] LOOP
  BEGIN
   v_obs:=public.catalogo_asaas_registrar_observacao_acumulo(
     v_id,'pay_cob06_obs_123456',v_cliente_obs,
     v_referencia->>'referencia',500,v_estado_disputa);
   IF v_obs->>'ok'<>'true' OR v_obs->>'pode_quitar'<>'false'
     OR v_obs->>'pode_liberar_motoboy'<>'false'
   THEN RAISE EXCEPTION 'COB06_OBSERVACAO: estado adverso recusado: %',v_obs; END IF;
   RAISE EXCEPTION 'COB06_PRIMEIRA_DISPUTA_ROLLBACK_ESPERADO';
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM IS DISTINCT FROM 'COB06_PRIMEIRA_DISPUTA_ROLLBACK_ESPERADO' THEN RAISE; END IF;
  END;
  IF EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_observacoes WHERE lote_id=v_id)
    OR catalogo_private.catalogo_v2_parcela_recebida(v_p1,'plataforma')
  THEN RAISE EXCEPTION 'COB06_OBSERVACAO: teste de disputa deixou residuos'; END IF;
 END LOOP;
 RAISE NOTICE 'COB06_PRIMEIRA_DISPUTA_IMUTAVEL_HOLD_ROLLBACK_OK';

 v_obs:=public.catalogo_asaas_registrar_observacao_acumulo(
   v_id,'pay_cob06_obs_123456',v_cliente_obs,
   v_referencia->>'referencia',500,'RECEIVED');
 IF v_obs->>'ok'<>'true' OR v_obs->>'ja_observado'<>'false'
 OR v_obs->>'pode_quitar'<>'false'
 OR v_obs->>'pode_liberar_motoboy'<>'false'
 THEN RAISE EXCEPTION 'COB06_OBSERVACAO: observacao nao inerte: %',v_obs; END IF;
 v_obs_repetida:=public.catalogo_asaas_registrar_observacao_acumulo(
   v_id,'pay_cob06_obs_123456',v_cliente_obs,
   v_referencia->>'referencia',500,'RECEIVED');
 IF v_obs_repetida->>'ok'<>'true' OR v_obs_repetida->>'ja_observado'<>'true'
 OR (SELECT pg_catalog.count(*) FROM public.catalogo_asaas_acumulo_observacoes)<>1
 THEN RAISE EXCEPTION 'COB06_OBSERVACAO: replay duplicou pagamento'; END IF;
 v_obs:=public.catalogo_asaas_registrar_observacao_acumulo(
   v_id,'pay_cob06_obs_123456',v_cliente_obs,
   v_referencia->>'referencia',500,'REFUNDED');
 IF v_obs->>'ok'<>'false' OR v_obs->>'motivo'<>'observacao_existente_divergente'
 THEN RAISE EXCEPTION 'COB06_OBSERVACAO: mudou status antigo sem evento'; END IF;

 BEGIN
   UPDATE public.catalogo_asaas_acumulo_observacoes
   SET payment_id='pay_cob06_obs_99999' WHERE lote_id=v_id;
   RAISE EXCEPTION 'COB06_OBSERVACAO: sobrescrita permitida';
 EXCEPTION WHEN SQLSTATE '23514' THEN v_negativas_obs:=v_negativas_obs+1;
 END;
 BEGIN
   DELETE FROM public.catalogo_asaas_acumulo_observacoes WHERE lote_id=v_id;
   RAISE EXCEPTION 'COB06_OBSERVACAO: exclusao permitida';
 EXCEPTION WHEN SQLSTATE '23514' THEN v_negativas_obs:=v_negativas_obs+1;
 END;
 IF v_negativas_obs<>2
 OR (SELECT payment_id FROM public.catalogo_asaas_acumulo_observacoes
    WHERE lote_id=v_id)<>'pay_cob06_obs_123456'
 OR (SELECT status FROM public.catalogo_fechamentos_offline WHERE id=v_f1)<>'faturado'
 OR (SELECT status FROM public.catalogo_fatura_cobrancas
    WHERE order_id='legacy-cob06-ci')<>'pago'
 THEN RAISE EXCEPTION 'COB06_OBSERVACAO: alterou estado/credito/historico'; END IF;
 RAISE NOTICE 'COB06_OBSERVACAO_GET_SIMULADO_IMUTAVEL_SEM_BAIXA_OK';

 -- O helper legado depende de cobranca individual paga, ausente neste lote.
 -- Mudar apenas fechamento.status para pago nao liquidaria cada parcela.
 IF catalogo_private.catalogo_v2_parcela_recebida(v_p1,'plataforma')
 OR catalogo_private.catalogo_v2_parcela_recebida(v_p1,'logistica')
 THEN RAISE EXCEPTION 'COB06_PROJECAO: helper legado reconheceu pagamento sem cobranca'; END IF;
 v_projecao:=public.catalogo_asaas_projetar_baixa_acumulo_inerte(v_id);
 IF v_projecao->>'ok'<>'true'
 OR (v_projecao->>'valor_centavos')::integer<>500
 OR (v_projecao->>'plataforma_centavos')::integer<>357
 OR (v_projecao->>'logistica_centavos')::integer<>143
 OR (v_projecao->>'quantidade_competencias')::integer<>2
 OR (v_projecao->>'parcelas')::integer<>4
 OR (v_projecao->>'parcelas_sem_credito_seguro')::integer<>4
 OR v_projecao->>'projecao_contabil_consistente'<>'false'
 OR v_projecao->>'helper_legado_incompativel_sem_cobranca_individual'<>'true'
 OR v_projecao->>'pode_quitar'<>'false'
 OR v_projecao->>'pode_liberar_motoboy'<>'false'
 THEN RAISE EXCEPTION 'COB06_PROJECAO: alocacao por origem ou trava invalida: %',v_projecao; END IF;
 RAISE NOTICE 'COB06_PROJECAO_R1_R4_MES_ORIGINAL_SEM_CREDITO_OK';

 -- A observacao inicial RECEIVED, sozinha, nao autoriza baixa: faltam eventos.
 v_apuracao:=public.catalogo_asaas_apurar_estados_acumulo_inerte(v_id);
 IF v_apuracao->>'candidato_a_conferencia_manual'<>'false'
 OR v_apuracao->>'pode_quitar'<>'false'
 OR v_apuracao->>'classificacao'<>'aguardando_recebimento_verificado'
 THEN RAISE EXCEPTION 'COB06_APURACAO: primeira observacao liquidou sozinha: %',v_apuracao; END IF;

 -- Candidato 07: historico de status inerte, sem simular autenticidade do GET.
 IF pg_catalog.has_function_privilege('anon',
    'public.catalogo_asaas_registrar_evento_acumulo_inerte(uuid,text,text,text)','EXECUTE')
 OR pg_catalog.has_function_privilege('authenticated',
    'public.catalogo_asaas_registrar_evento_acumulo_inerte(uuid,text,text,text)','EXECUTE')
 OR NOT pg_catalog.has_function_privilege('service_role',
    'public.catalogo_asaas_registrar_evento_acumulo_inerte(uuid,text,text,text)','EXECUTE')
 OR pg_catalog.has_table_privilege('service_role',
    'public.catalogo_asaas_acumulo_eventos','INSERT')
 THEN RAISE EXCEPTION 'COB06_EVENTOS: privilegios incorretos'; END IF;
 v_evento:=public.catalogo_asaas_registrar_evento_acumulo_inerte(
   v_id,'pay_outro_123456','ci-cob06-evento-001','REFUNDED');
 IF v_evento->>'motivo'<>'pagamento_nao_vinculado'
 THEN RAISE EXCEPTION 'COB06_EVENTOS: pagamento alheio aceito'; END IF;
 v_evento:=public.catalogo_asaas_registrar_evento_acumulo_inerte(
   v_id,'pay_cob06_obs_123456','ci-cob06-evento-001','RECEIVED');
 IF v_evento->>'ok'<>'true' OR v_evento->>'ja_observado'<>'false'
 OR v_evento->>'pode_quitar'<>'false' OR v_evento->>'pode_estornar'<>'false'
 OR v_evento->>'pode_liberar_motoboy'<>'false'
 THEN RAISE EXCEPTION 'COB06_EVENTOS: gravacao nao inerte: %',v_evento; END IF;
 v_evento_id:=(v_evento->>'evento_id')::bigint;
 v_evento:=public.catalogo_asaas_registrar_evento_acumulo_inerte(
   v_id,'pay_cob06_obs_123456','ci-cob06-evento-001','RECEIVED');
 IF v_evento->>'ja_observado'<>'true'
 OR (v_evento->>'evento_id')::bigint<>v_evento_id
 THEN RAISE EXCEPTION 'COB06_EVENTOS: replay duplicado'; END IF;
 v_apuracao:=public.catalogo_asaas_apurar_estados_acumulo_inerte(v_id);
 IF v_apuracao->>'integridade_contabil_ok'<>'true'
 OR v_apuracao->>'identidade_local_ok'<>'true'
 OR v_apuracao->>'candidato_a_conferencia_manual'<>'true'
 OR v_apuracao->>'exige_revisao'<>'false'
 OR v_apuracao->>'pode_quitar'<>'false'
 OR v_apuracao->>'pode_liberar_motoboy'<>'false'
 OR (v_apuracao->>'eventos_observados')::int<>1
 OR pg_catalog.jsonb_array_length(v_apuracao->'origens')<>2
 THEN RAISE EXCEPTION 'COB06_APURACAO: conferência de R$1+R$4 incorreta: %',v_apuracao; END IF;

 -- Candidato 10: transacao SUBISOLADA, exclusivamente no banco efemero.
 -- Simula a futura prova Asaas usando owner postgres e reverte totalmente.
 -- Nao e webhook autentico; service_role NAO tem INSERT nessa tabela.
 IF pg_catalog.has_table_privilege('service_role',
  'public.catalogo_asaas_acumulo_quitacoes_isoladas','INSERT')
 OR pg_catalog.has_table_privilege('anon',
  'public.catalogo_asaas_acumulo_quitacoes_isoladas','INSERT')
 OR pg_catalog.has_table_privilege('authenticated',
  'public.catalogo_asaas_acumulo_quitacoes_isoladas','UPDATE')
 THEN RAISE EXCEPTION 'COB06_PONTE: tabela de quitacao exposta'; END IF;

 BEGIN
   INSERT INTO public.catalogo_asaas_acumulo_quitacoes_isoladas(
     lote_id,payment_id,evento_recebimento_id,valor_centavos)
   VALUES(v_id,'pay_cob06_obs_123456',v_evento_id,500);
   IF catalogo_private.catalogo_v2_parcela_recebida(v_p1,'plataforma')
   THEN RAISE EXCEPTION 'COB06_PONTE: quitacao isolada liberou sem status de origem'; END IF;

   -- Nao inserir nenhuma linha em catalogo_fatura_cobrancas.
   -- Testar a janela intermediaria: um mes quitado nao financia o outro.
   UPDATE public.catalogo_fechamentos_offline
     SET status='pago',pago_em=pg_catalog.now(),
       referencia_pagamento=v_referencia->>'referencia'
   WHERE id=v_f1;
   UPDATE public.catalogo_comissoes_offline
     SET status='paga',pago_em=pg_catalog.now(),
       referencia_pagamento=v_referencia->>'referencia'
   WHERE pedido_id=v_p1;
   IF catalogo_private.catalogo_v2_parcela_recebida(v_p1,'plataforma')
     OR catalogo_private.catalogo_v2_parcela_recebida(v_p1,'logistica')
   THEN RAISE EXCEPTION 'COB06_PONTE: liberou um mes com outra fatura pendente'; END IF;

   -- Mesmo com as duas faturas pagas, uma comissao pendente trava o lote.
   UPDATE public.catalogo_fechamentos_offline
     SET status='pago',pago_em=pg_catalog.now(),
       referencia_pagamento=v_referencia->>'referencia'
   WHERE id=v_f2;
   IF catalogo_private.catalogo_v2_parcela_recebida(v_p1,'plataforma')
     OR catalogo_private.catalogo_v2_parcela_recebida(v_p2,'logistica')
   THEN RAISE EXCEPTION 'COB06_PONTE: liberou antes da segunda comissao'; END IF;
   UPDATE public.catalogo_comissoes_offline
     SET status='paga',pago_em=pg_catalog.now(),
       referencia_pagamento=v_referencia->>'referencia'
   WHERE pedido_id=v_p2;
   IF NOT catalogo_private.catalogo_v2_parcela_recebida(v_p1,'plataforma')
   OR NOT catalogo_private.catalogo_v2_parcela_recebida(v_p1,'logistica')
   OR NOT catalogo_private.catalogo_v2_parcela_recebida(v_p2,'plataforma')
   OR NOT catalogo_private.catalogo_v2_parcela_recebida(v_p2,'logistica')
   OR (SELECT pg_catalog.count(*) FROM public.catalogo_fatura_cobrancas
       WHERE fechamento_id IN (v_f1,v_f2))<>0
   THEN RAISE EXCEPTION 'COB06_PONTE: quatro parcelas nao reconheceram lote unico'; END IF;

   BEGIN
     UPDATE public.catalogo_asaas_acumulo_quitacoes_isoladas
       SET estado='estornado' WHERE lote_id=v_id;
     RAISE EXCEPTION 'COB06_PONTE: estorno sem evento aceito';
   EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
   END;

   v_evento:=public.catalogo_asaas_registrar_evento_acumulo_inerte(
     v_id,'pay_cob06_obs_123456','ci-cob06-ponte-refund','REFUNDED');
   IF v_evento->>'ok'<>'true' OR v_evento->>'ja_observado'<>'false'
   THEN RAISE EXCEPTION 'COB06_PONTE: diario recusou estorno pos-quitacao: %',v_evento; END IF;
   -- Mesmo ANTES de atualizar estado local, um evento de estorno cancela
   -- a prova de financiamento no helper, sem repetir repasse.
   IF catalogo_private.catalogo_v2_parcela_recebida(v_p1,'plataforma')
     OR catalogo_private.catalogo_v2_parcela_recebida(v_p2,'logistica')
   THEN RAISE EXCEPTION 'COB06_PONTE: evento de estorno nao suspendeu credito'; END IF;
   UPDATE public.catalogo_asaas_acumulo_quitacoes_isoladas
     SET estado='estornado' WHERE lote_id=v_id;
   BEGIN
     UPDATE public.catalogo_asaas_acumulo_quitacoes_isoladas
       SET estado='pago' WHERE lote_id=v_id;
     RAISE EXCEPTION 'COB06_PONTE: reativacao da quitacao estornada aceita';
   EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
   END;

   RAISE EXCEPTION 'COB06_PONTE_ROLLBACK_ESPERADO';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM IS DISTINCT FROM 'COB06_PONTE_ROLLBACK_ESPERADO' THEN RAISE; END IF;
   v_ponte_rollback:=true;
 END;
 IF NOT v_ponte_rollback
 OR EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_quitacoes_isoladas)
 OR EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_eventos
           WHERE evento_externo='ci-cob06-ponte-refund')
 OR (SELECT status FROM public.catalogo_fechamentos_offline WHERE id=v_f1)<>'faturado'
 OR (SELECT status FROM public.catalogo_comissoes_offline WHERE pedido_id=v_p1)<>'faturada'
 OR catalogo_private.catalogo_v2_parcela_recebida(v_p1,'plataforma')
 THEN RAISE EXCEPTION 'COB06_PONTE: subtransacao deixou credito ou evento residual'; END IF;
 RAISE NOTICE 'COB06_PONTE_QUITACAO_4_PARCELAS_ESTORNO_ROLLBACK_OK';

 -- Candidato 11: transacao atomica SEM acesso de roles API ou provedor.
 IF pg_catalog.has_function_privilege('service_role',
    'catalogo_private.catalogo_asaas_quitar_lote_atomico_ci(uuid,bigint)','EXECUTE')
 OR pg_catalog.has_function_privilege('authenticated',
    'catalogo_private.catalogo_asaas_quitar_lote_atomico_ci(uuid,bigint)','EXECUTE')
 OR pg_catalog.has_function_privilege('anon',
    'catalogo_private.catalogo_asaas_quitar_lote_atomico_ci(uuid,bigint)','EXECUTE')
 THEN RAISE EXCEPTION 'COB06_ATOMICO: RPC exposta'; END IF;
 BEGIN
  -- Um GET sintético e um evento RECEIVED jamais bastam sem livros retidos.
  v_atomico:=catalogo_private.catalogo_asaas_quitar_lote_atomico_ci(v_id,v_evento_id);
  IF v_atomico->>'motivo'<>'preflight_ou_livro_de_creditos_incompleto'
    OR EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_quitacoes_isoladas)
  THEN RAISE EXCEPTION 'COB06_ATOMICO: baixou sem credito elegivel: %',v_atomico; END IF;

  INSERT INTO auth.users(id) VALUES
    ('00000000-0000-4000-8000-000000000099'::uuid)
  ON CONFLICT(id) DO NOTHING;
  INSERT INTO public.catalogo_remuneracoes_v2(
    pedido_id,comercio_id,motoboy_id,valor_centavos,status,financiamento_comprovado)
  VALUES(v_p1,'comercio-de-exemplo',
    '00000000-0000-4000-8000-000000000099'::uuid,29,'retido',false)
  RETURNING id INTO v_rem1;
  INSERT INTO public.catalogo_remuneracoes_v2(
    pedido_id,comercio_id,motoboy_id,valor_centavos,status,financiamento_comprovado)
  VALUES(v_p2,'comercio-de-exemplo',
    '00000000-0000-4000-8000-000000000099'::uuid,114,'retido',false)
  RETURNING id INTO v_rem2;
  INSERT INTO public.catalogo_lancamentos_financeiros_v2(
    pedido_id,tipo,valor_centavos,status,chave_idempotencia)
  VALUES(v_p1,'comissao_plataforma',71,'retido','ci-cob06-atomic-plataforma-1'),
        (v_p2,'comissao_plataforma',286,'retido','ci-cob06-atomic-plataforma-2');
  INSERT INTO public.catalogo_lancamentos_financeiros_v2(
    pedido_id,remuneracao_id,beneficiario_id,tipo,
    valor_centavos,status,chave_idempotencia)
  VALUES(v_p1,v_rem1,'00000000-0000-4000-8000-000000000099'::uuid,
         'remuneracao_motoboy',29,'retido','ci-cob06-atomic-entrega-1'),
        (v_p2,v_rem2,'00000000-0000-4000-8000-000000000099'::uuid,
         'remuneracao_motoboy',114,'retido','ci-cob06-atomic-entrega-2');

  -- Pedido incompleto na MESMA competencia, nao incluído na fatura.
  -- Sua comissao aberta nao pode bloquear a baixa dos pedidos faturados.
  INSERT INTO public.catalogo_pedidos(
    comercio_id,referencia_externa,provedor,idempotency_key,status,
    status_pagamento,modalidade,forma_pagamento,subtotal_produtos_centavos,
    entrega_centavos,total_centavos,taxa_plataforma_centavos,
    repasse_bruto_comercio_centavos,cliente_nome,cliente_telefone,
    versao_financeira,taxa_motoboy_centavos,taxa_total_centavos,
    entrega_status,metadata
  ) VALUES(
    'comercio-de-exemplo','ci-cob06-pendente-mesma-competencia',
    'offline',pg_catalog.gen_random_uuid(),'pronto',
    'pendente','entrega','dinheiro',1429,
    0,1429,71,1329,'Pedido ainda nao entregue','00000000000',
    2,29,100,'pendente','{"cob06":"pendente-fora-da-fatura"}'::jsonb
  ) RETURNING id INTO v_p_pendente;
  INSERT INTO public.catalogo_comissoes_offline(
    pedido_id,comercio_id,competencia,subtotal_produtos_centavos,
    taxa_percentual,valor_comissao_centavos,status,
    taxa_plataforma_centavos,taxa_motoboy_centavos,valor_total_centavos,
    versao_financeira,motoboy_id,financiamento_logistica_comprovado
  ) VALUES(
    v_p_pendente,'comercio-de-exemplo','2040-03-01',1429,
    5,100,'aberta',71,29,100,2,
    '00000000-0000-4000-8000-000000000099'::uuid,false
  );
  IF (SELECT pg_catalog.count(*) FROM public.catalogo_comissoes_offline
      WHERE comercio_id='comercio-de-exemplo'
        AND competencia='2040-03-01')<>2
     OR EXISTS(SELECT 1 FROM public.catalogo_fatura_componentes_v2
               WHERE pedido_id=v_p_pendente)
  THEN RAISE EXCEPTION 'COB06_ATOMICO: fixture pendente nao isolada'; END IF;

  v_projecao:=public.catalogo_asaas_projetar_baixa_acumulo_inerte(v_id);
  IF v_projecao->>'projecao_contabil_consistente'<>'true'
  THEN RAISE EXCEPTION 'COB06_ATOMICO: projecao inicial: %',v_projecao; END IF;

  v_atomico:=catalogo_private.catalogo_asaas_quitar_lote_atomico_ci(
    v_id,v_evento_id+10000);
  IF v_atomico->>'motivo'<>'comprovante_inconsistente'
  THEN RAISE EXCEPTION 'COB06_ATOMICO: evento estranho aceito'; END IF;

  -- Injetar falha DEPOIS do INSERT do recibo e UPDATE das faturas.
  EXECUTE $ddl$CREATE FUNCTION pg_temp.cob06_rejeitar_paga_ci()
    RETURNS trigger LANGUAGE plpgsql AS $trigger$
    BEGIN
      IF NEW.status='paga' THEN RAISE EXCEPTION 'COB06_FALHA_INJETADA'; END IF;
      RETURN NEW;
    END; $trigger$ $ddl$;
  CREATE TRIGGER cob06_injetar_erro_ci
    BEFORE UPDATE OF status ON public.catalogo_comissoes_offline
    FOR EACH ROW EXECUTE FUNCTION pg_temp.cob06_rejeitar_paga_ci();
  BEGIN
    PERFORM catalogo_private.catalogo_asaas_quitar_lote_atomico_ci(v_id,v_evento_id);
    RAISE EXCEPTION 'COB06_ATOMICO: deveria ter falhado';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'COB06_FALHA_INJETADA' THEN RAISE; END IF;
  END;
  DROP TRIGGER cob06_injetar_erro_ci ON public.catalogo_comissoes_offline;
  IF EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_quitacoes_isoladas)
   OR (SELECT status FROM public.catalogo_fechamentos_offline WHERE id=v_f1)<>'faturado'
   OR (SELECT status FROM public.catalogo_fechamentos_offline WHERE id=v_f2)<>'faturado'
   OR (SELECT status FROM public.catalogo_comissoes_offline WHERE pedido_id=v_p1)<>'faturada'
   OR (SELECT count(*) FROM public.catalogo_lancamentos_financeiros_v2
       WHERE pedido_id IN(v_p1,v_p2) AND status='disponivel')<>0
  THEN RAISE EXCEPTION 'COB06_ATOMICO: falha deixou credito ou baixa parcial'; END IF;

  -- Sucesso integral R$1+R$4, nenhum pagamento individual inventado.
  v_atomico:=catalogo_private.catalogo_asaas_quitar_lote_atomico_ci(v_id,v_evento_id);
  IF v_atomico->>'ok'<>'true'
   OR (v_atomico->>'competencias')::int<>2
   OR (v_atomico->>'pedidos')::int<>2
   OR (v_atomico->>'valor_centavos')::int<>500
   OR v_atomico->>'prova_bancaria_real'<>'false'
   OR v_atomico->>'transferencias_autorizadas'<>'false'
   OR (SELECT count(*) FROM public.catalogo_asaas_acumulo_quitacoes_isoladas)<>1
   OR (SELECT count(*) FROM public.catalogo_fechamentos_offline
       WHERE id IN(v_f1,v_f2) AND status='pago')<>2
   OR (SELECT count(*) FROM public.catalogo_comissoes_offline
       WHERE pedido_id IN(v_p1,v_p2) AND status='paga')<>2
   OR (SELECT status FROM public.catalogo_comissoes_offline
       WHERE pedido_id=v_p_pendente) IS DISTINCT FROM 'aberta'
   OR EXISTS(SELECT 1 FROM public.catalogo_comissoes_offline
             WHERE pedido_id=v_p_pendente
               AND (pago_em IS NOT NULL OR referencia_pagamento IS NOT NULL))
   OR (SELECT status_pagamento FROM public.catalogo_pedidos
       WHERE id=v_p_pendente) IS DISTINCT FROM 'pendente'
   OR (SELECT count(*) FROM public.catalogo_remuneracoes_v2
       WHERE pedido_id IN(v_p1,v_p2) AND status='disponivel'
         AND financiamento_comprovado=true)<>2
   OR (SELECT count(*) FROM public.catalogo_lancamentos_financeiros_v2
       WHERE pedido_id IN(v_p1,v_p2) AND status='disponivel')<>4
   OR (SELECT count(*) FROM public.catalogo_fatura_cobrancas
       WHERE fechamento_id IN(v_f1,v_f2))<>0
  THEN RAISE EXCEPTION 'COB06_ATOMICO: baixa ou repasse incompleto: %',v_atomico; END IF;

  -- Reenvio nao duplica credito nem da outro significado ao evento.
  v_atomico:=catalogo_private.catalogo_asaas_quitar_lote_atomico_ci(v_id,v_evento_id);
  IF v_atomico->>'ok'<>'false'
   OR v_atomico->>'motivo'<>'lote_nao_aberto'
   OR (SELECT count(*) FROM public.catalogo_asaas_acumulo_quitacoes_isoladas)<>1
  THEN RAISE EXCEPTION 'COB06_ATOMICO: replay duplicou recibo'; END IF;

  -- Ensaio POS-REPASSE: RPC administrativa real, banco e comprovante
  -- inteiramente sinteticos. NAO transfere Pix, NAO homologa minimo R$100.
  -- Neste fixture os dois creditos do motoboy somam somente R$1,43.
  BEGIN
   INSERT INTO auth.users(id)
   VALUES('4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid)
   ON CONFLICT(id) DO NOTHING;
   v_repasse_teste:=public.catalogo_operacao_admin_v2(
     p_operador_id=>'4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid,
     p_acao=>'registrar_repasse',
     p_motoboy_id=>'00000000-0000-4000-8000-000000000099'::uuid,
     p_pedido_ids=>ARRAY[v_p1,v_p2],
     p_referencia=>'ci-cob06-pos-repasse-001',
     p_comprovante=>'COMPROVANTE_FICTICIO_CI_NAO_TRANSFERIDO');
   IF v_repasse_teste->>'ok'<>'true'
      OR v_repasse_teste->>'transferencia_executada'<>'false'
      OR (v_repasse_teste->>'valor_centavos')::int<>143
      OR (SELECT count(*) FROM public.catalogo_remuneracoes_v2
          WHERE pedido_id IN(v_p1,v_p2) AND status='pago')<>2
      OR (SELECT count(*) FROM public.catalogo_lancamentos_financeiros_v2
          WHERE pedido_id IN(v_p1,v_p2) AND tipo='remuneracao_motoboy'
            AND status='pago')<>2
   THEN RAISE EXCEPTION 'COB06_POS_REPASSE: nao registrou livro sintetico: %',
     v_repasse_teste; END IF;
   v_repasse_id:=(v_repasse_teste->>'repasse_id')::uuid;
   v_pago_em_repasse:=(SELECT pago_em FROM public.catalogo_remuneracoes_v2
                       WHERE pedido_id=v_p1);

   v_evento:=public.catalogo_asaas_registrar_evento_acumulo_inerte(
     v_id,'pay_cob06_obs_123456','ci-cob06-refund-pos-repasse-001','REFUNDED');
   IF v_evento->>'ok'<>'true'
   THEN RAISE EXCEPTION 'COB06_POS_REPASSE: evento refund nao observado'; END IF;
   v_reverso:=catalogo_private.catalogo_asaas_suspender_lote_atomico_ci(
     v_id,(v_evento->>'evento_id')::bigint);
   IF v_reverso->>'ok'<>'true' OR v_reverso->>'estado'<>'estornado'
      OR (SELECT count(*) FROM public.catalogo_remuneracoes_v2
          WHERE pedido_id IN(v_p1,v_p2) AND status='pendencia_revisao'
            AND financiamento_comprovado=false AND repasse_id=v_repasse_id)<>2
      OR (SELECT count(*) FROM public.catalogo_lancamentos_financeiros_v2
          WHERE pedido_id IN(v_p1,v_p2) AND tipo='remuneracao_motoboy'
            AND status='pendencia_revisao')<>2
      OR (SELECT count(*) FROM public.catalogo_lancamentos_financeiros_v2
          WHERE pedido_id IN(v_p1,v_p2) AND tipo='comissao_plataforma'
            AND status='retido')<>2
      OR (SELECT count(*) FROM public.catalogo_lancamentos_financeiros_v2
          WHERE pedido_id IN(v_p1,v_p2) AND tipo='pendencia_revisao'
            AND status='pendencia_revisao'
            AND chave_idempotencia='estorno-revisao:'||pedido_id::text)<>2
      OR (SELECT sum(valor_centavos) FROM public.catalogo_lancamentos_financeiros_v2
          WHERE pedido_id IN(v_p1,v_p2) AND tipo='pendencia_revisao')<>-143
      OR (SELECT pago_em FROM public.catalogo_remuneracoes_v2
          WHERE pedido_id=v_p1) IS DISTINCT FROM v_pago_em_repasse
      OR (SELECT valor_centavos FROM public.catalogo_repasses_v2
          WHERE id=v_repasse_id AND status='registrado')<>143
   THEN RAISE EXCEPTION 'COB06_POS_REPASSE: faltou pendencia/ajuste: %',v_reverso; END IF;

   -- A mesma transferencia nao sera feita de novo, nem como novo registro.
   v_repasse_teste:=public.catalogo_operacao_admin_v2(
     p_operador_id=>'4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid,
     p_acao=>'registrar_repasse',
     p_motoboy_id=>'00000000-0000-4000-8000-000000000099'::uuid,
     p_pedido_ids=>ARRAY[v_p1,v_p2],
     p_referencia=>'ci-cob06-novo-repasse-negado-001',
     p_comprovante=>'OUTRO_COMPROVANTE_FICTICIO_CI');
   IF v_repasse_teste->>'ok'<>'false'
      OR (v_repasse_teste->>'http_status')::int<>409
      OR (SELECT count(*) FROM public.catalogo_repasses_v2
          WHERE motoboy_id='00000000-0000-4000-8000-000000000099'::uuid)<>1
   THEN RAISE EXCEPTION 'COB06_POS_REPASSE: repetiu repasse apos estorno: %',
     v_repasse_teste; END IF;
   v_reverso:=catalogo_private.catalogo_asaas_suspender_lote_atomico_ci(
     v_id,(v_evento->>'evento_id')::bigint);
   IF v_reverso->>'motivo'<>'quitacao_nao_ativa'
      OR (SELECT count(*) FROM public.catalogo_lancamentos_financeiros_v2
          WHERE pedido_id IN(v_p1,v_p2) AND tipo='pendencia_revisao')<>2
   THEN RAISE EXCEPTION 'COB06_POS_REPASSE: segunda reversao duplicou debito'; END IF;

   -- Este bloco inteiro volta ao estado anterior: replica apenas uma
   -- hipotese contabil, sem conservar usuario, comprovante, evento ou repasse.
   RAISE EXCEPTION 'COB06_POS_REPASSE_ROLLBACK_ESPERADO';
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM IS DISTINCT FROM 'COB06_POS_REPASSE_ROLLBACK_ESPERADO' THEN RAISE; END IF;
  END;
  IF EXISTS(SELECT 1 FROM public.catalogo_repasses_v2
            WHERE referencia='ci-cob06-pos-repasse-001')
    OR EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_eventos
              WHERE evento_externo='ci-cob06-refund-pos-repasse-001')
    OR EXISTS(SELECT 1 FROM public.catalogo_lancamentos_financeiros_v2
              WHERE pedido_id IN(v_p1,v_p2) AND tipo='pendencia_revisao')
    OR (SELECT count(*) FROM public.catalogo_remuneracoes_v2
        WHERE pedido_id IN(v_p1,v_p2) AND status='disponivel'
          AND repasse_id IS NULL)<>2
    OR (SELECT count(*) FROM public.catalogo_lancamentos_financeiros_v2
        WHERE pedido_id IN(v_p1,v_p2) AND status='disponivel')<>4
    OR (SELECT estado FROM public.catalogo_asaas_acumulo_quitacoes_isoladas
        WHERE lote_id=v_id)<>'pago'
  THEN RAISE EXCEPTION 'COB06_POS_REPASSE: subtransacao deixou residuos'; END IF;
  RAISE NOTICE 'COB06_POS_REPASSE_PENDENCIA_REVISAO_IDEMPOTENTE_ROLLBACK_OK';

  -- Candidato 12: revogacao/suspensao atomica depois de um estorno.
  IF pg_catalog.has_function_privilege('service_role',
     'catalogo_private.catalogo_asaas_suspender_lote_atomico_ci(uuid,bigint)','EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated',
     'catalogo_private.catalogo_asaas_suspender_lote_atomico_ci(uuid,bigint)','EXECUTE')
    OR pg_catalog.has_function_privilege('anon',
     'catalogo_private.catalogo_asaas_suspender_lote_atomico_ci(uuid,bigint)','EXECUTE')
  THEN RAISE EXCEPTION 'COB06_SUSPENSAO: RPC exposta'; END IF;
  v_reverso:=catalogo_private.catalogo_asaas_suspender_lote_atomico_ci(v_id,v_evento_id);
  IF v_reverso->>'motivo'<>'evento_adverso_nao_vinculado'
    OR (SELECT count(*) FROM public.catalogo_lancamentos_financeiros_v2
        WHERE pedido_id IN(v_p1,v_p2) AND status='disponivel')<>4
  THEN RAISE EXCEPTION 'COB06_SUSPENSAO: evento RECEIVED suspendeu dinheiro'; END IF;

  v_referencia_paga:=(SELECT referencia_pagamento FROM public.catalogo_fechamentos_offline
                      WHERE id=v_f1);
  v_pago_em_antes:=(SELECT pago_em FROM public.catalogo_fechamentos_offline WHERE id=v_f1);
  -- Uma contestacao nao e estorno definitivo; ainda assim, tem de reter tudo.
  BEGIN
   v_evento:=public.catalogo_asaas_registrar_evento_acumulo_inerte(
     v_id,'pay_cob06_obs_123456','ci-cob06-chargeback-atomo-001','CHARGEBACK_REQUESTED');
   IF v_evento->>'ok'<>'true' THEN
    RAISE EXCEPTION 'COB06_SUSPENSAO: contestacao nao registrada: %',v_evento; END IF;
   v_evento_reverso_id:=(v_evento->>'evento_id')::bigint;
   v_reverso:=catalogo_private.catalogo_asaas_suspender_lote_atomico_ci(
     v_id,v_evento_reverso_id);
   IF v_reverso->>'ok'<>'true' OR v_reverso->>'estado'<>'contestado'
      OR (SELECT estado FROM public.catalogo_asaas_acumulo_quitacoes_isoladas
          WHERE lote_id=v_id)<>'contestado'
      OR (SELECT estado FROM public.catalogo_asaas_acumulo_lotes WHERE id=v_id)<>'contestado'
      OR (SELECT count(*) FROM public.catalogo_fechamentos_offline
          WHERE id IN(v_f1,v_f2) AND status='bloqueado')<>2
      OR (SELECT count(*) FROM public.catalogo_comissoes_offline
          WHERE pedido_id IN(v_p1,v_p2) AND status='contestada')<>2
      OR (SELECT count(*) FROM public.catalogo_lancamentos_financeiros_v2
          WHERE pedido_id IN(v_p1,v_p2) AND status='retido')<>4
      OR (SELECT count(*) FROM public.catalogo_remuneracoes_v2
          WHERE pedido_id IN(v_p1,v_p2) AND status='retido'
            AND financiamento_comprovado=false)<>2
   THEN RAISE EXCEPTION 'COB06_SUSPENSAO: disputa nao reteve tudo: %',v_reverso; END IF;
   RAISE EXCEPTION 'COB06_DISPUTA_ROLLBACK_ESPERADO';
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM IS DISTINCT FROM 'COB06_DISPUTA_ROLLBACK_ESPERADO' THEN RAISE; END IF;
   v_disputa_rollback:=true;
  END;
  IF NOT v_disputa_rollback
   OR (SELECT estado FROM public.catalogo_asaas_acumulo_quitacoes_isoladas
       WHERE lote_id=v_id)<>'pago'
   OR (SELECT count(*) FROM public.catalogo_fechamentos_offline
       WHERE id IN(v_f1,v_f2) AND status='pago')<>2
   OR (SELECT count(*) FROM public.catalogo_lancamentos_financeiros_v2
       WHERE pedido_id IN(v_p1,v_p2) AND status='disponivel')<>4
   OR EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_eventos
             WHERE evento_externo='ci-cob06-chargeback-atomo-001')
  THEN RAISE EXCEPTION 'COB06_SUSPENSAO: teste de disputa deixou residuo'; END IF;

  -- Estados adicionais do ciclo de contestacao devem reter credito.
  -- Cada estado e ensaiado e revertido em sua propria subtransacao.
  FOREACH v_estado_disputa IN ARRAY ARRAY[
    'CHARGEBACK_DISPUTE','AWAITING_CHARGEBACK_REVERSAL'
  ] LOOP
   BEGIN
    v_evento:=public.catalogo_asaas_registrar_evento_acumulo_inerte(
      v_id,'pay_cob06_obs_123456','ci-cob06-disputa-'||v_estado_disputa,
      v_estado_disputa);
    IF v_evento->>'ok'<>'true'
    THEN RAISE EXCEPTION 'COB06_DISPUTA: estado nao registrado: %',v_estado_disputa; END IF;
    v_apuracao:=public.catalogo_asaas_apurar_estados_acumulo_inerte(v_id);
    IF v_apuracao->>'classificacao'<>'reversao_ou_disputa_irreversivel_sem_analise'
      OR v_apuracao->>'candidato_a_conferencia_manual'<>'false'
      OR catalogo_private.catalogo_v2_parcela_recebida(v_p1,'plataforma')
    THEN RAISE EXCEPTION 'COB06_DISPUTA: diario reativou credito: %',v_apuracao; END IF;
    v_reverso:=catalogo_private.catalogo_asaas_suspender_lote_atomico_ci(
      v_id,(v_evento->>'evento_id')::bigint);
    IF v_reverso->>'ok'<>'true' OR v_reverso->>'estado'<>'contestado'
      OR EXISTS (SELECT 1 FROM public.catalogo_lancamentos_financeiros_v2
                 WHERE pedido_id IN(v_p1,v_p2) AND status='disponivel')
    THEN RAISE EXCEPTION 'COB06_DISPUTA: saldo liberado: %',v_reverso; END IF;
    RAISE EXCEPTION 'COB06_ESTADO_DISPUTA_ROLLBACK_ESPERADO';
   EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'COB06_ESTADO_DISPUTA_ROLLBACK_ESPERADO' THEN RAISE; END IF;
   END;
   IF (SELECT estado FROM public.catalogo_asaas_acumulo_quitacoes_isoladas
        WHERE lote_id=v_id)<>'pago'
     OR EXISTS (SELECT 1 FROM public.catalogo_asaas_acumulo_eventos
                WHERE evento_externo='ci-cob06-disputa-'||v_estado_disputa)
   THEN RAISE EXCEPTION 'COB06_DISPUTA: teste deixou residuos: %',v_estado_disputa; END IF;
  END LOOP;
  RAISE NOTICE 'COB06_ESTADOS_DISPUTA_ADICIONAIS_HOLD_ROLLBACK_OK';

  -- Reembolso parcial/em andamento tambem suspende e pede revisao,
  -- sem classificar como estorno total definitivo.
  BEGIN
   v_evento:=public.catalogo_asaas_registrar_evento_acumulo_inerte(
     v_id,'pay_cob06_obs_123456','ci-cob06-parcial-atomo-001','PARTIALLY_REFUNDED');
   IF v_evento->>'ok'<>'true' THEN
    RAISE EXCEPTION 'COB06_SUSPENSAO: parcial nao registrado: %',v_evento; END IF;
   v_reverso:=catalogo_private.catalogo_asaas_suspender_lote_atomico_ci(
     v_id,(v_evento->>'evento_id')::bigint);
   IF v_reverso->>'ok'<>'true' OR v_reverso->>'estado'<>'contestado'
      OR EXISTS(SELECT 1 FROM public.catalogo_lancamentos_financeiros_v2
                WHERE pedido_id IN(v_p1,v_p2) AND status='disponivel')
   THEN RAISE EXCEPTION 'COB06_SUSPENSAO: reembolso parcial liberou saldo'; END IF;
   RAISE EXCEPTION 'COB06_PARCIAL_ROLLBACK_ESPERADO';
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM IS DISTINCT FROM 'COB06_PARCIAL_ROLLBACK_ESPERADO' THEN RAISE; END IF;
  END;
  IF (SELECT estado FROM public.catalogo_asaas_acumulo_quitacoes_isoladas
      WHERE lote_id=v_id)<>'pago'
    OR EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_eventos
              WHERE evento_externo='ci-cob06-parcial-atomo-001')
  THEN RAISE EXCEPTION 'COB06_SUSPENSAO: parcial deixou residuos'; END IF;

  -- O estorno e registrado como evento INERTE; so a funcao isolada
  -- converte depois o credito ja disponivel em saldo retido.
  v_evento:=public.catalogo_asaas_registrar_evento_acumulo_inerte(
    v_id,'pay_cob06_obs_123456','ci-cob06-refund-atomo-001','REFUNDED');
  IF v_evento->>'ok'<>'true'
  THEN RAISE EXCEPTION 'COB06_SUSPENSAO: refund nao registrado: %',v_evento; END IF;
  v_evento_reverso_id:=(v_evento->>'evento_id')::bigint;
  IF (SELECT count(*) FROM public.catalogo_lancamentos_financeiros_v2
      WHERE pedido_id IN(v_p1,v_p2) AND status='disponivel')<>4
  THEN RAISE EXCEPTION 'COB06_SUSPENSAO: fixture nao reproduziu saldo exposto'; END IF;

  -- Forcar falha na ultima etapa: rollback deve restaurar recibo, lote,
  -- faturas, comissoes e saldo numa unica transacao.
  EXECUTE $ddl$CREATE FUNCTION pg_temp.cob06_falha_suspensao_ci()
    RETURNS trigger LANGUAGE plpgsql AS $trigger$
    BEGIN
      IF NEW.status='contestada' THEN
        RAISE EXCEPTION 'COB06_FALHA_SUSPENSAO_INJETADA';
      END IF;
      RETURN NEW;
    END; $trigger$ $ddl$;
  CREATE TRIGGER cob06_falha_suspensao_ci
    BEFORE UPDATE OF status ON public.catalogo_comissoes_offline
    FOR EACH ROW EXECUTE FUNCTION pg_temp.cob06_falha_suspensao_ci();
  BEGIN
    PERFORM catalogo_private.catalogo_asaas_suspender_lote_atomico_ci(
      v_id,v_evento_reverso_id);
    RAISE EXCEPTION 'COB06_SUSPENSAO: deveria ter falhado';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'COB06_FALHA_SUSPENSAO_INJETADA' THEN RAISE; END IF;
  END;
  DROP TRIGGER cob06_falha_suspensao_ci ON public.catalogo_comissoes_offline;
  IF (SELECT estado FROM public.catalogo_asaas_acumulo_quitacoes_isoladas
      WHERE lote_id=v_id)<>'pago'
   OR (SELECT estado FROM public.catalogo_asaas_acumulo_lotes WHERE id=v_id)<>'pago'
   OR (SELECT count(*) FROM public.catalogo_fechamentos_offline
       WHERE id IN(v_f1,v_f2) AND status='pago')<>2
   OR (SELECT count(*) FROM public.catalogo_comissoes_offline
       WHERE pedido_id IN(v_p1,v_p2) AND status='paga')<>2
   OR (SELECT count(*) FROM public.catalogo_lancamentos_financeiros_v2
       WHERE pedido_id IN(v_p1,v_p2) AND status='disponivel')<>4
  THEN RAISE EXCEPTION 'COB06_SUSPENSAO: falha deixou estado parcial'; END IF;

  v_reverso:=catalogo_private.catalogo_asaas_suspender_lote_atomico_ci(
    v_id,v_evento_reverso_id);
  IF v_reverso->>'ok'<>'true' OR v_reverso->>'estado'<>'estornado'
   OR v_reverso->>'evento'<>'REFUNDED'
   OR v_reverso->>'transferencias_compensadas'<>'false'
   OR v_reverso->>'prova_bancaria_real'<>'false'
   OR (SELECT estado FROM public.catalogo_asaas_acumulo_quitacoes_isoladas
       WHERE lote_id=v_id)<>'estornado'
   OR (SELECT estado FROM public.catalogo_asaas_acumulo_lotes WHERE id=v_id)<>'estornado'
   OR (SELECT count(*) FROM public.catalogo_fechamentos_offline
       WHERE id IN(v_f1,v_f2) AND status='bloqueado')<>2
   OR (SELECT count(*) FROM public.catalogo_comissoes_offline
       WHERE pedido_id IN(v_p1,v_p2) AND status='contestada')<>2
   OR (SELECT count(*) FROM public.catalogo_lancamentos_financeiros_v2
       WHERE pedido_id IN(v_p1,v_p2) AND status='retido')<>4
   OR (SELECT count(*) FROM public.catalogo_remuneracoes_v2
       WHERE pedido_id IN(v_p1,v_p2) AND status='retido'
         AND financiamento_comprovado=false)<>2
   OR (SELECT referencia_pagamento FROM public.catalogo_fechamentos_offline
       WHERE id=v_f1) IS DISTINCT FROM v_referencia_paga
   OR (SELECT pago_em FROM public.catalogo_fechamentos_offline
       WHERE id=v_f1) IS DISTINCT FROM v_pago_em_antes
   OR (SELECT count(*) FROM public.catalogo_fatura_cobrancas
       WHERE fechamento_id IN(v_f1,v_f2))<>0
  THEN RAISE EXCEPTION 'COB06_SUSPENSAO: estorno incompleto: %',v_reverso; END IF;
  v_reverso:=catalogo_private.catalogo_asaas_suspender_lote_atomico_ci(
    v_id,v_evento_reverso_id);
  IF v_reverso->>'ok'<>'false'
   OR v_reverso->>'motivo'<>'quitacao_nao_ativa'
  THEN RAISE EXCEPTION 'COB06_SUSPENSAO: replay reabriu recibo: %',v_reverso; END IF;
  v_evento:=public.catalogo_asaas_registrar_evento_acumulo_inerte(
    v_id,'pay_cob06_obs_123456','ci-cob06-received-apos-refund-001','RECEIVED');
  IF v_evento->>'ok'<>'true'
    OR EXISTS(SELECT 1 FROM public.catalogo_lancamentos_financeiros_v2
              WHERE pedido_id IN(v_p1,v_p2) AND status='disponivel')
    OR catalogo_private.catalogo_v2_financiado(v_p1)
  THEN RAISE EXCEPTION 'COB06_SUSPENSAO: evento tardio reativou saque'; END IF;
  RAISE NOTICE 'COB06_REVERSAO_ATOMICA_CI_ROLLBACK_OK';
  RAISE EXCEPTION 'COB06_ATOMICO_ROLLBACK_ESPERADO';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM IS DISTINCT FROM 'COB06_ATOMICO_ROLLBACK_ESPERADO' THEN RAISE; END IF;
  v_atomico_rollback:=true;
 END;
 IF NOT v_atomico_rollback
  OR EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_quitacoes_isoladas)
  OR EXISTS(SELECT 1 FROM public.catalogo_pedidos WHERE id=v_p_pendente)
  OR EXISTS(SELECT 1 FROM public.catalogo_remuneracoes_v2 WHERE pedido_id IN(v_p1,v_p2))
  OR EXISTS(SELECT 1 FROM public.catalogo_lancamentos_financeiros_v2 WHERE pedido_id IN(v_p1,v_p2))
  OR (SELECT status FROM public.catalogo_fechamentos_offline WHERE id=v_f1)<>'faturado'
  OR (SELECT status FROM public.catalogo_comissoes_offline WHERE pedido_id=v_p1)<>'faturada'
 THEN RAISE EXCEPTION 'COB06_ATOMICO: subtransacao deixou residuos'; END IF;
 RAISE NOTICE 'COB06_BAIXA_ATOMICA_CI_ROLLBACK_OK';

 v_evento:=public.catalogo_asaas_registrar_evento_acumulo_inerte(
   v_id,'pay_cob06_obs_123456','ci-cob06-evento-001','REFUNDED');
 IF v_evento->>'motivo'<>'replay_divergente'
 THEN RAISE EXCEPTION 'COB06_EVENTOS: replay divergente aceito'; END IF;
 v_evento:=public.catalogo_asaas_registrar_evento_acumulo_inerte(
   v_id,'pay_cob06_obs_123456','ci-cob06-evento-002','REFUNDED');
 IF v_evento->>'ok'<>'true'
 OR (SELECT count(*) FROM public.catalogo_asaas_acumulo_eventos WHERE lote_id=v_id)<>2
 THEN RAISE EXCEPTION 'COB06_EVENTOS: transicao nao preservada'; END IF;
 v_apuracao:=public.catalogo_asaas_apurar_estados_acumulo_inerte(v_id);
 IF v_apuracao->>'classificacao'<>'reversao_ou_disputa_irreversivel_sem_analise'
 OR v_apuracao->>'candidato_a_conferencia_manual'<>'false'
 OR v_apuracao->>'exige_revisao'<>'true'
 OR v_apuracao->>'pode_quitar'<>'false'
 THEN RAISE EXCEPTION 'COB06_APURACAO: estorno nao bloqueou a conciliacao: %',v_apuracao; END IF;
 v_projecao:=public.catalogo_asaas_projetar_baixa_acumulo_inerte(v_id);
 IF v_projecao->>'exige_revisao'<>'true'
 OR v_projecao->>'recebimento_observado_sem_prova_autonoma'<>'false'
 OR v_projecao->>'pode_quitar'<>'false'
 OR v_projecao->>'pode_estornar'<>'false'
 THEN RAISE EXCEPTION 'COB06_PROJECAO: estorno não manteve HOLD: %',v_projecao; END IF;

 -- Mesmo um estado posterior RECEIVED nao ressuscita o lote estornado.
 v_evento:=public.catalogo_asaas_registrar_evento_acumulo_inerte(
   v_id,'pay_cob06_obs_123456','ci-cob06-evento-003','RECEIVED');
 v_apuracao:=public.catalogo_asaas_apurar_estados_acumulo_inerte(v_id);
 IF v_evento->>'ok'<>'true'
 OR v_apuracao->>'ultimo_estado'<>'RECEIVED'
 OR (v_apuracao->>'eventos_de_reversao')::int<>1
 OR v_apuracao->>'candidato_a_conferencia_manual'<>'false'
 OR v_apuracao->>'exige_revisao'<>'true'
 OR v_apuracao->>'pode_quitar'<>'false'
 THEN RAISE EXCEPTION 'COB06_APURACAO: reativacao indevida apos estorno: %',v_apuracao; END IF;
 RAISE NOTICE 'COB06_APURACAO_EVENTOS_ESTORNO_SEM_REATIVAR_SEM_BAIXA_OK';
 BEGIN
  UPDATE public.catalogo_asaas_acumulo_eventos SET estado='PENDING'
  WHERE id=v_evento_id;
  RAISE EXCEPTION 'COB06_EVENTOS: alteracao aceita';
 EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
 END;
 IF (SELECT status FROM public.catalogo_fechamentos_offline WHERE id=v_f1)<>'faturado'
 THEN RAISE EXCEPTION 'COB06_EVENTOS: houve baixa indevida'; END IF;
 RAISE NOTICE 'COB06_EVENTOS_APPEND_ONLY_HOLD_OK';

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
