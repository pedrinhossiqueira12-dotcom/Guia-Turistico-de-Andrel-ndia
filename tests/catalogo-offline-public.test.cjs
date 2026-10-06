const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('pages/catalogo.html', 'utf8');
const js = fs.readFileSync('js/catalogo.js', 'utf8');
const confirm = fs.readFileSync('js/pedido-offline.js', 'utf8');
const legacyHtml = fs.readFileSync('pages/pedido-offline.html', 'utf8');

test('checkout público oferece apenas métodos configurados pelo catálogo', () => {
  assert.match(js, /catalogo\.metodos_pagamento/);
  assert.match(js, /criar_pedido_offline/);
  assert.match(html, /id="criarPedidoOffline"/);
});

test('cliente recebe e conserva código, sem link que autorize confirmação', () => {
  assert.match(js, /data\.codigo_entrega/);
  assert.match(js, /localStorage\.setItem\(chavePedidoOfflineSalvo\(\)/);
  assert.match(js, /localStorage\.getItem\(chavePedidoOfflineSalvo\(\)/);
  assert.match(html, /id="abrirPedidoOfflineSalvo"/);
  assert.match(html, /id="copiarCodigoOffline"/);
  assert.doesNotMatch(js, /offlineConfirmLink|pedido-offline\.html\?token/);
  assert.doesNotMatch(html, /offlineConfirmLink/);
});

test('página antiga apenas orienta e não acessa qualquer endpoint de confirmação', () => {
  assert.doesNotMatch(confirm, /functions\.invoke|createClient|codigo_entrega:|cliente_token:/);
  assert.doesNotMatch(legacyHtml, /id="confirmarEntregaForm"/);
  assert.match(confirm, /painel autenticado/);
  assert.doesNotMatch(confirm, /SUPABASE_SERVICE_ROLE_KEY|service_role|client_secret/i);
});
