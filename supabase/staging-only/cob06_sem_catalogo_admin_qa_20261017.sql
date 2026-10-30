-- STAGING APENAS: identifica administrador de QA e corrige status tecnico da publicacao.
-- Nao executar em producao, nem publicar a Edge whatsapp-bot nesta etapa.
-- Cria a RPC administrativa sem catalogo ausente; nao atualiza linhas nem faturas.
BEGIN;
DO $qa$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM auth.users
   WHERE id='d896cc0c-31e4-4ef7-8fa4-13d15f02dd2a'::uuid
     AND email='pedrinhossiqueira12@gmail.com'
     AND email_confirmed_at IS NOT NULL
 ) OR EXISTS (
   SELECT 1 FROM auth.users WHERE id='4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid
 ) THEN
   RAISE EXCEPTION 'Ambiente STAGING COB-06 nao identificado; recusar alteracao' USING ERRCODE='42501';
 END IF;
END;
$qa$;

CREATE OR REPLACE FUNCTION public.catalogo_arquivar_sem_catalogo_admin(
 p_comercio text, p_admin uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $sem_catalogo$
DECLARE v_status text; v_p jsonb; v_atualizados integer;
BEGIN
 IF p_admin IS DISTINCT FROM 'd896cc0c-31e4-4ef7-8fa4-13d15f02dd2a'::uuid
    OR p_comercio IS NULL OR pg_catalog.length(pg_catalog.btrim(p_comercio))=0
    OR pg_catalog.length(p_comercio)>200
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,'mensagem','Operacao administrativa invalida.'); END IF;

 -- Serializa com INSERT de catalogos via FK para comercios_publicados.
 SELECT status INTO v_status
 FROM public.comercios_publicados
 WHERE local_id=p_comercio FOR UPDATE;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false,'mensagem','Publicacao inexistente.'); END IF;

 IF EXISTS(SELECT 1 FROM public.catalogos WHERE comercio_id=p_comercio)
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,'mensagem','Comercio com catalogo: usar encerramento financeiro.'); END IF;

 -- Os FKs hoje proíbem a maioria destes orfaos. Conferir explicitamente
 -- protege contra dados historicos importados ou alteracoes futuras.
 IF EXISTS(SELECT 1 FROM public.catalogo_pedidos WHERE comercio_id=p_comercio)
 OR EXISTS(SELECT 1 FROM public.catalogo_comissoes_offline WHERE comercio_id=p_comercio)
 OR EXISTS(SELECT 1 FROM public.catalogo_fechamentos_offline WHERE comercio_id=p_comercio)
 OR EXISTS(SELECT 1 FROM public.catalogo_fatura_cobrancas WHERE comercio_id=p_comercio)
 OR EXISTS(SELECT 1 FROM public.catalogo_asaas_clientes WHERE comercio_id=p_comercio)
 OR EXISTS(SELECT 1 FROM public.catalogo_assinaturas WHERE comercio_id=p_comercio)
 OR EXISTS(SELECT 1 FROM public.catalogo_encerramentos_comercio WHERE comercio_id=p_comercio)
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,
   'mensagem','Historico financeiro ou operacional encontrado. Arquivamento recusado.'); END IF;

 v_p:=catalogo_private.catalogo_pendencias_encerramento(p_comercio);
 IF (v_p->>'divida_centavos')::bigint>0
 OR (v_p->>'faturas_pendentes')::bigint>0
 OR (v_p->>'pedidos_em_andamento')::bigint>0
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,
   'mensagem','Debito ou pedido pendente; arquivamento negado.'); END IF;

 UPDATE public.comercios_publicados
 SET status='deletado',destaque=false,
     deletado_em=coalesce(deletado_em,pg_catalog.now()),
     atualizado_em=pg_catalog.now(),atualizado_por=p_admin
 WHERE local_id=p_comercio AND status<>'deletado';
 GET DIAGNOSTICS v_atualizados=ROW_COUNT;
 RETURN pg_catalog.jsonb_build_object('ok',true,'situacao','arquivado',
   'sem_catalogo',true,'ja_arquivado',v_status='deletado',
   'publicacao_desativada',v_atualizados>0);
END;
$sem_catalogo$;

REVOKE ALL ON FUNCTION public.catalogo_arquivar_sem_catalogo_admin(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_arquivar_sem_catalogo_admin(text,uuid) TO service_role;
COMMIT;
