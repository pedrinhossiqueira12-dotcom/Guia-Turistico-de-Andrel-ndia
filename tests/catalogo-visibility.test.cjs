const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "styles/local.css"), "utf8");
const script = fs.readFileSync(path.join(root, "js/catalogo-local.js"), "utf8");

test("cartões do catálogo respeitam hidden mesmo com display:flex", () => {
  assert.match(
    css,
    /\.catalogo-local-publico\[hidden\]\s*,\s*\.catalogo-local-owner\[hidden\]\s*\{\s*display:\s*none\s*!important\s*;/s,
  );
});

test("vitrine pública começa oculta e só aparece com comércio e catálogo ativos", () => {
  assert.match(script, /area\.hidden\s*=\s*true/);
  assert.match(script, /String\(comercio\.status\s*\|\|\s*""\)\.toLowerCase\(\)\s*!==\s*"ativo"/);
  assert.match(script, /from\("catalogo_publicado"\)/);
  assert.match(script, /if\s*\(error\s*\|\|\s*!data\)\s*return/);
});

test("área do proprietário começa oculta e depende da validação server-side", () => {
  assert.match(script, /if\s*\(!estado\?\.proprietario\s*\|\|\s*estado\.admin\)\s*\{\s*area\.hidden\s*=\s*true/);
  assert.match(script, /functions\.invoke\("catalogo-admin"/);
});
