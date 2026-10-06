const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto, createHash } = require('node:crypto');

const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BUYER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORDER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function loadEndpoint(path, userId = OWNER, rpcResult = { ok: true, status: 'entregue' }) {
  const calls = [];
  let handler;
  const db = {
    auth: { getUser: async token => ({ data: { user: token === 'valid' ? { id: userId } : null }, error: null }) },
    from: name => {
      const query = { select() { return query; }, eq() { return query; },
        maybeSingle: async () => ({ data: { proprietario_id: OWNER, bloqueado: false }, error: null }) };
      return query;
    },
    rpc: async (name, body) => { calls.push({ name, body }); return { data: rpcResult, error: null }; },
  };
  const src = fs.readFileSync(path, 'utf8').replace(/^import .*createClient.*;\s*/m, '');
  const code = stripTypeScriptTypes(src);
  vm.runInNewContext(code, {
    createClient: () => db,
    Deno: { env: { get: k => k === 'OFFLINE_CHECKOUT_ENABLED' ? 'true' : 'test-value' }, serve: h => { handler = h; } },
    Request, Response, TextEncoder, crypto: webcrypto, console: { error() {}, warn() {} },
  });
  return { calls, handler };
}
function request(body, auth = 'Bearer valid') {
  return new Request('https://example.test/function', { method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) });
}
const adminPath = 'supabase/functions/catalogo-pedidos-offline-admin/index.ts';
const confirmation = { acao: 'confirmar_entrega', comercio_id: 'comercio-de-exemplo', pedido_id: ORDER, codigo_entrega: '123456' };

test('baixa exige sessão e não chama a RPC sem JWT', async () => {
  const e = loadEndpoint(adminPath);
  assert.equal((await e.handler(request(confirmation, ''))).status, 401);
  assert.equal((await e.handler(request(confirmation, 'Bearer invalid'))).status, 401);
  assert.equal(e.calls.length, 0);
});
test('comprador ou proprietário de outro comércio não pode confirmar', async () => {
  const e = loadEndpoint(adminPath, BUYER);
  assert.equal((await e.handler(request(confirmation))).status, 403);
  assert.equal(e.calls.length, 0);
});
test('operador da RPC vem do JWT, nunca de um campo enviado pelo comprador', async () => {
  const e = loadEndpoint(adminPath);
  const response = await e.handler(request({ ...confirmation, p_operador_id: BUYER, operador_id: BUYER, user_id: BUYER }));
  assert.equal(response.status, 200);
  assert.equal(e.calls.length, 1);
  assert.equal(e.calls[0].name, 'catalogo_confirmar_entrega_autenticada');
  assert.equal(e.calls[0].body.p_operador_id, OWNER);
  assert.equal(e.calls[0].body.p_pedido_id, ORDER);
  assert.equal(e.calls[0].body.p_codigo_hash, createHash('sha256').update('123456').digest('hex'));
  assert.ok(!JSON.stringify(e.calls).includes('123456'));
});
test('código malformado e UUID inválido não consomem tentativa SQL', async () => {
  const e = loadEndpoint(adminPath);
  assert.equal((await e.handler(request({ ...confirmation, codigo_entrega: '12-456' }))).status, 400);
  assert.equal((await e.handler(request({ ...confirmation, pedido_id: 'outro' }))).status, 400);
  assert.equal(e.calls.length, 0);
});
test('código incorreto é transmitido como erro útil ao painel', async () => {
  const e = loadEndpoint(adminPath, OWNER, { ok: false, http_status: 403, mensagem: 'Código de entrega incorreto.' });
  const r = await e.handler(request(confirmation));
  assert.equal(r.status, 403);
  assert.equal((await r.json()).mensagem, 'Código de entrega incorreto.');
});
test('endpoint público rejeita confirmação mesmo com token e código corretos', async () => {
  const e = loadEndpoint('supabase/functions/catalogo-pedido-offline/index.ts');
  const r = await e.handler(request({ acao: 'confirmar_entrega', cliente_token: ORDER, codigo_entrega: '123456' }, ''));
  assert.equal(r.status, 410);
  assert.equal(e.calls.length, 0);
});
test('painel não executa listeners fora do escopo e mantém formulário de confirmação', () => {
  const src = fs.readFileSync('js/catalogo-admin.js', 'utf8');
  const handlers = [];
  vm.runInNewContext(src, { window: { location: { search: '' } }, URLSearchParams,
    document: { addEventListener: (event, handler) => handlers.push(handler) } });
  assert.equal(handlers.length, 1);
  const html = fs.readFileSync('pages/catalogo-admin.html', 'utf8');
  for (const id of ['confirmarEntregaPainelForm', 'confirmarEntregaPedidoId', 'confirmarEntregaCodigo',
    'confirmarEntregaRecebido', 'confirmarEntregaFeedback', 'confirmarEntregaEnviar']) assert.ok(html.includes(`id="${id}"`));
});
test('página antiga funciona sem biblioteca Supabase e remove token antigo da URL', () => {
  const status = { textContent: '' }; const form = { hidden: false }; let cleaned;
  vm.runInNewContext(fs.readFileSync('js/pedido-offline.js', 'utf8'), {
    document: { getElementById: id => id === 'confirmarEntregaForm' ? form : status }, URLSearchParams,
    window: { location: { search: '?token=antigo', pathname: '/pages/pedido-offline' },
      history: { replaceState: (...args) => { cleaned = args[2]; } } },
  });
  assert.equal(form.hidden, true);
  assert.match(status.textContent, /painel autenticado/);
  assert.equal(cleaned, '/pages/pedido-offline');
});
