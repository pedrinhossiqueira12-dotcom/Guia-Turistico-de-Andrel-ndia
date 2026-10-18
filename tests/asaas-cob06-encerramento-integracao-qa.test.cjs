"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync(
  "supabase/functions/catalogo-cob06-encerramento-integracao-qa/index.ts", "utf8"
);

test("COB06 integracao: ambiente, branch e identidade fixos somente em STAGING", () => {
  assert.match(source, /const STAGING = "https:\/\/jbttwihctuibchhcyqtl\.supabase\.co"/);
  assert.match(source, /const BRANCH = "qa\/cob06-isolado"/);
  assert.match(source, /const QA_ID = "cob06-qa-integracao-ficticia-20261017"/);
  assert.match(source, /const ADMIN_UID = "d896cc0c-31e4-4ef7-8fa4-13d15f02dd2a"/);
  assert.match(source, /auth\.user\.id !== ADMIN_UID/);
  assert.match(source, /auth\.user\.email\?\.toLowerCase\(\) !== ADMIN_EMAIL/);
  assert.match(source, /Deno\.env\.get\("SUPABASE_URL"\) !== STAGING/);
  assert.match(source, /Deno\.env\.get\("COB06_GITHUB_BRANCH"\) === BRANCH/);
});

test("COB06 integracao: somente JWT e quatro acoes QA sem outros caminhos", () => {
  assert.match(source, /const jwt = \/\^Bearer/);
  assert.match(source, /await db\.auth\.getUser\(jwt\)/);
  assert.match(source, /Object\.keys\(body\)\.length !== 1/);
  for (const acao of ["verificar_config_qa", "verificar_repositorio_qa", "concluir_encerramento_qa", "sincronizar_pendente_qa"]) {
    assert.ok(source.includes('"' + acao + '"'));
  }
  assert.doesNotMatch(source, /aprovar_cadastro|excluir_comercio|fatura_quitar|pix_emitir|transferencia_criar/);
});

test("COB06 integracao: escrita inabilitada por padrao e fluxo e fail-closed", () => {
  assert.match(source, /COB06_ENCERRAMENTO_HTTP_QA_ENABLED"\) === "true"/);
  const gate = source.indexOf('if (!flag) return fail(403');
  const rpc = source.indexOf('await db.rpc(');
  assert.ok(gate > 0 && rpc > gate, "flag precisa ser validada antes da RPC");
  const readRepo = source.indexOf('repo = await readRepo(token)');
  assert.ok(readRepo > 0 && readRepo < rpc, "GitHub deve ser conferido antes da RPC");
  const postConfirm = source.indexOf('confirmado.data?.status !== "deletado"');
  const put = source.indexOf("await writeRepo(token, repo)", postConfirm);
  assert.ok(postConfirm > rpc && put > postConfirm, "PUT precisa de confirmacao SQL posterior");
  assert.match(source, /pendente_sincronizacao: true/);
});

test("COB06 integracao: schema QA real, sem tabela legada nem outro comercio", () => {
  assert.match(source, /solicitante_id,dados,destaque,deletado_em,atualizado_em,atualizado_por/);
  assert.match(source, /pub\.data\.solicitante_id === ADMIN_UID/);
  assert.match(source, /pub\.data\.dados\?\.nome === QA_NAME/);
  assert.match(source, /!catalogo\.data/);
  assert.doesNotMatch(source, /cadastros_comercios/);
  assert.match(source, /p_comercio: QA_ID, p_admin: ADMIN_UID/);
  assert.match(source, /catalogo_arquivar_sem_catalogo_admin/);
});

test("COB06 integracao: GitHub apenas branch QA e sentinela unica, sem notificacoes", () => {
  assert.match(source, /"branch: BRANCH"|branch: BRANCH/);
  assert.match(source, /itens\.length !== 142/);
  assert.match(source, /matches\.length !== 1/);
  assert.match(source, /itens\[matches\[0\]\]\?\.nome !== QA_NAME/);
  assert.match(source, /status: "deletado", destaque: false, imagem: "", imagens: \[\]/);
  assert.doesNotMatch(source, /api\.asaas\.com|api\.mercadopago\.com|graph\.facebook\.com/);
  assert.doesNotMatch(source, /console\.(log|error)\([^)]*(token|Authorization)/i);
});

test("COB06 integracao: recuperacao pendente altera somente GitHub apos arquivamento confirmado", () => {
  const marker = source.indexOf('if (acao === "sincronizar_pendente_qa")');
  const rpc = source.indexOf('const { data: encerrado, error: rpcError } = await db.rpc(');
  assert.ok(marker > 0 && marker < rpc, "recuperacao precisa anteceder RPC");
  const recovery = source.slice(marker, rpc);
  assert.match(recovery, /pub\.data\?\.status !== "deletado"/);
  assert.match(recovery, /pub\.data\?\.atualizado_por !== ADMIN_UID/);
  assert.match(recovery, /pub\.data\?\.destaque !== false/);
  assert.match(recovery, /await writeRepo\(token, repo\)/);
  assert.match(recovery, /rpc_executada: false/);
  assert.doesNotMatch(recovery, /\.rpc\(|catalogo_arquivar_sem_catalogo_admin/);
  assert.match(source, /github_put_http_/);
});
