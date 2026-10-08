-- Regressão financeira de webhooks Pix V2: taxa incompleta, revisão parcial,
-- referencia reutilizada, chargeback, estorno, idempotência e eventos antigos.
-- Somente catalogo_ci descartável, em transação que será revertida. SEM MP real.
DO $guard$
BEGIN
  IF current_database() <> 'catalogo_ci'
     OR current_setting('app.marketplace_test_webhook_finance', true) IS DISTINCT FROM 'enabled'
     OR to_regclass('public.catalogo_pagamentos_v2') IS NULL
     OR (SELECT count(*) FROM public.catalogo_pedidos) <> 0
  THEN
    RAISE EXCEPTION 'Revisao de Pix exige catalogo_ci isolado, vazio e opt-in';
  END IF;
END $guard$;

INSERT INTO public.catalogo_pedidos(
 id,comercio_id,referencia_externa,idempotency_key,
 modalidade,forma_pagamento,subtotal_produtos_centavos,entrega_centavos,total_centavos,
 taxa_plataforma_centavos,taxa_motoboy_centavos,taxa_total_centavos,
 repasse_bruto_comercio_centavos,versao_financeira,
 cliente_nome,cliente_telefone,status_token_hash,codigo_entrega_hash,codigo_entrega_expira_em
) VALUES
(
 '00000000-0000-4000-8000-000000000351','comercio-de-exemplo','ci-webhook-pix-a',
 '00000000-0000-4000-8000-000000000361',
 'entrega','pix',101,0,101,5,2,7,94,2,
 'Cliente Pix Fictício A','00000000000',repeat('3',64),
 repeat('e',64),now()+interval '1 hour'
),
(
 '00000000-0000-4000-8000-000000000352','comercio-de-exemplo','ci-webhook-pix-b',
 '00000000-0000-4000-8000-000000000362',
 'retirada','pix',101,0,101,7,0,7,94,2,
 'Cliente Pix Fictício B','00000000001',repeat('4',64),
 repeat('f',64),now()+interval '1 hour'
);

DO $partial$
DECLARE
  p_id uuid := '00000000-0000-4000-8000-000000000351';
  v jsonb;
BEGIN
  -- Um evento sem taxa confirmada jamais declara o financiamento provado.
  v := public.catalogo_aplicar_pagamento_v2(p_id,'approved',101,NULL,'mp-ci-pay-a');
  IF (v->>'ok')::boolean IS DISTINCT FROM true
     OR (v->>'financiamento_comprovado')::boolean IS DISTINCT FROM false
     OR (SELECT pagamento_revisao_pendente FROM public.catalogo_pedidos WHERE id=p_id) IS DISTINCT FROM true
     OR (SELECT taxa_centavos FROM public.catalogo_pagamentos_v2 WHERE pedido_id=p_id) IS NOT NULL
  THEN
    RAISE EXCEPTION 'Pix sem taxa confirmada foi classificado como financiado: %',v;
  END IF;

  -- Webhook duplicado sem taxa não cria novo registro, nem supõe prova externa.
  v := public.catalogo_aplicar_pagamento_v2(p_id,'approved',101,NULL,'mp-ci-pay-a');
  IF (v->>'idempotente')::boolean IS DISTINCT FROM true
     OR (SELECT count(*) FROM public.catalogo_pagamentos_v2 WHERE pedido_id=p_id) <> 1 THEN
    RAISE EXCEPTION 'Retry Pix sem taxa não foi idempotente: %',v;
  END IF;

  -- Divergência explícita não pode sobrescrever fatos financeiros registrados.
  v := public.catalogo_aplicar_pagamento_v2(p_id,'approved',101,8,'mp-ci-pay-a');
  IF (v->>'http_status')::integer <> 409
     OR (SELECT taxa_centavos FROM public.catalogo_pagamentos_v2 WHERE pedido_id=p_id) IS NOT NULL THEN
    RAISE EXCEPTION 'Taxa errada foi aceita: %',v;
  END IF;

  -- O provedor finalmente confirma a taxa exata de 7 centavos.
  v := public.catalogo_aplicar_pagamento_v2(p_id,'approved',101,7,'mp-ci-pay-a');
  IF (v->>'ok')::boolean IS DISTINCT FROM true
     OR (v->>'financiamento_comprovado')::boolean IS DISTINCT FROM true
     OR (SELECT pagamento_revisao_pendente FROM public.catalogo_pedidos WHERE id=p_id) IS DISTINCT FROM false
     OR (SELECT taxa_centavos FROM public.catalogo_pagamentos_v2 WHERE pedido_id=p_id) <> 7
     OR (SELECT count(*) FROM public.catalogo_pagamentos_v2 WHERE pedido_id=p_id) <> 1
  THEN
    RAISE EXCEPTION 'Comprovacao tardia não atualizou pagamento com segurança: %',v;
  END IF;

  -- Um status "cancelado" enviado depois da aprovação não desfaz o pagamento.
  v := public.catalogo_aplicar_pagamento_v2(p_id,'cancelado',101,7,'mp-ci-pay-a');
  IF (v->>'http_status')::integer <> 409
     OR (SELECT status FROM public.catalogo_pagamentos_v2 WHERE pedido_id=p_id) <> 'aprovado' THEN
    RAISE EXCEPTION 'Notificação cancelada sobrescreveu Pix aprovado: %',v;
  END IF;

  -- Reembolso parcial não paga automaticamente; exige revisão de conta e ledger.
  v := public.catalogo_aplicar_pagamento_v2(p_id,'revisao_parcial',101,7,'mp-ci-pay-a');
  IF (v->>'ok')::boolean IS DISTINCT FROM true
     OR (v->>'revisao_parcial')::boolean IS DISTINCT FROM true
     OR (SELECT status_pagamento FROM public.catalogo_pedidos WHERE id=p_id) <> 'contestado'
     OR (SELECT pagamento_revisao_pendente FROM public.catalogo_pedidos WHERE id=p_id) IS DISTINCT FROM true
     OR (SELECT count(*) FROM public.catalogo_ocorrencias_v2
         WHERE pedido_id=p_id AND origem='sistema') <> 1
  THEN
    RAISE EXCEPTION 'Reembolso parcial não gerou revisão financeira: %',v;
  END IF;

  -- Eventos repetidos não criam novas ocorrências.
  v := public.catalogo_aplicar_pagamento_v2(p_id,'revisao_parcial',101,7,'mp-ci-pay-a');
  IF (v->>'idempotente')::boolean IS DISTINCT FROM true
     OR (SELECT count(*) FROM public.catalogo_ocorrencias_v2
         WHERE pedido_id=p_id AND origem='sistema') <> 1 THEN
    RAISE EXCEPTION 'Reembolso parcial duplicado alterou auditoria: %',v;
  END IF;

  -- Tentativa de reaprovação tardia é bloqueada.
  v := public.catalogo_aplicar_pagamento_v2(p_id,'aprovado',101,7,'mp-ci-pay-a');
  IF (v->>'http_status')::integer <> 409 THEN
    RAISE EXCEPTION 'Reembolso parcial foi reaberto por evento antigo: %',v;
  END IF;

  v := public.catalogo_aplicar_pagamento_v2(p_id,'charged_back',101,7,'mp-ci-pay-a');
  IF (v->>'ok')::boolean IS DISTINCT FROM true
     OR (SELECT status FROM public.catalogo_pagamentos_v2 WHERE pedido_id=p_id) <> 'charged_back'
     OR (SELECT status_pagamento FROM public.catalogo_pedidos WHERE id=p_id) <> 'contestado'
  THEN
    RAISE EXCEPTION 'Chargeback não converteu revisão em contestação: %',v;
  END IF;

  v := public.catalogo_aplicar_pagamento_v2(p_id,'approved',101,7,'mp-ci-pay-a');
  IF (v->>'http_status')::integer <> 409
     OR (SELECT status FROM public.catalogo_pagamentos_v2 WHERE pedido_id=p_id) <> 'charged_back' THEN
    RAISE EXCEPTION 'Aprovação tardia reabriu chargeback: %',v;
  END IF;
END $partial$;

DO $refund$
DECLARE
  p_id uuid := '00000000-0000-4000-8000-000000000352';
  v jsonb;
BEGIN
  -- Referência de outro pedido NÃO pode ser reutilizada.
  v := public.catalogo_aplicar_pagamento_v2(p_id,'aprovado',101,7,'mp-ci-pay-a');
  IF (v->>'http_status')::integer <> 409
     OR EXISTS (SELECT 1 FROM public.catalogo_pagamentos_v2 WHERE pedido_id=p_id) THEN
    RAISE EXCEPTION 'Referencia alheia gerou conciliacao falsa: %',v;
  END IF;

  v := public.catalogo_aplicar_pagamento_v2(p_id,'aprovado',101,7,'mp-ci-pay-b');
  IF (v->>'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Pagamento da retirada não aprovado: %',v;
  END IF;

  v := public.catalogo_aplicar_pagamento_v2(p_id,'estornado',101,7,'mp-ci-pay-b');
  IF (v->>'ok')::boolean IS DISTINCT FROM true
     OR (SELECT status FROM public.catalogo_pagamentos_v2 WHERE pedido_id=p_id) <> 'estornado'
     OR (SELECT status_pagamento FROM public.catalogo_pedidos WHERE id=p_id) <> 'estornado' THEN
    RAISE EXCEPTION 'Estorno completo não foi reconhecido: %',v;
  END IF;

  v := public.catalogo_aplicar_pagamento_v2(p_id,'aprovado',101,7,'mp-ci-pay-b');
  IF (v->>'http_status')::integer <> 409 THEN
    RAISE EXCEPTION 'Aprovação tardia reabriu estorno completo: %',v;
  END IF;
END $refund$;

DO $end$
BEGIN
  IF (SELECT count(*) FROM public.catalogo_pagamentos_v2) <> 2
     OR (SELECT count(*) FROM public.catalogo_remuneracoes_v2) <> 0
     OR (SELECT count(*) FROM public.catalogo_lancamentos_financeiros_v2
         WHERE status='disponivel' AND tipo='remuneracao_motoboy') <> 0
  THEN
    RAISE EXCEPTION 'Cenarios de disputa financiaram motoboy sem entrega física';
  END IF;
END $end$;

SELECT 'PASS: taxa ausente, enriquecimento tardio, reembolso parcial, chargeback, estorno e idempotencia' AS result;
