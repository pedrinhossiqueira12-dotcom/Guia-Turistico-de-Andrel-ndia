// COB-06 / PR39: gate estatico de deploy. Nao executa rede nem CLI Supabase.
// A secao de config deve continuar explicitamente protegida pelo JWT do gateway.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const raiz = join(__dirname, "..");
const config = readFileSync(join(raiz, "supabase/config.toml"), "utf8");
const edge = readFileSync(join(raiz,
  "supabase/functions/catalogo-asaas-cob06-auditoria/index.ts"), "utf8");

function secaoToml(nome) {
  const inicio = config.indexOf("[functions." + nome + "]");
  assert.notEqual(inicio, -1, "secao TOML da funcao ausente");
  const resto = config.slice(inicio + nome.length + "[functions.]".length);
  return resto.split(/\n\s*\[/, 1)[0];
}

test("COB06 auditoria administrativa exige JWT no gateway", () => {
  const secao = secaoToml("catalogo-asaas-cob06-auditoria");
  assert.match(secao, /^verify_jwt\s*=\s*true\s*$/m);
  assert.doesNotMatch(secao, /^verify_jwt\s*=\s*false\s*$/m);
});

test("COB06 tem guardas fixas de STAGING e lote QA; nao transporta POST Pix", () => {
  assert.match(edge, /const STAGING_URL = "https:\/\/jbttwihctuibchhcyqtl\.supabase\.co";/);
  assert.match(edge, /const QA_LOTE = "583d761a-ecb9-49be-b484-e43f6183971e";/);
  assert.match(edge, /const QA_COMERCIO = "asaas-cob02";/);
  assert.match(edge, /const QA_CORTE = "2027-03-01";/);
  assert.match(edge, /const QA_TOTAL_CENTAVOS = 560;/);
  assert.match(edge, /if \(lote !== QA_LOTE\)/);
  assert.match(edge, /URL_SUPABASE !== STAGING_URL/);
  assert.doesNotMatch(edge, /catalogo-asaas-acumulo-post-sandbox-candidato/);
  assert.doesNotMatch(edge, /postarPixAcumuloSandboxCandidatoSomenteCi/);
});
