const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const fn = fs.readFileSync('supabase/functions/catalogo-pedidos-offline-admin/index.ts', 'utf8');
const sql = fs.readFileSync('supabase/migrations/20261005123000_catalogo_pedidos_offline_auditoria.sql', 'utf8');

test('admin offline exige Bearer e verifica proprietário por proprietario_id', () => {
  assert.match(fn, /authorization.*Bearer/i);
  assert.match(fn, /proprietario_id !== userId/);
  assert.match(fn, /Acesso não autorizado/);
});

test('transições do comércio não permitem concluir ou reabrir pedido', () => {
  assert.match(fn, /aguardando_pagamento: \["em_preparo", "cancelado"\]/);
  assert.match(fn, /em_preparo: \["pronto", "cancelado"\]/);
  assert.match(fn, /pronto: \["cancelado"\]/);
  assert.match(fn, /Esta transição não é permitida/);
});

test('confirmação aceita pedido preparado mas continua única', () => {
  assert.match(sql, /NOT IN \('aguardando_pagamento', 'em_preparo', 'pronto'\)/);
  assert.match(sql, /codigo_entrega_usado_em IS NOT NULL/);
  assert.match(sql, /FOR UPDATE/);
});

test('auditoria registra mudanças de status sem código ou token', () => {
  assert.match(sql, /catalogo_pedido_eventos/);
  assert.match(sql, /AFTER UPDATE OF status/);
  assert.match(sql, /ator_tipo, motivo, metadata/);
  assert.doesNotMatch(sql, /codigo_entrega_hash.*catalogo_pedido_eventos/);
});

test('pagamento do fechamento só pode ser conferido pelo administrador', () => {
  assert.match(fn, /Somente o administrador pode conferir pagamentos/);
  assert.match(fn, /status: "pago"/);
  assert.match(fn, /status: "paga"/);
});
