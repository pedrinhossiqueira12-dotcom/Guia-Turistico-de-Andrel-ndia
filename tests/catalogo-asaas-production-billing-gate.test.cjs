"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const vm=require("node:vm");
const edge=readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");

const extracted=edge.match(/function enabled\(kind:"billing"\|"payouts"\)\{([\s\S]*?)\n\}/);
assert.ok(extracted,"contrato de acesso Asaas deve existir");

function checkGate({environment="sandbox",key="sandbox-test-key",billing=true,
                    payouts=false,approval=false,kind="billing"}={}){
 const context={
  ASAAS_TOKEN:key,
  BILLING_ON:billing,
  PAYOUTS_ON:payouts,
  ENVIRONMENT:environment,
  PRODUCTION_BILLING_APPROVED:approval,
  Failure:class Failure extends Error {
   constructor(message,status){super(message);this.status=status;}
  },
 };
 // Avalia somente a funcao de controle: sem importar Edge/abrir qualquer rede.
 const gate=vm.runInNewContext("function enabled(kind){"+extracted[1]+"\n}; enabled",context);
 try {gate(kind);return {allowed:true,status:200};}
 catch(err){return {allowed:false,status:err.status,message:err.message};}
}

test("sandbox continua apto aos testes somente com flag geral e key",()=>{
 assert.equal(checkGate().allowed,true);
 assert.equal(checkGate({billing:false}).allowed,false);
 assert.equal(checkGate({key:""}).allowed,false);
});

test("trocar a URL/chave para producao nunca basta para emitir cobranças",()=>{
 const denied=checkGate({environment:"production",approval:false,billing:true,key:"production-test-key"});
 assert.equal(denied.allowed,false);
 assert.equal(denied.status,503);
 assert.match(denied.message,/Cobranças reais ainda não autorizadas/);
 assert.equal(checkGate({environment:"production",approval:true,billing:false}).allowed,false);
 assert.equal(checkGate({environment:"production",approval:true,key:""}).allowed,false);
 assert.equal(checkGate({environment:"production",approval:true,billing:true}).allowed,true);
});

test("payout Pix real fica com bloqueio independente mesmo com billing aprovado",()=>{
 assert.match(edge,/const PRODUCTION_BILLING_APPROVED = Deno\.env\.get\("ASAAS_PRODUCTION_BILLING_APPROVED"\) === "true"/);
 assert.match(edge,/if\(ENVIRONMENT==="production" && kind==="billing" && !PRODUCTION_BILLING_APPROVED\)/);
 assert.match(edge,/if\(method==="POST" && path==="\/transfers"\)\{\s*if\(ENVIRONMENT!=="sandbox"\)/);
 assert.match(edge,/if\(ENVIRONMENT!=="sandbox" \|\| !WITHDRAWAL_AUTH_ON/);
 assert.match(edge,/const API_BASE = ENVIRONMENT === "production" \? "https:\/\/api\.asaas\.com\/v3" : "https:\/\/api-sandbox\.asaas\.com\/v3"/);
 assert.equal(checkGate({environment:"sandbox",kind:"payouts",payouts:false}).allowed,false);
});
