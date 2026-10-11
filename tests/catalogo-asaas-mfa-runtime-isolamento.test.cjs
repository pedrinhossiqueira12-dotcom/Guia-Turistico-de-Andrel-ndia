"use strict";
/**
 * #42: barreira de CI contra importação acidental de simulações MFA
 * por funções Edge publicáveis. Somente inspeção estática, sem rede/Pix.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve("supabase/functions");
const LAB_MODULES = [
  "catalogo-asaas-mfa-orquestrador-prechallenge-inerte",
  "catalogo-asaas-stepup-documental-ensaio",
  "catalogo-asaas-gotrue-mfa-transporte-inerte",
  "catalogo-asaas-jwt-sessao-assinada-ensaio",
];
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name) ? [full] : [];
  });
}
function isRuntimeEntry(file) {
  const relative = path.relative(ROOT, file).replace(/\\/g, "/");
  // Arquivos _shared são bibliotecas, não endpoints; tests são laboratório.
  return !relative.startsWith("_shared/")
    && !relative.startsWith("tests/")
    && !relative.split("/").some((part) => part === "__tests__"
      || part.endsWith(".test.ts") || part.endsWith(".spec.ts"));
}
test("nenhuma Edge publicável importa o MFA inerte ou de ensaio", () => {
  assert.ok(fs.existsSync(ROOT), "diretório das funções ausente");
  const violations = [];
  for (const file of walk(ROOT).filter(isRuntimeEntry)) {
    const source = fs.readFileSync(file, "utf8");
    // Detecta imports estáticos, dinâmicos, reexports e require.
    const references = source.matchAll(/(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\(|\bimport\s*)["'`]([^"'`]+)["'`]/g);
    for (const match of references) {
      if (LAB_MODULES.some((name) => match[1].includes(name))) {
        violations.push(path.relative(ROOT, file) + ": " + match[1]);
      }
    }
  }
  assert.deepEqual(violations, [], "MFA de laboratório importado em Edge operacional");
});
test("orquestrador MFA permanece inerte e exclusivo de CI", () => {
  const source = fs.readFileSync(path.join(ROOT, "_shared", LAB_MODULES[0] + ".ts"), "utf8");
  assert.match(source, /ambiente !== "isolated-ci"/);
  assert.match(source, /status_operacional: "HOLD_OBRIGATORIO"/);
  assert.match(source, /pagamento_autorizado: false/);
  assert.match(source, /movimenta_dinheiro: false/);
  assert.doesNotMatch(source, /https?:\/\//);
});
