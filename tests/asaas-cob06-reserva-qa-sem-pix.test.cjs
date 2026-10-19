const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root,
  'supabase/functions/catalogo-cob06-reserva-qa-sem-pix/index.ts'), 'utf8');
const mock = fs.readFileSync(path.join(root,
  'supabase/functions/tests/catalogo-cob06-reserva-qa-sem-pix-http-mock.test.ts'), 'utf8');
const config = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
const audit = fs.readFileSync(path.join(root,
  'supabase/functions/catalogo-asaas-cob06-auditoria/index.ts'), 'utf8');

test('COB06: a nova funcao e separada da auditoria GET e exige JWT do gateway', () => {
  assert.match(config, /\[functions\.catalogo-cob06-reserva-qa-sem-pix\]\s*verify_jwt = true/);
  assert.match(source, /ASAAS_COB06_GATE_RESERVA_QA_ENABLED/);
  assert.match(source, /RESERVA_ATIVA = .* === "true"/);
  assert.match(source, /URL_SUPABASE !== STAGING_URL/);
  assert.match(source, /db\.auth\.getUser\(/);
  assert.match(source, /identidade\.user\.id !== ADMIN_STAGING/);
  assert.match(source, /entrada\.lote_id !== QA_LOTE/);
  assert.match(audit, /const somenteLeitura = entrada\.acao ===/);
  assert.doesNotMatch(audit, /reservar_tentativa_qa_sem_pix/);
});

test('COB06: rota de reserva sem transporte Asaas, escrita de baixa ou saque', () => {
  assert.match(source, /db\.rpc\("catalogo_asaas_reservar_tentativa_qa_sem_pix"/);
  assert.doesNotMatch(source, /ASAAS_API_KEY|access_token|api-sandbox\.asaas|\/v3\/payments|\/v3\/transfers/);
  assert.doesNotMatch(source, /catalogo_asaas_(?:quitar|registrar_observacao|autorizar_post)/);
  assert.match(source, /data\.pode_emitir_pix !== false/);
  assert.match(source, /data\.pode_quitar !== false/);
  assert.match(source, /data\.pode_liberar_motoboy !== false/);
  assert.match(source, /data\.post_executado !== false/);
  assert.match(source, /data\.autorizacao_externa !== false/);
  assert.match(source, /hold_obrigatorio: true/);
  assert.match(mock, /REDE_NAO_PERMITIDA/);
  assert.match(mock, /INTRUSO/);
  assert.match(mock, /tentativa_ja_reservada/);
  assert.match(mock, /insegura/);
});
