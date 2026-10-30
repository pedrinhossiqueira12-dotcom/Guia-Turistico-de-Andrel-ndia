"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {stripTypeScriptTypes}=require("node:module");
const vm=require("node:vm");
const source=readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");
const environmentSource=readFileSync("supabase/functions/_shared/catalogo-asaas-ambiente-projeto.ts","utf8");
const code=stripTypeScriptTypes(environmentSource.replace(/^export /gm,"")+"\n"+
 source.replace(/^import .*;\s*$/gm,""),{mode:"transform"});

// Executa o handler real com o padrao VM/stripTypeScriptTypes existente.
// Nenhuma biblioteca externa, banco, segredo ou fetch real e carregado.
function harness(options={}){
 const production=options.environment==="production";
 const env={SUPABASE_URL:production?"https://xdmbkflufsfqziixzpxc.supabase.co":"https://local.invalid",
  ASAAS_ENVIRONMENT:production?"production":"sandbox",ASAAS_API_KEY:"key-fixture",
  ASAAS_BILLING_ENABLED:"true",ASAAS_PRODUCTION_BILLING_APPROVED:"true",
  ASAAS_WEBHOOK_WORKER_ENABLED:"true",ASAAS_WEBHOOK_WORKER_TOKEN:"w".repeat(48),
  ASAAS_WEBHOOK_TOKEN:"h".repeat(32),ASAAS_PAYOUTS_ENABLED:"false",
  ASAAS_SAQUE_VALIDACAO_ENABLED:"false",ASAAS_ISSUANCE_ENABLED:options.issuance,
  ...options.env};
 const calls={reads:[],writes:[],http:[],rpc:[]};
 const payment={id:"pay_fixture",customer:"cus_fixture",billingType:"PIX",value:7,
  externalReference:"fatura-loja-fixture-2026-10",status:options.providerStatus||"RECEIVED"};
 const db={auth:{async getUser(token){return {data:{user:token==="fixture"?
  {id:"owner-fixture",email:"owner@example.invalid"}:null},error:null};}},
  from(table){
   calls.reads.push(table);
   let write=false;
   const query={select(){return query;},eq(){return query;},
    insert(row){write=true;calls.writes.push({table,row});return query;},
    async maybeSingle(){
     const rows={catalogos:options.foreignOwner?null:{comercio_id:"loja-fixture"},
      catalogo_cobranca_preferencias:{metodo:options.automatic?"pix_automatico":"pix"},
      catalogo_fechamentos_offline:{id:"closing-fixture",status:options.invoiceStatus||"faturado",
       total_comissao_centavos:options.total??700,vencimento_em:"2026-10-31"},
      catalogo_fatura_cobrancas:options.existing?{gateway:"asaas",order_id:payment.id,
       valor_centavos:700,status:"pendente"}:null,
      catalogo_asaas_emissoes:null,catalogo_asaas_clientes:{cliente_id:payment.customer}};
     assert.ok(Object.hasOwn(rows,table),"leitura inesperada: "+table);
     return {data:rows[table],error:null};
    },
    async single(){assert.ok(write);return {data:{operacao_id:"claim-fixture"},error:null};}
   };return query;
  },async rpc(name,args){
   calls.rpc.push({name,args});
   assert.ok(["catalogo_confirmar_cobranca_fatura","catalogo_asaas_registrar_fatura"].includes(name));
   return {data:{ok:true,status:"pago",order_id:payment.id,cobranca_id:"charge-fixture"},error:null};
  }};
 let handler;
 const context={createClient:()=>db,Deno:{env:{get:name=>env[name]},serve:fn=>handler=fn},
  Request,Response,URL,AbortSignal,TextEncoder,TextDecoder,crypto:globalThis.crypto,
  console:{error(){}},async fetch(url,init){
   // Nao ha delegacao ao fetch do host, inclusive se ocorrer caminho inesperado.
   const path=new URL(url).pathname.replace(/^\/v3/,"");
   calls.http.push({path,method:init.method});
   if(init.method==="GET" && path==="/payments")return Response.json({data:[],hasMore:false});
   if(init.method==="POST" && path==="/payments")return Response.json(payment);
   if(init.method==="GET" && path==="/payments/"+payment.id)return Response.json(payment);
   throw new Error("HTTP mock inesperado");
  }};
 vm.createContext(context);
 vm.runInContext(code+"\nglobalThis.transport=asaas;",context);
 return {calls,transport:context.transport,async request(action="criar_cobranca",token="fixture",extra={}){
  const response=await handler(new Request("https://local.invalid/functions/v1/catalogo-asaas-financeiro",{
   method:"POST",headers:{"Content-Type":"application/json",...(token?{authorization:"Bearer "+token}:{})},
   body:JSON.stringify({acao:action,comercio_id:"loja-fixture",competencia:"2026-10",...extra})}));
  return {status:response.status,body:await response.json()};
 }};
}
function noEffects(h){assert.equal(h.calls.writes.length,0);assert.equal(h.calls.rpc.length,0);assert.equal(h.calls.http.length,0);}

for(const environment of ["sandbox","production"]){
 for(const issuance of [undefined,"false","TRUE","1"," true ","invalid",""]){
  test(`${environment}: emissao ${JSON.stringify(issuance)} negada antes de banco/reserva/provedor`,async()=>{
   const h=harness({environment,issuance});
   const out=await h.request("criar_cobranca","fixture",{ASAAS_ISSUANCE_ENABLED:true});
   assert.equal(out.status,503);assert.match(out.body.mensagem,/emissão Asaas desativada/);
   assert.equal(h.calls.reads.length,0);noEffects(h);
  });
 }
 test(`${environment}: conciliacao autorizada preservada com emissao OFF`,async()=>{
  const h=harness({environment,issuance:"false",existing:true});
  const out=await h.request("consultar_cobranca");
  assert.equal(out.status,200);assert.equal(out.body.cobranca_status,"pago");
  assert.equal(h.calls.http.length,1);assert.equal(h.calls.http[0].method,"GET");
  assert.equal(h.calls.rpc.length,1);assert.equal(h.calls.rpc[0].name,"catalogo_confirmar_cobranca_fatura");
  assert.equal(h.calls.rpc[0].args.p_estado,"pago");assert.equal(h.calls.writes.length,0);
 });
 test(`${environment}: true permite somente o fluxo com demais requisitos atendidos`,async()=>{
  const h=harness({environment,issuance:"true"});
  const out=await h.request();assert.equal(out.status,200);
  assert.equal(h.calls.writes.length,1);assert.equal(h.calls.writes[0].table,"catalogo_asaas_emissoes");
  assert.equal(h.calls.http.filter(x=>x.method==="POST"&&x.path==="/payments").length,1);
 });
}

test("true nao substitui billing, chave, aprovacao produtiva, worker ou ambiente",async()=>{
 const cases=[{env:{ASAAS_BILLING_ENABLED:"false"}},{env:{ASAAS_API_KEY:""}},
  {environment:"production",env:{ASAAS_PRODUCTION_BILLING_APPROVED:"false"}},
  {environment:"production",env:{ASAAS_WEBHOOK_WORKER_ENABLED:"false"}},
  {environment:"production",env:{ASAAS_WEBHOOK_WORKER_TOKEN:"curto"}},
  {environment:"production",env:{ASAAS_WEBHOOK_TOKEN:"curto"}},
  {env:{ASAAS_ENVIRONMENT:"invalid"}}];
 for(const options of cases){const h=harness({issuance:"true",...options});assert.equal((await h.request()).status,503);noEffects(h);}
});
test("true nao amplia autenticacao, propriedade, elegibilidade, minimo ou Pix Automatico",async()=>{
 const anonymous=harness({issuance:"true"});assert.equal((await anonymous.request("criar_cobranca","")).status,401);noEffects(anonymous);
 const foreignOwner=harness({issuance:"true",foreignOwner:true});
 assert.equal((await foreignOwner.request()).status,403);
 assert.deepEqual(foreignOwner.calls.reads,["catalogos"]);
 noEffects(foreignOwner);
 for(const [options,status] of [[{invoiceStatus:"pago"},409],
  [{total:499},409],[{total:700.5},503],[{automatic:true},503]]){
  const h=harness({issuance:"true",...options});assert.equal((await h.request()).status,status);noEffects(h);
 }
});
test("conciliacao OFF nao se torna publica nem ignora billing/owner",async()=>{
 for(const [options,token,status] of [[{},"",401],[{foreignOwner:true},"fixture",403],
  [{env:{ASAAS_BILLING_ENABLED:"false"}},"fixture",503]]){
  const h=harness({issuance:"false",existing:true,...options});
  assert.equal((await h.request("consultar_cobranca",token)).status,status);noEffects(h);
 }
});
test("defesa no transporte impede mutacoes de clientes/pagamentos sem reserva ou HTTP",async()=>{
 const h=harness({issuance:"false"});
 for(const path of ["/payments","/payments?x=1","/payments/pay_fixture","/customers","/customers/cus_fixture"]){
  await assert.rejects(h.transport(path,"POST",{}),e=>e.status===503);
 }
 noEffects(h);
});
test("emissao OFF nao recupera via criar_cobranca nem prepara reserva de cobranca existente",async()=>{
 const h=harness({issuance:"false",existing:true});
 assert.equal((await h.request()).status,503);assert.equal(h.calls.reads.length,0);noEffects(h);
});
test("opt-in de emissao nao autoriza POST de transferencia em nenhum ambiente",async()=>{
 for(const environment of ["sandbox","production"]){
  const h=harness({environment,issuance:"true"});
  await assert.rejects(h.transport("/transfers","POST",{}),e=>e.status===503);noEffects(h);
 }
});
test("actions alternativas nao emitem e true nao habilita saque, Money Out ou Pix Automatico",async()=>{
 for(const issuance of ["false","true"]){
  const h=harness({issuance});
  for(const action of ["emitir_pix","criar_pagamento","pix_automatico","money_out","solicitar_saque"]){
   const out=await h.request(action);assert.ok([400,503].includes(out.status));
  }noEffects(h);
 }
});
test("inventario de emissao: unica action e unico chamador do cadastro; nenhum novo caminho",()=>{
 assert.equal((source.match(/return await createInvoice\(/g)||[]).length,1);
 assert.match(source,/case "criar_cobranca":return await createInvoice/);
 assert.equal((source.match(/await loadOrCreateCustomer\(/g)||[]).length,1);
 assert.equal((source.match(/asaas\("\/payments","POST"/g)||[]).length,1);
 assert.equal((source.match(/asaas\("\/customers","POST"/g)||[]).length,1);
});
