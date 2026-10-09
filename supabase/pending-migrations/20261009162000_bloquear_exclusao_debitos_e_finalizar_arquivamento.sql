-- A publicação pode ser arquivada somente após quitação e conclusão operacional.
-- Protege o caminho legado de exclusão mesmo quando não passa pela Edge nova.
BEGIN;
CREATE OR REPLACE FUNCTION catalogo_private.catalogo_pendencias_encerramento(p_comercio text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $p$
DECLARE v_faturas bigint;v_sem_fatura bigint;v_abertos bigint;v_divida bigint;
BEGIN
 SELECT count(*),coalesce(sum(greatest(f.total_comissao_centavos,0)),0)
 INTO v_faturas,v_divida
 FROM public.catalogo_fechamentos_offline f
 WHERE f.comercio_id=p_comercio AND f.status<>'pago';
 SELECT coalesce(sum(greatest(c.valor_total_centavos,0)),0)
 INTO v_sem_fatura
 FROM public.catalogo_comissoes_offline c
 WHERE c.comercio_id=p_comercio AND c.status NOT IN ('paga','cancelada','contestada')
 AND NOT EXISTS(SELECT 1 FROM public.catalogo_fechamentos_offline f
     WHERE f.comercio_id=c.comercio_id AND f.competencia=c.competencia);
 SELECT count(*) INTO v_abertos FROM public.catalogo_pedidos p
 WHERE p.comercio_id=p_comercio
   AND p.status NOT IN ('entregue','concluido','cancelado','reembolsado');
 RETURN jsonb_build_object('divida_centavos',v_divida+v_sem_fatura,
   'faturas_pendentes',v_faturas,'pedidos_em_andamento',v_abertos);
END; $p$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_pendencias_encerramento(text)
 FROM PUBLIC,anon,authenticated,service_role;

-- Corrige a análise original que desconsiderava pedidos pendentes ainda sem motoboy.
CREATE OR REPLACE FUNCTION public.catalogo_solicitar_encerramento_financeiro(
 p_comercio text,p_usuario uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $end$
DECLARE v_dono uuid;v_p jsonb;v_situacao text;
BEGIN
 IF p_comercio IS NULL OR p_usuario IS NULL
 THEN RETURN jsonb_build_object('ok',false,'mensagem','Identidade ou comércio inválido.'); END IF;
 SELECT proprietario_id INTO v_dono FROM public.catalogos
 WHERE comercio_id=p_comercio FOR UPDATE;
 IF v_dono IS NULL OR v_dono<>p_usuario
 THEN RETURN jsonb_build_object('ok',false,'mensagem','Somente o proprietário pode encerrar este comércio.'); END IF;
 v_p:=catalogo_private.catalogo_pendencias_encerramento(p_comercio);
 v_situacao:=CASE WHEN (v_p->>'divida_centavos')::bigint>0
       OR (v_p->>'faturas_pendentes')::bigint>0
       OR (v_p->>'pedidos_em_andamento')::bigint>0
    THEN 'aguardando_quitacao' ELSE 'pendente_arquivamento' END;
 INSERT INTO public.catalogo_encerramentos_comercio(
  comercio_id,solicitado_por,situacao,divida_apurada_centavos
 ) VALUES(p_comercio,p_usuario,v_situacao,(v_p->>'divida_centavos')::bigint)
 ON CONFLICT(comercio_id) DO UPDATE SET
  solicitado_por=excluded.solicitado_por,
  situacao=CASE WHEN public.catalogo_encerramentos_comercio.situacao='arquivado'
    THEN 'arquivado' ELSE excluded.situacao END,
  divida_apurada_centavos=excluded.divida_apurada_centavos,atualizado_em=now();
 UPDATE public.catalogos SET bloqueado=true,
   motivo_bloqueio='Encerramento solicitado pelo proprietário'
 WHERE comercio_id=p_comercio AND motivo_bloqueio IS DISTINCT FROM 'Encerramento solicitado pelo proprietário';
 RETURN jsonb_build_object('ok',true,'situacao',v_situacao,'divida_centavos',(v_p->>'divida_centavos')::bigint,
  'faturas_pendentes',(v_p->>'faturas_pendentes')::bigint,
  'pedidos_em_andamento',(v_p->>'pedidos_em_andamento')::bigint,
  'mensagem','Novos pedidos suspensos. Os registros financeiros são preservados.');
END; $end$;
REVOKE ALL ON FUNCTION public.catalogo_solicitar_encerramento_financeiro(text,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_solicitar_encerramento_financeiro(text,uuid) TO service_role;

ALTER TABLE public.catalogo_encerramentos_comercio
 DROP CONSTRAINT IF EXISTS catalogo_encerramentos_comercio_situacao_check;
ALTER TABLE public.catalogo_encerramentos_comercio
 ADD CONSTRAINT catalogo_encerramentos_comercio_situacao_check
 CHECK(situacao IN ('aguardando_quitacao','pendente_arquivamento','arquivado'));

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_proteger_despublicacao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $guard$
DECLARE v_id text;v_p jsonb;
BEGIN
 v_id:=OLD.local_id;
 IF TG_OP='UPDATE' THEN
   IF OLD.status IS NOT DISTINCT FROM NEW.status
      OR OLD.status<>'ativo' THEN RETURN NEW; END IF;
 END IF;
 v_p:=catalogo_private.catalogo_pendencias_encerramento(v_id);
 IF (v_p->>'divida_centavos')::bigint>0
  OR (v_p->>'faturas_pendentes')::bigint>0
  OR (v_p->>'pedidos_em_andamento')::bigint>0
 THEN RAISE EXCEPTION 'Estabelecimento com faturas, comissões ou pedidos pendentes: arquivamento negado'
      USING ERRCODE='23514';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $guard$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_proteger_despublicacao()
 FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS catalogo_publicacao_sem_divida_guard
 ON public.comercios_publicados;
CREATE TRIGGER catalogo_publicacao_sem_divida_guard
 BEFORE DELETE OR UPDATE OF status ON public.comercios_publicados
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_proteger_despublicacao();

-- Nunca apagar uma loja com histórico operacional mesmo quando a fatura já foi quitada.
CREATE OR REPLACE FUNCTION catalogo_private.catalogo_proteger_exclusao_fisica()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $phys$
BEGIN
 IF EXISTS(SELECT 1 FROM public.catalogo_pedidos WHERE comercio_id=OLD.comercio_id)
  OR EXISTS(SELECT 1 FROM public.catalogo_fechamentos_offline WHERE comercio_id=OLD.comercio_id)
  OR EXISTS(SELECT 1 FROM public.catalogo_comissoes_offline WHERE comercio_id=OLD.comercio_id)
 THEN RAISE EXCEPTION 'Há histórico financeiro a conservar; utilize arquivamento lógico'
       USING ERRCODE='23514'; END IF;
 RETURN OLD;
END; $phys$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_proteger_exclusao_fisica()
 FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS catalogo_historico_guard_delete
 ON public.catalogos;
CREATE TRIGGER catalogo_historico_guard_delete
 BEFORE DELETE ON public.catalogos
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_proteger_exclusao_fisica();

CREATE OR REPLACE FUNCTION public.catalogo_finalizar_encerramento_financeiro(
 p_comercio text,p_admin uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $finish$
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
END; $finish$;
REVOKE ALL ON FUNCTION public.catalogo_finalizar_encerramento_financeiro(text,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_finalizar_encerramento_financeiro(text,uuid) TO service_role;
COMMIT;
