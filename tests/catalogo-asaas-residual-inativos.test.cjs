"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fn = fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts", "utf8");

function section(start,end) {
  const a=fn.indexOf(start),b=fn.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,"Seção não encontrada: "+start);
  return fn.slice(a,b);
}

const roles=section("async function roleScope(","async function termsStatus(");
const terms=section("async function termsStatus(","async function requestClosure(");
const wallet=section("async function wallet(","async function solicitarAnaliseResidual(");
const residual=section("async function solicitarAnaliseResidual(","async function consultarEncerramento(");
const withdraw=section("async function withdraw(","async function listAdminPayouts(");

test("inativo continua sendo motoboy histórico, mas o filtro ativo é o padrão",()=>{
  assert.match(roles,/allowInactiveMotoboy=false/);
  assert.match(roles,/if\(!allowInactiveMotoboy\)query=query\.eq\("ativo",true\)/);
  assert.match(roles,/\.eq\("usuario_id",uid\)/);
});

test("termos podem ser renovados por motoboy inativo sem reabilitar entregas",()=>{
  assert.match(terms,/papel==="motoboy"/);
  assert.match(terms,/termsStatus\(uid,papel,store,papel==="motoboy"\)/);
  assert.match(fn,/case "consultar_termos":[\s\S]*value\(body\.papel,15\)==="motoboy"/);
});

test("carteira mantém consulta e histórico em perfil inativo, mas não habilita Pix",()=>{
  assert.match(wallet,/select\("usuario_id,ativo"\)/);
  assert.match(wallet,/\.eq\("usuario_id",uid\)\.limit\(1\)/);
  assert.match(wallet,/const activeCourier=allowed\[0\]\.ativo===true/);
  assert.match(wallet,/saque_habilitado:activeCourier&&ENVIRONMENT==="sandbox"/);
  assert.doesNotMatch(wallet,/\.eq\("ativo",true\)/);
});

test("solicitação residual usa exceção limitada; saque regular mantém bloqueio",()=>{
  assert.match(residual,/requireTerms\(uid,"motoboy","",true\)/);
  assert.match(residual,/amount>0&&amount<SAQUE_MINIMO_CENTAVOS/);
  assert.doesNotMatch(residual,/\/transfers|payouts|POST\/transfers/);
  assert.match(withdraw,/requireTerms\(uid,"motoboy",""\)/);
  assert.match(withdraw,/ENVIRONMENT!=="sandbox"/);
  assert.match(withdraw,/catalogo_asaas_reservar_saque/);
});
