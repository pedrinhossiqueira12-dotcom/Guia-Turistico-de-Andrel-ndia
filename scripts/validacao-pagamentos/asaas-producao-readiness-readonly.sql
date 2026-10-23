-- GATE READ-ONLY da compatibilidade para cobranças Asaas.
-- Executar no Supabase staging E producao; nunca altera tabelas ou dados.
-- O resultado "schema_pronto" NAO substitui homologacao real, segredos,
-- habilitacao comercial da conta Asaas, webhook ou autorizacao de go-live.
WITH tabelas(nome) AS (
 VALUES ('catalogo_fechamentos_offline'),
        ('catalogo_fatura_cobrancas'),
        ('catalogos'),
        ('catalogo_asaas_clientes'),
        ('catalogo_asaas_emissoes'),
        ('catalogo_asaas_webhook_eventos'),
        ('catalogo_cobranca_preferencias')
), funcoes(nome) AS (
 VALUES ('catalogo_confirmar_cobranca_fatura'),
        ('catalogo_registrar_evento_fatura'),
        ('catalogo_asaas_registrar_fatura'),
        ('catalogo_asaas_webhook_receber'),
        ('catalogo_asaas_webhook_claim'),
        ('catalogo_asaas_webhook_finalizar')
), missing_tables AS (
 SELECT nome FROM tabelas WHERE to_regclass(format('public.%I', nome)) IS NULL
), missing_functions AS (
 SELECT nome FROM funcoes f WHERE NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname=f.nome
 )
), gateway_constraint AS (
 SELECT COALESCE(bool_or(
  pg_catalog.pg_get_constraintdef(c.oid) LIKE '%''asaas''%'
  AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%''mercadopago''%'
 ),false) AS aceita_ambos
 FROM pg_catalog.pg_constraint c
 WHERE c.conrelid=pg_catalog.to_regclass('public.catalogo_fatura_cobrancas')
   AND c.conname='catalogo_fatura_cobrancas_gateway_check'
), resultado AS (
 SELECT
  (SELECT count(*) FROM missing_tables)::integer AS tabelas_faltando,
  (SELECT count(*) FROM missing_functions)::integer AS funcoes_faltando,
  (SELECT aceita_ambos FROM gateway_constraint) AS gateway_compativel,
  (SELECT coalesce(jsonb_agg(nome ORDER BY nome),'[]'::jsonb) FROM missing_tables) AS nomes_tabelas_faltando,
  (SELECT coalesce(jsonb_agg(nome ORDER BY nome),'[]'::jsonb) FROM missing_functions) AS nomes_funcoes_faltando
)
SELECT *,
 (tabelas_faltando=0 AND funcoes_faltando=0 AND gateway_compativel) AS schema_pronto
FROM resultado;
