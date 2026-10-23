"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const edge=fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");
function snippet(from,to,signature){
 const a=edge.indexOf(from),b=edge.indexOf(to,a);
 assert.ok(a>=0&&b>a,"Funcoes financeiras nao localizadas: "+from);
 return edge.slice(a,b).replace(from,signature);
}
const invoice=snippet("async function invoice(uid:string,body:Record<string,unknown>){",
  "function reference(", "async function invoice(uid,body){");
const show=snippet("async function showInvoice(uid:string,body:Record<string,unknown>){",
  "async function reconcileInvoice(", "async function showInvoice(uid,body){");
const reconciled=snippet("async function reconcileInvoice(uid:string,body:Record<string,unknown>){",
  "async function createInvoice(", "async function reconcileInvoice(uid,body){");
class Failure extends Error{
 constructor(message,status=503){super(message);this.status=status;}
}
function fixture({fatura=true,cobranca=null,emissao=null,errorTable=""}={}){
 const f=fatura?{id:"fechamento-ci",total_comissao_centavos:7500,
  status:"faturado",comercio_id:"loja-ci",competencia:"2026-10-01"}:null;
 const state={calls:[],auth:0,rpcs:0,bankCalls:0};
 const db={from:(table)=>{
  state.calls.push(table);
  const q={select(){return q;},eq(){return q;},
   async maybeSingle(){
    if(errorTable===table)return {data:null,error:{code:"PGRST500"}};
    const data={
      catalogo_fechamentos_offline:f,
      catalogo_fatura_cobrancas:cobranca,
      catalogo_asaas_emissoes:emissao
    };
    assert.ok(Object.hasOwn(data,table),"Consulta inesperada "+table);
    return {data:data[table],error:null};
   }};
  return q;
 }};
 const ctx={db,Failure,commerce:x=>x,competence:x=>x,owner:async()=>{state.auth++;},
  respond:x=>x,Number,String,Boolean,Array,
  enabled:()=>{throw Error("Nao chamar API Asaas sem cobranca local")},
  verifyInvoice:async()=>{state.bankCalls++;throw Error("GET indevido do provedor")},
  asaas:async()=>{state.bankCalls++;throw Error("POST/GET indevido do provedor")},
  rpc:async()=>{state.rpcs++;throw Error("RPC indevida")}};
 const logic=vm.runInNewContext(invoice+"\n"+show+"\n"+reconciled+
  "\n({invoice,showInvoice,reconcileInvoice})",ctx);
 const data={comercio_id:"loja-ci",competencia:"2026-10"};
 return {state,logic,show:()=>logic.showInvoice("owner-ci",data),
  consult:()=>logic.reconcileInvoice("owner-ci",data)};
}
test("sem fechamento mostra sem cobrança, sem reserva, sem tocar gateway",async()=>{
 const x=fixture({fatura:false});
 const r=await x.show();
 assert.equal(r.cobranca_status,null);
 assert.equal(r.valor_centavos,0);
 assert.deepEqual(x.state.calls,["catalogo_fechamentos_offline"]);
});
test("com fechamento e sem cobranca nem reserva permite mostrar ausencia",async()=>{
 const x=fixture();
 const r=await x.consult();
 assert.equal(r.cobranca_status,null);
 assert.match(r.mensagem,/Ainda não há cobrança/);
 assert.equal(x.state.bankCalls,0);
 assert.deepEqual(x.state.calls,["catalogo_fechamentos_offline",
  "catalogo_fatura_cobrancas","catalogo_asaas_emissoes"]);
});
test("emissao reservada não é invisivel: alerta comerciante sem novo Pix",async()=>{
 const x=fixture({emissao:{estado:"reservado"}});
 const r=await x.show();
 assert.equal(r.cobranca_status,"emissao_reservada");
 assert.equal(r.valor_centavos,7500);
 assert.match(r.mensagem,/não gere uma segunda cobrança/i);
 assert.equal(x.state.bankCalls,0);
 assert.equal(x.state.rpcs,0);
 const after=await x.consult();
 assert.equal(after.cobranca_status,"emissao_reservada");
 assert.match(after.mensagem,/não pague ou gere outro Pix/i);
 assert.equal(x.state.bankCalls,0);
});
test("cobranca efetiva prevalece sobre reserva historica, sem consulta extra",async()=>{
 const x=fixture({cobranca:{gateway:"asaas",status:"pendente"},
  emissao:{estado:"registrado"}});
 const r=await x.show();
 assert.equal(r.cobranca_status,"pendente");
 assert.deepEqual(x.state.calls,["catalogo_fechamentos_offline",
  "catalogo_fatura_cobrancas"]);
});
test("erro de consulta da reserva falha fechado sem fingir ausencia de cobrança",async()=>{
 const x=fixture({errorTable:"catalogo_asaas_emissoes"});
 await assert.rejects(x.show(),e=>e.status===503);
 assert.equal(x.state.bankCalls,0);
});
test("interface traduz reserva e nao exibe QR indevido para estados bloqueados",()=>{
 const ui=fs.readFileSync("js/catalogo-admin.js","utf8");
 assert.match(ui,/emissao_reservada: "Pix em conciliação/);
 assert.match(ui,/\["estornado", "contestado", "cancelado", "pago", "emissao_reservada"\]/);
});
