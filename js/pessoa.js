let pessoaAtual = null;


/* =========================================================
   INICIALIZAÇÃO
========================================================= */

document.addEventListener("DOMContentLoaded", carregarPessoa);


/* =========================================================
   CONVERTER CAMINHO DAS IMAGENS
========================================================= */

function corrigirCaminhoImagem(caminho) {

  if (!caminho) {
    return "";
  }

  /*
   * Se já for um caminho absoluto ou URL,
   * não altera.
   */

  if (
    caminho.startsWith("http://") ||
    caminho.startsWith("https://") ||
    caminho.startsWith("/")
  ) {

    return caminho;

  }


  /*
   * O JSON usa:
   *
   * ./img/pessoas/arquivo.jpeg
   *
   * A página está em:
   *
   * /PAGES/pessoa.html
   *
   * Então precisamos subir um nível.
   */

  if (caminho.startsWith("./")) {

    return "../" + caminho.substring(2);

  }


  return "../" + caminho;

}


/* =========================================================
   CARREGAR PESSOA
========================================================= */

async function carregarPessoa() {

  const params =
    new URLSearchParams(window.location.search);

  const id = params.get("id");


  if (!id) {

    mostrarErro("Pessoa não encontrada.");

    return;

  }


  try {

    const resposta =
      await fetch("../DATA/pessoas.json");


    if (!resposta.ok) {

      throw new Error(
        "Não foi possível carregar pessoas.json."
      );

    }


    const pessoas =
      await resposta.json();


    pessoaAtual =
      pessoas.find(
        pessoa => pessoa.id === id
      );


    if (!pessoaAtual) {

      mostrarErro("Pessoa não encontrada.");

      return;

    }


    preencherPagina(pessoaAtual);

  }

  catch (erro) {

    console.error(erro);

    mostrarErro(
      "Não foi possível carregar as informações."
    );

  }

}


/* =========================================================
   PREENCHER PÁGINA
========================================================= */

function preencherPagina(pessoa) {

  const nome =
    pessoa.nome || "Pessoa";

  const categoria =
    pessoa.categoria || "Pessoa";


  document.title =
    `${nome} — Guia Turístico de Andrelândia`;


  /* CABEÇALHO */

  document.getElementById(
    "categoriaPessoa"
  ).textContent = categoria;


  document.getElementById(
    "nomePessoa"
  ).textContent = nome;


  /* INTRODUÇÃO */

  document.getElementById(
    "categoriaPessoaTexto"
  ).textContent = categoria;


  document.getElementById(
    "tituloPessoa"
  ).textContent = nome;


  document.getElementById(
    "descricaoPessoa"
  ).textContent =
    pessoa.descricao || "";


  /* SOBRE */

  document.getElementById(
    "sobrePessoa"
  ).textContent =
    pessoa.sobre ||
    pessoa.descricao ||
    "";


  /* FOTO PRINCIPAL */

  const foto =
    document.getElementById(
      "fotoPessoa"
    );


  const caminhoCapa =
    corrigirCaminhoImagem(
      pessoa.capa
    );


  foto.src =
    caminhoCapa;


  foto.alt =
    nome;


  /* INSTAGRAM */

  configurarInstagram(pessoa);


  /* GALERIA */

  montarGaleria(pessoa);

}


/* =========================================================
   INSTAGRAM
========================================================= */

function configurarInstagram(pessoa) {

  const botao =
    document.getElementById(
      "instagramPessoa"
    );


  if (
    !pessoa.instagram ||
    pessoa.instagram === "#"
  ) {

    botao.style.display = "none";

    return;

  }


  botao.href =
    pessoa.instagram;

}


/* =========================================================
   GALERIA
========================================================= */

function montarGaleria(pessoa) {

  const galeria =
    document.getElementById(
      "galeriaPessoa"
    );


  galeria.innerHTML = "";


  let fotos =
    Array.isArray(pessoa.galeria)
      ? [...pessoa.galeria]
      : [];


  /*
   * Se não houver galeria,
   * usa a capa.
   */

  if (
    fotos.length === 0 &&
    pessoa.capa
  ) {

    fotos.push(pessoa.capa);

  }


  fotos.forEach(
    (foto, index) => {

      if (!foto) {
        return;
      }


      const caminho =
        corrigirCaminhoImagem(foto);


      const item =
        document.createElement(
          "button"
        );


      item.type = "button";

      item.className =
        "galeria-item";


      item.setAttribute(
        "aria-label",
        `Abrir foto ${index + 1}`
      );


      const img =
        document.createElement(
          "img"
        );


      img.src =
        caminho;


      img.alt =
        `${pessoa.nome || "Pessoa"} — foto ${index + 1}`;


      img.loading =
        index === 0
          ? "eager"
          : "lazy";


      item.appendChild(img);


      item.addEventListener(
        "click",
        () => abrirFoto(caminho)
      );


      galeria.appendChild(item);

    }
  );

}


/* =========================================================
   ABRIR FOTO
========================================================= */

function abrirFoto(foto) {

  const viewer =
    document.getElementById(
      "photoViewer"
    );


  const image =
    document.getElementById(
      "viewerImage"
    );


  image.src =
    foto;


  image.alt =
    pessoaAtual?.nome ||
    "Foto";


  viewer.classList.add(
    "open"
  );


  document.body.style.overflow =
    "hidden";

}


/* =========================================================
   FOTO PRINCIPAL
========================================================= */

function abrirFotoTelaCheia() {

  if (
    pessoaAtual &&
    pessoaAtual.capa
  ) {

    abrirFoto(
      corrigirCaminhoImagem(
        pessoaAtual.capa
      )
    );

  }

}


/* =========================================================
   FECHAR FOTO
========================================================= */

function fecharFotoTelaCheia() {

  const viewer =
    document.getElementById(
      "photoViewer"
    );


  viewer.classList.remove(
    "open"
  );


  document.body.style.overflow =
    "";

}


/* =========================================================
   ESC
========================================================= */

document.addEventListener(
  "keydown",
  event => {

    if (
      event.key === "Escape"
    ) {

      fecharFotoTelaCheia();

    }

  }
);


/* =========================================================
   CLICAR FORA DA FOTO
========================================================= */

document
  .getElementById("photoViewer")
  ?.addEventListener(
    "click",
    event => {

      if (
        event.target.id ===
        "photoViewer"
      ) {

        fecharFotoTelaCheia();

      }

    }
  );


/* =========================================================
   VOLTAR
========================================================= */

function voltarPagina() {

  if (
    document.referrer &&
    document.referrer.includes(
      window.location.hostname
    )
  ) {

    window.history.back();

  } else {

    window.location.href =
      "../index.html";

  }

}


/* =========================================================
   ERRO
========================================================= */

function mostrarErro(mensagem) {

  document.getElementById(
    "categoriaPessoa"
  ).textContent = "ERRO";


  document.getElementById(
    "nomePessoa"
  ).textContent = mensagem;


  const apresentacao =
    document.querySelector(
      ".pessoa-apresentacao"
    );


  const sobre =
    document.querySelector(
      ".sobre-pessoa"
    );


  const galeria =
    document.querySelector(
      ".galeria-pessoa"
    );


  if (apresentacao) {
    apresentacao.style.display = "none";
  }


  if (sobre) {
    sobre.style.display = "none";
  }


  if (galeria) {
    galeria.style.display = "none";
  }

}