-- COB-06: auditoria SOMENTE LEITURA no clone/STAGING/produção, sem segredos.
-- Checa proteções que o gate estrutural anterior não verificava.
WITH expected_tables(name) AS (
 VALUES ('catalogo_asaas_clientes'),('catalogo_asaas_emissoes'),
 ('catalogo_asaas_webhook_eventos'),('catalogo_cobranca_preferencias'),
 ('catalogo_aceites_operacionais'),('catalogo_encerramentos_comercio')
), t AS (
 SELECT e.name,c.oid,coalesce(c.relrowsecurity,false) AS rls,
 CASE WHEN c.oid IS NOT NULL THEN
   NOT has_table_privilege('anon',c.oid,'SELECT')
   AND NOT has_table_privilege('authenticated',c.oid,'SELECT')
   AND NOT has_table_privilege('anon',c.oid,'INSERT')
   AND NOT has_table_privilege('authenticated',c.oid,'INSERT')
 ELSE false END AS restrito
 FROM expected_tables e LEFT JOIN pg_class c
 ON c.oid=to_regclass(format('public.%I',e.name))
), expected_guards(tablename,triggername) AS (
 VALUES
 ('catalogos','catalogo_historico_guard_delete'),
 ('catalogos','catalogo_encerramento_sem_reabertura'),
 ('comercios_publicados','catalogo_publicacao_sem_divida_guard'),
 ('comercios_publicados','catalogo_encerramento_sem_republicacao')
), g AS (
 SELECT e.triggername,coalesce(x.tgenabled IN ('O','A'),false) AS ativo
 FROM expected_guards e LEFT JOIN pg_trigger x
 ON x.tgrelid=to_regclass(format('public.%I',e.tablename))
 AND x.tgname=e.triggername AND NOT x.tgisinternal
), expected_rpc(name) AS (
 VALUES ('catalogo_asaas_registrar_fatura'),('catalogo_asaas_webhook_receber'),
 ('catalogo_asaas_webhook_claim'),('catalogo_asaas_webhook_finalizar'),
 ('catalogo_solicitar_encerramento_financeiro'),
 ('catalogo_finalizar_encerramento_financeiro')
), f AS (
 SELECT e.name,p.oid,
  CASE WHEN p.oid IS NOT NULL THEN
   NOT has_function_privilege('anon',p.oid,'EXECUTE')
   AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
  ELSE false END AS restrito
 FROM expected_rpc e LEFT JOIN LATERAL (
   SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname=e.name ORDER BY p.oid LIMIT 1
 ) p ON true
)
SELECT
 (SELECT count(*) FROM t WHERE oid IS NULL) AS tabelas_ausentes,
 (SELECT count(*) FROM t WHERE oid IS NOT NULL AND NOT rls) AS rls_ausente,
 (SELECT count(*) FROM t WHERE oid IS NOT NULL AND NOT restrito) AS tabelas_expostas,
 (SELECT count(*) FROM g WHERE NOT ativo) AS gatilhos_inativos,
 (SELECT count(*) FROM f WHERE oid IS NULL) AS rpcs_ausentes,
 (SELECT count(*) FROM f WHERE oid IS NOT NULL AND NOT restrito) AS rpcs_expostas,
 (SELECT coalesce(jsonb_agg(name ORDER BY name),'[]'::jsonb) FROM t
  WHERE oid IS NULL OR NOT rls OR NOT restrito) AS tabelas_revisar,
 (SELECT coalesce(jsonb_agg(triggername ORDER BY triggername),'[]'::jsonb) FROM g
  WHERE NOT ativo) AS gatilhos_revisar,
 (SELECT coalesce(jsonb_agg(name ORDER BY name),'[]'::jsonb) FROM f
  WHERE oid IS NULL OR NOT restrito) AS rpcs_revisar;
