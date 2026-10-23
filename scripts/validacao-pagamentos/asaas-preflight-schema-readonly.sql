-- AS-AAS: gate de compatibilidade ANTES de publicar a Edge financeira.
-- Somente SELECT, sem DDL/DML, sem credenciais e sem solicitar Pix.
-- Execute apenas no STAGING ou como auditoria autorizada.
-- Resultado apto_esquema=false PROIBE deploy da Edge atual.
WITH requisitos(nome,disponivel) AS (
 SELECT 'tabela:clientes',
  to_regclass('public.catalogo_asaas_clientes') IS NOT NULL
 UNION ALL SELECT 'tabela:emissoes',
  to_regclass('public.catalogo_asaas_emissoes') IS NOT NULL
 UNION ALL SELECT 'tabela:webhook_eventos',
  to_regclass('public.catalogo_asaas_webhook_eventos') IS NOT NULL
 UNION ALL SELECT 'webhook:estado',
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='catalogo_asaas_webhook_eventos'
            AND column_name='estado')
 UNION ALL SELECT 'webhook:tentativas',
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='catalogo_asaas_webhook_eventos'
            AND column_name='tentativas')
 UNION ALL SELECT 'webhook:iniciado_em',
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='catalogo_asaas_webhook_eventos'
            AND column_name='iniciado_em')
 UNION ALL SELECT 'webhook:concluido_em',
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='catalogo_asaas_webhook_eventos'
            AND column_name='concluido_em')
 UNION ALL SELECT 'webhook:proxima_tentativa_em',
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='catalogo_asaas_webhook_eventos'
            AND column_name='proxima_tentativa_em')
 UNION ALL SELECT 'webhook:tentativa_token',
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='catalogo_asaas_webhook_eventos'
            AND column_name='tentativa_token')
 UNION ALL SELECT 'webhook:referencia_externa',
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='catalogo_asaas_webhook_eventos'
            AND column_name='referencia_externa')
 UNION ALL SELECT 'rpc:webhook_receber',
  to_regprocedure('public.catalogo_asaas_webhook_receber(text,text,text,text)') IS NOT NULL
 UNION ALL SELECT 'rpc:webhook_claim',
  to_regprocedure('public.catalogo_asaas_webhook_claim(integer)') IS NOT NULL
 UNION ALL SELECT 'rpc:webhook_finalizar',
  to_regprocedure('public.catalogo_asaas_webhook_finalizar(text,uuid,boolean)') IS NOT NULL
 UNION ALL SELECT 'rpc:registrar_fatura',
  to_regprocedure('public.catalogo_asaas_registrar_fatura(uuid,text,integer,text,text,text,timestamptz)') IS NOT NULL
)
SELECT coalesce(bool_and(disponivel),false) AS apto_esquema,
 count(*) AS requisitos,
 count(*) FILTER (WHERE NOT disponivel) AS pendentes,
 coalesce(array_agg(nome ORDER BY nome) FILTER (WHERE NOT disponivel),ARRAY[]::text[]) AS faltando
FROM requisitos;
