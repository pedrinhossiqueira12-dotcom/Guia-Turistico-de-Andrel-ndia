const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const edge = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions',
  'catalogo-asaas-financeiro', 'index.ts'), 'utf8');
const inicio = edge.indexOf('async function auditarDuplicidadeAcumuloSandboxAdmin(');
const fim = edge.indexOf('// COB-06: prova remota somente leitura', inicio);
const auditoria = edge.slice(inicio, fim);
const modulo = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions',
  '_shared', 'catalogo-asaas-acumulo-auditoria-duplicidade-inerte.ts'), 'utf8');

test('COB-06: auditoria de duplicidade restrita a admin, Sandbox, flag separada e comercio ficticio', () => {
  assert.ok(inicio >= 0 && fim > inicio);
  assert.match(edge, /Deno\.env\.get\("ASAAS_COB06_DUPLICIDADE_ADMIN_ENABLED"\) === "true"/);
  assert.match(auditoria, /uid!==ADMIN_USER_ID/);
  assert.match(auditoria, /ENVIRONMENT!=="sandbox"\|\|!COB06_GET_ADMIN_READONLY_ON\|\|!COB06_DUPLICIDADE_ADMIN_ON/);
  assert.match(auditoria, /ref\.comercio_id!=="asaas-cob02"/);
  assert.match(edge, /case "auditar_duplicidade_acumulo_sandbox_admin":return await auditarDuplicidadeAcumuloSandboxAdmin\(user\.id,body\)/);
});

test('COB-06: origem da identidade e do valor fica no banco, nunca no navegador', () => {
  assert.match(auditoria, /\.eq\("lote_id",lote\)\.maybeSingle\(\)/);
  assert.match(auditoria, /\.select\("cliente_id"\)\.eq\("comercio_id",ref\.comercio_id\)/);
  assert.match(auditoria, /catalogo_asaas_conferir_conciliacao_acumulo/);
  assert.match(auditoria, /loteId:lote,referencia:ref\.referencia/);
  assert.match(auditoria, /clienteId:cliente\.data\.cliente_id,valorCentavos/);
  assert.doesNotMatch(auditoria, /body\.payment_id|body\.cliente_id|body\.valor_centavos/);
});

test('COB-06: mesmo GET sem cobrança não libera POST, quitação ou saque', () => {
  assert.match(auditoria, /prova_ausencia_para_emissao:false,hold_obrigatorio:true/);
  assert.match(auditoria, /pode_emitir_pix:false,pode_quitar:false,pode_liberar_motoboy:false/);
  assert.match(modulo, /holdObrigatorio: true;[\s\S]*podeEmitirPix: false;[\s\S]*podeQuitar: false/);
  assert.doesNotMatch(auditoria + modulo, /postarPix\(|fetch\([^\n]*POST|method:\s*"POST"|transferirSaque\(/);
});
