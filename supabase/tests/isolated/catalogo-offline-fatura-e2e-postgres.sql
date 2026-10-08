-- Ciclo real de entrega com dinheiro/cartão, retenção e liquidação via fatura.
-- Somente teste no banco descartável catalogo_ci. Nunca executar em produção.
-- Este arquivo deve rodar DENTRO de BEGIN/ROLLBACK, usando identidades sintéticas.
DO $guard$
BEGIN
  IF current_database() <> 'catalogo_ci'
     OR current_setting('app.marketplace_test_offline', true) IS DISTINCT FROM 'enabled'
     OR to_regclass('public.catalogo_comissoes_offline') IS NULL
     OR to_regclass('public.catalogo_fatura_cobrancas') IS NULL
     OR to_regclass('public.catalogo_remuneracoes_v2') IS NULL
     OR (SELECT count(*) FROM public.catalogo_pedidos) <> 0
  THEN
    RAISE EXCEPTION 'Cenario offline exige catalogo_ci vazio e opt-in';
  END IF;
END $guard$;

INSERT INTO auth.users(id,email_confirmed_at)
VALUES ('00000000-0000-4000-8000-000000000141',now());

INSERT INTO public.catalogo_motoboys(comercio_id,usuario_id,nome,email,autorizado_por)
VALUES ('comercio-de-exemplo','00000000-0000-4000-8000-000000000141',
        'Entregador Offline Fictício','offline@example.invalid',
        '00000000-0000-4000-8000-000000000099');

INSERT INTO public.catalogo_motoboy_perfis(usuario_id,disponivel,apto,em_analise)
VALUES ('00000000-0000-4000-8000-000000000141',true,true,false);

INSERT INTO public.catalogo_pedidos(
 id,comercio_id,referencia_externa,idempotency_key,
 provedor,modalidade,forma_pagamento,
 subtotal_produtos_centavos,entrega_centavos,total_centavos,
 taxa_plataforma_centavos,taxa_motoboy_centavos,taxa_total_centavos,
 repasse_bruto_comercio_centavos,versao_financeira,
 cliente_nome,cliente_telefone,status_token_hash,codigo_entrega_hash,codigo_entrega_expira_em
) VALUES
(
 '00000000-0000-4000-8000-000000000151','comercio-de-exemplo','ci-offline-dinheiro',
 '00000000-0000-4000-8000-000000000161','offline','entrega','dinheiro',
 101,0,101,5,2,7,94,2,'Cliente Dinheiro Fictício','00000000000',
 repeat('1',64),repeat('e',64),now()+interval '1 hour'
),
(
 '00000000-0000-4000-8000-000000000152','comercio-de-exemplo','ci-offline-cartao',
 '00000000-0000-4000-8000-000000000162','offline','entrega','cartao_debito',
 101,0,101,5,2,7,94,2,'Cliente Cartão Fictício','00000000001',
 repeat('2',64),repeat('f',64),now()+interval '1 hour'
);

DO $delivery_offline$
DECLARE
  v_id uuid;
  v_result jsonb;
  v_hash text;
BEGIN
  v_result := public.catalogo_aplicar_pagamento_v2(
    '00000000-0000-4000-8000-000000000151','aprovado',101,7,'ci-falso-provedor');
  IF (v_result->>'http_status')::int <> 409 THEN
    RAISE EXCEPTION 'Provedor virtual aprovou pedido offline como se fosse Pix da plataforma';
  END IF;

  FOR v_id IN SELECT id FROM public.catalogo_pedidos ORDER BY id LOOP
    v_result := public.catalogo_operar_pedido_v2(
      '00000000-0000-4000-8000-000000000099','comercio-de-exemplo',v_id,'aceitar');
    IF (v_result->>'ok')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Comércio não aceitou pedido offline: %',v_result;
    END IF;

    v_result := public.catalogo_operar_pedido_v2(
      '00000000-0000-4000-8000-000000000099','comercio-de-exemplo',v_id,'pronto');
    IF (v_result->>'ok')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Comércio não marcou pedido offline como pronto: %',v_result;
    END IF;

    v_result := public.catalogo_motoboy_acao_v2(
      '00000000-0000-4000-8000-000000000141','aceitar_entrega',v_id);
    IF (v_result->>'ok')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Motoboy não aceitou pedido offline: %',v_result;
    END IF;

    v_result := public.catalogo_motoboy_acao_v2(
      '00000000-0000-4000-8000-000000000141','coletar',v_id);
    IF (v_result->>'ok')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Motoboy não coletou pedido offline: %',v_result;
    END IF;

    v_result := public.catalogo_motoboy_acao_v2(
      '00000000-0000-4000-8000-000000000141','em_entrega',v_id);
    IF (v_result->>'ok')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Motoboy não iniciou entrega offline: %',v_result;
    END IF;

    v_hash := CASE WHEN v_id='00000000-0000-4000-8000-000000000151'
                   THEN repeat('e',64) ELSE repeat('f',64) END;
    v_result := public.catalogo_confirmar_entrega_motoboy(
      '00000000-0000-4000-8000-000000000141','comercio-de-exemplo',v_id,v_hash);
    IF (v_result->>'ok')::boolean IS DISTINCT FROM true
       OR (v_result->>'remuneracao_registrada')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Entrega offline não confirmou código: %',v_result;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM public.catalogo_remuneracoes_v2
      WHERE motoboy_id='00000000-0000-4000-8000-000000000141'
        AND valor_centavos=2 AND status='retido'
        AND financiamento_comprovado=false) <> 2
     OR (SELECT count(*) FROM public.catalogo_comissoes_offline
         WHERE comercio_id='comercio-de-exemplo'
           AND valor_total_centavos=7 AND taxa_plataforma_centavos=5
           AND taxa_motoboy_centavos=2) <> 2
     OR (SELECT count(*) FROM public.catalogo_lancamentos_financeiros_v2
         WHERE tipo='remuneracao_motoboy' AND status='retido') <> 2 THEN
    RAISE EXCEPTION 'Comissão offline liberada antes do pagamento da fatura';
  END IF;
END $delivery_offline$;

DO $invoice_offline$
DECLARE
  v_fid uuid;
  v_result jsonb;
  v_competencia date := date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  v_fid := public.catalogo_gerar_fechamento_offline('comercio-de-exemplo',v_competencia);
  IF v_fid IS NULL
     OR (SELECT total_comissao_centavos FROM public.catalogo_fechamentos_offline
         WHERE id=v_fid) <> 14
     OR (SELECT count(*) FROM public.catalogo_fatura_componentes_v2
         WHERE fechamento_id=v_fid) <> 4
     OR (SELECT coalesce(sum(valor_centavos),0)
         FROM public.catalogo_fatura_componentes_v2
         WHERE fechamento_id=v_fid) <> 14 THEN
    RAISE EXCEPTION 'Fechamento offline não contém 5%% + 2%% dos dois pedidos';
  END IF;

  v_result := public.catalogo_registrar_cobranca_fatura(
    v_fid,'ci-fatura-offline-1',14,NULL,NULL,NULL,now()+interval '2 hours',
    'Cobrança fictícia sem contato com Mercado Pago');
  IF (v_result->>'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Cobrança de fatura offline não foi registrada: %',v_result;
  END IF;

  v_result := public.catalogo_confirmar_cobranca_fatura(
    'ci-fatura-offline-1','pago','ci-pagamento-fatura',13,'Valor divergente no CI');
  IF (v_result->>'divergencia')::boolean IS DISTINCT FROM true
     OR (SELECT count(*) FROM public.catalogo_remuneracoes_v2
         WHERE status='disponivel') <> 0 THEN
    RAISE EXCEPTION 'Fatura divergente liberou crédito do motoboy: %',v_result;
  END IF;

  v_result := public.catalogo_confirmar_cobranca_fatura(
    'ci-fatura-offline-1','pago','ci-pagamento-fatura',14,'Quitada no CI');
  IF (v_result->>'ok')::boolean IS DISTINCT FROM true
     OR (SELECT count(*) FROM public.catalogo_remuneracoes_v2
         WHERE status='disponivel' AND valor_centavos=2
           AND financiamento_comprovado=true) <> 2
     OR (SELECT count(*) FROM public.catalogo_lancamentos_financeiros_v2
         WHERE tipo='remuneracao_motoboy' AND status='disponivel') <> 2
     OR (SELECT count(*) FROM public.catalogo_lancamentos_financeiros_v2
         WHERE tipo='comissao_plataforma' AND status='disponivel') <> 2 THEN
    RAISE EXCEPTION 'Pagamento da fatura não liquidou parcelas corretas: %',v_result;
  END IF;

  v_result := public.catalogo_confirmar_cobranca_fatura(
    'ci-fatura-offline-1','pago','ci-pagamento-fatura',14,'Webhook repetido');
  IF (v_result->>'ja_confirmado')::boolean IS DISTINCT FROM true
     OR (SELECT count(*) FROM public.catalogo_remuneracoes_v2) <> 2 THEN
    RAISE EXCEPTION 'Webhook duplicado gerou crédito de motoboy adicional: %',v_result;
  END IF;

  v_result := public.catalogo_confirmar_cobranca_fatura(
    'ci-fatura-offline-1','estornado','ci-pagamento-fatura',14,'Estorno simulado');
  IF (v_result->>'ok')::boolean IS DISTINCT FROM true
     OR (SELECT count(*) FROM public.catalogo_remuneracoes_v2
         WHERE status='retido' AND financiamento_comprovado=false) <> 2
     OR (SELECT status FROM public.catalogo_fechamentos_offline
         WHERE id=v_fid) <> 'vencido'
     OR (SELECT bloqueado FROM public.catalogos
         WHERE comercio_id='comercio-de-exemplo') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Estorno de fatura não reteve motoboys e bloqueou o comércio: %',v_result;
  END IF;
END $invoice_offline$;

SELECT 'PASS: dinheiro/cartão entrega 2%, fatura 7%, liquidação, idempotência e estorno' AS result;
