const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const edge=fs.readFileSync(path.join(__dirname,'..','supabase','functions',
  'catalogo-asaas-financeiro','index.ts'),'utf8');
const inicio=edge.indexOf('async function retomarPreparacaoAcumuloSandboxAdmin(');
const fim=edge.indexOf('// Verifica a referencia de um lote QA',inicio);
const recuperar=edge.slice(inicio,fim);
const modulo=fs.readFileSync(path.join(__dirname,'..','supabase','functions',
  '_shared','catalogo-asaas-acumulo-retomada-inerte.ts'),'utf8');

test('COB-06 retomada: apenas admin, Sandbox, flag OFF e comercio QA',()=>{
  assert.ok(inicio>=0&&fim>inicio);
  assert.match(recuperar,/uid!==ADMIN_USER_ID/);
  assert.match(recuperar,/ENVIRONMENT!=="sandbox"\|\|!COB06_PREPARACAO_ADMIN_ON/);
  assert.match(recuperar,/body\.comercio_id!=="asaas-cob02"/);
  assert.match(edge,/case "retomar_preparacao_acumulo_sandbox_admin":return await retomarPreparacaoAcumuloSandboxAdmin\(user\.id,body\)/);
});

test('COB-06 retomada: encontra apenas o lote existente e revalida antes da referencia',()=>{
  assert.match(recuperar,/\.from\("catalogo_asaas_acumulo_lotes"\)/);
  assert.match(recuperar,/\.eq\("comercio_id","asaas-cob02"\)\.eq\("competencia_corte",corte\)\.maybeSingle\(\)/);
  assert.match(recuperar,/if\(error\|\|!lote\)/);
  assert.match(recuperar,/catalogo_asaas_conferir_conciliacao_acumulo/);
  assert.match(recuperar,/catalogo_asaas_reservar_referencia_acumulo/);
  assert.doesNotMatch(recuperar,/catalogo_asaas_reservar_acumulo|catalogo_asaas_previsualizar_acumulo/);
  assert.match(modulo,/origens\.length >= 2/);
  assert.match(modulo,/competencias\.size >= 2 && algumaAbaixoDoMinimo && soma === total/);
});

test('COB-06 retomada: sem rede bancaria, POST, baixas ou saques',()=>{
  assert.doesNotMatch(recuperar+modulo,/fetch\(|API_BASE|postarPix\(|\/payments|transferirSaque\(/);
  assert.match(modulo,/recuperacao_de_lote_existente: true, pix_emitido: false/);
  assert.match(modulo,/pode_emitir_pix: false, pode_quitar: false, pode_estornar: false/);
  assert.match(modulo,/pode_liberar_motoboy: false, hold_obrigatorio: true/);
});
