-- COB-05 SOMENTE STAGING: ensaio transacional da fila do PostgreSQL, SEM chamar Asaas.
-- Dados de teste só existem nesta transação e são DESCARTADOS pelo ROLLBACK.
-- NÃO conta como prova de recuperação de evento legítimo no Cron ao vivo.
BEGIN;
DO $cob05$
DECLARE
  v_id text := 'evt_cob05_tx_' || replace(pg_catalog.gen_random_uuid()::text,'-','');
  v_received jsonb;
  v_claim jsonb;
  v_first uuid;
  v_second uuid;
  v_done jsonb;
  v_row public.catalogo_asaas_webhook_eventos%ROWTYPE;
BEGIN
  -- Impedir que a simulação reivindique algum evento real em processamento.
  IF EXISTS (SELECT 1 FROM public.catalogo_asaas_webhook_eventos
             WHERE estado <> 'concluido') THEN
    RAISE EXCEPTION 'COB-05: fila real não está vazia; ensaio cancelado';
  END IF;
  v_received := public.catalogo_asaas_webhook_receber(
    v_id,'PAYMENT_RECEIVED','pay_cob05_tx_nao_real', 'teste-somente-transacao'
  );
  IF v_received->>'ok' <> 'true' OR v_received->>'novo' <> 'true' THEN
    RAISE EXCEPTION 'Falha ao registrar evento de teste descartável: %',v_received;
  END IF;
  v_claim := public.catalogo_asaas_webhook_claim(1);
  IF jsonb_array_length(v_claim) <> 1 OR v_claim->0->>'id' <> v_id THEN
    RAISE EXCEPTION 'Claim inicial inesperado: %',v_claim;
  END IF;
  v_first := (v_claim->0->>'tentativa_token')::uuid;
  v_done := public.catalogo_asaas_webhook_finalizar(v_id,v_first,false);
  IF v_done->>'ok' <> 'true' THEN
    RAISE EXCEPTION 'Falha no registro de erro: %',v_done;
  END IF;
  SELECT * INTO STRICT v_row FROM public.catalogo_asaas_webhook_eventos
    WHERE id=v_id;
  IF v_row.estado <> 'erro' OR v_row.tentativas<>1
    OR v_row.proxima_tentativa_em < pg_catalog.clock_timestamp()+interval '25 seconds'
    OR v_row.proxima_tentativa_em > pg_catalog.clock_timestamp()+interval '35 seconds'
  THEN RAISE EXCEPTION 'Backoff inicial não é cerca de 30 segundos'; END IF;
  v_claim := public.catalogo_asaas_webhook_claim(1);
  IF v_claim <> '[]'::jsonb THEN
    RAISE EXCEPTION 'Worker consumiu evento antes do backoff: %',v_claim;
  END IF;
  v_done := public.catalogo_asaas_webhook_finalizar(v_id,v_first,true);
  IF v_done->>'ok' <> 'false' THEN
    RAISE EXCEPTION 'Token não reservado finalizou evento em erro';
  END IF;
  -- Adianta apenas o relógio lógico do evento TRANSACIONAL para testar a retentativa.
  UPDATE public.catalogo_asaas_webhook_eventos
     SET proxima_tentativa_em=pg_catalog.clock_timestamp()-interval '1 second'
   WHERE id=v_id AND estado='erro';
  v_claim := public.catalogo_asaas_webhook_claim(1);
  IF jsonb_array_length(v_claim)<>1 OR v_claim->0->>'id'<>v_id THEN
    RAISE EXCEPTION 'Evento não foi capturado na retentativa: %',v_claim;
  END IF;
  v_second := (v_claim->0->>'tentativa_token')::uuid;
  IF v_second=v_first THEN
    RAISE EXCEPTION 'Lease reutilizada após falha';
  END IF;
  v_done := public.catalogo_asaas_webhook_finalizar(v_id,v_first,true);
  IF v_done->>'ok'<>'false' THEN
    RAISE EXCEPTION 'Token de tentativa anterior ainda aceita';
  END IF;
  v_done := public.catalogo_asaas_webhook_finalizar(v_id,v_second,true);
  IF v_done->>'ok'<>'true' THEN
    RAISE EXCEPTION 'Não foi possível concluir após retentativa';
  END IF;
  SELECT * INTO STRICT v_row FROM public.catalogo_asaas_webhook_eventos
    WHERE id=v_id;
  IF v_row.estado<>'concluido' OR v_row.tentativas<>2
    OR v_row.tentativa_token IS NOT NULL
    OR v_row.proxima_tentativa_em IS NOT NULL
  THEN RAISE EXCEPTION 'Estado final incorreto'; END IF;
  v_received := public.catalogo_asaas_webhook_receber(
    v_id,'PAYMENT_RECEIVED','pay_cob05_tx_nao_real', 'teste-somente-transacao'
  );
  IF v_received->>'duplicado'<>'true' THEN
    RAISE EXCEPTION 'Recepção idempotente falhou após conclusão';
  END IF;
  v_claim := public.catalogo_asaas_webhook_claim(1);
  IF v_claim <> '[]'::jsonb THEN
    RAISE EXCEPTION 'Evento concluído foi reivindicado novamente';
  END IF;
  RAISE NOTICE 'COB-05: PASSOU fluxo de erro, backoff, novo lease, sucesso e idempotência (transação revertida).';
END
$cob05$;
SELECT 'PASSOU: backoff real da RPC e retentativa; dados fictícios não persistirão' AS diagnostico;
ROLLBACK;
