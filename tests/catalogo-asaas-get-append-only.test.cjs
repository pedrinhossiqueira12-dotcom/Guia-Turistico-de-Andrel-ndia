"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const sql=fs.readFileSync("supabase/pending-migrations/20261010003000_consultas_get_excepcionais_append_only.sql","utf8");
const edge=fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");
const ui=fs.readFileSync("js/admin-encerramentos.js","utf8");
const fixture=fs.readFileSync("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql","utf8");

test("historico de GETs preserva novas leituras mesmo com status repetido",()=>{
 assert.match(sql,/CREATE TABLE public\.catalogo_asaas_consultas_get_excepcionais/);
 assert.match(sql,/id uuid PRIMARY KEY/);
 assert.match(sql,/registrado_em timestamptz NOT NULL DEFAULT pg_catalog\.clock_timestamp\(\)/);
 assert.match(sql,/CREATE FUNCTION public\.catalogo_asaas_registrar_consulta_get_excepcional/);
 assert.match(sql,/INSERT INTO public\.catalogo_asaas_consultas_get_excepcionais/);
 assert.doesNotMatch(sql,/UNIQUE\s*\(vinculo_id,estado_banco\)/);
 assert.match(sql,/consulta_nova',true/);
 assert.match(sql,/consulta_nova',false/);
 assert.match(sql,/Chave de GET reutilizada com dados divergentes/);
 assert.match(sql,/catalogo_asaas_registrar_observacao_excepcional/);
});
test("registros GET nao podem ser mutados pelo cliente nem usados para transferencia",()=>{
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/REVOKE ALL ON public\.catalogo_asaas_consultas_get_excepcionais/);
 assert.match(sql,/GRANT SELECT ON public\.catalogo_asaas_consultas_get_excepcionais TO service_role/);
 assert.doesNotMatch(sql,/GRANT (?:INSERT|UPDATE|DELETE) ON public\.catalogo_asaas_consultas_get_excepcionais TO service_role/);
 assert.match(sql,/BEFORE UPDATE OR DELETE/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.catalogo_asaas_registrar_consulta_get_excepcional/);
 assert.match(sql,/TO service_role/);
 for(const flag of ["'pagamento_autorizado',false","'baixa_realizada',false","'liberacao_autorizada',false",
 "'historico_anterior_a_migracao_comprovado',false","'titularidade_pix_confirmada',false",
 "'ausencia_de_pix_anterior_comprovada',false"])assert.ok(sql.includes(flag),flag);
 assert.doesNotMatch(sql,/\bUPDATE\s+public\.catalogo_remuneracoes|\bPOST\s*\/transfers/);
});
test("Edge registra UUID por GET da API e informa resumo individual sob admin",()=>{
 const i=edge.indexOf("async function consultarERegistrarTransferenciaExcepcionalSandbox(");
 const j=edge.indexOf("async function observarTransferenciaExcepcionalSandboxAdmin(",i);
 const consult=edge.slice(i,j);
 assert.ok(i>=0&&j>i);
 assert.match(consult,/ENVIRONMENT!=="sandbox"/);
 assert.match(consult,/await asaas\("\/transfers\/"/);
 assert.match(consult,/catalogo_asaas_registrar_consulta_get_excepcional/);
 assert.match(consult,/p_consulta_id:crypto\.randomUUID\(\)/);
 const m=edge.slice(edge.indexOf("async function matrizConciliacaoEscrowAdmin("),
   edge.indexOf("// Dossie administrativo append-only."));
 assert.match(m,/uid!==ADMIN_USER_ID/);
 assert.match(m,/catalogo_asaas_diagnosticar_consultas_get_escrow/);
 assert.match(m,/consultas\.pagamento_autorizado===false/);
 assert.match(m,/consultas\.liberacao_autorizada===false/);
 assert.doesNotMatch(m,/await asaas\(|POST \/transfers/);
});
test("painel deixa visivel incompletude historica e repeticoes sem retirar HOLD",()=>{
 assert.match(ui,/consultas_get\?\.consultas_get_registradas/);
 assert.match(ui,/consultas_get\?\.consultas_com_mesmo_estado_consecutivo/);
 assert.match(ui,/consultas_get\?\.consultas_com_retorno_a_processamento/);
 assert.match(ui,/histórico anterior à nova auditoria NÃO comprovado/);
 assert.match(ui,/HOLD OBRIGATÓRIO/);
 assert.match(ui,/Nenhum crédito liberado, nenhuma baixa e nenhum Pix criado/);
});
test("Postgres isolado cobre GET repetido, replay de UUID e discrepancia",()=>{
 for(const marker of [
  "GET repetido nao foi persistido como evento novo",
  "Replay de chave GET nao foi idempotente",
  "Chave GET foi reutilizada com estado divergente",
  "Diagnostico GET perdeu auditoria ou liberou credito",
  "Registro GET foi adulterado",
  "Registro GET foi apagado",
  "Acesso direto a registros GET foi aberto",
 ])assert.ok(fixture.includes(marker),"Fixture ausente: "+marker);
 assert.match(fixture,/ROLLBACK;/);
});
