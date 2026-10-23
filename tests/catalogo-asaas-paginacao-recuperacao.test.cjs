"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const src=fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");
const begin=src.indexOf("async function listarAsaasPorReferencia(");
const end=src.indexOf("async function verifyInvoice(",begin);
assert.ok(begin>=0&&end>begin,"Paginador bancario ausente");
const implementation=src.slice(begin,end)
 .replace('async function listarAsaasPorReferencia(tipo:"payments"|"customers",ref:string)',
  "async function listarAsaasPorReferencia(tipo,ref)")
 .replace("const encontrados:Record<string,unknown>[]=[];","const encontrados=[];");
class Failure extends Error{
 constructor(message,status=503){super(message);this.status=status;}
}
const reference="fatura-loja-ci-2026-10";
function fixture({tipo="payments",records=[],override=null}={}){
 const calls=[];
 const asaas=async(path,method="GET")=>{
  calls.push({path,method});
  const parsed=new URL("https://sandbox.invalid"+path);
  assert.equal(parsed.pathname,"/"+tipo);
  assert.equal(method,"GET");
  assert.equal(parsed.searchParams.get("externalReference"),reference);
  assert.equal(parsed.searchParams.get("limit"),"100");
  const offset=Number(parsed.searchParams.get("offset"));
  assert.ok(Number.isSafeInteger(offset)&&offset%100===0);
  if(override)return override({offset,path,calls});
  const page=records.slice(offset,offset+100);
  return {data:page,hasMore:offset+100<records.length};
 };
 const ctx={
  asaas,Failure,check:(value,msg,status=409)=>{
   if(!value)throw new Failure(msg,status);
  },input:x=>x&&typeof x==="object"&&!Array.isArray(x)?x:{},
  encodeURIComponent,Array,Number,String,URL
 };
 const listar=vm.runInNewContext(implementation+"\nlistarAsaasPorReferencia",ctx);
 return {calls,listar:()=>listar(tipo,reference)};
}
const record=(id,externalReference=reference)=>({id,externalReference});
test("paginacao vazia completa autoriza reconhecer ausencia com um GET",async()=>{
 const x=fixture();
 assert.equal((await x.listar()).length,0);
 assert.equal(x.calls.length,1);
});
test("consulta SEGUNDA pagina antes de concluir que cobranca ou cliente nao existe",async()=>{
 const rows=Array.from({length:100},(_,i)=>record("pay_ci_"+i));
 rows.push(record("pay_ci_100"));
 for(const tipo of ["payments","customers"]){
  const x=fixture({tipo,records:rows});
  const result=await x.listar();
  assert.equal(result.length,101);
  assert.equal(result[100].id,"pay_ci_100");
  assert.equal(x.calls.length,2);
  assert.ok(x.calls[1].path.includes("offset=100"));
 }
});
test("registros duplicados em paginas separadas sao retornados ao guardiao de duplicidade",async()=>{
 const rows=Array.from({length:100},(_,i)=>record("pay_ci_"+i));
 rows.push(record("pay_ci_duplicada"));
 const x=fixture({records:rows});
 const result=await x.listar();
 assert.ok(result.length>1,"Guarda posterior deve impedir novo POST Pix");
 assert.equal(x.calls.length,2);
});
test("ausencia de hasMore nao pode ser tratada como fim da listagem",async()=>{
 const x=fixture({override:()=>({data:[]})});
 await assert.rejects(x.listar(),e=>e.status===503);
 assert.equal(x.calls.length,1);
});
test("pagina incompleta marcada hasMore e registro de outra referencia falham fechados",async()=>{
 for(const override of [
  ()=>({data:[record("pay_ci_1")],hasMore:true}),
  ()=>({data:[record("pay_ci_1","fatura-OUTRA")],hasMore:false}),
  ()=>({data:[{externalReference:reference}],hasMore:false}),
  ()=>({data:new Array(101).fill(record("pay_ci_1")),hasMore:false})
 ]){
  const x=fixture({override});
  await assert.rejects(x.listar(),e=>[409,503].includes(e.status));
  assert.equal(x.calls.length,1);
 }
});
test("limita listagem a 500 registros e nao interpreta pagina 6 como ausente",async()=>{
 const x=fixture({override:({offset})=>({
  data:Array.from({length:100},(_,i)=>record("pay_ci_"+(offset+i))),
  hasMore:true
 })});
 await assert.rejects(x.listar(),e=>e.status===503&&/limite seguro/i.test(e.message));
 assert.equal(x.calls.length,5);
});
test("helper so realiza consultas GET, sem POST de cliente, Pix ou transferencia",async()=>{
 const rows=[record("pay_ci_existente")];
 const x=fixture({records:rows});
 await x.listar();
 assert.deepEqual(x.calls.map(c=>c.method),["GET"]);
 assert.ok(src.includes('const candidates=await listarAsaasPorReferencia("payments",ref);'));
 assert.ok(src.includes('const candidates=await listarAsaasPorReferencia("customers",ref);'));
});
