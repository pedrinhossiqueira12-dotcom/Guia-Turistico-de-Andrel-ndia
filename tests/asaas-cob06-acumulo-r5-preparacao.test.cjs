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
 assert.match(fixture,/\nBEGIN;[\s\S]*ROLLBACK;\s*$/);
 assert.ok(workflow.includes("supabase/production-candidate/03_cob06_acumulo_intercompetencias_preparacao.sql"));
 assert.ok(workflow.includes("supabase/tests/isolated/asaas-cob06-acumulo-preview-rollback.sql"));
});

const reserva=read("supabase/tests/isolated/asaas-cob06-acumulo-reserva-rollback.sql");

test("COB-06: reserva R1+R4 e R2+R2+R1 bloqueia emissao e preserva origem",()=>{
 assert.match(sql,/CREATE FUNCTION public\.catalogo_asaas_reservar_acumulo\(/);
 assert.match(sql,/pg_catalog\.pg_advisory_xact_lock\(/);
 assert.match(sql,/ORDER BY f\.competencia,f\.id FOR UPDATE/);
 assert.match(sql,/CREATE TRIGGER catalogo_asaas_acumulo_sem_emissao_individual/);
 assert.match(sql,/CREATE TRIGGER catalogo_asaas_acumulo_sem_cobranca_individual/);
 assert.match(sql,/CREATE TRIGGER catalogo_asaas_acumulo_fechamento_imutavel/);
 assert.match(sql,/CREATE TRIGGER catalogo_asaas_acumulo_componentes_imutaveis/);
 assert.match(sql,/snapshot_inconsistente/);
 assert.doesNotMatch(sql,/GRANT EXECUTE ON FUNCTION public\.catalogo_asaas_reservar_acumulo\(text,date\)\s+TO (?:anon|authenticated)/);
 assert.match(reserva,/COB06_RESERVA_R1_R4_R2_R2_R1_TRANSACIONAL_SEM_PIX_OK/);
 assert.match(reserva,/R2\+R2\+R1/);
 assert.match(reserva,/\nBEGIN;[\s\S]*ROLLBACK;\s*$/);
 assert.ok(workflow.includes("supabase/tests/isolated/asaas-cob06-acumulo-reserva-rollback.sql"));
 assert.ok(!edge.includes("catalogo_asaas_reservar_acumulo("),
  "Nao conectar reserva ao provedor sem conciliacao de pagamento e estorno");
});
