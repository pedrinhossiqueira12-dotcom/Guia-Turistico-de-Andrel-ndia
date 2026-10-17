-- COB-06 EXCLUSIVAMENTE STAGING: ensaio reversivel. Nao rodar em PRODUCAO.
-- Usa faturas/pedidos ficticios existentes e ROLLBACK; nenhum Pix/GitHub/WhatsApp.
-- Executar o arquivo INTEIRO em uma unica transacao; nunca executar parcialmente.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
CREATE TEMP TABLE qa_cob06_guard_results(ord int,cenario text,bloqueado boolean,codigo text,detalhe text) ON COMMIT DROP;
DO $qa$
DECLARE v_p jsonb;v_status text;v_code text;v_msg text;v_response jsonb;v_owner uuid;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id='d896cc0c-31e4-4ef7-8fa4-13d15f02dd2a'::uuid AND email='pedrinhossiqueira12@gmail.com' AND email_confirmed_at IS NOT NULL)
 OR EXISTS (SELECT 1 FROM auth.users WHERE id='4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid)
 THEN RAISE EXCEPTION 'Somente STAGING: identidade administrativa QA ausente ou producao detectada' USING ERRCODE='42501'; END IF;
 SELECT status INTO v_status FROM public.comercios_publicados WHERE local_id='asaas-cob02' FOR UPDATE;
 SELECT proprietario_id INTO v_owner FROM public.catalogos WHERE comercio_id='asaas-cob02' AND bloqueado=false FOR UPDATE;
 v_p:=catalogo_private.catalogo_pendencias_encerramento('asaas-cob02');
 IF v_status<>'ativo' OR v_owner IS NULL OR (v_p->>'divida_centavos')::int<>560
 OR (v_p->>'faturas_pendentes')::int<>2 OR (v_p->>'pedidos_em_andamento')::int<>0
 OR EXISTS(SELECT 1 FROM public.catalogo_encerramentos_comercio WHERE comercio_id='asaas-cob02')
 THEN RAISE EXCEPTION 'Preflight QA divergiu; nenhuma simulacao deve iniciar'; END IF;
 BEGIN
   UPDATE public.comercios_publicados SET status='deletado' WHERE local_id='asaas-cob02';
   RAISE EXCEPTION 'QA_FORCE_ROLLBACK' USING ERRCODE='PZ001';
 EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS v_code=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
 END;
 INSERT INTO qa_cob06_guard_results VALUES(1,'divida_impede_update',v_code='23514',v_code,v_msg);
 BEGIN
   DELETE FROM public.comercios_publicados WHERE local_id='asaas-cob02';
   RAISE EXCEPTION 'QA_FORCE_ROLLBACK' USING ERRCODE='PZ001';
 EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS v_code=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
 END;
 INSERT INTO qa_cob06_guard_results VALUES(2,'divida_impede_delete',v_code='23514',v_code,v_msg);
 BEGIN
   DELETE FROM public.catalogos WHERE comercio_id='asaas-cob02';
   RAISE EXCEPTION 'QA_FORCE_ROLLBACK' USING ERRCODE='PZ001';
 EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS v_code=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
 END;
 INSERT INTO qa_cob06_guard_results VALUES(3,'historico_impede_delete_fisico',v_code='23514',v_code,v_msg);
 INSERT INTO public.catalogo_encerramentos_comercio(comercio_id,solicitado_por,situacao,divida_apurada_centavos)
 VALUES('asaas-cob02',v_owner,'aguardando_quitacao',560);
 UPDATE public.catalogos SET bloqueado=true WHERE comercio_id='asaas-cob02';
 v_response:=public.catalogo_finalizar_encerramento_financeiro('asaas-cob02','d896cc0c-31e4-4ef7-8fa4-13d15f02dd2a'::uuid);
 INSERT INTO qa_cob06_guard_results VALUES(4,'admin_recusa_finalizar_com_divida',
   v_response->>'ok'='false' AND (v_response->'pendencias'->>'divida_centavos')::int=560,
   'RPC',left(v_response::text,300));
 BEGIN
   UPDATE public.comercios_publicados SET status='ativo' WHERE local_id='asaas-cob02';
   RAISE EXCEPTION 'QA_FORCE_ROLLBACK' USING ERRCODE='PZ001';
 EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS v_code=RETURNED_SQLSTATE,v_msg=MESSAGE_TEXT;
 END;
 INSERT INTO qa_cob06_guard_results VALUES(5,'encerramento_impede_republicar',v_code='23514',v_code,v_msg);
END
$qa$;
SELECT ord,cenario,bloqueado,codigo,detalhe FROM qa_cob06_guard_results ORDER BY ord;
ROLLBACK;
