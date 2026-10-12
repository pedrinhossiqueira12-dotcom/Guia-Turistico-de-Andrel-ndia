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
const b=edge.indexOf("async function executarWorkerWebhooksAsaas(",a);
assert.ok(a>=0&&b>a,"Webhook source not found");
const source=edge.slice(a,b)
 .replace("async function webhook(request:Request){","async function webhook(request){")
 .replace("let body:Record<string,unknown>;","let body;")
 .replace("const chunks:Uint8Array[]=[];","const chunks=[];")
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
  TextDecoder,Uint8Array,
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
test("webhook aplica limite de BYTES UTF-8, inclusive texto curto com emoji multibyte",async()=>{
 const f=fake();
 // 4 bytes por emoji, mesmo que o numero de caracteres JS seja menor
 // que 65536: a entrada deve ser recusada ANTES de JSON.parse ou da RPC.
 const body=JSON.stringify({...event,detalhe:"💳".repeat(17000)});
 assert.ok(body.length<65536,"teste deveria caber na antiga checagem por caracteres");
 assert.ok(Buffer.byteLength(body,"utf8")>65536,"teste deve ultrapassar o limite real");
 await assert.rejects(f.webhook(f.request(body)),e=>e.status===413);
 assert.equal(f.calls.length,0);
});
test("webhook rejeita UTF-8 malformado em vez de substituir bytes silenciosamente",async()=>{
 const f=fake();
 const req=new Request("https://example.invalid/webhook",{
  method:"POST",headers:{"asaas-access-token":"secret-valid-token-of-at-least-32-bytes"},
  body:new Uint8Array([0xc3,0x28])
 });
 await assert.rejects(f.webhook(req),e=>e.status===400);
 assert.equal(f.calls.length,0);
});
test("webhook recusa Content-Length acima de 64 KiB mesmo com corpo pequeno",async()=>{
 const f=fake();
 const req=new Request("https://example.invalid/webhook",{
  method:"POST",headers:{"asaas-access-token":"secret-valid-token-of-at-least-32-bytes",
   "content-length":"70000"},body:JSON.stringify(event)
 });
 await assert.rejects(f.webhook(req),e=>e.status===413);
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


test("endpoint cron-webhooks exige token dedicado e habilitacoes independentes",async()=>{
 const start=edge.indexOf("async function executarWorkerWebhooksAsaas(request:Request){");
 const end=edge.indexOf("async function reprocessarWebhooksAsaasAdmin(",start);
 assert.ok(start>=0&&end>start,"Worker financeiro deve existir");
 const source=edge.slice(start,end).replace(
  "async function executarWorkerWebhooksAsaas(request:Request)",
  "async function executarWorkerWebhooksAsaas(request)");
 assert.ok(edge.includes('const WEBHOOK_WORKER_TOKEN = Deno.env.get("ASAAS_WEBHOOK_WORKER_TOKEN") || "";'));
 assert.ok(edge.includes('const WEBHOOK_WORKER_ON = Deno.env.get("ASAAS_WEBHOOK_WORKER_ENABLED") === "true";'));
 assert.ok(edge.includes('if(pathname.endsWith("/cron-webhooks"))return await executarWorkerWebhooksAsaas(request);'));
 assert.ok(edge.indexOf('if(pathname.endsWith("/cron-webhooks"))')<edge.indexOf('const user=await auth(request);'));
 const secret="segredo-exclusivo-do-teste-1234567890-1234567890-1234567890";
 async function run({correct=true,workerOn=true,enabledOn=true,token=secret}={}){
  const calls=[];
  const env={
   WEBHOOK_WORKER_TOKEN:token, WEBHOOK_WORKER_ON:workerOn,
   equalSecret:async(x,y)=>x===y,
   enabled:kind=>{
    calls.push(["enabled",kind]);
    if(!enabledOn)throw new Error("Faturamento nao ativado");
   },
   processarWebhooksAsaasPendentes:async n=>{
    calls.push(["reconcile",n]);
    return {concluido:2,falhou:1};
   },
   Failure:class Failure extends Error{constructor(message,status){super(message);this.status=status;}},
   respond:obj=>obj
  };
  const fn=vm.runInNewContext(source+"\nexecutarWorkerWebhooksAsaas",env);
  const req={headers:{get:()=>correct?secret:"invasor-nao-autorizado"}};
  try{return {result:await fn(req),calls};}
  catch(error){return {error,calls};}
 }
 const invalid=await run({correct:false});
 assert.equal(invalid.error.status,401);
 assert.equal(invalid.calls.length,0,"token errado nao pode consultar Asaas");
 const off=await run({workerOn:false});
 assert.equal(off.error.status,503);
 assert.equal(off.calls.length,0,"rotina desligada nao invoca Asaas");
 const billingOff=await run({enabledOn:false});
 assert.match(billingOff.error.message,/Faturamento nao ativado/);
 assert.deepEqual(JSON.parse(JSON.stringify(billingOff.calls)),[["enabled","billing"]]);
 const short=await run({token:"123"});
 assert.equal(short.error.status,503);
 assert.equal(short.calls.length,0);
 const good=await run();
 assert.equal(good.result.success,true);
 assert.equal(good.result.processados,2);
 assert.equal(good.result.em_erro,1);
 assert.deepEqual(JSON.parse(JSON.stringify(good.calls)),[["enabled","billing"],["reconcile",10]]);
 assert.doesNotMatch(source.replace(/\/\/[^\n]*/g,""),/\/transfers|\/payments|POST.*Pix|autorizar_saque/i);
});

test("COB-05: cron STAGING tem preflight Vault, URL exata e não duplica agendamento",()=>{
 const cron=fs.readFileSync("supabase/staging-only/asaas_cob05_cron_worker_20261012.sql","utf8");
 const extension=fs.readFileSync("supabase/staging-only/asaas_cob05_habilitar_pg_net_20261012.sql","utf8");
 assert.match(cron,/SOMENTE STAGING jbttwihctuibchhcyqtl/);
 assert.match(extension,/CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions/);
 assert.match(cron,/SELECT cron\.schedule\(/);
 assert.match(cron,/guia-asaas-reconciliar-webhook/);
 assert.match(cron,/\*\/2 \* \* \* \*/);
 assert.match(cron,/IF EXISTS \(SELECT 1 FROM cron\.job/);
 assert.match(cron,/guia_asaas_webhook_worker_token_v1/);
 assert.match(cron,/guia_asaas_webhook_worker_url_v1/);
 assert.match(cron,/length\(token\)>=48/);
 assert.match(cron,/x-guia-asaas-worker-token/);
 assert.match(cron,/jbttwihctuibchhcyqtl\.supabase\.co\/functions\/v1\/catalogo-asaas-financeiro\/cron-webhooks/);
 assert.doesNotMatch(cron,/ASAAS_API_KEY|SUPABASE_SERVICE_ROLE_KEY|\/transfers|\/payments/);
});


test("COB-05: worker Edge reprocessa falha apenas após backoff, com nova tentativa e sem duplicar",async()=>{
 // Cenário inteiramente simulado no Node, sem criar eventos no STAGING
 // e sem reprocessar qualquer webhook real já concluído.
 const first=edge.indexOf("async function processarWebhooksAsaasPendentes(limit=5){");
 const last=edge.indexOf("async function webhook(request:Request){",first);
 assert.ok(first>=0 && last>first,"worker Edge deve existir");
 const source=edge.slice(first,last)
   .replace(" as unknown as AsaasWebhookPendente","")
   .replace(/\(e as Error\)\.name/g,"e.name");
 const queue={
   id:"evt-unit-backoff",evento:"PAYMENT_RECEIVED",
   recurso_id:"pay-unit-only",referencia_externa:"test-unit",
   estado:"pendente",tentativas:0,token:null,proxima_tentativa:0
 };
 let segundos=0,consultasRemotas=0;
 const finalizacoes=[],claims=[];
 const rpc=async(name,args)=>{
   if(name==="catalogo_asaas_webhook_claim"){
     claims.push(args.p_limite);
     assert.ok(args.p_limite<=10);
     const elegivel=queue.estado==="pendente" ||
       (queue.estado==="erro" && segundos>=queue.proxima_tentativa);
     if(!elegivel)return [];
     queue.estado="processando";
     queue.tentativas++;
     queue.token="lease-"+queue.tentativas;
     return [{
       id:queue.id,evento:queue.evento,recurso_id:queue.recurso_id,
       tentativa_token:queue.token,referencia_externa:queue.referencia_externa
     }];
   }
   if(name==="catalogo_asaas_webhook_finalizar"){
     finalizacoes.push({id:args.p_id,token:args.p_token,sucesso:args.p_sucesso});
     if(args.p_id!==queue.id || queue.estado!=="processando" || args.p_token!==queue.token)
       return {ok:false};
     queue.token=null;
     if(args.p_sucesso)queue.estado="concluido";
     else{
       queue.estado="erro";
       queue.proxima_tentativa=segundos+Math.min(900,30*2**Math.min(queue.tentativas-1,5));
     }
     return {ok:true};
   }
   throw new Error("RPC inesperada: "+name);
 };
 const context={
   rpc,
   input:x=>x&&typeof x==="object"&&!Array.isArray(x)?x:{},
   processarEventoAsaasPendente:async()=>{
     consultasRemotas++;
     if(consultasRemotas===1)throw new Error("Indisponibilidade transitória simulada");
   },
   Failure:class Failure extends Error{constructor(message,status){super(message);this.status=status;}},
   console:{error(){}}
 };
 const worker=vm.runInNewContext(source+"\nprocessarWebhooksAsaasPendentes",context);
 const primeira=await worker(10);
 assert.equal(primeira.concluido,0);
 assert.equal(primeira.falhou,1);
 assert.equal(queue.estado,"erro");
 assert.equal(queue.tentativas,1);
 assert.equal(queue.proxima_tentativa,30);
 assert.deepEqual(finalizacoes.map(x=>x.sucesso),[false]);
 // Cron antes do backoff não reivindica o evento nem chama o provedor.
 segundos=29;
 const cedo=await worker(10);
 assert.equal(cedo.concluido,0);
 assert.equal(cedo.falhou,0);
 assert.equal(consultasRemotas,1);
 assert.equal(queue.tentativas,1);
 // Depois do backoff há novo lease e conclusão do mesmo evento.
 segundos=30;
 const recuperado=await worker(10);
 assert.equal(recuperado.concluido,1);
 assert.equal(recuperado.falhou,0);
 assert.equal(queue.estado,"concluido");
 assert.equal(queue.tentativas,2);
 assert.equal(consultasRemotas,2);
 assert.deepEqual(finalizacoes.map(x=>x.token),["lease-1","lease-2"]);
 assert.deepEqual(finalizacoes.map(x=>x.sucesso),[false,true]);
 // Repetição posterior não gera uma segunda conciliação.
 segundos=999;
 const duplicado=await worker(10);
 assert.equal(duplicado.concluido,0);
 assert.equal(duplicado.falhou,0);
 assert.equal(consultasRemotas,2);
 assert.deepEqual(claims,[10,10,10,10]);
});
