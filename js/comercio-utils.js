/*
 * Regras compartilhadas de estabelecimentos do Guia Turístico.
 * Executado no navegador como script clássico e exportado para os testes Node.
 */
(function (root) {
  "use strict";

  const CATEGORIAS_HOSPEDAGEM = [
    "aluguel",
    "aluguel por temporada",
    "airbnb",
    "hostel",
    "hotel",
    "hospedagem",
    "pousada",
    "resort",
  ];

  const CATEGORIAS_ALIMENTACAO = [
    "acai",
    "alimentacao",
    "bar",
    "bar e restaurante",
    "buffet",
    "cafe",
    "cafeteria",
    "confeitaria",
    "doceria",
    "hamburgueria",
    "lanchonete",
    "padaria",
    "pastelaria",
    "pizzaria",
    "restaurante",
    "sorveteria",
  ];

  function normalizar(valor) {
    return String(valor ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  }

  function categoriaCombina(categoria, categorias) {
    const valor = normalizar(categoria);
    return categorias.some((item) => {
      const termo = normalizar(item);
      return valor === termo || valor.includes(termo);
    });
  }

  function secaoDoEstabelecimento(estabelecimento) {
    const categoria = estabelecimento?.categoria || "";

    // A categoria, e não o nome comercial, determina a seção pública.
    if (categoriaCombina(categoria, CATEGORIAS_HOSPEDAGEM)) {
      return "hospedagem";
    }

    if (categoriaCombina(categoria, CATEGORIAS_ALIMENTACAO)) {
      return "alimentacao";
    }

    return "comercio";
  }

  function estaAtivo(estabelecimento) {
    return normalizar(estabelecimento?.status) === "ativo";
  }

  function estaEmDestaque(estabelecimento) {
    const valor = estabelecimento?.destaque;
    return valor === true || normalizar(valor) === "true";
  }

  function resumoAvaliacoes(id, avaliacoes) {
    const notas = (Array.isArray(avaliacoes) ? avaliacoes : [])
      .filter((avaliacao) => {
        const idAvaliacao =
          avaliacao?.local_id ??
          avaliacao?.comercio_id ??
          avaliacao?.estabelecimento_id;
        const nota = Number(avaliacao?.nota ?? avaliacao?.rating);
        return String(idAvaliacao ?? "") === String(id) &&
          Number.isFinite(nota) && nota >= 1 && nota <= 5;
      })
      .map((avaliacao) => Number(avaliacao.nota ?? avaliacao.rating));

    return {
      quantidade: notas.length,
      media: notas.length
        ? notas.reduce((soma, nota) => soma + nota, 0) / notas.length
        : null,
    };
  }

  /**
   * Filtra os ativos, mantém os não destacados na ordem original e coloca
   * destaques no início. Entre os destaques usa média bayesiana:
   * (média*n + médiaGlobal*5)/(n+5), com o prior calculado apenas entre
   * destacados, para que reviews dos comuns não alterem nenhuma posição.
   * Desempata por quantidade, média simples e posição original.
   */
  function ordenarComDestaque(estabelecimentos, avaliacoes) {
    const originais = (Array.isArray(estabelecimentos) ? estabelecimentos : [])
      .filter(estaAtivo)
      .map((item, indice) => ({
        item,
        indice,
        destaque: estaEmDestaque(item),
        resumo: resumoAvaliacoes(item.id, avaliacoes),
      }));

    const destaquesOriginais = originais.filter((registro) => registro.destaque);
    const ids = new Set(destaquesOriginais.map(({ item }) => String(item.id)));
    const notasDoGrupo = (Array.isArray(avaliacoes) ? avaliacoes : [])
      .filter((avaliacao) => {
        const id = String(
          avaliacao?.local_id ??
          avaliacao?.comercio_id ??
          avaliacao?.estabelecimento_id ??
          "",
        );
        const nota = Number(avaliacao?.nota ?? avaliacao?.rating);
        return ids.has(id) && Number.isFinite(nota) && nota >= 1 && nota <= 5;
      })
      .map((avaliacao) => Number(avaliacao.nota ?? avaliacao.rating));

    const mediaGlobal = notasDoGrupo.length
      ? notasDoGrupo.reduce((soma, nota) => soma + nota, 0) / notasDoGrupo.length
      : 3;
    const forcaPrior = 5;

    const score = ({ resumo }) =>
      ((resumo.media ?? mediaGlobal) * resumo.quantidade +
        mediaGlobal * forcaPrior) /
      (resumo.quantidade + forcaPrior);

    const destacados = destaquesOriginais
      .sort((a, b) =>
        score(b) - score(a) ||
        b.resumo.quantidade - a.resumo.quantidade ||
        (b.resumo.media ?? 0) - (a.resumo.media ?? 0) ||
        a.indice - b.indice,
      );

    const comuns = originais
      .filter((registro) => !registro.destaque)
      .sort((a, b) => a.indice - b.indice);

    return [...destacados, ...comuns].map(({ item }) => item);
  }

  const api = Object.freeze({
    categoriasAlimentacao: Object.freeze([...CATEGORIAS_ALIMENTACAO]),
    categoriasHospedagem: Object.freeze([...CATEGORIAS_HOSPEDAGEM]),
    normalizar,
    secaoDoEstabelecimento,
    estaAtivo,
    estaEmDestaque,
    resumoAvaliacoes,
    ordenarComDestaque,
  });

  root.AndrelandiaComercioUtils = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
