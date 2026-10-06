-- Fechamento mensal automático de comissões offline.
-- A automação é instalada desligada e não cria cobranças externas.

CREATE TABLE IF NOT EXISTS public.catalogo_automacao_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  fechamento_offline_ativo boolean NOT NULL DEFAULT false,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.catalogo_automacao_config (id, fechamento_offline_ativo)
VALUES (true, false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.catalogo_automacao_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.catalogo_automacao_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.catalogo_automacao_config TO service_role;

CREATE OR REPLACE FUNCTION public.catalogo_processar_fechamentos_offline(
  p_data date DEFAULT CURRENT_DATE
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_competencia date := pg_catalog.date_trunc('month', p_data - interval '1 month')::date;
  v_comercio record;
  v_gerados integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.catalogo_automacao_config
    WHERE id = true AND fechamento_offline_ativo = true
  ) THEN
    RETURN 0;
  END IF;

  FOR v_comercio IN
    SELECT DISTINCT comercio_id
    FROM public.catalogo_comissoes_offline
    WHERE competencia = v_competencia
      AND status IN ('aberta', 'faturada')
  LOOP
    PERFORM public.catalogo_gerar_fechamento_offline(v_comercio.comercio_id, v_competencia);
    v_gerados := v_gerados + 1;
  END LOOP;

  PERFORM public.catalogo_bloquear_inadimplentes_offline();
  RETURN v_gerados;
END;
$$;

REVOKE ALL ON FUNCTION public.catalogo_processar_fechamentos_offline(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_processar_fechamentos_offline(date) TO service_role;

-- O agendamento é opcional: se a extensão pg_cron não estiver habilitada no projeto,
-- a migration registra o aviso e segue, sem abortar o restante da transação.
DO $$
DECLARE
  v_job record;
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron indisponível neste projeto: %. Habilite a extensão e recrie o agendamento depois.', SQLERRM;
    RETURN;
  END;

  BEGIN
    FOR v_job IN
      SELECT jobid FROM cron.job WHERE jobname = 'andrelandia-fechamento-offline-diario'
    LOOP
      PERFORM cron.unschedule(v_job.jobid);
    END LOOP;

    PERFORM cron.schedule(
      'andrelandia-fechamento-offline-diario',
      '15 3 * * *',
      $job$SELECT public.catalogo_processar_fechamentos_offline(CURRENT_DATE);$job$
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Não foi possível agendar o fechamento automático: %. Criar o agendamento manualmente depois.', SQLERRM;
  END;
END $$;
