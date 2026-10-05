const test = require("node:test");
const assert = require("node:assert/strict");
const utils = require("../js/catalogo-marketplace-utils.js");

test("calcula 5% somente sobre produtos e mantém entrega fora da comissão", () => {
  assert.deepEqual(utils.calcularResumoPedido({
    subtotalProdutosCentavos: 10000,
    entregaCentavos: 1000,
  }), {
    subtotal_produtos_centavos: 10000,
    entrega_centavos: 1000,
    total_centavos: 11000,
    taxa_plataforma_centavos: 500,
    tarifa_provedor_centavos: null,
    repasse_bruto_comercio_centavos: 10500,
    repasse_liquido_comercio_centavos: null,
    taxa_plataforma_bps: 500,
  });
});

test("arredonda a comissão em centavos e permite registrar tarifa do provedor", () => {
  const resumo = utils.calcularResumoPedido({
    subtotalProdutosCentavos: 999,
    entregaCentavos: 0,
    tarifaProvedorCentavos: 120,
  });
  assert.equal(resumo.taxa_plataforma_centavos, 50);
  assert.equal(resumo.repasse_bruto_comercio_centavos, 949);
  assert.equal(resumo.repasse_liquido_comercio_centavos, 829);
});

test("recusa subtotal inválido, entrega negativa e valores não inteiros", () => {
  assert.throws(() => utils.calcularResumoPedido({ subtotalProdutosCentavos: 0 }), /pelo menos/);
  assert.throws(() => utils.calcularResumoPedido({ subtotalProdutosCentavos: 100, entregaCentavos: -1 }), /entrega/);
  assert.throws(() => utils.calcularResumoPedido({ subtotalProdutosCentavos: 100.5 }), /inteiro/);
});

test("valida e congela o snapshot dos itens do pedido", () => {
  const itens = utils.validarItens([{ id: "p1", nome: "X-Burger", preco_unitario_centavos: 2500, quantidade: 2 }]);
  assert.deepEqual(itens[0], {
    produto_id: "p1",
    nome_produto: "X-Burger",
    descricao_produto: "",
    preco_unitario_centavos: 2500,
    quantidade: 2,
    total_item_centavos: 5000,
  });
  assert.equal(Object.isFrozen(itens[0]), true);
  assert.throws(() => utils.validarItens([{ id: "p1", nome: "X", preco_unitario_centavos: 100, quantidade: 100 }]), /quantidade/);
});
