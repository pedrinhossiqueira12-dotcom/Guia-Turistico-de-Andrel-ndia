const test = require("node:test");
const assert = require("node:assert/strict");
const utils = require("../js/catalogo-utils.js");

test("normaliza carrinho, descarta ids inválidos e limita quantidades", () => {
  assert.deepEqual(utils.normalizarCarrinho({ a: "2.8", b: -1, c: 100, d: 2 }, ["a", "c"]), { a: 2, c: 99 });
});

test("aumenta, diminui e remove quantidades do carrinho", () => {
  assert.deepEqual(utils.atualizarQuantidade({ x: 1 }, "x", 2), { x: 3 });
  assert.deepEqual(utils.atualizarQuantidade({ x: 1 }, "y", 1), { x: 1, y: 1 });
  assert.deepEqual(utils.atualizarQuantidade({ x: 1 }, "x", -1), {});
});

test("calcula valores e formata reais em pt-BR", () => {
  assert.equal(utils.calcularTotal([{ preco: 25, quantidade: 2 }, { preco: 6, qtd: 1 }]), 56);
  assert.equal(utils.calcularTotal([{ preco: 0.1, quantidade: 3 }, { preco: 0.2, quantidade: 1 }]), 0.5);
  assert.match(utils.formatarMoeda(25), /^R\$[ \u00a0]25,00$/);
});

test("normaliza telefone brasileiro e recusa número incompleto", () => {
  assert.equal(utils.normalizarTelefoneWhatsApp("(32) 98456-1234"), "5532984561234");
  assert.equal(utils.normalizarTelefoneWhatsApp("55 32 3333-1212"), "553233331212");
  assert.throws(() => utils.normalizarTelefoneWhatsApp("123"), /WhatsApp válido/);
});

test("monta mensagem completa sem registrar pedido e exige endereço só para entrega", () => {
  const mensagem = utils.gerarMensagemPedido({
    comercio: { nome: "Vagão Lanches" },
    itens: [{ nome: "X-Bacon", preco: 25, quantidade: 2 }, { nome: "Coca-Cola", preco: 6, quantidade: 1 }],
    cliente: { nome: "João", telefone: "32 99999-1234", endereco: "Rua Exemplo", numero: "100", bairro: "Centro", cidade: "Andrelândia-MG" },
    modalidade: "entrega",
    pagamento: "pix",
    observacoes: "Sem cebola.",
  });
  assert.match(mensagem, /Pedido — Guia Turístico de Andrelândia/);
  assert.match(mensagem, /2× X-Bacon — R\$[ \u00a0]50,00/);
  assert.match(mensagem, /Total: R\$[ \u00a0]56,00/);
  assert.match(mensagem, /Rua Exemplo/);
  assert.match(mensagem, /Sem cebola/);
  assert.match(mensagem, /não foi processado pelo site/);

  const retirada = utils.gerarMensagemPedido({
    comercio: { nome: "Loja" },
    itens: [{ nome: "Item", preco: 10, quantidade: 1 }],
    cliente: { nome: "Ana", telefone: "32999991234" },
    modalidade: "retirada",
    pagamento: "dinheiro",
  });
  assert.doesNotMatch(retirada, /Endereço de entrega/);
});

test("codifica a mensagem do WhatsApp corretamente", () => {
  const link = utils.gerarLinkWhatsApp("32 98456-1234", "Olá & pedido");
  assert.equal(link, "https://wa.me/5532984561234?text=Ol%C3%A1%20%26%20pedido");
});
