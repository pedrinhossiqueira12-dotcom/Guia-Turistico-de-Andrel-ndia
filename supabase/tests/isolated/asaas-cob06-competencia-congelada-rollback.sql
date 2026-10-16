-- COB-06: compensacao de competencias em banco efemero.
-- NAO usar em Supabase remoto, nem executar sem override CI-only 14.
-- O teste cria vendas FICTICIAS em transacao com ROLLBACK.
BEGIN;
DO $guard$
BEGIN
 IF pg_catalog.current_database()<>'catalogo_cob06_ci'
    OR pg_catalog.to_regprocedure('catalogo_private.catalogo_cob06_realocar_entrega_congelada_ci()') IS NULL
 THEN RAISE EXCEPTION 'COB06_CI_ONLY: teste de competencia exige clone'; END IF;
END;
$guard$;

INSERT INTO public.catalogo_pedidos(
 id,comercio_id,referencia_externa,idempotency_key,provedor,modalidade,
 forma_pagamento,subtotal_produtos_centavos,entrega_centavos,total_centavos,
 taxa_plataforma_centavos,taxa_motoboy_centavos,taxa_total_centavos,
 repasse_bruto_comercio_centavos,versao_financeira,cliente_nome,cliente_telefone,
 status_token_hash,codigo_entrega_hash,codigo_entrega_expira_em,
 status,entrega_status,status_pagamento,aceito_em,codigo_entrega_usado_em
) VALUES
('00000000-0000-4000-8000-00000000c601','comercio-de-exemplo','cob06-ci-primeiro',
 '00000000-0000-4000-8000-00000000c611','offline','entrega','dinheiro',
 4000,0,4000,200,80,280,3720,2,'CI Primeiro','00000000000',
 repeat('1',64),repeat('a',64),'2040-01-31T12:00:00Z',
 'entregue','entregue','aprovado','2040-01-15T12:00:00Z','2040-01-15T13:00:00Z'),
('00000000-0000-4000-8000-00000000c603','comercio-de-exemplo','cob06-ci-pendente',
 '00000000-0000-4000-8000-00000000c613','offline','entrega','dinheiro',
 4000,0,4000,200,80,280,3720,2,'CI Pendente','00000000000',
 repeat('3',64),repeat('c',64),'2040-01-31T12:00:00Z',
 'em_preparo','nao_atribuido','pendente','2040-01-15T12:00:00Z',NULL),
('00000000-0000-4000-8000-00000000c604','comercio-de-exemplo','cob06-ci-legado',
 '00000000-0000-4000-8000-00000000c614','offline','entrega','dinheiro',
 4000,0,4000,200,80,280,3720,2,'CI Legado','00000000000',
 repeat('4',64),repeat('d',64),'2040-01-31T12:00:00Z',
 'em_preparo','nao_atribuido','pendente','2024-01-15T12:00:00Z',NULL);


-- Reproduz a QA real de retirada: R$ 100, taxa integral de R$ 7, sem motoboy.
-- O codigo desta fixture ainda esta valido; no STAGING, o codigo expirado
-- exige tratamento separado antes de qualquer confirmacao.
INSERT INTO public.catalogo_pedidos(
 id,comercio_id,referencia_externa,idempotency_key,provedor,modalidade,
 forma_pagamento,subtotal_produtos_centavos,entrega_centavos,total_centavos,
 taxa_plataforma_centavos,taxa_motoboy_centavos,taxa_total_centavos,
 repasse_bruto_comercio_centavos,versao_financeira,cliente_nome,cliente_telefone,
 status_token_hash,codigo_entrega_hash,codigo_entrega_expira_em,
 status,entrega_status,status_pagamento,aceito_em,codigo_entrega_usado_em,
 comissao_plataforma_registrada
) VALUES (
 '00000000-0000-4000-8000-00000000c605','comercio-de-exemplo','cob06-ci-retirada-7porcento',
 '00000000-0000-4000-8000-00000000c615','offline','retirada','dinheiro',
 10000,0,10000,700,0,700,9300,2,'CI Retirada','00000000000',
 repeat('5',64),repeat('e',64),'2040-01-31T12:00:00Z',
 'pronto','nao_atribuido','pendente','2024-01-16T12:00:00Z',NULL,true
);

-- Reproduz anomalia HISTORICA: comissao aberta em janeiro/2024, mas a
-- cobranca Mercado Pago CI desse mes JA consta quitada no clone base.
INSERT INTO public.catalogo_comissoes_offline(
 pedido_id,comercio_id,competencia,subtotal_produtos_centavos,taxa_percentual,
 valor_comissao_centavos,versao_financeira,modalidade,
 taxa_plataforma_centavos,taxa_motoboy_centavos,valor_total_centavos,metadata
) VALUES (
 '00000000-0000-4000-8000-00000000c604','comercio-de-exemplo','2024-01-01',
 4000,7.00,280,2,'entrega',200,80,280,'{"fixture":"orfa_historica"}'::jsonb
);

-- Segundo caso historico: 7% integral da plataforma em retirada, sem
-- qualquer reserva de 2% ou remuneracao de motoboy.
INSERT INTO public.catalogo_comissoes_offline(
 pedido_id,comercio_id,competencia,subtotal_produtos_centavos,taxa_percentual,
 valor_comissao_centavos,versao_financeira,modalidade,
 taxa_plataforma_centavos,taxa_motoboy_centavos,valor_total_centavos,metadata
) VALUES (
 '00000000-0000-4000-8000-00000000c605','comercio-de-exemplo','2024-01-01',
 10000,7.00,700,2,'retirada',700,0,700,'{"fixture":"orfa_retirada_integral_7pct"}'::jsonb
);

INSERT INTO public.catalogo_logistica_offline_v2(
 pedido_id,comercio_id,competencia,valor_centavos
) VALUES (
 '00000000-0000-4000-8000-00000000c604','comercio-de-exemplo','2024-01-01',80
);

DO $prova$
DECLARE
 v_jan uuid;
 v_fev uuid;
 v_preview jsonb;
 v_snapshot text;
 v_atual text;
 v_retirada jsonb;
BEGIN
 IF catalogo_private.catalogo_v2_registrar_plataforma('00000000-0000-4000-8000-00000000c601','aceite') IS DISTINCT FROM true
 OR catalogo_private.catalogo_v2_registrar_plataforma('00000000-0000-4000-8000-00000000c603','aceite') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'COB06_CI: registro de aceite falhou'; END IF;
 IF (SELECT count(*) FROM public.catalogo_comissoes_offline
     WHERE comercio_id='comercio-de-exemplo' AND competencia='2040-01-01'
       AND status='aberta')<>2
 THEN RAISE EXCEPTION 'COB06_CI: comissoes nao iniciaram no mes do aceite'; END IF;

 v_jan:=public.catalogo_gerar_fechamento_offline('comercio-de-exemplo','2040-01-01');
 IF v_jan IS NULL
    OR (SELECT total_comissao_centavos FROM public.catalogo_fechamentos_offline WHERE id=v_jan)<>280
    OR (SELECT count(*) FROM public.catalogo_fatura_componentes_v2 WHERE fechamento_id=v_jan)<>2
 THEN RAISE EXCEPTION 'COB06_CI: fechamento incluiu pedido ainda nao entregue'; END IF;
 SELECT f.total_pedidos::text||'|'||f.total_comissao_centavos::text||'|'||f.status||'|'||
        (SELECT count(*)::text||'|'||coalesce(sum(valor_centavos),0)::text
         FROM public.catalogo_fatura_componentes_v2 WHERE fechamento_id=v_jan)
 INTO v_snapshot FROM public.catalogo_fechamentos_offline f WHERE f.id=v_jan;

 -- Novo pedido aceito em janeiro DEPOIS do fechamento: competencia fevereiro.
 INSERT INTO public.catalogo_pedidos(
  id,comercio_id,referencia_externa,idempotency_key,provedor,modalidade,
  forma_pagamento,subtotal_produtos_centavos,entrega_centavos,total_centavos,
  taxa_plataforma_centavos,taxa_motoboy_centavos,taxa_total_centavos,
  repasse_bruto_comercio_centavos,versao_financeira,cliente_nome,cliente_telefone,
  status_token_hash,codigo_entrega_hash,codigo_entrega_expira_em,
  status,entrega_status,status_pagamento,aceito_em,codigo_entrega_usado_em
 ) VALUES (
 '00000000-0000-4000-8000-00000000c602','comercio-de-exemplo','cob06-ci-novo',
 '00000000-0000-4000-8000-00000000c612','offline','entrega','dinheiro',
 4000,0,4000,200,80,280,3720,2,'CI Novo','00000000000',
 repeat('2',64),repeat('b',64),'2040-01-31T12:00:00Z',
 'em_preparo','nao_atribuido','pendente','2040-01-16T12:00:00Z',NULL);
 IF catalogo_private.catalogo_v2_registrar_plataforma('00000000-0000-4000-8000-00000000c602','aceite') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'COB06_CI: novo aceite falhou'; END IF;
 IF (SELECT competencia FROM public.catalogo_comissoes_offline
     WHERE pedido_id='00000000-0000-4000-8000-00000000c602')<>'2040-02-01'
 THEN RAISE EXCEPTION 'COB06_CI: novo pedido caiu em fatura congelada'; END IF;

 -- Entrega tardia do pedido aceito ANTES do fechamento deve migrar sem duplicar.
 UPDATE public.catalogo_pedidos
    SET status='entregue',entrega_status='entregue',status_pagamento='aprovado',
        codigo_entrega_usado_em='2040-01-20T10:00:00Z'
  WHERE id='00000000-0000-4000-8000-00000000c603';
 IF (SELECT competencia FROM public.catalogo_comissoes_offline
     WHERE pedido_id='00000000-0000-4000-8000-00000000c603')<>'2040-02-01'
    OR (SELECT competencia FROM public.catalogo_logistica_offline_v2
     WHERE pedido_id='00000000-0000-4000-8000-00000000c603')<>'2040-02-01'
 THEN RAISE EXCEPTION 'COB06_CI: entrega tardia nao deslocou comissao e logistica'; END IF;

 -- Caso historico com cobranca paga no clone: sem tocar no MP legado.
 UPDATE public.catalogo_pedidos
    SET status='entregue',entrega_status='entregue',status_pagamento='aprovado',
        codigo_entrega_usado_em='2024-01-20T10:00:00Z'
  WHERE id='00000000-0000-4000-8000-00000000c604';
 IF (SELECT competencia FROM public.catalogo_comissoes_offline
     WHERE pedido_id='00000000-0000-4000-8000-00000000c604')<>'2024-02-01'
    OR (SELECT competencia FROM public.catalogo_logistica_offline_v2
     WHERE pedido_id='00000000-0000-4000-8000-00000000c604')<>'2024-02-01'
    OR (SELECT count(*) FROM public.catalogo_fatura_cobrancas WHERE order_id='legacy-cob06-ci' AND status='pago')<>1
 THEN RAISE EXCEPTION 'COB06_CI: pedido antigo alterou/ficou na fatura quitada'; END IF;


 -- Repete o caso exato do STAGING (retirada presencial, 7%, sem motoboy),
 -- mas com codigo de teste valido e somente no clone descartavel.
 v_retirada:=public.catalogo_confirmar_entrega_autenticada(
   '4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid,'comercio-de-exemplo',
   '00000000-0000-4000-8000-00000000c605',repeat('e',64),NULL
 );
 IF (v_retirada->>'ok')::boolean IS DISTINCT FROM true
    OR (SELECT status FROM public.catalogo_pedidos
        WHERE id='00000000-0000-4000-8000-00000000c605')<>'entregue'
    OR (SELECT competencia FROM public.catalogo_comissoes_offline
        WHERE pedido_id='00000000-0000-4000-8000-00000000c605')<>'2024-02-01'
    OR EXISTS(SELECT 1 FROM public.catalogo_logistica_offline_v2
              WHERE pedido_id='00000000-0000-4000-8000-00000000c605')
    OR EXISTS(SELECT 1 FROM public.catalogo_remuneracoes_v2
              WHERE pedido_id='00000000-0000-4000-8000-00000000c605')
    OR (SELECT count(*) FROM public.catalogo_fatura_componentes_v2
        WHERE pedido_id='00000000-0000-4000-8000-00000000c605')<>0
    OR (SELECT count(*) FROM public.catalogo_fatura_cobrancas
        WHERE order_id='legacy-cob06-ci' AND status='pago')<>1
 THEN RAISE EXCEPTION 'COB06_CI: retirada de 7 pct mexeu na fatura paga: %',v_retirada; END IF;
 IF catalogo_private.catalogo_v2_registrar_plataforma(
    '00000000-0000-4000-8000-00000000c605','replay') IS DISTINCT FROM true
    OR (SELECT competencia FROM public.catalogo_comissoes_offline
        WHERE pedido_id='00000000-0000-4000-8000-00000000c605')<>'2024-02-01'
    OR (SELECT count(*) FROM public.catalogo_comissoes_offline
        WHERE pedido_id='00000000-0000-4000-8000-00000000c605')<>1
 THEN RAISE EXCEPTION 'COB06_CI: replay da retirada reintroduziu comissao paga'; END IF;

 UPDATE public.catalogo_pedidos
    SET status='entregue',entrega_status='entregue',status_pagamento='aprovado',
        codigo_entrega_usado_em='2040-01-20T11:00:00Z'
  WHERE id='00000000-0000-4000-8000-00000000c602';
 IF catalogo_private.catalogo_v2_registrar_plataforma('00000000-0000-4000-8000-00000000c602','pagamento') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'COB06_CI: replay do aceite falhou'; END IF;

 IF public.catalogo_gerar_fechamento_offline('comercio-de-exemplo','2040-01-01') IS DISTINCT FROM v_jan
 THEN RAISE EXCEPTION 'COB06_CI: fechamento anterior nao foi idempotente'; END IF;
 SELECT f.total_pedidos::text||'|'||f.total_comissao_centavos::text||'|'||f.status||'|'||
        (SELECT count(*)::text||'|'||coalesce(sum(valor_centavos),0)::text
         FROM public.catalogo_fatura_componentes_v2 WHERE fechamento_id=v_jan)
 INTO v_atual FROM public.catalogo_fechamentos_offline f WHERE f.id=v_jan;
 IF v_atual IS DISTINCT FROM v_snapshot
 THEN RAISE EXCEPTION 'COB06_CI: faturado antigo foi regravado'; END IF;

 v_fev:=public.catalogo_gerar_fechamento_offline('comercio-de-exemplo','2040-02-01');
 IF v_fev IS NULL
    OR (SELECT total_comissao_centavos FROM public.catalogo_fechamentos_offline WHERE id=v_fev)<>560
    OR (SELECT total_pedidos FROM public.catalogo_fechamentos_offline WHERE id=v_fev)<>2
    OR (SELECT count(*) FROM public.catalogo_fatura_componentes_v2 WHERE fechamento_id=v_fev)<>4
 THEN RAISE EXCEPTION 'COB06_CI: segunda competencia nao fechou exatamente R$5,60'; END IF;

 v_preview:=public.catalogo_asaas_previsualizar_acumulo('comercio-de-exemplo','2040-02-01');
 IF (v_preview->>'pronto_para_preparar')::boolean IS DISTINCT FROM true
    OR (v_preview->>'total_centavos')::bigint<>840
    OR (v_preview->>'quantidade_faturas')::int<>2
    OR (v_preview->>'snapshots_inconsistentes')::int<>0
 THEN RAISE EXCEPTION 'COB06_CI: acumulo de R$2,80+R$5,60 nao elegivel: %',v_preview; END IF;
 IF (SELECT count(*) FROM public.catalogo_comissoes_offline
     WHERE pedido_id IN ('00000000-0000-4000-8000-00000000c601',
                         '00000000-0000-4000-8000-00000000c602',
                         '00000000-0000-4000-8000-00000000c603',
                         '00000000-0000-4000-8000-00000000c604',
                         '00000000-0000-4000-8000-00000000c605'))<>5
 THEN RAISE EXCEPTION 'COB06_CI: comissao duplicada'; END IF;
 RAISE NOTICE 'COB06_RETIRADA_HISTORICA_7_PCT_SEM_LOGISTICA_CI_OK';
 RAISE NOTICE 'COB06_COMPETENCIA_CONGELADA_E_PENDENTE_CI_ROLLBACK_OK';
END;
$prova$;
ROLLBACK;
