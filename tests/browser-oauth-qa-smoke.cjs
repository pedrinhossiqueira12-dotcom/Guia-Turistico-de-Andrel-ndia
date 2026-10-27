/* Browser-only OAuth QA readiness test. NO real network/auth or payment requests. */
"use strict";
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const { resolve, extname, sep } = require("node:path");
const { chromium } = require("playwright");

const ROOT = resolve(__dirname, "..");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8" };
const server = createServer(async (req, res) => {
  let decoded;
  try { decoded = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
  catch { return res.writeHead(400).end(); }
  const file = resolve(ROOT, "." + decoded);
  if (!file.startsWith(ROOT + sep)) return res.writeHead(403).end();
  try {
    const content = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream", "cache-control": "no-store" }).end(content);
  } catch { res.writeHead(404).end(); }
});

function mockedOwnerSession() {
  const fakeClient = {
    auth: {
      async getUser() { return { data: { user: { id: "synthetic-owner" } }, error: null }; },
      async signOut() { return { error: null }; },
    },
    functions: {
      async invoke(name, options) {
        if (name !== "catalogo-oauth-qa-iniciar" ||
            options?.body?.acao !== "verificar_configuracao_qa") {
          throw new Error("Unexpected OAuth initiation or network action");
        }
        if (options.body.comercio_id === "asaas-homologacao") {
          return {
            error: null,
            data: { success: true, configuracao_pronta: false,
              pendencias: ["MP_OAUTH_QA_CLIENT_SECRET", "MP_OAUTH_QA_ENABLED"] },
          };
        }
        return { error: null, data: { success: true, configuracao_pronta: false,
          pendencias: ["MP_OAUTH_QA_ALLOWED_COMMERCE_ID"] } };
      },
    },
  };
  window.supabase = { createClient: () => fakeClient };
}

async function main() {
  await new Promise((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveReady);
  });
  const origin = "http://127.0.0.1:" + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    for (const width of [1280, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 850 }, serviceWorkers: "block",
      });
      await context.addInitScript(mockedOwnerSession);
      const forbidden = [];
      await context.route("**/*", route => {
        const req = route.request();
        if (req.url().startsWith(origin + "/")) return route.continue();
        // CDN scripts are deliberately blocked: the SDK is supplied by a mock.
        // Real Supabase/Mercado Pago requests are forbidden.
        if (/supabase\.co|mercadopago\./.test(req.url()) || req.method() !== "GET") {
          forbidden.push({ method: req.method(), url: req.url() });
        }
        return route.abort("blockedbyclient");
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", e => errors.push(e.message));
      const response = await page.goto(origin + "/pages/catalogo-oauth-qa.html", { waitUntil: "load" });
      assert.equal(response.status(), 200);
      await page.waitForFunction(() => document.getElementById("qaReadiness")?.textContent?.includes("MP_OAUTH_QA_CLIENT_SECRET"));
      assert.equal(await page.locator("#loginPanel").isVisible(), false);
      assert.equal(await page.locator("#oauthPanel").isVisible(), true);
      assert.equal(await page.locator("#connectButton").isDisabled(), true);
      const pending = await page.locator("#qaReadiness").innerText();
      assert.match(pending, /MP_OAUTH_QA_ENABLED/);
      assert.doesNotMatch(pending, /fake-service-key|access_token|refresh_token/);

      await page.selectOption("#commerceId", "asaas-cob02");
      await page.waitForFunction(() => document.getElementById("qaReadiness")?.textContent?.includes("MP_OAUTH_QA_ALLOWED_COMMERCE_ID"));
      assert.equal(await page.locator("#connectButton").isDisabled(), true);
      await page.locator("#inspectButton").click();
      await page.waitForFunction(() => document.getElementById("qaReadiness")?.textContent?.includes("MP_OAUTH_QA_ALLOWED_COMMERCE_ID"));
      assert.equal(await page.locator("#connectButton").isDisabled(), true);

      assert.deepEqual(forbidden, [], "No real Supabase, Mercado Pago, or write network requests");
      assert.deepEqual(errors, [], "No browser JavaScript errors");
      const size = await page.evaluate(() => ({
        viewport: window.innerWidth, scroll: document.documentElement.scrollWidth,
      }));
      assert.ok(size.scroll <= size.viewport + 2, "No horizontal overflow");
      console.log("PASS browser QA owner " + width + "px: readiness is visible; OAuth remains blocked");
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(done => server.close(done));
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
