"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");

const script=fs.readFileSync(
 "scripts/validacao-pagamentos/test-gotrue-mfa-real-local.ts","utf8");
const workflow=fs.readFileSync(".github/workflows/database-tests.yml","utf8");

test("#42: dois usuarios e TOTP reais SOMENTE no GoTrue local da CI",()=>{
 for(const s of [
  'const BASE = "http://127.0.0.1:54321/auth/v1"',
  'const EXPECTED_ORIGIN = "http://127.0.0.1:54321"',
  "async function criarRevisorGoTrueLocal(",
  'gotrue, 1)',
  'gotrue, 2)',
  "a.userId !== b.userId",
  "a.sessionId !== b.sessionId",
  "a.factorId !== b.factorId",
  'afterA.data.id === a.userId',
  'afterB.data.id === b.userId',
  'afterA.data.id !== afterB.data.id',
  "twoIndependentReviewers: true",
  "moneyAuthorized: false"
 ])assert.ok(script.includes(s),"Ausente: "+s);
 assert.ok(workflow.includes(
  "scripts/validacao-pagamentos/test-gotrue-mfa-real-local.ts"));
 assert.match(workflow,/supabase start[\s\S]*?supabase db reset --local/);
 assert.match(workflow,/--allow-net=127\.0\.0\.1:54321/);
 assert.doesNotMatch(script,/(?:api\.asaas\.com|api-sandbox\.asaas\.com)/);
});

test("#42: token A nao cria challenge do fator B e reciprocamente",()=>{
 const f=script.slice(script.indexOf("export async function exerciseLocalAuthMfa("));
 assert.ok(f.length>0);
 assert.ok(f.includes('"/factors/" + b.factorId + "/challenge", a.beforeToken'));
 assert.ok(f.includes('"/factors/" + a.factorId + "/challenge", b.beforeToken'));
 assert.ok((f.match(/\.status >= 400 && wrong[A-B]\.status < 500/g)||[]).length===2);
 assert.ok(f.includes("crossUserFactorDenied: true"));
});

test("#42: nao devolver tokens, OTP, segredos ou fator na prova local",()=>{
 const f=script.slice(script.indexOf("export async function exerciseLocalAuthMfa("));
 const returned=f.slice(f.indexOf("  return {\n    verified: true,"),f.indexOf("} as const;")+11);
 for(const secret of ["beforeToken","afterToken","factorId","sessionId","userId","secret","otp"]){
  assert.ok(!returned.includes(secret),"Prova nao pode revelar: "+secret);
 }
 assert.match(f, /moneyAuthorized: false/);
 assert.match(script,/for\(const key of \["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"/);
 assert.match(script,/Deno\.args\[0\]!=="--native-ci-local-only"/);
});

test("#42: falta de permissao externa impede prometer autorizacao real",()=>{
 assert.doesNotMatch(script,/(?:payment_authorized|approve_payment|criar_pix|liberar_saldo)\s*\(/i);
 assert.ok(script.includes("Nao retornar bearer, TOTP ou fator"));
 assert.ok(script.includes("NAO chamar nenhuma RPC de parecer, transferencia, Pix ou Asaas"));
});
