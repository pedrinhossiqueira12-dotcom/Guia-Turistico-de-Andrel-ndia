const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('pages/catalogo-admin.html', 'utf8');
const js = fs.readFileSync('js/catalogo-admin.js', 'utf8');
const css = fs.readFileSync('styles/catalogo-admin.css', 'utf8');

test('painel administrativo oferece pedidos offline e extrato sem código visível', () => {
  assert.match(html, /id="pedidosOfflineCard"/);
  assert.match(html, /id="listaPedidosOffline"/);
  assert.match(html, /id="competenciaOffline"/);
  assert.match(js, /catalogo-pedidos-offline-admin/);
  assert.match(js, /acao: "listar_pedidos"/);
  assert.match(js, /acao: "consultar_fechamento"/);
  assert.match(js, /acao: "confirmar_entrega"/);
  assert.doesNotMatch(js, /pedido\.codigo_entrega/);
});

test('interface só expõe transições de preparo e cancelamento permitidas', () => {
  assert.match(js, /data-offline-next/);
  assert.match(js, /data-offline-cancel/);
  assert.match(js, /status === "aguardando_pagamento"/);
  assert.match(js, /status === "em_preparo"/);
  assert.doesNotMatch(js, /status\s*=(?!=)\s*"entregue"|data-offline-status="entregue"/);
});

test('valores da interface usam centavos retornados pelo servidor', () => {
  assert.match(js, /Number\(centavos \|\| 0\) \/ 100/);
  assert.match(js, /taxa_plataforma_centavos/);
  assert.match(css, /offline-orders-card/);
});
