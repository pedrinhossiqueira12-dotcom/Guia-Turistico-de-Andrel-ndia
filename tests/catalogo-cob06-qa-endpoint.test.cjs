const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const EDGE = 'supabase/functions/catalogo-cob06-qa/index.ts';
const STAGING = 'https://jbttwihctuibchhcyqtl.supabase.co';
const PROD = 'https://xdmbkflufsfqziixzpxc.supabase.co';
const REVIEWER = 'd896cc0c-31e4-4ef7-8fa4-13d15f02dd2a';
const ORDER = 'a4ca7c4e-465f-4342-ae18-5c7eea1dec15';
const OCCURRENCE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const BODY = {
  acao: 'cancelar_retirada_ficticia_qa',
  pedido_id: ORDER,
  comercio_id: 'asaas-cob02',
  ocorrencia_id: OCCURRENCE,
  decisao: 'cancelamento_legitimo',
  motivo: 'Pedido inteiramente ficticio, sem retirada e sem dinheiro recebido.',
  sem_recebimento_confirmado: true,
  sem_entrega_confirmada: true,
};
const VALID_ENV = {
  SUPABASE_URL: STAGING,
  SUPABASE_SERVICE_ROLE_KEY: 'mock-local-sem-credenciais',
  COB06_QA_CANCELAMENTO_HABILITADO: 'true',
};

function endpoint({ env = VALID_ENV, actor = REVIEWER, email = 'pedrinhossiqueira12@gmail.com',
                    tokenValid = true, result = {ok:true,status:'cancelado',comissao_status:'cancelada'},
                    rpcError = null } = {}) {
  let handler;
  const calls = [];
  let clients = 0;
  const supabase = {
    auth: { getUser: async token => ({
      data: { user: token === 'valid' && tokenValid ? { id: actor, email } : null },
      error: null,
    }) },
    rpc: async (name, args) => {
      calls.push({name,args});
      return { data: result, error: rpcError };
    },
  };
  const src = fs.readFileSync(EDGE,'utf8').replace(/^import[^;]+;\s*/gm,'');
  vm.runInNewContext(stripTypeScriptTypes(src), {
    Deno: { env: {get: key => env[key] ?? ''}, serve: fn => { handler = fn; } },
    createClient: () => {clients++;return supabase;},
    Request, Response, console: { error() {} },
  });
  return { handler, calls, get clients(){ return clients; } };
}
function request(body = BODY, token = 'valid', method = 'POST') {
  return new Request('https://example.test/functions/v1/catalogo-cob06-qa',{
    method, headers: {'content-type':'application/json', ...(token ? { authorization:'Bearer '+token }: {})},
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
}

test('COB06 endpoint isolado permanece desligado por padrao e fora do STAGING', async () => {
  for(const env of [
    {},
    { ...VALID_ENV, COB06_QA_CANCELAMENTO_HABILITADO:'false' },
    { ...VALID_ENV, COB06_QA_CANCELAMENTO_HABILITADO:'True' },
    { ...VALID_ENV, SUPABASE_URL:PROD },
  ]){
    const e = endpoint({env});
    const r = await e.handler(request());
    assert.equal(r.status,403);
    assert.equal(e.clients,0);
    assert.equal(e.calls.length,0);
  }
});
test('COB06 endpoint nao aceita outro metodo nem token ausente ou invalido', async () => {
  const e=endpoint();
  assert.equal((await e.handler(new Request('https://example.test',{method:'OPTIONS'}))).status,204);
  assert.equal((await e.handler(request(BODY,'','POST'))).status,401);
  assert.equal((await e.handler(request(BODY,'invalid','POST'))).status,401);
  assert.equal((await e.handler(new Request('https://example.test',{method:'GET'}))).status,405);
  assert.equal(e.calls.length,0);
});
test('COB06 endpoint nao reconhece admin antigo, comercio, motoboy ou email divergente',async()=>{
  for(const conf of [
    {actor:'4b9a0233-6b72-4573-aebd-d596c5b15e1b'},
    {actor:'aad98089-dd5d-4bc0-b054-4cb139de198c'},
    {actor:'cff7f0a2-e449-4f84-aeec-01f7f4482846'},
    {actor:REVIEWER,email:'forjado@example.test'},
  ]) {
    const e=endpoint(conf);
    const r=await e.handler(request({...BODY, operador_id:REVIEWER}));
    assert.equal(r.status,403);
    assert.equal(e.calls.length,0);
  }
});
test('COB06 endereco, ocorrencia e confirmacoes sao inalteraveis pelo cliente',async()=>{
  for(const change of [
    {pedido_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},
    {comercio_id:'outra-loja'},
    {ocorrencia_id:'errado'},
    {decisao:'manter'},
    {sem_recebimento_confirmado:false},
    {sem_recebimento_confirmado:'true'},
    {sem_entrega_confirmada:false},
    {motivo:'curto'},
    {motivo:'x'.repeat(501)},
  ]) {
    const e=endpoint();
    const r=await e.handler(request({...BODY,...change}));
    assert.ok([400,403].includes(r.status));
    assert.equal(e.calls.length,0);
  }
});
test('COB06 entrega somente UID autenticado a RPC e nao faz transferencia externa',async()=>{
  const e=endpoint();
  const response=await e.handler(request({
    ...BODY, operador_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    p_operador_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    user_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',valor_centavos:9999999,
  }));
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.success,true);assert.equal(body.status,'cancelado');
  assert.equal(e.calls.length,1);
  assert.equal(e.calls[0].name,'catalogo_cob06_cancelar_retirada_qa_v2');
  assert.deepEqual(JSON.parse(JSON.stringify(e.calls[0].args)),{
    p_operador_id:REVIEWER,
    p_ocorrencia_id:OCCURRENCE,
    p_decisao:'cancelamento_legitimo',
    p_motivo:BODY.motivo,
    p_ficticio_sem_recebimento:true,
  });
});
test('COB06 preserva recusas financeiras e mascara falhas internas',async()=>{
  const blocked=endpoint({result:{ok:false,http_status:409,mensagem:'Pedido vinculado a fatura paga.'}});
  const r=await blocked.handler(request());
  assert.equal(r.status,409);
  assert.equal((await r.json()).success,false);
  const failed=endpoint({rpcError:{code:'42501',message:'detalhes privados'}});
  const f=await failed.handler(request());
  assert.equal(f.status,503);
  assert.doesNotMatch(JSON.stringify(await f.json()),/42501|detalhes privados/);
});
