-- Diagnostico forense de separacao excepcional SEM DESBLOQUEIO.
-- Nunca concede permissao para pagar, liberar, estornar ou cancelar.
-- Deve ser lido somente por service_role, por handler ADMIN autenticado.
BEGIN;

CREATE OR REPLACE FUNCTION public.catalogo_asaas_diagnosticar_separacao_excepcional(
 p_separacao uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $diagnostico$
DECLARE
 v_e public.catalogo_asaas_separacoes_excepcionais%ROWTYPE;
 v_solicitacao_estado text;
 v_solicitacao_valor bigint;
 v_solicitacao_uid uuid;
 v_itens bigint;
 v_valor bigint;
 v_hash text;
 v_invalidos bigint;
 v_banco bigint;
 v_banco_done bigint;
 v_saques_ativos bigint;
 v_outras_solicitacoes bigint;
 v_integridade boolean;
BEGIN
 IF p_separacao IS NULL THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Identificador de separacao ausente.');
 END IF;
 SELECT * INTO v_e
 FROM public.catalogo_asaas_separacoes_excepcionais
 WHERE id=p_separacao;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Separacao nao encontrada.');
 END IF;

 IF v_e.tipo='residual' THEN
  SELECT r.status,r.saldo_snapshot_centavos::bigint,r.motoboy_id
  INTO v_solicitacao_estado,v_solicitacao_valor,v_solicitacao_uid
  FROM public.catalogo_asaas_saldos_residuais r WHERE r.id=v_e.solicitacao_id;
 ELSE
  SELECT r.status,r.saldo_snapshot_centavos,r.motoboy_id
  INTO v_solicitacao_estado,v_solicitacao_valor,v_solicitacao_uid
  FROM public.catalogo_asaas_regularizacoes_inativos r WHERE r.id=v_e.solicitacao_id;
 END IF;

 -- Reconciliar cada ID: valor do item na separacao, remuneracao atual,
 -- beneficiario, ausencia de repasse e financiamento atual do pedido.
 -- A selecao usa todos os itens do titular, nunca uma pagina de 1000.
 SELECT count(*)::bigint,
        coalesce(sum(r.valor_centavos::bigint),0),
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
          pg_catalog.string_agg(r.id::text||':'||r.valor_centavos::text,
             '|' ORDER BY r.id),'UTF8')),'hex'),
        count(*) FILTER (WHERE
          i.valor_centavos IS DISTINCT FROM r.valor_centavos
          OR r.motoboy_id IS DISTINCT FROM v_e.motoboy_id
          OR r.status IS DISTINCT FROM 'disponivel'
          OR NOT r.financiamento_comprovado
          OR r.repasse_id IS NOT NULL
          OR NOT catalogo_private.catalogo_v2_financiado(r.pedido_id)
          OR EXISTS(
            SELECT 1 FROM public.catalogo_asaas_saque_itens si
            WHERE si.remuneracao_id=r.id AND si.ativo
          )
        )::bigint
 INTO v_itens,v_valor,v_hash,v_invalidos
 FROM public.catalogo_asaas_separacoes_excepcionais_itens i
 JOIN public.catalogo_remuneracoes_v2 r ON r.id=i.remuneracao_id
 WHERE i.separacao_id=v_e.id;

 SELECT count(*)::bigint,
  count(*) FILTER(WHERE o.estado_banco='DONE')::bigint
 INTO v_banco,v_banco_done
 FROM public.catalogo_asaas_transferencias_excepcionais_auditoria e
 LEFT JOIN public.catalogo_asaas_observacoes_excepcionais_auditoria o
  ON o.vinculo_id=e.id
 WHERE e.motoboy_id=v_e.motoboy_id;

 SELECT count(*)::bigint INTO v_saques_ativos
 FROM public.catalogo_asaas_saques s
 WHERE s.motoboy_id=v_e.motoboy_id
  AND s.status IN ('reservado','enviado','revisao');

 SELECT (
  (SELECT count(*) FROM public.catalogo_asaas_saldos_residuais r
   WHERE r.motoboy_id=v_e.motoboy_id
    AND r.status IN ('pendente','em_analise'))
  +
  (SELECT count(*) FROM public.catalogo_asaas_regularizacoes_inativos r
   WHERE r.motoboy_id=v_e.motoboy_id
    AND r.status IN ('pendente','em_analise'))
 )::bigint INTO v_outras_solicitacoes;

 v_integridade:=v_itens=v_e.creditos
  AND v_valor=v_e.valor_centavos
  AND v_hash IS NOT DISTINCT FROM v_e.fingerprint_sha256
  AND v_invalidos=0
  AND v_solicitacao_uid IS NOT DISTINCT FROM v_e.motoboy_id
  AND v_solicitacao_valor IS NOT DISTINCT FROM v_e.valor_centavos
  AND v_e.situacao='congelada';

 RETURN jsonb_build_object(
  'ok',true,
  'separacao_id',v_e.id,'tipo',v_e.tipo,'solicitacao_id',v_e.solicitacao_id,
  'motoboy_id',v_e.motoboy_id,
  'situacao_separacao',v_e.situacao,
  'situacao_solicitacao',v_solicitacao_estado,
  'saldo_separado_centavos',v_e.valor_centavos,
  'quantidade_esperada',v_e.creditos,
  'quantidade_encontrada',v_itens,
  'valor_dos_itens_centavos',v_valor,
  'fingerprint_esperada_sha256',v_e.fingerprint_sha256,
  'fingerprint_atual_sha256',v_hash,
  'creditos_financeiramente_invalidos',v_invalidos,
  'composicao_inalterada_e_financiada',v_integridade,
  'observacoes_bancarias_total',v_banco,
  'observacoes_done',v_banco_done,
  'saques_comuns_abertos',v_saques_ativos,
  'pedidos_administrativos_abertos',v_outras_solicitacoes,
  'exige_apuracao_bancaria_independente',true,
  'liberacao_automatica_autorizada',false,
  'quitacao_automatica_autorizada',false,
  'pode_reutilizar_creditos',false,
  'movimenta_dinheiro',false,
  'aviso',CASE
   WHEN v_banco>0 THEN 'Existe evidencia externa observada: HOLD ate apuracao do banco e titular.'
   WHEN NOT v_integridade THEN 'Divergencia ou reversao financeira: HOLD para apuracao.'
   ELSE 'Composicao congelada confere localmente; ainda falta prova externa de ausencia/liquidacao bancaria.'
   END
 );
END
$diagnostico$;

REVOKE ALL ON FUNCTION public.catalogo_asaas_diagnosticar_separacao_excepcional(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_diagnosticar_separacao_excepcional(uuid)
 TO service_role;
COMMENT ON FUNCTION public.catalogo_asaas_diagnosticar_separacao_excepcional(uuid) IS
 'Diagnostico forense somente leitura. Nao concede desbloqueio, pagamento ou estorno.';
COMMIT;
