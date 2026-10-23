"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const source=fs.readFileSync("supabase/functions/_shared/catalogo-asaas-jwks-fixo-cache-inerte.ts","utf8");
const suite=fs.readFileSync("supabase/functions/tests/catalogo-asaas-jwks-fixo-cache-inerte.test.ts","utf8");
const workflow=fs.readFileSync(".github/workflows/database-tests.yml","utf8");
function handlers(dir){
 return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
  const p=path.join(dir,e.name);
  if(e.isDirectory()&&!["_shared","tests"].includes(e.name))return handlers(p);
  return e.isFile()&&e.name==="index.ts"?[p]:[];
 });
}
test("JWKS experimental nao pode ser ativado dentro de handlers financeiros/publicos",()=>{
 const roots=handlers("supabase/functions");
 assert.ok(roots.length>2);
 for(const entry of roots){
  const content=fs.readFileSync(entry,"utf8");
  assert.doesNotMatch(content,/catalogo-asaas-jwks-fixo-cache-inerte|ResolvedorJwksPinadoInerte/,
   "JWKS experiment accidentally imported by "+entry);
 }
});
test("pinagem, limite de corpo e revogacao do cache permanecem obrigatorios",()=>{
 for(const gate of [
  'url.hostname!==c.projectRef+".supabase.co"',
  '"/auth/v1/.well-known/jwks.json"',
  'redirect:"error"',
  'credentials:"omit"',
  'cache:"no-store"',
  'MAX_BYTES=32768',
  'MAX_KEYS=12',
  'key.alg!=="ES256" && key.alg!=="RS256"',
  'key.key_ops.some(v=>v!=="verify")',
  'this.cache=null',
  'now<this.ultimoRelogio',
  'structuredClone(this.cache.keys)',
  'new Set(ids).size!==ids.length',
  'this.emCurso=pending'
 ])assert.ok(source.includes(gate),"Missing JWKS guard "+gate);
 assert.doesNotMatch(source,/\bDeno\.env\b|\bfetch\s*\(|\/v3\/transfers|service_role_key/);
});
test("CI executa casos de cache, rotacao, concorrencia, SSRF e relógio sem rede",()=>{
 assert.match(workflow,/deno check supabase\/functions\/_shared\/catalogo-asaas-jwks-fixo-cache-inerte\.ts/);
 assert.match(workflow,/supabase\/functions\/tests\/catalogo-asaas-jwks-fixo-cache-inerte\.test\.ts/);
 assert.doesNotMatch(workflow,/deno test[^\n]*--allow-net/);
 for(const needle of [
  "TTL expira sem stale",
  "duas consultas simultaneas",
  "nenhum dominio ou URL",
  "chaves privadas/simetricas",
  "resposta HTTP invalida",
  "relogio retrocedendo",
  "key_ops e arrays"
 ])assert.ok(suite.includes(needle),"Missing race/auth negative test "+needle);
});
