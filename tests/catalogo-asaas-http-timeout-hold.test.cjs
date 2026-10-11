"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const src=fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");
function section(begin,end){
 const a=src.indexOf(begin);
 const b=src.indexOf(end,a+begin.length);
 assert.ok(a>=0 && b>a,`secao financeira ausente: ${begin}`);
 return src.slice(a,b);
}
test("todas as chamadas HTTP Asaas diretas possuem timeout finito",()=>{
 const match=src.match(/const ASAAS_HTTP_TIMEOUT_MS=(\d+);/);
 assert.ok(match,"limite HTTP Asaas ausente");
 const timeout=Number(match[1]);
 assert.ok(Number.isSafeInteger(timeout) && timeout>=1000 && timeout<=30000);
 const segments=src.split("await fetch(API_BASE+");
 assert.equal(segments.length-1,2,"nova chamada externa deve ser auditada");
 for(const call of segments.slice(1)){
  const options=call.slice(0,call.indexOf("});")+3);
  assert.match(options,/signal:AbortSignal\.timeout\(ASAAS_HTTP_TIMEOUT_MS\)/);
 }
});
test("historico legado usa o mesmo leitor com limite de bytes e timeout",()=>{
 const history=section("async function auditPendingSandboxTransfer(","async function withdraw(");
 assert.match(history,/const result=await asaas\(path\);/);
 assert.doesNotMatch(history,/await fetch\(|response\.json\(/);
 const asaas=section("async function asaas(","function competence(");
 assert.match(asaas,/signal:AbortSignal\.timeout\(ASAAS_HTTP_TIMEOUT_MS\)/);
 assert.match(asaas,/await lerListagemAsaasLimitada\(response\)/);
 assert.match(asaas,/method==="GET"&&path\.startsWith\("\/transfers\?"\)/);
 assert.match(asaas,/if\(path\.startsWith\("\/transfers"\) && method==="GET"\)/);
});
test("timeout de POST de transferencia preserva saldo em revisao e nunca reenvia",()=>{
 const fn=section("async function withdraw(","const ADMIN_USER_ID = ");
 assert.match(fn,/externalReference:saqueId/);
 assert.match(fn,/catch\(e\)\s*\{/);
 assert.match(fn,/e instanceof SandboxTransferRejected/);
 assert.match(fn,/p_estado:"revisao"/);
 assert.match(fn,/p_mensagem:"Resposta do provedor inconclusiva\. Não reenviar sem conciliar\."/);
 assert.doesNotMatch(fn,/retry|backoff|for\s*\(|while\s*\(/i);
 const asaas=section("async function asaas(","function competence(");
 assert.match(asaas,/ENVIRONMENT!=="sandbox"/);
 assert.match(asaas,/if\(method==="POST" && path==="\/transfers"\)/);
 assert.doesNotMatch(asaas,/for\s*\(|while\s*\(|retry/i);
});
