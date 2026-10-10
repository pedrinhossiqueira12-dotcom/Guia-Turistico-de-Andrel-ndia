"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const modulePath="supabase/functions/_shared/catalogo-asaas-gotrue-mfa-transporte-inerte.ts";
const suitePath="supabase/functions/tests/catalogo-asaas-gotrue-mfa-transporte-inerte.test.ts";
const transport=fs.readFileSync(modulePath,"utf8");
const suite=fs.readFileSync(suitePath,"utf8");
const workflow=fs.readFileSync(".github/workflows/database-tests.yml","utf8");
function listEntrypoints(dir){
 return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
  const loc=path.join(dir,e.name);
  if(e.isDirectory()&&e.name!=="_shared"&&e.name!=="tests")return listEntrypoints(loc);
  return e.isFile()&&e.name==="index.ts"?[loc]:[];
 });
}
test("adaptador de protocolo HTTP ainda NAO esta importado por Edge publicada",()=>{
 const entries=listEntrypoints("supabase/functions");
 assert.ok(entries.length>1,"expected live entrypoints");
 for(const entry of entries){
  const file=fs.readFileSync(entry,"utf8");
  assert.doesNotMatch(file,/catalogo-asaas-gotrue-mfa-transporte-inerte|GoTrueMfaTransporteInerte/,
    "GoTrue MFA transport unexpectedly imported into "+entry);
 }
});
test("transport usa somente publishable key, GET user, POST challenge/verify e validador injetado",()=>{
 for(const token of [
  "projectAuthBase(cfg.projectUrl)",
  "startsWith(\"sb_publishable_\")",
  "verificarAssinaturaJwtESessaoNoServidor",
  'this.request("GET", "/user", token)',
  '"/factors/" + args.factorId + "/challenge"',
  '"/factors/" + args.factorId + "/verify"',
  "challenge_id: args.challengeId, code: args.otp",
  "return { accessToken: data.access_token }",
  'redirect: "error"',
  'credentials: "omit"',
  'cache: "no-store"'
 ])assert.ok(transport.includes(token),"missing control "+token);
 assert.doesNotMatch(transport,/\bDeno\.env\b|\bfetch\s*\(/,"cannot rely on network or env defaults");
 assert.doesNotMatch(transport,/\bservice_role\s*=|\/v3\/transfers|pagamento_autorizado\s*:\s*true/);
});
test("CI verifica contrato sem permitir rede e sem usar credenciais reais",()=>{
 assert.match(workflow,/deno check supabase\/functions\/_shared\/catalogo-asaas-gotrue-mfa-transporte-inerte\.ts/);
 assert.match(workflow,/deno test --no-check --allow-read=supabase\/functions[^\n]+catalogo-asaas-gotrue-mfa-transporte-inerte\.test\.ts/);
 assert.doesNotMatch(workflow,/deno test[^\n]*--allow-net/);
 for(const p of [
  "Deno.test(\"GoTrue REST:",
  "Deno.test(\"servidor que nao valida assinatura",
  "Deno.test(\"mudanca de sessao",
  "Deno.test(\"GET /user",
  "Deno.test(\"dominios",
  "Deno.test(\"erro do Auth",
  "Deno.test(\"nunca enviar OTP",
  "HOLD_OBRIGATORIO",
 ])assert.ok(suite.includes(p),"missing offline case "+p);
});
