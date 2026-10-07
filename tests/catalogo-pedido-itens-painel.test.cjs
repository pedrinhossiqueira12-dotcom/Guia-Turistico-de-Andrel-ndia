const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const utils = require('../js/catalogo-utils.js');
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const ADMIN = '4b9a0233-6b72-4573-aebd-d596c5b15e1b';
const ITEM = { id: 'item-a', produto_id: null, nome_produto: 'Lanche comprado', descricao_produto: 'Pão e queijo', quantidade: 2, preco_unitario_centavos: 800, total_item_centavos: 1600 };
const ORDER = { id: '22222222-2222-4222-8222-222222222222', comercio_id: 'loja-teste', referencia_externa: 'pedido-original', versao_financeira: 2, aceito_em: null, modalidade: 'entrega', provedor: 'offline', forma_pagamento: 'dinheiro', status: 'aguardando_pagamento', status_pagamento: 'pendente', cliente_nome: 'Pessoa privada', cliente_telefone: '32999998888', cliente_endereco: 'Rua privada', cliente_bairro: 'Centro', observacoes: 'Sem cebola. Ligue 32999998888', total_centavos: 1600, subtotal_produtos_centavos: 1600, itens: [ITEM], codigo_entrega: 'nao-revelar', cliente_token_hash: 'nao-revelar-token' };

async function endpoint(options = {}) {
  const orders = options.orders || [ORDER, { ...ORDER, id: 'pedido-de-outra-loja', comercio_id: 'outra-loja', itens: [{ ...ITEM, nome_produto: 'Item privado de outra loja' }] }];
  const calls = [];
  let handler;
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: options.actor || OWNER } }, error: null }) },
    from(table) {
      calls.push(table);
      const filters = []; let fields = '';
      const q = {
        select(value) { fields = value; return q; },
        eq(field, value) { filters.push([field, value]); return q; },
        in() { return q; }, order() { return q; },
        async maybeSingle() {
          assert.equal(table, 'catalogos');
          return { data: { proprietario_id: filters.find(([key]) => key === 'comercio_id')?.[1] === 'loja-teste' ? OWNER : OTHER, bloqueado: false }, error: null };
        },
        async limit(max) {
          if (table === 'catalogo_entregas_atribuidas') return { data: [], error: null };
          assert.equal(table, 'catalogo_pedidos'); assert.equal(max, 100);
          if (options.lookupError) return { data: null, error: { code: 'XX000', message: 'Detalhe privado do banco' } };
          const relation = fields.match(/itens:catalogo_pedido_itens\(([^)]+)\)/);
          assert.ok(relation, 'A consulta precisa carregar o snapshot dos itens');
          const itemFields = relation[1].split(',');
          assert.deepEqual(itemFields, ['id', 'produto_id', 'nome_produto', 'descricao_produto', 'preco_unitario_centavos', 'quantidade', 'total_item_centavos']);
          const rootFields = fields.split(',itens:')[0].split(',');
          const data = orders.filter(row => filters.every(([field, value]) => row[field] === value)).slice(0, max).map(row => ({
            ...Object.fromEntries(rootFields.map(field => [field, row[field]])),
            itens: Array.isArray(row.itens) ? row.itens.map(item => Object.fromEntries(itemFields.map(field => [field, item[field]]))) : null,
          }));
          return { data, error: null };
        },
      };
      return q;
    },
  };
  const source = fs.readFileSync('supabase/functions/catalogo-pedidos-offline-admin/index.ts', 'utf8').replace(/^import .*\n/gm, '');
  vm.runInNewContext(stripTypeScriptTypes(source), { createClient: () => db, Deno: { env: { get: () => '' }, serve: fn => { handler = fn; } }, Request, Response, TextEncoder, Date, Intl, console: { error() {} } });
  const headers = { 'Content-Type': 'application/json' };
  if (!options.noSession) headers.authorization = 'Bearer validated-session';
  const response = await handler(new Request('https://example.test/function', { method: 'POST', headers, body: JSON.stringify({ acao: 'listar_pedidos', comercio_id: options.comercio || 'loja-teste', admin: true, user_id: ADMIN }) }));
  return { status: response.status, body: await response.json(), calls };
}

function render(order = {}) {
  const elements = new Map();
  const document = { addEventListener() {}, getElementById(id) { if (!elements.has(id)) elements.set(id, { innerHTML: '', hidden: false }); return elements.get(id); } };
  const window = { location: { search: '?id=loja-teste' }, CatalogoUtils: utils };
  const source = fs.readFileSync('js/catalogo-admin.js', 'utf8').replace(/\}\)\(\);\s*$/, 'window.__render = renderizarPedidosOffline; })();');
  vm.runInNewContext(source, { window, document, URLSearchParams, console });
  window.__render([{ ...ORDER, ...order }]);
  return elements.get('listaPedidosOffline').innerHTML;
}

test('o comércio consulta os itens antes do aceite sem receber contato, código ou token do comprador', async () => {
  const result = await endpoint();
  assert.equal(result.status, 200); assert.equal(result.body.pedidos.length, 1);
  const order = result.body.pedidos[0];
  assert.deepEqual(order.itens, [ITEM]); assert.equal(order.cliente_telefone, null); assert.equal(order.observacoes, null);
  assert.equal(order.dados_cliente_ocultos, true);
  assert.doesNotMatch(JSON.stringify(result.body), /32999998888|Rua privada|nao-revelar|Item privado de outra loja/);
});

test('itens Pix ficam disponíveis tanto pendentes quanto aprovados, sem alterar o pagamento', async () => {
  for (const state of ['pendente', 'aprovado']) {
    const result = await endpoint({ orders: [{ ...ORDER, forma_pagamento: 'pix', provedor: 'mercadopago', status_pagamento: state }] });
    assert.equal(result.status, 200); assert.deepEqual(result.body.pedidos[0].itens, [ITEM]);
    assert.equal(result.body.pedidos[0].status_pagamento, state);
    assert.equal(result.calls.includes('catalogo_produtos'), false);
  }
});

test('depois do aceite conserva itens e libera observações e contato ao proprietário', async () => {
  const result = await endpoint({ orders: [{ ...ORDER, aceito_em: '2026-10-07T00:00:00Z' }] });
  assert.equal(result.body.pedidos[0].cliente_telefone, ORDER.cliente_telefone);
  assert.equal(result.body.pedidos[0].observacoes, ORDER.observacoes);
  assert.deepEqual(result.body.pedidos[0].itens, [ITEM]);
});

test('snapshot preserva nome e preço mesmo quando o produto não existe mais', async () => {
  const result = await endpoint();
  assert.equal(result.body.pedidos[0].itens[0].produto_id, null);
  assert.equal(result.body.pedidos[0].itens[0].nome_produto, 'Lanche comprado');
  assert.equal(result.body.pedidos[0].itens[0].preco_unitario_centavos, 800);
  assert.equal(result.calls.includes('catalogo_produtos'), false);
});

test('não retorna os pedidos nem itens de outro comércio, mesmo com admin forjado no body', async () => {
  const result = await endpoint({ comercio: 'outra-loja' });
  assert.equal(result.status, 403); assert.equal(result.calls.includes('catalogo_pedidos'), false);
});

test('uma conta sem vínculo não consulta itens do comércio', async () => {
  const result = await endpoint({ actor: OTHER });
  assert.equal(result.status, 403); assert.equal(result.calls.includes('catalogo_pedidos'), false);
});

test('sem sessão a consulta permanece bloqueada antes de ler qualquer tabela', async () => {
  const result = await endpoint({ noSession: true });
  assert.equal(result.status, 401); assert.equal(result.calls.length, 0);
});

test('falha na consulta não produz pedido com itens parciais nem revela o erro interno', async () => {
  const result = await endpoint({ lookupError: true });
  assert.equal(result.status, 500); assert.equal(result.body.pedidos, undefined);
  assert.doesNotMatch(JSON.stringify(result.body), /Detalhe privado/);
});

test('card exibe produto, quantidade, preço unitário e total antes do aceite', () => {
  const html = render();
  assert.match(html, /<details class="order-items" open>/);
  assert.match(html, /2 × Lanche comprado/); assert.match(html, /Pão e queijo/);
  assert.match(html, /R\$\s*8,00 cada/); assert.match(html, /R\$\s*16,00/);
  assert.doesNotMatch(html, /Sem cebola|32999998888/);
  assert.match(html, /Aceitar e preparar/);
});

test('observações de preparo aparecem após aceite e são protegidas contra HTML malicioso', () => {
  const html = render({ aceito_em: '2026-10-07T00:00:00Z', observacoes: 'Sem cebola <script>alert(1)</script>' });
  assert.match(html, /Observações do comprador/); assert.match(html, /Sem cebola &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('nomes e descrições dos itens nunca injetam HTML no painel', () => {
  const html = render({ itens: [{ ...ITEM, nome_produto: '<img src=x onerror=alert(1)>', descricao_produto: '<svg onload=alert(2)>' }] });
  assert.match(html, /&lt;img/); assert.match(html, /&lt;svg/);
  assert.doesNotMatch(html, /<img src=x|<svg onload/);
});

test('pedido legado sem snapshot recebe aviso explícito, sem inventar produtos ou preços', () => {
  for (const itens of [null, undefined, []]) {
    const html = render({ itens, versao_financeira: 1 });
    assert.match(html, /Detalhes dos itens indisponíveis/); assert.match(html, /Não prepare apenas pelo valor total/);
    assert.doesNotMatch(html, /2 × Lanche comprado/);
  }
});

test('uma resposta antiga com contato oculto nunca revela observações no card', () => {
  assert.doesNotMatch(render({ aceito_em: '2026-10-07T00:00:00Z', dados_cliente_ocultos: true }), /Sem cebola|32999998888/);
});
