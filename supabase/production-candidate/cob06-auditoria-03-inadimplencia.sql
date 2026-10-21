-- CANDIDATO forward-only; aplicar apenas em clone descartavel ate novo corte revisado.
BEGIN;
ALTER FUNCTION public.catalogo_confirmar_cobranca_fatura(text,text,text,integer,text)
 RENAME TO catalogo_confirmar_cobranca_fatura_pre_auditoria;
REVOKE ALL ON FUNCTION public.catalogo_confirmar_cobranca_fatura_pre_auditoria(text,text,text,integer,text)
 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.catalogo_confirmar_cobranca_fatura(p_order_id text,p_estado text,p_payment_id text,p_valor_centavos integer,p_detalhe text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.catalogo_fatura_cobrancas%ROWTYPE;r jsonb;v_deve boolean;
 v_motivo text;v_block boolean;v_fin constant text:='Comissão de pagamentos presenciais vencida.';
BEGIN
 -- Localizar a loja sem trava; depois serializar TODAS suas conciliacoes
 -- antes de bloquear cobranca/fatura. Quitacao e estorno compartilham ordem.
 SELECT * INTO c FROM public.catalogo_fatura_cobrancas WHERE order_id=btrim(coalesce(p_order_id,''));
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reconhecido',false); END IF;
 SELECT bloqueado,motivo_bloqueio INTO v_block,v_motivo FROM public.catalogos WHERE comercio_id=c.comercio_id FOR UPDATE;
 -- Registradores MP/Asaas travam fechamento antes da cobranca. Compartilhar
 -- essa ordem tambem aqui evita ciclo fechamento->cobranca->fechamento.
 PERFORM 1 FROM public.catalogo_fechamentos_offline WHERE id=c.fechamento_id FOR UPDATE;
 SELECT * INTO c FROM public.catalogo_fatura_cobrancas WHERE id=c.id FOR UPDATE;
 IF (p_estado='pago' AND c.status IN ('estornado','contestado'))
 OR (c.status='pago' AND p_estado IN ('cancelado','expirado'))
 THEN RETURN jsonb_build_object('ok',false,'status',c.status,'mensagem','Estado financeiro final exige revisao; nao reativar.'); END IF;
 r:=public.catalogo_confirmar_cobranca_fatura_pre_auditoria(p_order_id,p_estado,p_payment_id,p_valor_centavos,p_detalhe);
 SELECT EXISTS(SELECT 1 FROM public.catalogo_fechamentos_offline f
   WHERE f.comercio_id=c.comercio_id AND f.status<>'pago' AND f.total_comissao_centavos>0
    AND (f.status IN ('vencido','bloqueado') OR f.vencimento_em<CURRENT_DATE))
 OR EXISTS(SELECT 1 FROM public.catalogo_comissoes_offline co
   WHERE co.comercio_id=c.comercio_id AND co.status NOT IN ('paga','cancelada','contestada')
    AND (co.competencia+interval '1 month 5 days')::date<CURRENT_DATE
    AND co.valor_total_centavos>coalesce((SELECT sum(fc.valor_centavos)
     FROM public.catalogo_fatura_componentes_v2 fc
     JOIN public.catalogo_fechamentos_offline f ON f.id=fc.fechamento_id
     WHERE fc.pedido_id=co.pedido_id AND f.comercio_id=co.comercio_id AND f.competencia=co.competencia),0))
 INTO v_deve;
 -- Restaurar na MESMA transacao; nenhum desbloqueio intermediario e visivel.
 IF v_block AND v_motivo IS DISTINCT FROM v_fin THEN
  UPDATE public.catalogos SET bloqueado=true,motivo_bloqueio=v_motivo WHERE comercio_id=c.comercio_id;
 ELSIF v_deve THEN
  UPDATE public.catalogos SET bloqueado=true,motivo_bloqueio=v_fin WHERE comercio_id=c.comercio_id
   AND (NOT bloqueado OR motivo_bloqueio=v_fin);
 END IF;
 RETURN r||jsonb_build_object('catalogo_desbloqueado',
  v_block AND NOT (SELECT bloqueado FROM public.catalogos WHERE comercio_id=c.comercio_id));
END $$;
REVOKE ALL ON FUNCTION public.catalogo_confirmar_cobranca_fatura(text,text,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_confirmar_cobranca_fatura(text,text,text,integer,text) TO service_role;
COMMIT;
