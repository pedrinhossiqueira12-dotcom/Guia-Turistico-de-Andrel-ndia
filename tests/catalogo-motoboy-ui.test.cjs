const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const RIDER='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
function fixture(file){
 const nodes=new Map();const events={};const requests=[];const timers=[];
 const get=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,open:false,innerHTML:'',textContent:'',value:'',checked:false,disabled:false,classList:{toggle(){}},setAttribute(){},addEventListener(){},reset(){},close(){this.open=false;},showModal(){this.open=true;},focus(){}});return nodes.get(id);};
 let current={access_token:'token-rider',user:{id:RIDER}};
 const client={auth:{getSession:async()=>({data:{session:current},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}};
 const ctx={window:{location:{search:'?id=loja-a'},supabaseLoginClient:client,setInterval:()=>1,clearInterval(){},setTimeout:fn=>timers.push(fn),addEventListener:(name,fn)=>{events[name]=fn;},confirm:()=>true},
 document:{getElementById:get,visibilityState:'visible',addEventListener(){},querySelectorAll:()=>[]},navigator:{onLine:true},URL,URLSearchParams,console,
 fetch:async(url,options)=>{requests.push({url,...options});return {ok:true,status:200,json:async()=>({success:true,pedidos:[],motoboys:[],has_more:false})};}};
 let src=fs.readFileSync('js/'+file,'utf8');
 src=src.replace('  document.addEventListener("DOMContentLoaded", iniciar, { once: true });','  window.__test={state,chamarApi,aplicarSessao,iniciarEventos,limparSessaoVisual,limparPedidos:typeof limparPedidos==="function"?limparPedidos:limparDados,carregarEntregas:typeof carregarEntregas==="function"?carregarEntregas:null,renderizarPedido:typeof renderizarPedido==="function"?renderizarPedido:null};');
 vm.runInNewContext(src,ctx);
 return {api:ctx.window.__test,ctx,nodes,get,events,requests,timers,setSession:s=>{current=s;}};
}
for(const file of ['motoboy.js','entregadores-admin.js']){
 test(`${file}: JWT de outra sessão não é enviado com uma tela antiga`,async()=>{
  const e=fixture(file);e.api.state.session={user:{id:RIDER}};e.api.state.userId=RIDER;e.api.state.generation=1;
  e.setSession({access_token:'token-other',user:{id:OTHER}});
  await assert.rejects(file==='motoboy.js'?e.api.chamarApi({acao:'listar_entregas'}):e.api.chamarApi('listar_motoboys'),/STALE_SESSION_REQUEST/);
  assert.equal(e.requests.length,0);
 });
 test(`${file}: logout e pagehide limpam os pedidos; pageshow permite restaurar`,async()=>{
  const e=fixture(file);e.api.state.session={user:{id:RIDER}};e.api.state.userId=RIDER;e.api.state.pedidos=[{cliente_nome:'Nome privado'}];
  e.api.limparSessaoVisual();assert.equal(e.api.state.pedidos.length,0);assert.equal(e.api.state.session,null);
  e.api.iniciarEventos();e.events.pagehide();assert.equal(e.api.state.destroyed,true);
  await e.api.aplicarSessao({access_token:'late',user:{id:OTHER}});assert.equal(e.api.state.session,null);
  e.events.pageshow({persisted:true});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(e.api.state.destroyed,false);assert.equal(e.api.state.userId,RIDER);
 });
}
test('motoboy: strings do cliente são escapadas e não há link de produtos ou fatura',()=>{
 const e=fixture('motoboy.js');const html=e.api.renderizarPedido({pedido_id:'id',comercio_id:'loja-a',status:'pronto',cliente_nome:'<script>alert(1)</script>',cliente_endereco:'Rua',cliente_telefone:'javascript:alert(1)',itens:[{nome_produto:'<img src=x onerror=alert(1)>',quantidade:1}]});
 assert.doesNotMatch(html,/<script>|<img src=x/);assert.match(html,/&lt;script&gt;/);
 const page=fs.readFileSync('pages/motoboy.html','utf8');assert.doesNotMatch(page,/catalogo-admin\.html|faturaPix|produtoForm/);
});
test('motoboy: revogação apaga a lista até quando ocorreu na paginação',async()=>{
 const e=fixture('motoboy.js');e.api.state.session={user:{id:RIDER}};e.api.state.userId=RIDER;e.api.state.pedidos=[{pedido_id:'old',cliente_nome:'Privado'}];
 e.ctx.fetch=async()=>({ok:false,status:403,json:async()=>({success:false,mensagem:'Acesso revogado.'})});
 await e.api.carregarEntregas({append:true});assert.equal(e.api.state.pedidos.length,0);assert.equal(e.get('motoboyOrders').innerHTML,'');
});
test('motoboy: sem storage de pedidos, código ou senha e sem service worker',()=>{
 const js=fs.readFileSync('js/motoboy.js','utf8');assert.doesNotMatch(js,/localStorage|sessionStorage|serviceWorker|window\.open/);
 assert.match(js,/recebimento_confirmado: true/);assert.match(js,/Authorization/);
});
