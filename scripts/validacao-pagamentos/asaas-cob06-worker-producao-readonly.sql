-- COB-06: gate OPERACIONAL read-only para reconciliacao Asaas PROD.
-- EXECUTAR SOMENTE no projeto xdmbkflufsfqziixzpxc, via SQL Editor,
-- apos verificar o projeto no Dashboard. Nunca altera schema, jobs ou segredos.
-- Nao retorna comando do cron, URL privada, tokens, IDs pessoais ou faturas.
-- Mesmo "infra_pronta=true" nao equivale a go-live / backup restaurado.
WITH estado AS (
 SELECT
  EXISTS(SELECT 1 FROM pg_catalog.pg_extension WHERE extname='pg_cron')
    AS tem_pg_cron,
  EXISTS(SELECT 1 FROM pg_catalog.pg_extension WHERE extname='pg_net')
    AS tem_pg_net,
  pg_catalog.to_regclass('vault.secrets') IS NOT NULL
    AS vault_disponivel,
  pg_catalog.to_regclass('public.catalogo_asaas_webhook_eventos') IS NOT NULL
    AS inbox_instalada,
  pg_catalog.to_regprocedure('public.catalogo_asaas_webhook_claim(integer)') IS NOT NULL
    AS rpc_claim_instalada,
  pg_catalog.to_regprocedure('public.catalogo_asaas_webhook_finalizar(text,uuid,boolean)') IS NOT NULL
    AS rpc_finalizar_instalada
), jobs AS (
 SELECT count(*) AS cadastrados,
  count(*) FILTER (WHERE active) AS ativos,
  count(*) FILTER (WHERE active AND schedule='*/2 * * * *') AS horario_correto
 FROM cron.job WHERE jobname='guia-asaas-reconciliar-webhook'
), vault_meta AS (
 -- SOMENTE NOMES E CONTAGEM: nunca ler/imprimir decrypted_secret.
 SELECT count(*) FILTER
   (WHERE name='guia_asaas_webhook_worker_url_prod_v1') AS urls,
  count(*) FILTER
   (WHERE name='guia_asaas_webhook_worker_token_prod_v1') AS tokens
 FROM vault.secrets
), resultado AS (
 SELECT e.*,j.cadastrados=1 AND j.ativos=1 AND j.horario_correto=1
    AS worker_cron_pronto,
  v.urls=1 AND v.tokens=1 AS nomes_vault_prontos,
  j.cadastrados AS jobs_worker_cadastrados
 FROM estado e CROSS JOIN jobs j CROSS JOIN vault_meta v
)
SELECT *,
 (tem_pg_cron AND tem_pg_net AND vault_disponivel AND
  inbox_instalada AND rpc_claim_instalada AND rpc_finalizar_instalada
  AND worker_cron_pronto AND nomes_vault_prontos) AS infra_pronta,
 false AS producao_autorizada,
 false AS pagamentos_ativados_por_esta_consulta
FROM resultado;
