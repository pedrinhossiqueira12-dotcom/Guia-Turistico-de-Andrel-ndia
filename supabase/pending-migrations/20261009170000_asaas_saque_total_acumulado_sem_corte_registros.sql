-- STAGING: reserva atômica sem limite artificial de quantidade de créditos.
-- Teto conservador por transferência = R$5.000; não limita a carteira nem seu prazo.
-- Nenhum saque, transferência, cobrança ou repasse é executado nesta migração.
BEGIN;

CREATE OR REPLACE FUNCTION public.catalogo_asaas_reservar_saque(p_motoboy uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $saque$
DECLARE
 v_ids uuid[];v_total bigint:=0;v_total_elegivel bigint:=0;
 v_saque uuid;v_pix text;
 v_limite_transferencia constant bigint:=500000;
BEGIN
 IF p_motoboy IS NULL OR NOT catalogo_private.catalogo_v2_autorizado(p_motoboy) THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Motoboy não autorizado.');
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('asaas-saque:'||p_motoboy::text,0));
 SELECT chave_pix_enc INTO v_pix
 FROM public.catalogo_motoboy_perfis
 WHERE usuario_id=p_motoboy AND NOT em_analise FOR UPDATE;
 IF v_pix IS NULL THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Cadastre sua chave Pix e aguarde a liberação do perfil.');
 END IF;
 -- Bloqueia todas as linhas elegíveis em ordem determinística.
 -- O cálculo é integralmente SQL, sem limite de 100/1.000 linhas do PostgREST.
 -- A soma acumulada define um teto monetário, NÃO um limite de comissões.
 WITH elegiveis AS MATERIALIZED (
  SELECT r.id,r.valor_centavos
  FROM public.catalogo_remuneracoes_v2 r
  JOIN public.catalogo_pedidos p ON p.id=r.pedido_id
  JOIN public.catalogo_comissoes_offline c ON c.pedido_id=p.id
  JOIN public.catalogo_fechamentos_offline f
   ON f.comercio_id=c.comercio_id AND f.competencia=c.competencia
  JOIN public.catalogo_fatura_cobrancas b ON b.fechamento_id=f.id
  WHERE r.motoboy_id=p_motoboy AND r.status='disponivel'
   AND r.financiamento_comprovado AND r.repasse_id IS NULL
   AND r.valor_centavos>0 AND r.valor_centavos<=v_limite_transferencia
   AND p.provedor='offline' AND p.entrega_status='entregue'
   AND NOT p.reembolso_pendente AND NOT p.pagamento_revisao_pendente
   AND c.status='paga' AND f.status='pago'
   AND b.gateway='asaas' AND b.status='pago' AND b.pago_em IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.catalogo_asaas_saque_itens i
    WHERE i.remuneracao_id=r.id AND i.ativo)
  ORDER BY r.id FOR UPDATE OF r
 ), acumulados AS (
  SELECT id,valor_centavos,
   sum(valor_centavos::bigint) OVER (ORDER BY id) AS acumulado
  FROM elegiveis
 ), selecionados AS (
  SELECT id,valor_centavos FROM acumulados
  WHERE acumulado<=v_limite_transferencia
 )
 SELECT (SELECT array_agg(id ORDER BY id) FROM selecionados),
        (SELECT coalesce(sum(valor_centavos::bigint),0) FROM selecionados),
        (SELECT coalesce(sum(valor_centavos::bigint),0) FROM elegiveis)
 INTO v_ids,v_total,v_total_elegivel;

 IF v_total<10000 THEN
  RETURN jsonb_build_object('ok',false,
   'mensagem',CASE WHEN v_total_elegivel>=10000
     THEN 'O saldo tem créditos que excedem o limite atual por Pix. Solicite revisão do limite bancário.'
     ELSE 'Saque mínimo de R$ 100,00 em créditos liberados. Comissões ainda não pagas pelo comércio não contam.'
     END);
 END IF;
 IF v_total>2147483647 THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Valor excede o limite técnico da reserva. Consulte a administração.');
 END IF;
 INSERT INTO public.catalogo_asaas_saques(motoboy_id,valor_centavos)
 VALUES(p_motoboy,v_total::integer) RETURNING id INTO v_saque;
 INSERT INTO public.catalogo_asaas_saque_itens(saque_id,remuneracao_id)
 SELECT v_saque,unnest(v_ids);
 RETURN jsonb_build_object('ok',true,'saque_id',v_saque,
  'valor_centavos',v_total,'creditos_incluidos',cardinality(v_ids),
  'saldo_elegivel_no_momento_centavos',v_total_elegivel);
END; $saque$;

-- Consulta o saque como UM objeto JSON. Não retorna uma linha por crédito, evitando
-- truncamento silencioso por max-rows do PostgREST em carteiras grandes.
CREATE OR REPLACE FUNCTION public.catalogo_asaas_validar_reserva_saque(p_saque uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $validar$
DECLARE
 v_saque public.catalogo_asaas_saques%ROWTYPE;
 v_qtd bigint;v_ativos bigint;v_total bigint;v_elegiveis boolean;
BEGIN
 SELECT * INTO v_saque FROM public.catalogo_asaas_saques WHERE id=p_saque;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'mensagem','Saque não encontrado.'); END IF;
 SELECT count(*),count(*) FILTER (WHERE i.ativo),
  coalesce(sum(r.valor_centavos::bigint) FILTER (WHERE i.ativo),0),
  coalesce(bool_and(
   i.ativo AND r.motoboy_id=v_saque.motoboy_id
   AND r.status='disponivel' AND r.financiamento_comprovado
   AND r.repasse_id IS NULL AND r.valor_centavos>0
   AND catalogo_private.catalogo_v2_financiado(r.pedido_id)
  ),false)
 INTO v_qtd,v_ativos,v_total,v_elegiveis
 FROM public.catalogo_asaas_saque_itens i
 JOIN public.catalogo_remuneracoes_v2 r ON r.id=i.remuneracao_id
 WHERE i.saque_id=p_saque;
 RETURN jsonb_build_object('ok',true,'elegivel',
   (v_saque.status='enviado' AND v_qtd>0 AND v_ativos=v_qtd
    AND v_elegiveis AND v_total=v_saque.valor_centavos),
  'quantidade',v_qtd,'valor_centavos',v_total);
END; $validar$;

-- A carteira soma por BIGINT; não depende de máximo de registros, e não confunde
-- saldo total acumulado com limite de cada transferência.
CREATE OR REPLACE FUNCTION public.catalogo_asaas_saldo_sacavel(p_motoboy uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $saldo$
 SELECT jsonb_build_object(
  'disponivel_centavos',coalesce(sum(r.valor_centavos::bigint),0),
  'creditos',count(*)
 ) FROM public.catalogo_remuneracoes_v2 r
 JOIN public.catalogo_pedidos p ON p.id=r.pedido_id
 JOIN public.catalogo_comissoes_offline c ON c.pedido_id=p.id
 JOIN public.catalogo_fechamentos_offline f
   ON f.comercio_id=c.comercio_id AND f.competencia=c.competencia
 JOIN public.catalogo_fatura_cobrancas b ON b.fechamento_id=f.id
 WHERE r.motoboy_id=p_motoboy AND catalogo_private.catalogo_v2_autorizado(p_motoboy)
  AND r.status='disponivel' AND r.financiamento_comprovado AND r.repasse_id IS NULL
  AND r.valor_centavos>0 AND p.provedor='offline' AND p.entrega_status='entregue'
  AND NOT p.reembolso_pendente AND NOT p.pagamento_revisao_pendente
  AND c.status='paga' AND f.status='pago'
  AND b.gateway='asaas' AND b.status='pago' AND b.pago_em IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.catalogo_asaas_saque_itens i
   WHERE i.remuneracao_id=r.id AND i.ativo);
$saldo$;

REVOKE ALL ON FUNCTION public.catalogo_asaas_reservar_saque(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.catalogo_asaas_validar_reserva_saque(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.catalogo_asaas_saldo_sacavel(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_reservar_saque(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_validar_reserva_saque(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_saldo_sacavel(uuid) TO service_role;
COMMIT;
