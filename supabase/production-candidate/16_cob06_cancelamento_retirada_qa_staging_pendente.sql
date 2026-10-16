-- COB-06: candidato para revisao de cancelamento ADMINISTRATIVO do pedido QA STAGING.
-- NAO instalar automaticamente: depende de revisao, preflight e autorizacao
-- especifica para executar qualquer cancelamento real no STAGING.
-- Em PROD nao ha o pedido UUID autorizado; a instalacao falha.
-- Inerte ate Edge com flag explicita; so testa em banco descartavel no CI.
-- Nao cria pagamento, nao reembolsa, nao baixa fatura e nao movimenta saques.
BEGIN;
DO $guard$
BEGIN
 IF pg_catalog.current_database()='catalogo_cob06_ci' THEN
   IF pg_catalog.to_regprocedure('catalogo_private.catalogo_cob06_cancelar_retirada_qa_ci(uuid,uuid,text,text,boolean)') IS NULL
   THEN RAISE EXCEPTION 'COB06_QA_ONLY: exige clone preparado'; END IF;
 ELSIF pg_catalog.current_database()='postgres' THEN
   -- O UUID e comercio reais sao EXCLUSIVOS do ensaio STAGING ja confirmado.
   -- So instalar quando a CONTA ADMINISTRATIVA REAL de STAGING foi confirmada.
   -- A existencia de fixture semelhante em PROD nao basta para habilitar esta funcao.
   IF NOT EXISTS(
     SELECT 1 FROM auth.users u
     WHERE u.id='d896cc0c-31e4-4ef7-8fa4-13d15f02dd2a'::uuid
       AND u.email='pedrinhossiqueira12@gmail.com'
       AND u.email_confirmed_at IS NOT NULL
   ) THEN RAISE EXCEPTION 'COB06_QA_ONLY: administrador STAGING confirmado ausente'; END IF;
   -- Impede instalacao fortuita em um projeto sem a mesma fixture de QA.
   IF NOT EXISTS(
     SELECT 1 FROM public.catalogo_pedidos p
     WHERE p.id='a4ca7c4e-465f-4342-ae18-5c7eea1dec15'::uuid
       AND p.comercio_id='asaas-cob02'
       AND p.versao_financeira=2
       AND p.provedor='offline' AND p.modalidade='retirada'
       AND p.status='pronto' AND p.status_pagamento='pendente'
   ) THEN RAISE EXCEPTION 'COB06_QA_ONLY: nao e o banco STAGING com pedido permitido';
   END IF;
 ELSE
   RAISE EXCEPTION 'COB06_QA_ONLY: banco de dados nao autorizado';
 END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.catalogo_cob06_cancelar_retirada_qa_v2(
 p_operador_id uuid,
 p_ocorrencia_id uuid,
 p_decisao text,
 p_motivo text,
 p_ficticio_sem_recebimento boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $cancel$
DECLARE
 v_pedido_id uuid;
 v_pedido public.catalogo_pedidos%ROWTYPE;
 v_occ public.catalogo_ocorrencias_v2%ROWTYPE;
 v_comissao public.catalogo_comissoes_offline%ROWTYPE;
 v_lancamento_id uuid;
 v_agora timestamptz := pg_catalog.now();
BEGIN
 -- A identidade deve vir do JWT validado pela Edge; a RPC nao sera exposta.
 -- Este prototipo CI exige o administrador, revisao fundamentada e a
 -- confirmacao EXPRESSA de que nenhum produto/dinheiro foi entregue/recebido.
 -- CI segue exigindo o ID historico e ROLLBACK. O STAGING exige
 -- exclusivamente o usuario convidado e confirmado no Auth daquele projeto.
 -- O clone de CI usa auth.users minima (somente id); NAO consultar
 -- colunas reais do Supabase nesse ramo. PL/pgSQL so prepara o ramo executado.
 IF pg_catalog.current_database()='catalogo_cob06_ci' THEN
   IF p_operador_id IS DISTINCT FROM '4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid
   THEN RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',403,'mensagem','Administrador nao autorizado.'); END IF;
 ELSIF pg_catalog.current_database()='postgres' THEN
   IF p_operador_id IS DISTINCT FROM 'd896cc0c-31e4-4ef7-8fa4-13d15f02dd2a'::uuid
     OR NOT EXISTS(
       SELECT 1 FROM auth.users u
       WHERE u.id=p_operador_id AND u.email='pedrinhossiqueira12@gmail.com'
         AND u.email_confirmed_at IS NOT NULL
     )
   THEN RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',403,'mensagem','Administrador nao autorizado.'); END IF;
 ELSE
   RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',403,'mensagem','Banco nao autorizado.');
 END IF;
 IF p_ocorrencia_id IS NULL OR p_decisao IS DISTINCT FROM 'cancelamento_legitimo'
    OR p_ficticio_sem_recebimento IS DISTINCT FROM true
    OR pg_catalog.char_length(pg_catalog.btrim(coalesce(p_motivo,''))) < 15
    OR pg_catalog.char_length(p_motivo) > 500
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',400,'mensagem','Exige cancelamento legitimo, confirmacao de teste ficticio e justificativa de 15 a 500 caracteres.'); END IF;
 SELECT o.pedido_id INTO v_pedido_id
 FROM public.catalogo_ocorrencias_v2 o WHERE o.id=p_ocorrencia_id;
 IF v_pedido_id IS NULL
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',404,'mensagem','Ocorrencia inexistente.'); END IF;

 -- Ordem de bloqueio compativel com catalogo_operar_pedido_v2: pedido antes da ocorrencia.
 SELECT * INTO v_pedido FROM public.catalogo_pedidos p
 WHERE p.id=v_pedido_id FOR UPDATE;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',404,'mensagem','Pedido inexistente.'); END IF;
 -- Em todo ambiente, limitar a escrita a UM pedido e comercio.
 -- CI usa UUID sintetico; no banco postgres so o pedido QA real pode passar.
 IF NOT (
   (pg_catalog.current_database()='catalogo_cob06_ci'
     AND v_pedido.id='00000000-0000-4000-8000-00000000c606'::uuid
     AND v_pedido.comercio_id='comercio-de-exemplo')
   OR
   (pg_catalog.current_database()='postgres'
     AND v_pedido.id='a4ca7c4e-465f-4342-ae18-5c7eea1dec15'::uuid
     AND v_pedido.comercio_id='asaas-cob02')
 ) THEN RETURN pg_catalog.jsonb_build_object(
    'ok',false,'http_status',403,'mensagem','Pedido fora da lista de homologacao.'); END IF;
 -- Respeita o mesmo lock do fechamento financeiro, sem aguardar indefinidamente.
 IF NOT pg_catalog.pg_try_advisory_xact_lock(
   pg_catalog.hashtextextended('catalogo-fatura:'||v_pedido.comercio_id,0))
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',409,'mensagem','Fechamento em andamento; tente novamente.'); END IF;

 SELECT * INTO v_occ FROM public.catalogo_ocorrencias_v2 o
 WHERE o.id=p_ocorrencia_id AND o.pedido_id=v_pedido.id FOR UPDATE;
 IF NOT FOUND OR v_occ.status NOT IN ('aberta','em_revisao')
    OR v_occ.origem <> 'comercio' OR v_occ.categoria <> 'cancelamento_comercio'
    OR v_occ.motoboy_id IS NOT NULL OR v_occ.comercio_id <> v_pedido.comercio_id
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',409,'mensagem','Ocorrencia nao elegivel ou ja revisada.'); END IF;

 IF v_pedido.versao_financeira<>2 OR v_pedido.provedor<>'offline'
    OR v_pedido.modalidade<>'retirada' OR v_pedido.forma_pagamento<>'dinheiro'
    OR v_pedido.status<>'pronto' OR v_pedido.status_pagamento<>'pendente'
    OR v_pedido.entrega_status NOT IN ('nao_atribuido','cancelamento_solicitado')
    OR v_pedido.aceito_em IS NULL OR v_pedido.coletado_em IS NOT NULL
    OR v_pedido.codigo_entrega_usado_em IS NOT NULL
    OR v_pedido.codigo_entrega_expira_em IS NULL
    OR v_pedido.codigo_entrega_expira_em>=v_agora
    OR v_pedido.motoboy_preferido_id IS NOT NULL
    OR v_pedido.reembolso_pendente OR v_pedido.pagamento_revisao_pendente
    OR v_pedido.taxa_motoboy_centavos<>0
    OR v_pedido.taxa_plataforma_centavos<>pg_catalog.round(v_pedido.subtotal_produtos_centavos*0.07)::integer
    OR v_pedido.taxa_total_centavos<>v_pedido.taxa_plataforma_centavos
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',409,'mensagem','Pedido nao elegivel; exige revisao manual sem estorno automatico.'); END IF;

 -- Comissao ainda aberta, nao incluida em qualquer fatura (nem historica).
 SELECT * INTO v_comissao FROM public.catalogo_comissoes_offline c
 WHERE c.pedido_id=v_pedido.id FOR UPDATE;
 IF NOT FOUND OR v_comissao.comercio_id<>v_pedido.comercio_id
    OR v_comissao.status<>'aberta' OR v_comissao.versao_financeira<>2
    OR v_comissao.modalidade<>'retirada' OR v_comissao.taxa_motoboy_centavos<>0
    OR v_comissao.taxa_plataforma_centavos<>v_pedido.taxa_plataforma_centavos
    OR v_comissao.valor_total_centavos<>v_pedido.taxa_total_centavos
    OR coalesce(v_comissao.financiamento_logistica_comprovado,false)
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',409,'mensagem','Comissao registrada requer conciliacao manual.'); END IF;

 IF EXISTS(SELECT 1 FROM public.catalogo_fatura_componentes_v2 fc WHERE fc.pedido_id=v_pedido.id)
    OR EXISTS(SELECT 1 FROM public.catalogo_logistica_offline_v2 lg WHERE lg.pedido_id=v_pedido.id)
    OR EXISTS(SELECT 1 FROM public.catalogo_remuneracoes_v2 r WHERE r.pedido_id=v_pedido.id)
    OR EXISTS(SELECT 1 FROM public.catalogo_entregas_atribuidas a WHERE a.pedido_id=v_pedido.id)
    OR EXISTS(SELECT 1 FROM public.catalogo_pagamentos_v2 pg WHERE pg.pedido_id=v_pedido.id)
    OR EXISTS(SELECT 1 FROM public.catalogo_pagamento_eventos_v2 pe WHERE pe.pedido_id=v_pedido.id)
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',409,'mensagem','Pedido possui vinculacao financeira ou logistica protegida.'); END IF;

 -- Um unico lancamento retido, sem eventos de pagamento/repasse.
 SELECT l.id INTO v_lancamento_id FROM public.catalogo_lancamentos_financeiros_v2 l
 WHERE l.pedido_id=v_pedido.id AND l.tipo='comissao_plataforma'
   AND l.status='retido' AND l.valor_centavos=v_pedido.taxa_plataforma_centavos
   AND l.remuneracao_id IS NULL AND l.beneficiario_id IS NULL;
 IF v_lancamento_id IS NULL OR
    (SELECT pg_catalog.count(*) FROM public.catalogo_lancamentos_financeiros_v2 l
     WHERE l.pedido_id=v_pedido.id)<>1
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',409,'mensagem','Livro financeiro inesperado; cancelamento bloqueado.'); END IF;

 UPDATE public.catalogo_comissoes_offline SET status='cancelada'
 WHERE pedido_id=v_pedido.id AND status='aberta';
 UPDATE public.catalogo_lancamentos_financeiros_v2
 SET status='estornado',atualizado_em=v_agora,
     metadata=metadata||pg_catalog.jsonb_build_object(
       'cancelamento_qa_v2',true,'ocorrencia_id',v_occ.id,'revisado_por',p_operador_id)
 WHERE id=v_lancamento_id AND status='retido';
 UPDATE public.catalogo_pedidos
 SET status='cancelado',entrega_status='cancelado',cancelado_em=v_agora,
     motivo_cancelamento=pg_catalog.left(pg_catalog.btrim(p_motivo),500)
 WHERE id=v_pedido.id;
 UPDATE public.catalogo_ocorrencias_v2
 SET status='resolvida',decisao='cancelamento_legitimo',comprovada=false,
     revisao_motivo=pg_catalog.left(pg_catalog.btrim(p_motivo),500),
     revisado_por=p_operador_id,revisado_em=v_agora
 WHERE id=v_occ.id;
 INSERT INTO public.catalogo_entregas_gestao_eventos
   (comercio_id,pedido_id,operador_id,acao,metadata)
 VALUES(v_pedido.comercio_id,v_pedido.id,p_operador_id,
   'cancelamento_retirada_ficticia_qa',
   pg_catalog.jsonb_build_object('ocorrencia_id',v_occ.id,
     'comissao_cancelada_centavos',v_comissao.valor_total_centavos,
     'confirmado_sem_recebimento',true,'prova','revisao_admin_qa'));

 RETURN pg_catalog.jsonb_build_object('ok',true,'pedido_id',v_pedido.id,
   'ocorrencia_id',v_occ.id,'status','cancelado',
   'comissao_status','cancelada','lancamento_status','estornado',
   'fatura_preservada',true);
END;
$cancel$;
-- Somente Edge com service_role pode invocar, nunca browser/anon/authenticated.
REVOKE ALL ON FUNCTION public.catalogo_cob06_cancelar_retirada_qa_v2(uuid,uuid,text,text,boolean)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_cob06_cancelar_retirada_qa_v2(uuid,uuid,text,text,boolean)
 TO service_role;
COMMIT;
