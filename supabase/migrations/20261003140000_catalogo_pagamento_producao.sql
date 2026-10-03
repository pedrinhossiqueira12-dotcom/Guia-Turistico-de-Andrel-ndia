-- Preparação do checkout Pix de produção; esta migração deve ser revisada antes de aplicada.
-- Não habilita a cobrança. A função de produção exige MP_PRODUCTION_ENABLED=true.
-- Cancelar somente assinaturas sandbox pendentes já marcadas como teste, preservando histórico e metadata.
BEGIN;

UPDATE public.catalogo_assinaturas
SET status = 'cancelada',
    expira_em = pg_catalog.now()
WHERE status = 'pendente'
  AND gateway = 'mercadopago_sandbox'
  AND (
    metadata ->> 'sandbox_only' = 'true'
    OR metadata #>> '{sandbox,sandbox_only}' = 'true'
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.catalogo_pagamentos
    GROUP BY assinatura_id
    HAVING pg_catalog.count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Migração interrompida: há mais de um pagamento por assinatura em catalogo_pagamentos; revisar os registros antes de continuar.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS catalogo_pagamentos_assinatura_unica
  ON public.catalogo_pagamentos (assinatura_id);

CREATE OR REPLACE FUNCTION public.catalogo_processar_evento_pagamento(
  p_order_id text,
  p_payment_id text,
  p_estado text,
  p_status_provedor text,
  p_detalhe_status_provedor text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment public.catalogo_pagamentos%ROWTYPE;
  v_subscription public.catalogo_assinaturas%ROWTYPE;
  v_paid_at timestamptz;
  v_expira_em timestamptz;
BEGIN
  IF p_order_id IS NULL OR pg_catalog.length(pg_catalog.btrim(p_order_id)) = 0 THEN
    RAISE EXCEPTION 'order_id inválido';
  END IF;
  IF p_estado IS NULL OR p_estado NOT IN ('pendente','aprovado','recusado','cancelado','expirado','estornado','contestado') THEN
    RAISE EXCEPTION 'estado de pagamento inválido';
  END IF;

  SELECT cp.*
  INTO v_payment
  FROM public.catalogo_pagamentos AS cp
  WHERE cp.order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('updated', false, 'reason', 'payment_not_found');
  END IF;

  SELECT ca.*
  INTO v_subscription
  FROM public.catalogo_assinaturas AS ca
  WHERE ca.id = v_payment.assinatura_id
    AND ca.comercio_id = v_payment.comercio_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'assinatura vinculada ao pagamento não encontrada';
  END IF;

  -- Eventos atrasados não podem desfazer estorno/contestação nem reabrir cobrança encerrada.
  IF v_payment.status IN ('estornado','contestado')
     AND p_estado NOT IN ('estornado','contestado') THEN
    RETURN pg_catalog.jsonb_build_object('updated', false, 'reason', 'final_state_preserved', 'state', v_payment.status);
  END IF;
  IF v_payment.status IN ('aprovado','recusado','cancelado','expirado')
     AND p_estado IN ('pendente','recusado','cancelado','expirado') THEN
    RETURN pg_catalog.jsonb_build_object('updated', false, 'reason', 'stale_terminal_event', 'state', v_payment.status);
  END IF;
  IF v_subscription.status IN ('cancelada','expirada') AND p_estado = 'aprovado' THEN
    RETURN pg_catalog.jsonb_build_object('updated', false, 'reason', 'closed_subscription_preserved', 'state', v_subscription.status);
  END IF;

  IF p_estado = 'aprovado' THEN
    UPDATE public.catalogo_assinaturas AS old
    SET status = 'expirada'
    WHERE old.comercio_id = v_payment.comercio_id
      AND old.id <> v_subscription.id
      AND old.status = 'ativa'
      AND old.expira_em IS NOT NULL
      AND old.expira_em <= pg_catalog.now();

    IF EXISTS (
      SELECT 1
      FROM public.catalogo_assinaturas AS other
      WHERE other.comercio_id = v_payment.comercio_id
        AND other.id <> v_subscription.id
        AND other.status = 'ativa'
        AND (other.expira_em IS NULL OR other.expira_em > pg_catalog.now())
    ) THEN
      RETURN pg_catalog.jsonb_build_object('updated', false, 'reason', 'another_active_subscription');
    END IF;

    v_paid_at := COALESCE(v_subscription.pago_em, pg_catalog.now());
    v_expira_em := CASE v_payment.plano
      WHEN 'mensal' THEN v_paid_at + INTERVAL '30 days'
      WHEN 'anual' THEN v_paid_at + INTERVAL '365 days'
      ELSE NULL
    END;
    IF v_expira_em IS NULL THEN
      RAISE EXCEPTION 'plano do pagamento inválido';
    END IF;

    UPDATE public.catalogo_assinaturas
    SET status = 'ativa',
        pago_em = v_paid_at,
        expira_em = CASE
          WHEN v_subscription.status = 'ativa' AND v_subscription.expira_em IS NOT NULL THEN v_subscription.expira_em
          ELSE v_expira_em
        END,
        valor = v_payment.valor,
        gateway = 'mercadopago',
        cobranca_id = p_order_id,
        metadata = pg_catalog.jsonb_set(
          COALESCE(v_subscription.metadata, '{}'::jsonb),
          '{pagamento_confirmado}',
          pg_catalog.jsonb_build_object('gateway','mercadopago','order_id',p_order_id,'confirmado_em',pg_catalog.now()),
          true
        )
    WHERE id = v_subscription.id;

    UPDATE public.catalogo_pagamentos
    SET status = 'aprovado',
        payment_id = COALESCE(p_payment_id, payment_id),
        status_provedor = pg_catalog.left(COALESCE(p_status_provedor, ''), 120),
        detalhe_status_provedor = pg_catalog.left(COALESCE(p_detalhe_status_provedor, ''), 120),
        pago_em = COALESCE(pago_em, v_paid_at),
        atualizado_em = pg_catalog.now()
    WHERE id = v_payment.id;

    RETURN pg_catalog.jsonb_build_object('updated', true, 'state', 'aprovado', 'subscription_status', 'ativa', 'expira_em', v_expira_em);
  END IF;

  UPDATE public.catalogo_pagamentos
  SET status = p_estado,
      payment_id = COALESCE(p_payment_id, payment_id),
      status_provedor = pg_catalog.left(COALESCE(p_status_provedor, ''), 120),
      detalhe_status_provedor = pg_catalog.left(COALESCE(p_detalhe_status_provedor, ''), 120),
      atualizado_em = pg_catalog.now()
  WHERE id = v_payment.id;

  IF p_estado IN ('estornado','contestado') THEN
    UPDATE public.catalogo_assinaturas
    SET status = 'cancelada',
        expira_em = pg_catalog.now(),
        metadata = pg_catalog.jsonb_set(
          COALESCE(v_subscription.metadata, '{}'::jsonb),
          '{pagamento_finalizado}',
          pg_catalog.jsonb_build_object('gateway','mercadopago','order_id',p_order_id,'estado',p_estado,'confirmado_em',pg_catalog.now()),
          true
        )
    WHERE id = v_subscription.id;
  ELSIF p_estado IN ('recusado','cancelado','expirado') AND v_subscription.status = 'pendente' THEN
    UPDATE public.catalogo_assinaturas
    SET status = 'cancelada',
        expira_em = pg_catalog.now(),
        metadata = pg_catalog.jsonb_set(
          COALESCE(v_subscription.metadata, '{}'::jsonb),
          '{pagamento_finalizado}',
          pg_catalog.jsonb_build_object('gateway','mercadopago','order_id',p_order_id,'estado',p_estado,'confirmado_em',pg_catalog.now()),
          true
        )
    WHERE id = v_subscription.id;
  END IF;

  RETURN pg_catalog.jsonb_build_object('updated', true, 'state', p_estado, 'subscription_status', CASE WHEN p_estado IN ('estornado','contestado','recusado','cancelado','expirado') THEN 'cancelada' ELSE v_subscription.status END);
END;
$$;

CREATE OR REPLACE FUNCTION public.catalogo_limpar_email_pagador(p_assinatura_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.catalogo_assinaturas
  SET metadata = COALESCE(metadata, '{}'::jsonb) #- '{producao,email_pagador}'
  WHERE id = p_assinatura_id
    AND gateway = 'mercadopago';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.catalogo_limpar_email_pagador(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_limpar_email_pagador(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.catalogo_processar_evento_pagamento(text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_processar_evento_pagamento(text,text,text,text,text) TO service_role;

COMMIT;
