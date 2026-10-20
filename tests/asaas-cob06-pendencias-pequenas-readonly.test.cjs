"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const edge=fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");
const ui=fs.readFileSync("js/catalogo-admin.js","utf8");
const start=edge.indexOf("async function resumoPendenciasAbaixoMinimo(");
const stop=edge.indexOf("async function reconcileInvoice(",start);
assert.ok(start>=0&&stop>start);
const backend=edge.slice(start,stop)
 .replace("async function resumoPendenciasAbaixoMinimo(store:string)",
   "async function resumoPendenciasAbaixoMinimo(store)")
 .replace("async function showInvoice(uid:string,body:Record<string,unknown>)",
   "async function showInvoice(uid,body)");

function fixture({rows=[],charged=[],reserved=[],errorTable="",invoiceData=null}={}){
 const seen=[];
 const db={from(table){
  seen.push(table);
  const q={select(){return q;},eq(){return q;},gt(){return q;},lt(){return q;},
   order(){return q;},
   in(field){
    if(table==="catalogo_fechamentos_offline")return q;
    return Promise.resolve({data:(table==="catalogo_fatura_cobrancas"?charged:reserved)
      .map(fechamento_id=>({fechamento_id})),
      error:errorTable===table?{message:"mock"}:null});
   },
   limit(){return Promise.resolve({
    data:rows,
    error:errorTable==="catalogo_fechamentos_offline"?{message:"mock"}:null
   });}
  };
  return q;
 }};
 const invoice=async()=>{
  if(!invoiceData)throw Error("showInvoice not configured");
  return invoiceData;
 };
 const Failure=class Failure extends Error{constructor(message,status){super(message);this.status=status;}};
 const ctx={db,invoice,Failure,ASAAS_COBRANCA_MINIMA_CENTAVOS:500,
  respond:(value)=>value,console};
 const funcs=vm.runInNewContext(backend+"\n({resumoPendenciasAbaixoMinimo,showInvoice})",ctx);
 return {...funcs,seen};
}
const fatura=(id,centavos)=>({id,total_comissao_centavos:centavos,competencia:"2026-10-01"});

test("COB-06: soma somente faturas pequenas sem cobranca/reserva",async()=>{
 const f=fixture({
  rows:[fatura("a",150),fatura("b",200),fatura("c",400),fatura("d",499)],
  charged:["b"],reserved:["c"]
 });
 const r=await f.resumoPendenciasAbaixoMinimo("loja-teste");
 assert.deepEqual(JSON.parse(JSON.stringify(r)),{quantidade:2,total_centavos:649});
 assert.deepEqual(f.seen,["catalogo_fechamentos_offline",
  "catalogo_fatura_cobrancas","catalogo_asaas_emissoes"]);
});

test("COB-06: fatura pequena expõe somente estimativa e nunca autoriza Pix",async()=>{
 const f=fixture({
  rows:[fatura("a",250),fatura("b",260)],reserved:["b"],
  invoiceData:{f:{...fatura("a",250),status:"faturado"},charge:null,
    emissao:null,store:"loja-teste"}
 });
 const r=await f.showInvoice("titular-ci",{comercio_id:"loja-teste"});
 assert.equal(r.fatura_abaixo_minimo_asaas,true);
 assert.equal(r.pix_acumulado_disponivel,false);
 assert.equal(r.pendencias_pequenas_estimadas.total_centavos,250);
 assert.match(r.mensagem,/agrupamento.*homologacao/i);
});

test("COB-06: cobrança Mercado Pago existente não é somada como livre",async()=>{
 const f=fixture({invoiceData:{
  f:{...fatura("a",250),status:"faturado"},
  charge:{gateway:"mercadopago",status:"pago"},emissao:null,store:"loja-teste"
 }});
 const r=await f.showInvoice("titular-ci",{comercio_id:"loja-teste"});
 assert.equal(r.fatura_abaixo_minimo_asaas,false);
 assert.equal(r.pendencias_pequenas_estimadas,null);
 assert.equal(r.pix_acumulado_disponivel,false);
 assert.deepEqual(f.seen,[]);
});

test("COB-06: falha em qualquer leitura e cardinalidade >120 recusa com HOLD",async()=>{
 for(const table of ["catalogo_fechamentos_offline","catalogo_fatura_cobrancas",
  "catalogo_asaas_emissoes"]){
  const f=fixture({rows:[fatura("a",300)],errorTable:table});
  await assert.rejects(f.resumoPendenciasAbaixoMinimo("loja-teste"),e=>e.status===503);
 }
 const many=fixture({rows:Array.from({length:121},(_,i)=>fatura("f"+i,100))});
 await assert.rejects(many.resumoPendenciasAbaixoMinimo("loja-teste"),e=>e.status===503);
});

test("COB-06: valor fora do dominio de centavos é rejeitado, sem estimativa",async()=>{
 for(const invalid of [100.5,NaN,-1,501,Number.MAX_SAFE_INTEGER+10]){
  const f=fixture({rows:[fatura("a",invalid)]});
  await assert.rejects(f.resumoPendenciasAbaixoMinimo("loja-teste"),e=>e.status===503);
 }
});

test("COB-06: UI impede botão de gerar Pix de competência abaixo do mínimo",async()=>{
 const start=ui.indexOf("  let consultaFaturaSeq = 0;");
 const end=ui.indexOf("  function renderizarPixFatura(",start);
 assert.ok(start>=0&&end>start,"preflight frontend presente");
 const source=ui.slice(start,end);
 const campo={value:"2026-10"};
 const botao={disabled:false};
 const container={textContent:""};
 const respostas=[];
 const ctx={
  $:(id)=>({
   competenciaOffline:campo,gerarPixFatura:botao,faturaPixResultado:container
  })[id],
  chamarFaturaPix:async(body)=>{
   assert.equal(body.acao,"obter_fatura");
   return respostas.shift();
  },
  renderizarPixFatura:()=>{container.textContent="resumo exibido";},
 };
 const fn=vm.runInNewContext(source+"\natualizarPreflightFatura",ctx);
 respostas.push({fatura_abaixo_minimo_asaas:true,
   pendencias_pequenas_estimadas:{quantidade:2,total_centavos:510}});
 await fn();
 assert.equal(botao.disabled,true);
 assert.equal(container.textContent,"resumo exibido");
 campo.value="2026-11";
 respostas.push({fatura_abaixo_minimo_asaas:false,fatura:{id:"fatura-nova"}});
 await fn();
 assert.equal(botao.disabled,false);
});

test("COB-06: botão não libera emissão quando preflight falha",async()=>{
 const start=ui.indexOf("  let consultaFaturaSeq = 0;");
 const end=ui.indexOf("  function renderizarPixFatura(",start);
 const campo={value:"2026-10"},botao={disabled:false},resultado={textContent:""};
 const fn=vm.runInNewContext(ui.slice(start,end)+"\natualizarPreflightFatura",{
  $:(id)=>({competenciaOffline:campo,gerarPixFatura:botao,faturaPixResultado:resultado})[id],
  chamarFaturaPix:async()=>{throw Error("Falha remota");}
 });
 await fn();
 assert.equal(botao.disabled,true);
 assert.match(resultado.textContent,/Falha remota/);
});
