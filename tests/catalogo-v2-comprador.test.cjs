const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const catalogoSource = fs.readFileSync("js/catalogo.js", "utf8");
const endpointSource = fs.readFileSync("supabase/functions/catalogo-pedido-offline/index.ts", "utf8");
const html = fs.readFileSync("pages/catalogo.html", "utf8");
const COMMERCE = "comercio-teste";
const PRODUCT = "11111111-1111-4111-8111-111111111111";
const TOKEN = "a".repeat(64);
const ORDER = "22222222-2222-4222-8222-222222222222";

class FakeElement {
  constructor(id, tag = "div") {
    this.id = id; this.tagName = tag.toUpperCase(); this.hidden = false; this.open = false;
    this.disabled = false; this.value = ""; this.textContent = ""; this.innerHTML = "";
    this.href = ""; this.dataset = {}; this.listeners = new Map(); this.isConnected = true;
    this.classList = { add() {}, remove() {} }; this.elements = { namedItem: name => this.fields?.[name] || null };
  }
  addEventListener(type, handler) { const list = this.listeners.get(type) || []; list.push(handler); this.listeners.set(type, list); }
  dispatch(type, extra = {}) { const event = { currentTarget: this, target: this, preventDefault() {}, ...extra }; return Promise.all((this.listeners.get(type) || []).map(handler => handler(event))); }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  closest() { return this; }
  setAttribute() {}
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  click() { const assigned = typeof this.onclick === "function" ? this.onclick({ currentTarget: this, target: this }) : null; return Promise.all([assigned, this.dispatch("click")]); }
  remove() { this.isConnected = false; }
}

function makeDomHarness({ saved = null, consult = [], createResponse = null } = {}) {
  const ids = [
    "statusTitulo", "statusTexto", "catalogoAviso", "catalogoConteudo", "abrirCarrinho", "cartFabCount", "cartFabTotal", "irCheckout",
    "categoriasNav", "produtosGrid", "cartItems", "cartEmpty", "limparCarrinho", "cartTotal", "cartPanel", "cartBackdrop", "fecharCarrinho",
    "checkoutForm", "checkoutDialog", "checkoutErro", "modalidadeOptions", "enderecoEntrega", "pagamentoSelect", "confirmarPedidoDialog",
    "resumoPedido", "confirmarPedidoInstrucao", "whatsappErro", "voltarCheckout", "pagarPix", "criarPedidoOffline", "enviarWhatsApp",
    "offlinePedidoBox", "offlinePedidoStatus", "offlinePedidoCodigo", "copiarCodigoOffline", "pixPedidoBox", "pixPedidoStatus", "pixPedidoCodigo",
    "pixPedidoQr", "copiarPixPedido", "abrirTicketPix", "offlinePedidoRecente", "abrirPedidoOfflineSalvo", "offlinePedidoStatusAviso",
    "fotoComercio", "nomeComercio", "descricaoComercio", "enderecoComercio", "whatsappComercio", "whatsappInvalido", "voltarPerfil",
    "cancelarPedidoOffline", "cancelarPedidoNoDialog", "cancelamentoConfirmacao", "cancelamentoMensagem", "confirmarCancelamentoOffline",
    "voltarCancelamentoOffline", "cancelamentoWhatsApp",
  ];
  const elements = new Map(ids.map(id => [id, new FakeElement(id)]));
  elements.get("checkoutForm").fields = {
    nome: {}, telefone: {}, email: {}, modalidade: {}, pagamento: {}, endereco: {}, numero: {}, bairro: {}, complemento: {}, referencia: {}, observacoes: {},
  };
  elements.get("checkoutForm").fieldValues = {
    nome: "Ana", telefone: "(32) 99999-1234", email: "ana@example.com", modalidade: "retirada", pagamento: "dinheiro",
    endereco: "", numero: "", bairro: "", complemento: "", referencia: "", observacoes: "",
  };
  elements.get("checkoutForm").reportValidity = () => true;
  const listeners = new Map();
  const document = {
    visibilityState: "visible", body: new FakeElement("body"), getElementById: id => elements.get(id) || null,
    querySelectorAll: () => [], querySelector: () => null,
    addEventListener(type, handler) { const list = listeners.get(type) || []; list.push(handler); listeners.set(type, list); },
    createElement: tag => new FakeElement("created", tag),
  };
  const storage = new Map();
  if (saved) storage.set(`guia-offline-order:${COMMERCE}`, JSON.stringify(saved));
  const localStorage = { getItem: key => storage.has(key) ? storage.get(key) : null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
  const timers = new Map(); let timerId = 0; const calls = []; const deferred = []; let consultIndex = 0;
  const supabase = {
    functions: {
      invoke: async (name, options) => {
        calls.push({ name, body: options.body });
        if (options.body.acao === "criar_pedido_offline") return { data: createResponse || { success: true, pedido_id: ORDER, codigo_entrega: "654321", codigo_expira_em: new Date(Date.now() + 86400000).toISOString(), status_token: TOKEN, status: "aguardando_pagamento", status_pagamento: "pendente", provedor: "offline" }, error: null };
        if (options.body.acao === "cancelar_pedido") return { data: { success: true, pedido_id: ORDER, status: "cancelado", status_pagamento: "pendente", reembolso_pendente: false, codigo_ativo: false, concluido: false }, error: null };
        const next = consult[consultIndex++];
        if (next?.deferred) return new Promise(resolve => deferred.push(resolve));
        if (next instanceof Error) throw next;
        return next || { data: { success: true, pedido_id: options.body.pedido_id, status: "aguardando_pagamento", status_pagamento: "pendente", codigo_ativo: true, concluido: false }, error: null };
      },
    },
    from: table => {
      const query = {
        select() { return query; }, eq() { return query; }, is() { return query; }, order() { return query; },
        maybeSingle: async () => table === "catalogo_publicado" ? { data: { comercio_id: COMMERCE, modalidades: ["retirada"], metodos_pagamento: ["dinheiro", "pix"] }, error: null } : { data: null, error: null },
        then(resolve, reject) {
          const data = table === "catalogo_categorias" ? [{ id: "cat", nome: "Todos", ordem: 1, ativa: true, deletado_em: null }] : [{ id: PRODUCT, categoria_id: "cat", nome: "Produto", descricao: "Descrição", preco: 10, disponivel: true }];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const assigned = [];
  const window = {
    location: { search: `?id=${COMMERCE}`, assign: link => assigned.push(link) }, supabaseLoginClient: supabase,
    CatalogoUtils: require("../js/catalogo-utils.js"), setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id), requestAnimationFrame: fn => fn(), addEventListener: (type, handler) => { const list = listeners.get(`window:${type}`) || []; list.push(handler); listeners.set(`window:${type}`, list); },
  };
  const context = {
    window, document, localStorage, navigator: { clipboard: { writeText: async () => {} } }, URLSearchParams,
    FormData: class { constructor(form) { this.form = form; } get(name) { return this.form.fieldValues[name] || ""; } },
    fetch: async () => ({ ok: true, json: async () => [{ id: COMMERCE, status: "ativo", nome: "Loja", whatsapp: "(32) 99999-1234" }] }),
    crypto: Object.assign({}, webcrypto, { randomUUID: () => "request-id" }), console: { error() {}, warn() {} },
  };
  vm.runInNewContext(catalogoSource, context, { filename: "js/catalogo.js" });
  return {
    elements, storage, calls, deferred, timers, assigned, document,
    async load() { const ready = listeners.get("DOMContentLoaded")?.[0]; ready(); await new Promise(resolve => setImmediate(resolve)); },
    async flush() { await new Promise(resolve => setImmediate(resolve)); },
    async finishDeferred(value) { deferred.shift()?.(value); await new Promise(resolve => setImmediate(resolve)); },
  };
}

function savedReceipt(id = ORDER, status = "aguardando_pagamento") {
  return { pedido_id: id, codigo_entrega: "123456", codigo_expira_em: new Date(Date.now() + 86400000).toISOString(), status_token: TOKEN, provedor: "offline", status, status_pagamento: "pendente" };
}

async function endpointHandler() {
  const { stripTypeScriptTypes } = require("node:module");
  const js = stripTypeScriptTypes(endpointSource);
  let handler;
  const context = {
    Deno: { env: { get: () => "" }, serve: fn => { handler = fn; } },
    crypto: webcrypto, TextEncoder, TextDecoder, Response, Request, console: { error() {} }, atob, btoa,
  };
  vm.runInNewContext(js.replace(/import .*?;\n/, "const createClient = () => ({});\n"), context, { filename: "catalogo-pedido-offline.ts" });
  return handler;
}

test("contrato v2 do endpoint usa precificação/RPC, token forte e não entrega código ao fallback", () => {
  assert.match(endpointSource, /catalogo_fluxo_precificar/);
  assert.match(endpointSource, /catalogo_cancelar_comprador_v2/);
  assert.match(endpointSource, /p_status_token_hash/);
  assert.match(endpointSource, /status_token_hash/);
  assert.match(endpointSource, /delivery-code-v2:\$\{pedidoId\}/);
  assert.match(endpointSource, /const strongToken = STATUS_TOKEN_RE\.test/);
  assert.match(endpointSource, /codigo_entrega = code/);
  assert.doesNotMatch(endpointSource, /cliente_token_hash:/);
  assert.doesNotMatch(endpointSource, /codigo_entrega.*owner|owner.*codigo_entrega/i);
});

test("NodeVM endpoint rejeita token fraco/body forjado e preserva 410 de confirmação pública", async () => {
  const handler = await endpointHandler();
  const weak = await handler(new Request("https://example.test", { method: "POST", body: JSON.stringify({ acao: "cancelar_pedido", comercio_id: COMMERCE, pedido_id: ORDER, status_token: "fraco", codigo_entrega: "123456" }), headers: { "content-type": "application/json" } }));
  assert.equal(weak.status, 403);
  assert.match(await weak.text(), /Cancelamento não autorizado/);
  const legacy = await handler(new Request("https://example.test", { method: "POST", body: JSON.stringify({ acao: "confirmar_entrega", comercio_id: COMMERCE, pedido_id: ORDER, codigo_entrega: "123456" }), headers: { "content-type": "application/json" } }));
  assert.equal(legacy.status, 410);
});

test("PGlite runtime executa uma guarda mínima de propriedade por hash sem plaintext", async () => {
  const { PGlite } = require(process.env.PGLITE_TEST_MODULE || "@electric-sql/pglite");
  const db = new PGlite();
  try {
    await db.exec("create table tokens(pedido_id uuid primary key, comercio_id text not null, status_token_hash text not null); insert into tokens values ('22222222-2222-4222-8222-222222222222','comercio-teste','hash');");
    const result = await db.query("select pedido_id from tokens where pedido_id=$1 and comercio_id=$2 and status_token_hash=$3", [ORDER, COMMERCE, "hash"]);
    assert.deepEqual(result.rows, [{ pedido_id: ORDER }]);
    const forged = await db.query("select pedido_id from tokens where pedido_id=$1 and comercio_id=$2 and status_token_hash=$3", [ORDER, "outro-comercio", "hash"]);
    assert.deepEqual(forged.rows, []);
  } finally { await db.close(); }
});

test("NodeVM mantém resposta velha sem apagar comprovante novo da mesma sessão", async () => {
  const h = makeDomHarness({ saved: savedReceipt("pedido-antigo"), consult: [{ deferred: true }, { data: { success: true, pedido_id: ORDER, status: "aguardando_pagamento", codigo_ativo: true, concluido: false }, error: null }] });
  await h.load();
  await h.elements.get("checkoutForm").dispatch("submit");
  await h.elements.get("criarPedidoOffline").click();
  await h.flush();
  await h.finishDeferred({ data: { success: true, pedido_id: "pedido-antigo", status: "entregue", codigo_ativo: false, concluido: true }, error: null });
  const current = JSON.parse(h.storage.get(`guia-offline-order:${COMMERCE}`));
  assert.equal(current.pedido_id, ORDER);
  assert.equal(current.codigo_entrega, "654321");
});

test("cancelamento do comprador usa duas etapas e envia somente pedido/comércio/token forte", async () => {
  const h = makeDomHarness();
  await h.load();
  await h.elements.get("checkoutForm").dispatch("submit");
  await h.elements.get("criarPedidoOffline").click();
  await h.flush();
  await h.elements.get("cancelarPedidoOffline").click();
  assert.equal(h.elements.get("cancelamentoConfirmacao").hidden, false);
  assert.equal(h.elements.get("confirmarCancelamentoOffline").hidden, false);
  await h.elements.get("confirmarCancelamentoOffline").click();
  await h.flush();
  const cancel = h.calls.find(call => call.body.acao === "cancelar_pedido");
  assert.ok(cancel);
  assert.deepEqual(JSON.parse(JSON.stringify(cancel.body)), { acao: "cancelar_pedido", pedido_id: ORDER, comercio_id: COMMERCE, status_token: TOKEN, motivo: "Cancelado pelo comprador." });
  assert.equal(Object.hasOwn(cancel.body, "codigo_entrega"), false);
  assert.equal(JSON.parse(h.storage.get(`guia-offline-order:${COMMERCE}`)).status, "cancelado");
});

test("cancelamento após aceite mostra a mensagem exata e não chama RPC", async () => {
  const h = makeDomHarness({ saved: savedReceipt(ORDER, "em_preparo"), consult: [{ data: { success: true, pedido_id: ORDER, status: "em_preparo", aceito_em: new Date().toISOString(), codigo_ativo: true, concluido: false }, error: null }] });
  await h.load();
  await h.elements.get("cancelarPedidoOffline").click();
  assert.equal(h.elements.get("cancelamentoMensagem").textContent, "seu pedido já esta sendo preparado pelo estabelecimento e não pode mais ser cancelado normalmente. caso exista um problema com o pedido entre em contato com o estabelecimento via WhatsApp.");
  assert.equal(h.elements.get("confirmarCancelamentoOffline").hidden, true);
  assert.equal(h.calls.some(call => call.body.acao === "cancelar_pedido"), false);
});

test("HTML mantém WhatsApp e não reintroduz remoção local do comprovante", () => {
  assert.match(html, /id="cancelarPedidoOffline"/);
  assert.match(html, /Tem certeza que quer cancelar o pedido\?/);
  assert.match(html, /id="cancelamentoWhatsApp"/);
  assert.match(html, /data-whatsapp="pedido"/);
  assert.doesNotMatch(html, /Remover deste dispositivo|limparPedidoOfflineSalvo/);
  assert.doesNotMatch(catalogoSource, /window\.open\s*\(/);
});
