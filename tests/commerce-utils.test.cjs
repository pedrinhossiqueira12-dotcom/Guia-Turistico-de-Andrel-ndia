const test = require("node:test");
const assert = require("node:assert/strict");
const utils = require("../js/comercio-utils.js");

test("classifica categorias de hospedagem em uma única seção", () => {
  for (const categoria of ["Hotel", "Pousada", "Aluguel", "Hotel/Pousada", "Hostel"]) {
    assert.equal(utils.secaoDoEstabelecimento({ categoria }), "hospedagem");
  }
});

test("classifica categorias de alimentação sem usar o nome do local", () => {
  assert.equal(utils.secaoDoEstabelecimento({ categoria: "Restaurante", nome: "Loja" }), "alimentacao");
  assert.equal(utils.secaoDoEstabelecimento({ categoria: "Padaria" }), "alimentacao");
  assert.equal(utils.secaoDoEstabelecimento({ categoria: "Bar" }), "alimentacao");
  assert.equal(utils.secaoDoEstabelecimento({ categoria: "Mercado", nome: "Restaurante" }), "comercio");
});

test("só status ativo passa pelo filtro público", () => {
  assert.equal(utils.estaAtivo({ status: "ativo" }), true);
  assert.equal(utils.estaAtivo({ status: "deletado" }), false);
  assert.equal(utils.estaAtivo({ status: "pendente" }), false);
  assert.equal(utils.estaAtivo({}), false);
});

test("destaques vêm antes, volume desempata avaliações equivalentes e comuns preservam ordem", () => {
  const estabelecimentos = [
    { id: "normal-1", nome: "A", status: "ativo", destaque: false },
    { id: "dest-5", nome: "B", status: "ativo", destaque: true },
    { id: "dest-200", nome: "C", status: "ativo", destaque: true },
    { id: "deletado", nome: "D", status: "deletado", destaque: true },
    { id: "normal-2", nome: "E", status: "ativo", destaque: false },
  ];
  const avaliacoes = [
    ...Array.from({ length: 2 }, () => ({ local_id: "dest-5", nota: 5 })),
    ...Array.from({ length: 200 }, () => ({ local_id: "dest-200", nota: 5 })),
    { local_id: "normal-1", nota: 1 },
    ...Array.from({ length: 50 }, () => ({ local_id: "normal-2", nota: 5 })),
  ];

  const resultado = utils.ordenarComDestaque(estabelecimentos, avaliacoes);
  assert.deepEqual(resultado.map((item) => item.id), [
    "dest-200",
    "dest-5",
    "normal-1",
    "normal-2",
  ]);
});

test("não permite que registros sem avaliação sejam promovidos acima de avaliados", () => {
  const items = [
    { id: "sem", status: "ativo", destaque: true },
    { id: "com", status: "ativo", destaque: true },
  ];
  const reviews = [
    { local_id: "com", nota: 4 },
    { local_id: "com", nota: 4 },
    { local_id: "com", nota: 4 },
  ];
  assert.deepEqual(
    utils.ordenarComDestaque(items, reviews).map((item) => item.id),
    ["com", "sem"],
  );
});


test("avaliações de não destacados não alteram a ordem dos destacados", () => {
  const items = [
    { id: "normal", status: "ativo", destaque: false },
    { id: "highlight-a", status: "ativo", destaque: true },
    { id: "highlight-b", status: "ativo", destaque: true },
  ];
  const reviews = [
    ...Array.from({ length: 20 }, () => ({ local_id: "highlight-a", nota: 4 })),
    ...Array.from({ length: 2 }, () => ({ local_id: "highlight-b", nota: 4.5 })),
  ];
  const antes = utils.ordenarComDestaque(items, reviews).map((item) => item.id);
  const comNotasNormais = [
    ...reviews,
    ...Array.from({ length: 1000 }, () => ({ local_id: "normal", nota: 1 })),
  ];
  const depois = utils.ordenarComDestaque(items, comNotasNormais).map((item) => item.id);
  assert.deepEqual(antes, ["highlight-b", "highlight-a", "normal"]);
  assert.deepEqual(depois, antes);
});
