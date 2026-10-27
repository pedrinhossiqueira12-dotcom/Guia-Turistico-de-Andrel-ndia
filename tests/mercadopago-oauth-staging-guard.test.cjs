const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (relative) => fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
const callback = read("supabase/functions/mercadopago-oauth-callback/index.ts");
const starter = read("supabase/functions/catalogo-oauth-qa-iniciar/index.ts");
const pix = read("supabase/functions/catalogo-pedido-pix/index.ts");

test("OAuth QA endpoint requires project, opt-in and separate credentials", () => {
  assert.match(starter, /SUPABASE_URL === STAGING_URL && serviceKey/);
  assert.match(starter, /!admin \|\| !QA_ENABLED/);
  assert.match(starter, /MP_OAUTH_QA_CLIENT_ID/);
  assert.match(starter, /QA_REDIRECT_URI !== CALLBACK_URL/);
  assert.match(starter, /MP_OAUTH_QA_ALLOWED_COMMERCE_ID/);
  assert.match(starter, /MP_OAUTH_QA_ENCRYPTION_KEY/);
  assert.doesNotMatch(starter, /MP_OAUTH_ENCRYPTION_KEY/);
  assert.match(starter, /admin\.auth\.getUser\(token\)/);
  assert.match(starter, /catalog\.data\.proprietario_id !== userId/);
  assert.match(starter, /published\.data\?\.status !== "ativo"/);
  assert.match(starter, /receiver\.data/);
  assert.match(starter, /code_challenge_method: "S256"/);
  assert.match(starter, /estado_hash: await sha256\(state\)/);
  assert.match(starter, /expires_in: 600/);
  assert.doesNotMatch(starter, /\/v1\/payments|\/v1\/transfers|criar_pix|desconectar_recebedor/);
});

test("OAuth callback defaults to production mode and uses separate QA credentials only in staging", () => {
  assert.match(callback, /QA_PROJECT = SUPABASE_URL === STAGING_URL/);
  assert.match(callback, /QA_MODE = QA_PROJECT && QA_ENABLED/);
  assert.match(callback, /QA_PROJECT && !QA_MODE/);
  assert.match(callback, /QA_MODE \? QA_CLIENT_ID : MP_OAUTH_CLIENT_ID/);
  assert.match(callback, /QA_MODE \? QA_CLIENT_SECRET : MP_OAUTH_CLIENT_SECRET/);
  assert.match(callback, /QA_MODE \? QA_REDIRECT_URI : MP_OAUTH_REDIRECT_URI/);
  assert.match(callback, /QA_MODE \? QA_ENCRYPTION_KEY : MP_OAUTH_ENCRYPTION_KEY/);
  assert.match(callback, /QA_REDIRECT_URI !== EXPECTED_QA_REDIRECT/);
  assert.match(callback, /QA_MODE \\? !qaSandboxAccepted : credentials\\.live_mode !== true/);
  assert.match(callback, /credentials\\.live_mode === false/);
  assert.match(callback, /credentials\\.live_mode === undefined && qaSandboxToken/);
  assert.match(callback, /credentials\\.access_token\\.startsWith\\("TEST-"\\)/);
  // Mercado Pago: 'test_token=true' must be emitted only in the QA OAuth exchange.
  assert.match(callback, /\.\.\.\(QA_MODE \? \{ test_token: "true" \} : \{\}\)/);
  assert.doesNotMatch(callback, /test_token: "false"/);
  assert.match(callback, /oauthState\.comercio_id !== QA_ALLOWED_COMMERCE_ID/);
  assert.match(callback, /status: QA_MODE \? "bloqueado" : "ativo"/);
  assert.match(callback, /\.is\("usado_em", null\)/);
  assert.match(callback, /if \(updateStateError \|\| !claimed\)/);
  assert.match(callback, /QA_MODE\s*\? await admin\.from\("catalogo_recebedores"\)\.insert\(receiverRow\)/);
  assert.match(callback, /if \(QA_PROJECT\)/);
  assert.doesNotMatch(callback, /\/v1\/payments|\/v1\/transfers/);
});

test("buyer Pix explicitly refuses test OAuth sellers even if checkout flag enables", () => {
  assert.match(pix, /oauth_live_mode/);
  assert.match(pix, /receiver\.oauth_live_mode !== true/);
  assert.match(pix, /Recebedor de teste não pode gerar Pix neste checkout/);
});

test("seller onboarding page describes the agreed 7% policy", () => {
  const page = read("pages/catalogo-pix-producao.html");
  assert.match(page, /7%/);
  assert.match(page, /2%/);
  assert.doesNotMatch(page, /95% para o comércio|Retirada e consumo local mantêm 5%|comissão de 5% incide somente nas vendas/);
});

test("QA page authenticates only against STAGING and never creates payments", () => {
  const page = read("pages/catalogo-oauth-qa.html");
  const browser = read("js/catalogo-oauth-qa.js");
  assert.match(page, /<meta name="robots" content="noindex,nofollow,noarchive">/);
  assert.match(page, /catalogo-oauth-qa\.js/);
  assert.match(browser, /https:\/\/jbttwihctuibchhcyqtl\.supabase\.co/);
  assert.match(browser, /sb_publishable_/);
  assert.match(browser, /auth\.signInWithPassword/);
  assert.match(browser, /client\.auth\.getUser\(\)/);
  assert.match(browser, /functions\.invoke\("catalogo-oauth-qa-iniciar"/);
  assert.match(browser, /acao: "iniciar_conexao_qa"/);
  assert.match(browser, /destination\.protocol === "https:"/);
  assert.match(browser, /auth\.mercadopago\.com/);
  assert.doesNotMatch(browser, /MP_OAUTH_QA_CLIENT_SECRET|SUPABASE_SERVICE_ROLE_KEY|criar_pix|\/v1\/payments/);
  assert.doesNotMatch(page, /<script[^>]*login\.js/);
});
