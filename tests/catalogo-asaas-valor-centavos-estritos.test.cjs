"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const src=fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");
const match=src.match(/function money\(cents:number\):number\{([\s\S]*?)\n\}/);
assert.ok(match,"helper real de conversao de centavos nao localizado");
class Failure extends Error{constructor(message,status){super(message);this.status=status;}}
const money=vm.runInNewContext(
 "(function(cents){"+match[1]+"\n})",{Failure,Number});
function rejected(value){
 assert.throws(()=>money(value),e=>e instanceof Failure&&e.status===503,
  "dinheiro invalido foi convertido em vez de ser rejeitado: "+String(value));
}
test("Asaas: valor enviado deve ser centavo inteiro, positivo e numericamente seguro",()=>{
 for(const n of [0,-1,-50000,NaN,Infinity,-Infinity,1.1,10000.25,
   Number.MAX_SAFE_INTEGER+1,1e25])rejected(n);
 assert.equal(money(1),0.01);
 assert.equal(money(10000),100);
 assert.equal(money(500000),5000);
 assert.equal(money(10001),100.01);
 assert.equal(money(9007199254740991),90071992547409.9);
});
test("Asaas: verifica montante ANTES de cadastrar cliente e de criar cobranca",()=>{
 const a=src.indexOf("async function createInvoice(");
 const b=src.indexOf("async function ",a+10);
 assert.ok(a>=0&&b>a);
 const fn=src.slice(a,b);
 const guard=fn.indexOf("Number.isSafeInteger(invoiceCents)");
 const customer=fn.indexOf("await loadOrCreateCustomer(");
 const claim=fn.indexOf('db.from("catalogo_asaas_emissoes")');
 const post=fn.indexOf('await asaas("/payments","POST"');
 assert.ok(guard>=0&&claim>guard&&customer>claim&&post>customer,
  "fatura deve validar centavos e reservar emissao ANTES de criar pagador e Pix");
 assert.match(fn,/value:money\(invoiceCents\)/);
 assert.doesNotMatch(fn.replace(/^\s*\/\/.*$/gm,""),/Math\.round\(/);
});
test("Asaas: inclusive saque usa helper sem arredondar",()=>{
 const a=src.indexOf("async function withdraw(uid:string)");
 const b=src.indexOf("const ADMIN_USER_ID",a);
 assert.ok(a>=0&&b>a);
 const fn=src.slice(a,b);
 assert.match(fn,/value:money\(amount\)/);
 assert.doesNotMatch(fn.replace(/^\s*\/\/.*$/gm,""),/Math\.round\(/);
});
