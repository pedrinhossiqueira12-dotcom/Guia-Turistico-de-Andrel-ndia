const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto, createHmac } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const ADMIN = '4b9a0233-6b72-4573-aebd-d596c5b15e1b';
const MARKET_SECRET = 'marketplace-secret-local';
const REQUEST_ID = 'request-final-local';
const FaturaOrder = 'ORDER_FATURA_181813979953';

function helpers(sourceFile, injected = {}) {
  const source = read(sourceFile);
  const names = [...source.matchAll(/export (?:async )?function (\w+)/g)].map((match) => match[1]);
  const context = vm.createContext({ crypto: webcrypto, TextEncoder, TextDecoder, URL, console: { error() {} }, ...injected });
  const code = stripTypeScriptTypes(source.replace(/^import .*?;\s*$/gm, '').replace(/^export\s+/gm, ''), { mode: 'strip' });
  vm.runInContext(`${code}\nglobalThis.__helpers={${names.join(',')}};`, context);
  return context.__helpers;
}

function baseContext(extra = {}) {
  return {
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    URL,
    Request,
    Response,
    AbortSignal,
    console: { error() {} },
    ...extra,
  };
}

class Query {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.filters = [];
    this.columns = null;
    this.singleMode = false;
    this.maybe = false;
  }
  select(columns) {
    this.columns = columns;
    this.db.selects.push({ table: this.table, columns });
    return this;
  }
  eq(column, value) {
    this.filters.push((row) => row?.[column] === value);
    return this;
  }
  maybeSingle() {
    this.singleMode = true;
    this.maybe = true;
    return this;
  }
  single() {
    this.singleMode = true;
    return this;
  }
  then(resolve, reject) {
    return Promise.resolve().then(() => this.run()).then(resolve, reject);
  }
  async run() {
    const rows = (this.db.tables[this.table] || []).filter((row) => this.filters.every((filter) => filter(row)));
    if (this.singleMode && rows.length > 1) return { data: null, error: { message: 'multiple rows' } };
    if (this.singleMode && rows.length === 0 && !this.maybe) return { data: null, error: { message: 'missing row' } };
    const project = (row) => {
      if (!row || !this.columns) return row ? structuredClone(row) : row;
      return Object.fromEntries(this.columns.split(',').map((column) => [column, row[column]]));
    };
    return { data: this.singleMode ? project(rows[0] || null) : rows.map(project), error: null };
  }
}

function dbForMarketplace({ fatura = [], pedidos = [] } = {}) {
  const db = {
    tables: {
      catalogo_pedidos: pedidos,
      catalogo_fatura_cobrancas: fatura,
    },
    selects: [],
    from(table) {
      return new Query(this, table);
    },
    rpc() {
      throw new Error('RPC não deveria ser chamado neste teste');
    },
  };
  return db;
}

function loadMarketplace({ db, downstreamStatus = 200, onForward } = {}) {
  let handler;
  const fetchCalls = [];
  const helpersObject = helpers('supabase/functions/_shared/catalogo-pagamentos-v2.ts');
  const eventHelpers = helpers('supabase/functions/_shared/catalogo-webhook-events.ts', helpersObject);
  const env = {
    SUPABASE_URL: 'https://supabase.example.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'service-local-only',
    MP_MARKETPLACE_WEBHOOK_SECRET: MARKET_SECRET,
    MP_OAUTH_ENCRYPTION_KEY: '11'.repeat(32),
  };
  const fetchMock = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    onForward?.(String(url), options);
    if (!String(url).startsWith('https://supabase.example.invalid/functions/v1/catalogo-fatura-pix/webhook')) {
      throw new Error(`destino inesperado: ${url}`);
    }
    return new Response(JSON.stringify({ downstream: true, status: downstreamStatus }), { status: downstreamStatus, headers: { 'content-type': 'application/json' } });
  };
  const context = vm.createContext(baseContext({
    ...helpersObject,
    ...eventHelpers,
    createClient: () => db,
    fetch: fetchMock,
    Deno: { env: { get: (name) => env[name] || '' }, serve: (fn) => { handler = fn; } },
  }));
  const source = read('supabase/functions/mercadopago-marketplace-webhook/index.ts')
    .replace(/^import[\s\S]*?;\s*$/gm, '');
  vm.runInContext(stripTypeScriptTypes(source, { mode: 'strip' }), context);
  assert.equal(typeof handler, 'function');
  return { handler, db, fetchCalls, helpers: helpersObject };
}

function signature(helpersObject, id, timestamp = String(Math.floor(Date.now() / 1000)), secret = MARKET_SECRET) {
  return `ts=${timestamp},v1=${createHmac('sha256', secret).update(helpersObject.buildWebhookManifest(id, REQUEST_ID, timestamp)).digest('hex')}`;
}

async function marketRequest(endpoint, { type = 'orders_v2', id = FaturaOrder, sig = signature(endpoint.helpers, id), body = { type, data: { id }, source: 'official-simulation', url: 'https://attacker.invalid' } } = {}) {
  return endpoint.handler(new Request(`https://supabase.example.invalid/functions/v1/mercadopago-marketplace-webhook?type=${encodeURIComponent(type)}&data.id=${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': REQUEST_ID, 'x-signature': sig },
    body: JSON.stringify(body),
  }));
}

function dbForFatura() {
  const db = {
    tables: {
      catalogo_automacao_config: [{ id: true, fatura_pix_ativo: false, fechamento_offline_ativo: true }],
      catalogo_fatura_cobrancas: [],
    },
    selects: [],
    authCalls: [],
    rpcCalls: [],
    from(table) { return new Query(this, table); },
    rpc(name) { this.rpcCalls.push(name); throw new Error(`RPC inesperada: ${name}`); },
  };
  db.auth = {
    getUser: async (token) => {
      db.authCalls.push(token);
      if (token === 'admin-token') return { data: { user: { id: ADMIN } }, error: null };
      if (token === 'user-token') return { data: { user: { id: 'user-not-admin' } }, error: null };
      return { data: { user: null }, error: { message: 'invalid' } };
    },
  };
  return db;
}

function loadFatura({ envOverrides = {}, profileId = 'seller-platform', db = dbForFatura() } = {}) {
  let handler;
  const fetchCalls = [];
  const env = {
    SUPABASE_URL: 'https://supabase.example.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'service-token',
    FATURA_PIX_ENABLED: 'false',
    MP_PLATFORM_ACCESS_TOKEN: 'platform-token',
    MP_PLATFORM_SELLER_ID: 'seller-platform',
    MP_PLATFORM_WEBHOOK_SECRET: 'platform-webhook-secret',
    ADMIN_USER_ID: ADMIN,
    ...envOverrides,
  };
  const utilityObject = helpers('supabase/functions/catalogo-fatura-pix/fatura-utils.mjs');
  const fetchMock = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    if (String(url) !== 'https://api.mercadolibre.com/users/me') throw new Error(`endpoint MP inesperado: ${url}`);
    return new Response(JSON.stringify({ id: profileId, email: 'nao-retornar@example.invalid', nickname: 'nao-retornar' }), { status: 200 });
  };
  const context = vm.createContext(baseContext({
    ...utilityObject,
    createClient: () => db,
    fetch: fetchMock,
    Deno: { env: { get: (name) => env[name] || '' }, serve: (fn) => { handler = fn; } },
  }));
  const source = read('supabase/functions/catalogo-fatura-pix/index.ts')
    .replace(/^import[\s\S]*?;\s*$/gm, '');
  vm.runInContext(stripTypeScriptTypes(source, { mode: 'strip' }), context);
  assert.equal(typeof handler, 'function');
  return { handler, db, fetchCalls };
}

function validationRequest(token) {
  return new Request('https://supabase.example.invalid/functions/v1/catalogo-fatura-pix', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ acao: 'validar_configuracao', papel: 'admin', serviceKey: 'nao-confiar' }),
  });
}

test('assinatura inválida encerra antes de tabelas e proxy; pagamento desconhecido não vira fatura', async () => {
  const endpoint = loadMarketplace({ db: dbForMarketplace({ fatura: [{ id: 'charge-1', order_id: FaturaOrder }] }) });
  const invalid = await marketRequest(endpoint, { sig: 'ts=1234567890,v1=' + '0'.repeat(64) });
  assert.equal(invalid.status, 401);
  assert.equal(endpoint.db.selects.length, 0);
  assert.equal(endpoint.fetchCalls.length, 0);

  const payment = await marketRequest(endpoint, { type: 'payment', id: 'PAYMENT_UNKNOWN' });
  assert.equal(payment.status, 503);
  assert.equal(endpoint.fetchCalls.length, 0);
  assert.equal(endpoint.db.selects.some((query) => query.table === 'catalogo_fatura_cobrancas'), false);
});

test('Order normal não é encaminhada; vínculo de fatura usa somente id/order_id e o downstream preserva 409/503', async () => {
  const normal = loadMarketplace({
    db: dbForMarketplace({ pedidos: [{ id: 'pedido-normal', order_id: 'ORDER_NORMAL', comercio_id: 'loja', provedor: 'mercadopago' }] }),
  });
  const normalResponse = await marketRequest(normal, { id: 'ORDER_NORMAL', type: 'order' });
  assert.equal(normalResponse.status, 503);
  assert.equal(normal.fetchCalls.length, 0);

  const forwarded = loadMarketplace({
    downstreamStatus: 409,
    db: dbForMarketplace({ fatura: [{ id: 'charge-real', order_id: FaturaOrder, comercio_id: 'nao-deve-ser-lido', valor_centavos: 999 }] }),
  });
  const response = await marketRequest(forwarded);
  assert.equal(response.status, 409);
  assert.equal(forwarded.fetchCalls.length, 1);
  const call = forwarded.fetchCalls[0];
  const destination = new URL(call.url);
  assert.equal(destination.origin, 'https://supabase.example.invalid');
  assert.equal(destination.pathname, '/functions/v1/catalogo-fatura-pix/webhook');
  assert.equal(destination.searchParams.get('type'), 'orders_v2');
  assert.equal(destination.searchParams.get('data.id'), FaturaOrder);
  // A assinatura do webhook usa o timestamp da requisição. Recalculá-la com
  // Date.now() aqui gera falha intermitente quando muda o segundo no CI.
  const forwardedSignature = call.options.headers['x-signature'];
  const timestampMatch = /^ts=(\d{10,}),v1=[a-f0-9]{64}$/.exec(forwardedSignature);
  assert.ok(timestampMatch, 'O proxy deve encaminhar uma assinatura HMAC válida');
  const forwardedTimestamp = timestampMatch[1];
  assert.ok(Math.abs(Math.floor(Date.now() / 1000) - Number(forwardedTimestamp)) <= 5,
    'O timestamp encaminhado deve ser recente');
  assert.equal(forwardedSignature, signature(forwarded.helpers, FaturaOrder, forwardedTimestamp));
  assert.equal(call.options.headers['x-request-id'], REQUEST_ID);
  assert.equal(call.options.headers.authorization, undefined);
  assert.deepEqual(JSON.parse(call.options.body), { type: 'orders_v2', data: { id: FaturaOrder }, source: 'official-simulation', url: 'https://attacker.invalid' });
  const selection = forwarded.db.selects.find((query) => query.table === 'catalogo_fatura_cobrancas');
  assert.equal(selection.columns, 'id,order_id');
});

test('proxy usa URL fixa derivada de SUPABASE_URL e preserva erro 503 do downstream', async () => {
  for (const downstreamStatus of [401, 503]) {
    const endpoint = loadMarketplace({ downstreamStatus, db: dbForMarketplace({ fatura: [{ id: 'charge-real', order_id: FaturaOrder }] }) });
    const response = await marketRequest(endpoint, { body: { type: 'orders', data: { id: FaturaOrder }, destination: 'https://attacker.invalid/functions/v1/evil' } });
    assert.equal(response.status, downstreamStatus);
    assert.equal(new URL(endpoint.fetchCalls[0].url).hostname, 'supabase.example.invalid');
    assert.equal(new URL(endpoint.fetchCalls[0].url).searchParams.get('type'), 'orders_v2');
  }
});

test('validar_configuracao exige admin verificado ou token interno e faz somente GET /users/me', async () => {
  const endpoint = loadFatura();
  const denied = await endpoint.handler(validationRequest('user-token'));
  assert.equal(denied.status, 403);
  assert.equal(endpoint.fetchCalls.length, 0);

  const adminResponse = await endpoint.handler(validationRequest('admin-token'));
  assert.equal(adminResponse.status, 200);
  const adminBody = await adminResponse.json();
  assert.equal(adminBody.success, true);
  assert.equal(adminBody.fatura_pix_enabled, false);
  assert.equal(adminBody.fatura_pix_ativo, false);
  assert.equal(adminBody.fechamento_offline_ativo, true);
  assert.equal(adminBody.vendedor_validado, true);
  assert.equal(adminBody.pronto, false);
  assert.deepEqual(adminBody.credenciais_presentes, { access_token: true, seller_id: true, webhook_secret: true });
  assert.equal(endpoint.fetchCalls.length, 1);
  assert.equal(endpoint.fetchCalls[0].url, 'https://api.mercadolibre.com/users/me');
  assert.equal(endpoint.fetchCalls[0].options.method, 'GET');
  assert.equal(endpoint.fetchCalls[0].options.headers.Authorization, 'Bearer platform-token');
  assert.equal(endpoint.db.rpcCalls.length, 0);
  assert.doesNotMatch(JSON.stringify(adminBody), /platform-token|platform-webhook-secret|seller-platform|nao-retornar@example/);

  const serviceResponse = await endpoint.handler(validationRequest('service-token'));
  assert.equal(serviceResponse.status, 200);
  assert.equal(endpoint.db.authCalls.includes('service-token'), false);
  assert.equal(endpoint.fetchCalls.length, 2);
});

test('validar_configuracao não exige flag de emissão, mas falha genericamente sem credencial ou com seller divergente', async () => {
  const missing = loadFatura({ envOverrides: { MP_PLATFORM_ACCESS_TOKEN: '' } });
  const missingResponse = await missing.handler(validationRequest('service-token'));
  assert.equal(missingResponse.status, 503);
  assert.equal(missing.fetchCalls.length, 0);
  assert.equal((await missingResponse.clone().json()).credenciais_presentes.access_token, false);

  const mismatch = loadFatura({ profileId: 'seller-other' });
  const mismatchResponse = await mismatch.handler(validationRequest('service-token'));
  assert.equal(mismatchResponse.status, 502);
  assert.equal(mismatch.fetchCalls.length, 1);
  assert.equal(mismatch.fetchCalls[0].options.method, 'GET');
});

test('validação aceita apikey interna moderna exata do painel e não a usa para emitir cobranças', async () => {
  const key = 'sb_secret_local_test_only';
  const endpoint = loadFatura({ envOverrides: { SUPABASE_SECRET_KEYS: JSON.stringify({ default: key }) } });
  const request = (acao, apikey) => new Request('https://supabase.example.invalid/functions/v1/catalogo-fatura-pix', {
    method: 'POST', headers: { 'content-type': 'application/json', apikey },
    body: JSON.stringify({ acao, papel: 'admin' }),
  });
  const result = await endpoint.handler(request('validar_configuracao', key));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).vendedor_validado, true);
  assert.equal(endpoint.db.authCalls.length, 0);
  assert.equal(endpoint.db.rpcCalls.length, 0);
  assert.equal(endpoint.fetchCalls.length, 1);
  assert.equal(endpoint.fetchCalls[0].options.method, 'GET');
  const create = await endpoint.handler(request('criar_cobranca', key));
  assert.equal(create.status, 401);
  assert.equal(endpoint.fetchCalls.length, 1);
  assert.equal(endpoint.db.rpcCalls.length, 0);
});

test('apikey pública, adulterada ou informada no corpo não autoriza validação de credenciais', async () => {
  for (const key of ['anon-token', 'sb_publishable_local_test', 'service-token-alterado', '']) {
    const endpoint = loadFatura();
    const result = await endpoint.handler(new Request('https://supabase.example.invalid/functions/v1/catalogo-fatura-pix', {
      method: 'POST', headers: { 'content-type': 'application/json', apikey: key },
      body: JSON.stringify({ acao: 'validar_configuracao', papel: 'admin', apikey: 'service-token', serviceKey: 'service-token' }),
    }));
    assert.equal(result.status, 401);
    assert.equal(endpoint.fetchCalls.length, 0);
    assert.equal(endpoint.db.selects.length, 0);
    assert.equal(endpoint.db.rpcCalls.length, 0);
  }
});
