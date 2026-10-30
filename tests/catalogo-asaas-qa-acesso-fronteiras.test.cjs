"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const vm=require("node:vm");
const fs=require("node:fs");

const buyer=fs.readFileSync("js/catalogo.js","utf8");
const merchant=fs.readFileSync("js/catalogo-admin.js","utf8");
const login=fs.readFileSync("js/login.js","utf8");
const sandbox="https://jbttwihctuibchhcyqtl.supabase.co";
const production="https://xdmbkflufsfqziixzpxc.supabase.co";
const QA_KEY="sb_publishable_W80rooaGpHP4voYiLwtz7w_-k32qHsF";

function environment(source,pathname,search){
 const start=source.indexOf("  const parametros =");
 const stop=source.indexOf('  const BUCKET =',start);
 assert.ok(start>=0&&stop>start,"Configuracao QA faltando");
 const s=source.slice(start,stop);
 return vm.runInNewContext(s+"\n({QA_SANDBOX,SUPABASE_URL,SUPABASE_KEY})",{
  window:{location:{pathname,search}},URLSearchParams
 });
}
function loginEnv(pathname,search){
 const start=login.indexOf("const LOGIN_QA_SANDBOX =");
 const stop=login.indexOf("/* ===",start);
 assert.ok(start>=0&&stop>start);
 return vm.runInNewContext(login.slice(start,stop)+
  "\n({LOGIN_QA_SANDBOX,LOGIN_SUPABASE_URL,LOGIN_SUPABASE_KEY})",{
   window:{location:{pathname,search}},URLSearchParams
  });
}
for(const [name,source,pathname] of [
 ["comprador",buyer,"/pages/catalogo.html"],
 ["lojista",merchant,"/pages/catalogo-admin.html"]
]){
 test(name+" usa producao POR PADRAO, mesmo com ID de loja informado",()=>{
  const env=environment(source,pathname,"?id=loja-ci");
  assert.equal(env.QA_SANDBOX,false);
  assert.equal(env.SUPABASE_URL,production);
  assert.notEqual(env.SUPABASE_KEY,QA_KEY);
 });
 test(name+" so muda para STAGING com opt-in explicito",()=>{
  const env=environment(source,pathname,"?id=loja-ci&asaas-sandbox=1");
  assert.equal(env.QA_SANDBOX,true);
  assert.equal(env.SUPABASE_URL,sandbox);
  assert.equal(env.SUPABASE_KEY,QA_KEY);
 });
}
test("login global nunca muda o index publico so por receber parametro QA",()=>{
 const prod=loginEnv("/index.html","?asaas-sandbox=1");
 assert.equal(prod.LOGIN_QA_SANDBOX,false);
 assert.equal(prod.LOGIN_SUPABASE_URL,production);
 for(const path of ["/pages/catalogo.html","/pages/catalogo-admin.html"]){
  const qa=loginEnv(path,"?asaas-sandbox=1");
  assert.equal(qa.LOGIN_QA_SANDBOX,true);
  assert.equal(qa.LOGIN_SUPABASE_URL,sandbox);
  assert.equal(qa.LOGIN_SUPABASE_KEY,QA_KEY);
 }
});
test("pedido Pix permanece bloqueado no QA antes de qualquer API de gateway",()=>{
 const checkout=buyer.slice(buyer.indexOf('$("checkoutForm").addEventListener("submit"'),
  buyer.indexOf("$(\"pagarPix\").addEventListener("));
 assert.match(checkout,/QA_SANDBOX && cliente\.pagamento === "pix"/);
 const pix=buyer.slice(buyer.indexOf("async function gerarPixPedido() {"),
  buyer.indexOf("async function",buyer.indexOf("async function gerarPixPedido() {")+1));
 assert.match(pix,/^\s*async function gerarPixPedido\(\) \{\s*if \(QA_SANDBOX\)/);
});
test("ambiente de teste exibido com clareza e carrinho isolado",()=>{
 const html=fs.readFileSync("pages/catalogo.html","utf8");
 const adminHtml=fs.readFileSync("pages/catalogo-admin.html","utf8");
 for(const p of [html,adminHtml])assert.match(p,/id="qaSandboxBanner" hidden/);
 assert.match(buyer,/QA_SANDBOX \? "asaas-sandbox:" : ""/);
 assert.match(merchant,/linkContratacao"\)\.hidden = true/);
 assert.match(buyer,/catalogo-admin\.html\?id=\$\{encodeURIComponent\(comercioId\)\}&asaas-sandbox=1/);
});
