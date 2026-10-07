-- Monitor da aplicação, sem invocações Manus, transferências ou confirmação automática.
-- Preserva jobs existentes. Em implantação inicial, fica inativo até a validação do piloto.
DO $monitor$
DECLARE v_job bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron' LIMIT 1)
     OR to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron indisponível neste ambiente; o monitor não foi agendado.';
    RETURN;
  END IF;
  SELECT jobid INTO v_job FROM cron.job WHERE jobname='catalogo-entregas-v2-monitor' LIMIT 1;
  IF v_job IS NULL THEN
    SELECT cron.schedule(
      'catalogo-entregas-v2-monitor',
      '*/15 * * * *',
      'SELECT public.catalogo_reavaliar_confiabilidade_v2() LIMIT 1;'
    ) INTO v_job;
    PERFORM cron.alter_job(v_job, active := false);
  END IF;
END;
$monitor$;
