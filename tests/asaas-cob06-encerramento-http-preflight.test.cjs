"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");

const file = readFileSync("supabase/functions/catalogo-cob06-encerramento-preflight/index.ts", "utf8");
assert.match(file, /\/\/ Exclusivamente SELECT:/);
for (const forbidden of [/\.insert\(/, /\.update\(/, /\.delete\(/, /\.upsert\(/,
  /\.rpc\(/, /fetch\(/, /GITHUB_TOKEN/, /ASAAS_API_KEY/, /WHATSAPP_APP_SECRET/]) {
  assert.doesNotMatch(file, forbidden, "Preflight nao pode ter escrita ou rede externa");
}

function harness(options = {}) {
  let serve;
  const calls = [];
  const admin = { id: "d896cc0c-31e4-4ef7-8fa4-13d15f02dd2a",
    email: "pedrinhossiqueira12@gmail.com" };
  const db = {
    auth: { async getUser(token) {
      calls.push("auth:getUser");
      return { data: { user: token === "admin-qa" ? admin :
        token === "outro-usuario" ? { id:"outro", email:"outro@exemplo.test" } : null }, error: null };
    } },
    from(table) {
      calls.push("select:" + table);
      const query = {
        select() { return query; },
        eq() { return query; },
        async maybeSingle() {
          if (options.failRead) return { data: null, error: { message: "falha simulada" } };
          if (table === "catalogo_asaas_acumulo_lotes") return {
            data: { id:"583d761a-ecb9-49be-b484-e43f6183971e",
              comercio_id:"asaas-cob02", competencia_corte:"2027-03-01",
              total_centavos: options.badTotal ? 700 : 560, estado:"preparado" }, error:null };
          return { data:null, error:null };
        }
      };
      return query;
    }
  };
  const code = file.replace(/^import .*;\s*/m, "");
  const context = {
    Deno: { env: { get(name) {
      if (name === "SUPABASE_URL") return options.wrongProject ?
        "https://xdmbkflufsfqziixzpxc.supabase.co" :
        "https://jbttwihctuibchhcyqtl.supabase.co";
      if (name === "SUPABASE_SERVICE_ROLE_KEY") return "fake-key-no-network";
      return "";
    } }, serve(callback) { serve = callback; } },
    createClient() { calls.push("client:created"); return db; },
    URL, Response, Request, console: { error() {} },
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  async function request(token, body = { acao:"verificar_encerramento_http_qa" }) {
    const response = await serve(new Request(
      "https://jbttwihctuibchhcyqtl.supabase.co/functions/v1/catalogo-cob06-encerramento-preflight",
      { method:"POST", headers:{ "Content-Type":"application/json",
          ...(token ? { Authorization:"Bearer " + token } : {}) },
        body:JSON.stringify(body) }));
    return { status:response.status, body:await response.json() };
  }
  return { request, calls };
}

test("HTTP QA: falta de sessao e projeto errado falham sem banco", async () => {
  let h = harness();
  assert.equal((await h.request()).status, 401);
  assert.equal(h.calls.length, 0);
  h = harness({ wrongProject:true });
  assert.equal((await h.request("admin-qa")).status, 503);
  assert.equal(h.calls.length, 0);
});
test("HTTP QA: usuario alheio e acao desconhecida nao leem financeiro", async () => {
  const h = harness();
  assert.equal((await h.request("outro-usuario")).status, 403);
  assert.equal(h.calls.filter(v=>v.startsWith("select:")).length, 0);
  assert.equal((await h.request("admin-qa", { acao:"arquivar" })).status, 403);
  assert.equal(h.calls.filter(v=>v.startsWith("select:")).length, 0);
});
test("HTTP QA: admin STAGING confere quatro tabelas sem escrita", async () => {
  const h = harness();
  const out = await h.request("admin-qa");
  assert.equal(out.status, 200);
  assert.equal(out.body.success, true);
  assert.equal(out.body.operacao, "somente_leitura");
  assert.equal(out.body.hold_obrigatorio, true);
  assert.equal(out.body.pix_emitido, false);
  assert.equal(out.body.github_alterado, false);
  assert.equal(h.calls.filter(v=>v.startsWith("select:")).length, 4);
});
test("HTTP QA: divergencia e erro de leitura conservam HOLD", async () => {
  for (const options of [{ badTotal:true }, { failRead:true }]) {
    const h = harness(options);
    const out = await h.request("admin-qa");
    assert.ok(out.status === 409 || out.status === 503);
    assert.equal(out.body.success, false);
  }
});
