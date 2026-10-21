const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const source=fs.readFileSync('js/catalogo-admin.js','utf8');
const a=source.indexOf('  async function chamarFaturaPix('),b=source.indexOf('  function competenciaDaFatura(',a);
function fixture(provider,fail=false){
 const calls=[];
 const fn=vm.runInNewContext(source.slice(a,b)+';chamarFaturaPix',{
  comercioId:'loja-fixture',getClient:()=>({functions:{invoke:async(endpoint,{body})=>{
   calls.push({endpoint,acao:body.acao});
   if(body.acao==='obter_fatura')return {data:fail?null:{success:true,provedor:provider},error:fail?Error('indisponivel'):null};
   if(endpoint!==(provider==='mercadopago'?'catalogo-fatura-pix':'catalogo-asaas-financeiro'))
    return {data:{success:false,mensagem:'Consulte o provedor original'},error:null};
   return {data:provider==='mercadopago'?{success:true,fechamento:{id:'antiga'},cobranca_status:'pago'}:
    {success:true,fatura:{id:'atual'},cobranca_status:'pago'},error:null};
  }}}),
 });
 return {fn,calls};
}
test('auditoria historico: consulta MP usa somente conciliacao do provedor original, sem emissao',async()=>{
 const c=fixture('mercadopago');
 const r=await c.fn({acao:'consultar_cobranca',competencia:'2026-01'});
 assert.equal(r.fatura.id,'antiga');assert.equal(r.provedor,'mercadopago');
 assert.equal(c.calls.at(-1).endpoint,'catalogo-fatura-pix');
 assert.ok(c.calls.every(x=>['obter_fatura','consultar_cobranca'].includes(x.acao)));
});

test('auditoria historico: handler MP concilia legado com emissao desligada e sem POST',async()=>{
 const edge=fs.readFileSync('supabase/functions/catalogo-fatura-pix/index.ts','utf8');
 const start=edge.indexOf('async function consultarCobranca('),end=edge.indexOf('// Reapresenta o Pix',start);
 const calls=[];
 const fn=vm.runInNewContext(stripTypeScriptTypes(edge.slice(start,end))+';consultarCobranca',{
  text:x=>x,owner:async()=>{},isCompetencia:()=>true,MP_ACCESS_TOKEN:'fixture',MP_SELLER_ID:'fixture',MP_WEBHOOK_SECRET:'fixture',
  FATURA_PIX_ENABLED:false,carregarFatura:async()=>({fechamento:{id:'legado'},cobranca:{order_id:'MP-HIST',gateway:'mercadopago',valor_centavos:700,status:'pago'}}),
  assertSeller:async()=> 'fixture',mpRequest:async(path,method)=>{calls.push(method);assert.ok(path.includes('MP-HIST'));return {};},
  assessFaturaOrder:()=>({valid:true,state:'aprovado'}),montarReferenciaFatura:()=> 'legado',
  conciliar:async()=>({status:'pago'}),updatedPix:()=>({}),json:x=>x,HttpError:Error,
 });
 assert.equal((await fn('titular',{comercio_id:'loja',competencia:'2020-01'})).cobranca_status,'pago');
 assert.deepEqual(calls,['GET']);
});
test('auditoria historico: falha de identificacao nao consulta provedor e Asaas conserva rota',async()=>{
 const c=fixture('mercadopago',true);
 await assert.rejects(c.fn({acao:'consultar_cobranca'}));
 assert.equal(c.calls.length,1);
 const s=fixture('asaas');
 assert.equal((await s.fn({acao:'consultar_cobranca'})).fatura.id,'atual');
 assert.ok(s.calls.every(x=>x.endpoint==='catalogo-asaas-financeiro'));
});
