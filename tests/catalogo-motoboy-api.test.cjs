const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {webcrypto,createHash}=require('node:crypto');
const RIDER='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORDER='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const STATUS_TOKEN='a'.repeat(64);
function load(path,{membership=true,assigned=true,rpcResult={ok:true,status:'entregue'},order,viewer={id:RIDER,email:'rider@example.test',email_confirmed_at:'2026-10-01'},offline=true}={}){
 const calls=[];let handler;
 const db={
  auth:{getUser:async token=>({data:{user:token==='valid'?viewer:null},error:null})},
  rpc:async(name,body)=>{calls.push({name,body});return {data:name==='catalogo_offline_consumir_limite'?true:rpcResult,error:null};},
  from:name=>{const q={select(){return q;},eq(){return q;},in(){return q;},maybeSingle:async()=>({data:name==='catalogo_motoboys'?(membership?{usuario_id:RIDER}:null):name==='catalogo_entregas_atribuidas'?(assigned?{pedido_id:ORDER}:null):name==='catalogo_pedidos'?order: name==='catalogos'?{proprietario_id:OWNER}:null,error:null}) ,
        then(resolve,reject){return Promise.resolve({data:name==='catalogo_aceites_operacionais'
          ?[{documento:'termos'},{documento:'privacidade'}]:[],error:null}).then(resolve,reject);}
      };return q;},
 };
 const source=fs.readFileSync(path,'utf8').replace(/^import[^;]+;\s*/gm,'');
 const helper=stripTypeScriptTypes(fs.readFileSync('supabase/functions/_shared/catalogo-entregas-crypto-v2.ts','utf8')).replace(/^export\s+/gm,'');
 vm.runInNewContext(helper+"\n"+stripTypeScriptTypes(source),{createClient:()=>db,Request,Response,TextEncoder,TextDecoder,atob,btoa,crypto:webcrypto,console:{error(){}},Deno:{env:{get:key=>key==='OFFLINE_CHECKOUT_ENABLED'?(offline?'true':'false'):'test'},serve:h=>{handler=h;}}});
 return {handler,calls};
}
function req(body,auth='Bearer valid'){
 return new Request('https://example.test/function',{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:auth}:{})},body:JSON.stringify(body)});
}
const endpoint='supabase/functions/catalogo-entregas/index.ts';
const confirmation={acao:'confirmar_entrega',comercio_id:'loja-a',pedido_id:ORDER,codigo_entrega:'123456',recebimento_confirmado:true};
test('motoboy: ausência/invalidade de JWT bloqueia ações',async()=>{
 const e=load(endpoint);assert.equal((await e.handler(req({acao:'listar_entregas'},''))).status,401);assert.equal((await e.handler(req(confirmation,'Bearer invalid'))).status,401);assert.equal(e.calls.length,0);
});
test('motoboy: body não muda operador nem transforma listagem em gestão',async()=>{
 const e=load(endpoint,{rpcResult:{ok:true,pedidos:[],has_more:false}});
 assert.equal((await e.handler(req({acao:'listar_entregas',comercio_id:'loja-b',p_operador_id:OWNER,user_id:OWNER}))).status,200);
 assert.equal(e.calls[0].body.p_operador_id,RIDER);assert.equal(e.calls[0].body.p_comercio_id,undefined);
});
test('motoboy: falta de vínculo ou atribuição impede qualquer chamada de baixa',async()=>{
 for(const config of [{membership:false},{assigned:false}]){const e=load(endpoint,config);assert.equal((await e.handler(req(confirmation))).status,403);assert.equal(e.calls.length,0);}
});
test('motoboy: conferência presencial e seis dígitos são obrigatórios',async()=>{
 const e=load(endpoint);assert.equal((await e.handler(req({...confirmation,recebimento_confirmado:false}))).status,400);assert.equal((await e.handler(req({...confirmation,codigo_entrega:'111'}))).status,400);assert.equal(e.calls.length,0);
});
test('motoboy: somente hash e UUID do JWT seguem à wrapper de confirmação restrita',async()=>{
 const e=load(endpoint);assert.equal((await e.handler(req({...confirmation,operador_id:OWNER,p_operador_id:OWNER}))).status,200);
 assert.equal(e.calls[0].name,'catalogo_confirmar_entrega_motoboy');assert.equal(e.calls[0].body.p_operador_id,RIDER);
 assert.equal(e.calls[0].body.p_codigo_hash,createHash('sha256').update('123456').digest('hex'));
 assert.doesNotMatch(JSON.stringify(e.calls),/123456/);
});
test('motoboy: fatura/produtos/registro financeiro não existem na API',async()=>{
 for(const acao of ['consultar_fechamento','registrar_pagamento','criar_produto','gerar_fechamento']){const e=load(endpoint);assert.equal((await e.handler(req({acao,comercio_id:'loja-a'}))).status,400);assert.equal(e.calls.length,0);}
});
test('motoboy: gestão usa UUID do JWT e recusa resposta SQL de não proprietário',async()=>{
 const e=load(endpoint,{rpcResult:{ok:false,http_status:403,mensagem:'Somente o proprietário pode gerenciar entregadores.'}});
 assert.equal((await e.handler(req({acao:'autorizar_motoboy',comercio_id:'loja-a',email:'rider@example.test',nome:'Rider',operador_id:OWNER}))).status,403);
 assert.equal(e.calls[0].body.p_operador_id,RIDER);
});
const statusPath='supabase/functions/catalogo-pedido-offline/index.ts';
const baseOrder={id:ORDER,comercio_id:'loja-a',provedor:'offline',versao_financeira:1,status:'pronto',status_pagamento:'pendente',concluido_em:null,codigo_entrega_usado_em:null,codigo_entrega_expira_em:'2099-01-01T00:00:00Z',codigo_entrega_tentativas:0,status_token_hash:createHash('sha256').update(STATUS_TOKEN).digest('hex'),cliente_email:'buyer@example.test'};
const read={acao:'consultar_status',comercio_id:'loja-a',pedido_id:ORDER,status_token:STATUS_TOKEN};
test('comprador: token forte só devolve estado mínimo, mesmo com checkout desativado',async()=>{
 const e=load(statusPath,{order:baseOrder,offline:false});const r=await e.handler(req(read,''));assert.equal(r.status,200);
 const body=await r.json();assert.equal(body.success,true);assert.equal(body.pedido_id,ORDER);assert.equal(body.status,'pronto');assert.equal(body.codigo_ativo,true);assert.equal(body.concluido,false);
 assert.doesNotMatch(JSON.stringify(body),/buyer@example|cliente_email|status_token_hash|codigo_entrega_hash/);
 assert.deepEqual(Object.keys(body).sort(),['success','pedido_id','provedor','status','status_pagamento','aceito_em','reembolso_pendente','codigo_ativo','concluido','codigo_expira_em'].sort());
});
test('comprador: UUID ou código de seis dígitos não permite consultar sem prova',async()=>{
 for(const extra of [{status_token:'b'.repeat(64)},{status_token:null,codigo_entrega:'123456'},{status_token:'123456'}]){
  const e=load(statusPath,{order:baseOrder});const r=await e.handler(req({...read,...extra},''));assert.equal(r.status,403);assert.doesNotMatch(await r.text(),/buyer@example|cliente_email|status_token_hash/);
 }
});
test('comprador: código é ocultado quando pedido entregue ou cancelado',async()=>{
 for(const status of ['entregue','cancelado']){const e=load(statusPath,{order:{...baseOrder,status}});const r=await e.handler(req(read,''));const body=await r.json();assert.equal(body.codigo_ativo,false);assert.equal(body.concluido,status==='entregue');}
});
test('comprador legado: JWT de e-mail confirmado correspondente autoriza só leitura',async()=>{
 const e=load(statusPath,{order:{...baseOrder,status_token_hash:null},viewer:{id:RIDER,email:'buyer@example.test',email_confirmed_at:'2026-01-01'}});
 assert.equal((await e.handler(req({...read,status_token:null}))).status,200);
 const outsider=load(statusPath,{order:baseOrder});assert.equal((await outsider.handler(req({...read,status_token:null}))).status,403);
});
test('consulta de estado nunca reativa a confirmação pública',async()=>{
 const e=load(statusPath,{order:baseOrder,offline:false});assert.equal((await e.handler(req({acao:'confirmar_entrega',status_token:STATUS_TOKEN,codigo_entrega:'123456'},''))).status,410);
});
