const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "styles/local.css"), "utf8");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const profileScript = read("js/catalogo-local.js");
const salesScript = read("js/catalogo-venda.js");
const salesPage = read("pages/catalogo-venda.html");
const adminScript = read("js/catalogo-admin.js");
const adminFunction = read("supabase/functions/catalogo-admin/index.ts");
const sandboxFunction = read("supabase/functions/catalogo-pix-sandbox/index.ts");

test("cartões do catálogo respeitam hidden mesmo com display:flex", () => {
  assert.match(
    css,
    /\.catalogo-local-publico\[hidden\]\s*,\s*\.catalogo-local-owner\[hidden\]\s*\{\s*display:\s*none\s*!important\s*;/s,
  );
});

test("vitrine pública começa oculta e só aparece com comércio e catálogo ativos", () => {
  assert.match(profileScript, /area\.hidden\s*=\s*true/);
  assert.match(profileScript, /String\(comercio\.status\s*\|\|\s*""\)\.toLowerCase\(\)\s*!==\s*"ativo"/);
  assert.match(profileScript, /from\("catalogo_publicado"\)/);
  assert.match(profileScript, /if\s*\(error\s*\|\|\s*!data\)\s*return/);
});

test("área do proprietário exige confirmação server-side, mas não exclui admin que também é dono", () => {
  assert.match(profileScript, /if\s*\(!estado\?\.proprietario\)\s*\{/);
  assert.doesNotMatch(profileScript, /!estado\?\.proprietario\s*\|\|\s*estado\.admin/);
  assert.match(profileScript, /functions\.invoke\("catalogo-admin"/);
});

test("backend confirma propriedade do admin antes de tratá-lo como proprietário", () => {
  assert.match(adminFunction, /const ownership = await verifyCommerceOwner\(authenticated\.user\.id, commerceId\);\s*if \(ownership\.valid\)/s);
  assert.match(adminFunction, /proprietario: false, admin: true, admin_catalog_access: true/);
  assert.doesNotMatch(adminFunction, /A conta administrativa não pode solicitar cobrança/);
});

test("visitantes não recebem botões premium e o proprietário usa exclusivamente a tela sandbox", () => {
  assert.match(salesPage, /id="linkTestePix"[^>]*hidden/);
  assert.match(salesPage, /id="linkGerenciar"[^>]*hidden/);
  assert.doesNotMatch(salesPage, /id="ativarCatalogo"/);
  assert.match(salesScript, /if \(!data\?\.proprietario\) throw/);
  assert.match(salesScript, /catalogo-pix-teste\.html\?id=/);
});

test("proprietário admin sem assinatura continua bloqueado no painel premium", () => {
  assert.match(adminScript, /if \(!data\?\.proprietario && !data\?\.admin\) throw/);
  assert.match(adminScript, /if \(!resultado\.ativo && \(!resultado\.admin \|\| resultado\.proprietario\)\)/);
});

test("sandbox mantém assinatura pendente e não ativa a vitrine após aprovação do teste", () => {
  assert.match(sandboxFunction, /catalog_activated: false/);
  assert.match(sandboxFunction, /Deliberately update metadata only\. Never write status='ativa', pago_em or expira_em here\./);
  assert.match(sandboxFunction, /\.eq\("status", "pendente"\)/);
  assert.match(sandboxFunction, /\.update\(\{ metadata \}\)/);
});
