-- COB-06: prova isolada de cancelamento de retirada FICTICIA nao recebida.
-- Nunca instalar em STAGING ou PROD: so existe no banco descartavel catalogo_cob06_ci.
-- Nao reconcilia/baixa fatura, nao reembolsa nem movimenta saldo ou pagamento.
BEGIN;
DO $guard$
BEGIN
 IF pg_catalog.current_database() <> 'catalogo_cob06_ci'
    OR pg_catalog.to_regprocedure('catalogo_private.catalogo_cob06_realocar_entrega_congelada_ci()') IS NULL
 THEN RAISE EXCEPTION 'COB06_CI_ONLY: cancelamento QA proibido fora do clone';
 END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_cob06_cancelar_retirada_qa_ci(
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
 IF p_operador_id IS DISTINCT FROM '4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',403,'mensagem','Administrador nao autorizado.'); END IF;
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
       'cancelamento_qa_ci',true,'ocorrencia_id',v_occ.id,'revisado_por',p_operador_id)
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
   'cancelamento_retirada_ficticia_ci',
   pg_catalog.jsonb_build_object('ocorrencia_id',v_occ.id,
     'comissao_cancelada_centavos',v_comissao.valor_total_centavos,
     'confirmado_sem_recebimento',true,'prova','revisao_admin_qa'));

 RETURN pg_catalog.jsonb_build_object('ok',true,'pedido_id',v_pedido.id,
   'ocorrencia_id',v_occ.id,'status','cancelado',
   'comissao_status','cancelada','lancamento_status','estornado',
   'fatura_preservada',true);
END;
$cancel$;
-- Prototipo intencionalmente nao invocavel pela Data API nem pela Edge.
REVOKE ALL ON FUNCTION catalogo_private.catalogo_cob06_cancelar_retirada_qa_ci(uuid,uuid,text,text,boolean)
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
