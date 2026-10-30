"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {validar,blobSha,OFFICIAL,LOCK,ROOT}=require(
 "../scripts/validacao-pagamentos/asaas-cob06-validar-billing-only.cjs");
const original=JSON.parse(fs.readFileSync(LOCK,"utf8"));
const clone=()=>structuredClone(original);
const err=/PACOTE_BLOQUEADO/;

test("COB06 release: nove SQLs exatos passam no bloqueio local",()=>{
 assert.deepEqual(validar(original),
  {arquivos:9,modo:"SOMENTE_LEITURA",liberado_producao:false});
 assert.equal(OFFICIAL.length,9);
 assert.ok(OFFICIAL.every(p=>!p.startsWith("supabase/migrations/")));
});

test("COB06 release: troca de ordem, insercao extra ou arquivo de saque e recusada",()=>{
 let m=clone();[m.files[0],m.files[1]]=[m.files[1],m.files[0]];
 assert.throws(()=>validar(m),err);
 m=clone();m.files.push(m.files[0]);
 assert.throws(()=>validar(m),err);
 m=clone();m.files[4].path="supabase/production-candidate/03_cob06_acumulo_intercompetencias_preparacao.sql";
 assert.throws(()=>validar(m),err);
 m=clone();m.files[0].path="../fora.sql";
 assert.throws(()=>validar(m),err);
});

test("COB06 release: mudar um byte de qualquer SQL reprova preflight",()=>{
 const target=path.resolve(ROOT,OFFICIAL[0]);
 const mock=(full)=>{
  const b=fs.readFileSync(full);
  if(full===target) {
   const mutated=Buffer.from(b);
   mutated[mutated.length-1]^=1;
   return mutated;
  }
  return b;
 };
 assert.throws(()=>validar(original,mock),err);
});

test("COB06 release: hash artificial e arquivo ausente impedem pacote",()=>{
 const m=clone();m.files[2].blob_sha1="0".repeat(40);
 assert.throws(()=>validar(m),err);
 assert.throws(()=>validar(original,()=>{throw Error("ENOENT")}),err);
 const n=clone();delete n.files[1].blob_sha1;
 assert.throws(()=>validar(n),err);
});

test("COB06 release: hashes do Git correspondem aos bytes reais",()=>{
 for(let i=0;i<OFFICIAL.length;i++){
  const file=fs.readFileSync(path.resolve(ROOT,OFFICIAL[i]));
  assert.equal(blobSha(file),original.files[i].blob_sha1);
 }
});

test("COB06 release: lock nunca e autorizacao de go-live",()=>{
 assert.equal(original.status,"candidate-never-auto-deploy");
 assert.equal(original.contract,"COB-06-billing-only");
 assert.equal(original.hash_algorithm,"git-blob-sha1");
 assert.throws(()=>validar({...original,status:"production-ready"}),err);
});
