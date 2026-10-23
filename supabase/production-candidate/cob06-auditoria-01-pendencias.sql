-- CANDIDATO FORWARD-ONLY da auditoria COB-06. Nao integra as nove fontes congeladas.
-- Somente banco local descartavel ate revisao explicita do novo corte. Sem DML historico.
BEGIN;
CREATE OR REPLACE FUNCTION catalogo_private.catalogo_pendencias_encerramento(p_comercio text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $p$
DECLARE v_faturas bigint;v_sem_fatura bigint;v_abertos bigint;v_divida bigint;
BEGIN
 SELECT count(*),coalesce(sum(greatest(f.total_comissao_centavos,0)),0)
 INTO v_faturas,v_divida FROM public.catalogo_fechamentos_offline f
 WHERE f.comercio_id=p_comercio AND f.status<>'pago';
 -- Existencia de um fechamento nao prova inclusao da comissao no snapshot.
 -- Somente componentes reais da mesma origem cobrem a obrigacao; o restante
 -- continua devido, inclusive em entrega tardia de competencia ja quitada.
 SELECT coalesce(sum(greatest(c.valor_total_centavos-coalesce((
   SELECT sum(fc.valor_centavos) FROM public.catalogo_fatura_componentes_v2 fc
   JOIN public.catalogo_fechamentos_offline f ON f.id=fc.fechamento_id
   WHERE fc.pedido_id=c.pedido_id AND f.comercio_id=c.comercio_id
     AND f.competencia=c.competencia
 ),0),0)),0) INTO v_sem_fatura
 FROM public.catalogo_comissoes_offline c
 WHERE c.comercio_id=p_comercio AND c.status NOT IN ('paga','cancelada','contestada');
 SELECT count(*) INTO v_abertos FROM public.catalogo_pedidos p
 WHERE p.comercio_id=p_comercio
 AND p.status NOT IN ('entregue','concluido','cancelado','reembolsado');
 RETURN jsonb_build_object('divida_centavos',v_divida+v_sem_fatura,
  'faturas_pendentes',v_faturas,'pedidos_em_andamento',v_abertos);
END; $p$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_pendencias_encerramento(text)
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
