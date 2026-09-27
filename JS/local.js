const params = new URLSearchParams(window.location.search);
const idLocal = params.get("id");

let localAtual = null;
let mapaLocal = null;


/* =========================
   VOLTAR
========================= */

function voltarPagina() {

  if (
    document.referrer &&
    document.referrer.includes(window.location.hostname)
  ) {
    history.back();
    return;
  }

  window.location.href = "../index.html";
}


/* =========================
   SEGURANÇA
========================= */

function escaparHTML(valor) {

  if (
    valor === undefined ||
    valor === null
  ) {
    return "";
  }

  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


/* =========================
   CAMINHO DAS IMAGENS
========================= */

function corrigirCaminhoImagem(caminho) {

  if (!caminho) {
    return "";
  }

  caminho = String(caminho).trim();

  /*
    JSON:

    ./img/pousada/capa.jpg

    local.html:

    PAGES/local.html

    Resultado:

    ../img/pousada/capa.jpg
  */

  if (
    caminho.startsWith("./")
  ) {
    return "../" + caminho.substring(2);
  }

  if (
    caminho.startsWith("img/")
  ) {
    return "../" + caminho;
  }

  if (
    caminho.startsWith("../") ||
    caminho.startsWith("http://") ||
    caminho.startsWith("https://") ||
    caminho.startsWith("/")
  ) {
    return caminho;
  }

  return caminho;
}


/* =========================
   CARREGAR LOCAL
========================= */

async function carregarLocal() {

  if (!idLocal) {

    mostrarErro(
      "Local não informado."
    );

    return;
  }


  try {

    const [
      locaisResponse,
      comerciosResponse,
      hospedagemResponse
    ] = await Promise.all([

      fetch("../DATA/locais.json"),

      fetch("../DATA/comercios.json"),

      fetch("../DATA/hospedagem.json")

    ]);


    if (!locaisResponse.ok) {

      throw new Error(
        "Não foi possível carregar locais.json"
      );
    }


    if (!comerciosResponse.ok) {

      throw new Error(
        "Não foi possível carregar comercios.json"
      );
    }


    if (!hospedagemResponse.ok) {

      throw new Error(
        "Não foi possível carregar hospedagem.json"
      );
    }


    const locais =
      await locaisResponse.json();


    const comercios =
      await comerciosResponse.json();


    const hospedagens =
      await hospedagemResponse.json();


    const todos = [

      ...(Array.isArray(locais)
        ? locais
        : []),

      ...(Array.isArray(comercios)
        ? comercios
        : []),

      ...(Array.isArray(hospedagens)
        ? hospedagens
        : [])

    ];


    localAtual =
      todos.find(
        item =>
          String(item.id) ===
          String(idLocal)
      );


    if (!localAtual) {

      console.error(
        "ID não encontrado:",
        idLocal
      );

      console.log(
        "IDs disponíveis:",
        todos.map(
          item => item.id
        )
      );

      mostrarErro(
        "Local não encontrado."
      );

      return;
    }


    console.log(
      "Local carregado:",
      localAtual
    );


    preencherPagina(
      localAtual
    );

  } catch (erro) {

    console.error(
      "Erro ao carregar local:",
      erro
    );

    mostrarErro(
      "Não foi possível carregar as informações deste lugar."
    );
  }
}


/* =========================
   PREENCHER PÁGINA
========================= */

function preencherPagina(item) {

  document.title =
    `${item.nome || "Local"} — Guia Turístico de Andrelândia`;


  const nomeElemento =
    document.getElementById(
      "nomeLocal"
    );

  if (nomeElemento) {

    nomeElemento.textContent =
      item.nome ||
      "Local";
  }


  const categoriaElemento =
    document.getElementById(
      "categoriaLocal"
    );

  if (categoriaElemento) {

    categoriaElemento.textContent =
      item.categoria ||
      "LOCAL";
  }


  /* =========================
     DESCRIÇÃO
  ========================= */

  const descricao =
    item.descricao ||
    item.historia ||
    item.sobre ||
    "Conheça este lugar em Andrelândia.";


  const descricaoElemento =
    document.getElementById(
      "descricaoLocal"
    );

  if (descricaoElemento) {

    descricaoElemento.textContent =
      descricao;
  }


  /* =========================
     HISTÓRIA
  ========================= */

  const historiaElemento =
    document.getElementById(
      "historiaLocal"
    );

  if (historiaElemento) {

    if (item.historia) {

      historiaElemento.textContent =
        item.historia;

    } else {

      if (historiaElemento.parentElement) {

        historiaElemento.parentElement.style.display =
          "none";
      }
    }
  }


  /* =========================
     CURIOSIDADES
  ========================= */

  const curiosidadesElemento =
    document.getElementById(
      "curiosidadesLocal"
    );

  if (curiosidadesElemento) {

    if (item.curiosidades) {

      curiosidadesElemento.textContent =
        item.curiosidades;

    } else {

      if (curiosidadesElemento.parentElement) {

        curiosidadesElemento.parentElement.style.display =
          "none";
      }
    }
  }


  /* =========================
     HORÁRIO
  ========================= */

  const horarioElemento =
    document.getElementById(
      "horarioLocal"
    );

  if (horarioElemento) {

    horarioElemento.innerHTML =
      formatarHorario(
        item.horario
      );
  }


  /* =========================
     ENDEREÇO
  ========================= */

  const enderecoElemento =
    document.getElementById(
      "enderecoLocal"
    );

  if (enderecoElemento) {

    enderecoElemento.textContent =
      item.endereco ||
      item.endereço ||
      "Endereço não informado";
  }


  /* =========================
     ENTRADA
  ========================= */

  const entradaElemento =
    document.getElementById(
      "entradaLocal"
    );

  if (entradaElemento) {

    entradaElemento.textContent =
      item.entrada ||
      "Não informado";
  }


  /* =========================
     TELEFONE
  ========================= */

  const telefoneElemento =
    document.getElementById(
      "telefoneLocal"
    );

  if (telefoneElemento) {

    if (item.telefone) {

      telefoneElemento.textContent =
        item.telefone;

    } else {

      if (telefoneElemento.parentElement) {

        telefoneElemento.parentElement.style.display =
          "none";
      }
    }
  }


  /* =========================
     SITE
  ========================= */

  const siteElemento =
    document.getElementById(
      "siteLocal"
    );

  if (siteElemento) {

    if (item.site) {

      siteElemento.href =
        item.site;

      siteElemento.target =
        "_blank";

      siteElemento.rel =
        "noopener noreferrer";

      siteElemento.style.display =
        "flex";

    } else {

      siteElemento.style.display =
        "none";
    }
  }


  configurarInstagram(item);

  configurarWhatsApp(item);

  configurarGaleria(item);

  configurarMapa(item);

  configurarGoogleMaps(item);
}


/* =========================
   HORÁRIO
========================= */

function formatarHorario(horario) {

  if (!horario) {

    return "Horário não informado";
  }


  if (typeof horario === "string") {

    return escaparHTML(
      horario
    );
  }


  if (typeof horario === "object") {

    return Object.entries(horario)

      .map(
        ([dia, hora]) => {

          return `
            <div>
              <strong>
                ${escaparHTML(dia)}:
              </strong>

              ${escaparHTML(hora)}
            </div>
          `;

        }
      )

      .join("");
  }


  return "Horário não informado";
}


/* =========================
   INSTAGRAM
========================= */

function configurarInstagram(item) {

  const link =
    document.getElementById(
      "instagramLocal"
    );

  const nome =
    document.getElementById(
      "instagramNome"
    );


  if (!link) {
    return;
  }


  let instagram =
    item.instagram || "";


  instagram =
    String(instagram).trim();


  /*
    SEM INSTAGRAM

    O botão desaparece.
  */

  if (!instagram) {

    link.style.display =
      "none";

    return;
  }


  let url =
    instagram;

  let usuario =
    "";


  if (
    instagram.startsWith(
      "http://"
    ) ||
    instagram.startsWith(
      "https://"
    )
  ) {

    url =
      instagram;

    usuario =
      instagram
        .replace(
          /^https?:\/\/(www\.)?instagram\.com\//i,
          ""
        )
        .replace(
          /\/.*$/,
          ""
        );

  } else {

    usuario =
      instagram
        .replace(
          /^@/,
          ""
        )
        .replace(
          /^instagram\.com\//i,
          ""
        )
        .replace(
          /^www\.instagram\.com\//i,
          ""
        )
        .replace(
          /\/.*$/,
          ""
        );

    url =
      `https://www.instagram.com/${usuario}/`;
  }


  if (nome) {

    nome.textContent =
      `@${usuario}`;
  }


  link.href =
    url;

  link.target =
    "_blank";

  link.rel =
    "noopener noreferrer";

  link.style.display =
    "flex";
}


/* =========================
   WHATSAPP
========================= */

function configurarWhatsApp(item) {

  const link =
    document.getElementById(
      "whatsappLocal"
    );


  if (!link) {
    return;
  }


  /*
    Pode usar no JSON:

    "whatsapp": "5535999999999"

    ou

    "whatsapp": "(35) 99999-9999"
  */

  let whatsapp =
    item.whatsapp ||
    item.telefone ||
    "";


  whatsapp =
    String(whatsapp).trim();


  /*
    SEM WHATSAPP

    O botão desaparece.
  */

  if (!whatsapp) {

    link.style.display =
      "none";

    return;
  }


  /*
    Remove tudo que não for número.
  */

  const numero =
    whatsapp.replace(
      /\D/g,
      ""
    );


  if (!numero) {

    link.style.display =
      "none";

    return;
  }


  /*
    Se tiver somente DDD + número,
    adiciona o código do Brasil.

    Exemplo:

    35999999999

    vira:

    5535999999999
  */

  let numeroFinal =
    numero;


  if (
    numero.length === 10 ||
    numero.length === 11
  ) {

    numeroFinal =
      "55" + numero;
  }


  link.href =
    `https://wa.me/${numeroFinal}`;


  link.target =
    "_blank";

  link.rel =
    "noopener noreferrer";

  link.style.display =
    "flex";
}


/* =========================
   GALERIA
========================= */

function configurarGaleria(item) {

  const principal =
    document.getElementById(
      "fotoPrincipal"
    );

  const miniaturas =
    document.getElementById(
      "miniaturas"
    );


  if (
    !principal ||
    !miniaturas
  ) {
    return;
  }


  let fotos = [];


  /* CAPA */

  if (item.capa) {

    const caminho =
      corrigirCaminhoImagem(
        item.capa
      );

    if (caminho) {

      fotos.push(
        caminho
      );
    }
  }


  /* GALERIA */

  if (
    Array.isArray(
      item.galeria
    )
  ) {

    item.galeria.forEach(
      foto => {

        const caminho =
          corrigirCaminhoImagem(
            foto
          );


        if (
          caminho &&
          !fotos.includes(
            caminho
          )
        ) {

          fotos.push(
            caminho
          );
        }

      }
    );
  }


  /* FOTOS */

  if (
    Array.isArray(
      item.fotos
    )
  ) {

    item.fotos.forEach(
      foto => {

        const caminho =
          corrigirCaminhoImagem(
            foto
          );


        if (
          caminho &&
          !fotos.includes(
            caminho
          )
        ) {

          fotos.push(
            caminho
          );
        }

      }
    );
  }


  /* SEM FOTOS */

  if (
    fotos.length === 0
  ) {

    principal.style.display =
      "none";

    miniaturas.innerHTML = `
      <div class="empty-comments">
        Nenhuma foto disponível.
      </div>
    `;

    return;
  }


  /* FOTO PRINCIPAL */

  principal.style.display =
    "";


  principal.src =
    fotos[0];


  principal.alt =
    item.nome ||
    "Foto do local";


  /*
    Se a imagem principal
    não carregar, mostra
    o erro no console.
  */

  principal.onerror =
    () => {

      console.error(
        "Erro ao carregar imagem:",
        principal.src
      );
    };


  /* MINIATURAS */

  miniaturas.innerHTML =
    "";


  fotos.forEach(
    (foto, index) => {

      const button =
        document.createElement(
          "button"
        );


      button.type =
        "button";


      button.className =
        "thumbnail";


      if (
        index === 0
      ) {

        button.classList.add(
          "active"
        );
      }


      const imagem =
        document.createElement(
          "img"
        );


      imagem.src =
        foto;


      imagem.alt =
        `Foto ${index + 1}`;


      imagem.onerror =
        () => {

          console.error(
            "Erro ao carregar miniatura:",
            foto
          );
        };


      button.appendChild(
        imagem
      );


      button.addEventListener(
        "click",
        () => {

          principal.src =
            foto;


          document
            .querySelectorAll(
              ".thumbnail"
            )
            .forEach(
              item =>
                item.classList.remove(
                  "active"
                )
            );


          button.classList.add(
            "active"
          );
        }
      );


      miniaturas.appendChild(
        button
      );
    }
  );
}


/* =========================
   MAPA
========================= */

function configurarMapa(item) {

  const latitude =
    Number(item.latitude);

  const longitude =
    Number(item.longitude);


  const elementoMapa =
    document.getElementById(
      "localMap"
    );


  if (!elementoMapa) {
    return;
  }


  if (
    !Number.isFinite(
      latitude
    ) ||
    !Number.isFinite(
      longitude
    )
  ) {

    elementoMapa.innerHTML = `
      <div style="
        height:100%;
        display:grid;
        place-items:center;
        padding:20px;
        color:#777;
        text-align:center;
      ">
        Localização deste lugar ainda não cadastrada.
      </div>
    `;

    return;
  }


  mapaLocal =
    L.map(
      "localMap",
      {
        zoomControl: true,
        scrollWheelZoom: false,
        maxZoom: 22
      }
    ).setView(
      [
        latitude,
        longitude
      ],
      18
    );


  L.tileLayer(
    "https://{s}.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      subdomains: [
        "server",
        "services"
      ],

      maxNativeZoom: 19,

      maxZoom: 22,

      attribution:
        "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
    }
  ).addTo(
    mapaLocal
  );


  const marcador =
    L.marker([
      latitude,
      longitude
    ]).addTo(
      mapaLocal
    );


  marcador.bindPopup(
    `<strong>
      ${escaparHTML(
        item.nome ||
        "Local"
      )}
    </strong>`
  );


  marcador.openPopup();
}


/* =========================
   GOOGLE MAPS
========================= */

function configurarGoogleMaps(item) {

  const latitude =
    Number(item.latitude);

  const longitude =
    Number(item.longitude);


  const botao =
    document.getElementById(
      "comoChegar"
    );


  if (!botao) {
    return;
  }


  if (
    !Number.isFinite(
      latitude
    ) ||
    !Number.isFinite(
      longitude
    )
  ) {

    botao.style.display =
      "none";

    return;
  }


  const destino =
    `${latitude},${longitude}`;


  botao.href =
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destino)}`;


  botao.target =
    "_blank";


  botao.rel =
    "noopener noreferrer";
}


/* =========================
   FOTO EM TELA CHEIA
========================= */

function abrirFotoTelaCheia() {

  const principal =
    document.getElementById(
      "fotoPrincipal"
    );


  const viewer =
    document.getElementById(
      "photoViewer"
    );


  const viewerImage =
    document.getElementById(
      "viewerImage"
    );


  if (
    !principal ||
    !viewer ||
    !viewerImage ||
    !principal.src
  ) {
    return;
  }


  viewerImage.src =
    principal.src;


  viewer.classList.add(
    "open"
  );


  document.body.style.overflow =
    "hidden";
}


function fecharFotoTelaCheia() {

  const viewer =
    document.getElementById(
      "photoViewer"
    );


  if (!viewer) {
    return;
  }


  viewer.classList.remove(
    "open"
  );


  document.body.style.overflow =
    "";
}


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


/* =========================
   COMENTÁRIOS
========================= */

function carregarComentarios() {

  const lista =
    document.getElementById(
      "listaComentarios"
    );


  if (
    !lista ||
    !idLocal
  ) {
    return;
  }


  const chave =
    `comentarios_${idLocal}`;


  const comentarios =
    JSON.parse(
      localStorage.getItem(
        chave
      )
    ) || [];


  lista.innerHTML =
    "";


  if (
    comentarios.length === 0
  ) {

    lista.innerHTML = `
      <div class="empty-comments">
        Ainda não há comentários.
        Seja o primeiro a comentar!
      </div>
    `;

    return;
  }


  comentarios.forEach(
    (comentario, index) => {

      const elemento =
        document.createElement(
          "div"
        );


      elemento.className =
        "comment";


      elemento.innerHTML = `
        <div class="comment-header">

          <strong>
            ${escaparHTML(
              comentario.nome
            )}
          </strong>

          <span>
            ${escaparHTML(
              comentario.data
            )}
          </span>

        </div>

        <p>
          ${escaparHTML(
            comentario.texto
          )}
        </p>

        <button
          type="button"
          class="delete-comment"
          data-index="${index}"
        >
          Excluir
        </button>
      `;


      lista.appendChild(
        elemento
      );
    }
  );


  document
    .querySelectorAll(
      ".delete-comment"
    )
    .forEach(
      botao => {

        botao.addEventListener(
          "click",
          () => {

            excluirComentario(
              Number(
                botao.dataset.index
              )
            );

          }
        );

      }
    );
}


function publicarComentario() {

  const nomeInput =
    document.getElementById(
      "nomeComentario"
    );


  const textoInput =
    document.getElementById(
      "textoComentario"
    );


  if (
    !nomeInput ||
    !textoInput ||
    !idLocal
  ) {
    return;
  }


  const nome =
    nomeInput.value.trim();


  const texto =
    textoInput.value.trim();


  if (!nome) {

    alert(
      "Digite seu nome."
    );

    nomeInput.focus();

    return;
  }


  if (!texto) {

    alert(
      "Escreva um comentário."
    );

    textoInput.focus();

    return;
  }


  const chave =
    `comentarios_${idLocal}`;


  const comentarios =
    JSON.parse(
      localStorage.getItem(
        chave
      )
    ) || [];


  const agora =
    new Date();


  comentarios.unshift({

    nome: nome,

    texto: texto,

    data:
      agora.toLocaleDateString(
        "pt-BR"
      )

  });


  localStorage.setItem(
    chave,
    JSON.stringify(
      comentarios
    )
  );


  nomeInput.value =
    "";

  textoInput.value =
    "";


  carregarComentarios();
}


function excluirComentario(index) {

  if (!idLocal) {
    return;
  }


  const chave =
    `comentarios_${idLocal}`;


  const comentarios =
    JSON.parse(
      localStorage.getItem(
        chave
      )
    ) || [];


  comentarios.splice(
    index,
    1
  );


  localStorage.setItem(
    chave,
    JSON.stringify(
      comentarios
    )
  );


  carregarComentarios();
}


/* =========================
   ERRO
========================= */

function mostrarErro(mensagem) {

  const pagina =
    document.querySelector(
      ".local-page"
    );


  if (!pagina) {
    return;
  }


  pagina.innerHTML = `
    <div style="
      min-height:100vh;
      display:flex;
      flex-direction:column;
      align-items:center;
      justify-content:center;
      padding:30px;
      text-align:center;
    ">

      <h1 style="
        color:#091D1C;
        font-family:Georgia,serif;
      ">
        Ops!
      </h1>

      <p style="
        color:#666;
        line-height:1.6;
      ">
        ${escaparHTML(
          mensagem
        )}
      </p>

      <a
        href="../index.html"
        style="
          margin-top:15px;
          padding:12px 20px;
          background:#091D1C;
          color:#fff;
          border-radius:9px;
          font-weight:bold;
        "
      >
        Voltar ao início
      </a>

    </div>
  `;
}


/* =========================
   INICIAR
========================= */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    carregarLocal();


    const botaoComentario =
      document.getElementById(
        "publicarComentario"
      );


    if (botaoComentario) {

      botaoComentario.addEventListener(
        "click",
        publicarComentario
      );
    }


    carregarComentarios();

  }
);