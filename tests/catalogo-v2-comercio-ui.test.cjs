const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RIDER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function fixture(file, search = '?id=loja-a') {
  const nodes = new Map();
  const requests = [];
  const events = {};
  const makeNode = (id) => ({
    id, hidden: false, open: false, innerHTML: '', textContent: '', value: '', checked: false, disabled: false,
    dataset: {}, files: [], classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {}, focus() {}, scrollIntoView() {}, reset() { this.value = ''; this.checked = false; },
    close() { this.open = false; }, showModal() { this.open = true; },
    addEventListener(name, fn) { this[`on${name}`] = fn; },
    querySelectorAll() { return []; },
  });
  const get = (id) => { if (!nodes.has(id)) nodes.set(id, makeNode(id)); return nodes.get(id); };
  let current = { access_token: 'token-owner', user: { id: OWNER } };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: current }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
  };
  const window = {
    location: { search }, supabaseLoginClient: client, confirm: () => true,
    setTimeout: (fn) => fn(), clearTimeout() {}, addEventListener(name, fn) { events[name] = fn; },
    CatalogoUtils: { formatarMoeda: (value) => `R$ ${Number(value).toFixed(2)}` },
  };
  const document = {
    getElementById: get,
    querySelectorAll: () => [],
    addEventListener() {},
    readyState: 'complete',
  };
  const ctx = {
    window, document, URL, URLSearchParams, console, navigator: { onLine: true },
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, status: 200, json: async () => ({ success: true }) }; },
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000', getRandomValues: (bytes) => bytes.fill(1) },
    createImageBitmap: async () => ({ width: 1, height: 1, close() {} }),
  };
  let source = fs.readFileSync(`${ROOT}/${file}`, 'utf8');
  const marker = file === 'js/catalogo-admin.js'
    ? '  document.addEventListener("DOMContentLoaded", () => {\n    configurarEventos();\n    iniciar();\n  });'
    : '  document.addEventListener("DOMContentLoaded", iniciar, { once: true });';
  const exposed = file === 'js/catalogo-admin.js'
    ? '  window.__test = { entregaState, renderizarPedidosOffline, chamarEntregas, limparDados: () => { ultimaListaPedidos = []; entregaState.motoboys = []; } };'
    : '  window.__test = { state, renderizarDados, chamarApi, aplicarSessao, limparSessaoVisual, iniciarEventos, selecionarCredito };';
  assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  source = source.replace(marker, exposed);
  vm.runInNewContext(source, ctx, { filename: file });
  return { api: ctx.window.__test, ctx, get, nodes, requests, events, setSession: (session) => { current = session; } };
}

test('catalogo-v2-comercio: JavaScripts designados passam no parser Node', () => {
  for (const file of ['js/catalogo-admin.js', 'js/entregadores-admin.js', 'js/entregas-operacao.js']) {
    execFileSync(process.execPath, ['--check', file], { cwd: ROOT, stdio: 'pipe' });
  }
});

test('catalogo-v2-comercio: atribuição saiu integralmente de entregadores-admin e cadastro permanece', () => {
  const html = fs.readFileSync(`${ROOT}/pages/entregadores-admin.html`, 'utf8');
  const js = fs.readFileSync(`${ROOT}/js/entregadores-admin.js`, 'utf8');
  assert.doesNotMatch(html, /Atribuir pedidos|listaAtribuicoes|maisAtribuicoes/);
  assert.doesNotMatch(js, /listar_para_atribuicao|atribuir_pedido|listaAtribuicoes|data-atribuir-pedido/);
  assert.match(js, /listar_motoboys/);
  assert.match(js, /autorizar_motoboy/);
  assert.match(js, /suspender_motoboy/);
});

test('catalogo-v2-comercio: pedidos mostram v1/v2, status de pagamento, snapshot e motoboys na própria linha com escaping', () => {
  const env = fixture('js/catalogo-admin.js');
  env.api.entregaState.userId = OWNER;
  env.api.entregaState.motoboys = [{ usuario_id: RIDER, nome: '<Motoboy>' , ativo: true }];
  env.api.renderizarPedidosOffline([
    { id: 'p-v2', cliente_nome: '<cliente>', provedor: 'mercadopago', modalidade: 'entrega', forma_pagamento: 'pix', status: 'pronto', status_pagamento: 'aprovado', entrega_status: 'ofertado', versao_financeira: 2, subtotal_produtos_centavos: 10000, total_centavos: 10700, taxa_plataforma_centavos: 500, taxa_motoboy_centavos: 200, taxa_total_centavos: 700, metadata: { feeSnapshots: '<snapshot>' } },
    { id: 'p-v1', cliente_nome: 'Antigo', provedor: 'offline', modalidade: 'retirada', status: 'em_preparo', versao_financeira: 1, subtotal_produtos_centavos: 5000, total_centavos: 5000, taxa_plataforma_centavos: 250 },
  ]);
  const html = env.get('listaPedidosOffline').innerHTML;
  assert.match(html, /Taxa do pedido: R\$ 7\.00/);
  assert.match(html, /Taxa histórica/);
  assert.match(html, /Pagamento aprovado/);
  assert.match(html, /Motoboys disponíveis/);
  assert.match(html, /&lt;cliente&gt;/);
  assert.match(html, /&lt;Motoboy&gt;/);
  assert.doesNotMatch(html, /<script|onerror=/i);
  assert.match(html, /data-atribuir=/);
});

test('catalogo-v2-comercio: resposta de motoboys nunca é enviada com sessão antiga', async () => {
  const env = fixture('js/catalogo-admin.js');
  env.api.entregaState.generation = 1;
  env.api.entregaState.userId = OWNER;
  env.setSession({ access_token: 'token-other', user: { id: OTHER } });
  await assert.rejects(env.api.chamarEntregas('listar_motoboys', {}, 1, OWNER), /STALE_SESSION_REQUEST/);
  assert.equal(env.requests.length, 0);
});

test('catalogo-v2-comercio: operação só renderiza dados após autorização explícita e escapa conteúdo', () => {
  const env = fixture('js/entregas-operacao.js');
  env.get('operationPanel').hidden = true;
  env.api.state.authorized = false;
  env.api.renderizarDados({ ocorrencias: [{ motivo: '<script>alert(1)</script>', pedido_id: 'p' }], remuneracoes: [] });
  assert.equal(env.get('operationPanel').hidden, true);
  env.api.state.authorized = true;
  env.api.renderizarDados({
    ocorrencias: [{ titulo: '<ocorrência>', motivo: '<script>alert(1)</script>', pedido_ids: ['p-1'] }],
    remuneracoes: [{ credito_id: 'c-1', motoboy_id: RIDER, motoboy_nome: '<beneficiário>', valor_centavos: 200, status: 'a_receber', financiado: true, pedido_ids: ['p-1'], provas: ['<prova>'] }],
    historico_repasses: [{ motoboy_id: RIDER, valor_centavos: 100, status: 'registrado', pedido_ids: ['p-0'] }],
  });
  assert.match(env.get('listaOcorrencias').innerHTML, /&lt;ocorrência&gt;/);
  assert.doesNotMatch(env.get('listaOcorrencias').innerHTML, /<script>/);
  assert.match(env.get('listaRepasses').innerHTML, /&lt;beneficiário&gt;/);
  assert.match(env.get('listaRepasses').innerHTML, /&lt;prova&gt;/);
  assert.match(env.get('historicoRepasses').innerHTML, /p-0/);
});

test('catalogo-v2-comercio: operação usa ações administrativas, checkbox e nunca cria pagamento', () => {
  const js = fs.readFileSync(`${ROOT}/js/entregas-operacao.js`, 'utf8');
  const html = fs.readFileSync(`${ROOT}/pages/entregas-operacao.html`, 'utf8');
  assert.match(js, /chamarApi\("operacao_admin"/);
  assert.match(js, /chamarApi\("resolver_ocorrencia"/);
  assert.match(js, /chamarApi\("registrar_repasse"/);
  assert.match(js, /transferencia_confirmada: true/);
  assert.match(js, /state\.authorized/);
  assert.doesNotMatch(js, /mercadopago|create_payment|transferir|bank|pagamento_real/i);
  assert.match(html, /transferenciaConfirmada/);
  assert.match(html, /transferência já foi realizada/i);
  assert.doesNotMatch(html, /input[^>]+name=["']valor|criar pagamento/i);
});

test('catalogo-v2-comercio: logout limpa operação e sessão impede resposta de outro usuário', async () => {
  const env = fixture('js/entregas-operacao.js');
  env.api.state.session = { user: { id: OWNER } };
  env.api.state.userId = OWNER;
  env.api.state.generation = 1;
  env.setSession({ access_token: 'token-other', user: { id: OTHER } });
  await assert.rejects(env.api.chamarApi('operacao_admin', { operacao: 'listar' }, 1, OWNER), /STALE_SESSION_REQUEST/);
  assert.equal(env.requests.length, 0);
  env.api.state.authorized = true;
  env.api.state.data = { ocorrencias: [{ motivo: 'privado' }] };
  env.api.limparSessaoVisual();
  assert.equal(env.api.state.authorized, false);
  assert.equal(env.api.state.data, null);
  assert.equal(env.get('operationPanel').hidden, true);
});
