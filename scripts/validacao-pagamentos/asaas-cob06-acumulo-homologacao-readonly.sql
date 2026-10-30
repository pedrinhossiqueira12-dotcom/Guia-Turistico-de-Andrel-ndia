-- COB-06/PR39: gate SOMENTE LEITURA para a fase de observacao (03-07).
-- Produz uma linha; nao usa tabelas de usuarios, pagamentos, tokens ou dados de lojas.
-- Todos os nove primeiros campos devem ser 0 e os tres ultimos TRUE.
-- A instalacao e homologacao remotas continuam sujeitas a autorizacao especifica.
WITH
 nomes_tabela(nome) AS (
  VALUES ('catalogo_asaas_acumulo_lotes'),
         ('catalogo_asaas_acumulo_fontes'),
         ('catalogo_asaas_acumulo_referencias'),
         ('catalogo_asaas_acumulo_observacoes'),
         ('catalogo_asaas_acumulo_eventos')
 ),
 tabelas AS (
  SELECT nome, pg_catalog.to_regclass('public.' || nome) AS oid
  FROM nomes_tabela
 ),
 nomes_funcao(assinatura) AS (
  VALUES
   ('public.catalogo_asaas_previsualizar_acumulo(text,date)'),
   ('public.catalogo_asaas_reservar_acumulo(text,date)'),
   ('public.catalogo_asaas_conferir_conciliacao_acumulo(uuid)'),
   ('public.catalogo_asaas_reservar_referencia_acumulo(uuid)'),
   ('public.catalogo_asaas_registrar_observacao_acumulo(uuid,text,text,text,bigint,text)'),
   ('public.catalogo_asaas_registrar_evento_acumulo_inerte(uuid,text,text,text)')
 ),
 funcoes AS (
  SELECT assinatura, pg_catalog.to_regprocedure(assinatura) AS oid
  FROM nomes_funcao
 ),
 nomes_gatilho(nome) AS (
  VALUES
   ('catalogo_asaas_acumulo_sem_emissao_individual'),
   ('catalogo_asaas_acumulo_sem_cobranca_individual'),
   ('catalogo_asaas_acumulo_fechamento_imutavel'),
   ('catalogo_asaas_acumulo_componentes_imutaveis'),
   ('catalogo_asaas_acumulo_referencia_nao_alterar'),
   ('catalogo_asaas_acumulo_observacao_nao_alterar'),
   ('catalogo_asaas_acumulo_eventos_imutaveis')
 )
SELECT
 (SELECT count(*) FROM tabelas WHERE oid IS NULL) AS tabelas_ausentes,
 (SELECT count(*) FROM funcoes WHERE oid IS NULL) AS rpcs_ausentes,
 (SELECT count(*) FROM nomes_gatilho g WHERE NOT EXISTS (
   SELECT 1 FROM pg_catalog.pg_trigger t
   WHERE t.tgname=g.nome AND t.tgenabled IN ('O','A') AND NOT t.tgisinternal
 )) AS gatilhos_ausentes,
 (SELECT count(*) FROM tabelas t
   JOIN pg_catalog.pg_class c ON c.oid=t.oid
   WHERE NOT c.relrowsecurity) AS rls_ausente,
 (SELECT count(*) FROM tabelas t WHERE t.oid IS NOT NULL AND (
   pg_catalog.has_table_privilege('anon',t.oid,
     'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   OR pg_catalog.has_table_privilege('authenticated',t.oid,
     'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 )) AS tabelas_expostas_clientes,
 (SELECT count(*) FROM tabelas t WHERE t.oid IS NOT NULL
   AND pg_catalog.has_table_privilege('service_role',t.oid,
     'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 ) AS escritas_diretas_service_role,
 (SELECT count(*) FROM funcoes f WHERE f.oid IS NOT NULL AND (
   pg_catalog.has_function_privilege('anon',f.oid,'EXECUTE')
   OR pg_catalog.has_function_privilege('authenticated',f.oid,'EXECUTE')
 )) AS rpcs_expostas_clientes,
 (SELECT count(*) FROM funcoes f WHERE f.oid IS NOT NULL AND NOT
   pg_catalog.has_function_privilege('service_role',f.oid,'EXECUTE')
 ) AS rpcs_sem_service_role,
 (
  SELECT
   (CASE WHEN EXISTS (
     SELECT 1 FROM pg_catalog.pg_constraint c
     WHERE c.conrelid=pg_catalog.to_regclass('public.catalogo_asaas_acumulo_referencias')
       AND c.contype='c'
       AND c.conname='catalogo_acumulo_identificador_sem_prova'
       AND pg_catalog.lower(pg_catalog.pg_get_constraintdef(c.oid)) LIKE '%payment_id is null%'
   ) THEN 0 ELSE 1 END)
   +
   (CASE WHEN EXISTS (
     SELECT 1 FROM pg_catalog.pg_constraint c
     WHERE c.conrelid=pg_catalog.to_regclass('public.catalogo_asaas_acumulo_referencias')
       AND c.contype='c'
       AND pg_catalog.lower(pg_catalog.pg_get_constraintdef(c.oid)) LIKE '%pode_emitir_pix%false%'
   ) THEN 0 ELSE 1 END)
 ) AS checks_sem_emissao_ausentes,
 pg_catalog.to_regclass('public.catalogo_asaas_acumulo_quitacoes_isoladas') IS NULL
   AS ponte_quitacao_ausente,
 pg_catalog.to_regprocedure('catalogo_private.catalogo_asaas_quitar_lote_atomico_ci(uuid,bigint)') IS NULL
   AS quita_ci_ausente,
 pg_catalog.to_regprocedure('catalogo_private.catalogo_asaas_suspender_lote_atomico_ci(uuid,bigint)') IS NULL
   AS suspende_ci_ausente;
