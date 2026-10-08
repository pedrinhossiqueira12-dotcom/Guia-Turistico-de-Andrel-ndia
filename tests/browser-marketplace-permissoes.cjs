/* Chromium em sandbox: usuario com sessao FICTICIA, mas sem permissao.
 * Todas as chamadas de rede externas sao bloqueadas ou respondidas por mock.
 * Nenhuma credencial nem usuario do Supabase e utilizado.
 */
"use strict";
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const { resolve, sep, extname } = require("node:path");
const { chromium } = require("playwright");
const ROOT = resolve(__dirname, "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const api = "https://xdmbkflufsfqziixzpxc.supabase.co/functions/v1/catalogo-entregas";
const asaasApi = "https://xdmbkflufsfqziixzpxc.supabase.co/functions/v1/catalogo-asaas-financeiro";
const tests = [
  {
    id: "admin_sem_permissao", path: "/pages/entregas-operacao.html",
    indicator: "#operationNoticeTitle", message: "Acesso não confirmado",
    async check(page) {
      assert.equal(await page.locator("#operationPanel").isVisible(), false);
      assert.equal(await page.locator("#operationLoginCard").isVisible(), true,
        "Usuário não autorizado precisa conseguir alternar conta");
      assert.equal(await page.locator("#operationLogout").isVisible(), true);
      assert.equal(await page.locator("#listaRepasses .manager-row").count(), 0);
      assert.equal(await page.locator("#listaOcorrencias .manager-row").count(), 0);
    }
  },
  {
    id: "motoboy_sem_permissao", path: "/pages/motoboy.html",
    indicator: "#motoboyOrdersFeedback", message: "Conta sem permissão",
    async check(page) {
      assert.equal(await page.locator("#motoboyEarnings").isVisible(), false);
      assert.equal(await page.locator("#motoboyOrders .motoboy-order").count(), 0);
      assert.equal(await page.locator("#motoboyLogout").isVisible(), true);
    }
  }
];
const server = createServer(async (req, res) => {
  let relative;
  try { relative = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
  catch { res.writeHead(400).end(); return; }
  const filepath = resolve(ROOT, "." + relative);
  if (filepath !== ROOT && !filepath.startsWith(ROOT + sep)) {
    res.writeHead(403).end(); return;
  }
  try {
    const buffer = await readFile(filepath === ROOT ? resolve(ROOT, "index.html") : filepath);
    res.writeHead(200, { "content-type": MIME[extname(filepath)] || "application/octet-stream",
      "cache-control": "no-store", "referrer-policy": "no-referrer" }).end(buffer);
  } catch { res.writeHead(404).end("not found"); }
});
const stub = () => {
  const session = { access_token: "TOKEN_FICTICIO_INVALIDO",
    user: { id: "11111111-1111-4111-8111-111111111111", email: "sem-permissao@example.invalid" } };
  const fake = { auth: {
    getSession: async () => ({ data: { session }, error: null }),
    getUser: async () => ({ data: { user: session.user }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({ error: null })
  }};
  window.supabase = { createClient: () => fake };
  window.supabaseLoginClient = fake;
};
async function run() {
  await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); });
  const origin = "http://127.0.0.1:" + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    let completed = 0;
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 850 }, serviceWorkers: "block" });
      await context.addInitScript(stub);
      const blocked = [];
      let mockCalls = 0;
      await context.route("**/*", route => {
        const url = route.request().url();
        if (url.startsWith(origin + "/")) return route.continue();
        if (url === api || url === asaasApi) {
          mockCalls++;
          return route.fulfill({
            status: 403, contentType: "application/json",
            body: JSON.stringify({ success: false, mensagem: "Conta sem permissão (mock 403)" })
          });
        }
        if (/supabase\.co|mercadopago\./i.test(url) || route.request().method() !== "GET") blocked.push(url);
        return route.abort("blockedbyclient");
      });
      try {
        for (const test of tests) {
          const page = await context.newPage();
          const pageErrors = [];
          page.on("pageerror", e => pageErrors.push(e.message));
          try {
            const response = await page.goto(origin + test.path, { waitUntil: "load", timeout: 25000 });
            assert.equal(response?.status(), 200);
            await page.waitForFunction(([sel, msg]) => document.querySelector(sel)?.textContent?.includes(msg),
              [test.indicator, test.message], { timeout: 8000 });
            await test.check(page);
            assert.deepEqual(pageErrors, [], "Erro de JavaScript no Chromium");
            completed++;
            console.log("PASS " + test.id + " no Chromium " + width + "px, mock 403");
          } finally { await page.close(); }
        }
        assert.ok(mockCalls >= 3, "Admin e motoboy precisam consultar autorizacao no servidor");
        assert.deepEqual(blocked, [], "Requisicao externa nao prevista");
      } finally {
        await context.close();
      }
    }
    assert.equal(completed, 4);
    console.log("PASS: 4 casos de usuario autenticado sem permissao; nenhum acesso ao backend real.");
  } finally {
    if (browser) await browser.close();
    await new Promise(ok => server.close(ok));
  }
}
run().catch(e => { console.error(e); process.exitCode = 1; });
