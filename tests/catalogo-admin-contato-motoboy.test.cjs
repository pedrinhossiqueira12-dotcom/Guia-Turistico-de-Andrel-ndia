const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const utils = require('../js/catalogo-utils.js');

function render(overrides = {}, motoboys = []) {
  const elements = new Map();
  const document = { addEventListener() {}, getElementById(id) { if (!elements.has(id)) elements.set(id, { innerHTML: '', hidden: false }); return elements.get(id); } };
  const window = { location: { search: '?id=loja-teste' }, CatalogoUtils: utils };
  let source = fs.readFileSync('js/catalogo-admin.js', 'utf8');
  source = source.replace(/\}\)\(\);\s*$/, 'window.__render = renderizarPedidosOffline; window.__motoboys = v => { entregaState.motoboys = v; }; })();');
  vm.runInNewContext(source, { window, document, URLSearchParams, console });
  window.__motoboys(motoboys);
  window.__render([{ id: 'pedido-teste', modalidade: 'entrega', status: 'em_preparo', provedor: 'offline', forma_pagamento: 'dinheiro', status_pagamento: 'pendente', versao_financeira: 2, aceito_em: '2026-10-07T00:00:00Z', cliente_nome: 'Ana', cliente_telefone: '(32) 99999-1234', total_centavos: 700, subtotal_produtos_centavos: 700, ...overrides }]);
  return elements.get('listaPedidosOffline').innerHTML;
}

test('telefone e links de contato aparecem após o aceite do comércio', () => {
  const html = render();
  assert.match(html, /Telefone do comprador/);
  assert.match(html, /\(32\) 99999-1234/);
  assert.match(html, /href="tel:\+5532999991234"/);
  assert.match(html, /href="https:\/\/wa\.me\/5532999991234/);
});

test('antes do aceite mantém a barreira antifraude mesmo se receber um campo indevido', () => {
  const html = render({ aceito_em: null, status: 'aguardando_pagamento' });
  assert.match(html, /contatos disponíveis após aceitar/);
  assert.doesNotMatch(html, /99999-1234|href="tel:|wa\.me/);
});

test('backend que marca contatos ocultos nunca produz link de contato', () => {
  assert.doesNotMatch(render({ dados_cliente_ocultos: true }), /99999-1234|href="tel:|wa\.me/);
});

test('seleção antes do pronto lembra de disponibilizar sem alegar aceite do motoboy', () => {
  const html = render({ motoboy_preferido_id: 'm1', entrega_status: 'nao_atribuido' }, [{ usuario_id: 'm1', nome: 'João', ativo: true }]);
  assert.match(html, /Motoboy selecionado: João/);
  assert.match(html, /Marque como pronto/);
  assert.doesNotMatch(html, /Motoboy atribuído: João/);
});

test('oferta ao motoboy preferido avisa que o aceite ainda está pendente', () => {
  const html = render({ status: 'pronto', motoboy_preferido_id: 'm1', entrega_status: 'ofertado' }, [{ usuario_id: 'm1', nome: 'João', ativo: true }]);
  assert.match(html, /aguardando o aceite dele/);
  assert.match(html, /data-delivery-state="selecionado"/);
});

test('reserva real mostra responsável atribuído e depois a coleta', () => {
  const data = [{ usuario_id: 'm1', nome: 'João', ativo: true }];
  assert.match(render({ motoboy_id: 'm1', entrega_status: 'reservado' }, data), /Motoboy atribuído: João/);
  assert.match(render({ motoboy_id: 'm1', entrega_status: 'coletado' }, data), /Pedido coletado pelo motoboy/);
});

test('retirada não inventa entregador ou remuneração', () => {
  assert.doesNotMatch(render({ modalidade: 'retirada' }), /data-delivery-state=/);
});

test('telefone e nome do motoboy maliciosos não injetam HTML ou protocolo executável', () => {
  const html = render({ cliente_telefone: '<img src=x onerror=alert(1)>', motoboy_id: 'm1' }, [{ usuario_id: 'm1', nome: '<script>alert(1)</script>', ativo: true }]);
  assert.doesNotMatch(html, /<script>|<img src=x|href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
});
