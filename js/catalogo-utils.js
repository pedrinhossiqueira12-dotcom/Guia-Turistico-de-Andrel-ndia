(function (global) {
  "use strict";

  const FORMAS_PAGAMENTO = Object.freeze({
    pix: "Pix (combinar com o comércio)",
    dinheiro: "Dinheiro",
    cartao_credito: "Cartão de crédito",
    cartao_debito: "Cartão de débito",
    pagamento_entrega: "Pagamento na entrega",
    pagamento_local: "Pagamento no estabelecimento",
  });

  const MODALIDADES = Object.freeze({
    entrega: "Entrega",
    retirada: "Retirada no local",
    consumo_local: "Consumo no local",
  });

  function formatarMoeda(valor) {
    const numero = Number(valor);
    if (!Number.isFinite(numero)) return "R$ 0,00";
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(numero);
  }

  function normalizarCarrinho(carrinho, produtosPermitidos) {
    if (!carrinho || typeof carrinho !== "object" || Array.isArray(carrinho)) {
      return {};
    }

    const permitidos = produtosPermitidos ? new Set(produtosPermitidos.map(String)) : null;
    const normalizado = {};

    for (const [id, quantidadeBruta] of Object.entries(carrinho)) {
      const quantidade = Math.floor(Number(quantidadeBruta));
      if (!id || (permitidos && !permitidos.has(String(id)))) continue;
      if (!Number.isFinite(quantidade) || quantidade < 1) continue;
      normalizado[String(id)] = Math.min(quantidade, 99);
    }

    return normalizado;
  }

  function atualizarQuantidade(carrinho, produtoId, variacao, produtosPermitidos) {
    const proximo = normalizarCarrinho(carrinho, produtosPermitidos);
    const id = String(produtoId || "");
    if (!id) return proximo;

    const atual = Number(proximo[id] || 0);
    const quantidade = Math.max(0, Math.min(99, atual + Number(variacao || 0)));
    if (quantidade === 0) delete proximo[id];
    else proximo[id] = quantidade;
    return proximo;
  }

  function calcularTotal(itens) {
    const centavos = (Array.isArray(itens) ? itens : []).reduce((soma, item) => {
      const preco = Number(item.preco);
      const quantidade = Math.floor(Number(item.quantidade || item.qtd || 0));
      if (!Number.isFinite(preco) || preco < 0 || !Number.isFinite(quantidade) || quantidade < 1) {
        return soma;
      }
      return soma + Math.round((preco + Number.EPSILON) * 100) * quantidade;
    }, 0);
    return centavos / 100;
  }

  function normalizarTelefoneWhatsApp(numero) {
    let digitos = String(numero || "").replace(/\D/g, "");
    if (digitos.startsWith("00")) digitos = digitos.slice(2);
    if (digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13)) return digitos;
    if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
    throw new Error("O comércio ainda não possui um número de WhatsApp válido cadastrado.");
  }

  function gerarMensagemPedido(pedido) {
    const comercio = pedido?.comercio || {};
    const cliente = pedido?.cliente || {};
    const itens = (Array.isArray(pedido?.itens) ? pedido.itens : [])
      .filter((item) => item && Number(item.quantidade || item.qtd) > 0);

    if (!itens.length) throw new Error("O carrinho está vazio.");
    if (!String(cliente.nome || "").trim()) throw new Error("Informe o nome do cliente.");
    if (!String(cliente.telefone || "").trim()) throw new Error("Informe o telefone do cliente.");

    const modalidade = MODALIDADES[pedido.modalidade] || String(pedido.modalidade || "");
    const pagamento = FORMAS_PAGAMENTO[pedido.pagamento] || String(pedido.pagamento || "");
    const linhasItens = itens.map((item) => {
      const quantidade = Math.floor(Number(item.quantidade || item.qtd));
      const preco = Number(item.preco);
      return `• ${quantidade}× ${String(item.nome || "Produto").trim()} — ${formatarMoeda(calcularTotal([{ preco, quantidade }]))}`;
    });

    const linhas = [
      "Pedido — Guia Turístico de Andrelândia",
      "",
      `Olá! Encontrei ${String(comercio.nome || "este comércio").trim()} pelo Guia Turístico de Andrelândia e gostaria de fazer um pedido.`,
      "",
      "Itens:",
      ...linhasItens,
      "",
      `Total: ${formatarMoeda(calcularTotal(itens))}`,
      "",
      `Cliente: ${String(cliente.nome).trim()}`,
      `Telefone: ${String(cliente.telefone).trim()}`,
      `Modalidade: ${modalidade}`,
    ];

    if (pedido.modalidade === "entrega") {
      const endereco = [
        cliente.endereco,
        cliente.numero ? `nº ${cliente.numero}` : "",
        cliente.complemento,
        cliente.bairro,
        cliente.referencia ? `Referência: ${cliente.referencia}` : "",
        cliente.cidade || "Andrelândia-MG",
      ].filter((parte) => String(parte || "").trim());
      linhas.push("", "Endereço de entrega:", ...endereco.map((parte) => String(parte).trim()));
    }

    linhas.push("", `Pagamento: ${pagamento}`);
    if (String(pedido.observacoes || "").trim()) {
      linhas.push("", `Observações: ${String(pedido.observacoes).trim()}`);
    }
    linhas.push("", "O pagamento será combinado diretamente com o comércio; não foi processado pelo site.");

    return linhas.join("\n");
  }

  function gerarLinkWhatsApp(numero, mensagem) {
    const telefone = normalizarTelefoneWhatsApp(numero);
    return `https://wa.me/${telefone}?text=${encodeURIComponent(String(mensagem || ""))}`;
  }

  const api = Object.freeze({
    FORMAS_PAGAMENTO,
    MODALIDADES,
    formatarMoeda,
    normalizarCarrinho,
    atualizarQuantidade,
    calcularTotal,
    normalizarTelefoneWhatsApp,
    gerarMensagemPedido,
    gerarLinkWhatsApp,
  });

  global.CatalogoUtils = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
