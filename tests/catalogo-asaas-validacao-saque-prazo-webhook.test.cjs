"use strict";
// #39: garantia de fail-closed no webhook Asaas (sem rede, credenciais ou Pix).
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const edge=fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");
function trecho(begin,end){
 const a=edge.indexOf(begin),b=edge.indexOf(end,a+begin.length);
 assert.ok(a>=0&&b>a,"secao esperada: "+begin);
 return edge.slice(a,b);
}
const callback=trecho("async function authorizeWithdrawal(","type AsaasWebhookPendente=");
const api=trecho("async function asaas(","function competence(");
test("callback de saque limita GET a menos de 10 segundos",()=>{
 const normal=edge.match(/const ASAAS_HTTP_TIMEOUT_MS=(\d+);/);
 const callbackDeadline=edge.match(/const ASAAS_VALIDACAO_SAQUE_HTTP_TIMEOUT_MS=(\d+);/);
 assert.ok(normal&&callbackDeadline);
 assert.ok(Number(callbackDeadline[1])<=4000&&Number(callbackDeadline[1])>=500);
 assert.ok(Number(callbackDeadline[1])<Number(normal[1]));
 assert.match(callback,/remote=await asaas\("\/transfers\/"\+encodeURIComponent\(id\),"GET",undefined,\s*ASAAS_VALIDACAO_SAQUE_HTTP_TIMEOUT_MS\)/);
 assert.match(api,/signal:AbortSignal\.timeout\(timeoutMs\)/);
 assert.match(api,/Number\.isSafeInteger\(timeoutMs\)/);
});
test("falha de consulta autenticada retorna REFUSED sem autorizar dinheiro",()=>{
 assert.match(callback,/try\s*\{\s*remote=await asaas/);
 assert.match(callback,/\}catch\s*\{\s*return approveResponse\("REFUSED","Consulta bancária indisponível; transferência não autorizada\."\)/);
 assert.ok(callback.indexOf("ASAAS_VALIDACAO_SAQUE_HTTP_TIMEOUT_MS")<
   callback.indexOf("decision=\"APPROVED\""),"decisao tomada antes do GET");
 assert.match(callback,/remote\.id===id && remote\.externalReference===ref/);
 assert.match(callback,/await pixDestinationsMatch\(String\(saque\.pix_destino_sha256\),\[incoming,remote\]\)/);
 assert.match(callback,/catalogo_asaas_validar_reserva_saque/);
 assert.match(callback,/ENVIRONMENT!=="sandbox"/);
 assert.doesNotMatch(callback,/fetch\(|\/transfers","POST"/);
});
