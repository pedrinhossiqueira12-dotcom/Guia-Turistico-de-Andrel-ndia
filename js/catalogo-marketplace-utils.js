(function (global) {
  "use strict";

  const TAXA_PLATAFORMA_BPS = 500; // 5,00%, em basis points.

  function inteiroCentavos(valor, nome = "valor") {
    const numero = Number(valor);
    if (!Number.isSafeInteger(numero) || numero < 0) {
      throw new Error(`${nome} deve ser um número inteiro de centavos não negativo.`);
    }
    return numero;
  }

  function calcularTaxaPlataforma(subtotalProdutosCentavos) {
    const subtotal = inteiroCentavos(subtotalProdutosCentavos, "subtotal dos produtos");
    if (subtotal === 0) return 0;
    return Math.round((subtotal * TAXA_PLATAFORMA_BPS) / 10000);
  }

  function calcularResumoPedido({ subtotalProdutosCentavos, entregaCentavos = 0, tarifaProvedorCentavos = null }) {
    const subtotal = inteiroCentavos(subtotalProdutosCentavos, "subtotal dos produtos");
    if (subtotal < 1) throw new Error("O pedido deve conter pelo menos R$ 0,01 em produtos.");
    const entrega = inteiroCentavos(entregaCentavos, "valor da entrega");
    const tarifa = tarifaProvedorCentavos === null || tarifaProvedorCentavos === undefined
      ? null
      : inteiroCentavos(tarifaProvedorCentavos, "tarifa do provedor");
    const taxaPlataforma = calcularTaxaPlataforma(subtotal);
    const total = subtotal + entrega;
    const repasseBruto = subtotal - taxaPlataforma + entrega;
    return Object.freeze({
      subtotal_produtos_centavos: subtotal,
      entrega_centavos: entrega,
      total_centavos: total,
      taxa_plataforma_centavos: taxaPlataforma,
      tarifa_provedor_centavos: tarifa,
      repasse_bruto_comercio_centavos: repasseBruto,
      repasse_liquido_comercio_centavos: tarifa === null ? null : Math.max(0, repasseBruto - tarifa),
      taxa_plataforma_bps: TAXA_PLATAFORMA_BPS,
    });
  }

  function validarItens(itens) {
    if (!Array.isArray(itens) || !itens.length) throw new Error("O pedido não possui itens.");
    return itens.map((item, indice) => {
      const produtoId = String(item?.produto_id || item?.id || "").trim();
      const nome = String(item?.nome || item?.nome_produto || "").trim();
      const preco = inteiroCentavos(item?.preco_unitario_centavos ?? item?.preco_centavos, `preço do item ${indice + 1}`);
      const quantidade = Number(item?.quantidade || 0);
      if (!produtoId || !nome) throw new Error(`O item ${indice + 1} é inválido.`);
      if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 99) throw new Error(`A quantidade do item ${indice + 1} é inválida.`);
      return Object.freeze({
        produto_id: produtoId,
        nome_produto: nome.slice(0, 120),
        descricao_produto: String(item?.descricao || item?.descricao_produto || "").slice(0, 600),
        preco_unitario_centavos: preco,
        quantidade,
        total_item_centavos: preco * quantidade,
      });
    });
  }

  const api = Object.freeze({ TAXA_PLATAFORMA_BPS, calcularTaxaPlataforma, calcularResumoPedido, validarItens });
  global.CatalogoMarketplaceUtils = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
