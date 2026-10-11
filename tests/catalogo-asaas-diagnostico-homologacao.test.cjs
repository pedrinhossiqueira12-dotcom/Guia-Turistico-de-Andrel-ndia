"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const vm=require("node:vm");
const fs=require("node:fs");
const edge=fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");
const a=edge.indexOf("async function diagnosticarFaturasSandboxAdmin(");
const b=edge.indexOf("// Recuperação segura",a);
assert.ok(a>=0&&b>a);
const real=edge.slice(a,b)
 .replace("async function diagnosticarFaturasSandboxAdmin(uid:string)",
          "async function diagnosticarFaturasSandboxAdmin(uid)");
const QA="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
class Failure extends Error{constructor(message,status=400){super(message);this.status=status;}}
function fixture({environment="sandbox",configured=QA,rows=[],charges=[],claims=[],owners=[]}={}){
 const calls=[];
 const tableResult={
  catalogo_fechamentos_offline:rows,
  catalogo_fatura_cobrancas:charges,
  catalogo_asaas_emissoes:claims,
  catalogos:owners
 };
 const db={from(table){
  calls.push(table);
  assert.ok(Object.hasOwn(tableResult,table),"Tabela inesperada: "+table);
  const q={
   select(){return q;},in(){return q;},gt(){return q;},
   order(){return q;},limit(){return Promise.resolve({data:tableResult[table],error:null});},
   then(resolve,reject){return Promise.resolve({data:tableResult[table],error:null}).then(resolve,reject);}
  };
  return q;
 }};
 const fn=vm.runInNewContext(real+"\ndiagnosticarFaturasSandboxAdmin",{
  db,ENVIRONMENT:environment,ADMIN_USER_ID:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  Deno:{env:{get:k=>k==="ASAAS_SANDBOX_ADMIN_USER_ID"?configured:""}},
  Failure,respond:x=>x,Set,Map,Array,String,Boolean
 });
 return {calls,fn};
}
test("diagnostico nao aceita producao, uid errado nem administrador de QA nao configurado",async()=>{
 for(const setup of [
  [{environment:"production"},QA],
  [{configured:""},QA],
  [{}, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]
 ]){
  const f=fixture(setup[0]);
  await assert.rejects(f.fn(setup[1]),e=>e.status===403);
  assert.equal(f.calls.length,0,"nao consultar dados apos falha de autorizacao");
 }
});
test("sem fechamento aberto retorna 0 sem emitir cobranca, cliente ou Pix",async()=>{
 const f=fixture();const result=await f.fn(QA);
 assert.equal(result.success,true);
 assert.equal(result.aptas,0);
 assert.equal(result.consultadas,0);
 assert.deepEqual([...f.calls],["catalogo_fechamentos_offline"]);
});
test("classifica faturas prontas, cobradas, reservadas e lojas sem responsavel",async()=>{
 const rows=[
  {id:"a",comercio_id:"loja1",competencia:"2026-10-01",total_comissao_centavos:1000},
  {id:"b",comercio_id:"loja2",competencia:"2026-10-01",total_comissao_centavos:2000},
  {id:"c",comercio_id:"loja3",competencia:"2026-10-01",total_comissao_centavos:3000},
  {id:"d",comercio_id:"loja4",competencia:"2026-10-01",total_comissao_centavos:4000}
 ];
 const owners=rows.slice(0,3).map(r=>({comercio_id:r.comercio_id,proprietario_id:"owner"}));
 const f=fixture({rows,owners,charges:[{fechamento_id:"b",gateway:"asaas",status:"pendente"}],
  claims:[{fechamento_id:"c",estado:"reservado"}]});
 const result=await f.fn(QA);
 assert.equal(result.aptas,1);
 assert.equal(result.faturas[0].motivo,"pronta_para_emissao");
 assert.equal(result.faturas[1].motivo,"cobranca_existente");
 assert.equal(result.faturas[2].motivo,"emissao_reservada_para_conciliacao");
 assert.equal(result.faturas[3].motivo,"sem_proprietario_autorizado");
 assert.equal(result.faturas[0].valor_centavos,1000);
 assert.deepEqual([...f.calls],["catalogo_fechamentos_offline","catalogo_fatura_cobrancas","catalogo_asaas_emissoes","catalogos"]);
});
test("UI usa apenas API administrativa e nao possui chamada de emissao",()=>{
 const html=fs.readFileSync("pages/entregas-operacao.html","utf8");
 const js=fs.readFileSync("js/entregas-operacao.js","utf8");
 assert.match(html,/id="asaasSandboxFaturasConsultar"/);
 assert.match(js,/chamarApi\("diagnosticar_faturas_sandbox_admin"/);
 const begin=js.indexOf("async function verificarFaturasSandboxAsaas()");
 const end=js.indexOf("async function verificarFilaWebhookAsaas(",begin);
 assert.ok(begin>=0&&end>begin);
 assert.doesNotMatch(js.slice(begin,end),/criar_cobranca|confirmar_pagamento|solicitar_saque|POST \/transfers/);
});
