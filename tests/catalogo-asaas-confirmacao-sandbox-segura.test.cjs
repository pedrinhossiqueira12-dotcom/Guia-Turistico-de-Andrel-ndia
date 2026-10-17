"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");

const edge=fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");
const start=edge.indexOf("async function confirmarFaturaSandboxAdmin(");
const end=edge.indexOf("// Recuperação segura",start);
assert.ok(start>=0&&end>start,"Confirmacao sandbox nao localizada");
const source=edge.slice(start,end).replace(
 "async function confirmarFaturaSandboxAdmin(uid:string,body:Record<string,unknown>)",
 "async function confirmarFaturaSandboxAdmin(uid,body)");

const QA="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID="11111111-1111-4111-8111-111111111111";
const PAYMENT="pay_ci_12345";
class Failure extends Error{
 constructor(message,status=409){super(message);this.status=status;}
}
function fixture({environment="sandbox",admin=QA,flag=true,closed=false,
 remoteStatus="PENDING",remoteOverride={},localOverride={},fOverride={},
 customer="cus_ci_001"}={}){
 const f={id:ID,comercio_id:"loja-ci",competencia:"2026-10-01",
  status:closed?"pago":"faturado",total_comissao_centavos:7000,...fOverride};
 const charge={fechamento_id:ID,comercio_id:"loja-ci",competencia:"2026-10-01",
  gateway:"asaas",order_id:PAYMENT,status:"pendente",valor_centavos:7000,...localOverride};
 const remote={id:PAYMENT,customer,billingType:"PIX",value:70,
  externalReference:"fatura-loja-ci-2026-10",status:remoteStatus,...remoteOverride};
 const state={tableReads:[],providerCalls:[],posts:0,remote,enabled:[]};
 const db={from(name){
  state.tableReads.push(name);
  const query={
   select(){return query;},eq(){return query;},
   async maybeSingle(){
    const rows={
     catalogo_fatura_cobrancas:{data:charge,error:null},
     catalogo_fechamentos_offline:{data:f,error:null},
     catalogo_asaas_clientes:{data:{cliente_id:customer},error:null}
    };
    assert.ok(rows[name],"Consulta inesperada "+name);
    return rows[name];
   }
  };
  return query;
 }};
 const asaas=async(path,method="GET",body)=>{
  state.providerCalls.push({path,method,body});
  if(path==="/payments/"+PAYMENT && method==="GET")return {...state.remote};
  if(path==="/sandbox/payment/"+PAYMENT+"/confirm" && method==="POST"){
   state.posts++;
   state.remote.status="RECEIVED";
   return {...state.remote};
  }
  throw Error("HTTP inesperado "+method+" "+path);
 };
 const context={Deno:{env:{get:name=>{
  if(name==="ASAAS_SANDBOX_ADMIN_USER_ID")return admin;
  if(name==="ASAAS_SANDBOX_QA_CONFIRM_ENABLED")return flag?"true":"false";
  return "";
 }}},ENVIRONMENT:environment,enabled:kind=>state.enabled.push(kind),
  db,asaas,Failure,
  input:x=>x&&typeof x==="object"?x:{},
  check:(v,msg,status=409)=>{if(!v)throw new Failure(msg,status);},
  value:(x,max=200)=>typeof x==="string"?x.trim().slice(0,max):"",
  cents:x=>typeof x==="number"&&Number.isSafeInteger(x*100)?x*100:NaN,
  reference:(store,month)=>"fatura-"+store+"-"+month,
  respond:x=>x,encodeURIComponent,Number,Boolean,String,Array,Date};
 const confirm=vm.runInNewContext(source+"\nconfirmarFaturaSandboxAdmin",context);
 return {state,confirm,charge,f,body:{fechamento_id:ID}};
}

test("admin, flag e ambiente sandbox obrigatorios antes de qualquer GET",async()=>{
 for(const settings of [
  {environment:"production"},
  {admin:""},
  {admin:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}
 ]){
  const x=fixture(settings);
  await assert.rejects(x.confirm(QA,x.body),e=>e.status===403);
  assert.equal(x.state.tableReads.length,0);
  assert.equal(x.state.providerCalls.length,0);
 }
 const x=fixture({flag:false});
 await assert.rejects(x.confirm(QA,x.body),e=>e.status===503);
 assert.equal(x.state.tableReads.length,0);
 assert.equal(x.state.providerCalls.length,0);
});
test("apenas cobranca aberta, vinculada, Asaas e PIX pode simular",async()=>{
 for(const cfg of [
  {closed:true},
  {localOverride:{gateway:"mercadopago"}},
  {localOverride:{status:"pago"}},
  {localOverride:{valor_centavos:6800}},
  {localOverride:{comercio_id:"loja-outra"}},
  {fOverride:{total_comissao_centavos:0}}
 ]){
  const x=fixture(cfg);
  await assert.rejects(x.confirm(QA,x.body),e=>e.status===409);
  assert.equal(x.state.providerCalls.length,0);
  assert.equal(x.state.posts,0);
 }
});
test("rejeita identidade, tipo e valor do banco divergentes antes do POST",async()=>{
 for(const override of [
  {id:"pay_outra_9999"},
  {customer:"cus_intruso"},
  {billingType:"BOLETO"},
  {externalReference:"fatura-loja-intrusa-2026-10"},
  {value:75}
 ]){
  const x=fixture({remoteOverride:override});
  await assert.rejects(x.confirm(QA,x.body),e=>e.status===409);
  assert.equal(x.state.posts,0);
  assert.equal(x.state.providerCalls.length,1,"Somente GET de conferencia ao Asaas");
 }
});
test("somente PENDING/OVERDUE permitem confirmar; CONFIRMED/RECEIVED nao repetem POST",async()=>{
 for(const status of ["CONFIRMED","RECEIVED"]){
  const x=fixture({remoteStatus:status});
  const result=await x.confirm(QA,x.body);
  assert.equal(result.simulacao_enviada,false);
  assert.equal(result.status_bancario,status);
  assert.equal(x.state.posts,0);
 }
 for(const status of ["REFUNDED","CHARGEBACK_REQUESTED","DELETED","UNKNOWN"]){
  const x=fixture({remoteStatus:status});
  await assert.rejects(x.confirm(QA,x.body),e=>e.status===409);
  assert.equal(x.state.posts,0);
 }
});
test("simula pagamento exclusivamente na rota Asaas Sandbox, sem gravar SQL ou disparar saque",async()=>{
 for(const status of ["PENDING","OVERDUE"]){
  const x=fixture({remoteStatus:status});
  const first=await x.confirm(QA,x.body);
  assert.equal(first.success,true);
  assert.equal(first.simulacao_enviada,true);
  assert.equal(x.state.posts,1);
  assert.equal(x.state.enabled[0],"billing");
  assert.deepEqual(x.state.providerCalls.map(c=>c.method),["GET","POST"]);
  assert.equal(x.state.providerCalls[1].path,"/sandbox/payment/"+PAYMENT+"/confirm");
  assert.deepEqual(x.state.tableReads,[
   "catalogo_fatura_cobrancas","catalogo_fechamentos_offline","catalogo_asaas_clientes"]);
  const replay=await x.confirm(QA,x.body);
  assert.equal(replay.simulacao_enviada,false);
  assert.equal(x.state.posts,1,"Nao repetir POST de simulacao ja confirmada");
 }
});
test("UI pede confirmacao humana e nenhuma credencial de API Asaas fica no navegador",()=>{
 const js=fs.readFileSync("js/entregas-operacao.js","utf8");
 const part=js.slice(js.indexOf("async function confirmarPagamentoSandboxAsaas("),
  js.indexOf("async function verificarFilaWebhookAsaas("));
 assert.ok(part.includes("window.confirm("));
 assert.ok(part.includes('"confirmar_fatura_sandbox_admin"'));
 assert.doesNotMatch(part,/ASAAS_API_KEY|access_token|api-sandbox\.asaas\.com|service_role/);
 assert.ok(js.includes('data-asaas-qa-confirmar'));
});
