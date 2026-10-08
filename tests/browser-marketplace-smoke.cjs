/* Real-browser, read-only, OFFLINE smoke test for storefront/admin/rider.
 * No real Supabase connection, no real credentials, no payments, no updates.
 * The browser blocks ALL requests outside a local static server.
 */
"use strict";
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const { resolve, extname, sep } = require("node:path");
const { chromium } = require("playwright");

const ROOT = resolve(__dirname, "..");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2",
};
const PAGES = [
  {
    id: "vitrine",
    path: "/pages/catalogo.html",
    check: async page => {
      assert.equal(await page.locator("#catalogoConteudo").isVisible(), false);
      assert.equal(await page.locator("#abrirCarrinho").isVisible(), false);
      assert.equal(await page.locator("#catalogoAviso").isVisible(), true);
    },
  },
  {
    id: "contratacao",
    path: "/pages/catalogo-venda.html?id=loja-teste-isolada",
    check: async page => {
      assert.match(await page.locator("main").innerText(), /7%/);
      assert.equal(await page.locator("#linkPixProducao").isVisible(), false);
      assert.equal(await page.locator("#linkGerenciar").isVisible(), false);
    },
  },
  {
    id: "comerciante",
    path: "/pages/catalogo-admin.html?id=loja-teste-isolada",
    check: async page => {
      assert.equal(await page.locator("#painelCatalogo").isVisible(), false);
      assert.equal(await page.locator("#loginCard").isVisible(), true);
    },
  },
  {
    id: "motoboy",
    path: "/pages/motoboy.html",
    check: async page => {
      assert.equal(await page.locator("#motoboyPanel").isVisible(), false);
      assert.equal(await page.locator("#motoboyLoginCard").isVisible(), true);
    },
  },
  {
    id: "operacao",
    path: "/pages/entregas-operacao.html",
    check: async page => {
      assert.equal(await page.locator("#operationPanel").isVisible(), false);
      assert.equal(await page.locator("#operationLoginCard").isVisible(), true);
    },
  },
  {
    id: "codigo-antigo",
    path: "/pages/pedido-offline.html?token=TOKEN_SINTETICO_SEM_VALOR",
    check: async page => {
      assert.equal(await page.locator("#confirmacaoStatus").isVisible(), true);
      assert.equal(await page.locator("#confirmarEntregaForm").count(), 0);
      assert.doesNotMatch(page.url(), /token=/);
      assert.match(await page.locator("#confirmacaoStatus").innerText(), /painel autenticado/i);
    },
  },
];

const server = createServer(async (req, res) => {
  const route = new URL(req.url || "/", "http://localhost").pathname;
  let decoded;
  try { decoded = decodeURIComponent(route); } catch { res.writeHead(400).end(); return; }
  const target = resolve(ROOT, "." + decoded);
  if (target !== ROOT && !target.startsWith(ROOT + sep)) {
    res.writeHead(403).end(); return;
  }
  try {
    const file = await readFile(target === ROOT ? resolve(ROOT, "index.html") : target);
    res.writeHead(200, {
      "content-type": TYPES[extname(target).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    }).end(file);
  } catch { res.writeHead(404).end("Missing file"); }
});

const GUEST_CLIENT_STUB = () => {
  const neverLoggedIn = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
    functions: {
      invoke: async () => ({ data: null, error: { message: "Mock-only: no live API" } }),
    },
    from: () => {
      const denied = { data: null, error: { message: "Mock-only: no DB connection" } };
      const query = new Proxy({}, {
        get: (_target, key) => key === "then"
          ? (done, fail) => Promise.resolve(denied).then(done, fail)
          : () => query,
      });
      return query;
    },
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
  };
  window.supabase = { createClient: () => neverLoggedIn };
  window.supabaseLoginClient = neverLoggedIn;
};

async function main() {
  await new Promise((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveReady);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  let completed = 0;
  const errors = [];
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    for (const width of [1280, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 850 },
        serviceWorkers: "block",
      });
      await context.addInitScript(GUEST_CLIENT_STUB);
      const externalRequests = [];
      await context.route("**/*", route => {
        const request = route.request();
        if (request.url().startsWith(origin + "/")) return route.continue();
        externalRequests.push({ method: request.method(), url: request.url() });
        return route.abort("blockedbyclient");
      });
      for (const config of PAGES) {
        const page = await context.newPage();
        const pageErrors = [];
        const failedAssets = [];
        page.on("pageerror", error => pageErrors.push(error.message));
        page.on("response", response => {
          const req = response.request();
          if (response.url().startsWith(origin) &&
              response.status() >= 400 &&
              ["script", "stylesheet"].includes(req.resourceType())) {
            failedAssets.push(`${response.status()} ${response.url()}`);
          }
        });
        try {
          const response = await page.goto(origin + config.path, { waitUntil: "load", timeout: 25000 });
          assert.equal(response?.status(), 200);
          await page.waitForTimeout(250);
          await config.check(page);
          assert.deepEqual(failedAssets, [], "JS/CSS files missing");
          assert.deepEqual(pageErrors, [], "Browser JavaScript errors");
          const geometry = await page.evaluate(() => ({
            innerWidth: window.innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
          }));
          assert.ok(
            geometry.scrollWidth <= geometry.innerWidth + 2,
            `Horizontal overflow ${geometry.scrollWidth}px on viewport ${geometry.innerWidth}px`,
          );
          console.log(`PASS browser ${width}px: ${config.id}, no API calls or exposed private panel`);
          completed++;
        } catch (error) {
          errors.push(`${width}px ${config.id}: ${error.stack || error}`);
        } finally {
          await page.close();
        }
      }
      const externalApiCalls = externalRequests.filter(request =>
        /supabase\.co|mercadopago\./i.test(request.url) ||
        request.method !== "GET",
      );
      assert.deepEqual(externalApiCalls, [],
        "Forbidden real backend/payment calls attempted from guest browser");
      await context.close();
    }
    if (errors.length) throw new Error(errors.join("\n\n"));
    assert.equal(completed, PAGES.length * 2);
    console.log(`PASS: ${completed} browser smoke cases (mobile + desktop). All external network blocked.`);
  } finally {
    if (browser) await browser.close();
    await new Promise(done => server.close(done));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
