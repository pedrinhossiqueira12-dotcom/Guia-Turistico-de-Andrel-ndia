-- COB-05 — SOMENTE STAGING jbttwihctuibchhcyqtl. NÃO EXECUTAR EM PRODUÇÃO.
-- Executar SOMENTE após validar Edge Secret ASAAS_WEBHOOK_WORKER_TOKEN,
-- Vault guia_asaas_webhook_worker_token_v1 e chamada HTTP autenticada com resposta 200.
-- URL pública está guardada no Vault; nenhum valor secreto deve ir para o SQL ou PR.
-- A consulta sem duas credenciais válidas não envia HTTP.
DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
  THEN RAISE EXCEPTION 'COB-05: pg_net/pg_cron não instalados'; END IF;
  IF (SELECT count(*) FROM vault.decrypted_secrets
       WHERE name IN ('guia_asaas_webhook_worker_url_v1',
                      'guia_asaas_webhook_worker_token_v1'))<>2
  THEN RAISE EXCEPTION 'COB-05: Vault requer URL e token exclusivo'; END IF;
  IF (SELECT decrypted_secret FROM vault.decrypted_secrets
      WHERE name='guia_asaas_webhook_worker_url_v1')
     IS DISTINCT FROM 'https://jbttwihctuibchhcyqtl.supabase.co/functions/v1/catalogo-asaas-financeiro/cron-webhooks'
  THEN RAISE EXCEPTION 'COB-05: URL do worker não é a de STAGING'; END IF;
  IF (SELECT length(decrypted_secret) FROM vault.decrypted_secrets
       WHERE name='guia_asaas_webhook_worker_token_v1')<48
  THEN RAISE EXCEPTION 'COB-05: token Vault inválido'; END IF;
  IF EXISTS (SELECT 1 FROM cron.job
      WHERE jobname='guia-asaas-reconciliar-webhook')
  THEN RAISE EXCEPTION 'COB-05: job já existe; não sobrescrever'; END IF;
END
$preflight$;

SELECT cron.schedule(
  'guia-asaas-reconciliar-webhook',
  '*/2 * * * *',
  $worker$
    WITH credenciais AS (
      SELECT max(decrypted_secret) FILTER (WHERE name='guia_asaas_webhook_worker_url_v1') AS url,
             max(decrypted_secret) FILTER (WHERE name='guia_asaas_webhook_worker_token_v1') AS token
      FROM vault.decrypted_secrets
      WHERE name IN ('guia_asaas_webhook_worker_url_v1','guia_asaas_webhook_worker_token_v1')
    )
    SELECT net.http_post(
      url := url,
      headers := jsonb_build_object('Content-Type','application/json',
                 'x-guia-asaas-worker-token',token),
      body := '{}'::jsonb,
      timeout_milliseconds := 12000
    ) FROM credenciais
    WHERE url='https://jbttwihctuibchhcyqtl.supabase.co/functions/v1/catalogo-asaas-financeiro/cron-webhooks'
      AND length(token)>=48;
  $worker$
);
-- Em emergência: SELECT cron.unschedule('guia-asaas-reconciliar-webhook');
-- Todos os comandos são exclusivos do STAGING. Não existe token em literal.
