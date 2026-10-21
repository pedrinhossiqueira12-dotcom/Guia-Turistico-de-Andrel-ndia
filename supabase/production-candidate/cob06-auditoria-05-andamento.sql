-- Candidato forward-only. Continuacao nao reativa o catalogo nem permite aceite.
BEGIN;
ALTER TABLE public.catalogos ADD COLUMN operacoes_suspensas_em timestamptz;
CREATE FUNCTION catalogo_private.catalogo_marcar_suspensao()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.bloqueado AND NOT OLD.bloqueado THEN NEW.operacoes_suspensas_em:=clock_timestamp();
 ELSIF NOT NEW.bloqueado THEN NEW.operacoes_suspensas_em:=NULL;
 ELSE NEW.operacoes_suspensas_em:=OLD.operacoes_suspensas_em; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_marcar_suspensao() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER cob06_marcar_suspensao BEFORE UPDATE ON public.catalogos
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_marcar_suspensao();
CREATE FUNCTION catalogo_private.catalogo_continuacao_permitida(p_comercio text,p_pedido uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.catalogos%ROWTYPE;aceite timestamptz;suspensao timestamptz;
BEGIN
 -- NOWAIT evita inverter espera com entrypoints legados que ja travaram pedido.
 SELECT * INTO c FROM public.catalogos WHERE comercio_id=p_comercio FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RETURN false; END IF;
 IF NOT c.bloqueado THEN RETURN true; END IF;
 IF c.motivo_bloqueio NOT IN ('Encerramento solicitado pelo proprietário','Comissão de pagamentos presenciais vencida.')
 OR c.motivo_bloqueio IS NULL THEN RETURN false; END IF;
 suspensao:=c.operacoes_suspensas_em;
 IF suspensao IS NULL AND c.motivo_bloqueio='Encerramento solicitado pelo proprietário'
 AND to_regclass('public.catalogo_encerramentos_comercio') IS NOT NULL THEN
  SELECT solicitado_em INTO suspensao FROM public.catalogo_encerramentos_comercio WHERE comercio_id=p_comercio;
 END IF;
 IF suspensao IS NULL THEN RETURN false; END IF;
 SELECT aceito_em INTO aceite FROM public.catalogo_pedidos WHERE id=p_pedido AND comercio_id=p_comercio;
 RETURN aceite IS NOT NULL AND aceite<=suspensao;
END $$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_continuacao_permitida(text,uuid) FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION public.catalogo_operar_pedido_v2(uuid,text,uuid,text,uuid,text) RENAME TO catalogo_operar_pedido_pre_suspensao;
REVOKE ALL ON FUNCTION public.catalogo_operar_pedido_pre_suspensao(uuid,text,uuid,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.catalogo_operar_pedido_v2(p_operador_id uuid,p_comercio_id text,p_pedido_id uuid,p_acao text,p_motoboy_id uuid DEFAULT NULL,p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE permitido boolean;b boolean;
BEGIN
 permitido:=catalogo_private.catalogo_continuacao_permitida(p_comercio_id,p_pedido_id);
 SELECT bloqueado INTO b FROM public.catalogos WHERE comercio_id=p_comercio_id;
 IF b AND (p_acao='aceitar' OR (p_acao NOT IN ('solicitar_cancelamento','rejeitar_antes_aceite') AND NOT permitido))
 THEN RETURN jsonb_build_object('ok',false,'http_status',423,'mensagem','Catalogo suspenso; somente pedidos aceitos antes da suspensao podem continuar.'); END IF;
 RETURN public.catalogo_operar_pedido_pre_suspensao(p_operador_id,p_comercio_id,p_pedido_id,p_acao,p_motoboy_id,p_motivo);
END $$;
ALTER FUNCTION public.catalogo_confirmar_entrega_autenticada(uuid,text,uuid,text,text) RENAME TO catalogo_confirmar_entrega_pre_suspensao;
REVOKE ALL ON FUNCTION public.catalogo_confirmar_entrega_pre_suspensao(uuid,text,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.catalogo_confirmar_entrega_autenticada(p_operador_id uuid,p_comercio_id text,p_pedido_id uuid,p_codigo_hash text,p_entregador text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT catalogo_private.catalogo_continuacao_permitida(p_comercio_id,p_pedido_id)
 THEN RETURN jsonb_build_object('ok',false,'http_status',423,'mensagem','Pedido sem aceite anterior comprovado.'); END IF;
 RETURN public.catalogo_confirmar_entrega_pre_suspensao(p_operador_id,p_comercio_id,p_pedido_id,p_codigo_hash,p_entregador);
END $$;
ALTER FUNCTION public.catalogo_confirmar_entrega_motoboy(uuid,text,uuid,text) RENAME TO catalogo_confirmar_motoboy_pre_suspensao;
REVOKE ALL ON FUNCTION public.catalogo_confirmar_motoboy_pre_suspensao(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.catalogo_confirmar_entrega_motoboy(p_operador_id uuid,p_comercio_id text,p_pedido_id uuid,p_codigo_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT catalogo_private.catalogo_continuacao_permitida(p_comercio_id,p_pedido_id)
 THEN RETURN jsonb_build_object('ok',false,'http_status',423,'mensagem','Pedido sem aceite anterior comprovado.'); END IF;
 RETURN public.catalogo_confirmar_motoboy_pre_suspensao(p_operador_id,p_comercio_id,p_pedido_id,p_codigo_hash);
END $$;
REVOKE ALL ON FUNCTION public.catalogo_operar_pedido_v2(uuid,text,uuid,text,uuid,text),
 public.catalogo_confirmar_entrega_autenticada(uuid,text,uuid,text,text),public.catalogo_confirmar_entrega_motoboy(uuid,text,uuid,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_operar_pedido_v2(uuid,text,uuid,text,uuid,text),
 public.catalogo_confirmar_entrega_autenticada(uuid,text,uuid,text,text),public.catalogo_confirmar_entrega_motoboy(uuid,text,uuid,text) TO service_role;
-- Suspensoes historicas sem instante comprovado ficam HOLD; nao preencher com now().
COMMIT;
