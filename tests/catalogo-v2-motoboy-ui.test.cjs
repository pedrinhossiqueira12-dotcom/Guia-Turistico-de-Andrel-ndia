const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const RIDER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function fixture({ responseBody } = {}) {
  const nodes = new Map();
  const events = {};
  const requests = [];
  const timers = [];
  let current = { access_token: "token-rider", user: { id: RIDER } };
  let nextResponse = responseBody || { success: true, pedidos: [], has_more: false };
  const get = (id) => {
    if (!nodes.has(id)) {
      nodes.set(id, {
        hidden: false, open: false, innerHTML: "", textContent: "", value: "", checked: false,
        disabled: false, dataset: {}, classList: { toggle() {} },
        setAttribute() {}, addEventListener() {}, reset() { this.value = ""; this.checked = false; },
        close() { this.open = false; }, showModal() { this.open = true; }, focus() {},
      });
    }
    return nodes.get(id);
  };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: current }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  };
  const ctx = {
    window: {
      location: { search: "" },
      supabaseLoginClient: client,
      setInterval: () => 1,
      clearInterval() {},
      setTimeout: (fn) => { timers.push(fn); },
      addEventListener: (name, fn) => { events[name] = fn; },
      confirm: () => true,
    },
    document: { getElementById: get, visibilityState: "visible", activeElement: null, addEventListener() {} },
    navigator: { onLine: true },
    URL, URLSearchParams, console,
    fetch: async (url, options) => {
      requests.push({ url, ...options, body: JSON.parse(options.body) });
      return { ok: true, status: 200, json: async () => nextResponse };
    },
  };
  let source = fs.readFileSync("js/motoboy.js", "utf8");
  source = source.replace(
    '  document.addEventListener("DOMContentLoaded", iniciar, { once: true });',
    "  window.__test = { state, chamarApi, aplicarSessao, iniciarEventos, limparSessaoVisual, limparPedidos, carregarEntregas, carregarExtrato, renderizarPedido, renderizarExtrato, executarAcao, definirDisponibilidade, salvarChavePix };"
  );
  vm.runInNewContext(source, ctx);
  return {
    api: ctx.window.__test, ctx, nodes, get, events, requests, timers,
    setSession(session) { current = session; },
    setResponse(body) { nextResponse = body; },
  };
}

test("catalogo-v2-motoboy: rejeita resposta de outra sessão sem enviar JWT antigo", async () => {
  const env = fixture();
  env.api.state.session = { user: { id: RIDER } };
  env.api.state.userId = RIDER;
  env.api.state.generation = 1;
  env.setSession({ access_token: "token-other", user: { id: OTHER } });
  await assert.rejects(env.api.chamarApi({ acao: "listar_entregas" }), /STALE_SESSION_REQUEST/);
  assert.equal(env.requests.length, 0);
});

test("catalogo-v2-motoboy: payloads usam somente ações e dados previstos, nunca operador ou remuneração", async () => {
  const env = fixture();
  env.api.state.session = { access_token: "token-rider", user: { id: RIDER } };
  env.api.state.userId = RIDER;
  env.api.state.generation = 1;
  await env.api.chamarApi({
    acao: "salvar_chave_pix", chave_pix: "rider@example.test", p_operador_id: OTHER,
    operador_id: OTHER, valor_bonus_centavos: 99999, motoboy_id: OTHER,
  });
  assert.deepEqual(env.requests[0].body, { acao: "salvar_chave_pix", chave_pix: "rider@example.test" });
  await env.api.chamarApi({ acao: "definir_disponibilidade", disponivel: true, p_operador_id: OTHER });
  assert.deepEqual(env.requests[1].body, { acao: "definir_disponibilidade", disponivel: true });
});

test("catalogo-v2-motoboy: oferta renderizada não vaza PII, itens ou observações antes do aceite", () => {
  const env = fixture();
  const html = env.api.renderizarPedido({
    pedido_id: "pedido-oferta", comercio_id: "loja-a", comercio_nome: "Comércio A",
    entrega_status: "ofertado", oferta: true, total_centavos: 1200,
    cliente_nome: "<script>alert(1)</script>", cliente_telefone: "5555555555",
    cliente_endereco: "Rua secreta", observacoes: "Não exibir", itens: [{ nome_produto: "Produto privado" }],
  });
  assert.doesNotMatch(html, /script|Rua secreta|5555555555|Produto privado|Não exibir/);
  assert.match(html, /Oferta sem dados pessoais/);
  assert.match(html, /Aceitar oferta/);
});

test("catalogo-v2-motoboy: aceita oferta concorrente pelo endpoint e não inventa status local", async () => {
  const env = fixture({ responseBody: { success: true, pedidos: [], has_more: false } });
  env.api.state.session = { access_token: "token-rider", user: { id: RIDER } };
  env.api.state.userId = RIDER;
  env.api.state.generation = 1;
  env.api.state.pedidos = [{ pedido_id: "pedido-1", comercio_id: "loja-a", entrega_status: "ofertado", oferta: true }];
  await env.api.executarAcao("pedido-1", "aceitar_entrega");
  assert.equal(env.requests[0].body.acao, "aceitar_entrega");
  assert.equal(env.requests[0].body.pedido_id, "pedido-1");
  assert.equal(Object.hasOwn(env.requests[0].body, "comercio_id"), false);
  assert.equal(Object.hasOwn(env.requests[0].body, "motoboy_id"), false);
});

test("catalogo-v2-motoboy: extrato usa saldos e confiabilidade informados pelo servidor", () => {
  const env = fixture();
  env.api.state.extrato = {
    saldo: { a_receber_centavos: 210, pago_centavos: 500, retido_centavos: 90 },
    confiabilidade: { indice: null, situacao: "em_formacao", amostra: 0 },
    entregas_concluidas: [{ pedido_id: "pedido-1", comercio_nome: "Loja A", remuneracao_centavos: 210, status: "entregue" }],
    pagamentos: [], perfil: { disponivel: true, chave_pix: "rider@example.test" },
  };
  env.api.renderizarExtrato();
  assert.equal(env.get("motoboyBalanceAReceber").textContent.replace(/\u00a0/g, " "), "R$ 2,10");
  assert.equal(env.get("motoboyBalancePago").textContent.replace(/\u00a0/g, " "), "R$ 5,00");
  assert.equal(env.get("motoboyBalanceRetido").textContent.replace(/\u00a0/g, " "), "R$ 0,90");
  assert.equal(env.get("motoboyReliabilityValue").textContent, "Em formação");
  assert.match(env.get("motoboyReliabilityText").textContent, /amostra suficiente/);
  assert.match(env.get("motoboyHistory").innerHTML, /Loja A/);
});

test("catalogo-v2-motoboy: desistência e ocorrência usam ações distintas", async () => {
  const env = fixture({ responseBody: { success: true, pedidos: [], has_more: false } });
  env.api.state.session = { access_token: "token-rider", user: { id: RIDER } };
  env.api.state.userId = RIDER;
  env.api.state.generation = 1;
  env.api.state.pedidos = [{ pedido_id: "pedido-2", comercio_id: "loja-a", entrega_status: "reservado" }];
  await env.api.executarAcao("pedido-2", "desistir_entrega");
  assert.equal(env.requests[0].body.acao, "desistir_entrega");
  assert.equal(env.requests[0].body.motivo, "desistencia_antes_coleta");
  assert.equal(Object.hasOwn(env.requests[0].body, "valor_bonus_centavos"), false);
});

test("catalogo-v2-motoboy: logout limpa pedidos e extrato; pagehide bloqueia respostas antigas", async () => {
  const env = fixture();
  env.api.state.session = { user: { id: RIDER } };
  env.api.state.userId = RIDER;
  env.api.state.pedidos = [{ pedido_id: "privado" }];
  env.api.state.extrato = { saldo: { a_receber_centavos: 1 } };
  env.api.limparSessaoVisual();
  assert.equal(env.api.state.pedidos.length, 0);
  assert.equal(env.api.state.extrato, null);
  env.api.iniciarEventos();
  env.events.pagehide();
  assert.equal(env.api.state.destroyed, true);
  await env.api.aplicarSessao({ access_token: "late", user: { id: OTHER } });
  assert.equal(env.api.state.session, null);
});

test("catalogo-v2-motoboy: schema visual mantém login/signup e ações v2 sem catálogo ou fatura", () => {
  const page = fs.readFileSync("pages/motoboy.html", "utf8");
  const script = fs.readFileSync("js/motoboy.js", "utf8");
  for (const action of ["listar_entregas", "aceitar_entrega", "coletar", "em_entrega", "desistir_entrega", "registrar_ocorrencia", "definir_disponibilidade", "salvar_chave_pix", "consultar_extrato", "confirmar_entrega"]) assert.match(script, new RegExp(action));
  for (const id of ["motoboyLoginForm", "motoboySignupForm", "motoboyAvailability", "motoboyOrders", "motoboyEarnings", "motoboyConfirmCode", "motoboyOccurrenceForm"]) assert.match(page, new RegExp(`id="${id}"`));
  assert.doesNotMatch(page, /catalogo-admin\.html|produtoForm|faturaPix/);
});
