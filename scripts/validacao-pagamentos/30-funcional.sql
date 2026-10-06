-- Validação funcional do bloco de pagamentos presenciais (executa e verifica).
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- A. Confirmação de entrega offline (após a correção)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_pedido_b uuid;
  v_pedido_a uuid;
  v_result jsonb;
  v_ok boolean;
  v_msg text;
  v_comissao integer;
  v_status text;
BEGIN
  UPDATE public.catalogos SET proprietario_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid WHERE comercio_id='comercio-de-exemplo';
  UPDATE public.catalogo_pedidos SET codigo_entrega_hash=CASE cliente_token_hash WHEN 'hash-token-A' THEN repeat('a',64) ELSE repeat('b',64) END;
  SELECT id INTO v_pedido_a FROM public.catalogo_pedidos WHERE cliente_token_hash = 'hash-token-A';
  SELECT id INTO v_pedido_b FROM public.catalogo_pedidos WHERE cliente_token_hash = 'hash-token-B';

  SELECT public.catalogo_confirmar_entrega_autenticada('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','comercio-de-exemplo',v_pedido_b,repeat('b',64),'Entregador de teste') INTO v_result;
  IF NOT (v_result->>'ok')::boolean OR (v_result->>'pedido_id')::uuid <> v_pedido_b THEN
    RAISE EXCEPTION 'A confirmação do pedido correto falhou: % / %', (v_result->>'ok')::boolean, (v_result->>'mensagem');
  END IF;

  SELECT status, codigo_entrega_usado_em IS NOT NULL INTO v_status, v_ok FROM public.catalogo_pedidos WHERE id = v_pedido_b;
  IF v_status <> 'entregue' OR NOT v_ok THEN
    RAISE EXCEPTION 'O pedido B não foi marcado como entregue/confirmado: % / %', v_status, v_ok;
  END IF;

  SELECT valor_comissao_centavos INTO v_comissao FROM public.catalogo_comissoes_offline WHERE pedido_id = v_pedido_b;
  IF v_comissao <> 1000 THEN
    RAISE EXCEPTION 'Comissão incorreta para o pedido B (esperado 1000): %', v_comissao;
  END IF;

  SELECT codigo_entrega_usado_em IS NULL INTO v_ok FROM public.catalogo_pedidos WHERE id = v_pedido_a;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'O pedido A foi confirmado indevidamente por um token diferente.';
  END IF;

  SELECT public.catalogo_confirmar_entrega_autenticada('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','comercio-de-exemplo',v_pedido_b,repeat('b',64),'Entregador de teste') INTO v_result;
  IF (v_result->>'ok')::boolean THEN
    RAISE EXCEPTION 'Uma segunda confirmação foi aceita.';
  END IF;
  IF (v_result->>'mensagem') <> 'Este pedido não pode mais ser concluído.' THEN
    RAISE EXCEPTION 'Mensagem inesperada na segunda confirmação: %', (v_result->>'mensagem');
  END IF;

  SELECT public.catalogo_confirmar_entrega_autenticada('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','comercio-de-exemplo',v_pedido_a,repeat('0',64),'Entregador de teste') INTO v_result;
  IF (v_result->>'ok')::boolean OR (v_result->>'mensagem') <> 'Código de entrega incorreto.' THEN
    RAISE EXCEPTION 'Código incorreto não foi recusado: %', (v_result->>'mensagem');
  END IF;

  UPDATE public.catalogo_pedidos SET codigo_entrega_expira_em = now() - interval '1 hour' WHERE id = v_pedido_a;
  SELECT public.catalogo_confirmar_entrega_autenticada('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','comercio-de-exemplo',v_pedido_a,repeat('a',64),'Entregador de teste') INTO v_result;
  IF (v_result->>'ok')::boolean OR (v_result->>'mensagem') <> 'O código de entrega expirou.' THEN
    RAISE EXCEPTION 'Código expirado não foi recusado: %', (v_result->>'mensagem');
  END IF;

  RAISE NOTICE 'A. confirmação offline: OK (única, recusa código errado e expirado, comissão de 5%%)';
END $$;

-- ---------------------------------------------------------------------------
-- B. Fechamento automático desligado por padrão
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_gerados integer; v_existe boolean;
BEGIN
  SELECT fechamento_offline_ativo INTO v_existe FROM public.catalogo_automacao_config WHERE id = true;
  IF v_existe IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'A automação não está instalada desligada.';
  END IF;

  v_gerados := public.catalogo_processar_fechamentos_offline((CURRENT_DATE + interval '1 month')::date);
  IF v_gerados <> 0 THEN
    RAISE EXCEPTION 'A automação agiu mesmo desligada: % fechamentos.', v_gerados;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.catalogo_fechamentos_offline) INTO v_existe;
  IF v_existe THEN
    RAISE EXCEPTION 'Foi criado fechamento com a automação desligada.';
  END IF;

  RAISE NOTICE 'B. automação desligada: OK (nenhuma ação, nenhum fechamento)';
END $$;

-- ---------------------------------------------------------------------------
-- C. Fechamento com totais estáveis, bloqueio e auditoria
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_competencia date := pg_catalog.date_trunc('month', CURRENT_DATE)::date;
  v_fechamento uuid;
  v_total integer;
  v_pedidos integer;
  v_status text;
  v_bloqueado boolean;
  v_gerados integer;
BEGIN
  UPDATE public.catalogo_automacao_config SET fechamento_offline_ativo = true WHERE id = true;

  v_gerados := public.catalogo_processar_fechamentos_offline((CURRENT_DATE + interval '1 month')::date);
  IF v_gerados < 1 THEN
    RAISE EXCEPTION 'Nenhum fechamento foi gerado com a automação ligada.';
  END IF;

  SELECT id, total_pedidos, total_comissao_centavos, status INTO v_fechamento, v_pedidos, v_total, v_status
    FROM public.catalogo_fechamentos_offline WHERE comercio_id = 'comercio-de-exemplo' AND competencia = v_competencia;
  IF v_fechamento IS NULL OR v_pedidos <> 1 OR v_total <> 1000 OR v_status <> 'faturado' THEN
    RAISE EXCEPTION 'Fechamento incorreto: pedidos=% total=% status=%', v_pedidos, v_total, v_status;
  END IF;

  -- Uma comissão bloqueada não pode reduzir o total já faturado.
  UPDATE public.catalogo_comissoes_offline SET status = 'bloqueado' WHERE comercio_id = 'comercio-de-exemplo';
  PERFORM public.catalogo_gerar_fechamento_offline('comercio-de-exemplo', v_competencia);
  SELECT total_comissao_centavos INTO v_total FROM public.catalogo_fechamentos_offline WHERE id = v_fechamento;
  IF v_total <> 1000 THEN
    RAISE EXCEPTION 'O recálculo encolheu o total da fatura para %', v_total;
  END IF;

  -- Vencimento: o bloqueio marca fatura e catálogo.
  UPDATE public.catalogo_fechamentos_offline SET status = 'faturado', vencimento_em = CURRENT_DATE - 1 WHERE id = v_fechamento;
  UPDATE public.catalogo_comissoes_offline SET status = 'faturada' WHERE comercio_id = 'comercio-de-exemplo';
  PERFORM public.catalogo_bloquear_inadimplentes_offline();
  SELECT status INTO v_status FROM public.catalogo_fechamentos_offline WHERE id = v_fechamento;
  SELECT bloqueado INTO v_bloqueado FROM public.catalogos WHERE comercio_id = 'comercio-de-exemplo';
  IF v_status <> 'bloqueado' OR NOT v_bloqueado THEN
    RAISE EXCEPTION 'Inadimplência não bloqueou: fechamento=% catálogo=%', v_status, v_bloqueado;
  END IF;

  -- Um novo recálculo não pode rebaixar o estado terminal.
  PERFORM public.catalogo_gerar_fechamento_offline('comercio-de-exemplo', v_competencia);
  SELECT status, total_comissao_centavos INTO v_status, v_total FROM public.catalogo_fechamentos_offline WHERE id = v_fechamento;
  IF v_status <> 'bloqueado' OR v_total <> 1000 THEN
    RAISE EXCEPTION 'Recálculo rebaixou o fechamento: status=% total=%', v_status, v_total;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.catalogo_automacao_execucoes WHERE origem = 'pg_cron' AND fechamentos_gerados >= 1 AND erro IS NULL) THEN
    RAISE EXCEPTION 'A execução automática não foi registrada na auditoria.';
  END IF;

  RAISE NOTICE 'C. fechamento automático: OK (total estável, bloqueio, estado preservado, auditoria)';
END $$;

-- ---------------------------------------------------------------------------
-- D. Cobrança Pix da fatura
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fechamento uuid;
  v_valor integer;
  v_reg jsonb;
  v_conf jsonb;
  v_status text;
  v_bloqueado boolean;
BEGIN
  SELECT id, total_comissao_centavos INTO v_fechamento, v_valor
    FROM public.catalogo_fechamentos_offline WHERE comercio_id = 'comercio-de-exemplo';
  IF v_valor <> 1000 THEN
    RAISE EXCEPTION 'Valor da fatura inesperado: %', v_valor;
  END IF;

  v_reg := public.catalogo_registrar_cobranca_fatura(v_fechamento, 'ORD-TESTE-1', 999, 'qr', 'qr64', 'https://www.mercadopago.com.br/p/1', NULL, 'teste');
  IF (v_reg->>'ok')::boolean THEN
    RAISE EXCEPTION 'Cobrança com valor divergente foi aceita.';
  END IF;

  v_reg := public.catalogo_registrar_cobranca_fatura(v_fechamento, 'ORD-TESTE-1', v_valor, 'qr', 'qr64', 'https://www.mercadopago.com.br/p/1', NULL, 'teste');
  IF NOT (v_reg->>'ok')::boolean OR v_reg->>'status' <> 'pendente' THEN
    RAISE EXCEPTION 'Cobrança válida não foi registrada: %', v_reg;
  END IF;

  v_reg := public.catalogo_registrar_cobranca_fatura(v_fechamento, 'ORD-TESTE-2', v_valor, 'qr2', 'qr642', 'https://www.mercadopago.com.br/p/2', NULL, 'reemissão');
  IF NOT (v_reg->>'ok')::boolean THEN
    RAISE EXCEPTION 'Reemissão da cobrança falhou: %', v_reg;
  END IF;
  IF (SELECT tentativas FROM public.catalogo_fatura_cobrancas WHERE fechamento_id = v_fechamento) <> 2 THEN
    RAISE EXCEPTION 'A reemissão não incrementou as tentativas.';
  END IF;

  -- Valor confirmado diferente do registrado: nada é quitado.
  v_conf := public.catalogo_confirmar_cobranca_fatura('ORD-TESTE-2', 'pago', 'PAY-1', 500, 'divergente');
  IF (v_conf->>'ok')::boolean OR NOT (v_conf->>'divergencia')::boolean THEN
    RAISE EXCEPTION 'Divergência de valor não foi barrada: %', v_conf;
  END IF;
  SELECT status INTO v_status FROM public.catalogo_fechamentos_offline WHERE id = v_fechamento;
  IF v_status = 'pago' THEN
    RAISE EXCEPTION 'Fatura foi quitada apesar da divergência de valor.';
  END IF;

  -- Cobrança cancelada não quita.
  v_conf := public.catalogo_confirmar_cobranca_fatura('ORD-TESTE-2', 'cancelado', NULL, NULL, 'cancelada no provedor');
  IF (v_conf->>'status') <> 'cancelado' THEN
    RAISE EXCEPTION 'Cancelamento da cobrança não foi registrado: %', v_conf;
  END IF;

  -- Pagamento correto quita, marca comissões e remove o bloqueio financeiro.
  v_conf := public.catalogo_confirmar_cobranca_fatura('ORD-TESTE-2', 'pago', 'PAY-2', v_valor, 'accredited');
  IF NOT (v_conf->>'ok')::boolean OR (v_conf->>'status') <> 'pago' OR NOT (v_conf->>'catalogo_desbloqueado')::boolean THEN
    RAISE EXCEPTION 'Pagamento correto não quitou/bloqueio não liberado: %', v_conf;
  END IF;
  SELECT status INTO v_status FROM public.catalogo_fechamentos_offline WHERE id = v_fechamento;
  SELECT bloqueado INTO v_bloqueado FROM public.catalogos WHERE comercio_id = 'comercio-de-exemplo';
  IF v_status <> 'pago' OR v_bloqueado THEN
    RAISE EXCEPTION 'Estado após pagamento incorreto: fechamento=% bloqueado=%', v_status, v_bloqueado;
  END IF;
  IF EXISTS (SELECT 1 FROM public.catalogo_comissoes_offline WHERE comercio_id = 'comercio-de-exemplo' AND status <> 'paga') THEN
    RAISE EXCEPTION 'Comissões não foram marcadas como pagas.';
  END IF;

  -- Confirmação repetida é idempotente.
  v_conf := public.catalogo_confirmar_cobranca_fatura('ORD-TESTE-2', 'pago', 'PAY-2', v_valor, 'accredited');
  IF NOT (v_conf->>'ja_confirmado')::boolean THEN
    RAISE EXCEPTION 'Confirmação repetida não foi idempotente: %', v_conf;
  END IF;

  -- Estorno revoga a quitação e devolve a dívida.
  v_conf := public.catalogo_confirmar_cobranca_fatura('ORD-TESTE-2', 'estornado', 'PAY-2', v_valor, 'refunded');
  SELECT status INTO v_status FROM public.catalogo_fechamentos_offline WHERE id = v_fechamento;
  SELECT bloqueado INTO v_bloqueado FROM public.catalogos WHERE comercio_id = 'comercio-de-exemplo';
  IF v_status <> 'vencido' OR NOT v_bloqueado THEN
    RAISE EXCEPTION 'Estorno não revogou a quitação: fechamento=% bloqueado=%', v_status, v_bloqueado;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.catalogo_comissoes_offline WHERE comercio_id = 'comercio-de-exemplo' AND status = 'faturada') THEN
    RAISE EXCEPTION 'As comissões não voltaram para faturada após o estorno.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.catalogo_fatura_eventos WHERE evento = 'pagamento_confirmado')
     OR NOT EXISTS (SELECT 1 FROM public.catalogo_fatura_eventos WHERE evento = 'pagamento_revogado')
     OR NOT EXISTS (SELECT 1 FROM public.catalogo_fatura_eventos WHERE evento = 'divergencia_valor') THEN
    RAISE EXCEPTION 'Eventos da cobrança não foram auditados.';
  END IF;

  RAISE NOTICE 'D. cobrança da fatura: OK (valor, divergência, idempotência, quitação, estorno, auditoria)';
END $$;

-- ---------------------------------------------------------------------------
-- E. Desbloqueio não remove bloqueio de outro motivo
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fechamento uuid;
  v_valor integer;
  v_conf jsonb;
  v_motivo text;
BEGIN
  SELECT id, total_comissao_centavos INTO v_fechamento, v_valor
    FROM public.catalogo_fechamentos_offline WHERE comercio_id = 'comercio-de-exemplo';
  -- Reabre a fatura e cria um bloqueio administrativo diferente do financeiro.
  UPDATE public.catalogo_fechamentos_offline SET status = 'faturado', pago_em = NULL WHERE id = v_fechamento;
  UPDATE public.catalogo_fatura_cobrancas SET status = 'pendente' WHERE fechamento_id = v_fechamento;
  UPDATE public.catalogos SET bloqueado = true, motivo_bloqueio = 'Bloqueio administrativo por revisão.' WHERE comercio_id = 'comercio-de-exemplo';

  v_conf := public.catalogo_confirmar_cobranca_fatura('ORD-TESTE-2', 'pago', 'PAY-3', v_valor, 'accredited');
  SELECT motivo_bloqueio INTO v_motivo FROM public.catalogos WHERE comercio_id = 'comercio-de-exemplo';
  IF NOT (v_conf->>'ok')::boolean THEN
    RAISE EXCEPTION 'Quitação falhou no cenário de bloqueio administrativo: %', v_conf;
  END IF;
  IF (v_conf->>'catalogo_desbloqueado')::boolean OR v_motivo <> 'Bloqueio administrativo por revisão.' THEN
    RAISE EXCEPTION 'A quitação removeu um bloqueio administrativo: %', v_motivo;
  END IF;

  RAISE NOTICE 'E. bloqueio administrativo preservado: OK';
END $$;