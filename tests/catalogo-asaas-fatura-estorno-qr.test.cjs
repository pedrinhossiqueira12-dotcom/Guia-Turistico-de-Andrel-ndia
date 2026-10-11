"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const edge=fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");
const merchant=fs.readFileSync("js/catalogo-admin.js","utf8");
const from=edge.indexOf("async function reconcileInvoice(uid:string,body:Record<string,unknown>){");
const until=edge.indexOf("async function createInvoice(",from);
assert.ok(from>=0&&until>from,"Nao foi possivel localizar reconciliacao de fatura");
const fnSource=edge.slice(from,until)
 .replace("async function reconcileInvoice(uid:string,body:Record<string,unknown>)",
          "async function reconcileInvoice(uid,body)");

async function consultar(estado,providerStatus=estado){
 const chamadas=[];
 const sandbox={
  invoice:async()=>({f:{id:"invoice-ci",status:"faturado",total_comissao_centavos:700},
   charge:{gateway:"asaas",order_id:"pay-ci",valor_centavos:700},
   store:"comercio-ci",month:"2026-10"}),
  enabled:(kind)=>assert.equal(kind,"billing"),
  verifyInvoice:async()=>({
   estado,conciliado:{status:providerStatus},
   payment:{id:"pay-ci",invoiceUrl:"https://example.invalid/fatura"}
  }),
  asaas:async (path)=>{
   chamadas.push(path);
   return {payload:"codigo-pix-que-so-deve-aparecer-em-pendente",
    encodedImage:"base64-sintetico"};
  },
  parsePix:(payment,qr)=>({code:qr.payload||"",imageBase64:qr.encodedImage||"",
   ticketUrl:payment.invoiceUrl||""}),
  value:(x,max=200)=>typeof x==="string"?x.trim().slice(0,max):"",
  respond:(obj)=>obj,
  encodeURIComponent, String,
  Failure:class Failure extends Error{constructor(message,status){super(message);this.status=status;}}
 };
 const fn=vm.runInNewContext(fnSource+"\nreconcileInvoice",sandbox);
 const result=await fn("owner-ci",{comercio_id:"comercio-ci",competencia:"2026-10"});
 return {result,chamadas};
}

test("cobranca pendente exibe Pix atual da API, sem criar outra cobranca",async()=>{
 const {result,chamadas}=await consultar("pendente");
 assert.equal(result.cobranca_status,"pendente");
 assert.equal(result.pix.code,"codigo-pix-que-so-deve-aparecer-em-pendente");
 assert.equal(chamadas.length,1);
 assert.equal(chamadas[0],"/payments/pay-ci/pixQrCode");
});
test("cobranca recebida nao consulta QR nem sugere novo pagamento",async()=>{
 const {result,chamadas}=await consultar("pago");
 assert.deepEqual(chamadas,[]);
 assert.equal(result.pix.code,"");
 assert.match(result.mensagem,/fatura quitada/i);
});
for(const status of ["estornado","contestado","cancelado"]){
 test("cobranca "+status+" nunca busca QR nem exibe codigo de pagamento",async()=>{
  // Estado local antigo "pago" nao pode esconder estorno/contestacao do Asaas.
  const {result,chamadas}=await consultar(status,"pago");
  assert.deepEqual(chamadas,[]);
  assert.equal(result.cobranca_status,status);
  assert.equal(result.pix.code,"");
  assert.match(result.mensagem,/Não utilize o Pix anterior/);
  assert.match(result.mensagem,/regularização/i);
 });
}
test("painel comercial tambem bloqueia QR antigo, apesar de resposta velha do servidor",()=>{
 const start=merchant.indexOf("function renderizarPixFatura(");
 const stop=merchant.indexOf("async function gerarPixFatura(",start);
 assert.ok(start>=0&&stop>start);
 const block=merchant.slice(start,stop);
 assert.match(block,/\["estornado", "contestado", "cancelado"\]\.includes\(situacao\)/);
 assert.match(block,/if \(pix\.code && !cobrancaNaoPagavel\)/);
 assert.ok(block.indexOf("cobrancaNaoPagavel")<block.indexOf("if (pix.code"));
});
test("nenhum caminho novo autoriza saque ou POST de Pix bancario",()=>{
 const slice=edge.slice(from,until);
 assert.doesNotMatch(slice,/\/transfers|POST\s*\/payments|pagar_saque|liquidar_saldo/i);
 assert.match(edge,/if\(method==="POST" && path==="\/transfers"\)\{\s*if\(ENVIRONMENT!=="sandbox"\)/);
});
