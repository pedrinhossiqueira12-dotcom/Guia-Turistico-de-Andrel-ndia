"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const edge=fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");
const between=(a,b)=>{
 const start=edge.indexOf(a);
 const end=edge.indexOf(b,start);
 assert.ok(start>=0&&end>start,"Missing financial function "+a);
 return edge.slice(start,end);
};
const issuance=between("function requireIssuance(){","function check(");
const verified=between("async function verifyInvoice(","async function loadOrCreateCustomer(")
 .replace("async function verifyInvoice(paymentId:string,charge:Record<string,unknown>,store:string,month:string)",
  "async function verifyInvoice(paymentId,charge,store,month)")
 .replace('let estado:"pago"|"pendente"|"estornado"|"contestado"|"cancelado"="pendente";',
  'let estado="pendente";');
const reconciled=between("async function reconcileInvoice(","async function createInvoice(")
 .replace("async function reconcileInvoice(uid:string,body:Record<string,unknown>)",
  "async function reconcileInvoice(uid,body)");
const created=between("async function createInvoice(","function pixDestination(")
 .replace("async function createInvoice(uid:string,body:Record<string,unknown>,email:string)",
  "async function createInvoice(uid,body,email)")
 .replace(/\(p:Record<string,unknown>\)/g,"(p)");
const worker=between("async function processarEventoAsaasPendente(","async function processarWebhooksAsaasPendentes(")
 .replace("async function processarEventoAsaasPendente(row:AsaasWebhookPendente)",
  "async function processarEventoAsaasPendente(row)");

function fixture(){
 const store="loja-ci-001",month="2026-10",customer="cus-ci-001";
 const f={id:"fechamento-ci-001",comercio_id:store,competencia:month+"-01",
  total_comissao_centavos:7000,status:"faturado",vencimento_em:"2026-10-30"};
 const state={f,charge:null,claim:false,provider:[],events:[],posts:0,qrs:0,
   reconciles:[],rpcCalls:[],providerCalls:[],getErrors:0,customer,
   customerLoads:0,customerExpected:[],registrarAckOverride:undefined};
 let counter=0;
 const clientQuery=(table)=>{
  const conditions={};
  const q={
   select(){return q;},
   eq(k,v){conditions[k]=v;return q;},
   async maybeSingle(){
    if(table==="catalogo_cobranca_preferencias")
     return {data:{metodo:"pix_manual"},error:null};
    if(table==="catalogo_asaas_clientes")
     return {data:{cliente_id:state.customer},error:null};
    if(table==="catalogo_fatura_cobrancas")
     return {data:state.charge?.order_id===conditions.order_id?state.charge:null,error:null};
    throw Error("Unexpected table "+table);
   },
   insert(){
    assert.equal(table,"catalogo_asaas_emissoes");
    return {select:()=>({single:async()=>{
      if(state.claim)return {data:null,error:{code:"23505"}};
      state.claim=true;
      return {data:{operacao_id:"operacao-ci"},error:null};
    }})};
   }
  };
  return q;
 };
 const asaas=async(path,method="GET",body)=>{
  state.providerCalls.push({path,method});
  if(path.startsWith("/payments?")){
   return {data:state.provider.filter(p=>p.externalReference===
    new URL("https://fixture.invalid"+path).searchParams.get("externalReference"))};
  }
  if(path==="/payments"&&method==="POST"){
   state.posts++;
   const payment={id:"pay_ci_"+(++counter),customer:body.customer,
     value:body.value,billingType:body.billingType,
     externalReference:body.externalReference,status:"PENDING",
     invoiceUrl:"https://sandbox.invalid/pagamento-ci"};
   state.provider.push(payment);
   return payment;
  }
  if(path.endsWith("/pixQrCode")){
   state.qrs++;
   return {payload:"PIX-SANDBOX-SOMENTE-TESTE",
    encodedImage:"QR-BASE64-ISOLADO",expirationDate:null};
  }
  if(path.startsWith("/payments/")){
   const id=decodeURIComponent(path.split("/").pop());
   const item=state.provider.find(p=>p.id===id);
   if(!item)throw Error("Provider payment not found "+id);
   return {...item};
  }
  throw Error("Unexpected provider request "+method+" "+path);
 };
 class Failure extends Error{constructor(message,status=409){super(message);this.status=status;}}
 const context={
  ASAAS_COBRANCA_MINIMA_CENTAVOS:500,
  ISSUANCE_ON:true,
  db:{from:clientQuery},asaas,
  enabled:kind=>assert.equal(kind,"billing"),
  invoice:async()=>({f:state.f,charge:state.charge,store,month}),
  listarAsaasPorReferencia:async(tipo,ref)=>{
   assert.equal(tipo,"payments");
   return state.provider.filter(p=>p.externalReference===ref);
  },
  loadOrCreateCustomer:async(_store,_body,_email,expected)=>{
   state.customerLoads++;state.customerExpected.push(expected);
   if(expected&&expected!==state.customer)throw new Failure("Pagador externo divergente",409);
   return state.customer;
  },
  reference:(s,m)=>"fatura-"+s+"-"+m,
  commerce:x=>x,competence:x=>x,money:c=>Math.round(c)/100,
  cents:x=>typeof x==="number"?Math.round(x*100):NaN,
  input:x=>x&&typeof x==="object"&&!Array.isArray(x)?x:{},
  value:(x,max=200)=>typeof x==="string"?x.trim().slice(0,max):"",
  parsePix:(payment,qr)=>({code:typeof qr.payload==="string"?qr.payload:"",
   imageBase64:typeof qr.encodedImage==="string"?qr.encodedImage:"",
   ticketUrl:typeof payment.invoiceUrl==="string"?payment.invoiceUrl:""}),
  check:(ok,msg,status=409)=>{if(!ok)throw new Failure(msg,status);},
  Failure,
  respond:x=>x,encodeURIComponent,Date,Number,String,Boolean,Array,
  rpc:async(name,params)=>{
   state.rpcCalls.push({name,params});
   if(name==="catalogo_asaas_registrar_fatura"){
    if(state.registrarAckOverride!==undefined)
     return state.registrarAckOverride;
    state.charge={comercio_id:store,competencia:month+"-01",
     gateway:"asaas",order_id:params.p_payment,
     valor_centavos:params.p_valor,status:"pendente"};
    return {ok:true,cobranca_id:"charge-ci",order_id:params.p_payment};
   }
   if(name==="catalogo_confirmar_cobranca_fatura"){
    state.reconciles.push(params);
    if(state.charge)state.charge.status=params.p_estado;
    if(params.p_estado==="pago")state.f.status="pago";
    return {ok:true,status:params.p_estado};
   }
   throw Error("Unknown SQL RPC "+name);
  },
  ENVIRONMENT:"sandbox",
  consultarERegistrarTransferenciaExcepcionalSandbox:async()=>{throw Error("Money out forbidden")},
  reconcileTransfer:async()=>{throw Error("Money out forbidden")}
 };
 const js=issuance+"\n"+verified+"\n"+reconciled+"\n"+created+"\n"+worker+
   "\n({verifyInvoice,reconcileInvoice,createInvoice,processarEventoAsaasPendente})";
 const funcs=vm.runInNewContext(js,context);
 return {state,funcs,body:{comercio_id:store,competencia:month},
  payment:()=>state.provider[0],request:()=>funcs.createInvoice("owner-ci",
   {comercio_id:store,competencia:month,documento:"12345678901",nome_pagador:"Loja Teste"},
    "teste@example.invalid")};
}
test("fatura inteira: emitir 1 Pix -> webhook RECEIVED -> baixa uma vez -> replay nao gera Pix",async()=>{
 const x=fixture();
 const original=await x.request();
 assert.equal(original.cobranca_status,"pendente");
 assert.equal(original.pix.code,"PIX-SANDBOX-SOMENTE-TESTE");
 assert.equal(x.state.posts,1);
 assert.equal(x.state.qrs,1);
 const repeat=await x.request();
 assert.equal(repeat.cobranca_status,"pendente");
 assert.equal(x.state.posts,1,"Dois cliques nao devem gerar outro POST no Asaas");
 const payment=x.payment();
 payment.status="RECEIVED";
 await x.funcs.processarEventoAsaasPendente({
  evento:"PAYMENT_RECEIVED",recurso_id:payment.id,referencia_externa:payment.externalReference
 });
 assert.equal(x.state.charge.status,"pago");
 assert.equal(x.state.reconciles.length,2,"Consulta pendente e webhook devem conciliar");
 assert.equal(x.state.reconciles[0].p_estado,"pendente");
 assert.equal(x.state.reconciles[1].p_estado,"pago");
 const settled=await x.funcs.reconcileInvoice("owner-ci",x.body);
 assert.equal(settled.cobranca_status,"pago");
 assert.equal(settled.pix.code,"");
 assert.equal(x.state.posts,1);
 assert.equal(x.state.qrs,2,"Consulta de recebimento nao deve solicitar novo QR");
 await x.funcs.processarEventoAsaasPendente({
  evento:"PAYMENT_RECEIVED",recurso_id:payment.id,referencia_externa:payment.externalReference
 });
 assert.equal(x.state.posts,1,"Webhook repetido nao emite cobrança");
 assert.equal(x.state.reconciles.length,4,"RPC de conciliacao recebe evento reentregue sem POST Pix");
});
test("emissao reservada apos timeout recupera pagamento remoto sem novo POST",async()=>{
 const x=fixture();
 x.state.claim=true;
 x.state.provider.push({id:"pay_ci_existing",customer:"cus-ci-001",
  value:70,billingType:"PIX",externalReference:"fatura-loja-ci-001-2026-10",
  status:"PENDING",invoiceUrl:"https://sandbox.invalid/pay-ci"});
 const r=await x.request();
 assert.equal(r.order_id,"pay_ci_existing");
 assert.deepEqual(x.state.customerExpected,["cus-ci-001"],
  "recuperacao deve vincular exatamente o pagador da cobranca antiga");
 assert.equal(x.state.posts,0);
 assert.equal(x.state.charge.order_id,"pay_ci_existing");
});
test("emissao reservada sem pagamento visivel bloqueia para evitar duplicacao",async()=>{
 const x=fixture();x.state.claim=true;
 await assert.rejects(x.request(),e=>e.status===409&&/Não é seguro emitir outro Pix/.test(e.message));
 assert.equal(x.state.posts,0);
 assert.equal(x.state.customerLoads,0,"claim concorrente nao pode criar cliente remoto");
 assert.equal(x.state.rpcCalls.length,0);
});
test("duas cobrancas remotas com mesma referencia exigem revisao humana",async()=>{
 const x=fixture();
 for(let i=0;i<2;i++)x.state.provider.push({
  id:"pay_ci_dup_"+i,customer:"cus-ci-001",value:70,
  billingType:"PIX",externalReference:"fatura-loja-ci-001-2026-10",status:"PENDING"
 });
 await assert.rejects(x.request(),e=>e.status===409&&/mais de uma cobrança/.test(e.message));
 assert.equal(x.state.posts,0);
 assert.equal(x.state.charge,null);
});
for(const status of ["REFUNDED","DELETED","PARTIALLY_REFUNDED","REFUND_IN_PROGRESS",
 "CHARGEBACK_REQUESTED","UNKNOWN_PROVIDER_STATUS"]){
 test("cobranca "+status+" nunca reabre QR Pix apos perda de resposta",async()=>{
  const x=fixture();x.state.claim=true;
  x.state.provider.push({id:"pay_ci_old",customer:"cus-ci-001",
   value:70,billingType:"PIX",externalReference:"fatura-loja-ci-001-2026-10",
   status,invoiceUrl:"https://sandbox.invalid/pay-ci"});
  await assert.rejects(x.request(),e=>e.status===409);
  assert.equal(x.state.posts,0);
  assert.equal(x.state.qrs,0);
  assert.equal(x.state.charge,null);
 });
}
test("Pix CONFIRMED pelo Asaas nao libera credito nem apresenta QR ate RECEIVED",async()=>{
 const x=fixture();
 x.state.claim=true;
 x.state.provider.push({id:"pay_ci_confirmed",customer:"cus-ci-001",
  value:70,billingType:"PIX",externalReference:"fatura-loja-ci-001-2026-10",
  status:"CONFIRMED",invoiceUrl:"https://sandbox.invalid/pay-ci"});
 const created=await x.request();
 assert.equal(created.cobranca_status,"pendente");
 assert.equal(created.pix.code,"");
 assert.match(created.mensagem,/Não realize outro Pix/);
 assert.equal(x.state.qrs,0);
 assert.equal(x.state.reconciles.length,0);
 const status=await x.funcs.reconcileInvoice("owner-ci",x.body);
 assert.equal(status.cobranca_status,"pendente");
 assert.equal(status.pix.code,"");
 assert.match(status.mensagem,/em confirmação/i);
 assert.equal(x.state.reconciles[0].p_estado,"pendente");
 x.payment().status="RECEIVED";
 await x.funcs.processarEventoAsaasPendente({
  evento:"PAYMENT_RECEIVED",recurso_id:x.payment().id
 });
 assert.equal(x.state.reconciles.at(-1).p_estado,"pago");
 assert.equal(x.state.qrs,0);
 assert.equal(x.state.posts,0);
});
test("pagador ou valor divergente impede salvar fatura recuperada",async()=>{
 for(const field of ["customer","value"]){
  const x=fixture();x.state.claim=true;
  const p={id:"pay_ci_bad",customer:"cus-ci-001",
   value:70,billingType:"PIX",externalReference:"fatura-loja-ci-001-2026-10",
   status:"PENDING"};
  p[field]=field==="customer"?"cus_impostor":99;
  x.state.provider.push(p);
  await assert.rejects(x.request(),e=>e.status===409);
  assert.equal(x.state.posts,0);
  assert.equal(x.state.qrs,0);
  assert.equal(x.state.charge,null);
 }
});
test("chargeback/estorno apos fatura paga nao autoriza QR nem volta a emitir",async()=>{
 const x=fixture();
 await x.request();
 x.payment().status="RECEIVED";
 await x.funcs.processarEventoAsaasPendente({
  evento:"PAYMENT_RECEIVED",recurso_id:x.payment().id
 });
 for(const [status,expected] of [["REFUNDED","estornado"],["CHARGEBACK_REQUESTED","contestado"]]){
  x.payment().status=status;
  const r=await x.funcs.reconcileInvoice("owner-ci",x.body);
  assert.equal(r.cobranca_status,expected);
  assert.equal(r.pix.code,"");
  assert.equal(x.state.reconciles.at(-1).p_estado,expected);
  assert.equal(x.state.posts,1);
 }
});


test("fatura criada no Asaas SEM ACK confirmado do banco nunca aparenta sucesso",async()=>{
 for(const invalid of [
  null,
  {ok:false,mensagem:"SQL recusou o fechamento"},
  {ok:true,order_id:"pay_outro",cobranca_id:"charge-ci"},
  {ok:true,order_id:"pay_ci_1",cobranca_id:""}
 ]){
  const x=fixture();
  x.state.registrarAckOverride=invalid;
  await assert.rejects(x.request(),e=>e.status===503
   && /registro local não foi confirmado/.test(e.message));
  assert.equal(x.state.posts,1,"A cobranca remota foi criada uma unica vez");
  assert.equal(x.state.claim,true,"Journal de emissão deve permanecer reservado");
  assert.equal(x.state.charge,null,"Não simular fatura salva sem ACK SQL");
  assert.equal(x.state.reconciles.length,0,"Sem ACK, proibido liberar pagamento");
  // Recuperação por GET da mesma cobrança, após restabelecer banco.
  x.state.registrarAckOverride=undefined;
  const recovered=await x.request();
  assert.equal(recovered.cobranca_status,"pendente");
  assert.equal(x.state.posts,1,"Recuperação não faz segundo POST ao Asaas");
  assert.equal(x.state.charge.order_id,"pay_ci_1");
 }
});


test("COB-06: faturas de 1 a 499 centavos nao reservam emissao nem tentam Pix no Asaas",async()=>{
 for(const cents of [1,100,499]){
  const x=fixture();
  x.state.f.total_comissao_centavos=cents;
  await assert.rejects(x.request(),e=>e.status===409&&
   /mínimo de cobrança do Asaas \(R\$ 5,00\)/.test(e.message));
  assert.equal(x.state.claim,false,"Nao reservar fatura abaixo do minimo");
  assert.equal(x.state.customerLoads,0,"Nao cadastrar cliente no Asaas");
  assert.equal(x.state.providerCalls.length,0,"Nem GET nem POST de cobranca");
  assert.equal(x.state.rpcCalls.length,0,"Nenhuma baixa ou mutacao via RPC");
  assert.equal(x.state.f.total_comissao_centavos,cents,"Divida original preservada");
  assert.equal(x.state.charge,null);
 }
});

test("COB-06: exatamente 500 centavos pode emitir uma cobranca de 5 reais",async()=>{
 const x=fixture();
 x.state.f.total_comissao_centavos=500;
 const y=await x.request();
 assert.equal(y.cobranca_status,"pendente");
 assert.equal(x.state.posts,1);
 assert.equal(x.state.provider[0].value,5);
 assert.equal(x.state.charge.valor_centavos,500);
});

test("COB-06: cobranca antiga ja emitida e recuperavel nao e barrada pelo novo piso",async()=>{
 const x=fixture();
 x.state.f.total_comissao_centavos=300;
 x.state.charge={gateway:"asaas",order_id:"pay_legacy_300",valor_centavos:300,status:"pendente"};
 x.state.provider.push({id:"pay_legacy_300",customer:x.state.customer,
  value:3,billingType:"PIX",externalReference:"fatura-loja-ci-001-2026-10",status:"PENDING",
  invoiceUrl:"https://sandbox.invalid/cobranca-antiga"});
 const r=await x.request();
 assert.equal(r.cobranca_status,"pendente");
 assert.equal(x.state.posts,0,"Nunca emitir novo Pix");
 assert.equal(x.state.claim,false,"Nunca reabrir a reserva");
});
