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

const preflightConciliacao=read("supabase/production-candidate/04_cob06_conciliacao_preflight_inerte.sql");

test("COB-06: conciliador de lote e somente leitura e nao libera dinheiro sem banco",()=>{
 assert.match(preflightConciliacao,/CREATE FUNCTION public\.catalogo_asaas_conferir_conciliacao_acumulo\(/);
 assert.match(preflightConciliacao,/catalogo_fatura_componentes_v2/);
 assert.match(preflightConciliacao,/catalogo_comissoes_offline/);
 assert.match(preflightConciliacao,/catalogo_pedidos/);
 assert.match(preflightConciliacao,/codigo_entrega_usado_em IS NULL/);
 assert.match(preflightConciliacao,/snapshots_divergentes/);
 assert.match(preflightConciliacao,/parcelas_invalidas/);
 assert.match(preflightConciliacao,/integridade_contabil_ok/);
 assert.match(preflightConciliacao,/'pode_quitar',false/);
 assert.match(preflightConciliacao,/'pode_estornar',false/);
 assert.match(preflightConciliacao,/'pode_liberar_motoboy',false/);
 assert.match(preflightConciliacao,/REVOKE ALL ON FUNCTION public\.catalogo_asaas_conferir_conciliacao_acumulo\(uuid\)/);
 assert.match(preflightConciliacao,/TO service_role;/);
 const clean=preflightConciliacao.replace(/--[^\n]*/g,"").replace(/'(?:[^']|'')*'/g,"''");
 assert.doesNotMatch(clean,/\b(?:UPDATE|DELETE|INSERT|TRUNCATE)\s+(?:INTO|FROM|public\.)/i);
 assert.ok(workflow.includes("04_cob06_conciliacao_preflight_inerte.sql"));
 assert.ok(reserva.includes("COB06_CONCILIACAO_ORIGENS_INCOMPLETAS_BLOQUEADAS_SEM_CREDITO_OK"));
 assert.ok(!edge.includes("catalogo_asaas_conferir_conciliacao_acumulo("));
});

const referenciaBancaria=read("supabase/production-candidate/05_cob06_referencia_bancaria_inerte.sql");

test("COB-06: referencia unica imutavel e sem POST bancario ate conciliacao completa",()=>{
 assert.match(referenciaBancaria,/CREATE TABLE public\.catalogo_asaas_acumulo_referencias/);
 assert.match(referenciaBancaria,/lote_id uuid PRIMARY KEY/);
 assert.match(referenciaBancaria,/referencia text NOT NULL UNIQUE/);
 assert.match(referenciaBancaria,/operacao_id uuid NOT NULL UNIQUE/);
 assert.match(referenciaBancaria,/payment_id text UNIQUE/);
 assert.match(referenciaBancaria,/CHECK\(payment_id IS NULL\)/);
 assert.match(referenciaBancaria,/CHECK \(pode_emitir_pix=false\)/);
 assert.match(referenciaBancaria,/CREATE UNIQUE INDEX catalogo_asaas_acumulo_referencia_loja_pendente/);
 assert.match(referenciaBancaria,/CREATE TRIGGER catalogo_asaas_acumulo_referencia_nao_alterar/);
 assert.match(referenciaBancaria,/CREATE FUNCTION public\.catalogo_asaas_reservar_referencia_acumulo\(/);
 assert.match(referenciaBancaria,/pg_catalog\.pg_advisory_xact_lock/);
 assert.match(referenciaBancaria,/integridade_contabil_ok/);
 assert.match(referenciaBancaria,/GRANT SELECT ON public\.catalogo_asaas_acumulo_referencias TO service_role/);
 assert.match(referenciaBancaria,/GRANT EXECUTE ON FUNCTION public\.catalogo_asaas_reservar_referencia_acumulo\(uuid\)/);
 assert.ok(workflow.includes("05_cob06_referencia_bancaria_inerte.sql"));
 assert.ok(reserva.includes("COB06_REFERENCIA_UNICA_IDEMPOTENTE_SEM_PIX_OK"));
 assert.ok(!edge.includes("catalogo_asaas_reservar_referencia_acumulo("));
 assert.doesNotMatch(referenciaBancaria,/\b(?:POST \/payments|\/payments\s*['"])/);
});

const observaGetSql=read("supabase/production-candidate/06_cob06_observacao_bancaria_sem_baixa.sql");
const validaGetTs=read("supabase/functions/_shared/catalogo-asaas-acumulo-get-verificado-inerte.ts");
const ensaioGet=read("supabase/functions/tests/catalogo-asaas-acumulo-get-verificado-inerte.test.ts");
test("COB-06: associacao por GET testada sem mutacao financeira nem rede",()=>{
 assert.match(observaGetSql,/CREATE TABLE public\.catalogo_asaas_acumulo_observacoes/);
 assert.match(observaGetSql,/lote_id uuid PRIMARY KEY/);
 assert.match(observaGetSql,/payment_id text NOT NULL UNIQUE/);
 assert.match(observaGetSql,/CREATE TRIGGER catalogo_asaas_acumulo_observacao_nao_alterar/);
 assert.match(observaGetSql,/public\.catalogo_asaas_clientes/);
 assert.match(observaGetSql,/public\.catalogo_asaas_conferir_conciliacao_acumulo/);
 assert.match(observaGetSql,/pode_quitar boolean NOT NULL DEFAULT false CHECK\(pode_quitar=false\)/);
 assert.match(observaGetSql,/pode_liberar_motoboy boolean NOT NULL DEFAULT false CHECK\(pode_liberar_motoboy=false\)/);
 assert.match(observaGetSql,/GRANT EXECUTE ON FUNCTION public\.catalogo_asaas_registrar_observacao_acumulo\(/);
 assert.match(observaGetSql,/TO service_role;/);
 assert.match(validaGetTs,/conferirPagamentoAcumuloPorGet/);
 assert.match(validaGetTs,/remoto\.externalReference === esperado\.referencia/);
 assert.match(validaGetTs,/remoto\.customer === esperado\.clienteId/);
 assert.match(validaGetTs,/remoto\.billingType === "PIX"/);
 assert.match(validaGetTs,/centsExatos\(remoto\.value\) === esperado\.valorCentavos/);
 assert.match(ensaioGet,/GET_INDISPONIVEL/);
 assert.match(reserva,/COB06_OBSERVACAO_GET_SIMULADO_IMUTAVEL_SEM_BAIXA_OK/);
 assert.ok(workflow.includes("06_cob06_observacao_bancaria_sem_baixa.sql"));
 assert.ok(!edge.includes("catalogo_asaas_registrar_observacao_acumulo("));
 assert.match(edge,/import \{ conferirPagamentoAcumuloPorGet \} from "\.\.\/_shared\/catalogo-asaas-acumulo-get-verificado-inerte\.ts"/);
 assert.match(edge,/const COB06_GET_ADMIN_READONLY_ON = Deno\.env\.get\("ASAAS_COB06_GET_ADMIN_READONLY_ENABLED"\) === "true"/);
 assert.match(edge,/async function conferirAcumuloSandboxAdmin\(uid:string,body:Record<string,unknown>\)/);
 assert.match(edge,/uid!==ADMIN_USER_ID/);
 assert.match(edge,/ENVIRONMENT!=="sandbox"\|\|!COB06_GET_ADMIN_READONLY_ON/);
 assert.match(edge,/db\.from\("catalogo_asaas_acumulo_observacoes"\)/);
 assert.match(edge,/db\.from\("catalogo_asaas_clientes"\)/);
 assert.match(edge,/consultarPagamentoAcumuloSandboxGet\(id,ASAAS_TOKEN\)/);
 assert.match(edge,/hold_obrigatorio:true/);
 assert.ok(!edge.includes('db.rpc("catalogo_asaas_registrar_observacao_acumulo"'));
});
