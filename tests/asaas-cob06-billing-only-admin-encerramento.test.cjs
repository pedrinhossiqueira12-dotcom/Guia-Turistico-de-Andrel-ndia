"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");

const edge=fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");
const js=fs.readFileSync("js/admin-encerramentos.js","utf8");
const html=fs.readFileSync("pages/admin-encerramentos.html","utf8");

function ensaio(resposta,erro=null){
 const calls=[];
 const start=js.indexOf("  async function arquivarComVitrine(");
 const end=js.indexOf("  async function preconferirPagamento(",start);
 assert.ok(start>=0&&end>start,"Apenas o fluxo GitHub deve finalizar o encerramento");
 const client={functions:{invoke:async(func,args)=>{
  calls.push({func,args});
  return {data:resposta,error:erro};
 }}};
 const fn=vm.runInNewContext("("+js.slice(start,end).trim()+")",{client});
 return {fn,calls};
}

test("COB-06: rota financeira de finalizacao fica fora da allowlist PROD",()=>{
 const begin=edge.indexOf('const acoesPermitidasCobrancaProducao=new Set([');
 const end=edge.indexOf("]);",begin);
 assert.ok(begin>0&&end>begin,"allowlist produtiva encontrada");
 const prod=edge.slice(begin,end);
 assert.doesNotMatch(prod,/"finalizar_encerramento_admin"/);
 assert.match(prod,/"listar_encerramentos_admin"/);
 assert.match(edge,/ENVIRONMENT==="production" && !acoesPermitidasCobrancaProducao.has\(acaoFinanceira\)/);
 assert.match(edge,/case "finalizar_encerramento_admin":return await finalizarEncerramentoAdmin/);
});

test("COB-06: sucesso exige simultaneamente banco arquivado e vitrine confirmada",async()=>{
 const caso=ensaio({sucesso:true,arquivado:true,mensagem:"Concluido"});
 const result=await caso.fn("comercio-fixture");
 assert.equal(result.arquivado,true);
 assert.equal(caso.calls.length,1);
 assert.equal(caso.calls[0].func,"whatsapp-bot");
 assert.equal(caso.calls[0].args.body.acao,"excluir_comercio");
 assert.equal(caso.calls[0].args.body.comercio_id,"comercio-fixture");
});

test("COB-06: qualquer retorno parcial, erro de rede ou nao arquivado impede sucesso",async()=>{
 for(const payload of [
  {sucesso:true,arquivado:false},
  {sucesso:false,arquivado:true},
  {sucesso:true},
  null
 ]){
  const caso=ensaio(payload);
  await assert.rejects(caso.fn("comercio-fixture"),/Arquivamento nao confirmado/);
  assert.equal(caso.calls.length,1);
 }
 const offline=ensaio(null,{message:"Falha GitHub"});
 await assert.rejects(offline.fn("comercio-fixture"),/Falha GitHub/);
});

test("COB-06: banco arquivado sem GitHub gera reconciliacao, nunca sucesso falso",async()=>{
 const caso=ensaio({sucesso:false,arquivado:true,pendente_sincronizacao:true});
 await assert.rejects(caso.fn("comercio-fixture"),/pendente de sincronizacao/);
 assert.equal(caso.calls.length,1);
});

test("COB-06: painel de cobranca nao chama endpoints administrativos de saques",()=>{
 assert.match(js,/const BILLING_ONLY_RELEASE=true;/);
 const gate=js.indexOf("if(BILLING_ONLY_RELEASE){");
 const saque=js.indexOf("const analises=await listarAnalisesResiduais();");
 assert.ok(gate>0&&saque>gate,"fases de saque bloqueadas antes das chamadas");
 assert.doesNotMatch(js,/acao:"finalizar_encerramento_admin"/);
 assert.match(html,/<div id="saquesAdminArea" hidden aria-hidden="true">/);
 assert.match(html,/id="listaEncerramentos"/);
});
