const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function render(pedido) {
  const elements = new Map();
  const document = { addEventListener() {}, getElementById(id) { if (!elements.has(id)) elements.set(id, { innerHTML: '', hidden: false }); return elements.get(id); } };
  const window = { location: { search: '?id=comercio-de-exemplo' }, CatalogoUtils: { formatarMoeda: (v) => String(v) } };
  let source = fs.readFileSync(path.join(__dirname, '..', 'js', 'catalogo-admin.js'), 'utf8');
  source = source.replace(/\}\)\(\);\s*$/, 'window.__renderPedidos = renderizarPedidosOffline; })();');
  vm.runInNewContext(source, { window, document, URLSearchParams, console });
  window.__renderPedidos([{ id: 'pedido-teste', modalidade: 'retirada', total_centavos: 700, subtotal_produtos_centavos: 700, taxa_plataforma_centavos: 49, taxa_motoboy_centavos: 0, taxa_total_centavos: 49, versao_financeira: 2, ...pedido }]);
  return elements.get('listaPedidosOffline').innerHTML;
}

test('Pix pendente não oferece aceite nem confirmação de código', () => {
  const html = render({ provedor: 'mercadopago', forma_pagamento: 'pix', status: 'aguardando_pagamento', status_pagamento: 'pendente' });
  assert.match(html, /Aguardando pagamento Pix/);
  assert.doesNotMatch(html, /data-offline-next=|data-offline-confirm=/);
  assert.match(html, /data-offline-cancel=/);
});
test('Pix aprovado libera aceite e Pix em preparo libera próximo passo', () => {
  assert.match(render({ provedor: 'mercadopago', forma_pagamento: 'pix', status: 'aguardando_pagamento', status_pagamento: 'aprovado' }), /Aceitar e preparar/);
  assert.match(render({ provedor: 'mercadopago', forma_pagamento: 'pix', status: 'em_preparo', status_pagamento: 'aprovado' }), /Marcar como pronto/);
});
test('Pix cancelado ou estornado não oferece aceite', () => {
  for (const state of ['cancelado', 'estornado', 'contestado']) assert.doesNotMatch(render({ provedor: 'mercadopago', forma_pagamento: 'pix', status: state, status_pagamento: state }), /data-offline-next=|data-offline-confirm=/);
});
test('Dinheiro e cartão pendentes continuam podendo ser aceitos', () => {
  for (const forma_pagamento of ['dinheiro', 'cartao_credito', 'cartao_debito']) assert.match(render({ provedor: 'offline', forma_pagamento, status: 'aguardando_pagamento', status_pagamento: 'pendente' }), /Aceitar e preparar/);
});
test('Retirada v2 não anuncia taxa de motoboy', () => {
  const html = render({ provedor: 'offline', forma_pagamento: 'dinheiro', status: 'aguardando_pagamento', status_pagamento: 'pendente' });
  assert.match(html, /Taxa do pedido: 0\.49/);
  assert.doesNotMatch(html, /2% logística|taxa do motoboy/i);
});
