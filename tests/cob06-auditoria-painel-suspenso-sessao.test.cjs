const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
test('auditoria P5 UI: sessao ausente ou titularidade negada oculta pedidos anteriores da area suspensa',async()=>{
 const src=fs.readFileSync('js/catalogo-admin.js','utf8');
 const start=src.indexOf('  async function entrarPainel()'),end=src.indexOf('  function montarCheckboxes(',start);
 for(const session of [null,{user:{id:'outro'},access_token:'fixture'}]){
  const els=new Map();
  const $=id=>{if(!els.has(id))els.set(id,{hidden:false,innerHTML:'dados anteriores'});return els.get(id);};
  const fn=vm.runInNewContext(src.slice(start,end)+';entrarPainel',{
   $,carregando:false,entregaState:{generation:0},paiPedidosOffline:null,operacoesSuspensas:true,
   getClient:()=>({auth:{getSession:async()=>({data:{session}})}}),
   validarProprietario:async()=>{throw Error('Titularidade negada');},setNotice(){},console:{error(){}},
  });
  await fn();
  assert.equal($('pedidosOfflineCard').hidden,true);
  assert.equal($('listaPedidosOffline').innerHTML,'');
 }
});
