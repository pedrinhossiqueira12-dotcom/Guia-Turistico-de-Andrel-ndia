const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const source = fs.readFileSync("js/catalogo.js", "utf8");
const utils = require("../js/catalogo-utils.js");
const COMMERCE = "comercio-pix-teste";
const PRODUCT = "11111111-1111-4111-8111-111111111111";
const ORDER = "22222222-2222-4222-8222-222222222222";
const TOKEN = "a".repeat(64);
const EXPIRATION = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

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
    this.src = "";
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
}

function receipt(overrides = {}) {
  return {
    pedido_id: ORDER,
    codigo_entrega: "",
    codigo_expira_em: EXPIRATION,
    status_token: TOKEN,
    provedor: "pix",
    status: "aguardando_pagamento",
    status_pagamento: "pendente",
    codigo_ativo: false,
    concluido: false,
    pix_codigo: "00020126580014BR.GOV.BCB.PIX0114+5532999999995204000053039865802BR5910LOJA TESTE6009ANDRELANDIA6304ABCD",
    pix_qr_code_base64: "ZmFrZS1xci1jb2Rl",
    ticket_url: "https://www.mercadopago.com.br/activities/pix-teste",
    ...overrides,
  };
}

function makeHarness({ saved = null, consult = [], createResponse = null } = {}) {
  const ids = [
    "statusTitulo", "statusTexto", "catalogoAviso", "catalogoConteudo", "abrirCarrinho", "cartFabCount", "cartFabTotal", "irCheckout",
    "categoriasNav", "produtosGrid", "cartItems", "cartEmpty", "limparCarrinho", "cartTotal", "cartPanel", "cartBackdrop", "fecharCarrinho",
    "checkoutForm", "checkoutDialog", "checkoutErro", "modalidadeOptions", "enderecoEntrega", "pagamentoSelect", "confirmarPedidoDialog",
    "resumoPedido", "confirmarPedidoInstrucao", "whatsappErro", "voltarCheckout", "pagarPix", "criarPedidoOffline", "enviarWhatsApp",
    "offlinePedidoBox", "offlinePedidoStatus", "offlinePedidoCodigo", "copiarCodigoOffline", "offlinePedidoExpiracao", "pixPedidoBox", "pixPedidoStatus",
    "pixPedidoCodigo", "pixPedidoCodigoLabel", "pixPedidoQr", "copiarPixPedido", "abrirTicketPix", "pixPedidoExpiracao", "offlinePedidoRecente",
    "abrirPedidoOfflineSalvo", "offlinePedidoStatusAviso", "fotoComercio", "nomeComercio", "descricaoComercio", "enderecoComercio",
    "whatsappComercio", "whatsappInvalido", "voltarPerfil", "cancelarPedidoOffline", "cancelarPedidoNoDialog", "cancelamentoConfirmacao",
    "cancelamentoMensagem", "confirmarCancelamentoOffline", "voltarCancelamentoOffline", "cancelamentoWhatsApp",
  ];
  const elements = new Map(ids.map(id => [id, new FakeElement(id)]));
  elements.get("checkoutForm").fields = {
    nome: {}, telefone: {}, email: {}, modalidade: {}, pagamento: {}, endereco: {}, numero: {}, bairro: {}, complemento: {}, referencia: {}, observacoes: {},
  };
  elements.get("checkoutForm").fieldValues = {
    nome: "Ana", telefone: "(32) 99999-1234", email: "ana@example.com", modalidade: "retirada", pagamento: "pix",
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
        if (name === "catalogo-pedido-pix") {
          return { data: createResponse || {
            success: true, pedido_id: ORDER, provedor: "mercadopago", codigo_entrega: "654321", status_token: TOKEN,
            status: "aguardando_pagamento", status_pagamento: "pendente", codigo_expira_em: EXPIRATION,
            pix_codigo: "000201PIX-CREATED", pix_qr_code_base64: "Q1JFQVRFRC1RUi0=", ticket_url: "https://www.mercadopago.com.br/checkout/v1/pix-created",
          }, error: null };
        }
        if (options.body.acao === "criar_pedido_offline") {
          return { data: { success: true, pedido_id: ORDER, codigo_entrega: "654321", codigo_expira_em: EXPIRATION, status_token: TOKEN }, error: null };
        }
        const next = consult[consultIndex++];
        if (next?.deferred) return new Promise(resolve => deferred.push(resolve));
        if (next instanceof Error) throw next;
        return next || { data: { success: true, pedido_id: options.body.pedido_id, provedor: "mercadopago", status: "aguardando_pagamento", status_pagamento: "pendente", codigo_ativo: false, concluido: false }, error: null };
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
  const window = {
    location: { search: `?id=${COMMERCE}`, assign() {} },
    supabaseLoginClient: supabase,
    CatalogoUtils: utils,
    URL,
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
    window, document, localStorage, navigator: { clipboard: { writeText: async () => {} } }, URL, URLSearchParams,
    FormData: class { constructor(form) { this.form = form; } get(name) { return this.form.fieldValues[name] || ""; } },
    fetch: async () => ({ ok: true, json: async () => [{ id: COMMERCE, status: "ativo", nome: "Loja", whatsapp: "(32) 99999-1234" }] }),
    crypto: { ...webcrypto, randomUUID: () => "request-id" },
    console: { error() {}, warn() {} },
  };
  vm.runInNewContext(source, context, { filename: "js/catalogo.js" });
  return {
    elements, storage, calls, deferred, timers, document,
    async load() {
      listeners.get("DOMContentLoaded")?.[0]();
      await new Promise(resolve => setImmediate(resolve));
    },
    async flush() { await new Promise(resolve => setImmediate(resolve)); },
    async finishDeferred(value) { deferred.shift()?.(value); await new Promise(resolve => setImmediate(resolve)); },
  };
}

test("reabertura Pix pendente recupera QR/copia/ticket, usa token e não faz POST de criação", async () => {
  const h = makeHarness({ saved: receipt(), consult: [{ deferred: true }] });
  await h.load();
  await h.elements.get("abrirPedidoOfflineSalvo").click();
  assert.equal(h.elements.get("pixPedidoBox").hidden, false);
  assert.equal(h.elements.get("pixPedidoQr").hidden, false);
  assert.match(h.elements.get("pixPedidoQr").src, /^data:image\/png;base64,/);
  assert.match(h.elements.get("pixPedidoCodigo").value, /^000201/);
  assert.equal(h.elements.get("copiarPixPedido").disabled, false);
  assert.equal(h.elements.get("abrirTicketPix").href, "https://www.mercadopago.com.br/activities/pix-teste");
  assert.equal(h.elements.get("offlinePedidoBox").hidden, true);
  assert.equal(h.elements.get("pagarPix").hidden, true);
  assert.equal(h.calls.filter(call => call.name === "catalogo-pedido-pix").length, 0);
  const statusCall = h.calls.find(call => call.body.acao === "consultar_status");
  assert.equal(statusCall.body.status_token, TOKEN);
  assert.equal(statusCall.body.pedido_id, ORDER);
});

test("polling aprovado para pix/mercadopago atualiza modal aberto e cache para código ativo", async () => {
  const h = makeHarness({ saved: receipt({ provedor: "mercadopago" }), consult: [{ deferred: true }] });
  await h.load();
  await h.elements.get("abrirPedidoOfflineSalvo").click();
  await h.finishDeferred({ data: {
    success: true, pedido_id: ORDER, provedor: "mercadopago", status: "pago", status_pagamento: "aprovado",
    codigo_ativo: true, codigo_entrega: "654321", concluido: false, codigo_expira_em: EXPIRATION,
  }, error: null });
  assert.equal(h.elements.get("pixPedidoBox").hidden, true);
  assert.equal(h.elements.get("offlinePedidoBox").hidden, false);
  assert.equal(h.elements.get("offlinePedidoCodigo").textContent, "654321");
  assert.equal(h.elements.get("copiarCodigoOffline").hidden, false);
  assert.equal(h.elements.get("copiarCodigoOffline").disabled, false);
  assert.equal(h.elements.get("pagarPix").hidden, true);
  const saved = JSON.parse(h.storage.get(`guia-offline-order:${COMMERCE}`));
  assert.equal(saved.provedor, "mercadopago");
  assert.equal(saved.status_pagamento, "aprovado");
  assert.equal(saved.codigo_ativo, true);
  assert.equal(saved.codigo_entrega, "654321");
});

test("cancelado e expirado não exibem pagar, Pix utilizável nem código vazio copiável", async () => {
  const canceled = makeHarness({ saved: receipt({ status: "cancelado", status_pagamento: "cancelado", pix_codigo: "", pix_qr_code_base64: "" }) });
  await canceled.load();
  await canceled.elements.get("abrirPedidoOfflineSalvo").click();
  assert.equal(canceled.elements.get("pagarPix").hidden, true);
  assert.equal(canceled.elements.get("pixPedidoBox").hidden, true);
  assert.equal(canceled.elements.get("offlinePedidoCodigo").textContent, "");
  assert.equal(canceled.elements.get("copiarCodigoOffline").hidden, true);

  const expired = makeHarness({ saved: receipt({ codigo_expira_em: new Date(Date.now() - 1000).toISOString(), pix_codigo: "000201EXPIRED" }) });
  await expired.load();
  await expired.elements.get("abrirPedidoOfflineSalvo").click();
  assert.equal(expired.elements.get("pagarPix").hidden, true);
  assert.equal(expired.elements.get("pixPedidoBox").hidden, true);
  assert.equal(expired.elements.get("offlinePedidoCodigo").textContent, "");
  assert.equal(expired.elements.get("copiarCodigoOffline").hidden, true);
  assert.match(expired.elements.get("offlinePedidoExpiracao").textContent, /expirado/i);

  const contested = makeHarness({ saved: receipt({ status: "pago", status_pagamento: "contestado" }) });
  await contested.load();
  await contested.elements.get("abrirPedidoOfflineSalvo").click();
  assert.equal(contested.elements.get("pagarPix").hidden, true);
  assert.equal(contested.elements.get("pixPedidoBox").hidden, true);
  assert.equal(contested.elements.get("offlinePedidoCodigo").textContent, "");
  assert.equal(contested.elements.get("copiarCodigoOffline").hidden, true);
});

test("criação Pix persiste artefatos, TTL real/token e ignora código de entrega da criação", async () => {
  const h = makeHarness();
  await h.load();
  await h.elements.get("checkoutForm").dispatch("submit");
  await h.elements.get("pagarPix").click();
  await h.flush();
  const createCalls = h.calls.filter(call => call.name === "catalogo-pedido-pix");
  assert.equal(createCalls.length, 1);
  assert.equal(h.elements.get("pagarPix").hidden, true);
  assert.equal(h.elements.get("pixPedidoBox").hidden, false);
  assert.equal(h.elements.get("pixPedidoCodigo").value, "000201PIX-CREATED");
  assert.equal(h.elements.get("pixPedidoQr").hidden, false);
  assert.equal(h.elements.get("abrirTicketPix").hidden, false);
  const saved = JSON.parse(h.storage.get(`guia-offline-order:${COMMERCE}`));
  assert.equal(saved.codigo_entrega, "");
  assert.equal(saved.pix_codigo, "000201PIX-CREATED");
  assert.equal(saved.pix_qr_code_base64, "Q1JFQVRFRC1RUi0=");
  assert.equal(saved.ticket_url, "https://www.mercadopago.com.br/checkout/v1/pix-created");
  assert.equal(saved.status_token, TOKEN);
  assert.equal(saved.codigo_expira_em, EXPIRATION);
  const statusCall = h.calls.find(call => call.body.acao === "consultar_status");
  assert.equal(statusCall.body.status_token, TOKEN);
});
