"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const validation=fs.readFileSync("supabase/functions/_shared/catalogo-asaas-jwt-sessao-assinada-ensaio.ts","utf8");
const suite=fs.readFileSync("supabase/functions/tests/catalogo-asaas-jwt-sessao-assinada-ensaio.test.ts","utf8");
const ci=fs.readFileSync(".github/workflows/database-tests.yml","utf8");
function entries(directory){
 return fs.readdirSync(directory,{withFileTypes:true}).flatMap(e=>{
  const name=path.join(directory,e.name);
  if(e.isDirectory()&&e.name!=="_shared"&&e.name!=="tests")return entries(name);
  return e.isFile()&&e.name==="index.ts"?[name]:[];
 });
}
test("JWKS verifier de ensaio nao pode ser importado por Edge financeira existente",()=>{
 for(const file of entries("supabase/functions")){
  const source=fs.readFileSync(file,"utf8");
  assert.doesNotMatch(source,/catalogo-asaas-jwt-sessao-assinada-ensaio|ValidadorJwtSessaoInerte/,
   "verifier experimental inadvertently activated in "+file);
 }
});
test("assinatura precede leitura Auth, algoritmo/sessao/metadata falsos nunca dao poder",()=>{
 for(const fragment of [
  'header.alg !== "RS256" && header.alg !== "ES256"',
  'claims.role !== "authenticated"',
  'claims.is_anonymous !== false',
  'claims.aud !== "authenticated"',
  'claims.aal !== "aal2"',
  'iat < nowSec-this.cfg.maxIdadeTokenSegundos',
  'crypto.subtle.importKey("jwk"',
  'crypto.subtle.verify(',
  'if (!verified) return null',
  'this.cfg.provedor.consultarSessaoEFator',
  'row.factorStatus === "verified"',
  'row.factorType === "totp"',
  'row.factorUserId === row.userId',
  'row.aal === "aal2"',
  'row.notAfterMs > now'
 ])assert.ok(validation.includes(fragment),"missing JWT/sessao control: "+fragment);
 const sig=validation.indexOf("if (!verified) return null");
 const lookup=validation.indexOf("this.cfg.provedor.consultarSessaoEFator");
 assert.ok(sig>0&&lookup>sig,"session lookup before signature");
 assert.doesNotMatch(validation,/\bservice_role\s*=|Deno\.env|catalogo_asaas_saques\s*\(|\/v3\/transfers/);
});
test("Deno usa chaves criptograficas geradas localmente e regressao negativa",()=>{
 for(const marker of [
  'crypto.subtle.generateKey',
  'crypto.subtle.sign',
  'ES256: assinatura WebCrypto',
  'RS256: assinatura RSA real',
  'modificacao de payload e assinatura invalida',
  'chaves kid desconhecidas, duplicadas',
  'JWT expirado, iat futuro/antigo',
  'sessao revogada, usuario diferente',
  'JWKS ou banco indisponivel',
  'claims user_metadata nunca decidem autoridade'
 ])assert.ok(suite.includes(marker),"Missing offline signature test "+marker);
 assert.match(ci,/deno check supabase\/functions\/_shared\/catalogo-asaas-jwt-sessao-assinada-ensaio\.ts/);
 assert.match(ci,/deno test --no-check --allow-read=supabase\/functions[^\n]+catalogo-asaas-jwt-sessao-assinada-ensaio\.test\.ts/);
});
