-- COB-06: CANDIDATO de agendamento PROD. NAO EXECUTAR nesta etapa.
-- Projeto ALVO unico: xdmbkflufsfqziixzpxc (prod). Nunca STAGING.
-- NAO faz pagamentos, nao ativa ASAAS_BILLING_ENABLED, nao cria Pix.
-- Depende da inbox instalada pelos 9 SQLs, Edge financeira publicada com
-- billing OFF e secretos produtivos configurados e conferidos separadamente.
-- FONTE NAO incluida em supabase/migrations nem no lock de 9 SQLs.
-- Antes de execucao futura: backup/restauracao conferidos; plano de parada;
-- revisao dos grants, credenciais, webhooks e autorizacao de implantacao.
BEGIN;
DO $preflight_prod_worker$
DECLARE
  v_url text;
  v_token_length integer;
BEGIN
  IF pg_catalog.current_database() IS DISTINCT FROM 'postgres'
  THEN RAISE EXCEPTION 'COB06_WORKER_PROD: banco inesperado'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_extension WHERE extname='pg_cron')
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_extension WHERE extname='pg_net')
  THEN RAISE EXCEPTION 'COB06_WORKER_PROD: pg_cron/pg_net ausentes'; END IF;
  IF pg_catalog.to_regclass('public.catalogo_asaas_webhook_eventos') IS NULL
    OR pg_catalog.to_regprocedure(
      'public.catalogo_asaas_webhook_claim(integer)') IS NULL
    OR pg_catalog.to_regprocedure(
      'public.catalogo_asaas_webhook_finalizar(text,uuid,boolean)') IS NULL
  THEN RAISE EXCEPTION 'COB06_WORKER_PROD: inbox ou RPCs ausentes'; END IF;
  IF (SELECT count(*) FROM vault.secrets WHERE name IN (
    'guia_asaas_webhook_worker_url_prod_v1',
    'guia_asaas_webhook_worker_token_prod_v1'
  )) IS DISTINCT FROM 2
  THEN RAISE EXCEPTION 'COB06_WORKER_PROD: registros Vault ausentes'; END IF;
  -- O valor descriptografado NUNCA e selecionado na saida nem no comando
  -- armazenado em cron.job: so checado aqui e lido pelo job em runtime.
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets
  WHERE name='guia_asaas_webhook_worker_url_prod_v1';
  SELECT length(decrypted_secret) INTO v_token_length
  FROM vault.decrypted_secrets
  WHERE name='guia_asaas_webhook_worker_token_prod_v1';
  IF v_url IS DISTINCT FROM
    'https://xdmbkflufsfqziixzpxc.supabase.co/functions/v1/catalogo-asaas-financeiro/cron-webhooks'
    OR v_token_length IS NULL OR v_token_length<48
  THEN RAISE EXCEPTION 'COB06_WORKER_PROD: URL ou token incorreto'; END IF;
  IF EXISTS(SELECT 1 FROM cron.job
    WHERE jobname='guia-asaas-reconciliar-webhook')
  THEN RAISE EXCEPTION 'COB06_WORKER_PROD: agendamento existente; nao sobrescrever'; END IF;
END
$preflight_prod_worker$;

SELECT cron.schedule(
  'guia-asaas-reconciliar-webhook',
  '*/2 * * * *',
  $worker_prod$
    WITH credenciais AS (
      SELECT max(decrypted_secret) FILTER
        (WHERE name='guia_asaas_webhook_worker_url_prod_v1') AS url,
        max(decrypted_secret) FILTER
        (WHERE name='guia_asaas_webhook_worker_token_prod_v1') AS token
      FROM vault.decrypted_secrets
      WHERE name IN ('guia_asaas_webhook_worker_url_prod_v1',
                     'guia_asaas_webhook_worker_token_prod_v1')
    )
    SELECT net.http_post(
      url := url,
      headers := jsonb_build_object('Content-Type','application/json',
                    'x-guia-asaas-worker-token',token),
      body := '{}'::jsonb,
      timeout_milliseconds := 12000
    ) FROM credenciais
    WHERE url =
      'https://xdmbkflufsfqziixzpxc.supabase.co/functions/v1/catalogo-asaas-financeiro/cron-webhooks'
      AND length(token)>=48;
  $worker_prod$
);
COMMIT;
-- Parada futura SOMENTE com revisao operacional:
-- SELECT cron.unschedule('guia-asaas-reconciliar-webhook');
-- Nao fazer rollback destrutivo de tabelas/eventos financeiros.
