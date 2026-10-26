const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../supabase/functions/mercadopago-oauth-callback/index.ts"),
  "utf8"
);

test("test OAuth sellers only allowed with explicit staging project and QA opt-in", () => {
  assert.match(source, /SUPABASE_URL === qaProjectUrl && Deno\.env\.get\("MP_OAUTH_QA_ENABLED"\) === "true"/);
  assert.match(source, /https:\/\/jbttwihctuibchhcyqtl\.supabase\.co/);
  assert.match(source, /qaMode \? credentials\.live_mode !== false : credentials\.live_mode !== true/);
});

test("OAuth callback remains non-payment endpoint", () => {
  assert.match(source, /request\.method !== "GET"/);
  assert.doesNotMatch(source, /\/v1\/payments|\/v1\/transfers/);
});

test("buyer Pix refuses OAuth test sellers, regardless of checkout flag", () => {
  const pix = fs.readFileSync(path.join(__dirname, "../supabase/functions/catalogo-pedido-pix/index.ts"), "utf8");
  assert.match(pix, /oauth_live_mode/);
  assert.match(pix, /receiver\.oauth_live_mode !== true/);
  assert.match(pix, /Recebedor de teste não pode gerar Pix neste checkout/);
});
