"use strict";
// Static dependency guard: release must bundle index.ts AND relative helpers.
// Does not contact Supabase, Mercado Pago or a remote package registry.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..", "supabase", "functions");
const ENTRYPOINTS = [
  "catalogo-admin/index.ts",
  "catalogo-pedido-pix/index.ts",
  "catalogo-pedido-offline/index.ts",
  "catalogo-entregas/index.ts",
  "catalogo-saque-payout/index.ts",
  "catalogo-pedidos-offline-admin/index.ts",
  "catalogo-fatura-pix/index.ts",
  "mercadopago-marketplace-webhook/index.ts",
  "catalogo-pix-producao/index.ts",
  "mercadopago-oauth-callback/index.ts",
];
const STANDALONE_RELATIVE = /\bfrom\s*["'](\.{1,2}\/[^"'\s]+)["']|\bimport\s*\(\s*["'](\.{1,2}\/[^"'\s]+)["']\s*\)|^\s*import\s*["'](\.{1,2}\/[^"'\s]+)["']/gm;
const EXTENSIONS = ["", ".ts", ".js", ".mjs", "/index.ts", "/index.js"];

function resolveImport(from, specifier) {
  const base = path.resolve(path.dirname(from), specifier);
  assert.ok(base.startsWith(ROOT + path.sep),
    `Import tried to leave functions directory: ${specifier} from ${from}`);
  const candidates = EXTENSIONS.map(ext => base + ext);
  const found = candidates.find(file => fs.existsSync(file) && fs.statSync(file).isFile());
  assert.ok(found, `Missing relative Edge import ${specifier} from ${path.relative(ROOT, from)}`);
  return found;
}

test("all financial Edge entrypoints include resolvable bundled relative dependencies", () => {
  const visited = new Set();
  for (const entry of ENTRYPOINTS) {
    const initial = path.join(ROOT, entry);
    assert.ok(fs.existsSync(initial), `Missing Edge Function entrypoint: ${entry}`);
    const queue = [initial];
    while (queue.length) {
      const file = queue.pop();
      if (visited.has(file)) continue;
      visited.add(file);
      const source = fs.readFileSync(file, "utf8");
      let match;
      STANDALONE_RELATIVE.lastIndex = 0;
      while ((match = STANDALONE_RELATIVE.exec(source)) !== null) {
        const specifier = match[1] || match[2] || match[3];
        queue.push(resolveImport(file, specifier));
      }
    }
  }
  for (const required of [
    "_shared/catalogo-pagamentos-v2.ts",
    "_shared/catalogo-webhook-events.ts",
    "_shared/catalogo-pedido-offline-runtime.ts",
    "_shared/catalogo-entregas-crypto-v2.ts",
    "_shared/catalogo-saques-payout.ts",
    "catalogo-fatura-pix/fatura-utils.mjs",
    "catalogo-pix-producao/mercadopago-utils.mjs",
  ]) {
    assert.ok(visited.has(path.join(ROOT, required)),
      `Critical Edge shared module is missing from dependency graph: ${required}`);
  }
  assert.ok(visited.size >= ENTRYPOINTS.length + 6);
});
