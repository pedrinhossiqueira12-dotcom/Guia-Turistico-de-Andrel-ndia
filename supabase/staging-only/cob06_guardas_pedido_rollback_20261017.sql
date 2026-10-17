-- COB-06 EXCLUSIVAMENTE STAGING: ensaio reversivel. Nao rodar em PRODUCAO.
-- Usa faturas/pedidos ficticios existentes e ROLLBACK; nenhum Pix/GitHub/WhatsApp.
-- Executar o arquivo INTEIRO em uma unica transacao; nunca executar parcialmente.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
CREATE TEMP TABLE qa_cob06_pending_results(ord int,cenario text,bloqueado boolean,codigo text,detalhe text) ON COMMIT DROP;
DO $qa$
DECLARE v_p jsonb;v_owner uuid;v_status text;v_code text;v_msg text;v_response jsonb;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id='d896cc0c-31e4-4ef7-8fa4-13d15f02dd2a'::uuid AND email='pedrinhossiqueira12@gmail.com' AND email_confirmed_at IS NOT NULL)
 OR EXISTS (SELECT 1 FROM auth.users WHERE id='4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid)
 THEN RAISE EXCEPTION 'Somente STAGING: identidade administrativa QA ausente ou producao detectada' USING ERRCODE='42501'; END IF;
 SELECT status INTO v_status FROM public.comercios_publicados WHERE local_id='asaas-homologacao' FOR UPDATE;
 SELECT proprietario_id INTO v_owner FROM public.catalogos WHERE comercio_id='asaas-homologacao' AND bloqueado=false FOR UPDATE;
 v_p:=catalogo_private.catalogo_pendencias_encerramento('asaas-homologacao');
 IF v_status<>'ativo' OR v_owner IS NULL OR (v_p->>'divida_centavos')::int<>0
 OR (v_p->>'faturas_pendentes')::int<>0 OR (v_p->>'pedidos_em_andamento')::int<>0
 OR NOT EXISTS(SELECT 1 FROM public.catalogo_pedidos
  WHERE id='4a0dd6b9-8678-48eb-a615-f78b9a1d3a8b'::uuid
    AND comercio_id='asaas-homologacao' AND status='entregue')
 OR EXISTS(SELECT 1 FROM public.catalogo_encerramentos_comercio WHERE comercio_id='asaas-homologacao')
 THEN RAISE EXCEPTION 'Preflight pedido QA divergiu; nenhuma simulacao deve iniciar'; END IF;
 UPDATE public.catalogo_pedidos SET status='em_preparo'
 WHERE id='4a0dd6b9-8678-48eb-a615-f78b9a1d3a8b'::uuid
 AND comercio_id='asaas-homologacao' AND status='entregue';
 v_p:=catalogo_private.catalogo_pendencias_encerramento('asaas-homologacao');
 INSERT INTO qa_cob06_pending_results VALUES(1,'simulou_pedido_pendente',v_p->>'pedidos_em_andamento'='1'
   AND v_p->>'divida_centavos'='0' AND v_p->>'faturas_pendentes'='0',
   'SELECT',left(v_p::text,300));
 BEGIN
   UPDATE public.comercios_publicados SET status='deletado' WHERE local_id='asaas-homologacao';
   RAISE EXCEPTION 'QA_FORCE_ROLLBACK' USING ERRCODE='PZ001';
 EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS v_code=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
 END;
 INSERT INTO qa_cob06_pending_results VALUES(2,'pedido_impede_despublicacao',v_code='23514',v_code,v_msg);
 BEGIN
   DELETE FROM public.comercios_publicados WHERE local_id='asaas-homologacao';
   RAISE EXCEPTION 'QA_FORCE_ROLLBACK' USING ERRCODE='PZ001';
 EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS v_code=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
 END;
 INSERT INTO qa_cob06_pending_results VALUES(3,'pedido_impede_delete',v_code='23514',v_code,v_msg);
 INSERT INTO public.catalogo_encerramentos_comercio(comercio_id,solicitado_por,situacao,divida_apurada_centavos)
 VALUES('asaas-homologacao',v_owner,'pendente_arquivamento',0);
 UPDATE public.catalogos SET bloqueado=true WHERE comercio_id='asaas-homologacao';
 v_response:=public.catalogo_finalizar_encerramento_financeiro('asaas-homologacao','d896cc0c-31e4-4ef7-8fa4-13d15f02dd2a'::uuid);
 INSERT INTO qa_cob06_pending_results VALUES(4,'admin_recusa_finalizar_com_pedido',
   v_response->>'ok'='false' AND (v_response->'pendencias'->>'divida_centavos')::int=0
   AND (v_response->'pendencias'->>'pedidos_em_andamento')::int=1,
   'RPC',left(v_response::text,300));
END
$qa$;
SELECT ord,cenario,bloqueado,codigo,detalhe FROM qa_cob06_pending_results ORDER BY ord;
ROLLBACK;
