/* =========================================================
   ANDRELÂNDIA — GUIA TURÍSTICO
   INDEX.JS
========================================================= */


/* =========================================================
   CONFIGURAÇÕES
========================================================= */

const CENTRO_ANDRELANDIA = {
  latitude: -21.740150,
  longitude: -44.309058
};

const LIMITE_INICIAL = 10;
const LIMITE_INCREMENTO = 10;

const FALLBACK_IMAGE = "./img/sem-foto.png";

const SUPABASE_URL =
  "https://xdmbkflufsfqziixzpxc.supabase.co";

const SUPABASE_KEY =
  "sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";


/* =========================================================
   SUPABASE
========================================================= */

let supabaseClient = null;

if (
  window.supabase &&
  typeof window.supabase.createClient === "function"
) {
  supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
  );
} else {
  console.error("Supabase não foi carregado.");
}


/* =========================================================
   ESTADOS GLOBAIS
========================================================= */

let dadosLocais = [];
let dadosComercios = [];
let dadosHospedagem = [];

let avaliacoes = [];

let pessoas = [];
let votosPessoas = [];

let usuarioAtual = null;

let homeMap = null;

const marcadores = [];

let slidesHero = [];
let slideHeroAtual = 0;
let intervaloHero = null;
let inicioToqueHero = 0;


/* =========================================================
   ELEMENTOS
========================================================= */

let heroCarousel = null;
let heroText = null;

let visitarList = null;
let mostrarMaisVisitar = null;

let comerList = null;
let mostrarMaisComer = null;
let filtroAberto = null;
let textoStatus = null;

let comercioList = null;
let mostrarMaisComercio = null;
let pesquisaComercio = null;
let filtroAbertoComercio = null;
let textoStatusComercio = null;

let ficarList = null;
let mostrarMaisFicar = null;

let pessoasList = null;
let mostrarMaisPessoas = null;


/* =========================================================
   ESTADOS DOS FILTROS
========================================================= */

let limiteVisitar = LIMITE_INICIAL;

let categoriaComerFiltro = "Todos";
let mostrarSomenteAbertos = false;
let limiteComer = LIMITE_INICIAL;

let pesquisaComercioTexto = "";
let mostrarSomenteComercioAbertos = false;
let limiteComercio = LIMITE_INICIAL;

let limiteFicar = LIMITE_INICIAL;
let limitePessoas = LIMITE_INICIAL;


/* =========================================================
   UTILITÁRIOS
========================================================= */

function normalizarTexto(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}


function escaparHTML(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


function criarLinkLocal(id) {
  return `pages/local.html?id=${encodeURIComponent(id || "")}`;
}


function obterImagem(item) {
  return item?.capa || FALLBACK_IMAGE;
}


/* =========================================================
   DISTÂNCIA
========================================================= */

function calcularDistancia(
  lat1,
  lon1,
  lat2,
  lon2
) {
  const R = 6371;

  const dLat =
    (lat2 - lat1) *
    Math.PI /
    180;

  const dLon =
    (lon2 - lon1) *
    Math.PI /
    180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;

  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  return R * c;
}


function formatarDistancia(distancia) {
  if (distancia < 1) {
    return `${Math.round(distancia * 1000)} m do centro`;
  }

  return `${distancia
    .toFixed(1)
    .replace(".", ",")} km do centro`;
}


/* =========================================================
   PAGINAÇÃO
========================================================= */

function configurarMostrarMais({
  botao,
  total,
  limite
}) {
  if (!botao) {
    return;
  }

  if (total > limite) {
    botao.hidden = false;
    botao.textContent = "Mostrar mais";
  } else {
    botao.hidden = true;
  }
}


/* =========================================================
   HERO / CARROSSEL
========================================================= */

const HERO_MAXIMO = 20;

const TEXTOS_HERO = [
  "Descubra Andrelândia",
  "Conheça a história de Andrelândia",
  "Explore as belezas de Andrelândia",
  "Viva Andrelândia",
  "Descubra novos lugares",
  "Um destino para conhecer"
];

const CAMINHOS_HERO = [
  "./img/hero/hero",
  "./img/hero"
];

const EXTENSOES_HERO = [
  "jpg",
  "jpeg",
  "png",
  "webp"
];


function verificarImagemExiste(caminho) {
  return new Promise(resolve => {
    const imagem = new Image();

    let finalizado = false;

    const finalizar = resultado => {
      if (finalizado) {
        return;
      }

      finalizado = true;
      resolve(resultado);
    };

    imagem.onload = () => finalizar(true);
    imagem.onerror = () => finalizar(false);

    imagem.src =
      `${caminho}?v=${Date.now()}`;
  });
}


async function descobrirSlidesHero() {
  if (!heroCarousel) {
    return;
  }

  const encontrados = [];

  for (
    let numero = 1;
    numero <= HERO_MAXIMO;
    numero++
  ) {
    let encontrada = null;

    for (const pasta of CAMINHOS_HERO) {
      if (encontrada) {
        break;
      }

      for (const extensao of EXTENSOES_HERO) {
        const caminho =
          `${pasta}${numero}.${extensao}`;

        const existe =
          await verificarImagemExiste(
            caminho
          );

        if (existe) {
          encontrada = caminho;
          break;
        }
      }
    }

    if (encontrada) {
      encontrados.push(encontrada);
    }
  }

  slidesHero = [
    ...new Set(encontrados)
  ];

  montarCarrossel();
}


function montarCarrossel() {
  if (!heroCarousel) {
    return;
  }

  heroCarousel.innerHTML = "";

  if (slidesHero.length === 0) {
    heroCarousel.style.background =
      "var(--verde-escuro)";

    if (heroText) {
      heroText.textContent =
        TEXTOS_HERO[0];
    }

    return;
  }

  const fragmento =
    document.createDocumentFragment();

  slidesHero.forEach(
    (imagem, indice) => {
      const slide =
        document.createElement("div");

      slide.className =
        "hero-slide";

      if (indice === 0) {
        slide.classList.add("active");
      }

      slide.style.backgroundImage =
        `url("${imagem}")`;

      fragmento.appendChild(slide);
    }
  );

  heroCarousel.appendChild(fragmento);

  slideHeroAtual = 0;

  atualizarHero();

  iniciarIntervaloHero();

  configurarGestosHero();
}


function atualizarHero() {
  if (!heroCarousel) {
    return;
  }

  const slides =
    heroCarousel.querySelectorAll(
      ".hero-slide"
    );

  if (!slides.length) {
    return;
  }

  slides.forEach(
    (slide, indice) => {
      slide.classList.toggle(
        "active",
        indice === slideHeroAtual
      );
    }
  );

  if (heroText) {
    heroText.textContent =
      TEXTOS_HERO[
        slideHeroAtual %
        TEXTOS_HERO.length
      ];
  }
}


function mudarHero(direcao) {
  if (slidesHero.length <= 1) {
    return;
  }

  slideHeroAtual += direcao;

  if (
    slideHeroAtual >=
    slidesHero.length
  ) {
    slideHeroAtual = 0;
  }

  if (slideHeroAtual < 0) {
    slideHeroAtual =
      slidesHero.length - 1;
  }

  atualizarHero();
}


function iniciarIntervaloHero() {
  if (intervaloHero) {
    clearInterval(intervaloHero);
  }

  if (slidesHero.length <= 1) {
    return;
  }

  intervaloHero =
    setInterval(() => {
      mudarHero(1);
    }, 10000);
}


function configurarGestosHero() {
  if (!heroCarousel) {
    return;
  }

  heroCarousel.ontouchstart = event => {
    inicioToqueHero =
      event.changedTouches[0]?.screenX || 0;
  };

  heroCarousel.ontouchend = event => {
    const final =
      event.changedTouches[0]?.screenX || 0;

    const distancia =
      final - inicioToqueHero;

    if (Math.abs(distancia) < 40) {
      return;
    }

    if (distancia < 0) {
      mudarHero(1);
    } else {
      mudarHero(-1);
    }
  };
}


/* =========================================================
   MAPA
========================================================= */

function inicializarMapa() {
  const elemento =
    document.getElementById("homeMap");

  if (!elemento) {
    console.error(
      "#homeMap não encontrado."
    );

    return;
  }

  if (typeof L === "undefined") {
    console.error(
      "Leaflet não foi carregado."
    );

    return;
  }

  if (homeMap) {
    return;
  }

  homeMap =
    L.map(
      elemento,
      {
        zoomControl: false,
        scrollWheelZoom: true,
        maxZoom: 22
      }
    ).setView(
      [
        CENTRO_ANDRELANDIA.latitude,
        CENTRO_ANDRELANDIA.longitude
      ],
      15
    );

  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxNativeZoom: 19,
      maxZoom: 22,

      attribution:
        "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
    }
  ).addTo(homeMap);

  L.control
    .zoom({
      position: "bottomright"
    })
    .addTo(homeMap);

  setTimeout(() => {
    if (homeMap) {
      homeMap.invalidateSize();
    }
  }, 500);
}


/* =========================================================
   MAPA — NORMALIZAÇÃO DAS CATEGORIAS
========================================================= */

/*
 * Esta função transforma qualquer nome de categoria
 * em uma categoria interna padronizada.
 *
 * Exemplos:
 *
 * "Igrejas"       -> "igreja"
 * "Igreja"        -> "igreja"
 * "História"      -> "historico"
 * "Patrimônio"    -> "historico"
 * "Natureza"      -> "natureza"
 * "Alimentação"   -> "alimentacao"
 * "Café"          -> "cafe"
 * "Hospedagem"    -> "hospedagem"
 * "Comércio"      -> "comercio"
 * "Esportes"      -> "esporte"
 * "Cultura"       -> "cultura"
 */

function normalizarGrupoMapa(valor) {
  const texto =
    normalizarTexto(valor);

  if (
    !texto ||
    texto === "todos" ||
    texto === "todas" ||
    texto === "all"
  ) {
    return "todos";
  }

  if (
    texto === "igreja" ||
    texto === "igrejas" ||
    texto.includes("igreja") ||
    texto.includes("capela") ||
    texto.includes("santuario")
  ) {
    return "igreja";
  }

  if (
    texto === "historico" ||
    texto === "historica" ||
    texto === "historicos" ||
    texto === "historicas" ||
    texto.includes("histor") ||
    texto.includes("patrimonio") ||
    texto.includes("ferrovi") ||
    texto.includes("estacao")
  ) {
    return "historico";
  }

  /*
   * IMPORTANTE:
   * Natureza vem antes de algumas categorias
   * específicas para garantir que locais como
   * mirantes e pedras sejam reconhecidos.
   */

  if (
    texto === "natureza" ||
    texto === "naturais" ||
    texto.includes("natureza") ||
    texto.includes("cachoeira") ||
    texto.includes("mirante") ||
    texto.includes("parque") ||
    texto.includes("trilha") ||
    texto.includes("pedra") ||
    texto.includes("serra")
  ) {
    return "natureza";
  }

  /*
   * Café precisa ser verificado ANTES de alimentação.
   * Isso corrige o problema em que "Café" acabava
   * sendo colocado dentro de "alimentacao".
   */

  if (
    texto === "cafe" ||
    texto === "cafes" ||
    texto === "cafeteria" ||
    texto === "cafeterias" ||
    texto.includes("cafeteria") ||
    texto.startsWith("cafe ") ||
    texto.endsWith(" cafe") ||
    texto.includes(" cafe ")
  ) {
    return "cafe";
  }

  if (
    texto === "alimentacao" ||
    texto === "alimentacoes" ||
    texto.includes("aliment") ||
    texto.includes("restaurante") ||
    texto.includes("lanch") ||
    texto.includes("sorvete") ||
    texto.includes("acai") ||
    texto.includes("pizzaria") ||
    texto.includes("hamburg") ||
    texto.includes("doceria") ||
    texto.includes("padaria")
  ) {
    return "alimentacao";
  }

  if (
    texto === "hospedagem" ||
    texto === "hospedacao" ||
    texto === "hosped" ||
    texto.includes("hosped") ||
    texto.includes("hotel") ||
    texto.includes("pousada")
  ) {
    return "hospedagem";
  }

  if (
    texto === "comercio" ||
    texto === "comercios" ||
    texto === "comercial" ||
    texto.includes("comerc") ||
    texto.includes("loja") ||
    texto.includes("mercado") ||
    texto.includes("servico")
  ) {
    return "comercio";
  }

  if (
    texto === "esporte" ||
    texto === "esportes" ||
    texto.includes("esport") ||
    texto.includes("academia") ||
    texto.includes("futebol")
  ) {
    return "esporte";
  }

  if (
    texto === "cultura" ||
    texto === "culturas" ||
    texto.includes("cultura") ||
    texto.includes("artista") ||
    texto.includes("arte")
  ) {
    return "cultura";
  }

  return "outros";
}


/* =========================================================
   GRUPOS DO MAPA
========================================================= */

function obterGrupoCategoriaMapa(categoria) {
  return normalizarGrupoMapa(
    categoria
  );
}


/*
 * Descobre o grupo usando categoria + nome.
 *
 * Isso é importante porque alguns itens podem ter:
 *
 * categoria: "Local"
 * nome: "Café Central"
 *
 * Nesse caso o nome ainda permite descobrir
 * que pertence ao grupo Café.
 */

function obterGrupoItemMapa(item) {
  if (!item) {
    return "outros";
  }

  const categoria =
    item.categoria || "";

  const nome =
    item.nome || "";

  /*
   * Primeiro tenta somente a categoria.
   */

  const grupoCategoria =
    obterGrupoCategoriaMapa(
      categoria
    );

  if (
    grupoCategoria !== "outros" &&
    grupoCategoria !== "todos"
  ) {
    return grupoCategoria;
  }

  /*
   * Depois tenta categoria + nome.
   */

  const grupoCompleto =
    obterGrupoCategoriaMapa(
      `${categoria} ${nome}`
    );

  if (
    grupoCompleto !== "outros" &&
    grupoCompleto !== "todos"
  ) {
    return grupoCompleto;
  }

  /*
   * Finalmente tenta somente o nome.
   */

  const grupoNome =
    obterGrupoCategoriaMapa(
      nome
    );

  if (
    grupoNome !== "outros" &&
    grupoNome !== "todos"
  ) {
    return grupoNome;
  }

  return "outros";
}


/* =========================================================
   ÍCONES DO MAPA
========================================================= */

function criarIcone(categoriaOuGrupo) {
  const grupo =
    normalizarGrupoMapa(
      categoriaOuGrupo
    );

  let arquivo = null;

  switch (grupo) {
    case "igreja":
      arquivo = "igreja.png";
      break;

    case "historico":
      arquivo = "historico.png";
      break;

    case "natureza":
      arquivo = "natureza.png";
      break;

    case "alimentacao":
      arquivo = "alimentacao.png";
      break;

    case "cafe":
      arquivo = "alimentacao.png";
      break;

    case "hospedagem":
      arquivo = "hotel.png";
      break;

    case "comercio":
      arquivo = "comercio.png";
      break;

    case "esporte":
      arquivo = "esporte.png";
      break;

    case "cultura":
      arquivo = "cultura.png";
      break;

    default:
      return L.divIcon({
        className:
          "marcador-mapa-generico",

        html:
          "<span></span>",

        iconSize: [
          30,
          30
        ],

        iconAnchor: [
          15,
          30
        ],

        popupAnchor: [
          0,
          -28
        ]
      });
  }

  return L.icon({
    iconUrl:
      `img/marcadores/${arquivo}`,

    iconSize: [
      48,
      48
    ],

    iconAnchor: [
      24,
      48
    ],

    popupAnchor: [
      0,
      -44
    ]
  });
}


function adicionarEstiloMarcadorGenerico() {
  if (
    document.getElementById(
      "estiloMarcadorGenerico"
    )
  ) {
    return;
  }

  const style =
    document.createElement("style");

  style.id =
    "estiloMarcadorGenerico";

  style.textContent = `
    .marcador-mapa-generico {
      background: transparent;
      border: 0;
    }

    .marcador-mapa-generico span {
      display: block;
      width: 24px;
      height: 24px;
      border-radius: 50% 50% 50% 0;
      background: #194138;
      border: 3px solid #ffffff;
      box-shadow: 0 3px 8px rgba(0,0,0,.35);
      transform: rotate(-45deg);
    }
  `;

  document.head.appendChild(style);
}


/* =========================================================
   POPUP
========================================================= */

function criarPopup(item) {
  const imagem =
    escaparHTML(
      obterImagem(item)
    );

  const nome =
    escaparHTML(
      item.nome || "Local"
    );

  const categoria =
    escaparHTML(
      item.categoria || "Local"
    );

  const descricao =
    escaparHTML(
      item.descricao ||
      item.historia ||
      "Conheça este local em Andrelândia."
    );

  const link =
    criarLinkLocal(item.id);

  return `
    <div class="popup">

      <img
        class="popup-image"
        src="${imagem}"
        alt="${nome}"
        onerror="this.src='${FALLBACK_IMAGE}'"
      >

      <div class="popup-content">

        <div class="popup-category">
          ${categoria}
        </div>

        <h3>
          ${nome}
        </h3>

        <p>
          ${descricao}
        </p>

        <a
          class="popup-button"
          href="${link}"
        >
          Ver detalhes
        </a>

      </div>

    </div>
  `;
}


/* =========================================================
   ADICIONAR MARCADOR
========================================================= */

function adicionarMarcador(item) {
  if (!homeMap || !item) {
    return;
  }

  const latitude =
    Number(
      item.latitude ??
      item.lat
    );

  const longitude =
    Number(
      item.longitude ??
      item.lng ??
      item.lon
    );

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    console.warn(
      "Item sem coordenadas:",
      item
    );

    return;
  }

  /*
   * A categoria do marcador é definida UMA VEZ
   * e armazenada no registro.
   *
   * Assim o filtro nunca depende novamente
   * do JSON depois que o marcador foi criado.
   */

  const grupo =
    obterGrupoItemMapa(item);

  const marcador =
    L.marker(
      [
        latitude,
        longitude
      ],
      {
        icon:
          criarIcone(grupo)
      }
    );

  marcador.bindPopup(
    criarPopup(item),
    {
      maxWidth: 280,
      minWidth: 220
    }
  );

  marcador.addTo(homeMap);

  marcadores.push({
    marcador,

    categoria:
      item.categoria || "",

    grupo,

    id:
      item.id,

    nome:
      item.nome || "",

    item
  });

  console.log(
    "Marcador criado:",
    item.nome,
    "=>",
    grupo
  );
}


/* =========================================================
   FILTRO DO MAPA
========================================================= */

function aplicarFiltroMapa(categoria) {
  if (!homeMap) {
    return;
  }

  /*
   * Converte tanto o valor do botão quanto
   * os nomes alternativos para o mesmo grupo.
   *
   * Exemplo:
   *
   * "Igrejas"      -> "igreja"
   * "História"     -> "historico"
   * "Alimentação"  -> "alimentacao"
   * "Café"         -> "cafe"
   */

  const grupoSelecionado =
    normalizarGrupoMapa(
      categoria
    );

  console.log(
    "Filtro do mapa:",
    categoria,
    "=>",
    grupoSelecionado
  );

  marcadores.forEach(
    registro => {
      /*
       * "todos" mostra absolutamente todos
       * os marcadores.
       */

      const mostrar =
        grupoSelecionado === "todos" ||
        normalizarGrupoMapa(
          registro.grupo
        ) ===
          grupoSelecionado;

      if (mostrar) {
        if (
          !homeMap.hasLayer(
            registro.marcador
          )
        ) {
          registro.marcador.addTo(
            homeMap
          );
        }
      } else {
        if (
          homeMap.hasLayer(
            registro.marcador
          )
        ) {
          homeMap.removeLayer(
            registro.marcador
          );
        }
      }
    }
  );
}


/* =========================================================
   CATEGORIA DO BOTÃO DO MAPA
========================================================= */

function obterCategoriaBotaoMapa(botao) {
  if (!botao) {
    return "todos";
  }

  /*
   * Aceita todas estas possibilidades:
   *
   * data-categoria="igreja"
   * data-category="igreja"
   *
   * Também tenta aria-label e texto do botão.
   */

  const valor =
    botao.dataset.categoria ||
    botao.dataset.category ||
    botao.getAttribute(
      "data-categoria"
    ) ||
    botao.getAttribute(
      "data-category"
    ) ||
    botao.getAttribute(
      "aria-label"
    ) ||
    botao.textContent ||
    "todos";

  return valor.trim();
}


/* =========================================================
   CONFIGURAR FILTROS DO MAPA
========================================================= */

function configurarFiltrosMapa() {
  const botoes =
    document.querySelectorAll(
      ".map-filter"
    );

  if (!botoes.length) {
    console.warn(
      "Nenhum botão .map-filter encontrado."
    );

    return;
  }

  /*
   * Remove qualquer comportamento anterior
   * através de onclick.
   */

  botoes.forEach(
    botao => {
      botao.onclick = null;
    }
  );

  botoes.forEach(
    botao => {
      botao.onclick = event => {
        event.preventDefault();

        /*
         * Remove active de todos.
         */

        botoes.forEach(
          item => {
            item.classList.remove(
              "active"
            );
          }
        );

        /*
         * Ativa o botão clicado.
         */

        botao.classList.add(
          "active"
        );

        /*
         * Descobre a categoria.
         */

        const categoria =
          obterCategoriaBotaoMapa(
            botao
          );

        /*
         * Aplica o filtro.
         */

        aplicarFiltroMapa(
          categoria
        );
      };
    }
  );

  /*
   * Descobre o botão inicial.
   *
   * Se houver um botão já com .active,
   * ele será respeitado.
   */

  let botaoAtivo =
    Array.from(botoes).find(
      botao =>
        botao.classList.contains(
          "active"
        )
    );

  /*
   * Se nenhum estiver ativo, procura
   * automaticamente o botão "Todos".
   */

  if (!botaoAtivo) {
    botaoAtivo =
      Array.from(botoes).find(
        botao =>
          normalizarGrupoMapa(
            obterCategoriaBotaoMapa(
              botao
            )
          ) === "todos"
      );
  }

  /*
   * Se ainda não encontrou, utiliza
   * simplesmente o primeiro botão.
   */

  if (!botaoAtivo) {
    botaoAtivo =
      botoes[0];
  }

  if (botaoAtivo) {
    botoes.forEach(
      item =>
        item.classList.remove(
          "active"
        )
    );

    botaoAtivo.classList.add(
      "active"
    );

    aplicarFiltroMapa(
      obterCategoriaBotaoMapa(
        botaoAtivo
      )
    );
  }
}


/* =========================================================
   O QUE VISITAR
========================================================= */

function criarCardVisitar(item) {
  const nome =
    item.nome || "Local";

  const endereco =
    item.endereco ||
    item.endereço ||
    "Andrelândia - MG";

  const descricao =
    item.descricao ||
    item.historia ||
    item.curiosidades ||
    "";

  const elemento =
    document.createElement("a");

  elemento.className =
    "visitar-item";

  elemento.href =
    criarLinkLocal(item.id);

  elemento.innerHTML = `
    <div class="visitar-image">

      <img
        src="${escaparHTML(
          obterImagem(item)
        )}"
        alt="${escaparHTML(nome)}"
        loading="lazy"
        onerror="this.src='${FALLBACK_IMAGE}'"
      >

    </div>

    <div class="visitar-info">

      <h3 class="visitar-nome">
        ${escaparHTML(nome)}
      </h3>

      <div class="visitar-local">
        ${escaparHTML(endereco)}
      </div>

      <p class="visitar-resumo">
        ${escaparHTML(descricao)}
      </p>

    </div>

    <div class="visitar-arrow">

      <img
        src="img/icones/seta2.png"
        alt=""
      >

    </div>
  `;

  return elemento;
}


function renderizarOQueVisitar() {
  if (!visitarList) {
    return;
  }

  visitarList.innerHTML = "";

  if (!dadosLocais.length) {
    visitarList.innerHTML = `
      <div class="visitar-empty">
        Nenhum local encontrado.
      </div>
    `;

    if (mostrarMaisVisitar) {
      mostrarMaisVisitar.hidden = true;
    }

    return;
  }

  const quantidade =
    Math.min(
      limiteVisitar,
      dadosLocais.length
    );

  dadosLocais
    .slice(0, quantidade)
    .forEach(item => {
      visitarList.appendChild(
        criarCardVisitar(item)
      );
    });

  configurarMostrarMais({
    botao:
      mostrarMaisVisitar,

    total:
      dadosLocais.length,

    limite:
      limiteVisitar
  });
}


/* =========================================================
   HORÁRIOS
========================================================= */

function obterDiaSemana() {
  const dias = [
    "domingo",
    "segunda",
    "terca",
    "quarta",
    "quinta",
    "sexta",
    "sabado"
  ];

  return dias[
    new Date().getDay()
  ];
}


function converterParaMinutos(
  hora,
  minuto
) {
  return (
    Number(hora) * 60 +
    Number(minuto)
  );
}


function comercioEstaAberto(comercio) {
  if (
    !comercio ||
    !comercio.horario
  ) {
    return false;
  }

  const texto =
    normalizarTexto(
      comercio.horario
    );

  if (
    !texto ||
    texto.includes("fechado")
  ) {
    return false;
  }

  const agora =
    new Date();

  const horaAtual =
    agora.getHours() * 60 +
    agora.getMinutes();

  const dia =
    obterDiaSemana();

  if (
    texto.includes(
      "segunda a sabado"
    )
  ) {
    if (dia === "domingo") {
      return false;
    }
  }

  if (
    texto.includes(
      "segunda a sexta"
    )
  ) {
    if (
      dia === "domingo" ||
      dia === "sabado"
    ) {
      return false;
    }
  }

  const horarios = [];

  const regex =
    /(\d{1,2})\s*:\s*(\d{2})\s*(?:as|às|-|a)\s*(\d{1,2})\s*:\s*(\d{2})/g;

  let resultado;

  while (
    (resultado =
      regex.exec(texto)) !== null
  ) {
    horarios.push({
      inicio:
        converterParaMinutos(
          resultado[1],
          resultado[2]
        ),

      fim:
        converterParaMinutos(
          resultado[3],
          resultado[4]
        )
    });
  }

  if (!horarios.length) {
    return false;
  }

  return horarios.some(
    horario => {
      if (
        horario.fim <
        horario.inicio
      ) {
        return (
          horaAtual >=
            horario.inicio ||
          horaAtual <=
            horario.fim
        );
      }

      return (
        horaAtual >=
          horario.inicio &&
        horaAtual <=
          horario.fim
      );
    }
  );
}


/* =========================================================
   ONDE COMER
========================================================= */

const CATEGORIAS_COMIDA = [
  "todos",
  "restaurante",
  "lanchonete",
  "cafe",
  "sorvete",
  "acai"
];


function comercioEhAlimentacao(comercio) {
  const texto =
    normalizarTexto(
      `${comercio?.categoria || ""} ${
        comercio?.nome || ""
      }`
    );

  const palavras = [
    "restaurante",
    "lanchonete",
    "lanch",
    "lanche",
    "cafe",
    "cafeteria",
    "sorvete",
    "sorveteria",
    "acai",
    "pizzaria",
    "hamburguer",
    "hamburg",
    "alimentacao",
    "doceria",
    "padaria"
  ];

  return palavras.some(
    palavra =>
      texto.includes(
        normalizarTexto(
          palavra
        )
      )
  );
}


function comercioPertenceCategoria(
  comercio,
  filtro
) {
  if (
    normalizarTexto(filtro) ===
    "todos"
  ) {
    return true;
  }

  const categoria =
    normalizarTexto(
      comercio?.categoria
    );

  const nome =
    normalizarTexto(
      comercio?.nome
    );

  const texto =
    `${categoria} ${nome}`;

  switch (
    normalizarTexto(filtro)
  ) {
    case "restaurante":
      return texto.includes(
        "restaurante"
      );

    case "lanchonete":
      return texto.includes(
        "lanch"
      );

    case "cafe":
      return (
        texto.includes("cafe") ||
        texto.includes("cafeteria")
      );

    case "sorvete":
      return texto.includes(
        "sorvete"
      );

    case "acai":
      return texto.includes(
        "acai"
      );

    default:
      return true;
  }
}


function obterComerciosFiltrados() {
  return dadosComercios.filter(
    comercio => {
      if (
        !comercioEhAlimentacao(
          comercio
        )
      ) {
        return false;
      }

      if (
        !comercioPertenceCategoria(
          comercio,
          categoriaComerFiltro
        )
      ) {
        return false;
      }

      if (
        mostrarSomenteAbertos &&
        !comercioEstaAberto(
          comercio
        )
      ) {
        return false;
      }

      return true;
    }
  );
}


/* =========================================================
   AVALIAÇÕES
========================================================= */

function obterAvaliacaoLocal(localId) {
  const lista =
    avaliacoes.filter(
      avaliacao =>
        String(
          avaliacao.local_id
        ) ===
        String(localId)
    );

  if (!lista.length) {
    return null;
  }

  const notasValidas =
    lista.filter(
      avaliacao =>
        Number.isFinite(
          Number(
            avaliacao.nota
          )
        )
    );

  if (!notasValidas.length) {
    return null;
  }

  const soma =
    notasValidas.reduce(
      (
        total,
        avaliacao
      ) =>
        total +
        Number(
          avaliacao.nota
        ),
      0
    );

  return (
    soma /
    notasValidas.length
  );
}


function criarHTMLAvaliacao(localId) {
  const nota =
    obterAvaliacaoLocal(
      localId
    );

  if (nota === null) {
    return "";
  }

  return `
    <div class="avaliacao-local">

      <img
        src="img/icones/estrela.png"
        alt="Avaliação"
      >

      <span>
        ${nota
          .toFixed(1)
          .replace(".", ",")}
      </span>

    </div>
  `;
}


function formatarNota(
  localId,
  notaOriginal
) {
  const nota =
    obterAvaliacaoLocal(
      localId
    );

  if (nota === null) {
    if (
      notaOriginal !==
        undefined &&
      notaOriginal !== null &&
      notaOriginal !== ""
    ) {
      return String(
        notaOriginal
      );
    }

    return "";
  }

  return nota
    .toFixed(1)
    .replace(".", ",");
}


/* =========================================================
   STATUS — ALIMENTAÇÃO
========================================================= */

function atualizarStatusBotao() {
  if (
    !filtroAberto ||
    !textoStatus
  ) {
    return;
  }

  const existeAberto =
    dadosComercios.some(
      comercio =>
        comercioEhAlimentacao(
          comercio
        ) &&
        comercioEstaAberto(
          comercio
        )
    );

  if (
    mostrarSomenteAbertos
  ) {
    textoStatus.textContent =
      "Mostrando abertos";

    filtroAberto.classList.add(
      "selecionado"
    );

    filtroAberto.classList.remove(
      "fechado"
    );

    return;
  }

  filtroAberto.classList.remove(
    "selecionado"
  );

  if (existeAberto) {
    textoStatus.textContent =
      "Aberto agora";

    filtroAberto.classList.remove(
      "fechado"
    );
  } else {
    textoStatus.textContent =
      "Fechado";

    filtroAberto.classList.add(
      "fechado"
    );
  }
}


/* =========================================================
   CARD — ONDE COMER
========================================================= */

function criarCardComercio(
  comercio
) {
  const nome =
    comercio.nome ||
    "Comércio";

  const categoria =
    comercio.categoria ||
    "Alimentação";

  const endereco =
    comercio.endereco ||
    comercio.endereço ||
    "Andrelândia - MG";

  const aberto =
    comercioEstaAberto(
      comercio
    );

  const classeStatus =
    aberto
      ? "aberto"
      : "fechado";

  const textoStatusCard =
    aberto
      ? "Aberto agora"
      : "Fechado";

  const avaliacaoHTML =
    criarHTMLAvaliacao(
      comercio.id
    );

  const elemento =
    document.createElement("a");

  elemento.className =
    "comer-item";

  elemento.href =
    criarLinkLocal(
      comercio.id
    );

  elemento.innerHTML = `
    <div class="comer-image">

      <img
        src="${escaparHTML(
          obterImagem(comercio)
        )}"
        alt="${escaparHTML(nome)}"
        loading="lazy"
        onerror="this.src='${FALLBACK_IMAGE}'"
      >

    </div>

    <div class="comer-info">

      <h3 class="comer-nome">
        ${escaparHTML(nome)}
      </h3>

      <div class="comer-endereco">
        ${escaparHTML(endereco)}
      </div>

      <div class="comer-categoria">
        ${escaparHTML(categoria)}
      </div>

      <div class="comer-status-linha">

        <div class="comer-horario ${classeStatus}">
          ${textoStatusCard}
        </div>

        ${avaliacaoHTML}

      </div>

    </div>

    <div class="comer-arrow">

      <img
        src="img/icones/seta2.png"
        alt=""
      >

    </div>
  `;

  return elemento;
}


function renderizarComercios() {
  if (!comerList) {
    return;
  }

  comerList.innerHTML = "";

  const lista =
    obterComerciosFiltrados();

  if (!lista.length) {
    comerList.innerHTML = `
      <div class="comer-empty">
        Nenhum estabelecimento encontrado.
      </div>
    `;

    if (mostrarMaisComer) {
      mostrarMaisComer.hidden = true;
    }

    return;
  }

  const quantidade =
    Math.min(
      limiteComer,
      lista.length
    );

  lista
    .slice(0, quantidade)
    .forEach(
      comercio => {
        comerList.appendChild(
          criarCardComercio(
            comercio
          )
        );
      }
    );

  configurarMostrarMais({
    botao:
      mostrarMaisComer,

    total:
      lista.length,

    limite:
      limiteComer
  });
}


/* =========================================================
   FILTROS — ONDE COMER
========================================================= */

function configurarFiltrosComer() {
  document
    .querySelectorAll(
      ".comer-filtro"
    )
    .forEach(botao => {
      botao.onclick = () => {
        document
          .querySelectorAll(
            ".comer-filtro"
          )
          .forEach(
            item =>
              item.classList.remove(
                "active"
              )
          );

        botao.classList.add(
          "active"
        );

        categoriaComerFiltro =
          botao.dataset.categoria ||
          botao.dataset.category ||
          botao.textContent.trim();

        limiteComer =
          LIMITE_INICIAL;

        renderizarComercios();
      };
    });
}


function configurarBotaoFiltroAberto() {
  if (!filtroAberto) {
    return;
  }

  filtroAberto.onclick = () => {
    mostrarSomenteAbertos =
      !mostrarSomenteAbertos;

    limiteComer =
      LIMITE_INICIAL;

    atualizarStatusBotao();

    renderizarComercios();
  };
}


/* =========================================================
   COMÉRCIO LOCAL
========================================================= */

function distanciaLevenshtein(
  a,
  b
) {
  a = normalizarTexto(a);
  b = normalizarTexto(b);

  const matriz =
    Array.from(
      {
        length:
          b.length + 1
      },
      () =>
        Array(
          a.length + 1
        ).fill(0)
    );

  for (
    let i = 0;
    i <= b.length;
    i++
  ) {
    matriz[i][0] = i;
  }

  for (
    let j = 0;
    j <= a.length;
    j++
  ) {
    matriz[0][j] = j;
  }

  for (
    let i = 1;
    i <= b.length;
    i++
  ) {
    for (
      let j = 1;
      j <= a.length;
      j++
    ) {
      const custo =
        b[i - 1] ===
        a[j - 1]
          ? 0
          : 1;

      matriz[i][j] =
        Math.min(
          matriz[i - 1][j] + 1,
          matriz[i][j - 1] + 1,
          matriz[i - 1][j - 1] +
            custo
        );
    }
  }

  return matriz[
    b.length
  ][a.length];
}


function palavraCombina(
  palavra,
  termo
) {
  palavra =
    normalizarTexto(palavra);

  termo =
    normalizarTexto(termo);

  if (!palavra || !termo) {
    return false;
  }

  if (palavra.includes(termo)) {
    return true;
  }

  if (
    termo.length >= 4 &&
    distanciaLevenshtein(
      palavra,
      termo
    ) <= 2
  ) {
    return true;
  }

  return false;
}


function comercioCombinaPesquisa(
  comercio,
  pesquisa
) {
  const termos =
    normalizarTexto(pesquisa)
      .split(/\s+/)
      .filter(Boolean);

  if (!termos.length) {
    return true;
  }

  const campos = [
    comercio.nome,
    comercio.categoria,
    comercio.endereco,
    comercio.endereço,
    comercio.descricao
  ]
    .filter(Boolean)
    .map(normalizarTexto);

  return termos.every(
    termo =>
      campos.some(
        campo =>
          campo.includes(termo) ||
          campo
            .split(/\s+/)
            .some(
              palavra =>
                palavraCombina(
                  palavra,
                  termo
                )
            )
      )
  );
}


function obterComerciosPesquisa() {
  return dadosComercios.filter(
    comercio => {
      if (
        comercioEhAlimentacao(
          comercio
        )
      ) {
        return false;
      }

      const categoria =
        normalizarTexto(
          comercio.categoria
        );

      const nome =
        normalizarTexto(
          comercio.nome
        );

      const hospedagem =
        categoria.includes(
          "hosped"
        ) ||
        categoria.includes(
          "hotel"
        ) ||
        categoria.includes(
          "pousada"
        ) ||
        nome.includes(
          "hotel"
        ) ||
        nome.includes(
          "pousada"
        );

      if (hospedagem) {
        return false;
      }

      if (
        !comercioCombinaPesquisa(
          comercio,
          pesquisaComercioTexto
        )
      ) {
        return false;
      }

      if (
        mostrarSomenteComercioAbertos &&
        !comercioEstaAberto(
          comercio
        )
      ) {
        return false;
      }

      return true;
    }
  );
}


/* =========================================================
   CARD — COMÉRCIO LOCAL
========================================================= */

function criarCardComercioLocal(
  comercio
) {
  const nome =
    comercio.nome ||
    "Comércio";

  const categoria =
    comercio.categoria ||
    "Comércio local";

  const endereco =
    comercio.endereco ||
    comercio.endereço ||
    "Andrelândia - MG";

  const aberto =
    comercioEstaAberto(
      comercio
    );

  const classeStatus =
    aberto
      ? "aberto"
      : "fechado";

  const textoStatusCard =
    aberto
      ? "Aberto agora"
      : "Fechado";

  const avaliacaoHTML =
    criarHTMLAvaliacao(
      comercio.id
    );

  const elemento =
    document.createElement("a");

  elemento.className =
    "comer-item";

  elemento.href =
    criarLinkLocal(
      comercio.id
    );

  elemento.innerHTML = `
    <div class="comer-image">

      <img
        src="${escaparHTML(
          obterImagem(comercio)
        )}"
        alt="${escaparHTML(nome)}"
        loading="lazy"
        onerror="this.src='${FALLBACK_IMAGE}'"
      >

    </div>

    <div class="comer-info">

      <h3 class="comer-nome">
        ${escaparHTML(nome)}
      </h3>

      <div class="comer-endereco">
        ${escaparHTML(endereco)}
      </div>

      <div class="comer-categoria">
        ${escaparHTML(categoria)}
      </div>

      <div class="comer-status-linha">

        <div class="comer-horario ${classeStatus}">
          ${textoStatusCard}
        </div>

        ${avaliacaoHTML}

      </div>

    </div>

    <div class="comer-arrow">

      <img
        src="img/icones/seta2.png"
        alt=""
      >

    </div>
  `;

  return elemento;
}


function renderizarComercioLocal() {
  if (!comercioList) {
    return;
  }

  comercioList.innerHTML = "";

  const lista =
    obterComerciosPesquisa();

  if (!lista.length) {
    comercioList.innerHTML = `
      <div class="comer-empty">
        Nenhum comércio encontrado.
      </div>
    `;

    if (mostrarMaisComercio) {
      mostrarMaisComercio.hidden = true;
    }

    return;
  }

  const quantidade =
    Math.min(
      limiteComercio,
      lista.length
    );

  lista
    .slice(0, quantidade)
    .forEach(
      comercio => {
        comercioList.appendChild(
          criarCardComercioLocal(
            comercio
          )
        );
      }
    );

  configurarMostrarMais({
    botao:
      mostrarMaisComercio,

    total:
      lista.length,

    limite:
      limiteComercio
  });
}


function atualizarStatusComercio() {
  if (
    !filtroAbertoComercio ||
    !textoStatusComercio
  ) {
    return;
  }

  const existeAberto =
    dadosComercios.some(
      comercio =>
        !comercioEhAlimentacao(
          comercio
        ) &&
        comercioEstaAberto(
          comercio
        )
    );

  if (
    mostrarSomenteComercioAbertos
  ) {
    textoStatusComercio.textContent =
      "Mostrando abertos";

    filtroAbertoComercio.classList.add(
      "selecionado"
    );

    filtroAbertoComercio.classList.remove(
      "fechado"
    );

    return;
  }

  filtroAbertoComercio.classList.remove(
    "selecionado"
  );

  if (existeAberto) {
    textoStatusComercio.textContent =
      "Aberto agora";

    filtroAbertoComercio.classList.remove(
      "fechado"
    );
  } else {
    textoStatusComercio.textContent =
      "Fechado";

    filtroAbertoComercio.classList.add(
      "fechado"
    );
  }
}


function configurarComercioLocal() {
  if (pesquisaComercio) {
    pesquisaComercio.oninput =
      event => {
        pesquisaComercioTexto =
          event.target.value || "";

        limiteComercio =
          LIMITE_INICIAL;

        renderizarComercioLocal();
      };
  }

  if (filtroAbertoComercio) {
    filtroAbertoComercio.onclick =
      () => {
        mostrarSomenteComercioAbertos =
          !mostrarSomenteComercioAbertos;

        limiteComercio =
          LIMITE_INICIAL;

        atualizarStatusComercio();

        renderizarComercioLocal();
      };
  }
}


/* =========================================================
   ONDE FICAR
========================================================= */

function criarCardHospedagem(
  hospedagem
) {
  const nome =
    hospedagem.nome ||
    "Hospedagem";

  const endereco =
    hospedagem.endereco ||
    hospedagem.endereço ||
    "Andrelândia - MG";

  const avaliacaoHTML =
    criarHTMLAvaliacao(
      hospedagem.id
    );

  const elemento =
    document.createElement("a");

  elemento.className =
    "ficar-item";

  elemento.href =
    criarLinkLocal(
      hospedagem.id
    );

  elemento.innerHTML = `
    <div class="ficar-image">

      <img
        src="${escaparHTML(
          obterImagem(hospedagem)
        )}"
        alt="${escaparHTML(nome)}"
        loading="lazy"
        onerror="this.src='${FALLBACK_IMAGE}'"
      >

    </div>

    <div class="ficar-info">

      <h3 class="ficar-nome">
        ${escaparHTML(nome)}
      </h3>

      <div class="ficar-endereco">
        ${escaparHTML(endereco)}
      </div>

      ${
        avaliacaoHTML
          ? `
            <div class="ficar-nota">
              ${avaliacaoHTML}
            </div>
          `
          : ""
      }

    </div>

    <div class="ficar-arrow">

      <img
        src="img/icones/seta2.png"
        alt=""
      >

    </div>
  `;

  return elemento;
}


function renderizarHospedagens() {
  if (!ficarList) {
    return;
  }

  ficarList.innerHTML = "";

  if (!dadosHospedagem.length) {
    ficarList.innerHTML = `
      <div class="ficar-empty">
        Nenhuma hospedagem encontrada.
      </div>
    `;

    if (mostrarMaisFicar) {
      mostrarMaisFicar.hidden = true;
    }

    return;
  }

  const quantidade =
    Math.min(
      limiteFicar,
      dadosHospedagem.length
    );

  dadosHospedagem
    .slice(0, quantidade)
    .forEach(
      hospedagem => {
        ficarList.appendChild(
          criarCardHospedagem(
            hospedagem
          )
        );
      }
    );

  configurarMostrarMais({
    botao:
      mostrarMaisFicar,

    total:
      dadosHospedagem.length,

    limite:
      limiteFicar
  });
}


/* =========================================================
   JSON
========================================================= */

async function carregarJSON(
  caminho,
  nome
) {
  try {
    const resposta =
      await fetch(caminho, {
        cache: "no-store"
      });

    if (!resposta.ok) {
      throw new Error(
        `${nome}: HTTP ${resposta.status}`
      );
    }

    const dados =
      await resposta.json();

    if (!Array.isArray(dados)) {
      throw new Error(
        `${nome} não contém um array JSON`
      );
    }

    console.log(
      `${nome} carregado:`,
      dados.length
    );

    return dados;
  } catch (erro) {
    console.error(
      `Erro ao carregar ${nome}:`,
      erro
    );

    return [];
  }
}


/* =========================================================
   AVALIAÇÕES
========================================================= */

async function carregarAvaliacoes() {
  if (!supabaseClient) {
    avaliacoes = [];
    return;
  }

  try {
    const {
      data,
      error
    } =
      await supabaseClient
        .from("avaliacoes")
        .select(
          "local_id, nota"
        );

    if (error) {
      console.error(
        "Erro ao carregar avaliações:",
        error
      );

      avaliacoes = [];
      return;
    }

    avaliacoes =
      Array.isArray(data)
        ? data
        : [];
  } catch (erro) {
    console.error(
      "Erro nas avaliações:",
      erro
    );

    avaliacoes = [];
  }
}


/* =========================================================
   IDENTIFICAR HOSPEDAGEM
========================================================= */

function itemEhHospedagem(item) {
  const texto =
    normalizarTexto(
      `${item?.categoria || ""} ${
        item?.nome || ""
      }`
    );

  return (
    texto.includes("hosped") ||
    texto.includes("hotel") ||
    texto.includes("pousada")
  );
}


function obterHospedagensDosComercios() {
  return dadosComercios.filter(
    item =>
      itemEhHospedagem(item)
  );
}


/* =========================================================
   CARREGAR TODOS OS DADOS
========================================================= */

async function carregarDados() {
  const resultados =
    await Promise.all([
      carregarJSON(
        "./DATA/locais.json",
        "locais.json"
      ),

      carregarJSON(
        "./DATA/comercios.json",
        "comercios.json"
      ),

      carregarJSON(
        "./DATA/hospedagem.json",
        "hospedagem.json"
      )
    ]);

  dadosLocais =
    resultados[0];

  dadosComercios =
    resultados[1];

  if (resultados[2].length) {
    dadosHospedagem =
      resultados[2];
  } else {
    dadosHospedagem =
      obterHospedagensDosComercios();
  }

  await carregarAvaliacoes();

  /*
   * Remove marcadores anteriores.
   */

  marcadores.forEach(
    registro => {
      if (
        homeMap &&
        homeMap.hasLayer(
          registro.marcador
        )
      ) {
        homeMap.removeLayer(
          registro.marcador
        );
      }
    }
  );

  marcadores.length = 0;

  /*
   * Locais turísticos.
   */

  dadosLocais.forEach(
    adicionarMarcador
  );

  /*
   * Comércio.
   */

  dadosComercios.forEach(
    adicionarMarcador
  );

  /*
   * Hospedagem externa.
   */

  if (
    resultados[2].length
  ) {
    dadosHospedagem.forEach(
      hospedagem => {
        const jaExiste =
          dadosComercios.some(
            comercio =>
              String(
                comercio.id
              ) ===
              String(
                hospedagem.id
              )
          );

        if (!jaExiste) {
          adicionarMarcador(
            hospedagem
          );
        }
      }
    );
  }

  renderizarOQueVisitar();

  atualizarStatusBotao();

  renderizarComercios();

  atualizarStatusComercio();

  renderizarComercioLocal();

  renderizarHospedagens();

  /*
   * IMPORTANTE:
   * Os marcadores já existem neste momento.
   * Portanto o filtro é aplicado somente agora.
   */

  configurarFiltrosMapa();

  if (homeMap) {
    setTimeout(() => {
      homeMap.invalidateSize();
    }, 500);
  }
}


/* =========================================================
   MURAL
========================================================= */

async function carregarPessoas() {
  if (!pessoasList) {
    return;
  }

  try {
    const resposta =
      await fetch(
        "./DATA/pessoas.json",
        {
          cache: "no-store"
        }
      );

    if (!resposta.ok) {
      throw new Error(
        "Não foi possível carregar pessoas.json"
      );
    }

    const dados =
      await resposta.json();

    if (!Array.isArray(dados)) {
      throw new Error(
        "pessoas.json não contém um array"
      );
    }

    pessoas = dados;

    await carregarVotosPessoas();

    renderizarPessoas();
  } catch (erro) {
    console.error(
      "Erro ao carregar pessoas:",
      erro
    );

    pessoasList.innerHTML = `
      <p class="lista-vazia">
        Não foi possível carregar o mural.
      </p>
    `;

    if (mostrarMaisPessoas) {
      mostrarMaisPessoas.hidden = true;
    }
  }
}


/* =========================================================
   VOTOS DO MURAL
========================================================= */

async function carregarVotosPessoas() {
  if (!supabaseClient) {
    votosPessoas = [];
    return;
  }

  try {
    const {
      data,
      error
    } =
      await supabaseClient
        .from("votos_pessoas")
        .select(
          "pessoa_id, usuario_id, voto"
        );

    if (error) {
      console.error(
        "Erro ao carregar votos:",
        error
      );

      votosPessoas = [];
      return;
    }

    votosPessoas =
      Array.isArray(data)
        ? data
        : [];
  } catch (erro) {
    console.error(
      "Erro ao carregar votos:",
      erro
    );

    votosPessoas = [];
  }
}


function obterResumoVotos(
  pessoaId
) {
  const votos =
    votosPessoas.filter(
      voto =>
        String(
          voto.pessoa_id
        ) ===
        String(
          pessoaId
        )
    );

  let likes = 0;
  let dislikes = 0;

  votos.forEach(voto => {
    if (
      Number(voto.voto) === 1
    ) {
      likes++;
    }

    if (
      Number(voto.voto) === -1
    ) {
      dislikes++;
    }
  });

  return {
    likes,
    dislikes,
    score:
      likes -
      dislikes
  };
}


function obterVotoDoUsuario(
  pessoaId
) {
  if (!usuarioAtual) {
    return 0;
  }

  const voto =
    votosPessoas.find(
      item =>
        String(
          item.pessoa_id
        ) ===
          String(pessoaId) &&
        String(
          item.usuario_id
        ) ===
          String(usuarioAtual.id)
    );

  return voto
    ? Number(voto.voto)
    : 0;
}


/* =========================================================
   ORDENAR MURAL
========================================================= */

function ordenarPessoasPorVotos(
  lista
) {
  return [...lista].sort(
    (a, b) => {
      const votoA =
        obterResumoVotos(a.id);

      const votoB =
        obterResumoVotos(b.id);

      if (
        votoB.score !==
        votoA.score
      ) {
        return (
          votoB.score -
          votoA.score
        );
      }

      if (
        votoB.likes !==
        votoA.likes
      ) {
        return (
          votoB.likes -
          votoA.likes
        );
      }

      return String(
        a.nome || ""
      ).localeCompare(
        String(b.nome || ""),
        "pt-BR"
      );
    }
  );
}


/* =========================================================
   CARD DO MURAL
========================================================= */

function criarPessoaCard(
  pessoa
) {
  const link =
    document.createElement("a");

  link.className =
    "pessoa-item";

  link.href =
    `./pages/pessoa.html?id=${encodeURIComponent(
      pessoa.id
    )}`;

  const imagem =
    pessoa.capa ||
    FALLBACK_IMAGE;

  const nome =
    pessoa.nome ||
    "Pessoa";

  const categoria =
    pessoa.categoria ||
    "Personalidade";

  const resumo =
    obterResumoVotos(
      pessoa.id
    );

  const votoUsuario =
    obterVotoDoUsuario(
      pessoa.id
    );

  const iconeSobe =
    votoUsuario === 1
      ? "img/icones/sobe-ativa.png"
      : "img/icones/sobe.png";

  const iconeDesce =
    votoUsuario === -1
      ? "img/icones/desce-ativa.png"
      : "img/icones/desce.png";

  link.innerHTML = `
    <div class="pessoa-image">

      <img
        src="${escaparHTML(imagem)}"
        alt="${escaparHTML(nome)}"
        loading="lazy"
        onerror="this.src='${FALLBACK_IMAGE}'"
      >

    </div>

    <div class="pessoa-info">

      <h3 class="pessoa-name">
        ${escaparHTML(nome)}
      </h3>

      <span class="pessoa-category">
        ${escaparHTML(categoria)}
      </span>

      <div
        class="pessoa-votos"
        data-pessoa-id="${escaparHTML(
          pessoa.id
        )}"
      >

        <button
          type="button"
          class="pessoa-voto pessoa-voto-like ${
            votoUsuario === 1
              ? "selecionado"
              : ""
          }"
          data-voto="1"
          aria-label="Curtir ${escaparHTML(
            nome
          )}"
        >

          <span class="pessoa-like-area">

            <img
              src="${iconeSobe}"
              alt=""
            >

            <span class="pessoa-like-count">
              ${resumo.likes}
            </span>

          </span>

        </button>

        <button
          type="button"
          class="pessoa-voto pessoa-voto-dislike ${
            votoUsuario === -1
              ? "selecionado"
              : ""
          }"
          data-voto="-1"
          aria-label="Não curtir ${escaparHTML(
            nome
          )}"
        >

          <img
            src="${iconeDesce}"
            alt=""
          >

        </button>

      </div>

    </div>
  `;

  link
    .querySelectorAll(
      ".pessoa-voto"
    )
    .forEach(botao => {
      botao.onclick =
        event => {
          event.preventDefault();
          event.stopPropagation();

          processarVotoPessoa(
            pessoa.id,
            Number(
              botao.dataset.voto
            )
          );
        };
    });

  return link;
}


/* =========================================================
   RENDERIZAR MURAL
========================================================= */

function renderizarPessoas() {
  if (!pessoasList) {
    return;
  }

  pessoasList.innerHTML = "";

  if (
    !Array.isArray(pessoas) ||
    !pessoas.length
  ) {
    pessoasList.innerHTML = `
      <p class="lista-vazia">
        Ainda não há pessoas cadastradas no mural.
      </p>
    `;

    if (mostrarMaisPessoas) {
      mostrarMaisPessoas.hidden = true;
    }

    return;
  }

  const pessoasOrdenadas =
    ordenarPessoasPorVotos(
      pessoas
    );

  const pessoasVisiveis =
    pessoasOrdenadas.slice(
      0,
      limitePessoas
    );

  const fragmento =
    document.createDocumentFragment();

  pessoasVisiveis.forEach(
    pessoa => {
      fragmento.appendChild(
        criarPessoaCard(pessoa)
      );
    }
  );

  pessoasList.appendChild(
    fragmento
  );

  if (mostrarMaisPessoas) {
    mostrarMaisPessoas.hidden =
      pessoas.length <=
      limitePessoas;
  }
}


/* =========================================================
   PROCESSAR VOTO
========================================================= */

async function processarVotoPessoa(
  pessoaId,
  novoVoto
) {
  if (!usuarioAtual) {
    abrirModalAuth("login");
    return;
  }

  if (!supabaseClient) {
    alert(
      "Não foi possível conectar ao sistema de votação."
    );

    return;
  }

  const votoExistente =
    votosPessoas.find(
      voto =>
        String(
          voto.pessoa_id
        ) ===
          String(pessoaId) &&
        String(
          voto.usuario_id
        ) ===
          String(usuarioAtual.id)
    );

  try {
    if (
      votoExistente &&
      Number(
        votoExistente.voto
      ) === novoVoto
    ) {
      const {
        error
      } =
        await supabaseClient
          .from("votos_pessoas")
          .delete()
          .eq(
            "pessoa_id",
            pessoaId
          )
          .eq(
            "usuario_id",
            usuarioAtual.id
          );

      if (error) {
        throw error;
      }
    } else if (votoExistente) {
      const {
        error
      } =
        await supabaseClient
          .from("votos_pessoas")
          .update({
            voto:
              novoVoto
          })
          .eq(
            "pessoa_id",
            pessoaId
          )
          .eq(
            "usuario_id",
            usuarioAtual.id
          );

      if (error) {
        throw error;
      }
    } else {
      const {
        error
      } =
        await supabaseClient
          .from("votos_pessoas")
          .insert({
            pessoa_id:
              pessoaId,

            usuario_id:
              usuarioAtual.id,

            voto:
              novoVoto
          });

      if (error) {
        throw error;
      }
    }

    await carregarVotosPessoas();

    renderizarPessoas();
  } catch (erro) {
    console.error(
      "Erro ao registrar voto:",
      erro
    );

    alert(
      "Não foi possível registrar seu voto."
    );
  }
}


/* =========================================================
   AUTENTICAÇÃO
========================================================= */

function adicionarEstiloAuth() {
  if (
    document.getElementById(
      "estiloAuthIndex"
    )
  ) {
    return;
  }

  const style =
    document.createElement("style");

  style.id =
    "estiloAuthIndex";

  style.textContent = `
    #authModal {
      position: fixed;
      inset: 0;
      z-index: 100000;
      display: none;
    }

    #authModal.open {
      display: block;
    }

    .auth-modal-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px;
      background: rgba(0,0,0,.58);
      overflow-y: auto;
    }

    .auth-modal-box {
      position: relative;
      width: min(100%, 420px);
      max-height: calc(100vh - 36px);
      overflow-y: auto;
      padding: 28px;
      background: #ffffff;
      border-radius: 18px;
      box-shadow: 0 20px 60px rgba(0,0,0,.28);
    }

    .auth-fechar {
      position: absolute;
      top: 10px;
      right: 13px;
      width: 35px;
      height: 35px;
      border: 0;
      background: transparent;
      color: #666;
      font-size: 29px;
      line-height: 1;
      cursor: pointer;
    }

    .auth-tag {
      display: block;
      margin-bottom: 8px;
      color: #194138;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 1.2px;
    }

    .auth-formulario h2 {
      margin: 0 0 8px;
      color: #091D1C;
      font-size: 25px;
      line-height: 1.2;
    }

    .auth-formulario p {
      margin: 0 0 20px;
      color: #777;
      font-size: 13px;
      line-height: 1.5;
    }

    .auth-label {
      display: block;
      margin: 12px 0 5px;
      color: #333;
      font-size: 12px;
      font-weight: 600;
    }

    .auth-input {
      display: block;
      width: 100%;
      min-height: 43px;
      padding: 10px 13px;
      border: 1px solid #d3d3d3;
      border-radius: 10px;
      background: #fff;
      color: #202522;
      font-family: inherit;
      font-size: 13px;
      outline: none;
      box-sizing: border-box;
    }

    .auth-input:focus {
      border-color: #194138;
      box-shadow: 0 0 0 3px rgba(25,65,56,.08);
    }

    .auth-erro {
      min-height: 19px;
      margin-top: 9px;
      color: #d32f2f;
      font-size: 12px;
      line-height: 1.4;
    }

    .auth-botao-principal,
    .auth-botao-secundario {
      width: 100%;
      min-height: 43px;
      border-radius: 10px;
      font-family: inherit;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }

    .auth-botao-principal {
      border: 0;
      background: #194138;
      color: #ffffff;
    }

    .auth-botao-principal:disabled {
      opacity: .6;
      cursor: wait;
    }

    .auth-botao-secundario {
      margin-top: 9px;
      border: 1px solid #d3d3d3;
      background: #ffffff;
      color: #194138;
    }

    @media (max-width: 430px) {
      .auth-modal-overlay {
        padding: 12px;
      }

      .auth-modal-box {
        padding: 23px 19px;
        border-radius: 15px;
      }
    }
  `;

  document.head.appendChild(style);
}


function criarInterfaceAuth() {
  let modal =
    document.getElementById(
      "authModal"
    );

  if (modal) {
    adicionarEstiloAuth();
    return;
  }

  modal =
    document.createElement("div");

  modal.id =
    "authModal";

  modal.setAttribute(
    "aria-hidden",
    "true"
  );

  modal.innerHTML = `
    <div
      class="auth-modal-overlay"
      data-auth-fechar
    >

      <div
        class="auth-modal-box"
        role="dialog"
        aria-modal="true"
      >

        <button
          type="button"
          id="fecharAuth"
          class="auth-fechar"
          aria-label="Fechar"
        >
          ×
        </button>

        <div
          id="formLogin"
          class="auth-formulario"
        >

          <span class="auth-tag">
            ANDRELÂNDIA — GUIA TURÍSTICO
          </span>

          <h2>
            Entrar
          </h2>

          <p>
            Entre na sua conta para participar do mural e avaliar os locais.
          </p>

          <label
            class="auth-label"
            for="loginEmail"
          >
            E-mail
          </label>

          <input
            type="email"
            id="loginEmail"
            class="auth-input"
            placeholder="Seu e-mail"
            autocomplete="email"
          >

          <label
            class="auth-label"
            for="loginSenha"
          >
            Senha
          </label>

          <input
            type="password"
            id="loginSenha"
            class="auth-input"
            placeholder="Sua senha"
            autocomplete="current-password"
          >

          <div
            id="erroLogin"
            class="auth-erro"
          ></div>

          <button
            type="button"
            id="botaoLogin"
            class="auth-botao-principal"
          >
            Entrar
          </button>

          <button
            type="button"
            id="trocarCadastro"
            class="auth-botao-secundario"
          >
            Criar uma conta
          </button>

        </div>

        <div
          id="formCadastro"
          class="auth-formulario"
          style="display:none"
        >

          <span class="auth-tag">
            CRIAR CONTA
          </span>

          <h2>
            Criar conta
          </h2>

          <p>
            Cadastre-se para participar do Guia Turístico de Andrelândia.
          </p>

          <label
            class="auth-label"
            for="cadastroNome"
          >
            Nome
          </label>

          <input
            type="text"
            id="cadastroNome"
            class="auth-input"
            placeholder="Seu nome"
            autocomplete="name"
          >

          <label
            class="auth-label"
            for="cadastroEmail"
          >
            E-mail
          </label>

          <input
            type="email"
            id="cadastroEmail"
            class="auth-input"
            placeholder="Seu e-mail"
            autocomplete="email"
          >

          <label
            class="auth-label"
            for="cadastroSenha"
          >
            Senha
          </label>

          <input
            type="password"
            id="cadastroSenha"
            class="auth-input"
            placeholder="Mínimo de 6 caracteres"
            autocomplete="new-password"
          >

          <label
            class="auth-label"
            for="cadastroConfirmarSenha"
          >
            Confirmar senha
          </label>

          <input
            type="password"
            id="cadastroConfirmarSenha"
            class="auth-input"
            placeholder="Digite a senha novamente"
            autocomplete="new-password"
          >

          <div
            id="erroCadastro"
            class="auth-erro"
          ></div>

          <button
            type="button"
            id="botaoCadastro"
            class="auth-botao-principal"
          >
            Criar conta
          </button>

          <button
            type="button"
            id="trocarLogin"
            class="auth-botao-secundario"
          >
            Já tenho uma conta
          </button>

        </div>

      </div>

    </div>
  `;

  document.body.appendChild(modal);

  adicionarEstiloAuth();
}


function mostrarFormularioAuth(modo) {
  const formLogin =
    document.getElementById(
      "formLogin"
    );

  const formCadastro =
    document.getElementById(
      "formCadastro"
    );

  if (!formLogin || !formCadastro) {
    return;
  }

  const erroLogin =
    document.getElementById(
      "erroLogin"
    );

  const erroCadastro =
    document.getElementById(
      "erroCadastro"
    );

  if (erroLogin) {
    erroLogin.textContent = "";
  }

  if (erroCadastro) {
    erroCadastro.textContent = "";
  }

  if (modo === "cadastro") {
    formLogin.style.display =
      "none";

    formCadastro.style.display =
      "block";

    return;
  }

  formLogin.style.display =
    "block";

  formCadastro.style.display =
    "none";
}


function abrirModalAuth(
  modo = "login"
) {
  criarInterfaceAuth();

  const modal =
    document.getElementById(
      "authModal"
    );

  if (!modal) {
    return;
  }

  modal.classList.add("open");

  modal.setAttribute(
    "aria-hidden",
    "false"
  );

  mostrarFormularioAuth(
    modo
  );

  document.body.style.overflow =
    "hidden";
}


function abrirLogin() {
  abrirModalAuth("login");
}


function fecharModalAuth() {
  const modal =
    document.getElementById(
      "authModal"
    );

  if (!modal) {
    return;
  }

  modal.classList.remove("open");

  modal.setAttribute(
    "aria-hidden",
    "true"
  );

  document.body.style.overflow =
    "";
}


function fecharLogin() {
  fecharModalAuth();
}


/* =========================================================
   INTERFACE DE AUTENTICAÇÃO
========================================================= */

async function mostrarUsuarioLogado(
  user
) {
  usuarioAtual =
    user || null;

  window.usuarioAtualSupabase =
    usuarioAtual;

  const areaAutenticacao =
    document.getElementById(
      "areaAutenticacao"
    );

  const areaAvaliacao =
    document.getElementById(
      "areaAvaliacao"
    );

  const nomeUsuarioLogado =
    document.getElementById(
      "nomeUsuarioLogado"
    );

  const nome =
    user?.user_metadata?.nome ||
    user?.email?.split("@")[0] ||
    "Usuário";

  if (areaAutenticacao) {
    areaAutenticacao.style.display =
      "none";
  }

  if (areaAvaliacao) {
    areaAvaliacao.style.display =
      "block";
  }

  if (nomeUsuarioLogado) {
    nomeUsuarioLogado.textContent =
      nome;
  }

  await carregarVotosPessoas();

  renderizarPessoas();

  atualizarBotaoLoginMural();
}


function mostrarUsuarioDeslogado() {
  usuarioAtual = null;

  window.usuarioAtualSupabase =
    null;

  const areaAutenticacao =
    document.getElementById(
      "areaAutenticacao"
    );

  const areaAvaliacao =
    document.getElementById(
      "areaAvaliacao"
    );

  if (areaAutenticacao) {
    areaAutenticacao.style.display =
      "block";
  }

  if (areaAvaliacao) {
    areaAvaliacao.style.display =
      "none";
  }

  atualizarBotaoLoginMural();
}


/* =========================================================
   ERROS DE AUTENTICAÇÃO
========================================================= */

function mostrarErroAuth(
  elemento,
  mensagem
) {
  if (!elemento) {
    return;
  }

  elemento.textContent =
    mensagem || "";
}


function traduzirErroAuth(error) {
  const mensagem =
    normalizarTexto(
      error?.message || ""
    );

  if (
    mensagem.includes(
      "user already registered"
    ) ||
    mensagem.includes(
      "already been registered"
    )
  ) {
    return "Este e-mail já possui uma conta.";
  }

  if (
    mensagem.includes(
      "invalid login credentials"
    )
  ) {
    return "E-mail ou senha incorretos.";
  }

  if (
    mensagem.includes(
      "password should be at least"
    )
  ) {
    return "A senha precisa ter pelo menos 6 caracteres.";
  }

  if (
    mensagem.includes(
      "email rate limit"
    )
  ) {
    return "Muitas tentativas. Aguarde alguns instantes e tente novamente.";
  }

  return (
    error?.message ||
    "Não foi possível concluir a operação."
  );
}


/* =========================================================
   CADASTRO
========================================================= */

async function cadastrarUsuario() {
  const erro =
    document.getElementById(
      "erroCadastro"
    );

  const botao =
    document.getElementById(
      "botaoCadastro"
    );

  if (!supabaseClient) {
    mostrarErroAuth(
      erro,
      "Sistema de cadastro indisponível."
    );

    return;
  }

  const nome =
    document
      .getElementById(
        "cadastroNome"
      )
      ?.value
      .trim();

  const email =
    document
      .getElementById(
        "cadastroEmail"
      )
      ?.value
      .trim();

  const senha =
    document
      .getElementById(
        "cadastroSenha"
      )
      ?.value || "";

  const confirmarSenha =
    document
      .getElementById(
        "cadastroConfirmarSenha"
      )
      ?.value || "";

  mostrarErroAuth(
    erro,
    ""
  );

  if (!nome || nome.length < 2) {
    mostrarErroAuth(
      erro,
      "Digite seu nome."
    );

    return;
  }

  if (
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      email
    )
  ) {
    mostrarErroAuth(
      erro,
      "Digite um e-mail válido."
    );

    return;
  }

  if (senha.length < 6) {
    mostrarErroAuth(
      erro,
      "A senha precisa ter pelo menos 6 caracteres."
    );

    return;
  }

  if (
    senha !==
    confirmarSenha
  ) {
    mostrarErroAuth(
      erro,
      "As senhas não coincidem."
    );

    return;
  }

  if (botao) {
    botao.disabled = true;
    botao.textContent =
      "Criando conta...";
  }

  try {
    const {
      data,
      error
    } =
      await supabaseClient.auth.signUp({
        email,
        password: senha,

        options: {
          data: {
            nome
          }
        }
      });

    if (error) {
      throw error;
    }

    if (
      data?.session &&
      data?.user
    ) {
      await mostrarUsuarioLogado(
        data.user
      );

      fecharModalAuth();

      return;
    }

    mostrarFormularioAuth(
      "login"
    );

    const loginEmail =
      document.getElementById(
        "loginEmail"
      );

    if (loginEmail) {
      loginEmail.value =
        email;
    }

    mostrarErroAuth(
      document.getElementById(
        "erroLogin"
      ),
      "Conta criada. Agora faça login."
    );
  } catch (error) {
    console.error(
      "Erro ao criar conta:",
      error
    );

    mostrarErroAuth(
      erro,
      traduzirErroAuth(error)
    );
  } finally {
    if (botao) {
      botao.disabled = false;
      botao.textContent =
        "Criar conta";
    }
  }
}


/* =========================================================
   LOGIN
========================================================= */

async function fazerLogin() {
  const erro =
    document.getElementById(
      "erroLogin"
    );

  const botao =
    document.getElementById(
      "botaoLogin"
    );

  if (!supabaseClient) {
    mostrarErroAuth(
      erro,
      "Sistema de login indisponível."
    );

    return;
  }

  const email =
    document
      .getElementById(
        "loginEmail"
      )
      ?.value
      .trim();

  const senha =
    document
      .getElementById(
        "loginSenha"
      )
      ?.value || "";

  mostrarErroAuth(
    erro,
    ""
  );

  if (
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      email
    )
  ) {
    mostrarErroAuth(
      erro,
      "Digite um e-mail válido."
    );

    return;
  }

  if (!senha) {
    mostrarErroAuth(
      erro,
      "Digite sua senha."
    );

    return;
  }

  if (botao) {
    botao.disabled = true;
    botao.textContent =
      "Entrando...";
  }

  try {
    const {
      data,
      error
    } =
      await supabaseClient.auth.signInWithPassword({
        email,
        password: senha
      });

    if (error) {
      throw error;
    }

    await mostrarUsuarioLogado(
      data.user
    );

    fecharModalAuth();
  } catch (error) {
    console.error(
      "Erro ao fazer login:",
      error
    );

    mostrarErroAuth(
      erro,
      "E-mail ou senha incorretos."
    );
  } finally {
    if (botao) {
      botao.disabled = false;
      botao.textContent =
        "Entrar";
    }
  }
}


/* =========================================================
   LOGOUT
========================================================= */

async function sairUsuario() {
  if (!supabaseClient) {
    return;
  }

  try {
    const {
      error
    } =
      await supabaseClient.auth.signOut();

    if (error) {
      throw error;
    }

    mostrarUsuarioDeslogado();

    await carregarVotosPessoas();

    renderizarPessoas();

    fecharModalAuth();
  } catch (erro) {
    console.error(
      "Erro ao sair:",
      erro
    );

    alert(
      "Não foi possível sair da conta."
    );
  }
}


async function fazerLogout() {
  await sairUsuario();
}


/* =========================================================
   EVENTOS DE AUTENTICAÇÃO
========================================================= */

function configurarEventosAuth() {
  criarInterfaceAuth();

  const abrirLoginBotao =
    document.getElementById(
      "abrirLogin"
    );

  const abrirCadastroBotao =
    document.getElementById(
      "abrirCadastro"
    );

  const fecharAuthBotao =
    document.getElementById(
      "fecharAuth"
    );

  const trocarCadastroBotao =
    document.getElementById(
      "trocarCadastro"
    );

  const trocarLoginBotao =
    document.getElementById(
      "trocarLogin"
    );

  const botaoLogin =
    document.getElementById(
      "botaoLogin"
    );

  const botaoCadastro =
    document.getElementById(
      "botaoCadastro"
    );

  const botaoSair =
    document.getElementById(
      "botaoSair"
    );

  if (abrirLoginBotao) {
    abrirLoginBotao.onclick =
      () =>
        abrirModalAuth("login");
  }

  if (abrirCadastroBotao) {
    abrirCadastroBotao.onclick =
      () =>
        abrirModalAuth("cadastro");
  }

  if (fecharAuthBotao) {
    fecharAuthBotao.onclick =
      fecharModalAuth;
  }

  if (trocarCadastroBotao) {
    trocarCadastroBotao.onclick =
      () =>
        mostrarFormularioAuth(
          "cadastro"
        );
  }

  if (trocarLoginBotao) {
    trocarLoginBotao.onclick =
      () =>
        mostrarFormularioAuth(
          "login"
        );
  }

  if (botaoLogin) {
    botaoLogin.onclick =
      fazerLogin;
  }

  if (botaoCadastro) {
    botaoCadastro.onclick =
      cadastrarUsuario;
  }

  if (botaoSair) {
    botaoSair.onclick =
      sairUsuario;
  }

  const formLogin =
    document.getElementById(
      "formLogin"
    );

  const formCadastro =
    document.getElementById(
      "formCadastro"
    );

  if (formLogin) {
    formLogin.onsubmit =
      event => {
        event.preventDefault();
        fazerLogin();
      };
  }

  if (formCadastro) {
    formCadastro.onsubmit =
      event => {
        event.preventDefault();
        cadastrarUsuario();
      };
  }

  const modal =
    document.getElementById(
      "authModal"
    );

  if (modal) {
    modal.onclick =
      event => {
        if (
          event.target ===
            modal ||
          event.target?.hasAttribute(
            "data-auth-fechar"
          )
        ) {
          fecharModalAuth();
        }
      };
  }
}


/* =========================================================
   AUTENTICAÇÃO — ESTADO INICIAL
========================================================= */

async function inicializarAutenticacao() {
  if (!supabaseClient) {
    return;
  }

  try {
    const {
      data,
      error
    } =
      await supabaseClient.auth.getSession();

    if (error) {
      throw error;
    }

    usuarioAtual =
      data?.session?.user ||
      null;

    window.usuarioAtualSupabase =
      usuarioAtual;

    if (usuarioAtual) {
      await mostrarUsuarioLogado(
        usuarioAtual
      );
    } else {
      mostrarUsuarioDeslogado();
    }
  } catch (erro) {
    console.error(
      "Erro ao verificar sessão:",
      erro
    );

    usuarioAtual = null;

    window.usuarioAtualSupabase =
      null;
  }

  supabaseClient.auth.onAuthStateChange(
    (evento, sessao) => {
      setTimeout(
        async () => {
          usuarioAtual =
            sessao?.user ||
            null;

          window.usuarioAtualSupabase =
            usuarioAtual;

          if (usuarioAtual) {
            await mostrarUsuarioLogado(
              usuarioAtual
            );
          } else {
            mostrarUsuarioDeslogado();

            await carregarVotosPessoas();

            renderizarPessoas();
          }
        },
        0
      );
    }
  );
}


/* =========================================================
   BOTÃO DO MURAL
========================================================= */

function adicionarBotaoLoginMural() {
  const secao =
    document.getElementById(
      "pessoas"
    );

  if (!secao) {
    return;
  }

  if (
    document.getElementById(
      "abrirLogin"
    ) ||
    document.getElementById(
      "botaoLoginMural"
    )
  ) {
    atualizarBotaoLoginMural();
    return;
  }

  const header =
    secao.querySelector(
      ".content-header"
    );

  if (!header) {
    return;
  }

  const area =
    document.createElement("div");

  area.id =
    "botaoLoginMural";

  area.style.marginTop =
    "14px";

  area.innerHTML = `
    <button
      type="button"
      class="status-filtro"
      id="abrirLoginMuralBotao"
    >
      Entrar para votar
    </button>
  `;

  header.appendChild(area);

  const botao =
    document.getElementById(
      "abrirLoginMuralBotao"
    );

  if (botao) {
    botao.onclick =
      () =>
        abrirModalAuth("login");
  }

  atualizarBotaoLoginMural();
}


function atualizarBotaoLoginMural() {
  const botao =
    document.getElementById(
      "abrirLoginMuralBotao"
    );

  if (!botao) {
    return;
  }

  if (usuarioAtual) {
    botao.textContent =
      "Minha conta";
  } else {
    botao.textContent =
      "Entrar para votar";
  }
}


/* =========================================================
   PAGINAÇÃO — EVENTOS
========================================================= */

function configurarPaginacao() {
  if (mostrarMaisVisitar) {
    mostrarMaisVisitar.onclick =
      () => {
        limiteVisitar +=
          LIMITE_INCREMENTO;

        renderizarOQueVisitar();
      };
  }

  if (mostrarMaisComer) {
    mostrarMaisComer.onclick =
      () => {
        limiteComer +=
          LIMITE_INCREMENTO;

        renderizarComercios();
      };
  }

  if (mostrarMaisComercio) {
    mostrarMaisComercio.onclick =
      () => {
        limiteComercio +=
          LIMITE_INCREMENTO;

        renderizarComercioLocal();
      };
  }

  if (mostrarMaisFicar) {
    mostrarMaisFicar.onclick =
      () => {
        limiteFicar +=
          LIMITE_INCREMENTO;

        renderizarHospedagens();
      };
  }

  if (mostrarMaisPessoas) {
    mostrarMaisPessoas.onclick =
      () => {
        limitePessoas +=
          LIMITE_INCREMENTO;

        renderizarPessoas();
      };
  }
}


/* =========================================================
   ATUALIZAR ELEMENTOS DO DOM
========================================================= */

function capturarElementos() {
  heroCarousel =
    document.getElementById(
      "heroCarousel"
    );

  heroText =
    document.getElementById(
      "heroText"
    );

  visitarList =
    document.getElementById(
      "visitarList"
    );

  mostrarMaisVisitar =
    document.getElementById(
      "mostrarMaisVisitar"
    );

  comerList =
    document.getElementById(
      "comerList"
    );

  mostrarMaisComer =
    document.getElementById(
      "mostrarMaisComer"
    );

  filtroAberto =
    document.getElementById(
      "filtroAberto"
    );

  textoStatus =
    document.getElementById(
      "textoStatus"
    );

  comercioList =
    document.getElementById(
      "comercioList"
    );

  mostrarMaisComercio =
    document.getElementById(
      "mostrarMaisComercio"
    );

  pesquisaComercio =
    document.getElementById(
      "pesquisaComercio"
    );

  filtroAbertoComercio =
    document.getElementById(
      "filtroAbertoComercio"
    );

  textoStatusComercio =
    document.getElementById(
      "textoStatusComercio"
    );

  ficarList =
    document.getElementById(
      "ficarList"
    );

  mostrarMaisFicar =
    document.getElementById(
      "mostrarMaisFicar"
    );

  pessoasList =
    document.getElementById(
      "pessoasList"
    );

  mostrarMaisPessoas =
    document.getElementById(
      "mostrarMaisPessoas"
    );
}


/* =========================================================
   ATUALIZAR HORÁRIOS
========================================================= */

function iniciarAtualizacaoPeriodica() {
  setInterval(
    () => {
      if (
        dadosComercios.length ===
        0
      ) {
        return;
      }

      atualizarStatusBotao();

      atualizarStatusComercio();

      renderizarComercios();

      renderizarComercioLocal();
    },
    60000
  );
}


/* =========================================================
   RESIZE DO MAPA
========================================================= */

function configurarResizeMapa() {
  window.addEventListener(
    "resize",
    () => {
      if (homeMap) {
        setTimeout(
          () => {
            homeMap.invalidateSize();
          },
          100
        );
      }
    }
  );
}


/* =========================================================
   TECLA ESC
========================================================= */

function configurarTeclaEscape() {
  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key ===
        "Escape"
      ) {
        fecharModalAuth();
      }
    }
  );
}


/* =========================================================
   INICIALIZAÇÃO
========================================================= */

async function iniciarSite() {
  console.log(
    "Iniciando Andrelândia — Guia Turístico..."
  );

  capturarElementos();

  adicionarEstiloMarcadorGenerico();

  inicializarMapa();

  descobrirSlidesHero();

  /*
   * Configura os filtros antes dos dados
   * para que os eventos já estejam prontos.
   */

  configurarFiltrosMapa();

  configurarFiltrosComer();

  configurarBotaoFiltroAberto();

  configurarComercioLocal();

  configurarPaginacao();

  configurarResizeMapa();

  configurarTeclaEscape();

  configurarEventosAuth();

  await inicializarAutenticacao();

  adicionarBotaoLoginMural();

  await carregarDados();

  await carregarPessoas();

  atualizarBotaoLoginMural();

  console.log(
    "Site inicializado com sucesso."
  );
}


/* =========================================================
   INICIAR SOMENTE QUANDO O DOM EXISTIR
========================================================= */

if (
  document.readyState ===
  "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    iniciarSite,
    {
      once: true
    }
  );
} else {
  iniciarSite();
}


/* =========================================================
   ATUALIZAÇÃO AUTOMÁTICA
========================================================= */

iniciarAtualizacaoPeriodica();