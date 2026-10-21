"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");

const js=fs.readFileSync("js/catalogo-admin.js","utf8");
function trecho(inicio,fim){
 const a=js.indexOf(inicio),b=js.indexOf(fim,a+inicio.length);
 assert.ok(a>=0&&b>a,"Trecho nao localizado: "+inicio);
 return js.slice(a,b);
}
const codigo=[
 trecho("  let consultaFaturaSeq = 0;","  function renderizarPixFatura("),
 trecho("  async function gerarPixFatura()","  async function consultarPixFatura()"),
 trecho("  async function regularizarFaturaBloqueada(acao)","  async function carregarDadosPainel()")
].join("\n");

function cenario(executar){
 const elementos=new Map();
 const acessos=[],renderizados=[];
 function $(id){
  if(!elementos.has(id))elementos.set(id,{
   value:"",textContent:"",innerHTML:"",disabled:false
  });
  return elementos.get(id);
 }
 $("competenciaOffline").value="2026-10";
 $("competenciaFaturaBloqueada").value="2026-10";
 const ctx={
  $,console,
  competenciaDaFatura:()=>$("competenciaOffline").value,
  chamarFaturaPix:async body=>{acessos.push({...body});return await executar(body)},
  renderizarPixFatura:(data,containerId="faturaPixResultado")=>{
   renderizados.push({data,containerId});
   $(containerId).textContent="PIX:"+String(data.pix?.code||"");
  },
  entrarPainel:async()=>{}
 };
 vm.createContext(ctx);
 vm.runInContext(codigo+";globalThis.api={atualizarPreflightFatura,gerarPixFatura,regularizarFaturaBloqueada}",ctx);
 return {api:ctx.api,$,acessos,renderizados};
}
const fatura=(valor=500,status="faturado",extras={})=>({
 success:true,fatura:{status,total_comissao_centavos:valor},
 cobranca_status:null,provedor:"asaas",...extras
});
const acoes=c=>c.acessos.map(x=>x.acao);
function pendencia(){
 let resolver;
 const promessa=new Promise(resolve=>{resolver=resolve});
 return {promessa,resolver};
}

test("COB-06 UI: fatura ausente, paga, abaixo de R$5 e reservada bloqueiam emissao",async()=>{
 for(const retorno of [
  {success:true,fatura:null,provedor:"asaas"},
  fatura(499),
  fatura(500,"pago"),
  fatura(500,"faturado",{cobranca_status:"emissao_reservada"}),
  fatura(500,"faturado",{cobranca_status:"pendente"}),
  fatura(500,"faturado",{provedor:"mercadopago"})
 ]){
  const c=cenario(async()=>retorno);
  await c.api.atualizarPreflightFatura();
  assert.equal(c.$("gerarPixFatura").disabled,true,JSON.stringify(retorno));
  await c.api.gerarPixFatura();
  assert.deepEqual(acoes(c),["obter_fatura"],"Nenhum POST ao provedor");
 }
});

test("COB-06 UI: competencia invalida e falha de leitura nao liberam Pix",async()=>{
 const c=cenario(async()=>{throw Error("Leitura do banco falhou")});
 c.$("competenciaOffline").value="invalida";
 await c.api.atualizarPreflightFatura();
 assert.equal(c.$("gerarPixFatura").disabled,true);
 assert.equal(c.acessos.length,0);
 c.$("competenciaOffline").value="2026-10";
 await c.api.atualizarPreflightFatura();
 assert.equal(c.$("gerarPixFatura").disabled,true);
 await c.api.gerarPixFatura();
 assert.deepEqual(acoes(c),["obter_fatura"]);
});

test("COB-06 UI: um clique duplo faz apenas um POST e preserva Pix exibido",async()=>{
 const espera=pendencia();
 let cobrancaCriada=false;
 const c=cenario(async body=>{
  if(body.acao==="obter_fatura")return cobrancaCriada?
   fatura(500,"faturado",{cobranca_status:"pendente"}):fatura(500);
  if(body.acao==="criar_cobranca"){
   const resp=await espera.promessa;
   cobrancaCriada=true;
   return resp;
  }
  throw Error("Acao inesperada");
 });
 await c.api.atualizarPreflightFatura();
 assert.equal(c.$("gerarPixFatura").disabled,false);
 const primeiro=c.api.gerarPixFatura();
 const segundo=c.api.gerarPixFatura();
 assert.equal(c.$("gerarPixFatura").disabled,true);
 assert.equal(acoes(c).filter(x=>x==="criar_cobranca").length,1);
 espera.resolver({...fatura(500),pix:{code:"PIX-UNICO"}});
 await Promise.all([primeiro,segundo]);
 assert.equal(acoes(c).filter(x=>x==="criar_cobranca").length,1);
 assert.equal(c.$("gerarPixFatura").disabled,true,"Nova consulta descobriu cobranca ja existente");
 assert.equal(c.$("faturaPixResultado").textContent,"PIX:PIX-UNICO","QR retornado nao foi apagado");
 assert.equal(c.renderizados.length,1,"Preflight nao substitui o QR por resumo sem codigo");
});

test("COB-06 UI: regularizacao de loja bloqueada nao envia POST duplo",async()=>{
 const espera=pendencia();
 const c=cenario(async body=>body.acao==="criar_cobranca"?
   espera.promessa:fatura(500));
 const p1=c.api.regularizarFaturaBloqueada("criar_cobranca");
 const p2=c.api.regularizarFaturaBloqueada("criar_cobranca");
 assert.equal(c.$("gerarFaturaBloqueada").disabled,true);
 assert.equal(acoes(c).filter(x=>x==="criar_cobranca").length,1);
 espera.resolver({...fatura(500),pix:{code:"PIX-REGULARIZACAO"}});
 await Promise.all([p1,p2]);
 assert.equal(acoes(c).filter(x=>x==="criar_cobranca").length,1);
 assert.equal(c.$("gerarFaturaBloqueada").disabled,false);
 assert.equal(c.$("resultadoFaturaBloqueada").textContent,"PIX:PIX-REGULARIZACAO");
});

test("COB-06 UI: emissao regular so ocorre depois de obter fatura valida",async()=>{
 let criou=false;
 const c=cenario(async body=>{
  if(body.acao==="obter_fatura")return fatura(750);
  if(body.acao==="criar_cobranca"){criou=true;return {...fatura(750),pix:{code:"PIX-VALIDO"}}}
  throw Error("Acao inesperada");
 });
 await c.api.gerarPixFatura();
 assert.equal(criou,false);
 await c.api.atualizarPreflightFatura();
 assert.equal(c.$("gerarPixFatura").disabled,false);
 await c.api.gerarPixFatura();
 assert.equal(criou,true);
 assert.equal(c.$("faturaPixResultado").textContent,"PIX:PIX-VALIDO");
});
