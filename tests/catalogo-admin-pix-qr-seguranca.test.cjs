"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const js = fs.readFileSync("js/catalogo-admin.js","utf8");
const inicio = js.indexOf("  function renderizarPixFatura(");
const fim = js.indexOf("  async function gerarPixFatura(",inicio);
assert.ok(inicio >= 0 && fim > inicio,"renderizador da fatura localizado");

function renderizar(data,containerId="faturaPixResultado") {
 const containers = new Map();
 for(const id of ["faturaPixResultado","resultadoFaturaBloqueada"]) {
  containers.set(id,{innerHTML:"",querySelector:()=>null});
 }
 const escapar = (valor)=>String(valor ?? "").replace(/[&<>"']/g,x=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
 })[x]);
 const render = vm.runInNewContext("("+js.slice(inicio,fim).trim()+")",{
  $:(id)=>containers.get(id),
  reais:(centavos)=>"R$ "+(centavos/100).toFixed(2),
  traducaoCobranca:(status)=>status,
  escapar,
 });
 render(data,containerId);
 return containers.get(containerId).innerHTML;
}

test("COB-06: imagem QR Base64 PNG valida aparece com copia e cola",()=>{
 const html = renderizar({
  valor_centavos:500,cobranca_status:"pendente",
  pix:{code:"PIX-TESTE",imageBase64:"iVBORw0KGgo=",ticketUrl:"https://sandbox.invalid/ok"},
 });
 assert.match(html,/src="data:image\/png;base64,iVBORw0KGgo="/);
 assert.match(html,/PIX-TESTE/);
 assert.match(html,/Abrir cobrança no provedor/);
});

test("COB-06: imagem QR malformada nao injeta HTML nos dois paineis",()=>{
 const imagem = 'AAAA" onerror="alert(1)" data-test="';
 for(const id of ["faturaPixResultado","resultadoFaturaBloqueada"]) {
  const html=renderizar({
   valor_centavos:500,cobranca_status:"pendente",
   pix:{code:"PIX-TESTE",imageBase64:imagem},
  },id);
  assert.doesNotMatch(html,/onerror=|data-test=|<img/i);
  assert.match(html,/PIX-TESTE/,"copia e cola legitimo preservado");
 }
});

test("COB-06: imagem maior que 160000 bytes ou data URI externa nao aparece",()=>{
 for(const imageBase64 of ["A".repeat(160004),"data:image/svg+xml;base64,AAAA","a%22","AAAAA"]) {
  const html=renderizar({valor_centavos:500,cobranca_status:"pendente",
   pix:{code:"PIX-TESTE",imageBase64}});
  assert.doesNotMatch(html,/<img/i);
 }
});

test("COB-06: nao exibe QR ou copia e cola de cobranca nao pagavel",()=>{
 for(const status of ["pago","cancelado","estornado","contestado","emissao_reservada"]) {
  const html=renderizar({valor_centavos:500,cobranca_status:status,
   pix:{code:"PIX-NAO-EXIBIR",imageBase64:"iVBORw0KGgo="}});
  assert.doesNotMatch(html,/<img|PIX-NAO-EXIBIR|copiarPixFatura/);
 }
});

test("COB-06: vencimento e mensagem da fatura nao injetam HTML",()=>{
 const html=renderizar({
  valor_centavos:500,cobranca_status:"pendente",
  fatura:{vencimento_em:'<img src=x onerror="alert(1)">'},
  mensagem:'<svg onload="alert(1)">',pix:{code:"PIX-TESTE"},
 });
 assert.doesNotMatch(html,/<svg|<img|onerror="alert/);
 assert.match(html,/&lt;img/);
 assert.match(html,/&lt;svg/);
});
