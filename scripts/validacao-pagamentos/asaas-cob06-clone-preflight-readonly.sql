-- COB-06: inventario SOMENTE LEITURA de potencial clonagem/backup.
-- Pode rodar em PROD e STAGING. NAO acessa cron.command, Vault, tokens ou dados pessoais.
-- Clone fisico pode executar pg_cron/pg_net de imediato: isolar rede ANTES do clone.
-- Nao desativar jobs aqui.

SELECT pg_catalog.current_setting('server_version') AS postgres_version,
       pg_catalog.current_database() AS database_name,
       (SELECT count(*) FROM supabase_migrations.schema_migrations) AS versoes_registradas,
       (SELECT max(version) FROM supabase_migrations.schema_migrations) AS ultima_versao,
       (SELECT coalesce(jsonb_agg(extname ORDER BY extname),'[]'::jsonb)
        FROM pg_catalog.pg_extension WHERE extname IN ('pg_cron','pg_net','vault')) AS extensoes_de_automacao,
       (SELECT count(*) FROM cron.job WHERE active) AS crons_ativos,
       (SELECT count(*) FROM cron.job) AS crons_cadastrados,
       pg_catalog.to_regclass('public.catalogo_asaas_webhook_eventos') IS NOT NULL AS webhook_asaas_instalado;

-- Somente identificador, frequência e status; nunca comando (pode conter segredos).
SELECT jobid,jobname,active,schedule
FROM cron.job
ORDER BY jobid;

-- NAO comprova backups no provedor. Conferir Database > Backups no Dashboard.
