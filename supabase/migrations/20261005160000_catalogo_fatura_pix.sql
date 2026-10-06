-- Cobrança Pix da fatura mensal de comissões presenciais do marketplace.
-- Instalado desligado: nenhuma ordem de pagamento é criada enquanto a flag
-- `fatura_pix_ativo` estiver false e a conta recebedora da plataforma não estiver
-- configurada como secret no Supabase. Esta migration não cria cobrança alguma.
BEGIN;

-- 1. Configuração da automação -------------------------------------------------

ALTER TABLE public.catalogo_automacao_config
  ADD COLUMN IF NOT EXISTS fatura_pix_ativo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS atualizado_por text;

COMMENT ON COLUMN public.catalogo_automacao_config.fatura_pix_ativo IS
  'Libera a emissão de cobrança Pix da fatura mensal. Padrão: false (nenhuma cobrança é criada).';

-- 2. Totais do fechamento passam a ser estáveis ---------------------------------
-- A versão anterior somava apenas comissões 'aberta'/'faturada'. Quando uma comissão
-- passava para 'bloqueado' ou 'paga' e o fechamento era recalculado, o total encolhia
-- (podendo chegar a zero) e o status de um fechamento bloqueado voltava para 'faturado'.
-- Agora: o total considera todas as comissões não canceladas/contestadas, o vencimento
-- já gravado é preservado e estados terminais ('pago', 'vencido', 'bloqueado') não são
-- rebaixados por um recálculo.
CREATE OR REPLACE FUNCTION public.catalogo_gerar_fechamento_offline(
  p_comercio_id text,
  p_competencia date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_competencia date := pg_catalog.date_trunc('month', p_competencia)::date;
  v_status_atual text;
  v_total integer := 0;
  v_pedidos integer := 0;
BEGIN
  SELECT id, status INTO v_id, v_status_atual
    FROM public.catalogo_fechamentos_offline
   WHERE comercio_id = p_comercio_id AND competencia = v_competencia
   FOR UPDATE;

  -- Fatura já paga é histórico: não é recalculada nem reaberta.
  IF v_status_atual = 'pago' THEN
    RETURN v_id;
  END IF;

  SELECT count(*)::integer, coalesce(sum(valor_comissao_centavos), 0)::integer
    INTO v_pedidos, v_total
    FROM public.catalogo_comissoes_offline
   WHERE comercio_id = p_comercio_id
     AND competencia = v_competencia
     AND status NOT IN ('cancelada', 'contestada');

  IF v_pedidos = 0 AND v_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.catalogo_fechamentos_offline (
    comercio_id, competencia, total_pedidos, total_comissao_centavos, status, vencimento_em
  )
  VALUES (
    p_comercio_id, v_competencia, v_pedidos, v_total, 'faturado',
    (v_competencia + interval '1 month' + interval '5 days')::date
  )
  ON CONFLICT (comercio_id, competencia) DO UPDATE
    SET total_pedidos = excluded.total_pedidos,
        total_comissao_centavos = excluded.total_comissao_centavos,
        vencimento_em = coalesce(public.catalogo_fechamentos_offline.vencimento_em, excluded.vencimento_em),
        status = CASE
          WHEN public.catalogo_fechamentos_offline.status IN ('vencido', 'bloqueado')
            THEN public.catalogo_fechamentos_offline.status
          ELSE 'faturado'
        END;

  UPDATE public.catalogo_comissoes_offline
     SET status = 'faturada'
   WHERE comercio_id = p_comercio_id AND competencia = v_competencia AND status = 'aberta';

  SELECT id INTO v_id
    FROM public.catalogo_fechamentos_offline
   WHERE comercio_id = p_comercio_id AND competencia = v_competencia;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.catalogo_gerar_fechamento_offline(text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_gerar_fechamento_offline(text, date) TO service_role;

-- 3. Auditoria da execução automática ------------------------------------------

CREATE TABLE IF NOT EXISTS public.catalogo_automacao_execucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origem text NOT NULL DEFAULT 'pg_cron' CHECK (origem IN ('pg_cron', 'manual')),
  competencia date,
  ativo boolean NOT NULL DEFAULT false,
  fechamentos_gerados integer NOT NULL DEFAULT 0 CHECK (fechamentos_gerados >= 0),
  bloqueios integer NOT NULL DEFAULT 0 CHECK (bloqueios >= 0),
  erro text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  iniciado_em timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz
);

CREATE INDEX IF NOT EXISTS catalogo_automacao_execucoes_iniciado_idx
  ON public.catalogo_automacao_execucoes (iniciado_em DESC);

ALTER TABLE public.catalogo_automacao_execucoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.catalogo_automacao_execucoes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.catalogo_automacao_execucoes TO service_role;

-- 4. Execução do fechamento com registro de auditoria ---------------------------
-- Assinatura mantém o parâmetro único (`p_data`) já usado pelo agendamento; a origem
-- é registrada para distinguir execução agendada de execução manual.
DROP FUNCTION IF EXISTS public.catalogo_processar_fechamentos_offline(date);

CREATE OR REPLACE FUNCTION public.catalogo_processar_fechamentos_offline(
  p_data date DEFAULT CURRENT_DATE,
  p_origem text DEFAULT 'pg_cron'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_competencia date := pg_catalog.date_trunc('month', p_data - interval '1 month')::date;
  v_comercio record;
  v_gerados integer := 0;
  v_bloqueios integer := 0;
  v_execucao_id uuid;
  v_origem text := CASE WHEN p_origem = 'manual' THEN 'manual' ELSE 'pg_cron' END;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.catalogo_automacao_config
    WHERE id = true AND fechamento_offline_ativo = true
  ) THEN
    RETURN 0;
  END IF;

  INSERT INTO public.catalogo_automacao_execucoes (origem, competencia, ativo, metadata)
  VALUES (v_origem, v_competencia, true, jsonb_build_object('p_data', p_data))
  RETURNING id INTO v_execucao_id;

  BEGIN
    FOR v_comercio IN
      SELECT DISTINCT comercio_id
      FROM public.catalogo_comissoes_offline
      WHERE competencia = v_competencia
        AND status IN ('aberta', 'faturada')
    LOOP
      PERFORM public.catalogo_gerar_fechamento_offline(v_comercio.comercio_id, v_competencia);
      v_gerados := v_gerados + 1;
    END LOOP;

    v_bloqueios := public.catalogo_bloquear_inadimplentes_offline();

    UPDATE public.catalogo_automacao_execucoes
       SET concluido_em = pg_catalog.now(),
           fechamentos_gerados = v_gerados,
           bloqueios = coalesce(v_bloqueios, 0)
     WHERE id = v_execucao_id;
  EXCEPTION WHEN OTHERS THEN
    -- A falha fica registrada na auditoria em vez de derrubar a execução agendada.
    UPDATE public.catalogo_automacao_execucoes
       SET concluido_em = pg_catalog.now(),
           erro = left(SQLERRM, 500),
           fechamentos_gerados = v_gerados
     WHERE id = v_execucao_id;
    RAISE NOTICE 'Fechamento automático interrompido: %', SQLERRM;
  END;

  RETURN v_gerados;
END;
$$;

REVOKE ALL ON FUNCTION public.catalogo_processar_fechamentos_offline(date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_processar_fechamentos_offline(date, text) TO service_role;

-- 5. Cobranças Pix da fatura ---------------------------------------------------

CREATE TABLE IF NOT EXISTS public.catalogo_fatura_cobrancas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fechamento_id uuid NOT NULL UNIQUE REFERENCES public.catalogo_fechamentos_offline(id) ON DELETE RESTRICT,
  comercio_id text NOT NULL REFERENCES public.catalogos(comercio_id) ON DELETE RESTRICT,
  competencia date NOT NULL,
  gateway text NOT NULL DEFAULT 'mercadopago' CHECK (gateway IN ('mercadopago')),
  order_id text UNIQUE,
  payment_id text,
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'pago', 'expirado', 'cancelado', 'estornado', 'contestado', 'divergente')),
  valor_centavos integer NOT NULL CHECK (valor_centavos > 0),
  qr_code text,
  qr_code_base64 text,
  ticket_url text,
  expira_em timestamptz,
  pago_em timestamptz,
  ultima_consulta_em timestamptz,
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  divergencia text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalogo_fatura_cobrancas_comercio_idx
  ON public.catalogo_fatura_cobrancas (comercio_id, competencia);

CREATE TABLE IF NOT EXISTS public.catalogo_fatura_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cobranca_id uuid REFERENCES public.catalogo_fatura_cobrancas(id) ON DELETE CASCADE,
  order_id text,
  evento text NOT NULL,
  status_anterior text,
  status_novo text,
  valor_centavos integer,
  detalhe text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalogo_fatura_eventos_cobranca_idx
  ON public.catalogo_fatura_eventos (cobranca_id, criado_em DESC);

CREATE OR REPLACE FUNCTION public.catalogo_registrar_evento_fatura(
  p_cobranca_id uuid,
  p_order_id text,
  p_evento text,
  p_status_anterior text,
  p_status_novo text,
  p_valor_centavos integer,
  p_detalhe text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.catalogo_fatura_eventos (
    cobranca_id, order_id, evento, status_anterior, status_novo, valor_centavos, detalhe
  ) VALUES (
    p_cobranca_id, left(coalesce(p_order_id, ''), 120), left(coalesce(p_evento, 'evento'), 60),
    left(coalesce(p_status_anterior, ''), 40), left(coalesce(p_status_novo, ''), 40),
    p_valor_centavos, left(coalesce(p_detalhe, ''), 500)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.catalogo_registrar_evento_fatura(uuid, text, text, text, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_registrar_evento_fatura(uuid, text, text, text, text, integer, text) TO service_role;

ALTER TABLE public.catalogo_fatura_cobrancas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_fatura_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.catalogo_fatura_cobrancas FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.catalogo_fatura_eventos FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.catalogo_fatura_cobrancas TO service_role;
GRANT ALL ON TABLE public.catalogo_fatura_eventos TO service_role;

DROP TRIGGER IF EXISTS catalogo_fatura_cobrancas_atualizado_em ON public.catalogo_fatura_cobrancas;
CREATE TRIGGER catalogo_fatura_cobrancas_atualizado_em
  BEFORE UPDATE ON public.catalogo_fatura_cobrancas
  FOR EACH ROW EXECUTE FUNCTION public.catalogo_marketplace_atualizar_data();

-- 6. Registro idempotente da cobrança emitida ----------------------------------
CREATE OR REPLACE FUNCTION public.catalogo_registrar_cobranca_fatura(
  p_fechamento_id uuid,
  p_order_id text,
  p_valor_centavos integer,
  p_qr_code text,
  p_qr_code_base64 text,
  p_ticket_url text,
  p_expira_em timestamptz,
  p_detalhe text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_fechamento public.catalogo_fechamentos_offline;
  v_cobranca public.catalogo_fatura_cobrancas;
BEGIN
  SELECT * INTO v_fechamento
    FROM public.catalogo_fechamentos_offline
   WHERE id = p_fechamento_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'mensagem', 'Fechamento não encontrado.');
  END IF;
  IF v_fechamento.status = 'pago' THEN
    RETURN jsonb_build_object('ok', false, 'mensagem', 'Esta fatura já está paga.');
  END IF;
  IF p_valor_centavos IS NULL OR p_valor_centavos <= 0
     OR p_valor_centavos <> v_fechamento.total_comissao_centavos THEN
    RETURN jsonb_build_object('ok', false, 'mensagem', 'O valor da cobrança não corresponde à fatura.');
  END IF;
  IF p_order_id IS NULL OR length(btrim(p_order_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'mensagem', 'Cobrança sem identificador do provedor.');
  END IF;

  SELECT * INTO v_cobranca
    FROM public.catalogo_fatura_cobrancas
   WHERE fechamento_id = p_fechamento_id
   FOR UPDATE;

  IF FOUND AND v_cobranca.status = 'pago' THEN
    RETURN jsonb_build_object('ok', false, 'mensagem', 'Esta fatura já está paga.');
  END IF;

  IF FOUND THEN
    UPDATE public.catalogo_fatura_cobrancas
       SET order_id = btrim(p_order_id),
           status = 'pendente',
           valor_centavos = p_valor_centavos,
           qr_code = p_qr_code,
           qr_code_base64 = p_qr_code_base64,
           ticket_url = p_ticket_url,
           expira_em = p_expira_em,
           pago_em = NULL,
           divergencia = NULL,
           tentativas = tentativas + 1,
           ultima_consulta_em = pg_catalog.now()
     WHERE id = v_cobranca.id
     RETURNING * INTO v_cobranca;

    PERFORM public.catalogo_registrar_evento_fatura(
      v_cobranca.id, v_cobranca.order_id, 'cobranca_reemitida',
      'pendente', 'pendente', p_valor_centavos, p_detalhe
    );
  ELSE
    INSERT INTO public.catalogo_fatura_cobrancas (
      fechamento_id, comercio_id, competencia, order_id, status, valor_centavos,
      qr_code, qr_code_base64, ticket_url, expira_em, tentativas, ultima_consulta_em
    ) VALUES (
      p_fechamento_id, v_fechamento.comercio_id, v_fechamento.competencia, btrim(p_order_id), 'pendente', p_valor_centavos,
      p_qr_code, p_qr_code_base64, p_ticket_url, p_expira_em, 1, pg_catalog.now()
    ) RETURNING * INTO v_cobranca;

    PERFORM public.catalogo_registrar_evento_fatura(
      v_cobranca.id, v_cobranca.order_id, 'cobranca_criada',
      NULL, 'pendente', p_valor_centavos, p_detalhe
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'cobranca_id', v_cobranca.id,
    'order_id', v_cobranca.order_id,
    'status', v_cobranca.status,
    'valor_centavos', v_cobranca.valor_centavos
  );
END;
$$;

REVOKE ALL ON FUNCTION public.catalogo_registrar_cobranca_fatura(uuid, text, integer, text, text, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_registrar_cobranca_fatura(uuid, text, integer, text, text, text, timestamptz, text) TO service_role;

-- 7. Conciliação transacional da cobrança --------------------------------------
-- Regras:
--  - 'pago' exige valor idêntico ao registrado; divergência não ativa nada;
--  - confirmação repetida é idempotente;
--  - estorno/contestação revogam o pagamento, reabrem a fatura como vencida e
--    bloqueiam o catálogo pelo motivo financeiro;
--  - o desbloqueio só remove o bloqueio financeiro desta rotina, nunca outro motivo.
CREATE OR REPLACE FUNCTION public.catalogo_confirmar_cobranca_fatura(
  p_order_id text,
  p_estado text,
  p_payment_id text,
  p_valor_centavos integer,
  p_detalhe text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cobranca public.catalogo_fatura_cobrancas;
  v_status_anterior text;
  v_desbloqueado boolean := false;
  v_motivo_financeiro constant text := 'Comissão de pagamentos presenciais vencida.';
BEGIN
  IF p_estado NOT IN ('pago', 'pendente', 'cancelado', 'expirado', 'estornado', 'contestado') THEN
    RETURN jsonb_build_object('ok', false, 'reconhecido', false, 'mensagem', 'Estado de cobrança não reconhecido.');
  END IF;

  SELECT * INTO v_cobranca
    FROM public.catalogo_fatura_cobrancas
   WHERE order_id = btrim(coalesce(p_order_id, ''))
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reconhecido', false, 'mensagem', 'Cobrança não encontrada para esta ordem.');
  END IF;

  v_status_anterior := v_cobranca.status;

  IF p_estado = 'pendente' THEN
    UPDATE public.catalogo_fatura_cobrancas
       SET payment_id = coalesce(nullif(btrim(coalesce(p_payment_id, '')), ''), payment_id),
           ultima_consulta_em = pg_catalog.now()
     WHERE id = v_cobranca.id;
    RETURN jsonb_build_object('ok', true, 'reconhecido', true, 'status', v_cobranca.status, 'alterado', false);
  END IF;

  IF p_estado = 'pago' THEN
    IF v_cobranca.status = 'pago' THEN
      RETURN jsonb_build_object('ok', true, 'reconhecido', true, 'status', 'pago', 'ja_confirmado', true, 'alterado', false);
    END IF;

    IF p_valor_centavos IS NULL OR p_valor_centavos <> v_cobranca.valor_centavos THEN
      UPDATE public.catalogo_fatura_cobrancas
         SET status = 'divergente',
             divergencia = left(coalesce(p_detalhe, 'Valor confirmado diferente do valor da fatura.'), 500),
             ultima_consulta_em = pg_catalog.now()
       WHERE id = v_cobranca.id;
      PERFORM public.catalogo_registrar_evento_fatura(
        v_cobranca.id, v_cobranca.order_id, 'divergencia_valor',
        v_status_anterior, 'divergente', p_valor_centavos, p_detalhe
      );
      RETURN jsonb_build_object('ok', false, 'reconhecido', true, 'divergencia', true, 'mensagem', 'O valor pago não corresponde à fatura; a conferência é manual.');
    END IF;

    UPDATE public.catalogo_fatura_cobrancas
       SET status = 'pago',
           pago_em = pg_catalog.now(),
           payment_id = coalesce(nullif(btrim(coalesce(p_payment_id, '')), ''), payment_id),
           divergencia = NULL,
           ultima_consulta_em = pg_catalog.now()
     WHERE id = v_cobranca.id;

    UPDATE public.catalogo_fechamentos_offline
       SET status = 'pago', pago_em = pg_catalog.now(), referencia_pagamento = v_cobranca.order_id
     WHERE id = v_cobranca.fechamento_id;

    UPDATE public.catalogo_comissoes_offline
       SET status = 'paga', pago_em = pg_catalog.now(), referencia_pagamento = v_cobranca.order_id
     WHERE comercio_id = v_cobranca.comercio_id
       AND competencia = v_cobranca.competencia
       AND status IN ('aberta', 'faturada', 'bloqueado');

    UPDATE public.catalogos
       SET bloqueado = false, motivo_bloqueio = NULL
     WHERE comercio_id = v_cobranca.comercio_id
       AND bloqueado = true
       AND motivo_bloqueio = v_motivo_financeiro
     RETURNING true INTO v_desbloqueado;

    PERFORM public.catalogo_registrar_evento_fatura(
      v_cobranca.id, v_cobranca.order_id, 'pagamento_confirmado',
      v_status_anterior, 'pago', p_valor_centavos, p_detalhe
    );

    RETURN jsonb_build_object(
      'ok', true, 'reconhecido', true, 'status', 'pago', 'alterado', true,
      'catalogo_desbloqueado', coalesce(v_desbloqueado, false)
    );
  END IF;

  -- Estorno e contestação revogam o pagamento e restabelecem a dívida.
  IF p_estado IN ('estornado', 'contestado') THEN
    UPDATE public.catalogo_fatura_cobrancas
       SET status = p_estado,
           pago_em = CASE WHEN p_estado = 'estornado' THEN NULL ELSE pago_em END,
           divergencia = left(coalesce(p_detalhe, 'Pagamento revogado pelo provedor.'), 500),
           ultima_consulta_em = pg_catalog.now()
     WHERE id = v_cobranca.id;

    IF v_status_anterior = 'pago' THEN
      UPDATE public.catalogo_fechamentos_offline
         SET status = 'vencido', pago_em = NULL, referencia_pagamento = NULL
       WHERE id = v_cobranca.fechamento_id;

      UPDATE public.catalogo_comissoes_offline
         SET status = 'faturada', pago_em = NULL, referencia_pagamento = NULL
       WHERE comercio_id = v_cobranca.comercio_id
         AND competencia = v_cobranca.competencia
         AND status = 'paga';

      UPDATE public.catalogos
         SET bloqueado = true, motivo_bloqueio = v_motivo_financeiro
       WHERE comercio_id = v_cobranca.comercio_id AND bloqueado = false;
    END IF;

    PERFORM public.catalogo_registrar_evento_fatura(
      v_cobranca.id, v_cobranca.order_id, 'pagamento_revogado',
      v_status_anterior, p_estado, p_valor_centavos, p_detalhe
    );

    RETURN jsonb_build_object('ok', true, 'reconhecido', true, 'status', p_estado, 'alterado', true, 'catalogo_desbloqueado', false);
  END IF;

  -- Cancelamento e expiração só valem enquanto a cobrança não foi paga.
  UPDATE public.catalogo_fatura_cobrancas
     SET status = p_estado,
         divergencia = CASE WHEN p_estado = 'cancelado' THEN left(coalesce(p_detalhe, 'Cobrança cancelada.'), 500) ELSE divergencia END,
         ultima_consulta_em = pg_catalog.now()
   WHERE id = v_cobranca.id;

  PERFORM public.catalogo_registrar_evento_fatura(
    v_cobranca.id, v_cobranca.order_id, 'cobranca_encerrada',
    v_status_anterior, p_estado, p_valor_centavos, p_detalhe
  );

  RETURN jsonb_build_object('ok', true, 'reconhecido', true, 'status', p_estado, 'alterado', true, 'catalogo_desbloqueado', false);
END;
$$;

REVOKE ALL ON FUNCTION public.catalogo_confirmar_cobranca_fatura(text, text, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_confirmar_cobranca_fatura(text, text, text, integer, text) TO service_role;

-- 8. Reagendamento defensivo ---------------------------------------------------
DO $$
DECLARE
  v_job record;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron não instalado; o agendamento do fechamento automático deve ser criado manualmente.';
    RETURN;
  END IF;

  BEGIN
    FOR v_job IN
      SELECT jobid FROM cron.job WHERE jobname = 'andrelandia-fechamento-offline-diario'
    LOOP
      PERFORM cron.unschedule(v_job.jobid);
    END LOOP;

    PERFORM cron.schedule(
      'andrelandia-fechamento-offline-diario',
      '15 3 * * *',
      $job$SELECT public.catalogo_processar_fechamentos_offline(CURRENT_DATE, 'pg_cron');$job$
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Não foi possível reagendar o fechamento automático: %', SQLERRM;
  END;
END $$;

COMMIT;