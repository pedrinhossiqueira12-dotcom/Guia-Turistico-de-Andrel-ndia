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
     SET criado_em=date_trunc('month',pg_catalog.now())-interval '2 months'
   WHERE pedido_id='00000000-0000-4000-8000-000000000052';
  v := public.catalogo_motoboy_saque_mensal_v2(
    '00000000-0000-4000-8000-000000000042','solicitar');
  IF (v->>'http_status')::integer <> 409 THEN
    RAISE EXCEPTION 'Saque sem chave Pix protegida deveria ser recusado: %',v;
  END IF;
  UPDATE public.catalogo_motoboy_perfis
     SET chave_pix_enc='pix-v2:abcdefghijklmnop.AAAAAAAAAAAAAAAAAAAAAAAA',
         chave_pix_tipo='EMAIL'
   WHERE usuario_id='00000000-0000-4000-8000-000000000042';
  -- Mesmo financiado, um crédito do mês EM CURSO não pode ser sacado.
  UPDATE public.catalogo_remuneracoes_v2
     SET criado_em=pg_catalog.now()
   WHERE pedido_id='00000000-0000-4000-8000-000000000052';
  v := public.catalogo_motoboy_saque_mensal_v2(
    '00000000-0000-4000-8000-000000000042','solicitar');
  IF (v->>'http_status')::integer <> 409 THEN
    RAISE EXCEPTION 'Crédito do mês em curso não pode ser solicitado: %',v;
  END IF;
  -- Crédito acumulado de dois meses atrás CONTINUA sacável.
  UPDATE public.catalogo_remuneracoes_v2
     SET criado_em=date_trunc('month',pg_catalog.now())-interval '2 months'
   WHERE pedido_id='00000000-0000-4000-8000-000000000052';
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

-- Salvar chave e tipo deve ser autenticado por motoboy; bloquear tipo ausente.
DO $test_pix_tipado$
DECLARE v jsonb;
BEGIN
  IF pg_catalog.has_function_privilege('anon',
    'public.catalogo_salvar_chave_pix_tipado_v2(uuid,text,text)','EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated',
    'public.catalogo_salvar_chave_pix_tipado_v2(uuid,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Cadastro Pix tipado exposto fora do backend';
  END IF;
  v := public.catalogo_salvar_chave_pix_tipado_v2(
    '00000000-0000-4000-8000-000000000042',
    'pix-v2:abcdefghijklmnop.AAAAAAAAAAAAAAAAAAAAAAAA',NULL);
  IF (v->>'http_status')::integer <> 400 THEN
    RAISE EXCEPTION 'Aceitou chave cifrada sem tipo Pix: %',v;
  END IF;
  v := public.catalogo_salvar_chave_pix_tipado_v2(
    '00000000-0000-4000-8000-000000000042',
    'pix-v2:abcdefghijklmnop.AAAAAAAAAAAAAAAAAAAAAAAA','EMAIL');
  IF (v->>'ok')::boolean IS DISTINCT FROM true OR
      (SELECT chave_pix_tipo FROM public.catalogo_motoboy_perfis
       WHERE usuario_id='00000000-0000-4000-8000-000000000042')<>'EMAIL' THEN
    RAISE EXCEPTION 'Não atualizou chave protegida e seu tipo: %',v;
  END IF;
END $test_pix_tipado$;

-- Somente no PostgreSQL CI descartável: altera temporariamente a remuneração
-- fictícia para R$ 12,34 e testa a RESERVA. SAVEPOINT restaura o snapshot original.
SAVEPOINT payout_reserva_fake;
UPDATE public.catalogo_remuneracoes_v2 SET valor_centavos=1234
 WHERE pedido_id='00000000-0000-4000-8000-000000000052';
UPDATE public.catalogo_solicitacao_saque_itens_v2 SET valor_centavos=1234
 WHERE remuneracao_id=(SELECT id FROM public.catalogo_remuneracoes_v2
 WHERE pedido_id='00000000-0000-4000-8000-000000000052');
UPDATE public.catalogo_solicitacoes_saque_v2 SET valor_centavos=1234
 WHERE motoboy_id='00000000-0000-4000-8000-000000000042';
DO $test_payout_reserva$
DECLARE v jsonb; v_repetido jsonb; v_intent uuid; v_blocked boolean:=false;
BEGIN
  IF pg_catalog.has_function_privilege('anon',
       'public.catalogo_reservar_payout_v2(uuid,text)','EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated',
       'public.catalogo_marcar_envio_payout_v2(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'RPC privada de transferência exposta na Data API pública';
  END IF;
  v := public.catalogo_reservar_payout_v2(
    (SELECT id FROM public.catalogo_solicitacoes_saque_v2
       WHERE motoboy_id='00000000-0000-4000-8000-000000000042'),
    'EMAIL');
  IF (v->>'ok')::boolean IS DISTINCT FROM true OR
     (v->>'idempotente')::boolean IS DISTINCT FROM false OR
     (v->>'valor_centavos')::bigint <> 1234 OR
     (v->>'reenviar_permitido')::boolean IS DISTINCT FROM false THEN
     RAISE EXCEPTION 'Reserva inválida em PostgreSQL CI: %', v;
  END IF;
  v_intent := (v->>'intent_id')::uuid;
  v_repetido := public.catalogo_reservar_payout_v2(
    (SELECT id FROM public.catalogo_solicitacoes_saque_v2
       WHERE motoboy_id='00000000-0000-4000-8000-000000000042'),
    'EMAIL');
  IF (v_repetido->>'idempotente')::boolean IS DISTINCT FROM true OR
     (v_repetido->>'intent_id')::uuid IS DISTINCT FROM v_intent OR
     (SELECT count(*) FROM public.catalogo_payout_intents_v2) <> 1 THEN
    RAISE EXCEPTION 'Retry criou payout duplicado: %', v_repetido;
  END IF;
  -- Não permitir chave diferente enquanto houver intent pendente.
  BEGIN
    UPDATE public.catalogo_motoboy_perfis SET chave_pix_tipo='PHONE'
      WHERE usuario_id='00000000-0000-4000-8000-000000000042';
    RAISE EXCEPTION 'Troca do tipo Pix foi aceita com payout pendente';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='Troca do tipo Pix foi aceita com payout pendente' THEN
      RAISE;
    END IF;
  END;
  v := public.catalogo_marcar_envio_payout_v2(v_intent);
  IF (v->>'ok')::boolean IS DISTINCT FROM true OR
     (SELECT tentativas FROM public.catalogo_payout_intents_v2 WHERE id=v_intent) <> 1 THEN
    RAISE EXCEPTION 'Primeira tentativa não gravada antes do envio: %', v;
  END IF;
  v := public.catalogo_marcar_envio_payout_v2(v_intent);
  IF (v->>'http_status')::integer <> 409 THEN
    RAISE EXCEPTION 'Retry pós-envio não foi bloqueado: %', v;
  END IF;
  BEGIN
    UPDATE public.catalogo_remuneracoes_v2 SET status='pago'
      WHERE pedido_id='00000000-0000-4000-8000-000000000052';
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'Crédito reservado foi pago manualmente em duplicidade';
  END IF;
  UPDATE public.catalogo_remuneracoes_v2 SET status='estornado'
    WHERE pedido_id='00000000-0000-4000-8000-000000000052';
  IF (SELECT status FROM public.catalogo_payout_intents_v2
      WHERE id=v_intent) <> 'em_analise' THEN
    RAISE EXCEPTION 'Estorno após reserva não colocou transferência em revisão';
  END IF;
END $test_payout_reserva$;
ROLLBACK TO SAVEPOINT payout_reserva_fake;
RELEASE SAVEPOINT payout_reserva_fake;

-- ETAPA 3B: teste de confirmação real simulada, auditável e atômica.
-- O cenário é inteiramente descartado com SAVEPOINT/ROLLBACK.
SAVEPOINT payout_conciliacao_fake;
UPDATE public.catalogo_remuneracoes_v2 SET valor_centavos=1234
 WHERE pedido_id='00000000-0000-4000-8000-000000000052';
UPDATE public.catalogo_solicitacao_saque_itens_v2 SET valor_centavos=1234
 WHERE remuneracao_id=(SELECT id FROM public.catalogo_remuneracoes_v2
 WHERE pedido_id='00000000-0000-4000-8000-000000000052');
UPDATE public.catalogo_solicitacoes_saque_v2 SET valor_centavos=1234
 WHERE motoboy_id='00000000-0000-4000-8000-000000000042';
DO $test_payout_conciliacao$
DECLARE
  v jsonb;
  v_intent uuid;
  v_solicitacao uuid;
  v_ref text;
  v_tx_ref text;
  v_payout text := 'POP01KV681P6SJ38NQHWX3XK162SS';
  v_tx text := 'TOP01KV681P6SJ38NQHWX3SF2WM22';
BEGIN
  IF pg_catalog.has_function_privilege('anon',
       'public.catalogo_conciliar_payout_v2(uuid,text,text,text,text,bigint,text,text)',
       'EXECUTE') OR pg_catalog.has_function_privilege('authenticated',
       'public.catalogo_registrar_criacao_payout_v2(uuid,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Rotina de confirmação de dinheiro exposta ao público';
  END IF;
  SELECT id INTO v_solicitacao FROM public.catalogo_solicitacoes_saque_v2
    WHERE motoboy_id='00000000-0000-4000-8000-000000000042';
  v := public.catalogo_reservar_payout_v2(v_solicitacao,'EMAIL');
  IF (v->>'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Não reservou segunda prova financeira fictícia: %',v;
  END IF;
  v_intent := (v->>'intent_id')::uuid;
  v_ref := 'saque_'||pg_catalog.replace(v_solicitacao::text,'-','');
  v_tx_ref := 'motoboy_'||pg_catalog.replace(v_solicitacao::text,'-','');
  -- Sem POST ou confirmação do provedor, não se pode associar IDs.
  v := public.catalogo_registrar_criacao_payout_v2(v_intent,v_payout,v_tx);
  IF (v->>'http_status')::integer <> 409 THEN
    RAISE EXCEPTION 'Vinculou provedor antes de iniciar tentativa: %',v;
  END IF;
  v := public.catalogo_marcar_envio_payout_v2(v_intent);
  IF (v->>'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Não registrou tentativa de envio: %',v;
  END IF;
  v := public.catalogo_registrar_criacao_payout_v2(v_intent,v_payout,v_tx);
  IF (v->>'ok')::boolean IS DISTINCT FROM true OR
     (v->>'transferencia_confirmada')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'HTTP 202 indevidamente considerado pago: %',v;
  END IF;
  v := public.catalogo_registrar_criacao_payout_v2(v_intent,v_payout,v_tx);
  IF (v->>'idempotente')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'POST duplicado deveria ser idempotente: %',v;
  END IF;
  v := public.catalogo_conciliar_payout_v2(
    v_intent,v_payout,v_tx,v_ref,v_tx_ref,1234,'pending','not_accredited');
  IF (v->>'transferencia_confirmada')::boolean IS DISTINCT FROM false OR
      (SELECT count(*) FROM public.catalogo_repasses_v2)<>0 THEN
    RAISE EXCEPTION 'Payout pendente foi considerado pago: %',v;
  END IF;
  v := public.catalogo_conciliar_payout_v2(
    v_intent,v_payout,v_tx,v_ref,v_tx_ref,1235,'success','accredited');
  IF (v->>'http_status')::integer <> 409 OR
      (SELECT count(*) FROM public.catalogo_repasses_v2)<>0 THEN
    RAISE EXCEPTION 'Valor divergente autorizou saída financeira: %',v;
  END IF;
  v := public.catalogo_conciliar_payout_v2(
    v_intent,v_payout,v_tx,v_ref,v_tx_ref,1234,'success','accredited');
  IF (v->>'ok')::boolean IS DISTINCT FROM true OR
      (v->>'transferencia_confirmada')::boolean IS DISTINCT FROM true OR
      (SELECT status FROM public.catalogo_payout_intents_v2 WHERE id=v_intent)<>'confirmado' OR
      (SELECT status FROM public.catalogo_solicitacoes_saque_v2
       WHERE id=v_solicitacao)<>'pago' OR
      (SELECT status FROM public.catalogo_remuneracoes_v2
       WHERE pedido_id='00000000-0000-4000-8000-000000000052')<>'pago' OR
      (SELECT count(*) FROM public.catalogo_repasses_v2
       WHERE origem_registro='payout_provedor' AND registrado_por IS NULL
         AND referencia='mp-payout:'||v_tx AND valor_centavos=1234)<>1 THEN
    RAISE EXCEPTION 'Pagamento comprovado não gerou baixa transacional: %',v;
  END IF;
  v := public.catalogo_conciliar_payout_v2(
    v_intent,v_payout,v_tx,v_ref,v_tx_ref,1234,'success','accredited');
  IF (v->>'idempotente')::boolean IS DISTINCT FROM true OR
      (SELECT count(*) FROM public.catalogo_repasses_v2)<>1 THEN
    RAISE EXCEPTION 'Callback repetido criou repasse duplicado: %',v;
  END IF;
END $test_payout_conciliacao$;
ROLLBACK TO SAVEPOINT payout_conciliacao_fake;
RELEASE SAVEPOINT payout_conciliacao_fake;

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
