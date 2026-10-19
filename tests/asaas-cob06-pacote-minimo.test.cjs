"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
const base=read("supabase/pending-migrations/20261008180000_asaas_faturas_saques_controlados.sql");
const terms=read("supabase/pending-migrations/20261009150000_termos_cobranca_futura_encerramento_e_saque_minimo.sql");
const billing=read("supabase/production-candidate/01_asaas_cobrancas_inbox_sem_saques.sql");
const consent=read("supabase/production-candidate/02_termos_encerramento_sem_saques.sql");
const gate=read("scripts/validacao-pagamentos/asaas-cob06-seguranca-readonly.sql");
const manifest=read("docs/ASAAS_COB06_PACOTE_MINIMO_CANDIDATO_20261012.md");

test("COB-06: SQL de faturamento + inbox tem somente cobrança, não reservador de saques",()=>{
 for(const required of [
  "CHECK (gateway IN ('mercadopago','asaas'))",
  "public.catalogo_asaas_clientes",
  "public.catalogo_asaas_emissoes",
  "public.catalogo_asaas_webhook_eventos",
  "CREATE OR REPLACE FUNCTION public.catalogo_asaas_registrar_fatura(",
  "CREATE OR REPLACE FUNCTION public.catalogo_asaas_webhook_receber(",
  "CREATE OR REPLACE FUNCTION public.catalogo_asaas_webhook_claim(",
  "CREATE OR REPLACE FUNCTION public.catalogo_asaas_webhook_finalizar(",
  "FOR UPDATE SKIP LOCKED",
  "ENABLE ROW LEVEL SECURITY",
  "FROM PUBLIC,anon,authenticated",
  "TO service_role"
 ])assert.ok(billing.includes(required),required);
 for(const forbidden of [
  "CREATE TABLE IF NOT EXISTS public.catalogo_asaas_saques",
  "catalogo_asaas_saque_itens",
  "catalogo_asaas_reservar_saque",
  "catalogo_asaas_atualizar_saque",
  "catalogo_asaas_saldo_sacavel",
  "catalogo_asaas_reserva_guard"
 ])assert.ok(!billing.includes(forbidden),"não incluir "+forbidden);
 assert.equal((billing.match(/CREATE OR REPLACE FUNCTION/g)||[]).length,4);
 assert.ok(billing.includes("BEGIN;")&&billing.trimEnd().endsWith("COMMIT;"));
 // Código de cobrança veio do arquivo homologado, sem reescrever a lógica.
 const from=base.indexOf("CREATE OR REPLACE FUNCTION public.catalogo_asaas_registrar_fatura(");
 const to=base.indexOf("-- A seleção e reserva de créditos",from);
 assert.ok(from>0&&to>from);
 assert.ok(billing.includes(base.slice(from,to).trim()));
});
test("COB-06: termos e encerramento sem SQL de saques, com RLS privada",()=>{
 for(const name of [
  "catalogo_cobranca_preferencias","catalogo_aceites_operacionais",
  "catalogo_encerramentos_comercio","catalogo_solicitar_encerramento_financeiro",
  "ENABLE ROW LEVEL SECURITY","TO service_role"
 ])assert.ok(consent.includes(name),name);
 assert.ok(!consent.includes("catalogo_asaas_reservar_saque"));
 assert.ok(!consent.includes("public.catalogo_asaas_saques"));
 assert.equal((consent.match(/CREATE OR REPLACE FUNCTION/g)||[]).length,1);
 const from=terms.indexOf("CREATE TABLE IF NOT EXISTS public.catalogo_cobranca_preferencias");
 const to=terms.indexOf("-- R$ 100,00 mínimos",from);
 assert.ok(from>=0&&to>from);
 assert.ok(consent.includes(terms.slice(from,to).trim()));
});
test("COB-06: gate complementar é somente leitura e monitora privilégios e guardas",()=>{
 const noComments=gate.replace(/--[^\n]*/g,"").replace(/'(?:[^']|'')*'/g,"''");
 assert.doesNotMatch(noComments,/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i);
 for(const need of ["has_table_privilege","has_function_privilege",
  "catalogo_historico_guard_delete","catalogo_publicacao_sem_divida_guard",
  "catalogo_encerramento_sem_reabertura","catalogo_encerramento_sem_republicacao",
  "catalogo_asaas_webhook_receber","catalogo_finalizar_encerramento_financeiro"])
  assert.ok(gate.includes(need),need);
 assert.match(gate,/to_regprocedure\('public\.'/);
 assert.match(gate,/rpcs_sobrecargas_inesperadas/);
 assert.match(gate,/outras_assinaturas/);
 assert.doesNotMatch(gate,/ORDER BY p\.oid LIMIT 1/);
});
test("COB-06: inventário exige clone, gates, ordem seletiva e autorização de produção",()=>{
 for(const name of [
  "01_asaas_cobrancas_inbox_sem_saques.sql",
  "02_termos_encerramento_sem_saques.sql",
  "20261009162000_bloquear_exclusao_debitos_e_finalizar_arquivamento.sql",
  "20261009163000_impedir_reabertura_encerramento.sql",
  "20261009183000_proteger_republicacao_legada_apos_encerramento.sql",
  "20261009184000_bloquear_despublicacao_legada_qualquer_status.sql",
  "20261012104000_cob04_fechamento_apenas_entregas_confirmadas.sql",
  "20261012163000_cob04_pagamento_somente_componentes_da_fatura.sql",
  "asaas-cob06-seguranca-readonly.sql","clone","Mercado Pago"
 ])assert.ok(manifest.includes(name),name);
 assert.match(manifest,/NÃO IMPLANTAR/);
});


test("COB-06: Edge mista exige dupla aprovação para cobrar e proíbe POST Pix de saque em produção",()=>{
 const code=read("supabase/functions/catalogo-asaas-financeiro/index.ts");
 const enabledAt=code.indexOf('function enabled(kind:"billing"|"payouts"){');
 const authAt=code.indexOf('async function auth(',enabledAt);
 assert.ok(enabledAt>=0&&authAt>enabledAt);
 const guard=code.slice(enabledAt,authAt);
 assert.match(guard,/kind==="billing" && !PRODUCTION_BILLING_APPROVED/);
 assert.match(guard,/BILLING_ON:PAYOUTS_ON/);
 const postAt=code.indexOf('async function asaas(');
 const withdrawAt=code.indexOf('async function withdraw(');
 assert.ok(postAt>=0&&withdrawAt>postAt);
 const provider=code.slice(postAt,postAt+2400);
 assert.match(provider,/method==="POST" && path==="\/transfers"/);
 assert.match(provider,/if\(ENVIRONMENT!=="sandbox"\)/);
 assert.match(provider,/WITHDRAWAL_AUTH_ON/);
 const withdrawal=code.slice(withdrawAt,withdrawAt+700);
 assert.match(withdrawal,/if\(ENVIRONMENT!=="sandbox"\)/);
 assert.ok(withdrawal.indexOf('if(ENVIRONMENT!=="sandbox")') <
   withdrawal.indexOf('enabled("payouts")'));
});


test("COB-06: producao billing-only nega carteira, saques e escrow antes do despacho",()=>{
 const code=read("supabase/functions/catalogo-asaas-financeiro/index.ts");
 const pos=code.indexOf("const acaoFinanceira=value(body.acao,60);");
 const start=code.indexOf("const acoesSaqueAindaNaoHomologadas=new Set([",pos);
 const end=code.indexOf("switch(acaoFinanceira)",start);
 assert.ok(pos>0&&start>pos&&end>start,"gate no despachante");
 const guard=code.slice(start,end);
 for(const action of [
  "consultar_carteira","solicitar_analise_residual",
  "solicitar_regularizacao_saida","listar_analises_residuais_admin",
  "listar_regularizacoes_saida_admin","revisar_regularizacao_saida_admin",
  "preconferir_pagamento_excepcional_admin","listar_separacoes_congeladas_admin",
  "diagnosticar_separacao_congelada_admin","matriz_conciliacao_escrow_admin",
  "auditar_historico_transferencias_excepcionais_sandbox_admin",
  "exportar_ancora_dossie_admin","listar_dossie_escrow_admin",
  "registrar_dossie_escrow_admin","consultar_titularidade_pix_sandbox_admin",
  "observar_transferencia_excepcional_sandbox_admin",
  "revisar_analise_residual_admin","solicitar_saque",
  "auditar_saque_sandbox","listar_saques_admin","conciliar_saque_admin"
 ]) {
  assert.ok(guard.includes('"'+action+'"'),"falta bloqueio de "+action);
  assert.ok(code.includes('case "'+action+'":'),"acao de saque mudou");
 }
 assert.match(guard,/ENVIRONMENT==="production" && acoesSaqueAindaNaoHomologadas\.has\(acaoFinanceira\)/);
 assert.match(guard,/throw new Failure\([^\n]*503\)/);
 const billing=["obter_fatura","criar_cobranca","consultar_cobranca"];
 for(const action of billing) {
  assert.ok(!guard.includes('"'+action+'"'),"cobranca bloqueada no corte minimo");
  assert.ok(code.includes('case "'+action+'":'),"cobranca desapareceu");
 }
});
