-- Reversible hourly inventory only. This migration does not delete Storage objects.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Create a high-entropy shared token once; never return or log its value.
DO $$
DECLARE cleanup_token text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.secrets WHERE name = 'andrelandia_storage_cleanup_token'
  ) THEN
    cleanup_token := replace(gen_random_uuid()::text, '-', '')
      || replace(gen_random_uuid()::text, '-', '');
    PERFORM vault.create_secret(
      cleanup_token,
      'andrelandia_storage_cleanup_token',
      'Internal authentication for the Andrelândia Storage retention dry-run Edge Function'
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.is_storage_cleanup_authorized(p_token text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, vault
AS $$
  SELECT p_token IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM vault.decrypted_secrets
      WHERE name = 'andrelandia_storage_cleanup_token'
        AND decrypted_secret = p_token
    );
$$;
REVOKE ALL ON FUNCTION public.is_storage_cleanup_authorized(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_storage_cleanup_authorized(text) TO service_role;

-- Replace only this named job if the migration is re-applied.
DO $$
DECLARE existing_job record;
BEGIN
  FOR existing_job IN
    SELECT jobid FROM cron.job WHERE jobname = 'andrelandia-storage-retention-dry-run'
  LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'andrelandia-storage-retention-dry-run',
    '0 * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://xdmbkflufsfqziixzpxc.supabase.co/functions/v1/storage-cleanup',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cleanup-token', (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'andrelandia_storage_cleanup_token'
            LIMIT 1
          )
        ),
        body := '{"mode":"dry-run"}'::jsonb,
        timeout_milliseconds := 30000
      ) AS request_id;
    $cron$
  );
END $$;
