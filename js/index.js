/* =========================================================
   ANDRELÂNDIA — GUIA TURÍSTICO
   INDEX.JS
   ========================================================= */


/* =========================================================
   CONFIGURAÇÕES GERAIS
   ========================================================= */

const CENTRO_ANDRELANDIA = {
  latitude: -21.740150,
  longitude: -44.309058
};

const LIMITE_INICIAL = 10;
const LIMITE_INCREMENTO = 10;

const FALLBACK_IMAGE = "./img/sem-foto.png";


/* =========================================================
   SUPABASE
   ========================================================= */

const SUPABASE_URL =
  "https://xdmbkflufsfqziixzpxc.supabase.co";

const SUPABASE_KEY =
  "sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";

const supabaseClient =
  window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
  );


/* =========================================================
   VARIÁVEIS GLOBAIS
   ========================================================= */

let dadosLocais = [];
let dadosComercios = [];
let dadosHospedagem = [];

let avaliacoes = [];

let pessoas = [];
let votosPessoas = [];

let usuarioAtual = null;

let homeMap = null;

let marcadores = [];

let limiteVisitar = LIMITE_INICIAL;
let limiteComer = LIMITE_INICIAL;
let limiteComercio = LIMITE_INICIAL;
let limitePessoas = LIMITE_INICIAL;

let indiceSlideHero = 0;
let intervaloHero = null;


/* =========================================================
   UTILITÁRIOS
   ========================================================= */

function normalizarTexto(texto) {

  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
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


function obterImagem(item) {

  if (!item) {
    return FALLBACK_IMAGE;
  }

  return (
    item.capa ||
    item.imagem ||
    item.foto ||
    item.fotoPrincipal ||
    item.imagemPrincipal ||
    FALLBACK_IMAGE
  );

}


function criarLinkLocal(id) {

  return `./pages/local.html?id=${encodeURIComponent(id)}`;

}


function formatarNumero(numero) {

  const valor = Number(numero);

  if (!Number.isFinite(valor)) {
    return "";
  }

  return valor
    .toFixed(1)
    .replace(".", ",");

}


/* =========================================================
   DISTÂNCIA
   ========================================================= */

function calcularDistanciaKm(
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


function obterDistanciaDoItem(item) {

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
    return null;
  }

  return calcularDistanciaKm(
    CENTRO_ANDRELANDIA.latitude,
    CENTRO_ANDRELANDIA.longitude,
    latitude,
    longitude
  );

}


/* =========================================================
   HORÁRIOS
   ========================================================= */

function converterHorarioParaMinutos(horario) {

  if (!horario) {
    return null;
  }

  const texto = String(horario).trim();

  const correspondencia =
    texto.match(
      /(\d{1,2})(?::(\d{2}))?/
    );

  if (!correspondencia) {
    return null;
  }

  const horas =
    Number(correspondencia[1]);

  const minutos =
    Number(correspondencia[2] || 0);

  if (
    horas < 0 ||
    horas > 23 ||
    minutos < 0 ||
    minutos > 59
  ) {
    return null;
  }

  return horas * 60 + minutos;

}


function obterDiaAtual() {

  const dias = [
    "domingo",
    "segunda",
    "terca",
    "quarta",
    "quinta",
    "sexta",
    "sabado"
  ];

  return dias[new Date().getDay()];
}


function obterHorarioDoDia(comercio) {

  if (!comercio) {
    return null;
  }

  const horario = comercio.horario;

  if (!horario) {
    return null;
  }

  if (typeof horario === "object") {

    const dia = obterDiaAtual();

    return (
      horario[dia] ||
      horario[
        dia === "terca"
          ? "terça"
          : dia
      ] ||
      null
    );

  }

  return horario;

}


function comercioEstaAberto(comercio) {

  const horario =
    obterHorarioDoDia(comercio);

  if (!horario) {
    return false;
  }

  const texto =
    String(horario)
      .toLowerCase()
      .trim();

  if (
    texto.includes("fechado") ||
    texto.includes("encerrado")
  ) {
    return false;
  }

  if (
    texto.includes("24h") ||
    texto.includes("24 horas")
  ) {
    return true;
  }

  const agora = new Date();

  const minutosAgora =
    agora.getHours() * 60 +
    agora.getMinutes();

  const intervalos =
    texto.split(/\s*(?:e|\/|;)\s*/i);

  for (const intervalo of intervalos) {

    const horarios =
      intervalo.match(
        /(\d{1,2}(?::\d{2})?)\s*(?:-|–|—|às|as)\s*(\d{1,2}(?::\d{2})?)/i
      );

    if (!horarios) {
      continue;
    }

    const inicio =
      converterHorarioParaMinutos(
        horarios[1]
      );

    const fim =
      converterHorarioParaMinutos(
        horarios[2]
      );

    if (
      inicio === null ||
      fim === null
    ) {
      continue;
    }

    if (fim < inicio) {

      if (
        minutosAgora >= inicio ||
        minutosAgora <= fim
      ) {
        return true;
      }

    } else {

      if (
        minutosAgora >= inicio &&
        minutosAgora <= fim
      ) {
        return true;
      }

    }

  }

  return false;

}


/* =========================================================
   AVALIAÇÕES
   ========================================================= */

async function carregarAvaliacoes() {

  try {

    const {
      data,
      error
    } =
      await supabaseClient
        .from("avaliacoes")
        .select("local_id, nota");

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
      "Erro inesperado nas avaliações:",
      erro
    );

    avaliacoes = [];

  }

}


function obterAvaliacaoLocal(localId) {

  const lista =
    avaliacoes.filter(
      avaliacao =>
        String(avaliacao.local_id) ===
        String(localId)
    );

  if (lista.length === 0) {
    return null;
  }

  const notas =
    lista
      .map(item => Number(item.nota))
      .filter(Number.isFinite);

  if (notas.length === 0) {
    return null;
  }

  const soma =
    notas.reduce(
      (total, nota) =>
        total + nota,
      0
    );

  return soma / notas.length;

}


function criarHTMLAvaliacao(localId) {

  const nota =
    obterAvaliacaoLocal(localId);

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
        ${formatarNumero(nota)}
      </span>
    </div>
  `;

}


/* =========================================================
   CARROSSEL HERO
   ========================================================= */

async function verificarImagemExiste(caminho) {

  return new Promise(resolve => {

    const imagem =
      new Image();

    imagem.onload = () =>
      resolve(true);

    imagem.onerror = () =>
      resolve(false);

    imagem.src =
      caminho;

  });

}


async function descobrirSlidesHero() {

  const carousel =
    document.getElementById(
      "heroCarousel"
    );

  if (!carousel) {
    return;
  }

  clearInterval(
    intervaloHero
  );

  indiceSlideHero = 0;

  carousel.innerHTML = "";

  const caminhos = [];

  /*
     Estrutura 1:
     img/hero/hero1.jpg
     img/hero/hero2.jpg
     ...

     Estrutura 2:
     img/hero1.jpg
     img/hero2.jpg
     ...

     Estrutura 3:
     img/hero.png
  */

  const extensoes = [
    "jpg",
    "jpeg",
    "png",
    "webp"
  ];

  for (let i = 1; i <= 30; i++) {

    for (const extensao of extensoes) {

      caminhos.push(
        `./img/hero/hero${i}.${extensao}`
      );

    }

  }

  for (let i = 1; i <= 30; i++) {

    for (const extensao of extensoes) {

      caminhos.push(
        `./img/hero${i}.${extensao}`
      );

    }

  }

  caminhos.push(
    "./img/hero.png",
    "./img/hero.jpg",
    "./img/hero.webp",
    "./img/hero.jpeg"
  );

  const encontrados = [];

  for (const caminho of caminhos) {

    const existe =
      await verificarImagemExiste(
        caminho
      );

    if (existe) {

      if (
        !encontrados.includes(caminho)
      ) {
        encontrados.push(caminho);
      }

    }

    /*
       Depois de encontrar uma quantidade
       razoável de imagens, evitamos
       procurar infinitamente.
    */

    if (
      encontrados.length >= 10
    ) {
      break;
    }

  }

  if (encontrados.length === 0) {

    console.warn(
      "Nenhuma imagem do carrossel foi encontrada."
    );

    return;

  }

  encontrados.forEach(
    (caminho, indice) => {

      const slide =
        document.createElement(
          "div"
        );

      slide.className =
        "hero-slide";

      if (indice === 0) {
        slide.classList.add(
          "active"
        );
      }

      slide.style.backgroundImage =
        `url("${caminho}")`;

      carousel.appendChild(
        slide
      );

    }
  );

  criarIndicadoresHero(
    encontrados.length
  );

  iniciarCarrosselHero();

  console.log(
    "Imagens do hero encontradas:",
    encontrados
  );

}


function criarIndicadoresHero(quantidade) {

  const carousel =
    document.getElementById(
      "heroCarousel"
    );

  if (!carousel) {
    return;
  }

  let indicadores =
    document.querySelector(
      ".hero-indicators"
    );

  if (!indicadores) {

    indicadores =
      document.createElement(
        "div"
      );

    indicadores.className =
      "hero-indicators";

    carousel.appendChild(
      indicadores
    );

  }

  indicadores.innerHTML = "";

  for (
    let i = 0;
    i < quantidade;
    i++
  ) {

    const botao =
      document.createElement(
        "button"
      );

    botao.type = "button";

    botao.className =
      "hero-indicator";

    if (i === 0) {
      botao.classList.add(
        "active"
      );
    }

    botao.setAttribute(
      "aria-label",
      `Ir para imagem ${i + 1}`
    );

    botao.addEventListener(
      "click",
      () => {

        mostrarSlideHero(i);

        reiniciarCarrosselHero();

      }
    );

    indicadores.appendChild(
      botao
    );

  }

}


function mostrarSlideHero(indice) {

  const slides =
    document.querySelectorAll(
      ".hero-slide"
    );

  if (!slides.length) {
    return;
  }

  if (
    indice < 0 ||
    indice >= slides.length
  ) {
    indice = 0;
  }

  indiceSlideHero =
    indice;

  slides.forEach(
    (slide, i) => {

      slide.classList.toggle(
        "active",
        i === indice
      );

    }
  );

  const indicadores =
    document.querySelectorAll(
      ".hero-indicator"
    );

  indicadores.forEach(
    (indicador, i) => {

      indicador.classList.toggle(
        "active",
        i === indice
      );

    }
  );

}


function proximoSlideHero() {

  const slides =
    document.querySelectorAll(
      ".hero-slide"
    );

  if (slides.length <= 1) {
    return;
  }

  const proximo =
    (indiceSlideHero + 1) %
    slides.length;

  mostrarSlideHero(
    proximo
  );

}


function iniciarCarrosselHero() {

  clearInterval(
    intervaloHero
  );

  const slides =
    document.querySelectorAll(
      ".hero-slide"
    );

  if (slides.length <= 1) {
    return;
  }

  intervaloHero =
    setInterval(
      proximoSlideHero,
      5000
    );

}


function reiniciarCarrosselHero() {

  iniciarCarrosselHero();

}


/* =========================================================
   MAPA
   ========================================================= */

function inicializarMapa() {

  const elemento =
    document.getElementById(
      "homeMap"
    );

  if (
    !elemento ||
    typeof L === "undefined"
  ) {
    console.warn(
      "Mapa ou Leaflet não encontrado."
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
  ).addTo(
    homeMap
  );

  L.control.zoom({
    position: "bottomright"
  }).addTo(
    homeMap
  );

}


function obterGrupoCategoriaMapa(
  categoria
) {

  const texto =
    normalizarTexto(
      categoria
    );

  if (
    texto.includes("igreja") ||
    texto.includes("capela")
  ) {
    return "igreja";
  }

  if (
    texto.includes("histor") ||
    texto.includes("patrimonio") ||
    texto.includes("ferrovi") ||
    texto.includes("estacao")
  ) {
    return "historico";
  }

  if (
    texto.includes("natureza") ||
    texto.includes("cachoeira") ||
    texto.includes("mirante") ||
    texto.includes("parque") ||
    texto.includes("trilha") ||
    texto.includes("pedra")
  ) {
    return "natureza";
  }

  if (
    texto.includes("aliment") ||
    texto.includes("restaurante") ||
    texto.includes("lanch") ||
    texto.includes("sorvete") ||
    texto.includes("acai") ||
    texto.includes("pizzaria") ||
    texto.includes("hamburg")
  ) {
    return "alimentacao";
  }

  if (
    texto.includes("cafe") ||
    texto.includes("cafeteria")
  ) {
    return "cafe";
  }

  if (
    texto.includes("hosped") ||
    texto.includes("hotel") ||
    texto.includes("pousada")
  ) {
    return "hospedagem";
  }

  if (
    texto.includes("comerc") ||
    texto.includes("loja") ||
    texto.includes("mercado") ||
    texto.includes("servico")
  ) {
    return "comercio";
  }

  if (
    texto.includes("esport") ||
    texto.includes("academia") ||
    texto.includes("futebol")
  ) {
    return "esporte";
  }

  if (
    texto.includes("cultura") ||
    texto.includes("artista")
  ) {
    return "cultura";
  }

  return "outros";

}


function criarIconeMapa(
  grupo
) {

  const arquivos = {

    igreja:
      "./img/marcadores/igreja.png",

    historico:
      "./img/marcadores/historico.png",

    natureza:
      "./img/marcadores/natureza.png",

    alimentacao:
      "./img/marcadores/alimentacao.png",

    cafe:
      "./img/marcadores/alimentacao.png",

    hospedagem:
      "./img/marcadores/hotel.png",

    comercio:
      "./img/marcadores/comercio.png",

    esporte:
      "./img/marcadores/esporte.png",

    cultura:
      "./img/marcadores/cultura.png"

  };

  const arquivo =
    arquivos[grupo];

  if (!arquivo) {

    return L.divIcon({
      className:
        "marcador-padrao",
      html:
        '<div class="marcador-padrao-bolinha"></div>',
      iconSize: [
        28,
        28
      ],
      iconAnchor: [
        14,
        28
      ],
      popupAnchor: [
        0,
        -28
      ]
    });

  }

  return L.icon({

    iconUrl:
      arquivo,

    iconSize: [
      38,
      38
    ],

    iconAnchor: [
      19,
      38
    ],

    popupAnchor: [
      0,
      -38
    ]

  });

}


function obterCoordenadasItem(
  item
) {

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
    return null;
  }

  return {
    latitude,
    longitude
  };

}


function adicionarMarcador(
  item,
  origem
) {

  if (!homeMap || !item) {
    return;
  }

  const coordenadas =
    obterCoordenadasItem(
      item
    );

  if (!coordenadas) {
    return;
  }

  const categoria =
    item.categoria ||
    item.tipo ||
    item.grupo ||
    "";

  const grupo =
    obterGrupoCategoriaMapa(
      categoria
    );

  const nome =
    item.nome ||
    item.titulo ||
    "Local";

  const id =
    item.id ||
    "";

  const imagem =
    obterImagem(item);

  let link =
    criarLinkLocal(id);

  if (
    origem === "comercio" ||
    origem === "hospedagem"
  ) {
    link =
      criarLinkLocal(id);
  }

  const marcador =
    L.marker(
      [
        coordenadas.latitude,
        coordenadas.longitude
      ],
      {
        icon:
          criarIconeMapa(
            grupo
          )
      }
    );

  const avaliacaoHTML =
    criarHTMLAvaliacao(
      id
    );

  const popup =
    `
      <div class="map-popup">

        <img
          src="${escaparHTML(imagem)}"
          alt="${escaparHTML(nome)}"
          class="map-popup-image"
          onerror="this.src='${FALLBACK_IMAGE}'"
        >

        <div class="map-popup-content">

          <h3>
            ${escaparHTML(nome)}
          </h3>

          ${
            avaliacaoHTML
              ? `
                <div class="map-popup-avaliacao">
                  ${avaliacaoHTML}
                </div>
              `
              : ""
          }

          <a
            href="${link}"
            class="popup-button"
          >
            Ver detalhes
          </a>

        </div>

      </div>
    `;

  marcador.bindPopup(
    popup
  );

  marcador.addTo(
    homeMap
  );

  marcadores.push({

    marcador,

    categoria,

    grupo,

    id,

    nome,

    origem

  });

}


function limparMarcadoresMapa() {

  if (!homeMap) {
    return;
  }

  marcadores.forEach(
    registro => {

      if (
        registro?.marcador &&
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

}


function aplicarFiltroMapa(
  categoria
) {

  if (!homeMap) {
    return;
  }

  const filtro =
    normalizarTexto(
      categoria
    ) || "todos";

  marcadores.forEach(
    registro => {

      const mostrar =
        filtro === "todos" ||
        registro.grupo === filtro;

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


function obterCategoriaDoBotaoMapa(
  botao
) {

  if (!botao) {
    return "todos";
  }

  const valor =
    botao.dataset.categoria ||
    botao.dataset.category ||
    botao.dataset.filtro ||
    "";

  if (valor) {

    const grupo =
      normalizarTexto(
        valor
      );

    const gruposValidos = [
      "todos",
      "igreja",
      "historico",
      "natureza",
      "alimentacao",
      "cafe",
      "hospedagem",
      "comercio",
      "esporte",
      "cultura"
    ];

    if (
      gruposValidos.includes(
        grupo
      )
    ) {
      return grupo;
    }

    return obterGrupoCategoriaMapa(
      grupo
    );

  }

  const texto =
    normalizarTexto(
      botao.textContent
    );

  if (
    texto.includes("todos")
  ) {
    return "todos";
  }

  if (
    texto.includes("igreja")
  ) {
    return "igreja";
  }

  if (
    texto.includes("histor")
  ) {
    return "historico";
  }

  if (
    texto.includes("natureza")
  ) {
    return "natureza";
  }

  if (
    texto.includes("aliment")
  ) {
    return "alimentacao";
  }

  if (
    texto.includes("cafe")
  ) {
    return "cafe";
  }

  if (
    texto.includes("hosped")
  ) {
    return "hospedagem";
  }

  if (
    texto.includes("comerc")
  ) {
    return "comercio";
  }

  if (
    texto.includes("esport")
  ) {
    return "esporte";
  }

  if (
    texto.includes("cultura")
  ) {
    return "cultura";
  }

  return "todos";

}


function configurarFiltrosMapa() {

  const botoes =
    document.querySelectorAll(
      ".map-filter"
    );

  if (!botoes.length) {
    return;
  }

  botoes.forEach(
    botao => {

      if (
        botao.dataset.filtroConfigurado ===
        "true"
      ) {
        return;
      }

      botao.dataset.filtroConfigurado =
        "true";

      botao.addEventListener(
        "click",
        () => {

          botoes.forEach(
            item =>
              item.classList.remove(
                "active"
              )
          );

          botao.classList.add(
            "active"
          );

          const categoria =
            obterCategoriaDoBotaoMapa(
              botao
            );

          aplicarFiltroMapa(
            categoria
          );

        }
      );

    }
  );

  let botaoTodos = null;

  botoes.forEach(
    botao => {

      const categoria =
        obterCategoriaDoBotaoMapa(
          botao
        );

      if (
        categoria === "todos" &&
        !botaoTodos
      ) {
        botaoTodos = botao;
      }

    }
  );

  if (botaoTodos) {

    botoes.forEach(
      item =>
        item.classList.remove(
          "active"
        )
    );

    botaoTodos.classList.add(
      "active"
    );

  }

  aplicarFiltroMapa(
    "todos"
  );

}


/* =========================================================
   RENDERIZAÇÃO — VISITAR
   ========================================================= */

function renderizarVisitar() {

  const lista =
    document.getElementById(
      "visitarList"
    );

  if (!lista) {
    return;
  }

  const itens =
    dadosLocais.slice(
      0,
      limiteVisitar
    );

  lista.innerHTML = "";

  itens.forEach(
    local => {

      const imagem =
        obterImagem(local);

      const distancia =
        obterDistanciaDoItem(
          local
        );

      const avaliacao =
        criarHTMLAvaliacao(
          local.id
        );

      const article =
        document.createElement(
          "article"
        );

      article.className =
        "local-card";

      article.innerHTML = `

        <a
          href="${criarLinkLocal(local.id)}"
          class="local-card-link"
        >

          <img
            src="${escaparHTML(imagem)}"
            alt="${escaparHTML(local.nome || "Local")}"
            class="local-card-image"
            onerror="this.src='${FALLBACK_IMAGE}'"
          >

          <div class="local-card-content">

            <h3>
              ${escaparHTML(local.nome || "")}
            </h3>

            ${
              local.categoria
                ? `
                  <div class="local-card-category">
                    ${escaparHTML(local.categoria)}
                  </div>
                `
                : ""
            }

            ${
              local.descricao
                ? `
                  <p>
                    ${escaparHTML(local.descricao)}
                  </p>
                `
                : ""
            }

            <div class="local-card-footer">

              ${
                distancia !== null
                  ? `
                    <span>
                      ${distancia.toFixed(1).replace(".", ",")} km
                    </span>
                  `
                  : ""
              }

              ${
                avaliacao
                  ? avaliacao
                  : ""
              }

            </div>

          </div>

        </a>

      `;

      lista.appendChild(
        article
      );

    }
  );

  const botao =
    document.getElementById(
      "mostrarMaisVisitar"
    );

  if (botao) {

    botao.style.display =
      limiteVisitar <
      dadosLocais.length
        ? ""
        : "none";

  }

}


/* =========================================================
   RENDERIZAÇÃO — COMER
   ========================================================= */

function renderizarComer() {

  const lista =
    document.getElementById(
      "comerList"
    );

  if (!lista) {
    return;
  }

  const termo =
    normalizarTexto(
      document.getElementById(
        "pesquisaComer"
      )?.value
    );

  const filtro =
    normalizarTexto(
      document.getElementById(
        "filtroAberto"
      )?.value
    );

  let dados =
    dadosComercios.slice();

  if (termo) {

    dados =
      dados.filter(
        comercio => {

          const texto =
            normalizarTexto(
              [
                comercio.nome,
                comercio.categoria,
                comercio.descricao,
                comercio.endereco
              ]
                .filter(Boolean)
                .join(" ")
            );

          return texto.includes(
            termo
          );

        }
      );

  }

  if (
    filtro === "aberto" ||
    filtro === "abertos"
  ) {

    dados =
      dados.filter(
        comercio =>
          comercioEstaAberto(
            comercio
          )
      );

  }

  if (
    filtro === "fechado" ||
    filtro === "fechados"
  ) {

    dados =
      dados.filter(
        comercio =>
          !comercioEstaAberto(
            comercio
          )
      );

  }

  const itens =
    dados.slice(
      0,
      limiteComer
    );

  lista.innerHTML = "";

  itens.forEach(
    comercio => {

      const imagem =
        obterImagem(
          comercio
        );

      const aberto =
        comercioEstaAberto(
          comercio
        );

      const textoStatusCard =
        aberto
          ? "Aberto agora"
          : "Fechado";

      const classeStatusCard =
        aberto
          ? "aberto"
          : "fechado";

      const avaliacaoHTML =
        criarHTMLAvaliacao(
          comercio.id
        );

      const article =
        document.createElement(
          "article"
        );

      article.className =
        "comer-card";

      article.innerHTML = `

        <a
          href="${criarLinkLocal(comercio.id)}"
          class="comer-card-link"
        >

          <img
            src="${escaparHTML(imagem)}"
            alt="${escaparHTML(comercio.nome || "Comércio")}"
            class="comer-card-image"
            onerror="this.src='${FALLBACK_IMAGE}'"
          >

          <div class="comer-card-content">

            <h3>
              ${escaparHTML(comercio.nome || "")}
            </h3>

            ${
              comercio.categoria
                ? `
                  <div class="comer-categoria">
                    ${escaparHTML(comercio.categoria)}
                  </div>
                `
                : ""
            }

            <div class="comer-status-linha">

              <div
                class="comer-horario ${classeStatusCard}"
              >
                ${textoStatusCard}
              </div>

              ${avaliacaoHTML}

            </div>

          </div>

        </a>

      `;

      lista.appendChild(
        article
      );

    }
  );

  const botao =
    document.getElementById(
      "mostrarMaisComer"
    );

  if (botao) {

    botao.style.display =
      limiteComer <
      dados.length
        ? ""
        : "none";

  }

}


/* =========================================================
   RENDERIZAÇÃO — COMÉRCIO LOCAL
   ========================================================= */

function renderizarComercio() {

  const lista =
    document.getElementById(
      "comercioList"
    );

  if (!lista) {
    return;
  }

  const termo =
    normalizarTexto(
      document.getElementById(
        "pesquisaComercio"
      )?.value
    );

  const filtro =
    normalizarTexto(
      document.getElementById(
        "filtroAbertoComercio"
      )?.value
    );

  let dados =
    dadosComercios.slice();

  if (termo) {

    dados =
      dados.filter(
        comercio => {

          const texto =
            normalizarTexto(
              [
                comercio.nome,
                comercio.categoria,
                comercio.descricao,
                comercio.endereco
              ]
                .filter(Boolean)
                .join(" ")
            );

          return texto.includes(
            termo
          );

        }
      );

  }

  if (
    filtro === "aberto" ||
    filtro === "abertos"
  ) {

    dados =
      dados.filter(
        comercio =>
          comercioEstaAberto(
            comercio
          )
      );

  }

  if (
    filtro === "fechado" ||
    filtro === "fechados"
  ) {

    dados =
      dados.filter(
        comercio =>
          !comercioEstaAberto(
            comercio
          )
      );

  }

  const itens =
    dados.slice(
      0,
      limiteComercio
    );

  lista.innerHTML = "";

  itens.forEach(
    comercio => {

      const imagem =
        obterImagem(
          comercio
        );

      const aberto =
        comercioEstaAberto(
          comercio
        );

      const avaliacao =
        criarHTMLAvaliacao(
          comercio.id
        );

      const card =
        document.createElement(
          "article"
        );

      card.className =
        "comercio-card";

      card.innerHTML = `

        <a
          href="${criarLinkLocal(comercio.id)}"
          class="comercio-card-link"
        >

          <img
            src="${escaparHTML(imagem)}"
            alt="${escaparHTML(comercio.nome || "Comércio")}"
            class="comercio-card-image"
            onerror="this.src='${FALLBACK_IMAGE}'"
          >

          <div class="comercio-card-content">

            <h3>
              ${escaparHTML(comercio.nome || "")}
            </h3>

            ${
              comercio.categoria
                ? `
                  <div class="comercio-categoria">
                    ${escaparHTML(comercio.categoria)}
                  </div>
                `
                : ""
            }

            <div class="comercio-status">

              <span
                class="${aberto ? "aberto" : "fechado"}"
              >
                ${aberto ? "Aberto agora" : "Fechado"}
              </span>

              ${
                avaliacao
                  ? avaliacao
                  : ""
              }

            </div>

          </div>

        </a>

      `;

      lista.appendChild(
        card
      );

    }
  );

  const botao =
    document.getElementById(
      "mostrarMaisComercio"
    );

  if (botao) {

    botao.style.display =
      limiteComercio <
      dados.length
        ? ""
        : "none";

  }

}


/* =========================================================
   HOSPEDAGEM
   ========================================================= */

function identificarHospedagem(
  item
) {

  const texto =
    normalizarTexto(
      [
        item.nome,
        item.categoria,
        item.tipo
      ]
        .filter(Boolean)
        .join(" ")
    );

  return (
    texto.includes("hotel") ||
    texto.includes("pousada") ||
    texto.includes("hosped")
  );

}


function renderizarHospedagem() {

  const lista =
    document.getElementById(
      "ficarList"
    );

  if (!lista) {
    return;
  }

  const dados =
    dadosHospedagem.length
      ? dadosHospedagem
      : dadosComercios.filter(
          identificarHospedagem
        );

  lista.innerHTML = "";

  dados.forEach(
    hospedagem => {

      const imagem =
        obterImagem(
          hospedagem
        );

      const nota =
        obterAvaliacaoLocal(
          hospedagem.id
        );

      const card =
        document.createElement(
          "article"
        );

      card.className =
        "ficar-card";

      card.innerHTML = `

        <a
          href="${criarLinkLocal(hospedagem.id)}"
          class="ficar-card-link"
        >

          <img
            src="${escaparHTML(imagem)}"
            alt="${escaparHTML(hospedagem.nome || "Hospedagem")}"
            class="ficar-card-image"
            onerror="this.src='${FALLBACK_IMAGE}'"
          >

          <div class="ficar-card-content">

            <h3>
              ${escaparHTML(hospedagem.nome || "")}
            </h3>

            ${
              hospedagem.categoria
                ? `
                  <div class="ficar-categoria">
                    ${escaparHTML(hospedagem.categoria)}
                  </div>
                `
                : ""
            }

            ${
              nota !== null
                ? `
                  <div class="ficar-nota">
                    <img
                      src="img/icones/estrela.png"
                      alt="Avaliação"
                    >
                    <span>
                      ${formatarNumero(nota)}
                    </span>
                  </div>
                `
                : ""
            }

          </div>

        </a>

      `;

      lista.appendChild(
        card
      );

    }
  );

}


/* =========================================================
   MURAL — CARREGAR PESSOAS
   ========================================================= */

async function carregarPessoas() {

  try {

    const resposta =
      await fetch(
        `./DATA/pessoas.json?v=${Date.now()}`,
        {
          cache: "no-store"
        }
      );

    if (!resposta.ok) {
      throw new Error(
        `HTTP ${resposta.status}`
      );
    }

    const dados =
      await resposta.json();

    pessoas =
      Array.isArray(dados)
        ? dados
        : [];

  } catch (erro) {

    console.error(
      "Erro ao carregar pessoas:",
      erro
    );

    pessoas = [];

  }

}


/* =========================================================
   MURAL — VOTOS
   ========================================================= */

async function carregarVotosPessoas() {

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
      "Erro inesperado ao carregar votos:",
      erro
    );

    votosPessoas = [];

  }

}


function obterContagemVotos(
  pessoaId
) {

  const votos =
    votosPessoas.filter(
      voto =>
        String(voto.pessoa_id) ===
        String(pessoaId)
    );

  const sobe =
    votos.filter(
      voto =>
        Number(voto.voto) === 1
    ).length;

  const desce =
    votos.filter(
      voto =>
        Number(voto.voto) === -1
    ).length;

  return {
    sobe,
    desce,
    total: sobe - desce
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
        String(item.pessoa_id) ===
          String(pessoaId) &&
        String(item.usuario_id) ===
          String(usuarioAtual.id)
    );

  if (!voto) {
    return 0;
  }

  return Number(voto.voto);

}


/* =========================================================
   MURAL — RENDERIZAÇÃO
   ========================================================= */

function renderizarPessoas() {

  const lista =
    document.getElementById(
      "pessoasList"
    );

  if (!lista) {
    return;
  }

  const itens =
    pessoas.slice(
      0,
      limitePessoas
    );

  lista.innerHTML = "";

  itens.forEach(
    pessoa => {

      const imagem =
        pessoa.capa ||
        pessoa.imagem ||
        FALLBACK_IMAGE;

      const contagem =
        obterContagemVotos(
          pessoa.id
        );

      const votoUsuario =
        obterVotoDoUsuario(
          pessoa.id
        );

      const card =
        document.createElement(
          "article"
        );

      card.className =
        "pessoa-item";

      card.innerHTML = `

        <a
          href="./pages/pessoa.html?id=${encodeURIComponent(pessoa.id)}"
          class="pessoa-link"
        >

          <img
            src="${escaparHTML(imagem)}"
            alt="${escaparHTML(pessoa.nome || "Pessoa")}"
            class="pessoa-image"
            onerror="this.src='${FALLBACK_IMAGE}'"
          >

          <div class="pessoa-info">

            <h3 class="pessoa-name">
              ${escaparHTML(pessoa.nome || "")}
            </h3>

            ${
              pessoa.categoria
                ? `
                  <div class="pessoa-category">
                    ${escaparHTML(pessoa.categoria)}
                  </div>
                `
                : ""
            }

            <div class="pessoa-votos">

              <button
                type="button"
                class="pessoa-voto"
                data-pessoa="${escaparHTML(pessoa.id)}"
                data-voto="1"
                aria-label="Voto positivo"
              >
                <img
                  src="${
                    votoUsuario === 1
                      ? "./img/icones/sobe-ativa.png"
                      : "./img/icones/sobe.png"
                  }"
                  alt=""
                >
              </button>

              <span class="pessoa-like-count">
                ${contagem.total}
              </span>

              <button
                type="button"
                class="pessoa-voto"
                data-pessoa="${escaparHTML(pessoa.id)}"
                data-voto="-1"
                aria-label="Voto negativo"
              >
                <img
                  src="${
                    votoUsuario === -1
                      ? "./img/icones/desce-ativa.png"
                      : "./img/icones/desce.png"
                  }"
                  alt=""
                >
              </button>

            </div>

          </div>

        </a>

      `;

      lista.appendChild(
        card
      );

    }
  );

  lista
    .querySelectorAll(
      ".pessoa-voto"
    )
    .forEach(
      botao => {

        botao.addEventListener(
          "click",
          event => {

            event.preventDefault();
            event.stopPropagation();

            const pessoaId =
              botao.dataset.pessoa;

            const voto =
              Number(
                botao.dataset.voto
              );

            processarVotoPessoa(
              pessoaId,
              voto
            );

          }
        );

      }
    );

  const botaoMais =
    document.getElementById(
      "mostrarMaisPessoas"
    );

  if (botaoMais) {

    botaoMais.style.display =
      limitePessoas <
      pessoas.length
        ? ""
        : "none";

  }

}


/* =========================================================
   MURAL — PROCESSAR VOTO
   ========================================================= */

async function processarVotoPessoa(
  pessoaId,
  voto
) {

  if (!usuarioAtual) {

    abrirModalAuth(
      "login"
    );

    return;

  }

  const usuarioId =
    usuarioAtual.id;

  try {

    const {
      data: votoExistente,
      error: erroBusca
    } =
      await supabaseClient
        .from("votos_pessoas")
        .select(
          "pessoa_id, usuario_id, voto"
        )
        .eq(
          "pessoa_id",
          pessoaId
        )
        .eq(
          "usuario_id",
          usuarioId
        )
        .maybeSingle();

    if (erroBusca) {
      throw erroBusca;
    }

    if (votoExistente) {

      if (
        Number(votoExistente.voto) ===
        voto
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
              usuarioId
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
            .update({
              voto
            })
            .eq(
              "pessoa_id",
              pessoaId
            )
            .eq(
              "usuario_id",
              usuarioId
            );

        if (error) {
          throw error;
        }

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
              usuarioId,
            voto
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
   AUTENTICAÇÃO — ELEMENTOS
   ========================================================= */

function obterElementoAuth(
  id
) {

  return document.getElementById(
    id
  );

}


/* =========================================================
   AUTENTICAÇÃO — MODAL
   ========================================================= */

function criarModalAuthSeNecessario() {

  if (
    document.getElementById(
      "authModal"
    )
  ) {
    return;
  }

  const modal =
    document.createElement(
      "div"
    );

  modal.id =
    "authModal";

  modal.innerHTML = `

    <div class="auth-modal-overlay">

      <div class="auth-modal-box">

        <button
          type="button"
          id="fecharAuth"
          class="auth-fechar"
        >
          ×
        </button>

        <div class="auth-conteudo">

          <form
            id="formLogin"
            class="auth-form"
          >

            <h2>
              Entrar
            </h2>

            <div
              id="erroLogin"
              class="auth-erro"
            ></div>

            <input
              type="email"
              id="loginEmail"
              placeholder="E-mail"
              autocomplete="email"
              required
            >

            <input
              type="password"
              id="loginSenha"
              placeholder="Senha"
              autocomplete="current-password"
              required
            >

            <button
              type="submit"
              id="botaoLogin"
            >
              Entrar
            </button>

            <button
              type="button"
              id="trocarCadastro"
              class="auth-link"
            >
              Ainda não tenho conta
            </button>

          </form>


          <form
            id="formCadastro"
            class="auth-form"
            style="display:none"
          >

            <h2>
              Criar conta
            </h2>

            <div
              id="erroCadastro"
              class="auth-erro"
            ></div>

            <input
              type="text"
              id="cadastroNome"
              placeholder="Nome"
              autocomplete="name"
              required
            >

            <input
              type="email"
              id="cadastroEmail"
              placeholder="E-mail"
              autocomplete="email"
              required
            >

            <input
              type="password"
              id="cadastroSenha"
              placeholder="Senha"
              autocomplete="new-password"
              required
            >

            <input
              type="password"
              id="cadastroConfirmarSenha"
              placeholder="Confirmar senha"
              autocomplete="new-password"
              required
            >

            <button
              type="submit"
              id="botaoCadastro"
            >
              Criar conta
            </button>

            <button
              type="button"
              id="trocarLogin"
              class="auth-link"
            >
              Já tenho uma conta
            </button>

          </form>

        </div>

      </div>

    </div>

  `;

  document.body.appendChild(
    modal
  );

}


/* =========================================================
   AUTENTICAÇÃO — ABRIR
   ========================================================= */

function abrirModalAuth(
  tipo = "login"
) {

  criarModalAuthSeNecessario();

  const modal =
    obterElementoAuth(
      "authModal"
    );

  const formLogin =
    obterElementoAuth(
      "formLogin"
    );

  const formCadastro =
    obterElementoAuth(
      "formCadastro"
    );

  if (!modal) {
    return;
  }

  modal.classList.add(
    "ativo"
  );

  if (
    tipo === "cadastro"
  ) {

    if (formLogin) {
      formLogin.style.display =
        "none";
    }

    if (formCadastro) {
      formCadastro.style.display =
        "";
    }

  } else {

    if (formLogin) {
      formLogin.style.display =
        "";
    }

    if (formCadastro) {
      formCadastro.style.display =
        "none";
    }

  }

}


/* =========================================================
   AUTENTICAÇÃO — FECHAR
   ========================================================= */

function fecharModalAuth() {

  const modal =
    obterElementoAuth(
      "authModal"
    );

  if (!modal) {
    return;
  }

  modal.classList.remove(
    "ativo"
  );

}


/* =========================================================
   AUTENTICAÇÃO — LOGIN
   ========================================================= */

async function realizarLogin(
  event
) {

  event.preventDefault();

  const email =
    obterElementoAuth(
      "loginEmail"
    )?.value.trim();

  const senha =
    obterElementoAuth(
      "loginSenha"
    )?.value;

  const erro =
    obterElementoAuth(
      "erroLogin"
    );

  const botao =
    obterElementoAuth(
      "botaoLogin"
    );

  if (erro) {
    erro.textContent = "";
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
      await supabaseClient.auth
        .signInWithPassword({
          email,
          password: senha
        });

    if (error) {
      throw error;
    }

    usuarioAtual =
      data.user;

    window.usuarioAtualSupabase =
      usuarioAtual;

    fecharModalAuth();

    renderizarPessoas();

  } catch (erroLogin) {

    console.error(
      "Erro no login:",
      erroLogin
    );

    if (erro) {
      erro.textContent =
        "E-mail ou senha incorretos.";
    }

  } finally {

    if (botao) {
      botao.disabled = false;
      botao.textContent =
        "Entrar";
    }

  }

}


/* =========================================================
   AUTENTICAÇÃO — CADASTRO
   ========================================================= */

async function realizarCadastro(
  event
) {

  event.preventDefault();

  const nome =
    obterElementoAuth(
      "cadastroNome"
    )?.value.trim();

  const email =
    obterElementoAuth(
      "cadastroEmail"
    )?.value.trim();

  const senha =
    obterElementoAuth(
      "cadastroSenha"
    )?.value;

  const confirmar =
    obterElementoAuth(
      "cadastroConfirmarSenha"
    )?.value;

  const erro =
    obterElementoAuth(
      "erroCadastro"
    );

  const botao =
    obterElementoAuth(
      "botaoCadastro"
    );

  if (erro) {
    erro.textContent = "";
  }

  if (nome.length < 2) {

    if (erro) {
      erro.textContent =
        "Digite seu nome.";
    }

    return;

  }

  if (senha.length < 6) {

    if (erro) {
      erro.textContent =
        "A senha precisa ter pelo menos 6 caracteres.";
    }

    return;

  }

  if (senha !== confirmar) {

    if (erro) {
      erro.textContent =
        "As senhas não coincidem.";
    }

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
      await supabaseClient.auth
        .signUp({

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

    if (data.session) {

      usuarioAtual =
        data.user;

      window.usuarioAtualSupabase =
        usuarioAtual;

      fecharModalAuth();

      renderizarPessoas();

    } else {

      const erroLogin =
        obterElementoAuth(
          "erroLogin"
        );

      if (erroLogin) {

        erroLogin.textContent =
          "Conta criada. Agora faça login.";

      }

      const formLogin =
        obterElementoAuth(
          "formLogin"
        );

      const formCadastro =
        obterElementoAuth(
          "formCadastro"
        );

      if (formLogin) {
        formLogin.style.display =
          "";
      }

      if (formCadastro) {
        formCadastro.style.display =
          "none";
      }

    }

  } catch (erroCadastro) {

    console.error(
      "Erro no cadastro:",
      erroCadastro
    );

    if (erro) {

      erro.textContent =
        erroCadastro?.message ||
        "Não foi possível criar a conta.";

    }

  } finally {

    if (botao) {
      botao.disabled = false;
      botao.textContent =
        "Criar conta";
    }

  }

}


/* =========================================================
   AUTENTICAÇÃO — LOGOUT
   ========================================================= */

async function realizarLogout() {

  try {

    const {
      error
    } =
      await supabaseClient.auth
        .signOut();

    if (error) {
      throw error;
    }

    usuarioAtual = null;

    window.usuarioAtualSupabase =
      null;

    renderizarPessoas();

  } catch (erro) {

    console.error(
      "Erro ao sair:",
      erro
    );

  }

}


/* =========================================================
   AUTENTICAÇÃO — ESTADO
   ========================================================= */

async function verificarUsuarioAtual() {

  try {

    const {
      data,
      error
    } =
      await supabaseClient.auth
        .getSession();

    if (error) {
      throw error;
    }

    usuarioAtual =
      data?.session?.user ||
      null;

    window.usuarioAtualSupabase =
      usuarioAtual;

  } catch (erro) {

    console.error(
      "Erro ao verificar sessão:",
      erro
    );

    usuarioAtual = null;

    window.usuarioAtualSupabase =
      null;

  }

}


function configurarAutenticacao() {

  criarModalAuthSeNecessario();

  const formLogin =
    obterElementoAuth(
      "formLogin"
    );

  const formCadastro =
    obterElementoAuth(
      "formCadastro"
    );

  const fechar =
    obterElementoAuth(
      "fecharAuth"
    );

  const trocarCadastro =
    obterElementoAuth(
      "trocarCadastro"
    );

  const trocarLogin =
    obterElementoAuth(
      "trocarLogin"
    );

  const abrirLogin =
    obterElementoAuth(
      "abrirLogin"
    );

  const abrirCadastro =
    obterElementoAuth(
      "abrirCadastro"
    );

  const botaoSair =
    obterElementoAuth(
      "botaoSair"
    );

  if (formLogin) {

    formLogin.addEventListener(
      "submit",
      realizarLogin
    );

  }

  if (formCadastro) {

    formCadastro.addEventListener(
      "submit",
      realizarCadastro
    );

  }

  if (fechar) {

    fechar.addEventListener(
      "click",
      fecharModalAuth
    );

  }

  if (trocarCadastro) {

    trocarCadastro.addEventListener(
      "click",
      () =>
        abrirModalAuth(
          "cadastro"
        )
    );

  }

  if (trocarLogin) {

    trocarLogin.addEventListener(
      "click",
      () =>
        abrirModalAuth(
          "login"
        )
    );

  }

  if (abrirLogin) {

    abrirLogin.addEventListener(
      "click",
      event => {

        event.preventDefault();

        abrirModalAuth(
          "login"
        );

      }
    );

  }

  if (abrirCadastro) {

    abrirCadastro.addEventListener(
      "click",
      event => {

        event.preventDefault();

        abrirModalAuth(
          "cadastro"
        );

      }
    );

  }

  if (botaoSair) {

    botaoSair.addEventListener(
      "click",
      event => {

        event.preventDefault();

        realizarLogout();

      }
    );

  }

  supabaseClient.auth.onAuthStateChange(
    (_evento, session) => {

      usuarioAtual =
        session?.user ||
        null;

      window.usuarioAtualSupabase =
        usuarioAtual;

      renderizarPessoas();

    }
  );

}


/* =========================================================
   BOTÕES "MOSTRAR MAIS"
   ========================================================= */

function configurarBotoesMostrarMais() {

  const visitar =
    document.getElementById(
      "mostrarMaisVisitar"
    );

  if (visitar) {

    visitar.addEventListener(
      "click",
      () => {

        limiteVisitar +=
          LIMITE_INCREMENTO;

        renderizarVisitar();

      }
    );

  }

  const comer =
    document.getElementById(
      "mostrarMaisComer"
    );

  if (comer) {

    comer.addEventListener(
      "click",
      () => {

        limiteComer +=
          LIMITE_INCREMENTO;

        renderizarComer();

      }
    );

  }

  const comercio =
    document.getElementById(
      "mostrarMaisComercio"
    );

  if (comercio) {

    comercio.addEventListener(
      "click",
      () => {

        limiteComercio +=
          LIMITE_INCREMENTO;

        renderizarComercio();

      }
    );

  }

  const pessoasBotao =
    document.getElementById(
      "mostrarMaisPessoas"
    );

  if (pessoasBotao) {

    pessoasBotao.addEventListener(
      "click",
      () => {

        limitePessoas +=
          LIMITE_INCREMENTO;

        renderizarPessoas();

      }
    );

  }

}


/* =========================================================
   FILTROS / PESQUISAS
   ========================================================= */

function configurarFiltros() {

  const pesquisaComer =
    document.getElementById(
      "pesquisaComer"
    );

  if (pesquisaComer) {

    pesquisaComer.addEventListener(
      "input",
      () => {

        limiteComer =
          LIMITE_INICIAL;

        renderizarComer();

      }
    );

  }


  const filtroAberto =
    document.getElementById(
      "filtroAberto"
    );

  if (filtroAberto) {

    filtroAberto.addEventListener(
      "change",
      () => {

        limiteComer =
          LIMITE_INICIAL;

        renderizarComer();

      }
    );

  }


  const pesquisaComercio =
    document.getElementById(
      "pesquisaComercio"
    );

  if (pesquisaComercio) {

    pesquisaComercio.addEventListener(
      "input",
      () => {

        limiteComercio =
          LIMITE_INICIAL;

        renderizarComercio();

      }
    );

  }


  const filtroAbertoComercio =
    document.getElementById(
      "filtroAbertoComercio"
    );

  if (filtroAbertoComercio) {

    filtroAbertoComercio.addEventListener(
      "change",
      () => {

        limiteComercio =
          LIMITE_INICIAL;

        renderizarComercio();

      }
    );

  }

}


/* =========================================================
   CARREGAMENTO DE JSON
   ========================================================= */

async function carregarJSON(
  caminho
) {

  const resposta =
    await fetch(
      `${caminho}?v=${Date.now()}`,
      {
        cache: "no-store"
      }
    );

  if (!resposta.ok) {

    throw new Error(
      `Erro HTTP ${resposta.status} ao carregar ${caminho}`
    );

  }

  return resposta.json();

}


async function carregarDados() {

  try {

    const [
      locais,
      comercios,
      hospedagem
    ] =
      await Promise.all([

        carregarJSON(
          "./DATA/locais.json"
        ),

        carregarJSON(
          "./DATA/comercios.json"
        ),

        carregarJSON(
          "./DATA/hospedagem.json"
        ).catch(
          () => []
        )

      ]);

    dadosLocais =
      Array.isArray(locais)
        ? locais
        : [];

    dadosComercios =
      Array.isArray(comercios)
        ? comercios
        : [];

    dadosHospedagem =
      Array.isArray(hospedagem)
        ? hospedagem
        : [];

    /*
       Se hospedagem.json estiver vazio
       ou não existir, tenta encontrar
       hospedagens dentro de comercios.json.
    */

    if (
      dadosHospedagem.length === 0
    ) {

      dadosHospedagem =
        dadosComercios.filter(
          identificarHospedagem
        );

    }

    await carregarAvaliacoes();

    console.log(
      "Dados carregados:",
      {
        locais:
          dadosLocais.length,

        comercios:
          dadosComercios.length,

        hospedagem:
          dadosHospedagem.length,

        avaliacoes:
          avaliacoes.length
      }
    );

    /*
       IMPORTANTE:
       Remove os marcadores antigos
       antes de criar novamente.
    */

    limparMarcadoresMapa();

    dadosLocais.forEach(
      local =>
        adicionarMarcador(
          local,
          "local"
        )
    );

    dadosComercios.forEach(
      comercio =>
        adicionarMarcador(
          comercio,
          "comercio"
        )
    );

    dadosHospedagem.forEach(
      hospedagem =>
        adicionarMarcador(
          hospedagem,
          "hospedagem"
        )
    );

    renderizarVisitar();

    renderizarComer();

    renderizarComercio();

    renderizarHospedagem();

    renderizarPessoas();

    /*
       Garante que o filtro atualmente
       selecionado continue aplicado
       depois de os marcadores serem criados.
    */

    const botaoAtivo =
      document.querySelector(
        ".map-filter.active"
      );

    if (botaoAtivo) {

      aplicarFiltroMapa(
        obterCategoriaDoBotaoMapa(
          botaoAtivo
        )
      );

    } else {

      aplicarFiltroMapa(
        "todos"
      );

    }

  } catch (erro) {

    console.error(
      "Erro ao carregar dados do site:",
      erro
    );

  }

}


/* =========================================================
   REDIMENSIONAR MAPA
   ========================================================= */

function corrigirTamanhoMapa() {

  if (!homeMap) {
    return;
  }

  setTimeout(
    () => {

      homeMap.invalidateSize();

    },
    200
  );

}


/* =========================================================
   EVENTOS DO HERO
   ========================================================= */

function configurarGestosHero() {

  const carousel =
    document.getElementById(
      "heroCarousel"
    );

  if (!carousel) {
    return;
  }

  let inicioX = 0;
  let finalX = 0;

  carousel.addEventListener(
    "touchstart",
    event => {

      inicioX =
        event.changedTouches[0].screenX;

    },
    {
      passive: true
    }
  );

  carousel.addEventListener(
    "touchend",
    event => {

      finalX =
        event.changedTouches[0].screenX;

      const diferenca =
        finalX - inicioX;

      if (
        Math.abs(diferenca) < 50
      ) {
        return;
      }

      const slides =
        document.querySelectorAll(
          ".hero-slide"
        );

      if (slides.length <= 1) {
        return;
      }

      if (diferenca < 0) {

        mostrarSlideHero(
          (indiceSlideHero + 1) %
          slides.length
        );

      } else {

        mostrarSlideHero(
          (
            indiceSlideHero -
            1 +
            slides.length
          ) %
          slides.length
        );

      }

      reiniciarCarrosselHero();

    },
    {
      passive: true
    }
  );

}


/* =========================================================
   ATUALIZAÇÃO PERIÓDICA DE STATUS
   ========================================================= */

function iniciarAtualizacaoStatus() {

  setInterval(
    () => {

      renderizarComer();

      renderizarComercio();

    },
    60000
  );

}


/* =========================================================
   INICIALIZAÇÃO
   ========================================================= */

async function iniciarSite() {

  console.log(
    "Iniciando Andrelândia — Guia Turístico..."
  );

  inicializarMapa();

  configurarFiltrosMapa();

  configurarAutenticacao();

  configurarBotoesMostrarMais();

  configurarFiltros();

  configurarGestosHero();

  await verificarUsuarioAtual();

  await descobrirSlidesHero();

  await carregarPessoas();

  await carregarVotosPessoas();

  await carregarDados();

  renderizarPessoas();

  iniciarAtualizacaoStatus();

  corrigirTamanhoMapa();

  window.addEventListener(
    "resize",
    corrigirTamanhoMapa
  );

  console.log(
    "Site inicializado."
  );

}


/* =========================================================
   DOM READY
   ========================================================= */

if (
  document.readyState ===
  "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    iniciarSite
  );

} else {

  iniciarSite();

}