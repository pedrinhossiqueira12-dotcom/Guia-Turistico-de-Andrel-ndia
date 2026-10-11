"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const edge=fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");
const migration=fs.readFileSync("supabase/pending-migrations/20261008180000_asaas_faturas_saques_controlados.sql","utf8");
const html=fs.readFileSync("pages/entregas-operacao.html","utf8");
const ui=fs.readFileSync("js/entregas-operacao.js","utf8");
const a=edge.indexOf("async function webhook(request:Request){");
const b=edge.indexOf("async function reprocessarWebhooksAsaasAdmin(",a);
assert.ok(a>=0&&b>a,"Webhook source not found");
const source=edge.slice(a,b)
 .replace("async function webhook(request:Request){","async function webhook(request){")
 .replace("let body:Record<string,unknown>;","let body;")
 .replace(/\(globalThis as typeof globalThis & \{\s*EdgeRuntime\?:\{waitUntil:\(p:Promise<unknown>\)=>void\}\s*\}\)\.EdgeRuntime/g,"globalThis.EdgeRuntime")
 .replace(/\(e as Error\)\.name/g,"e.name");

function fake({storedOk=true,duplicate=false,worker=null}={}){
 const calls=[],background=[];
 const context={
  WEBHOOK_TOKEN:"secret-valid-token-of-at-least-32-bytes",
  equalSecret:async(t,e)=>t===e,
  Failure:class Failure extends Error{constructor(msg,status){super(msg);this.status=status;}},
  value:(x,max=200)=>typeof x==="string"?x.trim().slice(0,max):"",
  input:(x)=>x&&typeof x==="object"&&!Array.isArray(x)?x:{},
  rpc:async(name,payload)=>{
   calls.push({name,payload});
   assert.equal(name,"catalogo_asaas_webhook_receber");
   return {ok:storedOk,duplicado:duplicate};
  },
  processarWebhooksAsaasPendentes:worker|| (async()=>({concluido:1,falhou:0})),
  respond:(body,status=200)=>({status,body}),
  console:{error(){}},
 };
 context.EdgeRuntime={waitUntil:(p)=>background.push(p)};
 const webhook=vm.runInNewContext(source+"\nwebhook",context);
 const request=(body,token=context.WEBHOOK_TOKEN)=>new Request("https://example.invalid/webhook",{
  method:"POST",headers:{"asaas-access-token":token},
  body:typeof body==="string"?body:JSON.stringify(body),
 });
 return {webhook,request,calls,background};
}
const event={
 id:"evt_test_1",event:"PAYMENT_RECEIVED",payment:{id:"pay_test_1",externalReference:"fatura-ci"}
};

test("autentica webhook antes de persistir; token errado nao grava",async()=>{
 const f=fake();
 await assert.rejects(f.webhook(f.request(event,"senha-invalida")),e=>e.status===401);
 assert.equal(f.calls.length,0);
 await assert.rejects(f.webhook(f.request("{",f.request?undefined:undefined)),e=>e.status===400);
 assert.equal(f.calls.length,0);
});
test("recebe e persiste antes do ACK 200; processamento roda sem aguardar",async()=>{
 let release;
 const gate=new Promise(resolve=>{release=resolve;});
 const f=fake({worker:async()=>gate});
 const result=await f.webhook(f.request(event));
 assert.equal(result.status,200);
 assert.equal(result.body.recebido,true);
 assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].name,"catalogo_asaas_webhook_receber");
 assert.equal(f.calls[0].payload.p_id,event.id);
 assert.equal(f.background.length,1);
 release();
 await Promise.all(f.background);
});
test("entrega duplicada tem ACK e nao cria segunda gravacao/operacao financeira",async()=>{
 const f=fake({duplicate:true});
 const result=await f.webhook(f.request(event));
 assert.equal(result.body.duplicado,true);
 assert.equal(f.calls.length,1);
 await Promise.all(f.background);
});
test("falha ao persistir nao responde sucesso ao Asaas",async()=>{
 const f=fake({storedOk:false});
 await assert.rejects(f.webhook(f.request(event)),e=>e.status===409);
 assert.equal(f.background.length,0);
});
test("evento desconhecido ignora sem escrever e payload fora do limite e recusado",async()=>{
 const f=fake();
 const res=await f.webhook(f.request({...event,event:"UNKNOWN_EVENT"}));
 assert.equal(res.status,200);assert.equal(res.body.ignorado,true);
 assert.equal(f.calls.length,0);
 await assert.rejects(f.webhook(f.request("X".repeat(65537))),e=>e.status===413);
 assert.equal(f.calls.length,0);
});
test("recuperacao apos falha tem fila duravel, SKIP LOCKED e token de tentativa",()=>{
 for(const marker of [
  "ALTER TABLE public.catalogo_asaas_webhook_eventos",
  "ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'concluido'",
  "CREATE OR REPLACE FUNCTION public.catalogo_asaas_webhook_receber(",
  "ON CONFLICT (id) DO NOTHING",
  "CREATE OR REPLACE FUNCTION public.catalogo_asaas_webhook_claim(",
  "FOR UPDATE SKIP LOCKED",
  "tentativa_token=pg_catalog.gen_random_uuid()",
  "interval '5 minutes'",
  "CREATE OR REPLACE FUNCTION public.catalogo_asaas_webhook_finalizar(",
  "w.tentativa_token=p_token",
  "REVOKE ALL ON FUNCTION public.catalogo_asaas_webhook_receber",
  "GRANT EXECUTE ON FUNCTION public.catalogo_asaas_webhook_claim(integer)"
 ])assert.ok(migration.includes(marker),marker);
 const receiver=edge.slice(edge.indexOf("async function webhook(request:Request){"),
   edge.indexOf("async function reprocessarWebhooksAsaasAdmin(",a));
 assert.ok(receiver.indexOf("catalogo_asaas_webhook_receber") <
   receiver.indexOf("processarWebhooksAsaasPendentes(5)"));
 assert.match(edge,/catalogo_asaas_webhook_finalizar/);
 assert.match(edge,/runtime\.waitUntil\(task\)/);
});
test("admin pode consultar e reprocessar fila com autenticação, sem botão Pix",()=>{
 for(const id of ["asaasWebhookInboxConsultar","asaasWebhookInboxReprocessar","asaasWebhookInboxResumo"])
  assert.ok(html.includes('id="'+id+'"'),id);
 for(const name of ["diagnosticar_webhooks_asaas_admin","reprocessar_webhooks_asaas_admin"])
  assert.ok(ui.includes(name)&&edge.includes('case "'+name+'"'),name);
 assert.match(edge,/async function reprocessarWebhooksAsaasAdmin\(uid:string\)\{\s*if\(uid!==ADMIN_USER_ID\)/);
 assert.doesNotMatch(html,/id="asaasWebhookInbox(?:Consultar|Reprocessar)"[^>]*\bsubmit\b/);
});


test("webhook do Guia que chega antes do cadastro local NAO e perdido",async()=>{
 const start=edge.indexOf("async function processarEventoAsaasPendente(");
 const finish=edge.indexOf("async function processarWebhooksAsaasPendentes(",start);
 assert.ok(start>=0&&finish>start);
 const implementation=edge.slice(start,finish).replace(
   "async function processarEventoAsaasPendente(row:AsaasWebhookPendente)",
   "async function processarEventoAsaasPendente(row)");
 let consulted=0,verified=0,remoteRef="fatura-loja-ci-2026-10";
 const ctx={
  db:{from:()=>({select:()=>({eq(){return this},maybeSingle:async()=>({data:null,error:null})})})},
  asaas:async()=>{consulted++;return {externalReference:remoteRef}},
  verifyInvoice:async()=>{verified++},
  value:(v,m)=>typeof v==="string"?v.slice(0,m):"",
  Failure:class Failure extends Error{constructor(message,status){super(message);this.status=status;}},
  ENVIRONMENT:"sandbox"
 };
 const process=vm.runInNewContext(implementation+"\nprocessarEventoAsaasPendente",ctx);
 const row={evento:"PAYMENT_RECEIVED",recurso_id:"pay_ci_001",referencia_externa:null};
 await assert.rejects(process(row),e=>e.status===503&&/ainda nao registrada/.test(e.message));
 assert.equal(consulted,1);
 assert.equal(verified,0);
 remoteRef="pagamento-de-outra-plataforma";
 await process(row);
 assert.equal(verified,0);
});
