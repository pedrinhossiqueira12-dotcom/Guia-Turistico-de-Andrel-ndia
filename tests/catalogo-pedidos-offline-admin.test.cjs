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

test('transições do comércio são autorizadas e transacionais, sem conclusão pelo seletor', () => {
  assert.match(fn, /em_preparo: "aceitar", pronto: "pronto", cancelado: "solicitar_cancelamento"/);
  assert.match(fn, /catalogo_operar_pedido_v2/);
  assert.match(fn, /p_operador_id: userId/);
  assert.match(fn, /Transição inválida/);
  const inicio = fn.indexOf('async function updateStatus');
  const fim = fn.indexOf('async function confirmDelivery', inicio);
  assert.doesNotMatch(fn.slice(inicio, fim), /\.update\(/);
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

test('referência manual nunca comprova financiamento da fatura ou desbloqueia o comércio', () => {
  assert.match(fn, /Somente o administrador pode conferir pagamentos/);
  assert.match(fn, /A baixa manual por referência foi desativada/);
  assert.doesNotMatch(fn, /status: "pago"|status: "paga"/);
});
