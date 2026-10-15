-- COB-06 / PR39: apuracao INERTE de recebimento e reversao multi-competencia.
-- Somente no PostgreSQL DESCARTAVEL da CI, apos candidatos 03 a 07.
-- Nenhum estado financeiro ou saldo e alterado. Um evento recebido no diario
-- NAO e prova autonoma de autenticidade do Asaas; a origem requer GET confiavel.
BEGIN;

CREATE FUNCTION public.catalogo_asaas_apurar_estados_acumulo_inerte(
 p_lote uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $apurar$
DECLARE
 v_lote public.catalogo_asaas_acumulo_lotes%ROWTYPE;
 v_ref public.catalogo_asaas_acumulo_referencias%ROWTYPE;
 v_obs public.catalogo_asaas_acumulo_observacoes%ROWTYPE;
 v_origens jsonb;
 v_qtd bigint:=0;
 v_recebimentos bigint:=0;
 v_reversoes bigint:=0;
 v_ultimo text;
 v_ultimo_id bigint;
 v_integridade boolean:=false;
 v_identidade boolean:=false;
 v_candidato boolean:=false;
 v_revisao boolean:=false;
 v_classificacao text;
BEGIN
 IF p_lote IS NULL THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','lote_invalido');
 END IF;
 SELECT * INTO v_lote FROM public.catalogo_asaas_acumulo_lotes WHERE id=p_lote;
 IF NOT FOUND THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','lote_inexistente');
 END IF;

 v_origens:=public.catalogo_asaas_conferir_conciliacao_acumulo(p_lote);
 v_integridade:=v_origens->>'integridade_contabil_ok'='true'
   AND (v_origens->>'valor_fontes_centavos')::bigint=v_lote.total_centavos;
 SELECT * INTO v_ref FROM public.catalogo_asaas_acumulo_referencias WHERE lote_id=p_lote;
 IF FOUND THEN
   SELECT * INTO v_obs FROM public.catalogo_asaas_acumulo_observacoes WHERE lote_id=p_lote;
   IF FOUND THEN
     v_identidade:=v_obs.payment_id~'^pay_[A-Za-z0-9_-]{5,120}$'
       AND v_obs.referencia=v_ref.referencia
       AND v_obs.valor_centavos=v_ref.valor_centavos
       AND v_ref.valor_centavos=v_lote.total_centavos
       AND v_ref.comercio_id=v_lote.comercio_id
       AND v_ref.payment_id IS NULL
       AND EXISTS(SELECT 1 FROM public.catalogo_asaas_clientes c
                  WHERE c.comercio_id=v_lote.comercio_id
                    AND c.cliente_id=v_obs.customer_id);
   END IF;
 END IF;

 SELECT pg_catalog.count(*),
        pg_catalog.count(*) FILTER (WHERE estado IN ('CONFIRMED','RECEIVED')),
        pg_catalog.count(*) FILTER (WHERE estado IN (
          'REFUNDED','PARTIALLY_REFUNDED','REFUND_IN_PROGRESS',
          'CHARGEBACK_REQUESTED','DELETED'))
 INTO v_qtd,v_recebimentos,v_reversoes
 FROM public.catalogo_asaas_acumulo_eventos
 WHERE lote_id=p_lote AND payment_id=v_obs.payment_id;
 SELECT e.id,e.estado INTO v_ultimo_id,v_ultimo
 FROM public.catalogo_asaas_acumulo_eventos e
 WHERE e.lote_id=p_lote AND e.payment_id=v_obs.payment_id
 ORDER BY e.id DESC LIMIT 1;

 -- Mesmo que chegue RECEIVED depois de REFUNDED, nunca reabilitar baixa.
 -- Um estado pendente posterior a recebimento requer revisao por ordem duvidosa.
 v_revisao:=NOT v_integridade OR NOT v_identidade OR v_reversoes>0
   OR (v_recebimentos>0 AND v_ultimo NOT IN ('CONFIRMED','RECEIVED'));
 v_candidato:=v_integridade AND v_identidade AND v_qtd>0
   AND v_ultimo IN ('CONFIRMED','RECEIVED')
   AND v_reversoes=0 AND NOT v_revisao;
 v_classificacao:=CASE
   WHEN v_reversoes>0 THEN 'reversao_ou_disputa_irreversivel_sem_analise'
   WHEN NOT v_integridade OR NOT v_identidade THEN 'origens_ou_identidade_incompletas'
   WHEN v_recebimentos>0 AND v_ultimo NOT IN ('CONFIRMED','RECEIVED')
     THEN 'sequencia_de_estados_inconsistente'
   WHEN v_candidato THEN 'recebimento_observado_pendente_de_prova_e_conciliacao'
   ELSE 'aguardando_recebimento_verificado' END;

 RETURN pg_catalog.jsonb_build_object(
   'ok',true,'lote_id',p_lote,'comercio_id',v_lote.comercio_id,
   'valor_centavos',v_lote.total_centavos,'origens',v_origens->'origens',
   'integridade_contabil_ok',v_integridade,'identidade_local_ok',v_identidade,
   'eventos_observados',v_qtd,'eventos_de_recebimento',v_recebimentos,
   'eventos_de_reversao',v_reversoes,'ultimo_evento_id',v_ultimo_id,
   'ultimo_estado',v_ultimo,'classificacao',v_classificacao,
   'candidato_a_conferencia_manual',v_candidato,
   'exige_revisao',v_revisao,'prova_bancaria_autonoma',false,
   'pode_emitir_pix',false,'pode_quitar',false,'pode_estornar',false,
   'pode_liberar_motoboy',false
 );
END;
$apurar$;

REVOKE ALL ON FUNCTION public.catalogo_asaas_apurar_estados_acumulo_inerte(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_apurar_estados_acumulo_inerte(uuid)
 TO service_role;
COMMIT;
