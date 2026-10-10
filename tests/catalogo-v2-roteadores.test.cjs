const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto, createHash } = require('node:crypto');

const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RIDER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN='4b9a0233-6b72-4573-aebd-d596c5b15e1b';
const ORDER='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ORDER2='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const COMMERCE='loja-a';

function endpoint(path,{ actor=RIDER, membership=true, assignment=true, result={ok:true}, rpcError=null }={}) {
  const calls=[];const writes=[];let handler;
  const db={auth:{getUser:async token=>({data:{user:token==='valid'?{id:actor}:null},error:null})},
    rpc:async(name,args)=>{calls.push({name,args});return {data:result,error:rpcError};},
    from:name=>{
      const q={select(){return q;},eq(){return q;},in(){return q;},order(){return q;},limit(){return q;},
        update(body){writes.push({name,body});return q;},
        maybeSingle:async()=>({data:name==='catalogos'?{proprietario_id:OWNER,bloqueado:false}:name==='catalogo_motoboys'?(membership?{usuario_id:actor}:null):(assignment?{pedido_id:ORDER}:null),error:null}),
        then(resolve){return Promise.resolve({data:name==='catalogo_aceites_operacionais'
            ?[{documento:'termos'},{documento:'privacidade'}]:[],error:null}).then(resolve);}};
      return q;
    }};
  const source=fs.readFileSync(path,'utf8').replace(/^import[^;]+;\s*/gm,'');
 const helper=stripTypeScriptTypes(fs.readFileSync('supabase/functions/_shared/catalogo-entregas-crypto-v2.ts','utf8')).replace(/^export\s+/gm,'');
  vm.runInNewContext(helper+"\n"+stripTypeScriptTypes(source),{
    createClient:()=>db,Deno:{env:{get:()=>''},serve:h=>{handler=h;}},Request,Response,TextEncoder,TextDecoder,atob,btoa,crypto:webcrypto,
    fetch:()=>{throw new Error('Transferência externa proibida no teste.');},console:{error(){},warn(){}}});
  return {handler,calls,writes};
}
function request(body,token='valid'){
  return new Request('https://example.test/function',{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
}
const delivery='supabase/functions/catalogo-entregas/index.ts';
const merchant='supabase/functions/catalogo-pedidos-offline-admin/index.ts';

test('roteador v2 não executa ações sem JWT validado',async()=>{
  for(const path of [delivery,merchant]){
    const e=endpoint(path);
    for(const token of ['', 'invalid']) assert.equal((await e.handler(request({acao:'listar_entregas'},token))).status,401);
    assert.equal(e.calls.length,0);
  }
});
test('listar e extrato não encaminham identidade nem comércio forjados',async()=>{
  const e=endpoint(delivery);
  for(const action of ['listar_entregas','consultar_extrato']){
    assert.equal((await e.handler(request({acao:action,comercio_id:'loja-outro',operador_id:ADMIN,user_id:ADMIN,offset:0}))).status,200);
  }
  for(const call of e.calls)assert.deepEqual(JSON.parse(JSON.stringify(call.args)),{p_operador_id:RIDER,p_offset:0});
  assert.equal(e.calls[0].name,'catalogo_listar_entregas_v2');
  assert.equal(e.calls[1].name,'catalogo_motoboy_extrato_v2');
});
test('disponibilidade exige booleano real e aceite exige UUID antes de executar SQL',async()=>{
  const e=endpoint(delivery);
  assert.equal((await e.handler(request({acao:'definir_disponibilidade',disponivel:'true'}))).status,400);
  assert.equal((await e.handler(request({acao:'aceitar_entrega',pedido_id:'loja-a'}))).status,400);
  assert.equal((await e.handler(request({acao:'registrar_ocorrencia',pedido_id:ORDER}))).status,400);
  assert.equal(e.calls.length,0);
});
test('coleta e preferência nunca aceitam operador/beneficiário definidos pelo cliente',async()=>{
  const e=endpoint(delivery);
  await e.handler(request({acao:'coletar',pedido_id:ORDER,user_id:ADMIN,motoboy_id:ADMIN,valor_centavos:99999}));
  assert.equal(e.calls[0].args.p_operador_id,RIDER);
  assert.equal(e.calls[0].args.p_pedido_id,ORDER);
  assert.equal(e.calls[0].args.p_acao,'coletar');
  assert.equal(e.calls[0].args.p_motoboy_id,undefined);
  assert.equal(e.calls[0].args.p_valor_centavos,undefined);
});
test('confirmação exige vínculo e atribuição até mesmo para conta com outras funções',async()=>{
  for(const config of [{membership:false},{assignment:false}]){
    const e=endpoint(delivery,config);
    const r=await e.handler(request({acao:'confirmar_entrega',comercio_id:COMMERCE,pedido_id:ORDER,codigo_entrega:'123456',recebimento_confirmado:true}));
    assert.equal(r.status,403);assert.equal(e.calls.length,0);
  }
});
test('código só vai à transação como hash e remuneração não vem de valor enviado pelo cliente',async()=>{
  const e=endpoint(delivery,{result:{ok:true,status:'entregue'}});
  const r=await e.handler(request({acao:'confirmar_entrega',comercio_id:COMMERCE,pedido_id:ORDER,codigo_entrega:'123456',recebimento_confirmado:true,valor_bonus_centavos:9999,motoboy_id:ADMIN}));
  assert.equal(r.status,200);assert.equal(e.calls[0].name,'catalogo_confirmar_entrega_motoboy');
  assert.equal(e.calls[0].args.p_operador_id,RIDER);
  assert.equal(e.calls[0].args.p_codigo_hash,createHash('sha256').update('123456').digest('hex'));
  assert.doesNotMatch(JSON.stringify(e.calls),/123456|9999/);
});
test('administração financeira não pode ser chamada por comércio ou entregador',async()=>{
  for(const actor of [OWNER,RIDER]){
    const e=endpoint(delivery,{actor});
    for(const acao of ['operacao_admin','resolver_ocorrencia','registrar_repasse'])assert.equal((await e.handler(request({acao,operador_id:ADMIN}))).status,403);
    assert.equal(e.calls.length,0);
  }
});
test('registro de repasse exige declaração, identificação e prova; não transfere dinheiro',async()=>{
  const e=endpoint(delivery,{actor:ADMIN});
  const base={acao:'registrar_repasse',motoboy_id:RIDER,pedido_ids:[ORDER],referencia:'PIX-CONFERIDO',comprovante:'Comprovante bancário conferido pelo operador',transferencia_confirmada:true};
  for(const change of [{transferencia_confirmada:false},{referencia:''},{comprovante:''},{pedido_ids:[]},{pedido_ids:['invalid']},{pedido_ids:Array(101).fill(ORDER)}])assert.equal((await e.handler(request({...base,...change}))).status,400);
  assert.equal(e.calls.length,0);
  const r=await e.handler(request({...base,pedido_ids:[ORDER,ORDER,ORDER2],user_id:OWNER}));
  assert.equal(r.status,200);assert.equal(e.calls.length,1);
  assert.equal(e.calls[0].name,'catalogo_operacao_admin_v2');assert.equal(e.calls[0].args.p_operador_id,ADMIN);
  assert.deepEqual(Array.from(e.calls[0].args.p_pedido_ids),[ORDER,ORDER2]);
  assert.equal(e.writes.length,0);
});
test('atribuição seletiva é uma transação de proprietário, não um crédito ou aceite automático',async()=>{
  const e=endpoint(delivery,{actor:OWNER});
  await e.handler(request({acao:'atribuir_pedido',comercio_id:COMMERCE,pedido_id:ORDER,motoboy_id:RIDER,operador_id:ADMIN}));
  assert.equal(e.calls[0].name,'catalogo_operar_pedido_v2');assert.equal(e.calls[0].args.p_operador_id,OWNER);
  assert.equal(e.calls[0].args.p_acao,'atribuir');assert.equal(e.calls[0].args.p_motoboy_id,RIDER);
  assert.equal(e.writes.length,0);
});
test('comércio prepara e solicita cancelamento via RPC sem apagar status/comissão diretamente',async()=>{
  const e=endpoint(merchant,{actor:OWNER,result:{ok:true,pedido:{status:'em_preparo'}}});
  for(const [status,operation]of[['em_preparo','aceitar'],['pronto','pronto'],['cancelado','solicitar_cancelamento']]){
    assert.equal((await e.handler(request({acao:'atualizar_status',comercio_id:COMMERCE,pedido_id:ORDER,status,motivo:'Conferir ocorrência',operador_id:ADMIN}))).status,200);
    const call=e.calls.at(-1);assert.equal(call.name,'catalogo_operar_pedido_v2');assert.equal(call.args.p_acao,operation);assert.equal(call.args.p_operador_id,OWNER);
  }
  assert.equal(e.writes.length,0);
});
test('comércio de outra conta e cancelamento sem motivo não passam pelo roteador',async()=>{
  const forbidden=endpoint(merchant,{actor:RIDER});
  assert.equal((await forbidden.handler(request({acao:'atualizar_status',comercio_id:COMMERCE,pedido_id:ORDER,status:'cancelado',motivo:'Teste'}))).status,403);
  assert.equal(forbidden.calls.length,0);
  const own=endpoint(merchant,{actor:OWNER});
  assert.equal((await own.handler(request({acao:'atualizar_status',comercio_id:COMMERCE,pedido_id:ORDER,status:'cancelado'}))).status,400);
  assert.equal(own.calls.length,0);
});
test('conflito transacional é devolvido sem reenviar ação ou simular sucesso',async()=>{
  const e=endpoint(delivery,{result:{ok:false,http_status:409,mensagem:'Outro motoboy já aceitou este pedido.'}});
  const r=await e.handler(request({acao:'aceitar_entrega',pedido_id:ORDER}));assert.equal(r.status,409);
  assert.equal((await r.json()).success,false);assert.equal(e.calls.length,1);assert.equal(e.writes.length,0);
});

test('tela de atribuição não devolve contato nem observação pessoal do comprador',async()=>{
  const e=endpoint(delivery,{actor:OWNER,result:{ok:true,pedidos:[{pedido_id:ORDER,cliente_nome:'Privado',cliente_telefone:'32999998888',cliente_endereco:'Rua privada',cliente_bairro:'Centro',observacoes:'Ligue 32999998888'}]}});
  const response=await e.handler(request({acao:'listar_para_atribuicao',comercio_id:COMMERCE}));
  assert.equal(response.status,200);const body=await response.json();
  assert.equal(body.pedidos[0].pedido_id,ORDER);assert.equal(body.pedidos[0].cliente_bairro,'Centro');
  assert.doesNotMatch(JSON.stringify(body),/Privado|32999998888|Rua privada|observacoes/);
});
