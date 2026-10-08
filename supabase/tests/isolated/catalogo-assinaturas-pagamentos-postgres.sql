-- Teste de estados financeiros de assinatura no banco DESCARTÁVEL catalogo_ci.
-- Não faz chamadas ao Mercado Pago; simula callbacks diretamente no RPC versionado.
-- NUNCA executar contra produção ou bancos que contenham pagamentos reais.
DO $guard$
BEGIN
  IF current_database() <> 'catalogo_ci'
     OR current_setting('app.marketplace_test_payments', true) IS DISTINCT FROM 'enabled'
     OR to_regclass('public.catalogo_pagamentos') IS NULL
     OR to_regclass('public.catalogo_assinaturas') IS NULL
     OR to_regprocedure('public.catalogo_processar_evento_pagamento(text,text,text,text,text)') IS NULL
  THEN
    RAISE EXCEPTION 'Fixture de pagamentos exige catalogo_ci descartavel e opt-in explicito';
  END IF;
END $guard$;

DO $permissions$
BEGIN
  IF has_function_privilege('anon',
       'public.catalogo_processar_evento_pagamento(text,text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.catalogo_processar_evento_pagamento(text,text,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role',
       'public.catalogo_processar_evento_pagamento(text,text,text,text,text)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'RPC de pagamentos está disponível para papéis não autorizados';
  END IF;
END $permissions$;

INSERT INTO auth.users(id)
VALUES ('00000000-0000-4000-8000-000000000071')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.catalogos(comercio_id, proprietario_id)
VALUES
  ('pizzaria-andrelandia','00000000-0000-4000-8000-000000000071'),
  ('rn-pizzaria','00000000-0000-4000-8000-000000000071');

INSERT INTO public.catalogo_assinaturas(id, comercio_id, status)
VALUES
  ('00000000-0000-4000-8000-000000000081', 'pizzaria-andrelandia', 'pendente'),
  ('00000000-0000-4000-8000-000000000082', 'rn-pizzaria', 'pendente');

INSERT INTO public.catalogo_pagamentos(
  assinatura_id, comercio_id, plano, valor, referencia_externa, chave_idempotencia, order_id
) VALUES
  ('00000000-0000-4000-8000-000000000081', 'pizzaria-andrelandia',
   'mensal', 59.90, 'ci-assinatura-1', '00000000-0000-4000-8000-000000000091', 'ci-order-1'),
  ('00000000-0000-4000-8000-000000000082', 'rn-pizzaria',
   'anual', 599.90, 'ci-assinatura-2', '00000000-0000-4000-8000-000000000092', 'ci-order-2');

-- Pedido desconhecido jamais cria pagamento, cobrança ou assinatura.
DO $missing$
DECLARE v_result jsonb;
BEGIN
  v_result := public.catalogo_processar_evento_pagamento(
    'ci-order-desconhecida', 'ci-unknown-payment', 'aprovado', 'approved', null
  );
  IF v_result->>'reason' IS DISTINCT FROM 'payment_not_found'
     OR (v_result->>'updated')::boolean IS DISTINCT FROM false
     OR (SELECT count(*) FROM public.catalogo_pagamentos) <> 2 THEN
    RAISE EXCEPTION 'Evento sem pagamento cadastrado foi aceito';
  END IF;
END $missing$;

-- Confirmação ativa exatamente uma assinatura, preservando prazo e valor.
DO $approve$
DECLARE v_result jsonb; v_expira_em timestamptz;
BEGIN
  v_result := public.catalogo_processar_evento_pagamento(
    'ci-order-1', 'ci-pay-1', 'aprovado', 'approved', 'accredited'
  );
  IF (v_result->>'updated')::boolean IS DISTINCT FROM true
     OR (v_result->>'subscription_status') <> 'ativa' THEN
    RAISE EXCEPTION 'Pagamento aprovado não ativou assinatura';
  END IF;
  SELECT expira_em INTO v_expira_em FROM public.catalogo_assinaturas
  WHERE id = '00000000-0000-4000-8000-000000000081';
  IF v_expira_em IS NULL OR v_expira_em < now() + interval '29 days'
     OR v_expira_em > now() + interval '31 days' THEN
    RAISE EXCEPTION 'Prazo de assinatura mensal fora do esperado';
  END IF;

  -- Repetir a notificação não deve duplicar nem prolongar a assinatura.
  PERFORM public.catalogo_processar_evento_pagamento(
    'ci-order-1', 'ci-pay-1', 'aprovado', 'approved', 'accredited'
  );
  IF (SELECT expira_em FROM public.catalogo_assinaturas
       WHERE id = '00000000-0000-4000-8000-000000000081') IS DISTINCT FROM v_expira_em
     OR (SELECT count(*) FROM public.catalogo_assinaturas
         WHERE comercio_id='pizzaria-andrelandia' AND status='ativa') <> 1 THEN
    RAISE EXCEPTION 'Evento duplicado duplicou ou prorrogou assinatura';
  END IF;

  -- Um estado tardio não pode reverter aprovação.
  v_result := public.catalogo_processar_evento_pagamento(
    'ci-order-1', 'ci-pay-1', 'pendente', 'pending', 'late'
  );
  IF v_result->>'reason' IS DISTINCT FROM 'stale_terminal_event'
     OR (SELECT status FROM public.catalogo_pagamentos
         WHERE order_id='ci-order-1') <> 'aprovado' THEN
    RAISE EXCEPTION 'Webhook tardio reverteu pagamento já aprovado';
  END IF;
END $approve$;

-- Um estorno revoga assinatura e uma aprovação antiga não a reativa.
DO $refund$
DECLARE v_result jsonb;
BEGIN
  v_result := public.catalogo_processar_evento_pagamento(
    'ci-order-1','ci-pay-1','estornado','refunded',null
  );
  IF (v_result->>'updated')::boolean IS DISTINCT FROM true
     OR (SELECT status FROM public.catalogo_assinaturas
         WHERE id='00000000-0000-4000-8000-000000000081') <> 'cancelada'
     OR (SELECT status FROM public.catalogo_pagamentos
         WHERE order_id='ci-order-1') <> 'estornado' THEN
    RAISE EXCEPTION 'Estorno não cancelou assinatura';
  END IF;
  v_result := public.catalogo_processar_evento_pagamento(
    'ci-order-1','ci-pay-1','aprovado','approved','late'
  );
  IF v_result->>'reason' IS DISTINCT FROM 'final_state_preserved'
     OR (SELECT status FROM public.catalogo_assinaturas
         WHERE id='00000000-0000-4000-8000-000000000081') <> 'cancelada' THEN
    RAISE EXCEPTION 'Webhook antigo reabriu assinatura estornada';
  END IF;
END $refund$;

-- Recusa encerra o pagamento de uma assinatura que nunca foi aprovada.
DO $declined$
DECLARE v_result jsonb;
BEGIN
  v_result := public.catalogo_processar_evento_pagamento(
    'ci-order-2','ci-pay-2','recusado','rejected',null
  );
  IF (v_result->>'updated')::boolean IS DISTINCT FROM true
     OR (SELECT status FROM public.catalogo_assinaturas
         WHERE id='00000000-0000-4000-8000-000000000082') <> 'cancelada' THEN
    RAISE EXCEPTION 'Pagamento recusado não cancelou assinatura pendente';
  END IF;
  v_result := public.catalogo_processar_evento_pagamento(
    'ci-order-2','ci-pay-2','aprovado','approved','late'
  );
  IF v_result->>'reason' IS DISTINCT FROM 'closed_subscription_preserved' THEN
    RAISE EXCEPTION 'Notificação tardia reativou assinatura cancelada';
  END IF;
END $declined$;

DO $final$
BEGIN
  IF EXISTS (SELECT 1 FROM public.catalogo_assinaturas WHERE status='ativa'
             AND comercio_id IN ('pizzaria-andrelandia','rn-pizzaria'))
     OR (SELECT count(*) FROM public.catalogo_pagamentos) <> 2
     OR (SELECT count(*) FROM public.catalogo_pagamentos
         WHERE status IN ('estornado','recusado')) <> 2 THEN
    RAISE EXCEPTION 'Estado final financeiro divergente dos eventos testados';
  END IF;
END $final$;

SELECT 'PASS: pagamento aprovado/idempotente, evento tardio, estorno e recusa, sem provedor externo' AS result;
