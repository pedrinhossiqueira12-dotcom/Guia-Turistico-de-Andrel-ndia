-- Exportação de manifesto para guardar FORA do Supabase.
-- Sem upload externo automático e SEM liquidar ou desbloquear créditos.
-- O hash local só torna útil uma cópia efetivamente arquivada por um operador.
BEGIN;
CREATE OR REPLACE FUNCTION public.catalogo_asaas_exportar_ancora_dossie(
 p_separacao uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $export$
DECLARE
 v_e public.catalogo_asaas_separacoes_excepcionais%ROWTYPE;
 v_verificacao jsonb;
 v_financeiro jsonb;
 v_eventos jsonb;
 v_count bigint;
 v_end_hash text;
 v_canon text;
 v_sha text;
 v_financiado text;
 v_banco text;
 v_done text;
BEGIN
 IF p_separacao IS NULL THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Separação inválida.');
 END IF;
 SELECT * INTO v_e
 FROM public.catalogo_asaas_separacoes_excepcionais
 WHERE id=p_separacao;
 IF NOT FOUND THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Separação não encontrada.');
 END IF;

 v_verificacao:=public.catalogo_asaas_verificar_integridade_dossie_escrow(p_separacao);
 IF v_verificacao->>'ok' IS DISTINCT FROM 'true'
 OR v_verificacao->>'integridade_valida' IS DISTINCT FROM 'true'
 OR v_verificacao->>'pagamento_autorizado' IS DISTINCT FROM 'false'
 OR v_verificacao->>'liberacao_autorizada' IS DISTINCT FROM 'false' THEN
  RETURN jsonb_build_object('ok',false,
   'mensagem','Histórico inconsistente: exportação de âncora recusada. Manter HOLD.');
 END IF;

 v_financeiro:=public.catalogo_asaas_diagnosticar_separacao_excepcional(p_separacao);
 IF v_financeiro->>'ok' IS DISTINCT FROM 'true'
 OR v_financeiro->>'liberacao_automatica_autorizada' IS DISTINCT FROM 'false'
 OR v_financeiro->>'quitacao_automatica_autorizada' IS DISTINCT FROM 'false'
 THEN
  RETURN jsonb_build_object('ok',false,
   'mensagem','Diagnóstico financeiro inválido: exportação recusada.');
 END IF;

 -- Nenhum LIMIT. Exportar toda a cadeia ou recusar a operação; jamais
 -- truncar silenciosamente. A lista contém SOMENTE hashes e sequências,
 -- sem notas, documentos originais, chaves Pix ou CPF.
 SELECT count(*)::bigint,
   coalesce(jsonb_agg(jsonb_build_object(
     'seq',e.seq,
     'hash_anterior_sha256',e.hash_anterior_sha256,
     'evento_sha256',e.evento_sha256
   ) ORDER BY e.seq),'[]'::jsonb)
 INTO v_count,v_eventos
 FROM public.catalogo_asaas_escrow_dossie_eventos e
 WHERE e.separacao_id=p_separacao;

 IF v_count IS DISTINCT FROM (v_verificacao->>'numero_eventos')::bigint
 THEN
  RETURN jsonb_build_object('ok',false,
   'mensagem','Histórico mudou durante a consulta. Exportação recusada.');
 END IF;
 v_end_hash:=coalesce(v_verificacao->>'hash_final_registrado_sha256',repeat('0',64));
 v_financiado:=coalesce(v_financeiro->>'composicao_inalterada_e_financiada','false');
 v_banco:=coalesce(v_financeiro->>'observacoes_bancarias_total','0');
 v_done:=coalesce(v_financeiro->>'observacoes_done','0');

 -- Formato rigorosamente documentado. Todos os campos têm domínio fixo
 -- ou formato decimal/UUID, sem conteúdo livre nem ambiguidades de separador.
 -- Reproduzível por scripts/verificar-ancora-escrow.cjs sem Supabase.
 v_canon:='GAESCROW1|'||v_e.id::text||'|'||v_e.tipo||'|'||
  v_e.solicitacao_id::text||'|'||v_e.motoboy_id::text||'|'||
  v_e.valor_centavos::text||'|'||v_e.creditos::text||'|'||
  v_e.fingerprint_sha256||'|'||v_count::text||'|'||v_end_hash||'|'||
  v_financiado||'|'||v_banco||'|'||v_done;
 v_sha:=pg_catalog.encode(pg_catalog.sha256(
  pg_catalog.convert_to(v_canon,'UTF8')),'hex');

 RETURN jsonb_build_object(
  'ok',true,'formato','GAESCROW1',
  'separacao_id',v_e.id,'tipo',v_e.tipo,
  'solicitacao_id',v_e.solicitacao_id,'motoboy_id',v_e.motoboy_id,
  'valor_centavos',v_e.valor_centavos,'creditos',v_e.creditos,
  'fingerprint_creditos_sha256',v_e.fingerprint_sha256,
  'eventos_total',v_count,'hash_final_dossie_sha256',v_end_hash,
  'creditos_atuais_integros',v_financiado='true',
  'observacoes_bancarias_total',v_banco::bigint,
  'observacoes_done',v_done::bigint,
  'eventos_hashes',v_eventos,
  'hash_ancora_sha256',v_sha,
  'cadeia_verificada_localmente',true,
  'ancora_externa_efetuada',false,
  'pagamento_autorizado',false,
  'liberacao_autorizada',false,
  'baixa_realizada',false,
  'aviso','Exportação não arquivada automaticamente: só se torna referência externa após ser guardada independentemente do Supabase. Não comprova transferência bancária.'
 );
END $export$;
REVOKE ALL ON FUNCTION public.catalogo_asaas_exportar_ancora_dossie(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_exportar_ancora_dossie(uuid)
 TO service_role;
COMMENT ON FUNCTION public.catalogo_asaas_exportar_ancora_dossie(uuid) IS
 'Exportação somente leitura de hashes para arquivo independente; sem prova bancária nem liquidação.';
COMMIT;
