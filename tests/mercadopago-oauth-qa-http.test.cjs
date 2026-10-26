const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");
const { webcrypto, createHash } = require("node:crypto");

const STAGING = "https://jbttwihctuibchhcyqtl.supabase.co";
const PRODUCTION = "https://xdmbkflufsfqziixzpxc.supabase.co";
const CALLBACK = STAGING + "/functions/v1/mercadopago-oauth-callback";
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const stateHash = (state) => createHash("sha256").update(state).digest("base64url");

function fakeDatabase() {
  const rows = {
    comercios_publicados: [{ local_id: "asaas-homologacao", status: "ativo" }],
    catalogos: [{ comercio_id: "asaas-homologacao", proprietario_id: "owner-1", bloqueado: false }],
    catalogo_recebedores: [],
    catalogo_oauth_estados: [],
  };
  const calls = { insert: 0, upsert: 0 };
  function from(table) {
    assert.ok(rows[table], "known table: " + table);
    let filters = [], operation = "read", patch;
    const builder = {
      select() { return this; },
      eq(field, value) { filters.push((row) => row[field] === value); return this; },
      is(field, value) { filters.push((row) => (row[field] ?? null) === value); return this; },
      update(next) { operation = "update"; patch = next; return this; },
      async insert(row) {
        calls.insert++;
        if (table === "catalogo_recebedores" && rows[table].some((r) => r.comercio_id === row.comercio_id)) {
          return { error: { code: "23505" } };
        }
        rows[table].push({ ...row, id: table === "catalogo_oauth_estados" ? "oauth-state-1" : row.id });
        return { error: null };
      },
      async upsert(row) {
        calls.upsert++;
        const existing = rows[table].find((r) => r.comercio_id === row.comercio_id);
        if (existing) Object.assign(existing, row);
        else rows[table].push({ ...row });
        return { error: null };
      },
      async maybeSingle() {
        const found = rows[table].find((r) => filters.every((f) => f(r)));
        if (operation === "update") {
          if (!found) return { data: null, error: null };
          Object.assign(found, patch);
          return { data: { id: found.id }, error: null };
        }
        return { data: found ? { ...found } : null, error: null };
      },
    };
    return builder;
  }
  return { rows, calls, client: { auth: { async getUser(token) {
    if (token === "valid-owner-token") return { data: { user: { id: "owner-1" } }, error: null };
    return { data: { user: null }, error: { message: "invalid token" } };
  } }, from } };
}

function load(file, env, db, fetchMock) {
  let handler = null;
  const source = read(file).replace(/^import[^\n]*;\s*$/gm, "");
  const stripped = stripTypeScriptTypes(source, { mode: "strip" });
  const context = vm.createContext({
    crypto: webcrypto, TextEncoder, Uint8Array, btoa, atob, Date,
    URL, URLSearchParams, Request, Response,
    console: { error() {} },
    createClient: () => db.client,
    fetch: fetchMock || (() => { throw new Error("Unexpected outbound network request"); }),
    Deno: { env: { get: (name) => env[name] }, serve: (fn) => { handler = fn; } },
  });
  vm.runInContext(stripped, context, { filename: file });
  assert.equal(typeof handler, "function");
  return handler;
}
function envForQa(enabled = true) {
  return {
    SUPABASE_URL: STAGING, SUPABASE_SECRET_KEYS: JSON.stringify({ default: "fake-service-key" }),
    MP_OAUTH_QA_ENABLED: enabled ? "true" : "false",
    MP_OAUTH_QA_CLIENT_ID: "10001234", MP_OAUTH_QA_CLIENT_SECRET: "fake-test-secret",
    MP_OAUTH_QA_REDIRECT_URI: CALLBACK, MP_OAUTH_QA_ALLOWED_COMMERCE_ID: "asaas-homologacao",
    MP_OAUTH_ENCRYPTION_KEY: "11".repeat(32),
  };
}
function postBody(commerce = "asaas-homologacao", token = "valid-owner-token") {
  return new Request(STAGING + "/functions/v1/catalogo-oauth-qa-iniciar", {
    method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ acao: "iniciar_conexao_qa", comercio_id: commerce }),
  });
}
test("QA starter fails closed without opt-in or outside exact project", async () => {
  for (const env of [envForQa(false), { ...envForQa(), SUPABASE_URL: PRODUCTION }]) {
    const db = fakeDatabase();
    const handler = load("supabase/functions/catalogo-oauth-qa-iniciar/index.ts", env, db);
    const response = await handler(postBody());
    assert.equal(response.status, 503);
    assert.equal(db.rows.catalogo_oauth_estados.length, 0);
  }
});
test("QA starter requires authenticated catalog owner and active publication", async () => {
  const db = fakeDatabase();
  const starter = load("supabase/functions/catalogo-oauth-qa-iniciar/index.ts", envForQa(), db);
  assert.equal((await starter(postBody("asaas-homologacao", "wrong-token"))).status, 401);
  assert.equal((await starter(postBody("other-commerce"))).status, 403);
  db.rows.catalogos[0].proprietario_id = "somebody-else";
  assert.equal((await starter(postBody())).status, 403);
  db.rows.catalogos[0].proprietario_id = "owner-1";
  db.rows.comercios_publicados[0].status = "inativo";
  assert.equal((await starter(postBody())).status, 403);
  assert.equal(db.rows.catalogo_oauth_estados.length, 0);
});
test("QA starter creates fresh, expiring state with correct S256 PKCE and no outbound calls", async () => {
  const db = fakeDatabase();
  const starter = load("supabase/functions/catalogo-oauth-qa-iniciar/index.ts", envForQa(), db);
  const response = await starter(postBody());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.success, true);
  assert.equal(result.expires_in, 600);
  const url = new URL(result.authorization_url);
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "auth.mercadopago.com");
  assert.equal(url.searchParams.get("redirect_uri"), CALLBACK);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("client_id"), "10001234");
  assert.equal(db.rows.catalogo_oauth_estados.length, 1);
  const saved = db.rows.catalogo_oauth_estados[0];
  assert.equal(saved.estado_hash, stateHash(url.searchParams.get("state")));
  assert.equal(url.searchParams.get("code_challenge"), stateHash(saved.code_verifier));
  assert.equal(saved.proprietario_id, "owner-1");
  const diff = new Date(saved.expira_em).getTime() - Date.now();
  assert.ok(diff > 9 * 60 * 1000 && diff <= 10 * 60 * 1000);
});
function prepareCallback(db, state = "test-oauth-state") {
  db.rows.catalogo_oauth_estados.push({
    id: "oauth-state-1", comercio_id: "asaas-homologacao", proprietario_id: "owner-1",
    estado_hash: stateHash(state), code_verifier: "test-verifier",
    usado_em: null, expira_em: new Date(Date.now() + 600000).toISOString(),
  });
  return new Request(CALLBACK + "?state=" + encodeURIComponent(state) + "&code=test-code");
}
function tokenFetch(response, calls) {
  return async (url, options) => {
    assert.equal(url, "https://api.mercadopago.com/oauth/token");
    const values = Object.fromEntries(new URLSearchParams(options.body));
    calls.push(values);
    return Response.json({
      access_token: "fake-sandbox-access", refresh_token: "fake-sandbox-refresh",
      user_id: 1000111, expires_in: 3600, live_mode: response,
    });
  };
}
test("QA callback exchanges sandbox token, encrypts and saves once; second callback is rejected", async () => {
  const db = fakeDatabase(); const calls = [];
  const request = prepareCallback(db);
  const callback = load("supabase/functions/mercadopago-oauth-callback/index.ts",
    envForQa(), db, tokenFetch(false, calls));
  const first = await callback(request);
  assert.equal(first.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].test_token, "true");
  assert.equal(calls[0].client_id, "10001234");
  assert.equal(calls[0].redirect_uri, CALLBACK);
  assert.equal(db.rows.catalogo_recebedores.length, 1);
  const receiver = db.rows.catalogo_recebedores[0];
  assert.equal(receiver.oauth_live_mode, false);
  assert.equal(receiver.status, "bloqueado", "vendedor de teste nunca fica ativo para Pix");
  assert.ok(!receiver.oauth_access_token_enc.includes("fake-sandbox-access"));
  assert.equal(db.rows.catalogo_oauth_estados[0].usado_em !== null, true);
  const replay = await callback(request);
  assert.equal(replay.status, 400);
  assert.equal(calls.length, 1);
  assert.equal(db.rows.catalogo_recebedores.length, 1);
});
test("QA callback rejects production tokens and refuses to overwrite existing receivers", async () => {
  const db = fakeDatabase(); const calls = [];
  const request = prepareCallback(db);
  const callback = load("supabase/functions/mercadopago-oauth-callback/index.ts",
    envForQa(), db, tokenFetch(true, calls));
  assert.equal((await callback(request)).status, 400);
  assert.equal(db.rows.catalogo_recebedores.length, 0);
  db.rows.catalogo_recebedores.push({ comercio_id: "asaas-homologacao", status: "ativo" });
  const callbackValid = load("supabase/functions/mercadopago-oauth-callback/index.ts",
    envForQa(), db, tokenFetch(false, calls));
  assert.equal((await callbackValid(request)).status, 400);
  assert.equal(db.rows.catalogo_recebedores.length, 1);
  assert.equal(db.calls.upsert, 0);
});
test("callback in STAGING without QA flag never calls provider", async () => {
  const db = fakeDatabase(); const request = prepareCallback(db);
  const callback = load("supabase/functions/mercadopago-oauth-callback/index.ts", envForQa(false), db);
  assert.equal((await callback(request)).status, 400);
  assert.equal(db.rows.catalogo_recebedores.length, 0);
});
test("PRODUCTION callback never requests test_token, rejects sandbox credentials", async () => {
  const db = fakeDatabase(); const calls = [];
  const request = prepareCallback(db);
  const env = {
    ...envForQa(), SUPABASE_URL: PRODUCTION,
    MP_OAUTH_CLIENT_ID: "99999", MP_OAUTH_CLIENT_SECRET: "fake-production-secret",
    MP_OAUTH_REDIRECT_URI: PRODUCTION + "/functions/v1/mercadopago-oauth-callback",
    SITE_URL: "https://example.invalid",
  };
  const callback = load("supabase/functions/mercadopago-oauth-callback/index.ts",
    env, db, tokenFetch(false, calls));
  assert.equal((await callback(request)).status, 302);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].test_token, undefined);
  assert.equal(calls[0].client_id, "99999");
  assert.equal(db.rows.catalogo_recebedores.length, 0);
});

function diagnosticRequest(token = "valid-owner-token", commerce = "asaas-homologacao") {
  return new Request(STAGING + "/functions/v1/catalogo-oauth-qa-iniciar", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ acao: "verificar_configuracao_qa", comercio_id: commerce }),
  });
}
test("QA preflight returns names of missing settings to authenticated owner, never secret values", async () => {
  const db = fakeDatabase(), env = envForQa(false);
  delete env.MP_OAUTH_QA_CLIENT_SECRET;
  delete env.MP_OAUTH_QA_REDIRECT_URI;
  delete env.MP_OAUTH_ENCRYPTION_KEY;
  const handler = load("supabase/functions/catalogo-oauth-qa-iniciar/index.ts", env, db);
  const response = await handler(diagnosticRequest());
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.success, true);
  assert.equal(data.configuracao_pronta, false);
  assert.ok(data.pendencias.includes("MP_OAUTH_QA_ENABLED"));
  assert.ok(data.pendencias.includes("MP_OAUTH_QA_CLIENT_SECRET"));
  assert.ok(data.pendencias.includes("MP_OAUTH_QA_REDIRECT_URI"));
  assert.ok(data.pendencias.includes("MP_OAUTH_ENCRYPTION_KEY"));
  assert.ok(!JSON.stringify(data).includes("fake-service-key"));
  assert.equal(db.rows.catalogo_oauth_estados.length, 0);
});
test("QA preflight is private: invalid JWT, unrelated and unpublished owners never see settings", async () => {
  const db = fakeDatabase();
  const handler = load("supabase/functions/catalogo-oauth-qa-iniciar/index.ts", envForQa(false), db);
  assert.equal((await handler(diagnosticRequest("wrong-token"))).status, 401);
  assert.equal((await handler(diagnosticRequest("valid-owner-token", "outra-loja"))).status, 403);
  db.rows.catalogos[0].proprietario_id = "another-owner";
  assert.equal((await handler(diagnosticRequest())).status, 403);
  assert.equal(db.rows.catalogo_oauth_estados.length, 0);
});
test("QA preflight requires complete callback credentials and financial checkout disabled", async () => {
  const db = fakeDatabase(), env = envForQa();
  const handler = load("supabase/functions/catalogo-oauth-qa-iniciar/index.ts", env, db);
  const response = await handler(diagnosticRequest());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).configuracao_pronta, true);
  const envWithCheckout = { ...env, MARKETPLACE_CHECKOUT_ENABLED: "true" };
  const closed = load("supabase/functions/catalogo-oauth-qa-iniciar/index.ts", envWithCheckout, db);
  const check = await (await closed(diagnosticRequest())).json();
  assert.ok(check.pendencias.includes("CHECKOUT_FINANCEIRO_DESLIGADO"));
  assert.equal((await closed(postBody())).status, 503);
  const missingCallbackSecret = load("supabase/functions/catalogo-oauth-qa-iniciar/index.ts",
    { ...env, MP_OAUTH_QA_CLIENT_SECRET: "" }, db);
  assert.equal((await missingCallbackSecret(postBody())).status, 503);
  assert.equal(db.rows.catalogo_oauth_estados.length, 0);
});
