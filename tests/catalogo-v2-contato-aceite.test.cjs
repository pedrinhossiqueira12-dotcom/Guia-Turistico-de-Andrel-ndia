const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const OWNER='11111111-1111-4111-8111-111111111111';
const ADMIN='4b9a0233-6b72-4573-aebd-d596c5b15e1b';
async function list(actor,version,accepted){
 let handler;
 const order={id:'22222222-2222-4222-8222-222222222222',versao_financeira:version,aceito_em:accepted?'2026-10-07T00:00:00Z':null,cliente_nome:'Pessoa privada',cliente_telefone:'32999998888',cliente_endereco:'Rua privada',cliente_numero:'10',cliente_bairro:'Centro',observacoes:'Ligue 32999998888',total_centavos:1000};
 const db={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},from(table){const q={select(){return q;},eq(){return q;},order(){return q;},in(){return q;},maybeSingle:async()=>({data:{proprietario_id:OWNER},error:null}),limit:async()=>({data:table==='catalogo_pedidos'?[order]:[],error:null})};return q;}};
 const src=fs.readFileSync('supabase/functions/catalogo-pedidos-offline-admin/index.ts','utf8').replace(/^import .*\n/gm,'');
 vm.runInNewContext(stripTypeScriptTypes(src),{createClient:()=>db,Deno:{env:{get:()=>''},serve:fn=>handler=fn},Request,Response,console:{error(){}},TextEncoder,Date,Intl});
 const response=await handler(new Request('https://example.test/function',{method:'POST',headers:{authorization:'Bearer validated','Content-Type':'application/json'},body:JSON.stringify({acao:'listar_pedidos',comercio_id:'loja-teste',user_id:ADMIN,admin:true})}));
 assert.equal(response.status,200);return {returned:(await response.json()).pedidos[0],original:order};
}
test('v2 antes do aceite não entrega nome, telefone, endereço ou observação; admin no body não concede acesso',async()=>{
 const {returned:r,original}=await list(OWNER,2,false);
 assert.equal(r.dados_cliente_ocultos,true);assert.equal(r.cliente_telefone,null);assert.equal(r.cliente_endereco,null);assert.equal(r.observacoes,null);
 assert.equal(r.cliente_bairro,'Centro');assert.equal(r.total_centavos,1000);assert.doesNotMatch(JSON.stringify(r),/32999998888|Rua privada|Pessoa privada/);
 assert.equal(original.cliente_telefone,'32999998888');
});
test('v2 libera contato apenas depois de aceite registrado',async()=>{const {returned:r}=await list(OWNER,2,true);assert.equal(r.cliente_telefone,'32999998888');assert.equal(r.dados_cliente_ocultos,undefined);});
test('pedidos v1 preservam sua compatibilidade',async()=>{const {returned:r}=await list(OWNER,1,false);assert.equal(r.cliente_telefone,'32999998888');});
test('admin real validado conserva dados para investigação',async()=>{const {returned:r}=await list(ADMIN,2,false);assert.equal(r.cliente_telefone,'32999998888');});
