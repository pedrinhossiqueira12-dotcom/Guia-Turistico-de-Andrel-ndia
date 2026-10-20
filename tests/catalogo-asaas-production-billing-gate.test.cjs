"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const vm=require("node:vm");
const edge=readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");

const extracted=edge.match(/function enabled\(kind:"billing"\|"payouts"\)\{([\s\S]*?)\n\}/);
assert.ok(extracted,"contrato de acesso Asaas deve existir");

function checkGate({environment="sandbox",key="sandbox-test-key",billing=true,
                    payouts=false,approval=false,kind="billing",
                    workerOn=true,workerToken="x".repeat(48),webhookToken="w".repeat(32)}={}){
 const context={
  ASAAS_TOKEN:key,
  BILLING_ON:billing,
  PAYOUTS_ON:payouts,
  ENVIRONMENT:environment,
  PRODUCTION_BILLING_APPROVED:approval,
  WEBHOOK_WORKER_ON:workerOn,WEBHOOK_WORKER_TOKEN:workerToken,WEBHOOK_TOKEN:webhookToken,
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

test("COB-06: billing de producao so libera com recuperacao de webhook pronta",()=>{
 const base={environment:"production",approval:true,billing:true,key:"prod-ficticia"};
 assert.equal(checkGate(base).allowed,true);
 const cenarios=[
  {...base,workerOn:false},
  {...base,workerToken:""},
  {...base,workerToken:"x".repeat(47)},
  {...base,webhookToken:""},
  {...base,webhookToken:"w".repeat(31)},
 ];
 for(const options of cenarios){
  const result=checkGate(options);
  assert.equal(result.allowed,false);
  assert.equal(result.status,503);
  assert.match(result.message,/Recupera.+webhooks Asaas/i);
 }
 assert.equal(checkGate({environment:"sandbox",workerOn:false,
  workerToken:"",webhookToken:""}).allowed,true);
});

test("COB-06: o gate obriga worker no faturamento mas nao libera saques",()=>{
 const gate=edge.match(/function enabled\(kind:"billing"\|"payouts"\)\{([\s\S]*?)\n\}/)?.[1];
 assert.ok(gate);
 assert.match(gate,/WEBHOOK_WORKER_ON/);
 assert.match(gate,/WEBHOOK_WORKER_TOKEN.length<48/);
 assert.match(gate,/WEBHOOK_TOKEN.length<32/);
 assert.equal(checkGate({environment:"production",approval:true,
  kind:"payouts",payouts:false}).allowed,false);
});
