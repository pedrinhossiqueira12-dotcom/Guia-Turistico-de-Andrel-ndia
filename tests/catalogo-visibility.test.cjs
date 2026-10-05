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
const productionFunction = read("supabase/functions/catalogo-pix-producao/index.ts");
const productionPage = read("pages/catalogo-pix-producao.html");
const productionCheckoutScript = read("js/catalogo-pix-producao.js");
const productionMigration = read("supabase/migrations/20261003140000_catalogo_pagamento_producao.sql");

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

test("visitantes não recebem ações privadas e a área de recebimentos exige servidor", () => {
  assert.match(salesPage, /id="linkTestePix"[^>]*hidden/);
  assert.match(salesPage, /id="linkPixProducao"[^>]*hidden/);
  assert.match(salesPage, /id="linkGerenciar"[^>]*hidden/);
  assert.doesNotMatch(salesPage, /id="ativarCatalogo"/);
  assert.match(salesScript, /if \(!data\?\.proprietario\) throw/);
  assert.match(salesScript, /catalogo-pix-teste\.html\?id=/);
  assert.match(salesScript, /\$\("linkPixProducao"\)\.hidden = false/);
  assert.match(productionCheckoutScript, /verificar_recebedor/);
  assert.match(productionFunction, /action === "verificar_recebedor"/);
  assert.match(productionFunction, /MP_PRODUCTION_ENABLED = Deno\.env\.get\("MP_PRODUCTION_ENABLED"\) === "true"/);
  assert.match(productionFunction, /if \(!MP_PRODUCTION_ENABLED\)/);
  assert.match(productionPage, /name="robots" content="noindex,nofollow,noarchive"/);
});

test("validação do vendedor usa o host oficial de perfil do Mercado Pago", () => {
  assert.match(productionFunction, /const MP_USER_PROFILE_API = "https:\/\/api\.mercadolibre\.com"/);
  assert.match(productionFunction, /mpRequest\("\/users\/me", "GET", undefined, undefined, MP_USER_PROFILE_API\)/);
});

test("checkout aceita o mesmo vínculo aprovado por local_id ou slug do nome que o painel", () => {
  assert.match(adminFunction, /function recordMatchesCommerce[\s\S]*?slug\(record\.nome\)/);
  assert.match(productionFunction, /function recordMatchesCommerce[\s\S]*?slug\(record\.nome\)/);
  assert.match(productionFunction, /recordMatchesCommerce\(item, commerceId\)/);
  assert.doesNotMatch(productionFunction, /\.eq\("local_id", commerceId\)\s*\.limit\(1\)/);
});

test("reserva concorrente do catálogo relê e valida proprietário e bloqueio antes de cobrar", () => {
  assert.match(productionFunction, /insertError\.code !== "23505"/);
  assert.match(productionFunction, /confirmed\.proprietario_id !== owner\.userId \|\| confirmed\.bloqueado/);
  assert.match(productionFunction, /existingCatalog\.proprietario_id !== owner\.userId \|\| existingCatalog\.bloqueado/);
});

test("área de recebimentos mostra status e não cria cobrança sem OAuth publicado", () => {
  assert.match(productionCheckoutScript, /receiverStatusTitle/);
  assert.match(productionCheckoutScript, /iniciar_conexao/);
  assert.match(productionFunction, /callback OAuth ainda não foi publicado/);
  assert.match(productionPage, /Conecte o Mercado Pago/);
});

test("migração bloqueia mais de um Pix por assinatura e permite renovar após expiração", () => {
  assert.match(productionMigration, /catalogo_pagamentos_assinatura_unica/);
  assert.match(productionMigration, /old\.status = 'ativa'[\s\S]*old\.expira_em <= pg_catalog\.now\(\)/);
  assert.match(productionMigration, /SET status = 'expirada'/);
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
