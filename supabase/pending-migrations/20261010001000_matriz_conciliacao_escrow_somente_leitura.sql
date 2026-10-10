-- Etapa #41: matriz de conflitos bancários, exclusivamente LEITURA.
-- Nenhuma observação do Asaas substitui confirmação do destinatário.
-- GET bancário não autoriza pagar, liquidar, desbloquear ou reutilizar crédito.
BEGIN;

CREATE OR REPLACE FUNCTION public.catalogo_asaas_matriz_conciliacao_escrow(
 p_separacao uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $matriz$
DECLARE
 v_e public.catalogo_asaas_separacoes_excepcionais%ROWTYPE;
 v_financeiro jsonb;
 v_integridade jsonb;
 v_total bigint;
 v_observacoes bigint;
 v_sem_observacao bigint;
 v_com_done bigint;
 v_processando bigint;
 v_com_falha bigint;
 v_estados_incompativeis bigint;
 v_estado_desconhecido bigint;
 v_referencias_invalidas bigint;
 v_valores_invalidos bigint;
 v_titulares_invalidos bigint;
 v_snapshot_suspeito bigint;
 v_compartilhadas_saque bigint;
 v_conflitos bigint;
 v_referencia text;
BEGIN
 IF p_separacao IS NULL THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Separação não informada.');
 END IF;
 SELECT * INTO v_e
 FROM public.catalogo_asaas_separacoes_excepcionais
 WHERE id=p_separacao;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Separação não encontrada.');
 END IF;

 -- Nao assumir que um saldo congelado continua financiado e íntegro.
 v_financeiro:=public.catalogo_asaas_diagnosticar_separacao_excepcional(p_separacao);
 v_integridade:=public.catalogo_asaas_verificar_integridade_dossie_escrow(p_separacao);
 v_referencia:='guia-exc:'||v_e.tipo||':'||v_e.solicitacao_id::text;

 -- No máximo uma evidência de transferência por tipo/solicitação hoje,
 -- mas os contadores conferem TODAS as observações, sem paginação.
 -- e.transferencia_id e unica no histórico excepcional, porém pode
 -- se repetir na tabela de saques ordinários: isso exige alerta.
 SELECT
  count(*)::bigint,
  coalesce(sum(o.quantidade),0)::bigint,
  count(*) FILTER(WHERE o.quantidade=0)::bigint,
  count(*) FILTER(WHERE o.tem_done)::bigint,
  count(*) FILTER(WHERE o.tem_processamento)::bigint,
  count(*) FILTER(WHERE o.tem_falha)::bigint,
  count(*) FILTER(WHERE o.tem_done AND o.tem_falha)::bigint,
  count(*) FILTER(WHERE o.tem_desconhecido)::bigint,
  count(*) FILTER(WHERE e.referencia_externa IS DISTINCT FROM v_referencia)::bigint,
  count(*) FILTER(WHERE e.valor_centavos IS DISTINCT FROM v_e.valor_centavos)::bigint,
  count(*) FILTER(WHERE e.motoboy_id IS DISTINCT FROM v_e.motoboy_id)::bigint,
  count(*) FILTER(WHERE e.creditos_fingerprint_observado_sha256 IS NULL
   OR e.creditos_fingerprint_observado_sha256 IS DISTINCT FROM v_e.fingerprint_sha256
   OR e.creditos_observados IS DISTINCT FROM v_e.creditos
   OR e.valor_creditos_observados_centavos IS DISTINCT FROM v_e.valor_centavos
   OR e.composicao_conferida_na_observacao IS DISTINCT FROM true)::bigint,
  count(*) FILTER(WHERE EXISTS(
   SELECT 1 FROM public.catalogo_asaas_saques s
   WHERE s.transferencia_id=e.transferencia_id
  ))::bigint
 INTO
  v_total,v_observacoes,v_sem_observacao,v_com_done,
  v_processando,v_com_falha,v_estados_incompativeis,v_estado_desconhecido,
  v_referencias_invalidas,v_valores_invalidos,v_titulares_invalidos,
  v_snapshot_suspeito,v_compartilhadas_saque
 FROM public.catalogo_asaas_transferencias_excepcionais_auditoria e
 CROSS JOIN LATERAL (
  SELECT count(*)::bigint AS quantidade,
   coalesce(bool_or(o.estado_banco='DONE'),false) AS tem_done,
   coalesce(bool_or(o.estado_banco IN('PENDING','IN_BANK_PROCESSING','BLOCKED')),false)
    AS tem_processamento,
   coalesce(bool_or(o.estado_banco IN('FAILED','CANCELLED')),false) AS tem_falha,
   coalesce(bool_or(o.estado_banco NOT IN(
    'PENDING','IN_BANK_PROCESSING','BLOCKED','DONE','FAILED','CANCELLED')),false)
    AS tem_desconhecido
  FROM public.catalogo_asaas_observacoes_excepcionais_auditoria o
  WHERE o.vinculo_id=e.id
 ) o
 WHERE e.tipo=v_e.tipo AND e.solicitacao_id=v_e.solicitacao_id;

 v_conflitos:=v_sem_observacao+v_estados_incompativeis+v_estado_desconhecido+
  v_referencias_invalidas+v_valores_invalidos+v_titulares_invalidos+
  v_snapshot_suspeito+v_compartilhadas_saque;

 RETURN jsonb_build_object(
  'ok',true,'separacao_id',v_e.id,'tipo',v_e.tipo,
  'solicitacao_id',v_e.solicitacao_id,
  'transferencias_observadas',v_total,
  'observacoes_de_estado',v_observacoes,
  'transferencias_sem_estado_observado',v_sem_observacao,
  'transferencias_com_done',v_com_done,
  'transferencias_ainda_em_processamento_observadas',v_processando,
  'transferencias_com_falha_ou_cancelamento',v_com_falha,
  'transferencias_com_done_e_falha',v_estados_incompativeis,
  'transferencias_estado_desconhecido',v_estado_desconhecido,
  'referencias_divergentes',v_referencias_invalidas,
  'valores_divergentes',v_valores_invalidos,
  'titulares_divergentes',v_titulares_invalidos,
  'fotografias_creditos_incompletas_ou_divergentes',v_snapshot_suspeito,
  'transferencias_tambem_vinculadas_a_saques_comuns',v_compartilhadas_saque,
  'contagem_sinais_de_conflito',v_conflitos,
  'creditos_conferidos_agora',coalesce(
   (v_financeiro->>'composicao_inalterada_e_financiada')::boolean,false),
  'dossie_integro_agora',coalesce(
   (v_integridade->>'integridade_valida')::boolean,false),
  'destino_pix_original_vinculado_com_prova',false,
  'destino_pix_confirmado_no_provedor',false,
  'ausencia_de_pix_anterior_comprovada',false,
  'evidencia_suficiente_para_liquidar',false,
  'evidencia_suficiente_para_liberar',false,
  'pagamento_autorizado',false,
  'baixa_realizada',false,
  'movimenta_dinheiro',false,
  'exige_apuracao_bancaria_independente',true,
  'alerta',CASE
   WHEN v_conflitos>0 THEN
    'Divergência de evidência detectada. Manter HOLD e apurar com provedor.'
   WHEN v_com_done>0 THEN
    'Banco observou DONE, mas não há prova de destino original. Manter HOLD.'
   WHEN v_total=0 THEN
    'Nenhum GET vinculado: ausência de evidência não comprova que não houve Pix. Manter HOLD.'
   ELSE 'GET bancário registrado sem prova suficiente de beneficiário e liquidação. Manter HOLD.'
  END
 );
END
$matriz$;

REVOKE ALL ON FUNCTION public.catalogo_asaas_matriz_conciliacao_escrow(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_matriz_conciliacao_escrow(uuid)
 TO service_role;
COMMENT ON FUNCTION public.catalogo_asaas_matriz_conciliacao_escrow(uuid) IS
 'Matriz forense de evidências financeiras; somente leitura, nenhuma baixa/liberação/Pix.';
COMMIT;
