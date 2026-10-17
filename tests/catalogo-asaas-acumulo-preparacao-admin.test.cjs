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
