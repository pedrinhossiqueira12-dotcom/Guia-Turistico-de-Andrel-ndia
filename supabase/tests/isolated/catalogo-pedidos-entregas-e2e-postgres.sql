-- Fluxos reais das RPCs financeiras, de pedidos e motoboys com dados FICTÍCIOS.
-- Executar SOMENTE no PostgreSQL DESCARTÁVEL catalogo_ci e dentro de BEGIN/ROLLBACK.
-- Nunca acessar Mercado Pago, outros serviços externos ou a base de produção.
DO $guard$
BEGIN
  IF current_database() <> 'catalogo_ci'
     OR current_setting('app.marketplace_test_orders', true) IS DISTINCT FROM 'enabled'
     OR to_regclass('public.catalogo_entregas_atribuidas') IS NULL
     OR to_regclass('public.catalogo_pagamentos_v2') IS NULL
     OR to_regclass('public.catalogo_remuneracoes_v2') IS NULL
     OR (SELECT count(*) FROM public.catalogo_pedidos) <> 0
  THEN
    RAISE EXCEPTION 'Cenario de pedidos exige catalogo_ci isolado, vazio e opt-in';
  END IF;
END $guard$;

-- A migração de allowlist criou apenas um comércio de exemplo com dono sintético.
INSERT INTO auth.users(id, email_confirmed_at) VALUES
 ('00000000-0000-4000-8000-000000000041', now()),
 ('00000000-0000-4000-8000-000000000042', now());

INSERT INTO public.catalogo_motoboys(comercio_id,usuario_id,nome,email,autorizado_por)
VALUES
 ('comercio-de-exemplo','00000000-0000-4000-8000-000000000041',
  'Entregador Fictício A','a@example.invalid','00000000-0000-4000-8000-000000000099'),
 ('comercio-de-exemplo','00000000-0000-4000-8000-000000000042',
  'Entregador Fictício B','b@example.invalid','00000000-0000-4000-8000-000000000099');

INSERT INTO public.catalogo_motoboy_perfis(usuario_id,disponivel,apto,em_analise)
VALUES
 ('00000000-0000-4000-8000-000000000041',true,true,false),
 ('00000000-0000-4000-8000-000000000042',true,true,false);

UPDATE public.catalogo_fluxo_config SET ativo=true, comercios_piloto=NULL WHERE id=true;

-- Dois pedidos Pix fictícios de R$ 1,01. A taxa única arredonda para 7 centavos:
-- 5 centavos plataforma + 2 centavos motoboy, SEM valor mínimo para entrega.
INSERT INTO public.catalogo_pedidos (
 id, comercio_id, referencia_externa, idempotency_key, modalidade, forma_pagamento,
 subtotal_produtos_centavos, entrega_centavos, total_centavos,
 taxa_plataforma_centavos, taxa_motoboy_centavos, taxa_total_centavos,
 repasse_bruto_comercio_centavos, versao_financeira,
 cliente_nome, cliente_telefone, status_token_hash,
 codigo_entrega_hash, codigo_entrega_expira_em
) VALUES
 (
 '00000000-0000-4000-8000-000000000051', 'comercio-de-exemplo',
 'ci-e2e-cancelado','00000000-0000-4000-8000-000000000061','entrega','pix',
 101,0,101,5,2,7,94,2,'Cliente Fictício 1','00000000000',
 repeat('a',64),repeat('c',64), now()+interval '1 hour'
 ),
 (
 '00000000-0000-4000-8000-000000000052', 'comercio-de-exemplo',
 'ci-e2e-entrega','00000000-0000-4000-8000-000000000062','entrega','pix',
 101,0,101,5,2,7,94,2,'Cliente Fictício 2','00000000001',
 repeat('b',64),repeat('c',64), now()+interval '1 hour'
 );

DO $test_payments$
DECLARE v jsonb;
BEGIN
  v := public.catalogo_aplicar_pagamento_v2(
    '00000000-0000-4000-8000-000000000051','aprovado',100,7,'ci-pix-1');
  IF (v->>'ok')::boolean IS DISTINCT FROM false OR (v->>'http_status')::int <> 409 THEN
    RAISE EXCEPTION 'Pagamento com valor divergente foi aceito';
  END IF;

  v := public.catalogo_aplicar_pagamento_v2(
    '00000000-0000-4000-8000-000000000051','aprovado',101,7,'ci-pix-1');
  IF (v->>'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Primeiro pagamento Pix fictício não foi aprovado: %',v;
  END IF;

  v := public.catalogo_aplicar_pagamento_v2(
    '00000000-0000-4000-8000-000000000052','aprovado',101,7,'ci-pix-2');
  IF (v->>'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Segundo pagamento Pix fictício não foi aprovado: %',v;
  END IF;

  v := public.catalogo_aplicar_pagamento_v2(
    '00000000-0000-4000-8000-000000000052','aprovado',101,7,'ci-pix-2');
  IF (v->>'idempotente')::boolean IS DISTINCT FROM true
     OR (SELECT count(*) FROM public.catalogo_pagamentos_v2) <> 2
     OR (SELECT count(*) FROM public.catalogo_remuneracoes_v2) <> 0 THEN
    RAISE EXCEPTION 'Pagamento repetido gerou cobrança/crédito duplicado: %',v;
  END IF;
END $test_payments$;

-- Comprador pode cancelar antes de o comércio aceitar, mantendo marca de reembolso Pix.
DO $test_cancel$
DECLARE v jsonb;
BEGIN
  v := public.catalogo_cancelar_comprador_v2(
   '00000000-0000-4000-8000-000000000051',repeat('d',64),'token errado');
  IF (v->>'http_status')::int <> 403 THEN
    RAISE EXCEPTION 'Token incorreto autorizou cancelamento';
  END IF;

  v := public.catalogo_cancelar_comprador_v2(
   '00000000-0000-4000-8000-000000000051',repeat('a',64),'Pedido feito por engano');
  IF (v->>'ok')::boolean IS DISTINCT FROM true
     OR (SELECT status FROM public.catalogo_pedidos
         WHERE id='00000000-0000-4000-8000-000000000051') <> 'cancelado'
     OR (SELECT reembolso_pendente FROM public.catalogo_pedidos
         WHERE id='00000000-0000-4000-8000-000000000051') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Cancelamento antes do aceite não sinalizou reembolso: %',v;
  END IF;

  v := public.catalogo_cancelar_comprador_v2(
   '00000000-0000-4000-8000-000000000051',repeat('a',64),'retry');
  IF (v->>'ok')::boolean IS DISTINCT FROM true
     OR (SELECT count(*) FROM public.catalogo_ocorrencias_v2
         WHERE pedido_id='00000000-0000-4000-8000-000000000051') <> 1 THEN
    RAISE EXCEPTION 'Cancelamento duplicado criou novas ocorrências';
  END IF;

  v := public.catalogo_operar_pedido_v2(
    '00000000-0000-4000-8000-000000000099','comercio-de-exemplo',
    '00000000-0000-4000-8000-000000000051','aceitar');
  IF (v->>'http_status')::int <> 409 THEN
    RAISE EXCEPTION 'Comércio aceitou pedido já cancelado';
  END IF;
END $test_cancel$;

-- O outro pedido é aceito e preparado pelo estabelecimento.
DO $test_merchant$
DECLARE v jsonb;
BEGIN
  v := public.catalogo_operar_pedido_v2(
    '00000000-0000-4000-8000-000000000041','comercio-de-exemplo',
    '00000000-0000-4000-8000-000000000052','aceitar');
  IF (v->>'http_status')::int <> 403 THEN
    RAISE EXCEPTION 'Motoboy tentou aceitar pedido como dono';
  END IF;

  v := public.catalogo_operar_pedido_v2(
    '00000000-0000-4000-8000-000000000099','comercio-de-exemplo',
    '00000000-0000-4000-8000-000000000052','aceitar');
  IF (v->>'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Comércio não conseguiu aceitar pedido pago: %',v;
  END IF;

  v := public.catalogo_cancelar_comprador_v2(
    '00000000-0000-4000-8000-000000000052',repeat('b',64),'Mudei de ideia');
  IF (v->>'http_status')::int <> 409
     OR (SELECT status FROM public.catalogo_pedidos
         WHERE id='00000000-0000-4000-8000-000000000052') <> 'em_preparo' THEN
    RAISE EXCEPTION 'Cancelamento normal foi autorizado depois do aceite: %',v;
  END IF;

  v := public.catalogo_operar_pedido_v2(
    '00000000-0000-4000-8000-000000000099','comercio-de-exemplo',
    '00000000-0000-4000-8000-000000000052','pronto');
  IF (v->>'ok')::boolean IS DISTINCT FROM true
     OR (SELECT entrega_status FROM public.catalogo_pedidos
         WHERE id='00000000-0000-4000-8000-000000000052') <> 'ofertado' THEN
    RAISE EXCEPTION 'Comércio não ofertou pedido pronto à rede: %',v;
  END IF;

  IF (SELECT count(*) FROM public.catalogo_remuneracoes_v2) <> 0
     OR (SELECT count(*) FROM public.catalogo_lancamentos_financeiros_v2
         WHERE tipo='remuneracao_motoboy') <> 0 THEN
    RAISE EXCEPTION 'Motoboy foi remunerado antes da entrega física';
  END IF;
END $test_merchant$;

DO $test_couriers$
DECLARE v jsonb;
BEGIN
  v := public.catalogo_motoboy_acao_v2(
    '00000000-0000-4000-8000-000000000041','aceitar_entrega',
    '00000000-0000-4000-8000-000000000052');
  IF (v->>'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Primeiro motoboy não conseguiu aceitar oferta: %',v;
  END IF;

  v := public.catalogo_motoboy_acao_v2(
    '00000000-0000-4000-8000-000000000042','aceitar_entrega',
    '00000000-0000-4000-8000-000000000052');
  IF (v->>'http_status')::int <> 409
     OR (SELECT count(*) FROM public.catalogo_entregas_atribuidas
         WHERE pedido_id='00000000-0000-4000-8000-000000000052') <> 1 THEN
    RAISE EXCEPTION 'Segundo motoboy capturou oferta já aceita: %',v;
  END IF;

  v := public.catalogo_motoboy_acao_v2(
    '00000000-0000-4000-8000-000000000041','desistir',
    '00000000-0000-4000-8000-000000000052');
  IF (v->>'reofertado')::boolean IS DISTINCT FROM true
     OR EXISTS (SELECT 1 FROM public.catalogo_entregas_atribuidas
                WHERE pedido_id='00000000-0000-4000-8000-000000000052') THEN
    RAISE EXCEPTION 'Desistência antes da coleta não reofertou pedido: %',v;
  END IF;

  v := public.catalogo_motoboy_acao_v2(
    '00000000-0000-4000-8000-000000000042','aceitar_entrega',
    '00000000-0000-4000-8000-000000000052');
  IF (v->>'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Segundo motoboy não conseguiu assumir pedido reofertado: %',v;
  END IF;

  v := public.catalogo_motoboy_acao_v2(
    '00000000-0000-4000-8000-000000000041','coletar',
    '00000000-0000-4000-8000-000000000052');
  IF (v->>'http_status')::int <> 403 THEN
    RAISE EXCEPTION 'Motoboy sem atribuição conseguiu coletar pedido';
  END IF;

  v := public.catalogo_motoboy_acao_v2(
    '00000000-0000-4000-8000-000000000042','coletar',
    '00000000-0000-4000-8000-000000000052');
  IF (v->>'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Motoboy responsável não conseguiu coletar: %',v;
  END IF;

  v := public.catalogo_motoboy_acao_v2(
    '00000000-0000-4000-8000-000000000042','em_entrega',
    '00000000-0000-4000-8000-000000000052');
  IF (v->>'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Motoboy não conseguiu iniciar a entrega: %',v;
  END IF;

  IF (SELECT count(*) FROM public.catalogo_remuneracoes_v2) <> 0 THEN
    RAISE EXCEPTION 'Crédito de motoboy gerado antes da confirmação por código';
  END IF;
END $test_couriers$;

DO $test_delivery$
DECLARE v jsonb;
BEGIN
  v := public.catalogo_confirmar_entrega_motoboy(
    '00000000-0000-4000-8000-000000000041','comercio-de-exemplo',
    '00000000-0000-4000-8000-000000000052',repeat('c',64));
  IF (v->>'http_status')::int <> 403 THEN
    RAISE EXCEPTION 'Motoboy não atribuído concluiu entrega';
  END IF;

  v := public.catalogo_confirmar_entrega_motoboy(
    '00000000-0000-4000-8000-000000000042','comercio-de-exemplo',
    '00000000-0000-4000-8000-000000000052',repeat('d',64));
  IF (v->>'http_status')::int <> 403
     OR (SELECT codigo_entrega_tentativas FROM public.catalogo_pedidos
         WHERE id='00000000-0000-4000-8000-000000000052') <> 1 THEN
    RAISE EXCEPTION 'Código incorreto não foi rejeitado/contabilizado: %',v;
  END IF;

  v := public.catalogo_confirmar_entrega_motoboy(
    '00000000-0000-4000-8000-000000000042','comercio-de-exemplo',
    '00000000-0000-4000-8000-000000000052',repeat('c',64));
  IF (v->>'ok')::boolean IS DISTINCT FROM true
     OR (v->>'remuneracao_registrada')::boolean IS DISTINCT FROM true
     OR (SELECT entrega_status FROM public.catalogo_pedidos
         WHERE id='00000000-0000-4000-8000-000000000052') <> 'entregue' THEN
    RAISE EXCEPTION 'Entrega válida não criou remuneração: %',v;
  END IF;

  IF (SELECT count(*) FROM public.catalogo_remuneracoes_v2
      WHERE pedido_id='00000000-0000-4000-8000-000000000052'
        AND motoboy_id='00000000-0000-4000-8000-000000000042'
        AND valor_centavos=2 AND status='disponivel') <> 1
     OR (SELECT count(*) FROM public.catalogo_lancamentos_financeiros_v2
         WHERE pedido_id='00000000-0000-4000-8000-000000000052'
           AND tipo='remuneracao_motoboy' AND valor_centavos=2) <> 1 THEN
    RAISE EXCEPTION '2 centavos do motoboy Pix não foram creditados corretamente';
  END IF;

  v := public.catalogo_confirmar_entrega_motoboy(
    '00000000-0000-4000-8000-000000000042','comercio-de-exemplo',
    '00000000-0000-4000-8000-000000000052',repeat('c',64));
  IF (v->>'http_status')::int <> 409
     OR (SELECT count(*) FROM public.catalogo_remuneracoes_v2) <> 1 THEN
    RAISE EXCEPTION 'Confirmação duplicada criou crédito adicional: %',v;
  END IF;
END $test_delivery$;

-- Self-service de saque: só mês anterior, lastro válido e chave Pix protegida.
DO $test_saque_mensal$
DECLARE v jsonb; v_again jsonb; v_count integer;
BEGIN
  UPDATE public.catalogo_remuneracoes_v2
     SET criado_em=date_trunc('month',pg_catalog.now())-interval '1 day'
   WHERE pedido_id='00000000-0000-4000-8000-000000000052';
  v := public.catalogo_motoboy_saque_mensal_v2(
    '00000000-0000-4000-8000-000000000042','solicitar');
  IF (v->>'http_status')::integer <> 409 THEN
    RAISE EXCEPTION 'Saque sem chave Pix protegida deveria ser recusado: %',v;
  END IF;
  UPDATE public.catalogo_motoboy_perfis
     SET chave_pix_enc='pix-v2:abcdefghijklmnop.AAAAAAAAAAAAAAAAAAAAAAAA'
   WHERE usuario_id='00000000-0000-4000-8000-000000000042';
  v := public.catalogo_motoboy_saque_mensal_v2(
    '00000000-0000-4000-8000-000000000042','solicitar');
  IF (v->>'ok')::boolean IS DISTINCT FROM true
     OR (v->>'valor_solicitado_centavos')::bigint <> 2
     OR (v->>'transferencia_executada')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Saque mensal fictício sem transferência foi recusado: %',v;
  END IF;
  v_again := public.catalogo_motoboy_saque_mensal_v2(
    '00000000-0000-4000-8000-000000000042','solicitar');
  IF (v_again->>'http_status')::integer <> 409 THEN
    RAISE EXCEPTION 'Solicitação mensal duplicada deveria retornar 409: %',v_again;
  END IF;
  SELECT count(*) INTO v_count FROM public.catalogo_solicitacao_saque_itens_v2;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Crédito do pedido foi contabilizado mais de uma vez'; END IF;
  v := public.catalogo_motoboy_saque_mensal_v2(
    '00000000-0000-4000-8000-000000000041','listar');
  IF coalesce(jsonb_array_length(v->'solicitacoes'),0) <> 0 THEN
    RAISE EXCEPTION 'Solicitação de outro entregador vazou no extrato';
  END IF;
END $test_saque_mensal$;

-- Estorno simulado antes do saque impede o crédito anterior de permanecer disponível.
DO $test_refund$
DECLARE v jsonb;
BEGIN
  v := public.catalogo_aplicar_pagamento_v2(
    '00000000-0000-4000-8000-000000000052','estornado',101,7,'ci-pix-2');
  IF (v->>'ok')::boolean IS DISTINCT FROM true
     OR (SELECT status FROM public.catalogo_remuneracoes_v2
         WHERE pedido_id='00000000-0000-4000-8000-000000000052') <> 'estornado' THEN
    RAISE EXCEPTION 'Estorno após a entrega não reverteu crédito ainda não pago: %',v;
  END IF;
  IF (SELECT status FROM public.catalogo_solicitacoes_saque_v2
      WHERE motoboy_id='00000000-0000-4000-8000-000000000042') <> 'em_analise' THEN
    RAISE EXCEPTION 'Estorno não suspendeu o saque mensal para revisão';
  END IF;

  v := public.catalogo_aplicar_pagamento_v2(
    '00000000-0000-4000-8000-000000000052','aprovado',101,7,'ci-pix-2');
  IF (v->>'http_status')::int <> 409
     OR (SELECT status FROM public.catalogo_remuneracoes_v2
         WHERE pedido_id='00000000-0000-4000-8000-000000000052') <> 'estornado' THEN
    RAISE EXCEPTION 'Webhook antigo reabriu pagamento após estorno: %',v;
  END IF;
END $test_refund$;

SELECT 'PASS: Pix, cancelamento, aceite, disputa de motoboys, confirmação física, 2% e estorno' AS result;
