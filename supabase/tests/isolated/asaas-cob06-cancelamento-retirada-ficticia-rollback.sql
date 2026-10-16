-- COB-06: cancelamento auditado de pedido FICTICIO, exclusivamente no clone local.
-- Fixture imita retirada em dinheiro de R$100, comissao de R$7 ainda aberta,
-- codigo de entrega expirado e fatura MAIS ANTIGA paga e sem este componente.
BEGIN;
DO $guard$
BEGIN
 IF pg_catalog.current_database()<>'catalogo_cob06_ci'
    OR pg_catalog.to_regprocedure('catalogo_private.catalogo_cob06_cancelar_retirada_qa_ci(uuid,uuid,text,text,boolean)') IS NULL
 THEN RAISE EXCEPTION 'COB06_CI_ONLY: teste de cancelamento exige clone'; END IF;
END;
$guard$;

INSERT INTO public.catalogo_pedidos(
 id,comercio_id,referencia_externa,idempotency_key,provedor,modalidade,
 forma_pagamento,subtotal_produtos_centavos,entrega_centavos,total_centavos,
 taxa_plataforma_centavos,taxa_motoboy_centavos,taxa_total_centavos,
 repasse_bruto_comercio_centavos,versao_financeira,cliente_nome,cliente_telefone,
 status_token_hash,codigo_entrega_hash,codigo_entrega_expira_em,
 status,entrega_status,status_pagamento,aceito_em,codigo_entrega_usado_em,
 comissao_plataforma_registrada
) VALUES (
 '00000000-0000-4000-8000-00000000c606','comercio-de-exemplo',
 'cob06-ci-retirada-ficticia-expirada','00000000-0000-4000-8000-00000000c616',
 'offline','retirada','dinheiro',10000,0,10000,700,0,700,9300,2,
 'CI Ficticio','00000000000',repeat('6',64),repeat('f',64),
 '2024-01-20T00:00:00Z','pronto','cancelamento_solicitado','pendente',
 '2024-01-16T12:00:00Z',NULL,true
);
INSERT INTO public.catalogo_comissoes_offline(
 pedido_id,comercio_id,competencia,subtotal_produtos_centavos,taxa_percentual,
 valor_comissao_centavos,versao_financeira,modalidade,
 taxa_plataforma_centavos,taxa_motoboy_centavos,valor_total_centavos,metadata
) VALUES (
 '00000000-0000-4000-8000-00000000c606','comercio-de-exemplo','2024-01-01',
 10000,7.00,700,2,'retirada',700,0,700,'{"fixture":"ficticio_expirado_sem_recebimento"}'::jsonb
);
INSERT INTO public.catalogo_lancamentos_financeiros_v2
 (pedido_id,tipo,valor_centavos,status,chave_idempotencia,metadata)
VALUES ('00000000-0000-4000-8000-00000000c606','comissao_plataforma',
 700,'retido','cob06-ci-qa-cancelamento-reter','{"fixture":true}'::jsonb);
INSERT INTO public.catalogo_ocorrencias_v2
 (id,pedido_id,comercio_id,origem,categoria,status,motivo)
VALUES ('00000000-0000-4000-8000-00000000c626',
 '00000000-0000-4000-8000-00000000c606','comercio-de-exemplo',
 'comercio','cancelamento_comercio','aberta','Ensaio de cancelamento ficticio');

DO $prova$
DECLARE
 v_pedido constant uuid:='00000000-0000-4000-8000-00000000c606';
 v_ocorrencia constant uuid:='00000000-0000-4000-8000-00000000c626';
 v_admin constant uuid:='4b9a0233-6b72-4573-aebd-d596c5b15e1b';
 v_motivo constant text:='Pedido QA inteiramente ficticio, sem retirada e sem dinheiro recebido.';
 v_resultado jsonb;
 v_fatura_id uuid;
 v_fatura_antes jsonb;
 v_cobranca_antes jsonb;
BEGIN
 SELECT id,to_jsonb(f) INTO v_fatura_id,v_fatura_antes
 FROM public.catalogo_fechamentos_offline f
 WHERE comercio_id='comercio-de-exemplo' AND competencia='2024-01-01' AND status='pago';
 IF v_fatura_id IS NULL THEN RAISE EXCEPTION 'COB06_CI: fixture paga ausente'; END IF;
 SELECT to_jsonb(b) INTO v_cobranca_antes
 FROM public.catalogo_fatura_cobrancas b
 WHERE b.fechamento_id=v_fatura_id AND b.order_id='legacy-cob06-ci' AND b.status='pago';
 IF v_cobranca_antes IS NULL THEN RAISE EXCEPTION 'COB06_CI: comprovacao legada ausente'; END IF;

 -- A RPC privada jamais pode ser chamada diretamente por usuarios ou Edge.
 IF pg_catalog.has_function_privilege('anon',
    'catalogo_private.catalogo_cob06_cancelar_retirada_qa_ci(uuid,uuid,text,text,boolean)','EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated',
    'catalogo_private.catalogo_cob06_cancelar_retirada_qa_ci(uuid,uuid,text,text,boolean)','EXECUTE')
    OR pg_catalog.has_function_privilege('service_role',
    'catalogo_private.catalogo_cob06_cancelar_retirada_qa_ci(uuid,uuid,text,text,boolean)','EXECUTE')
 THEN RAISE EXCEPTION 'COB06_CI: RPC privada exposta'; END IF;

 -- Identidade, atestado de nao recebimento e justificativa nao sao opcionais.
 SELECT catalogo_private.catalogo_cob06_cancelar_retirada_qa_ci(
  '00000000-0000-4000-8000-00000000c600',v_ocorrencia,
  'cancelamento_legitimo',v_motivo,true) INTO v_resultado;
 IF v_resultado->>'http_status'<>'403' THEN RAISE EXCEPTION 'COB06_CI: usuario forjado passou'; END IF;
 SELECT catalogo_private.catalogo_cob06_cancelar_retirada_qa_ci(
  v_admin,v_ocorrencia,'cancelamento_legitimo',v_motivo,false) INTO v_resultado;
 IF v_resultado->>'http_status'<>'400' THEN RAISE EXCEPTION 'COB06_CI: falta atestado'; END IF;
 SELECT catalogo_private.catalogo_cob06_cancelar_retirada_qa_ci(
  v_admin,v_ocorrencia,'manter',v_motivo,true) INTO v_resultado;
 IF v_resultado->>'http_status'<>'400' THEN RAISE EXCEPTION 'COB06_CI: decisao indevida'; END IF;

 UPDATE public.catalogo_pedidos SET codigo_entrega_expira_em='2040-01-31T12:00:00Z'
 WHERE id=v_pedido;
 SELECT catalogo_private.catalogo_cob06_cancelar_retirada_qa_ci(
  v_admin,v_ocorrencia,'cancelamento_legitimo',v_motivo,true) INTO v_resultado;
 IF v_resultado->>'http_status'<>'409' THEN RAISE EXCEPTION 'COB06_CI: codigo valido foi cancelado'; END IF;
 UPDATE public.catalogo_pedidos SET codigo_entrega_expira_em='2024-01-20T00:00:00Z'
 WHERE id=v_pedido;

 UPDATE public.catalogo_pedidos SET status_pagamento='aprovado' WHERE id=v_pedido;
 SELECT catalogo_private.catalogo_cob06_cancelar_retirada_qa_ci(
  v_admin,v_ocorrencia,'cancelamento_legitimo',v_motivo,true) INTO v_resultado;
 IF v_resultado->>'http_status'<>'409' THEN RAISE EXCEPTION 'COB06_CI: pagamento aprovado foi cancelado'; END IF;
 UPDATE public.catalogo_pedidos SET status_pagamento='pendente' WHERE id=v_pedido;

 -- Uma parcela vinculada ate a fatura antiga quitada torna cancelamento impossivel.
 INSERT INTO public.catalogo_fatura_componentes_v2
 (fechamento_id,pedido_id,tipo,valor_centavos)
 VALUES (v_fatura_id,v_pedido,'plataforma',700);
 SELECT catalogo_private.catalogo_cob06_cancelar_retirada_qa_ci(
  v_admin,v_ocorrencia,'cancelamento_legitimo',v_motivo,true) INTO v_resultado;
 IF v_resultado->>'http_status'<>'409' THEN RAISE EXCEPTION 'COB06_CI: parcela faturada foi cancelada'; END IF;
 DELETE FROM public.catalogo_fatura_componentes_v2
 WHERE fechamento_id=v_fatura_id AND pedido_id=v_pedido;

 INSERT INTO public.catalogo_logistica_offline_v2
 (pedido_id,comercio_id,competencia,valor_centavos)
 VALUES (v_pedido,'comercio-de-exemplo','2024-01-01',80);
 SELECT catalogo_private.catalogo_cob06_cancelar_retirada_qa_ci(
  v_admin,v_ocorrencia,'cancelamento_legitimo',v_motivo,true) INTO v_resultado;
 IF v_resultado->>'http_status'<>'409' THEN RAISE EXCEPTION 'COB06_CI: logistica registrada foi cancelada'; END IF;
 DELETE FROM public.catalogo_logistica_offline_v2 WHERE pedido_id=v_pedido;

 INSERT INTO public.catalogo_pagamentos_v2
 (pedido_id,status,valor_centavos,referencia)
 VALUES (v_pedido,'aprovado',10000,'cob06-ci-nao-cancelar-com-pagamento');
 SELECT catalogo_private.catalogo_cob06_cancelar_retirada_qa_ci(
  v_admin,v_ocorrencia,'cancelamento_legitimo',v_motivo,true) INTO v_resultado;
 IF v_resultado->>'http_status'<>'409' THEN RAISE EXCEPTION 'COB06_CI: registro financeiro foi cancelado'; END IF;
 DELETE FROM public.catalogo_pagamentos_v2 WHERE pedido_id=v_pedido;

 SELECT catalogo_private.catalogo_cob06_cancelar_retirada_qa_ci(
  v_admin,v_ocorrencia,'cancelamento_legitimo',v_motivo,true) INTO v_resultado;
 IF (v_resultado->>'ok')::boolean IS DISTINCT FROM true
    OR v_resultado->>'status'<>'cancelado'
    OR (SELECT status FROM public.catalogo_pedidos WHERE id=v_pedido)<>'cancelado'
    OR (SELECT entrega_status FROM public.catalogo_pedidos WHERE id=v_pedido)<>'cancelado'
    OR (SELECT status_pagamento FROM public.catalogo_pedidos WHERE id=v_pedido)<>'pendente'
    OR (SELECT status FROM public.catalogo_comissoes_offline WHERE pedido_id=v_pedido)<>'cancelada'
    OR (SELECT status FROM public.catalogo_lancamentos_financeiros_v2 WHERE pedido_id=v_pedido)<>'estornado'
    OR (SELECT status FROM public.catalogo_ocorrencias_v2 WHERE id=v_ocorrencia)<>'resolvida'
    OR (SELECT revisado_por FROM public.catalogo_ocorrencias_v2 WHERE id=v_ocorrencia) IS DISTINCT FROM v_admin
    OR (SELECT count(*) FROM public.catalogo_entregas_gestao_eventos WHERE pedido_id=v_pedido AND acao='cancelamento_retirada_ficticia_ci')<>1
    OR (SELECT to_jsonb(f) FROM public.catalogo_fechamentos_offline f WHERE id=v_fatura_id) IS DISTINCT FROM v_fatura_antes
    OR (SELECT to_jsonb(b) FROM public.catalogo_fatura_cobrancas b WHERE b.fechamento_id=v_fatura_id AND b.order_id='legacy-cob06-ci') IS DISTINCT FROM v_cobranca_antes
    OR EXISTS(SELECT 1 FROM public.catalogo_fatura_componentes_v2 fc WHERE fc.pedido_id=v_pedido)
 THEN RAISE EXCEPTION 'COB06_CI: falha de cancelamento atomico ou fatura anterior alterada: %',v_resultado; END IF;
 SELECT catalogo_private.catalogo_cob06_cancelar_retirada_qa_ci(
  v_admin,v_ocorrencia,'cancelamento_legitimo',v_motivo,true) INTO v_resultado;
 IF v_resultado->>'http_status'<>'409'
    OR (SELECT count(*) FROM public.catalogo_entregas_gestao_eventos WHERE pedido_id=v_pedido AND acao='cancelamento_retirada_ficticia_ci')<>1
 THEN RAISE EXCEPTION 'COB06_CI: repeticao cancelou/duplicou auditoria'; END IF;

 RAISE NOTICE 'COB06_CANCELAMENTO_FICTICIO_AUDITADO_CI_ROLLBACK_OK';
END;
$prova$;
ROLLBACK;
