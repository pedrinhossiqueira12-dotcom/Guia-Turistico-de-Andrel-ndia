const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "404.html"), "utf8");

test("Cloudflare Pages tem 404.html na raiz com noindex", () => {
  assert.match(html, /<meta\s+name="robots"\s+content="noindex,follow">/i);
  assert.match(html, /<h1>Página não encontrada<\/h1>/);
  assert.match(html, /href="\/index\.html"/);
  assert.match(html, /href="\/pages\/noticias\.html"/);
  assert.doesNotMatch(html, /rel="canonical"/);
});
