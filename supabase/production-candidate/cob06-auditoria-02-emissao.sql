-- CANDIDATO forward-only, fora do manifesto congelado. Somente clone descartavel.
-- O journal historicamente chamado Asaas torna-se exclusao mutua dos provedores.
BEGIN;
ALTER TABLE public.catalogo_asaas_emissoes ADD COLUMN IF NOT EXISTS gateway text NOT NULL DEFAULT 'asaas'
 CHECK(gateway IN ('asaas','mercadopago'));
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.catalogo_asaas_emissoes e
 JOIN public.catalogo_fatura_cobrancas c USING(fechamento_id) WHERE e.gateway<>c.gateway)
 THEN RAISE EXCEPTION 'HOLD: reservas historicas conflitantes exigem revisao'; END IF;
END $$;
CREATE OR REPLACE FUNCTION catalogo_private.catalogo_emissao_comum_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.catalogo_fechamentos_offline%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Reserva permanente; reconciliar sem novo POST'; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.fechamento_id IS DISTINCT FROM OLD.fechamento_id OR NEW.gateway IS DISTINCT FROM OLD.gateway
   OR NEW.operacao_id IS DISTINCT FROM OLD.operacao_id
  THEN RAISE EXCEPTION 'Identidade da reserva imutavel'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO f FROM public.catalogo_fechamentos_offline WHERE id=NEW.fechamento_id FOR UPDATE;
 IF NOT FOUND OR f.status NOT IN ('faturado','vencido','bloqueado') OR f.total_comissao_centavos<=0
 OR EXISTS(SELECT 1 FROM public.catalogo_fatura_cobrancas c
  WHERE c.fechamento_id=f.id AND c.gateway<>NEW.gateway)
 THEN RAISE EXCEPTION 'HOLD: fatura inelegivel ou outro provedor'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_emissao_comum_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER cob06_emissao_comum BEFORE INSERT OR UPDATE OR DELETE ON public.catalogo_asaas_emissoes
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_emissao_comum_guard();

CREATE OR REPLACE FUNCTION public.catalogo_reservar_emissao_mp_fatura(p_fechamento uuid,p_valor integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.catalogo_fechamentos_offline%ROWTYPE;e public.catalogo_asaas_emissoes%ROWTYPE;n boolean;
BEGIN
 SELECT * INTO f FROM public.catalogo_fechamentos_offline WHERE id=p_fechamento FOR UPDATE;
 IF NOT FOUND OR f.status NOT IN ('faturado','vencido','bloqueado') OR p_valor IS DISTINCT FROM f.total_comissao_centavos
 OR EXISTS(SELECT 1 FROM public.catalogo_fatura_cobrancas WHERE fechamento_id=p_fechamento)
 THEN RETURN jsonb_build_object('ok',false,'nova',false); END IF;
 INSERT INTO public.catalogo_asaas_emissoes(fechamento_id,gateway) VALUES(p_fechamento,'mercadopago')
 ON CONFLICT(fechamento_id) DO NOTHING RETURNING * INTO e;
 n:=FOUND;
 IF NOT n THEN SELECT * INTO e FROM public.catalogo_asaas_emissoes WHERE fechamento_id=p_fechamento; END IF;
 RETURN jsonb_build_object('ok',e.gateway='mercadopago','nova',n AND e.gateway='mercadopago',
  'operacao_id',e.operacao_id,'gateway',e.gateway,'fechamento_id',e.fechamento_id,'valor_centavos',f.total_comissao_centavos);
END $$;
REVOKE ALL ON FUNCTION public.catalogo_reservar_emissao_mp_fatura(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_reservar_emissao_mp_fatura(uuid,integer) TO service_role;

-- Conserva a implementacao existente, sem reescrever migrations ja aplicadas.
ALTER FUNCTION public.catalogo_registrar_cobranca_fatura(uuid,text,integer,text,text,text,timestamptz,text)
 RENAME TO catalogo_registrar_cobranca_fatura_pre_auditoria;
REVOKE ALL ON FUNCTION public.catalogo_registrar_cobranca_fatura_pre_auditoria(uuid,text,integer,text,text,text,timestamptz,text)
 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.catalogo_registrar_cobranca_fatura(p_fechamento_id uuid,p_order_id text,p_valor_centavos integer,
 p_qr_code text,p_qr_code_base64 text,p_ticket_url text,p_expira_em timestamptz,p_detalhe text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.catalogo_fatura_cobrancas%ROWTYPE;r jsonb;
BEGIN
 PERFORM 1 FROM public.catalogo_fechamentos_offline WHERE id=p_fechamento_id FOR UPDATE;
 SELECT * INTO c FROM public.catalogo_fatura_cobrancas WHERE fechamento_id=p_fechamento_id FOR UPDATE;
 IF FOUND THEN
  IF c.gateway<>'mercadopago' OR c.order_id IS DISTINCT FROM p_order_id OR c.valor_centavos IS DISTINCT FROM p_valor_centavos
  THEN RETURN jsonb_build_object('ok',false,'mensagem','Outra cobranca ja vinculada.'); END IF;
  -- Registro repetido nunca reabre pagamento, estorno ou Pix expirado.
  RETURN jsonb_build_object('ok',true,'order_id',c.order_id,'cobranca_id',c.id,'status',c.status);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.catalogo_asaas_emissoes WHERE fechamento_id=p_fechamento_id AND gateway='mercadopago')
 THEN RETURN jsonb_build_object('ok',false,'mensagem','Reserva comum ausente ou de outro provedor.'); END IF;
 r:=public.catalogo_registrar_cobranca_fatura_pre_auditoria(p_fechamento_id,p_order_id,p_valor_centavos,p_qr_code,p_qr_code_base64,p_ticket_url,p_expira_em,p_detalhe);
 IF r->>'ok'='true' THEN UPDATE public.catalogo_asaas_emissoes SET estado='registrado' WHERE fechamento_id=p_fechamento_id; END IF;
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.catalogo_registrar_cobranca_fatura(uuid,text,integer,text,text,text,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_registrar_cobranca_fatura(uuid,text,integer,text,text,text,timestamptz,text) TO service_role;

-- Defesa no registro: inclusive backend antigo nao pode trocar provedor/ID.
CREATE FUNCTION catalogo_private.catalogo_cobranca_identidade_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.gateway IS DISTINCT FROM OLD.gateway OR NEW.order_id IS DISTINCT FROM OLD.order_id
  OR NEW.fechamento_id IS DISTINCT FROM OLD.fechamento_id OR NEW.valor_centavos IS DISTINCT FROM OLD.valor_centavos)
 THEN RAISE EXCEPTION 'Identidade da cobranca imutavel'; END IF;
 IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM public.catalogo_asaas_emissoes e
  WHERE e.fechamento_id=NEW.fechamento_id AND e.gateway=NEW.gateway)
 THEN RAISE EXCEPTION 'Reserva comum ausente ou de outro provedor'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_cobranca_identidade_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER cob06_cobranca_identidade BEFORE INSERT OR UPDATE ON public.catalogo_fatura_cobrancas
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_cobranca_identidade_guard();

CREATE FUNCTION catalogo_private.catalogo_snapshot_emissao_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE id_f uuid;
BEGIN
 IF TG_TABLE_NAME='catalogo_fechamentos_offline' THEN
  IF (NEW.total_comissao_centavos,NEW.total_pedidos,NEW.competencia,NEW.comercio_id)
   IS NOT DISTINCT FROM (OLD.total_comissao_centavos,OLD.total_pedidos,OLD.competencia,OLD.comercio_id) THEN RETURN NEW; END IF;
  id_f:=OLD.id;
 ELSE
  id_f:=CASE WHEN TG_OP='DELETE' THEN OLD.fechamento_id ELSE NEW.fechamento_id END;
  PERFORM 1 FROM public.catalogo_fechamentos_offline WHERE id=id_f FOR UPDATE;
  IF TG_OP='UPDATE' AND OLD.fechamento_id<>NEW.fechamento_id THEN RAISE EXCEPTION 'Origem do componente imutavel'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.catalogo_asaas_emissoes WHERE fechamento_id=id_f)
 THEN RAISE EXCEPTION 'Snapshot reservado para emissao; nao recalcular'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_snapshot_emissao_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER cob06_snapshot_total BEFORE UPDATE ON public.catalogo_fechamentos_offline
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_snapshot_emissao_guard();
CREATE TRIGGER cob06_snapshot_componentes BEFORE INSERT OR UPDATE OR DELETE ON public.catalogo_fatura_componentes_v2
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_snapshot_emissao_guard();
COMMIT;
