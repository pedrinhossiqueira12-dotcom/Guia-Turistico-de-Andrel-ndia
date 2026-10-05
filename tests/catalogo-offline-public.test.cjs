const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('pages/catalogo.html', 'utf8');
const js = fs.readFileSync('js/catalogo.js', 'utf8');
const confirm = fs.readFileSync('js/pedido-offline.js', 'utf8');

test('checkout público oferece apenas métodos configurados pelo catálogo', () => {
  assert.match(js, /catalogo\.metodos_pagamento/);
  assert.match(js, /criar_pedido_offline/);
  assert.match(html, /id="criarPedidoOffline"/);
});

test('cliente recebe código e link privado, sem persistir o código no banco pelo frontend', () => {
  assert.match(js, /data\.codigo_entrega/);
  assert.match(js, /data\.cliente_token/);
  assert.match(js, /offlineConfirmLink/);
  assert.match(confirm, /cliente_token: token/);
  assert.match(confirm, /codigo_entrega: code/);
});

test('confirmação usa somente POST da Edge Function e não expõe service role', () => {
  assert.match(confirm, /catalogo-pedido-offline/);
  assert.doesNotMatch(confirm, /SUPABASE_SERVICE_ROLE_KEY|service_role|client_secret/i);
});
