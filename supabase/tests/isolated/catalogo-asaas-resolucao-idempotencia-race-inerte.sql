-- #43 CI-ONLY: livro de tentativas DOCUMENTAIS sob duas conexoes reais.
-- NUNCA incluir em migrations, Edge, STAGING ou PROD.
-- O database usado pelo CI e descartado no fim do job; o usuario nao pode
-- criar uma autorizacao de pagamento a partir de qualquer linha daqui.
DO $ci_guard$
BEGIN
 IF pg_catalog.current_database() IS DISTINCT FROM 'catalogo_asaas_race_ci'
 OR pg_catalog.current_setting('app.catalogo_ci_escrow_race_test',true)
    IS DISTINCT FROM 'enabled'
 THEN
  RAISE EXCEPTION 'Fixture CI #43 proibida fora do PostgreSQL descartavel.'
   USING ERRCODE='23514';
 END IF;
END $ci_guard$;

CREATE SCHEMA catalogo_ci_escrow_resolucao_inerte;
REVOKE ALL ON SCHEMA catalogo_ci_escrow_resolucao_inerte
 FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE catalogo_ci_escrow_resolucao_inerte.tentativas_documentais (
 tentativa_id uuid PRIMARY KEY,
 separacao_id uuid NOT NULL
  REFERENCES public.catalogo_asaas_separacoes_excepcionais(id) ON DELETE RESTRICT,
 fingerprint_sha256 text NOT NULL
  CHECK(fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
 classificacao text NOT NULL CHECK(classificacao IN ('revisao','contestacao')),
 criado_em timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 UNIQUE(separacao_id,fingerprint_sha256)
);
ALTER TABLE catalogo_ci_escrow_resolucao_inerte.tentativas_documentais
 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON catalogo_ci_escrow_resolucao_inerte.tentativas_documentais
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION catalogo_ci_escrow_resolucao_inerte.proibir_mutacao()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $immutable$
BEGIN
 RAISE EXCEPTION 'Livro CI #43 e append-only'
  USING ERRCODE='23514';
END
$immutable$;
CREATE TRIGGER no_update_delete
 BEFORE UPDATE OR DELETE ON
 catalogo_ci_escrow_resolucao_inerte.tentativas_documentais
 FOR EACH ROW EXECUTE FUNCTION
 catalogo_ci_escrow_resolucao_inerte.proibir_mutacao();

CREATE FUNCTION catalogo_ci_escrow_resolucao_inerte.registrar_tentativa(
 p_separacao uuid,p_tentativa uuid,p_fingerprint text,p_classificacao text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''
AS $register$
DECLARE
 v_escrow public.catalogo_asaas_separacoes_excepcionais%ROWTYPE;
 v_uid uuid;
 v_existente catalogo_ci_escrow_resolucao_inerte.tentativas_documentais%ROWTYPE;
 v_versao catalogo_ci_escrow_resolucao_inerte.tentativas_documentais%ROWTYPE;
 v_ok boolean;
 v_replay boolean:=false;
 v_motivo text:='HOLD_REVISAO_DOCUMENTAL';
BEGIN
 -- Nao expor identificadores recebidos em nenhuma resposta.
 IF p_separacao IS NULL OR p_tentativa IS NULL
 OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$'
 OR p_classificacao NOT IN ('revisao','contestacao')
 OR p_classificacao IS NULL THEN
  RETURN jsonb_build_object('ok',false,'motivo','entrada_invalida',
   'status_operacional','HOLD_OBRIGATORIO','movimenta_dinheiro',false,
   'pagamento_autorizado',false,'liberacao_autorizada',false,'baixa_realizada',false);
 END IF;

 SELECT e.motoboy_id INTO v_uid
 FROM public.catalogo_asaas_separacoes_excepcionais e
 WHERE e.id=p_separacao;
 IF v_uid IS NULL THEN
  RETURN jsonb_build_object('ok',false,'motivo','reserva_inexistente',
   'status_operacional','HOLD_OBRIGATORIO','movimenta_dinheiro',false,
   'pagamento_autorizado',false,'liberacao_autorizada',false,'baixa_realizada',false);
 END IF;
 -- Mesma ordenacao de locks da reserva/saque comum/preview:
 -- titular, depois reserva. Bloqueio antes de olhar para UNIQUE.
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('asaas-saque:'||v_uid::text,0));
 SELECT * INTO v_escrow
 FROM public.catalogo_asaas_separacoes_excepcionais
 WHERE id=p_separacao FOR UPDATE;
 IF NOT FOUND OR v_escrow.motoboy_id IS DISTINCT FROM v_uid
 OR v_escrow.situacao IS DISTINCT FROM 'congelada'
 OR v_escrow.fingerprint_sha256 IS DISTINCT FROM p_fingerprint THEN
  RETURN jsonb_build_object('ok',false,'motivo','escrow_ou_versao_invalida',
   'status_operacional','HOLD_OBRIGATORIO','movimenta_dinheiro',false,
   'pagamento_autorizado',false,'liberacao_autorizada',false,'baixa_realizada',false);
 END IF;

 SELECT * INTO v_existente FROM
 catalogo_ci_escrow_resolucao_inerte.tentativas_documentais
 WHERE tentativa_id=p_tentativa;
 IF FOUND THEN
  v_ok:=v_existente.separacao_id=p_separacao
   AND v_existente.fingerprint_sha256=p_fingerprint
   AND v_existente.classificacao=p_classificacao;
  v_replay:=v_ok;
  v_motivo:=CASE WHEN v_ok THEN 'replay_idempotente_documental'
   ELSE 'tentativa_reutilizada_com_outros_dados' END;
 ELSE
  SELECT * INTO v_versao FROM
  catalogo_ci_escrow_resolucao_inerte.tentativas_documentais
  WHERE separacao_id=p_separacao AND fingerprint_sha256=p_fingerprint;
  IF FOUND THEN
   v_ok:=false;
   v_motivo:='outra_tentativa_ja_registrada_na_mesma_versao';
  ELSE
   INSERT INTO catalogo_ci_escrow_resolucao_inerte.tentativas_documentais(
    tentativa_id,separacao_id,fingerprint_sha256,classificacao
   ) VALUES(p_tentativa,p_separacao,p_fingerprint,p_classificacao);
   v_ok:=true;
   v_motivo:='documento_inerte_registrado';
  END IF;
 END IF;

 RETURN jsonb_build_object('ok',v_ok,'replay',v_replay,'motivo',v_motivo,
  'status_operacional','HOLD_OBRIGATORIO',
  'beneficiario_original_confirmado',false,
  'ausencia_pix_anterior_comprovada',false,
  'revisores_mfa_confirmados',false,
  'movimenta_dinheiro',false,'pagamento_autorizado',false,
  'liberacao_autorizada',false,'baixa_realizada',false);
END
$register$;

REVOKE ALL ON FUNCTION
 catalogo_ci_escrow_resolucao_inerte.registrar_tentativa(uuid,uuid,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION
 catalogo_ci_escrow_resolucao_inerte.proibir_mutacao()
 FROM PUBLIC,anon,authenticated,service_role;
-- Nao conceder GRANT a ninguem. CI postgres owner somente.
