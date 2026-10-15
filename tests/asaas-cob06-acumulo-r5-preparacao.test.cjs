"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");

const sql=read("supabase/production-candidate/03_cob06_acumulo_intercompetencias_preparacao.sql");
const fixture=read("supabase/tests/isolated/asaas-cob06-acumulo-preview-rollback.sql");
const edge=read("supabase/functions/catalogo-asaas-financeiro/index.ts");
const workflow=read(".github/workflows/database-tests.yml");

test("COB-06: vinculo exclusivo e tabela privada nao permitem gravacao publica ou service_role",()=>{
 assert.match(sql,/CREATE TABLE public\.catalogo_asaas_acumulo_lotes/);
 assert.match(sql,/CREATE TABLE public\.catalogo_asaas_acumulo_fontes/);
 assert.match(sql,/fechamento_id uuid PRIMARY KEY/);
 assert.match(sql,/UNIQUE \(comercio_id, competencia_corte\)/);
 assert.match(sql,/REFERENCES public\.catalogo_fechamentos_offline\(id\) ON DELETE RESTRICT/);
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/g);
 assert.match(sql,/FROM PUBLIC,anon,authenticated,service_role/);
 assert.match(sql,/GRANT SELECT ON public\.catalogo_asaas_acumulo_lotes/);
 assert.doesNotMatch(sql,/GRANT (?:INSERT|UPDATE|DELETE|ALL) ON public\.catalogo_asaas_acumulo_/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.catalogo_asaas_previsualizar_acumulo\(text,date\)/);
 assert.match(sql,/TO service_role;/);
});

test("COB-06: preview nao emite Pix, nao atualiza faturas e exige integridade do snapshot",()=>{
 assert.match(sql,/componentes_count=0/);
 assert.match(sql,/componentes_soma<>c\.total_comissao_centavos/);
 assert.match(sql,/NOT EXISTS \(SELECT 1 FROM public\.catalogo_fatura_cobrancas/);
 assert.match(sql,/NOT EXISTS \(SELECT 1 FROM public\.catalogo_asaas_emissoes/);
 assert.match(sql,/NOT EXISTS \(SELECT 1 FROM public\.catalogo_asaas_acumulo_fontes/);
 assert.match(sql,/pronto_para_preparar/);
 assert.match(sql,/reserva_criada',false,'pix_emitido',false/);
 assert.doesNotMatch(sql,/\b(?:INSERT INTO public\.catalogo_fatura_cobrancas|UPDATE public\.catalogo_fechamentos_offline|POST \/payments)\b/);
 assert.ok(!edge.includes("catalogo_asaas_previsualizar_acumulo("),
  "Preview ainda nao pode ser conectado ao fluxo de cobranca bancaria");
 assert.match(edge,/invoiceCents>=ASAAS_COBRANCA_MINIMA_CENTAVOS/);
});

test("COB-06: o ensaio real roda em DB sintetico e desfaz as alteracoes",()=>{
 assert.match(fixture,/current_database\(\)<>'catalogo_cob06_ci'/);
 assert.match(fixture,/legacy-cob06-ci/);
 assert.match(fixture,/100,'faturado'/);
 assert.match(fixture,/400,'faturado'/);
 assert.match(fixture,/COB06_ACUMULO_LEDGER_PREVIEW_OK_SEM_PIX/);
 assert.match(fixture,/^BEGIN;[\s\S]*ROLLBACK;\s*$/);
 assert.ok(workflow.includes("supabase/production-candidate/03_cob06_acumulo_intercompetencias_preparacao.sql"));
 assert.ok(workflow.includes("supabase/tests/isolated/asaas-cob06-acumulo-preview-rollback.sql"));
});
