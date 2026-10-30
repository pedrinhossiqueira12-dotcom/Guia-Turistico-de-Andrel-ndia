const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const arquivo = path.join(__dirname, '..', 'supabase', 'functions',
  'catalogo-asaas-financeiro', 'index.ts');
const edge = fs.readFileSync(arquivo, 'utf8');
const inicio = edge.indexOf('async function prepararAcumuloSandboxAdmin(');
const fim = edge.indexOf('// Verifica a referencia de um lote QA', inicio);
const preparar = edge.slice(inicio, fim);

test('COB-06: preparação administrativa só aceita Sandbox e comércio QA com flag própria OFF', () => {
  assert.ok(inicio >= 0 && fim > inicio);
  assert.match(edge, /ASAAS_COB06_PREPARACAO_ADMIN_ENABLED/);
  assert.match(edge, /Deno\.env\.get\("ASAAS_COB06_PREPARACAO_ADMIN_ENABLED"\) === "true"/);
  assert.match(preparar, /uid!==ADMIN_USER_ID/);
  assert.match(preparar, /ENVIRONMENT!=="sandbox"\|\|!COB06_PREPARACAO_ADMIN_ON/);
  assert.match(preparar, /body\.comercio_id!=="asaas-cob02"/);
  assert.match(preparar, /competencia_corte/);
  assert.match(edge, /case "preparar_acumulo_sandbox_admin":return await prepararAcumuloSandboxAdmin\(user\.id,body\)/);
});

test('COB-06: cadeia de reservas confere as origens antes de reservar referência', () => {
  const nomes = [
    'catalogo_asaas_previsualizar_acumulo',
    'catalogo_asaas_reservar_acumulo',
    'catalogo_asaas_conferir_conciliacao_acumulo',
    'catalogo_asaas_reservar_referencia_acumulo',
  ];
  const posicoes = nomes.map(nome => preparar.indexOf(nome));
  assert.ok(posicoes.every(pos => pos >= 0));
  assert.ok(posicoes.every((pos, i) => i === 0 || pos > posicoes[i - 1]));
  assert.match(preparar, /prev\?\.pronto_para_preparar!==true/);
  assert.match(preparar, /conferencia\?\.integridade_contabil_ok!==true/);
  assert.match(preparar, /referencia\?\.payment_id!==null/);
  assert.match(preparar, /ja_reservado:reservado\.ja_reservado===true/);
});

test('COB-06: preparação nunca chama Asaas nem habilita dinheiro', () => {
  assert.doesNotMatch(preparar, /fetch\(|API_BASE|\/payments|postarPix|transferir|liberarCredito/);
  assert.match(preparar, /pix_emitido:false,pode_emitir_pix:false,pode_quitar:false/);
  assert.match(preparar, /pode_liberar_motoboy:false,hold_obrigatorio:true/);
});

test('COB-06: auditoria de baixa multicompetências exige flag OFF e apenas GET bancário', () => {
  const start = edge.indexOf('async function auditarBaixaMulticompetenciaSandboxAdmin(');
  const end = edge.indexOf('// GET paginado traz', start);
  assert.ok(start > 0 && end > start, 'rota de auditoria presente');
  const audit = edge.slice(start, end);
  const pure = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions',
    '_shared', 'catalogo-asaas-acumulo-auditoria-baixa-inerte.ts'), 'utf8');
  assert.match(edge, /Deno\.env\.get\("ASAAS_COB06_BAIXA_AUDITORIA_ADMIN_ENABLED"\) === "true"/);
  assert.match(audit, /uid!==ADMIN_USER_ID/);
  assert.match(audit, /ENVIRONMENT!=="sandbox"\|\|!COB06_GET_ADMIN_READONLY_ON\|\|!COB06_BAIXA_AUDITORIA_ADMIN_ON/);
  assert.match(audit, /"asaas-cob02"/);
  assert.match(audit, /catalogo_asaas_apurar_estados_acumulo_inerte/);
  assert.match(audit, /catalogo_asaas_projetar_baixa_acumulo_inerte/);
  assert.match(audit, /conferirPagamentoAcumuloPorGet/);
  assert.match(audit, /consultarPagamentoAcumuloSandboxGet/);
  assert.doesNotMatch(audit, /catalogo_asaas_quitar_lote_atomico_ci|catalogo_asaas_suspender_lote_atomico_ci|postarPix|\/payments|transferir/);
  assert.match(pure, /pode_emitir_pix: false, pode_quitar: false/);
  assert.match(pure, /pode_estornar: false, pode_liberar_motoboy: false/);
  assert.match(edge, /case "auditar_baixa_multicompetencia_sandbox_admin":return await auditarBaixaMulticompetenciaSandboxAdmin\(user\.id,body\)/);
});
