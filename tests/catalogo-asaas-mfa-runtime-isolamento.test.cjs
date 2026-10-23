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
  "catalogo-asaas-jwks-fixo-cache-inerte",
  "catalogo-asaas-livro-owner-sql-inerte",
  "catalogo-asaas-livro-ponte-nologin-inerte",
];
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry.name) ? [full] : [];
  });
}
function isRuntimeEntry(file) {
  const relative = path.relative(ROOT, file).replace(/\\/g, "/");
  // Arquivos _shared são bibliotecas, não endpoints; tests são laboratório.
  return !relative.startsWith("_shared/")
    && !relative.startsWith("tests/")
    && !relative.split("/").some((part) => part === "__tests__"
      || /\.(?:test|spec)\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/.test(part));
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

// Grafo de dependências locais: endpoints podem importar um _shared
// aparentemente inocente que reexporta um módulo de laboratorio.
// Imports com literais são percorridos recursivamente, com proteção a ciclos.
// Imports computados e aliases externos requerem auditoria adicional.
const TRANSITIVE_EXTENSIONS = [".ts",".tsx",".mts",".cts",".js",".mjs",".cjs"];
function importSpecifiers(text) {
  return [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)["'\x60]([^"'\x60]+)["'\x60]/g)]
    .map(match => match[1]);
}
function forbiddenSpecifier(value) {
  const name = path.posix.basename(value.replace(/\\/g,"/"))
    .replace(/\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/, "");
  return LAB_MODULES.includes(name);
}
function resolvedDependency(root, current, spec, allFiles) {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return null;
  const stem=path.resolve(path.dirname(current),spec.split(/[?#]/)[0]);
  if (!stem.startsWith(root+path.sep)) return null;
  const ext=path.extname(stem);
  const candidates=[stem,...(ext ? [] : [
    ...TRANSITIVE_EXTENSIONS.map(e=>stem+e),
    ...TRANSITIVE_EXTENSIONS.map(e=>path.join(stem,"index"+e)),
  ])];
  return candidates.find(candidate=>allFiles.has(candidate)) ?? null;
}
function transitiveViolations(root, entries) {
  const allFiles=new Set(walk(root));
  const importCache=new Map();
  const violations=new Set();
  function visit(entry,current,chain,seen) {
    if (seen.has(current)) return;
    seen.add(current);
    if (forbiddenSpecifier(current)) {
      violations.add(chain.join(" -> "));
      return;
    }
    if (!importCache.has(current)) {
      importCache.set(current,importSpecifiers(fs.readFileSync(current,"utf8")));
    }
    for (const spec of importCache.get(current)) {
      const next=resolvedDependency(root,current,spec,allFiles);
      if (forbiddenSpecifier(spec)) {
        violations.add([...chain,spec].join(" -> "));
      } else if (next) {
        visit(entry,next,[...chain,path.relative(root,next)],seen);
      }
    }
  }
  for (const entry of entries) {
    visit(entry,entry,[path.relative(root,entry)],new Set());
  }
  return [...violations].sort();
}
test("nenhuma Edge importa MFA de ensaio transitivamente por bibliotecas shared",()=>{
  const entries=walk(ROOT).filter(isRuntimeEntry);
  assert.ok(entries.length>0,"nenhuma Edge encontrada: guarda ineficaz");
  assert.deepEqual(transitiveViolations(ROOT,entries),[],
    "biblioteca importada por Edge alcanca MFA inerte");
});
test("fixture: reexport, import dinamico e ciclos sao tratados sem false negative",()=>{
  const os=require("node:os");
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"catalogo-mfa-transitive-"));
  const write=(relative,body)=>{
    const full=path.join(dir,relative);
    fs.mkdirSync(path.dirname(full),{recursive:true});
    fs.writeFileSync(full,body);
  };
  try {
    write("api/index.ts",'import "../_shared/fachada.ts";');
    write("_shared/fachada.ts",'export * from "./auxiliar.ts";');
    write("_shared/auxiliar.ts",'await import("./catalogo-asaas-jwks-fixo-cache-inerte.ts");');
    write("_shared/catalogo-asaas-jwks-fixo-cache-inerte.ts","export const mock = true;");
    const entry=path.join(dir,"api/index.ts");
    const denied=transitiveViolations(dir,[entry]);
    assert.ok(denied.some(v=>v.includes("fachada.ts") && v.includes("jwks-fixo-cache-inerte")));
    write("_shared/auxiliar.ts",'import "./fachada.ts";');
    assert.deepEqual(transitiveViolations(dir,[entry]),[]);
    write("api/index.ts",'require("../_shared/catalogo-asaas-livro-owner-sql-inerte.ts");');
    assert.ok(transitiveViolations(dir,[entry]).length>0);
  } finally {
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test("orquestrador MFA permanece inerte e exclusivo de CI", () => {
  const source = fs.readFileSync(path.join(ROOT, "_shared", LAB_MODULES[0] + ".ts"), "utf8");
  assert.match(source, /ambiente !== "isolated-ci"/);
  assert.match(source, /status_operacional: "HOLD_OBRIGATORIO"/);
  assert.match(source, /pagamento_autorizado: false/);
  assert.match(source, /movimenta_dinheiro: false/);
  assert.doesNotMatch(source, /https?:\/\//);
});
