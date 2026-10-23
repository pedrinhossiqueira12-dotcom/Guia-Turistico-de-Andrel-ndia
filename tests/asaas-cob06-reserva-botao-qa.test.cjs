const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const html = readFileSync(join(__dirname, '../pages/asaas-homologacao-sandbox.html'), 'utf8');
const start = html.indexOf('// COB-06: cliente envia uma unica RPC');
const end = html.indexOf('$("qa-cob06-encerramento-submit")', start);
const reserva = html.slice(start, end);

test('COB-06 reserva: botao acessivel so ao admin STAGING e sem Pix', () => {
  assert.ok(start > 0 && end > start);
  assert.match(html, /id="qa-cob06-reserva-sem-pix" hidden/);
  assert.match(html, /\$\("qa-cob06-reserva-sem-pix"\)\.hidden=!u\|\|u\.id!==COB06_QA_REVISOR/);
  assert.match(reserva, /user\?\.user\?\.id!==COB06_QA_REVISOR/);
  assert.match(reserva, /pedrinhossiqueira12@gmail\.com/);
  assert.match(reserva, /functions\/v1\/catalogo-cob06-reserva-qa-sem-pix/);
  assert.match(reserva, /Authorization:"Bearer "\+auth\.session\.access_token/);
  assert.match(reserva, /acao:"reservar_tentativa_qa_sem_pix_admin"/);
  assert.match(reserva, /lote_id:"583d761a-ecb9-49be-b484-e43f6183971e"/);
  assert.doesNotMatch(reserva, /comercio_id:STORE|service_role|\/v3\/payments|\/v3\/transfers|ASAAS_API_KEY/);
});

test('COB-06 reserva: uma unica tentativa, no retry mesmo apos timeout', () => {
  assert.match(reserva, /if\(cob06TentativaQaEnviada\)return/);
  assert.match(reserva, /window\.confirm\(/);
  assert.match(reserva, /window\.prompt\(/);
  assert.match(reserva, /cob06TentativaQaEnviada=true;\s*button\.disabled=true/);
  assert.match(reserva, /response\.ok&&out\.success===true&&out\.nova_tentativa===true/);
  assert.match(reserva, /out\.post_executado===false/);
  assert.match(reserva, /out\.pode_emitir_pix===false/);
  assert.match(reserva, /out\.pode_quitar===false/);
  assert.match(reserva, /out\.pode_liberar_motoboy===false/);
  assert.match(reserva, /out\.hold_obrigatorio===true/);
  assert.match(reserva, /Resposta inconclusiva\. NAO repita/);
  assert.doesNotMatch(reserva.slice(reserva.indexOf('cob06TentativaQaEnviada=true;')), /button\.disabled=false|cob06TentativaQaEnviada=false;/);
});
