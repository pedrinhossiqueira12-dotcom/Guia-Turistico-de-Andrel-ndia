-- STAGING: copia exata da funcao antes da alteracao QA em 17/10/2026.
-- Usar somente para rollback manual revisado, nunca producao.
BEGIN;
CREATE OR REPLACE FUNCTION public.catalogo_finalizar_encerramento_financeiro(p_comercio text, p_admin uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_solic public.catalogo_encerramentos_comercio%ROWTYPE;v_p jsonb;v_arquivados integer;
BEGIN
 IF p_admin IS DISTINCT FROM '4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid
 THEN RETURN jsonb_build_object('ok',false,'mensagem','Somente o administrador pode arquivar.'); END IF;
 SELECT * INTO v_solic FROM public.catalogo_encerramentos_comercio
 WHERE comercio_id=p_comercio FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'mensagem','Solicitação de encerramento não encontrada.'); END IF;
 PERFORM 1 FROM public.catalogos WHERE comercio_id=p_comercio AND bloqueado=true FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'mensagem','Catálogo não está suspenso.'); END IF;
 IF v_solic.situacao='arquivado'
 THEN RETURN jsonb_build_object('ok',true,'situacao','arquivado','ja_arquivado',true); END IF;
 v_p:=catalogo_private.catalogo_pendencias_encerramento(p_comercio);
 IF (v_p->>'divida_centavos')::bigint>0
  OR (v_p->>'faturas_pendentes')::bigint>0
  OR (v_p->>'pedidos_em_andamento')::bigint>0
 THEN RETURN jsonb_build_object('ok',false,'mensagem','Há débitos ou pedidos em andamento. Arquivamento recusado.',
   'pendencias',v_p); END IF;
 UPDATE public.comercios_publicados SET status='arquivado'
 WHERE local_id=p_comercio AND status='ativo';
 GET DIAGNOSTICS v_arquivados=ROW_COUNT;
 UPDATE public.catalogo_encerramentos_comercio SET situacao='arquivado',
  divida_apurada_centavos=0,atualizado_em=now() WHERE comercio_id=p_comercio;
 RETURN jsonb_build_object('ok',true,'situacao','arquivado',
   'publicacao_desativada',v_arquivados>0,
   'mensagem','Cadastro arquivado na publicação dinâmica; faturas e histórico preservados.');
END; $function$

REVOKE ALL ON FUNCTION public.catalogo_finalizar_encerramento_financeiro(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_finalizar_encerramento_financeiro(text,uuid) TO service_role;
COMMIT;
