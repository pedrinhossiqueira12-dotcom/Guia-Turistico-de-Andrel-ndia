"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const edge=fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");
const start=edge.indexOf("async function loadOrCreateCustomer(");
const end=edge.indexOf("async function showInvoice(",start);
assert.ok(start>=0&&end>start,"helper bancario nao localizado");
const real=edge.slice(start,end)
 .replace(/async function loadOrCreateCustomer\(\s*store:string,body:Record<string,unknown>,email:string,expectedCustomerId\?:string\s*\)/,
 "async function loadOrCreateCustomer(store,body,email,expectedCustomerId)")
 .replace(/\(c:Record<string,unknown>\)/g,"(c)");
function fixture({local=null,remote=[],insertConflict=false}={}){
 const state={local,remote:[...remote],remotePosts:0,remoteReads:0,inserts:0};
 const store="comercio-ci",ref="guia-comercio-"+store;
 class Failure extends Error{constructor(msg,status=400){super(msg);this.status=status;}}
 const db={from:(table)=>{
  assert.equal(table,"catalogo_asaas_clientes");
  return {
   select(){return this;},
   eq(){return this;},
   async maybeSingle(){return {data:state.local?{cliente_id:state.local}:null,error:null};},
   async insert(row){
    state.inserts++;
    if(insertConflict){
     state.local="cus-outro";
     return {error:{code:"23505"}};
    }
    if(state.local)return {error:{code:"23505"}};
    state.local=row.cliente_id;
    return {error:null};
   }
  };
 }};
 const asaas=async(path,method="GET",body)=>{
  if(path.startsWith("/customers?")){
   state.remoteReads++;
   assert.equal(method,"GET");
   return {data:state.remote};
  }
  if(path==="/customers"&&method==="POST"){
   state.remotePosts++;
   const x={id:"cus-new",externalReference:body.externalReference};
   state.remote.push(x);return x;
  }
  throw Error("Unexpected external HTTP call "+method+" "+path);
 };
 const context={db,asaas,Failure,check:(b,msg,status=409)=>{if(!b)throw new Failure(msg,status);},
  value:(x,max=200)=>typeof x==="string"?x.trim().slice(0,max):"",
  encodeURIComponent,String,Array};
 const func=vm.runInNewContext(real+"\nloadOrCreateCustomer",context);
 const body={nome_pagador:"Loja de teste",documento:"12345678901"};
 return {state,ref,call:(expectedCustomerId)=>func(store,body,"noreply@example.invalid",expectedCustomerId)};
}
test("cliente novo exige cadastro anterior e INSERT sem substituir outra conta",async()=>{
 const f=fixture();
 assert.equal(await f.call(),"cus-new");
 assert.equal(f.state.inserts,1);
 assert.equal(f.state.remotePosts,1);
 assert.equal(f.state.local,"cus-new");
});
test("fatura remota recuperada reutiliza pagador exato SEM novo cliente Asaas",async()=>{
 const f=fixture({remote:[{id:"cus-diferente",externalReference:"guia-comercio-comercio-ci"},
   {id:"cus-certo",externalReference:"guia-comercio-comercio-ci"}]});
 assert.equal(await f.call("cus-certo"),"cus-certo");
 assert.equal(f.state.remotePosts,0);
 assert.equal(f.state.local,"cus-certo");
});
test("recuperacao sem pagador original no banco bloqueia em vez de cadastrar outro",async()=>{
 const f=fixture();
 await assert.rejects(f.call("cus-nunca-criado"),e=>e.status===409);
 assert.equal(f.state.remotePosts,0);
 assert.equal(f.state.inserts,0);
});
test("cliente financeiro local divergente do provedor impede baixa",async()=>{
 const f=fixture({local:"cus-local"});
 await assert.rejects(f.call("cus-externo"),e=>e.status===409);
 assert.equal(f.state.remotePosts,0);
 assert.equal(f.state.inserts,0);
});
test("duplicidade bancaria preexistente exige revisao, nao escolhe primeiro",async()=>{
 const ref="guia-comercio-comercio-ci";
 const f=fixture({remote:[{id:"cus-a",externalReference:ref},{id:"cus-b",externalReference:ref}]});
 await assert.rejects(f.call(),e=>e.status===409);
 assert.equal(f.state.remotePosts,0);
 assert.equal(f.state.inserts,0);
});
test("concorrencia em comercio de outra competencia jamais sobrescreve cliente local",async()=>{
 const f=fixture({insertConflict:true,remote:[
  {id:"cus-concorrente",externalReference:"guia-comercio-comercio-ci"}
 ]});
 await assert.rejects(f.call(),e=>e.status===503);
 assert.equal(f.state.local,"cus-outro");
 assert.equal(f.state.remotePosts,0);
 assert.equal(f.state.inserts,1);
});
