const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const source = fs.readFileSync("js/catalogo.js", "utf8");
const utils = require("../js/catalogo-utils.js");
const PRODUCT = "11111111-1111-4111-8111-111111111111";
const COMMERCE = "comercio-teste";
const TOKEN = "a".repeat(64);

class FakeElement {
  constructor(id, tag = "div") {
    this.id = id;
    this.tagName = tag.toUpperCase();
    this.hidden = false;
    this.open = false;
    this.disabled = false;
    this.value = "";
    this.textContent = "";
    this.innerHTML = "";
    this.href = "";
    this.dataset = {};
    this.listeners = new Map();
    this.classList = { add() {}, remove() {} };
    this.isConnected = true;
    this.elements = { namedItem: name => this.fields?.[name] || null };
  }
  addEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  dispatch(type, extra = {}) {
    const event = { currentTarget: this, target: this, preventDefault() {}, ...extra };
    return Promise.all((this.listeners.get(type) || []).map(handler => handler(event)));
  }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  closest() { return this; }
  setAttribute() {}
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  click() {
    const assigned = typeof this.onclick === "function" ? this.onclick({ currentTarget: this, target: this }) : null;
    return Promise.all([assigned, this.dispatch("click")]);
  }
  remove() { this.isConnected = false; }
}

function makeHarness({ saved = null, consult = [], createResponse = null } = {}) {
  const ids = [
    "statusTitulo", "statusTexto", "catalogoAviso", "catalogoConteudo", "abrirCarrinho", "cartFabCount", "cartFabTotal",
    "irCheckout", "categoriasNav", "produtosGrid", "cartItems", "cartEmpty", "limparCarrinho", "cartTotal", "cartPanel",
    "cartBackdrop", "fecharCarrinho", "checkoutForm", "checkoutDialog", "checkoutErro", "modalidadeOptions", "enderecoEntrega",
    "pagamentoSelect", "confirmarPedidoDialog", "resumoPedido", "confirmarPedidoInstrucao", "whatsappErro", "voltarCheckout",
    "pagarPix", "criarPedidoOffline", "enviarWhatsApp", "offlinePedidoBox", "offlinePedidoStatus", "offlinePedidoCodigo",
    "copiarCodigoOffline", "pixPedidoBox", "pixPedidoStatus", "pixPedidoCodigo", "pixPedidoQr", "copiarPixPedido",
    "abrirTicketPix", "offlinePedidoRecente", "abrirPedidoOfflineSalvo", "offlinePedidoStatusAviso", "fotoComercio",
    "nomeComercio", "descricaoComercio", "enderecoComercio", "whatsappComercio", "whatsappInvalido", "voltarPerfil",
  ];
  const elements = new Map(ids.map(id => [id, new FakeElement(id)]));
  elements.get("checkoutForm").fields = {
    nome: { required: false }, telefone: { required: false }, email: { required: false }, modalidade: { required: false },
    pagamento: { required: false }, endereco: { required: false }, numero: { required: false }, bairro: { required: false },
  };
  elements.get("checkoutForm").fieldValues = {
    nome: "Ana", telefone: "(32) 99999-1234", email: "ana@example.com", modalidade: "retirada", pagamento: "dinheiro",
    endereco: "", numero: "", bairro: "", complemento: "", referencia: "", observacoes: "",
  };
  elements.get("checkoutForm").reportValidity = () => true;

  const listeners = new Map();
  const document = {
    visibilityState: "visible",
    body: new FakeElement("body"),
    getElementById: id => elements.get(id) || null,
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener(type, handler) {
      const list = listeners.get(type) || [];
      list.push(handler);
      listeners.set(type, list);
    },
    createElement: tag => new FakeElement("created", tag),
  };
  const storage = new Map();
  if (saved) storage.set(`guia-offline-order:${COMMERCE}`, JSON.stringify(saved));
  const localStorage = {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  };
  const timers = new Map();
  let timerId = 0;
  const calls = [];
  const deferred = [];
  let consultIndex = 0;
  const supabase = {
    functions: {
      invoke: async (name, options) => {
        calls.push({ name, body: options.body });
        if (options.body.acao === "criar_pedido_offline") {
          return createResponse || {
            data: { success: true, pedido_id: "novo-pedido", codigo_entrega: "654321", codigo_expira_em: new Date(Date.now() + 86400000).toISOString(), status_token: TOKEN },
            error: null,
          };
        }
        const next = consult[consultIndex++];
        if (next?.deferred) return new Promise(resolve => deferred.push(resolve));
        if (next instanceof Error) throw next;
        if (next) return next;
        return { data: { success: true, pedido_id: options.body.pedido_id, status: "aguardando_pagamento", codigo_ativo: true, concluido: false }, error: null };
      },
    },
    from: table => {
      const query = {
        select() { return query; },
        eq() { return query; },
        is() { return query; },
        order() { return query; },
        maybeSingle: async () => table === "catalogo_publicado"
          ? { data: { comercio_id: COMMERCE, modalidades: ["retirada"], metodos_pagamento: ["dinheiro", "pix"] }, error: null }
          : { data: null, error: null },
        then(resolve, reject) {
          const data = table === "catalogo_categorias"
            ? [{ id: "cat", nome: "Todos", ordem: 1, ativa: true, deletado_em: null }]
            : [{ id: PRODUCT, categoria_id: "cat", nome: "Produto", descricao: "Descrição", preco: 10, disponivel: true }];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const assigned = [];
  const window = {
    location: { search: `?id=${COMMERCE}`, assign: link => assigned.push(link) },
    supabaseLoginClient: supabase,
    CatalogoUtils: utils,
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: fn => fn(),
    addEventListener: (type, handler) => {
      const list = listeners.get(`window:${type}`) || [];
      list.push(handler);
      listeners.set(`window:${type}`, list);
    },
  };
  const context = {
    window, document, localStorage, navigator: { clipboard: { writeText: async () => {} } },
    URLSearchParams, FormData: class {
      constructor(form) { this.form = form; }
      get(name) { return this.form.fieldValues[name] || ""; }
    },
    fetch: async () => ({ ok: true, json: async () => [{ id: COMMERCE, status: "ativo", nome: "Loja", whatsapp: "(32) 99999-1234" }] }),
    crypto: { ...webcrypto, randomUUID: () => "request-id" },
    console: { error() {}, warn() {} },
    localStorage,
  };
  vm.runInNewContext(source, context, { filename: "js/catalogo.js" });
  const ready = listeners.get("DOMContentLoaded")?.[0];
  storage.set(`guia-catalogo-cart:${COMMERCE}`, JSON.stringify({ [PRODUCT]: 1 }));
  return {
    elements, storage, calls, deferred, timers, assigned, document, window,
    async load() { ready(); await new Promise(resolve => setImmediate(resolve)); },
    async flush() { await new Promise(resolve => setImmediate(resolve)); },
    async finishDeferred(value) { deferred.shift()?.(value); await new Promise(resolve => setImmediate(resolve)); },
    async visibility(state) { document.visibilityState = state; for (const fn of listeners.get("visibilitychange") || []) fn(); await new Promise(resolve => setImmediate(resolve)); },
    async pagehide() { for (const fn of listeners.get("window:pagehide") || []) fn(); await new Promise(resolve => setImmediate(resolve)); },
  };
}

function savedReceipt(id = "pedido-antigo", code = "123456") {
  return { pedido_id: id, codigo_entrega: code, codigo_expira_em: new Date(Date.now() + 86400000).toISOString(), status_token: TOKEN };
}

 test("comprovante some do aviso e do diálogo após status concluído", async () => {
  const h = makeHarness({ saved: savedReceipt(), consult: [{ deferred: true }] });
  await h.load();
  await h.elements.get("abrirPedidoOfflineSalvo").click();
  assert.equal(h.elements.get("offlinePedidoBox").hidden, false);
  await h.finishDeferred({ data: { success: true, pedido_id: "pedido-antigo", status: "entregue", codigo_ativo: false, concluido: true }, error: null });
  assert.equal(h.storage.has(`guia-offline-order:${COMMERCE}`), false);
  assert.equal(h.elements.get("offlinePedidoRecente").hidden, true);
  assert.equal(h.elements.get("offlinePedidoBox").hidden, true);
  assert.equal(h.elements.get("offlinePedidoCodigo").textContent, "");
});

test("erro ou offline mantém código salvo e avisa sem afirmar conclusão", async () => {
  const h = makeHarness({ saved: savedReceipt(), consult: [new Error("offline"), new Error("offline") ] });
  await h.load();
  await h.elements.get("abrirPedidoOfflineSalvo").click();
  await h.flush();
  assert.equal(h.storage.has(`guia-offline-order:${COMMERCE}`), true);
  assert.equal(h.elements.get("offlinePedidoRecente").hidden, false);
  assert.equal(h.elements.get("offlinePedidoCodigo").textContent, "123456");
  assert.equal(h.elements.get("offlinePedidoStatusAviso").hidden, false);
  assert.match(h.elements.get("offlinePedidoStatus").textContent, /não foi possível consultar/i);
});

test("resposta velha não apaga comprovante novo", async () => {
  const h = makeHarness({ saved: savedReceipt("pedido-antigo", "123456"), consult: [{ deferred: true }, { data: { success: true, pedido_id: "novo-pedido", codigo_ativo: true, concluido: false }, error: null }] });
  await h.load();
  const form = h.elements.get("checkoutForm");
  await form.dispatch("submit");
  await h.elements.get("criarPedidoOffline").click();
  await h.flush();
  await h.finishDeferred({ data: { success: true, pedido_id: "pedido-antigo", codigo_ativo: false, concluido: true }, error: null });
  assert.equal(JSON.parse(h.storage.get(`guia-offline-order:${COMMERCE}`)).pedido_id, "novo-pedido");
  assert.equal(h.elements.get("offlinePedidoCodigo").textContent, "654321");
});

test("WhatsApp navega sem popup, sem código/token e não cria outro pedido", async () => {
  const h = makeHarness();
  await h.load();
  await h.elements.get("checkoutForm").dispatch("submit");
  await h.elements.get("criarPedidoOffline").click();
  await h.flush();
  assert.equal(h.elements.get("enviarWhatsApp").hidden, false);
  const antes = h.calls.filter(call => call.body.acao === "criar_pedido_offline").length;
  await h.elements.get("enviarWhatsApp").click();
  const depois = h.calls.filter(call => call.body.acao === "criar_pedido_offline").length;
  assert.equal(antes, 1);
  assert.equal(depois, 1);
  assert.equal(h.assigned.length, 1);
  const mensagem = decodeURIComponent(h.assigned[0].split("?text=")[1]);
  assert.doesNotMatch(mensagem, /654321/);
  assert.doesNotMatch(mensagem, new RegExp(TOKEN));
  assert.doesNotMatch(h.assigned[0], /window\.open/);
});

test("HTML remove definitivamente o botão de apagar e preserva o contrato mínimo do status", () => {
  const html = fs.readFileSync("pages/catalogo.html", "utf8");
  assert.doesNotMatch(html, /Remover deste dispositivo|limparPedidoOfflineSalvo/);
  assert.match(html, /data-whatsapp="pedido"/);
  assert.match(html, /catalogo\.js\?v=pix-20261007/);
  assert.match(source, /acao: "consultar_status", pedido_id: salvo\.pedido_id, comercio_id: comercioId/);
  assert.doesNotMatch(source, /window\.open\s*\(/);
});
