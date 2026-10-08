const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const endpointSource = read("supabase/functions/catalogo-pedido-offline/index.ts");
const sharedSource = read("supabase/functions/_shared/catalogo-pagamentos-v2.ts");
const key = "11".repeat(32);
const COMMERCE = "loja-status";
const ORDER = "cff032f2-106c-4875-8e56-db732554245a";
const PAYMENT = "181803193235";
const TOKEN = "a".repeat(64);
const REF = `guia-${ORDER}`;
const future = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function loadShared() {
  const exported = [...sharedSource.matchAll(/export (?:async )?function (\w+)/g)].map(match => match[1]);
  const context = vm.createContext({
    crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, Uint32Array, atob, btoa, console: { error() {} },
  });
  vm.runInContext(stripTypeScriptTypes(sharedSource.replace(/export /g, ""), { mode: "strip" }) + `\nglobalThis.helper = {${exported.join(",")}};`, context);
  return context.helper;
}
const h = loadShared();

class Query {
  constructor(db, table) { this.db = db; this.table = table; this.filters = []; this.columns = null; }
  select(columns) { this.columns = columns; return this; }
  eq(column, value) { this.filters.push(row => row[column] === value); return this; }
  in(column, values) { this.filters.push(row => values.includes(row[column])); return this; }
  maybeSingle() { this.single = true; this.maybe = true; return this; }
  then(resolve, reject) { return Promise.resolve().then(() => this.run()).then(resolve, reject); }
  async run() {
    let rows = this.db.tables[this.table].filter(row => this.filters.every(filter => filter(row)));
    if (this.single && rows.length > 1) return { data: null, error: { message: "multiple rows" } };
    const selected = this.columns ? rows.map(row => Object.fromEntries(this.columns.split(",").map(key => [key, row[key]]))) : rows;
    const data = this.single ? (clone(selected[0]) || null) : clone(selected);
    return { data, error: null };
  }
}

function providerRecord(overrides = {}) {
  return {
    id: PAYMENT,
    status: "pending",
    status_detail: "waiting_transfer",
    external_reference: REF,
    collector_id: "987654321",
    currency_id: "BRL",
    transaction_amount: 7,
    application_fee: 0.35,
    point_of_interaction: {
      transaction_data: {
        qr_code: "000201PIX-COPIA-E-COLA",
        qr_code_base64: "cXItYmFzZTY0",
        ticket_url: "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pix-status",
      },
    },
    ...overrides,
  };
}

async function fixture(options = {}) {
  const statusTokenCipher = await h.encryptAesGcm("status-token-not-returned", key);
  const codeCipher = await h.encryptAesGcm("654321", key, `delivery-code-v2:${ORDER}`);
  const db = {
    tables: { catalogo_pedidos: [], catalogo_recebedores: [], catalogos: [] },
    rpcCalls: [],
    ...options.db,
  };
  db.tables.catalogo_recebedores.push({
    comercio_id: COMMERCE, status: "ativo", conta_externa_id: "987654321", oauth_access_token_enc: await h.encryptAesGcm("seller-token-status", key),
  });
  db.tables.catalogos.push({ comercio_id: COMMERCE, proprietario_id: "owner-status" });
  db.tables.catalogo_pedidos.push({
    id: ORDER, comercio_id: COMMERCE, referencia_externa: REF, payment_id: PAYMENT, order_id: null,
    provedor: "mercadopago", status: "aguardando_pagamento", status_pagamento: "pendente", forma_pagamento: "pix",
    versao_financeira: 2, entrega_status: "nao_atribuido", aceito_em: null, reembolso_pendente: false,
    concluido_em: null, codigo_entrega_usado_em: null, codigo_entrega_expira_em: future(), codigo_entrega_tentativas: 0,
    status_token_hash: await h.sha256Hex(TOKEN), codigo_entrega_enc: codeCipher, cliente_email: "buyer@example.com",
    pix_codigo: null, pix_qr_code_base64: null, pix_expira_em: future(), cancelado_em: null, pagamento_revisao_pendente: false,
    metadata: { api_model: options.apiModel || "payments_v1", checkout: "payments_api", status_token_enc: statusTokenCipher },
    total_centavos: 700, taxa_total_centavos: 35, taxa_plataforma_centavos: 35, taxa_motoboy_centavos: 0,
    ...options.order,
  });
  const provider = providerRecord(options.provider);
  const calls = { gets: [], posts: [] };
  const rpc = async (name, args) => {
    db.rpcCalls.push({ name, args: clone(args) });
    if (name === "catalogo_offline_consumir_limite") return { data: true, error: null };
    assert.equal(name, "catalogo_aplicar_pagamento_v2");
    const order = db.tables.catalogo_pedidos[0];
    if (args.p_status === "revisao_parcial") {
      order.status_pagamento = "contestado";
      order.pagamento_revisao_pendente = true;
      return { data: { ok: true, status_pagamento: "contestado", financiamento_comprovado: false }, error: null };
    }
    if (args.p_status === "aprovado") {
      order.status_pagamento = "aprovado";
      order.status = order.status === "aguardando_pagamento" ? "pago" : order.status;
      order.pagamento_revisao_pendente = args.p_taxa_centavos === null;
      return { data: { ok: true, status_pagamento: "aprovado", financiamento_comprovado: args.p_taxa_centavos === order.taxa_total_centavos }, error: null };
    }
    order.status_pagamento = args.p_status === "charged_back" ? "contestado" : args.p_status;
    return { data: { ok: true, status_pagamento: order.status_pagamento, financiamento_comprovado: false }, error: null };
  };
  db.from = table => new Query(db, table);
  db.rpc = rpc;
  db.auth = { getUser: async () => ({ data: { user: null }, error: new Error("not used") }) };
  const fetchFake = async (url, init = {}) => {
    const target = String(url);
    if (target.startsWith("https://api.mercadopago.com/v1/payments/")) {
      calls.gets.push(target.split("/").pop());
      assert.equal(init.method, "GET");
      assert.equal(init.headers.Authorization, "Bearer seller-token-status");
      if (options.getFailure) return new Response(JSON.stringify({ error: "provider unavailable" }), { status: 502 });
      return new Response(JSON.stringify(clone(provider)), { status: 200 });
    }
    calls.posts.push({ url: target, init });
    throw new Error(`unexpected provider method ${init.method || "GET"}`);
  };
  let handler;
  const env = { SUPABASE_SERVICE_ROLE_KEY: "service", MP_OAUTH_ENCRYPTION_KEY: key };
  const context = vm.createContext({
    crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, Uint32Array, atob, btoa, URL, Request, Response, AbortSignal,
    console: { error() {} }, fetch: fetchFake, db, h,
    Deno: { env: { get: name => env[name] || "" }, serve: fn => { handler = fn; } },
  });
  const injected = "const createClient = () => db; const { decryptAesGcm, extractPixArtifacts, extractProviderPayment, providerFactsError, sanitizedProviderId } = h;\n";
  const source = injected + "const randomDeliveryCode = h.randomDeliveryCode;\n" +
    endpointSource.replace(/^import .*?;\s*$/gm, "");
  vm.runInContext(stripTypeScriptTypes(source, { mode: "strip" }), context, { filename: "catalogo-pedido-offline.ts" });
  const call = async (body = {}) => {
    const response = await handler(new Request("https://local.invalid/status", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ acao: "consultar_status", comercio_id: COMMERCE, pedido_id: ORDER, status_token: TOKEN, ...body }),
    }));
    return { status: response.status, body: await response.json() };
  };
  return { db, provider, calls, call };
}

function appliedCalls(fixtureValue) {
  return fixtureValue.db.rpcCalls.filter(call => call.name === "catalogo_aplicar_pagamento_v2");
}

test("consultar_status consulta GET autenticado e retorna QR/copia-e-cola pendente sem código", async () => {
  const f = await fixture();
  const result = await f.call({ status: "approved", fee: 999999 });
  assert.equal(result.status, 200);
  assert.deepEqual(f.calls.gets, [PAYMENT]);
  assert.equal(result.body.status_pagamento, "pendente");
  assert.equal(result.body.pix_codigo, "000201PIX-COPIA-E-COLA");
  assert.equal(result.body.pix_qr_code_base64, "cXItYmFzZTY0");
  assert.match(result.body.ticket_url, /^https:\/\//);
  assert.equal(result.body.pix_expira_em !== null, true);
  assert.equal(result.body.codigo_entrega, undefined);
  assert.equal(result.body.codigo_ativo, false);
  assert.equal(appliedCalls(f).length, 0);
});

test("consultar_status aprovado reconcilia somente o GET e devolve o código correto", async () => {
  const f = await fixture({ provider: { status: "approved", status_detail: "accredited" } });
  const result = await f.call();
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.status, "pago");
  assert.equal(result.body.status_pagamento, "aprovado");
  assert.equal(result.body.codigo_entrega, "654321");
  assert.equal(result.body.codigo_ativo, true);
  assert.equal(result.body.financiamento_comprovado, true);
  assert.equal(appliedCalls(f).length, 1);
  assert.equal(appliedCalls(f)[0].args.p_taxa_centavos, 35);
  assert.equal(f.calls.posts.length, 0);
});

test("divergência de id/ref/collector/moeda/valor bloqueia antes do RPC financeiro", async () => {
  const mutations = [
    provider => { provider.id = "outro-pagamento"; },
    provider => { provider.external_reference = "guia-outro"; },
    provider => { provider.collector_id = "outro-recebedor"; },
    provider => { provider.currency_id = "USD"; },
    provider => { provider.transaction_amount = 8; },
  ];
  for (const mutate of mutations) {
    const f = await fixture();
    mutate(f.provider);
    const result = await f.call();
    assert.equal(result.status, 409, JSON.stringify(result.body));
    assert.equal(appliedCalls(f).length, 0);
    assert.equal(f.calls.gets.length, 1);
  }
});

test("token forjado não consulta Mercado Pago nem usa estado/fee enviado pelo browser", async () => {
  const f = await fixture();
  const result = await f.call({ status_token: "f".repeat(64), status_pagamento: "aprovado", fee_centavos: 0 });
  assert.equal(result.status, 403);
  assert.equal(f.calls.gets.length, 0);
  assert.equal(appliedCalls(f).length, 0);
  assert.equal(f.db.tables.catalogo_pedidos[0].status_pagamento, "pendente");
});

test("pedido cancelado manualmente não faz GET, não reabre e nunca cria POST", async () => {
  const f = await fixture({ order: { status: "cancelado", cancelado_em: new Date().toISOString() }, provider: { status: "approved" } });
  const result = await f.call();
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "cancelado");
  assert.equal(result.body.codigo_ativo, false);
  assert.equal(result.body.codigo_entrega, undefined);
  assert.equal(f.calls.gets.length, 0);
  assert.equal(f.calls.posts.length, 0);
  assert.equal(appliedCalls(f).length, 0);
});

test("falha no GET do provedor retorna 503 e não aprova localmente", async () => {
  const f = await fixture({ getFailure: true });
  const result = await f.call();
  assert.equal(result.status, 503);
  assert.equal(result.body.success, false);
  assert.equal(appliedCalls(f).length, 0);
  assert.equal(f.db.tables.catalogo_pedidos[0].status_pagamento, "pendente");
});

test("fee divergente alimenta revisão com taxa nula e não libera código/financiamento", async () => {
  const f = await fixture({ provider: { status: "approved", status_detail: "accredited", application_fee: 0.01 } });
  const result = await f.call();
  assert.equal(result.status, 409);
  assert.equal(appliedCalls(f).length, 1);
  assert.equal(appliedCalls(f)[0].args.p_status, "revisao_parcial");
  assert.equal(appliedCalls(f)[0].args.p_taxa_centavos, null);
  assert.equal(f.db.tables.catalogo_pedidos[0].status_pagamento, "contestado");
  assert.equal(f.db.tables.catalogo_pedidos[0].pagamento_revisao_pendente, true);
  assert.equal(f.db.tables.catalogo_pedidos[0].status, "aguardando_pagamento");
  assert.equal(result.body.codigo_entrega, undefined);
});

test("fee ausente preserva a aprovação física e o código sem declarar lastro do motoboy", async () => {
  const f = await fixture({ provider: { status: "approved", status_detail: "accredited", application_fee: undefined } });
  delete f.provider.application_fee;
  const result = await f.call();
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.status_pagamento, "aprovado");
  assert.equal(result.body.revisao_financeira, true);
  assert.equal(result.body.taxa_conferida, false);
  assert.equal(result.body.financiamento_comprovado, false);
  assert.equal(result.body.codigo_ativo, true);
  assert.equal(result.body.codigo_entrega, "654321");
  assert.equal(appliedCalls(f).at(-1).args.p_taxa_centavos, null);
});

test("Orders/legacy não usa GET payments errado e offline permanece DB-only", async () => {
  const legacy = await fixture({ apiModel: "orders_v2" });
  const legacyResult = await legacy.call();
  assert.equal(legacyResult.status, 200);
  assert.equal(legacy.calls.gets.length, 0);
  assert.equal(legacyResult.body.pix_codigo, undefined);
  assert.equal(appliedCalls(legacy).length, 0);

  const offline = await fixture({ order: { provedor: "offline", payment_id: null, forma_pagamento: "dinheiro", metadata: { checkout: "offline" }, status_pagamento: "pendente" } });
  const offlineResult = await offline.call();
  assert.equal(offlineResult.status, 200);
  assert.equal(offline.calls.gets.length, 0);
  assert.equal(offlineResult.body.status_pagamento, "pendente");
  assert.equal(offlineResult.body.codigo_entrega, "654321");
  assert.equal(offlineResult.body.pix_codigo, undefined);
  assert.equal(appliedCalls(offline).length, 0);
});

test("Pix Orders legado aprovado preserva código atestado pelo webhook sem GET payments", async () => {
  const f = await fixture({ apiModel: "orders_v2", order: { status: "pago", status_pagamento: "aprovado" } });
  const result = await f.call();
  assert.equal(result.status, 200);
  assert.equal(result.body.codigo_entrega, "654321");
  assert.equal(result.body.codigo_ativo, true);
  assert.equal(f.calls.gets.length, 0);
});
