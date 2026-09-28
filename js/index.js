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

const SUPABASE_URL = "https://xdmbkflufsfqziixzpxc.supabase.co";
const SUPABASE_KEY = "sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";

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
  console.error(
    "Supabase não foi carregado."
  );
}

/* =========================================================
   DADOS
   ========================================================= */

let dadosLocais = [];
let dadosComercios = [];
let dadosHospedagem = [];

let avaliacoes = [];
let pessoas = [];
let votosPessoas = [];
let usuarioAtual = null;

/* =========================================================
   FUNÇÕES UTILITÁRIAS
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
  return `pages/local.html?id=${encodeURIComponent(
    id || ""
  )}`;
}

function obterImagem(item) {
  return (
    item?.capa ||
    FALLBACK_IMAGE
  );
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
    Math.sin(dLat / 2) *
      Math.sin(dLat / 2) +
    Math.cos(
      lat1 *
        Math.PI /
        180
    ) *
      Math.cos(
        lat2 *
          Math.PI /
          180
      ) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  return R * c;
}

function formatarDistancia(
  distancia
) {
  if (distancia < 1) {
    return `${Math.round(
      distancia * 1000
    )} m do centro`;
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
   CARROSSEL
   ========================================================= */

const heroCarousel =
  document.getElementById(
    "heroCarousel"
  );

const heroText =
  document.getElementById(
    "heroText"
  );

let slidesHero = [];
let slideHeroAtual = 0;
let intervaloHero = null;
let inicioToqueHero = 0;

/*
 * O JS verifica quais imagens realmente existem antes de criar os slides.
 */

const HERO_MAXIMO = 20;

const TEXTOS_HERO = [
  "Descubra Andrelândia",
  "Conheça a história de Andrelândia",
  "Explore as belezas de Andrelândia",
  "Viva Andrelândia",
  "Descubra novos lugares",
  "Um destino para conhecer"
];

async function verificarImagemExiste(
  caminho
) {
  try {
    const resposta = await fetch(
      caminho,
      {
        method: "HEAD",
        cache: "no-store"
      }
    );

    return resposta.ok;
  } catch {
    return false;
  }
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
    const caminho =
      `img/carrossel/hero${numero}.png`;

    const existe =
      await verificarImagemExiste(
        caminho
      );

    if (existe) {
      encontrados.push({
        caminho,
        texto:
          TEXTOS_HERO[
            (numero - 1) %
              TEXTOS_HERO.length
          ]
      });
    }
  }

  /*
   * Se o servidor não permitir HEAD, tenta pelo menos os três arquivos principais.
   */

  if (encontrados.length === 0) {
    for (
      let numero = 1;
      numero <= 3;
      numero++
    ) {
      const caminho =
        `img/carrossel/hero${numero}.png`;

      encontrados.push({
        caminho,
        texto:
          TEXTOS_HERO[
            (numero - 1) %
              TEXTOS_HERO.length
          ]
      });
    }
  }

  slidesHero = encontrados;

  montarCarrossel();
}

function montarCarrossel() {
  if (!heroCarousel) {
    return;
  }

  heroCarousel.innerHTML = "";

  if (slidesHero.length === 0) {
    return;
  }

  slidesHero.forEach(
    (slide, indice) => {
      const elemento =
        document.createElement(
          "div"
        );

      elemento.className =
        "hero-slide";

      elemento.style.backgroundImage =
        `url("${slide.caminho}")`;

      elemento.dataset.index =
        indice;

      if (indice === 0) {
        elemento.classList.add(
          "active"
        );
      }

      heroCarousel.appendChild(
        elemento
      );
    }
  );

  slideHeroAtual = 0;

  atualizarHero();

  iniciarIntervaloHero();

  configurarGestosHero();
}

function atualizarHero() {
  if (slidesHero.length === 0) {
    return;
  }

  const slides =
    heroCarousel.querySelectorAll(
      ".hero-slide"
    );

  slides.forEach(
    (slide, indice) => {
      slide.classList.toggle(
        "active",
        indice ===
          slideHeroAtual
      );
    }
  );

  if (heroText) {
    heroText.textContent =
      slidesHero[
        slideHeroAtual
      ]?.texto ||
      "Descubra Andrelândia";
  }
}

function mudarHero(
  direcao
) {
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
    clearInterval(
      intervaloHero
    );
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

  heroCarousel.addEventListener(
    "touchstart",
    event => {
      inicioToqueHero =
        event.changedTouches[0]
          .clientX;
    },
    {
      passive: true
    }
  );

  heroCarousel.addEventListener(
    "touchend",
    event => {
      const fim =
        event.changedTouches[0]
          .clientX;

      const diferenca =
        fim -
        inicioToqueHero;

      if (
        Math.abs(diferenca) <
        50
      ) {
        return;
      }

      if (diferenca < 0) {
        mudarHero(1);
      } else {
        mudarHero(-1);
      }

      iniciarIntervaloHero();
    },
    {
      passive: true
    }
  );
}

/* =========================================================
   MAPA
   ========================================================= */

let homeMap = null;

const marcadores = [];

function inicializarMapa() {
  const elemento =
    document.getElementById(
      "homeMap"
    );

  if (
    !elemento ||
    typeof L === "undefined"
  ) {
    console.error(
      "Leaflet ou #homeMap não encontrado."
    );

    return;
  }

  homeMap = L.map(
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

  /*
   * URL correta do Esri. NÃO usar:
   * https://{s}.arcgisonline.com/...
   */

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
      position:
        "bottomright"
    })
    .addTo(homeMap);

  /*
   * O mapa precisa recalcular o tamanho depois que a página termina de carregar.
   */

  setTimeout(() => {
    homeMap.invalidateSize();
  }, 300);
}

/* =========================================================
   GRUPO DE CATEGORIA DO MAPA
   ========================================================= */

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
    texto.includes("historia") ||
    texto.includes("patrimonio") ||
    texto.includes("ferrovi")
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

/* =========================================================
   ÍCONE DO MAPA
   ========================================================= */

function criarIcone(
  categoria
) {
  const grupo =
    obterGrupoCategoriaMapa(
      categoria
    );

  let arquivo = null;

  switch (grupo) {
    case "igreja":
      arquivo =
        "igreja.png";
      break;

    case "historico":
      arquivo =
        "historico.png";
      break;

    case "natureza":
      arquivo =
        "natureza.png";
      break;

    case "alimentacao":
      arquivo =
        "alimentacao.png";
      break;

    /*
     * Como cafe.png pode não existir, usa o marcador de alimentação.
     */

    case "cafe":
      arquivo =
        "alimentacao.png";
      break;

    case "hospedagem":
      arquivo =
        "hotel.png";
      break;

    case "comercio":
      arquivo =
        "comercio.png";
      break;

    case "esporte":
      arquivo =
        "esporte.png";
      break;

    case "cultura":
      arquivo =
        "cultura.png";
      break;

    default:

      /*
       * Não tenta carregar local.png, pois ele pode não existir.
       * Usa um marcador CSS simples.
       */

      return L.divIcon({
        className:
          "marcador-mapa-generico",

        html:
          `<span></span>`,

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

/* =========================================================
   ESTILO DO MARCADOR GENÉRICO
   ========================================================= */

function adicionarEstiloMarcadorGenerico() {
  if (
    document.getElementById(
      "estiloMarcadorGenerico"
    )
  ) {
    return;
  }

  const style =
    document.createElement(
      "style"
    );

  style.id =
    "estiloMarcadorGenerico";

  style.textContent = `
    .marcador-mapa-generico {
      background: transparent;
      border: none;
    }

    .marcador-mapa-generico span {
      display: block;
      width: 30px;
      height: 30px;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      background: #194138;
      border: 3px solid #ffffff;
      box-shadow: 0 2px 7px rgba(0,0,0,.35);
      box-sizing: border-box;
    }

    .marcador-mapa-generico span::after {
      content: "";
      display: block;
      width: 8px;
      height: 8px;
      margin: 8px;
      border-radius: 50%;
      background: #ffffff;
    }
  `;

  document.head.appendChild(
    style
  );
}

/* =========================================================
   POPUP DO MAPA
   ========================================================= */

function criarPopup(item) {
  let descricao =
    item.descricao ||
    item.historia ||
    item.sobre ||
    "Conheça este lugar em Andrelândia.";

  if (descricao.length > 140) {
    descricao =
      descricao.substring(
        0,
        140
      ) + "...";
  }

  const imagem =
    escaparHTML(
      obterImagem(item)
    );

  const nome =
    escaparHTML(
      item.nome ||
        "Local"
    );

  const categoria =
    escaparHTML(
      item.categoria ||
        "Local"
    );

  const textoDescricao =
    escaparHTML(
      descricao
    );

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
          ${textoDescricao}
        </p>

        <a
          class="popup-button"
          href="${criarLinkLocal(item.id)}"
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

function adicionarMarcador(
  item
) {
  if (!homeMap) {
    return;
  }

  const latitude =
    Number(
      item.latitude
    );

  const longitude =
    Number(
      item.longitude
    );

  if (
    !Number.isFinite(
      latitude
    ) ||
    !Number.isFinite(
      longitude
    )
  ) {
    console.warn(
      "Local sem coordenadas válidas:",
      item.nome,
      item
    );

    return;
  }

  const marcador =
    L.marker(
      [
        latitude,
        longitude
      ],
      {
        icon:
          criarIcone(
            item.categoria
          )
      }
    );

  marcador.bindPopup(
    criarPopup(item),
    {
      maxWidth: 280
    }
  );

  marcadores.push({
    marcador,

    categoria:
      item.categoria ||
      "",

    grupo:
      obterGrupoCategoriaMapa(
        item.categoria
      ),

    id:
      item.id,

    nome:
      item.nome ||
      ""
  });

  marcador.addTo(
    homeMap
  );
}

/* =========================================================
   FILTROS DO MAPA
   ========================================================= */

function aplicarFiltroMapa(
  categoria
) {
  if (!homeMap) {
    return;
  }

  const filtro =
    normalizarTexto(
      categoria
    );

  marcadores.forEach(
    item => {
      let mostrar = false;

      if (
        filtro === "todos"
      ) {
        mostrar = true;
      } else {
        const filtroGrupo =
          obterGrupoCategoriaMapa(
            categoria
          );

        mostrar =
          item.grupo ===
          filtroGrupo;
      }

      if (mostrar) {
        if (
          !homeMap.hasLayer(
            item.marcador
          )
        ) {
          item.marcador.addTo(
            homeMap
          );
        }
      } else {
        if (
          homeMap.hasLayer(
            item.marcador
          )
        ) {
          homeMap.removeLayer(
            item.marcador
          );
        }
      }
    }
  );
}

document
  .querySelectorAll(
    ".map-filter"
  )
  .forEach(
    botao => {
      botao.addEventListener(
        "click",
        () => {
          const filtro =
            botao.dataset.filter ||
            "Todos";

          document
            .querySelectorAll(
              ".map-filter"
            )
            .forEach(
              item => {
                item.classList.remove(
                  "active"
                );
              }
            );

          botao.classList.add(
            "active"
          );

          aplicarFiltroMapa(
            filtro
          );
        }
      );
    }
  );

/* =========================================================
   O QUE VISITAR
   ========================================================= */

const visitarList =
  document.getElementById(
    "visitarList"
  );

const mostrarMaisVisitar =
  document.getElementById(
    "mostrarMaisVisitar"
  );

let limiteVisitar =
  LIMITE_INICIAL;

function criarCardVisitar(
  item
) {
  const nome =
    item.nome ||
    "Local turístico";

  const capa =
    obterImagem(item);

  const resumo =
    item.resumo ||
    item.descricao ||
    item.historia ||
    item.sobre ||
    "";

  const latitude =
    Number(
      item.latitude
    );

  const longitude =
    Number(
      item.longitude
    );

  let localizacao =
    "Andrelândia - MG";

  if (
    Number.isFinite(
      latitude
    ) &&
    Number.isFinite(
      longitude
    )
  ) {
    const distancia =
      calcularDistancia(
        CENTRO_ANDRELANDIA.latitude,
        CENTRO_ANDRELANDIA.longitude,
        latitude,
        longitude
      );

    localizacao =
      formatarDistancia(
        distancia
      );
  } else {
    localizacao =
      item.endereco ||
      item.endereço ||
      "Andrelândia - MG";
  }

  const elemento =
    document.createElement(
      "a"
    );

  elemento.className =
    "visitar-item";

  elemento.href =
    criarLinkLocal(
      item.id
    );

  elemento.innerHTML = `
    <div class="visitar-image">

      <img
        src="${escaparHTML(capa)}"
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
        ${escaparHTML(localizacao)}
      </div>

      <p class="visitar-resumo">
        ${escaparHTML(resumo)}
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

  if (
    dadosLocais.length === 0
  ) {
    visitarList.innerHTML = `
      <div class="visitar-empty">
        Nenhum ponto turístico encontrado.
      </div>
    `;

    if (mostrarMaisVisitar) {
      mostrarMaisVisitar.hidden =
        true;
    }

    return;
  }

  const quantidade =
    Math.min(
      limiteVisitar,
      dadosLocais.length
    );

  dadosLocais
    .slice(
      0,
      quantidade
    )
    .forEach(
      item => {
        visitarList.appendChild(
          criarCardVisitar(
            item
          )
        );
      }
    );

  configurarMostrarMais({
    botao:
      mostrarMaisVisitar,

    total:
      dadosLocais.length,

    limite:
      limiteVisitar
  });
}

if (mostrarMaisVisitar) {
  mostrarMaisVisitar.addEventListener(
    "click",
    () => {
      limiteVisitar +=
        LIMITE_INCREMENTO;

      renderizarOQueVisitar();
    }
  );
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

function comercioEstaAberto(
  comercio
) {
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

  const agora =
    new Date();

  const horaAtual =
    agora.getHours() * 60 +
    agora.getMinutes();

  const dia =
    obterDiaSemana();

  const diasDaSemana = [
    "domingo",
    "segunda",
    "terca",
    "quarta",
    "quinta",
    "sexta",
    "sabado"
  ];

  let diaPermitido = true;

  if (
    texto.includes(
      "segunda a sabado"
    )
  ) {
    diaPermitido =
      [
        "segunda",
        "terca",
        "quarta",
        "quinta",
        "sexta",
        "sabado"
      ].includes(dia);
  } else if (
    texto.includes(
      "segunda a sexta"
    )
  ) {
    diaPermitido =
      [
        "segunda",
        "terca",
        "quarta",
        "quinta",
        "sexta"
      ].includes(dia);
  }

  if (!diaPermitido) {
    return false;
  }

  const horarios =
    texto.match(
      /(\d{1,2}):(\d{2})\s*(?:as|-|a)\s*(\d{1,2}):(\d{2})/g
    );

  if (
    !horarios ||
    horarios.length === 0
  ) {
    return false;
  }

  for (
    const horario of horarios
  ) {
    const resultado =
      horario.match(
        /(\d{1,2}):(\d{2})\s*(?:as|-|a)\s*(\d{1,2}):(\d{2})/
      );

    if (!resultado) {
      continue;
    }

    const horaInicial =
      converterParaMinutos(
        resultado[1],
        resultado[2]
      );

    const horaFinal =
      converterParaMinutos(
        resultado[3],
        resultado[4]
      );

    if (
      horaFinal >=
      horaInicial
    ) {
      if (
        horaAtual >=
          horaInicial &&
        horaAtual <=
          horaFinal
      ) {
        return true;
      }
    } else {
      if (
        horaAtual >=
          horaInicial ||
        horaAtual <=
          horaFinal
      ) {
        return true;
      }
    }
  }

  return false;
}

/* =========================================================
   ONDE COMER
   ========================================================= */

const comerList =
  document.getElementById(
    "comerList"
  );

const mostrarMaisComer =
  document.getElementById(
    "mostrarMaisComer"
  );

const filtroAberto =
  document.getElementById(
    "filtroAberto"
  );

const textoStatus =
  document.getElementById(
    "textoStatus"
  );

let categoriaComerFiltro =
  "Todos";

let mostrarSomenteAbertos =
  false;

let limiteComer =
  LIMITE_INICIAL;

/* =========================================================
   CATEGORIAS DE ALIMENTAÇÃO
   ========================================================= */

const CATEGORIAS_COMIDA = [
  "restaurante",
  "restaurantes",
  "lanchonete",
  "lanchonetes",
  "cafeteria",
  "cafe",
  "cafes",
  "sorveteria",
  "sorvete",
  "acai",
  "pizzaria",
  "hamburgueria",
  "hamburguer",
  "padaria",
  "panificadora",
  "confeitaria",
  "doceria",
  "churrascaria",
  "bar",
  "alimentacao",
  "food",
  "fast food"
].map(
  normalizarTexto
);

function comercioEhAlimentacao(
  comercio
) {
  if (!comercio) {
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

  if (
    CATEGORIAS_COMIDA.some(
      categoriaComida =>
        categoria.includes(
          categoriaComida
        )
    )
  ) {
    return true;
  }

  const palavrasComida = [
    "restaurante",
    "lanchonete",
    "cafeteria",
    "cafe",
    "sorvete",
    "sorveteria",
    "acai",
    "pizzaria",
    "hamburguer",
    "padaria",
    "panificadora",
    "confeitaria",
    "doceria",
    "churrascaria"
  ].map(
    normalizarTexto
  );

  return palavrasComida.some(
    palavra =>
      nome.includes(palavra)
  );
}

function comercioPertenceCategoria(
  comercio,
  filtro
) {
  if (filtro === "Todos") {
    return comercioEhAlimentacao(
      comercio
    );
  }

  const categoria =
    normalizarTexto(
      comercio.categoria
    );

  switch (
    normalizarTexto(filtro)
  ) {
    case "restaurante":
      return categoria.includes(
        "restaurante"
      );

    case "lanchonetes":
    case "lanchonete":
      return categoria.includes(
        "lanchonete"
      );

    case "cafeteria":
    case "cafe":
      return (
        categoria.includes(
          "cafe"
        ) ||
        categoria.includes(
          "cafeteria"
        )
      );

    case "sorvete/acai":
      return (
        categoria.includes(
          "sorvete"
        ) ||
        categoria.includes(
          "acai"
        )
      );

    default:
      return (
        categoria ===
        normalizarTexto(
          filtro
        )
      );
  }
}

function obterComerciosFiltrados() {
  return dadosComercios.filter(
    comercio => {
      const categoriaOk =
        comercioPertenceCategoria(
          comercio,
          categoriaComerFiltro
        );

      const aberto =
        comercioEstaAberto(
          comercio
        );

      const abertoOk =
        !mostrarSomenteAbertos ||
        aberto;

      return (
        categoriaOk &&
        abertoOk
      );
    }
  );
}

function atualizarStatusBotao() {
  if (!filtroAberto) {
    return;
  }

  const algumAberto =
    dadosComercios
      .filter(
        comercio =>
          comercioEhAlimentacao(
            comercio
          )
      )
      .some(
        comercio =>
          comercioEstaAberto(
            comercio
          )
      );

  if (algumAberto) {
    if (textoStatus) {
      textoStatus.textContent =
        "Aberto agora";
    }

    filtroAberto.classList.remove(
      "fechado"
    );
  } else {
    if (textoStatus) {
      textoStatus.textContent =
        "Fechado";
    }

    filtroAberto.classList.add(
      "fechado"
    );
  }
}

/* =========================================================
   AVALIAÇÕES
   ========================================================= */

function obterAvaliacaoLocal(
  localId
) {
  const lista =
    avaliacoes.filter(
      avaliacao =>
        String(
          avaliacao.local_id
        ) ===
        String(localId)
    );

  if (lista.length === 0) {
    return null;
  }

  const soma =
    lista.reduce(
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
    lista.length
  );
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
      notaOriginal !==
        null &&
      notaOriginal !==
        ""
    ) {
      return String(
        notaOriginal
      );
    }

    return "—";
  }

  return nota
    .toFixed(1)
    .replace(
      ".",
      ","
    );
}

/* =========================================================
   CARD — ONDE COMER
   ========================================================= */

function criarCardComercio(
  comercio
) {
  const aberto =
    comercioEstaAberto(
      comercio
    );

  const nome =
    comercio.nome ||
    "Estabelecimento";

  const categoria =
    comercio.categoria ||
    "";

  const endereco =
    comercio.endereco ||
    comercio.endereço ||
    "Andrelândia - MG";

  const elemento =
    document.createElement(
      "a"
    );

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
          obterImagem(
            comercio
          )
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

      <div class="comer-categoria">
        ${escaparHTML(categoria)}
      </div>

      <div class="comer-endereco">
        ${escaparHTML(endereco)}
      </div>

      <div
        class="comer-horario ${
          aberto
            ? "aberto"
            : "fechado"
        }"
      >
        ${
          aberto
            ? "Aberto agora"
            : "Fechado"
        }
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

  const filtrados =
    obterComerciosFiltrados();

  if (filtrados.length === 0) {
    comerList.innerHTML = `
      <div class="comer-empty">
        Nenhum lugar para comer encontrado.
      </div>
    `;

    if (mostrarMaisComer) {
      mostrarMaisComer.hidden =
        true;
    }

    return;
  }

  const quantidade =
    Math.min(
      limiteComer,
      filtrados.length
    );

  filtrados
    .slice(
      0,
      quantidade
    )
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
      filtrados.length,

    limite:
      limiteComer
  });
}

if (mostrarMaisComer) {
  mostrarMaisComer.addEventListener(
    "click",
    () => {
      limiteComer +=
        LIMITE_INCREMENTO;

      renderizarComercios();
    }
  );
}

document
  .querySelectorAll(
    ".comer-filtro"
  )
  .forEach(
    botao => {
      botao.addEventListener(
        "click",
        () => {
          categoriaComerFiltro =
            botao.dataset.filter ||
            "Todos";

          limiteComer =
            LIMITE_INICIAL;

          document
            .querySelectorAll(
              ".comer-filtro"
            )
            .forEach(
              item => {
                item.classList.remove(
                  "active"
                );
              }
            );

          botao.classList.add(
            "active"
          );

          renderizarComercios();
        }
      );
    }
  );

if (filtroAberto) {
  filtroAberto.addEventListener(
    "click",
    () => {
      mostrarSomenteAbertos =
        !mostrarSomenteAbertos;

      limiteComer =
        LIMITE_INICIAL;

      filtroAberto.dataset.status =
        mostrarSomenteAbertos
          ? "abertos"
          : "todos";

      filtroAberto.classList.toggle(
        "selecionado",
        mostrarSomenteAbertos
      );

      renderizarComercios();
    }
  );
}

/* =========================================================
   COMÉRCIO LOCAL
   ========================================================= */

const comercioList =
  document.getElementById(
    "comercioList"
  );

const mostrarMaisComercio =
  document.getElementById(
    "mostrarMaisComercio"
  );

const pesquisaComercio =
  document.getElementById(
    "pesquisaComercio"
  );

const filtroAbertoComercio =
  document.getElementById(
    "filtroAbertoComercio"
  );

const textoStatusComercio =
  document.getElementById(
    "textoStatusComercio"
  );

let pesquisaComercioTexto =
  "";

let mostrarSomenteComercioAbertos =
  false;

let limiteComercio =
  LIMITE_INICIAL;

function distanciaLevenshtein(
  textoA,
  textoB
) {
  const a =
    normalizarTexto(
      textoA
    );

  const b =
    normalizarTexto(
      textoB
    );

  if (!a) {
    return b.length;
  }

  if (!b) {
    return a.length;
  }

  const matriz =
    Array.from(
      {
        length:
          a.length + 1
      },
      () =>
        new Array(
          b.length + 1
        ).fill(0)
    );

  for (
    let i = 0;
    i <= a.length;
    i++
  ) {
    matriz[i][0] = i;
  }

  for (
    let j = 0;
    j <= b.length;
    j++
  ) {
    matriz[0][j] = j;
  }

  for (
    let i = 1;
    i <= a.length;
    i++
  ) {
    for (
      let j = 1;
      j <= b.length;
      j++
    ) {
      const custo =
        a[i - 1] ===
        b[j - 1]
          ? 0
          : 1;

      matriz[i][j] =
        Math.min(
          matriz[i - 1][j] +
            1,

          matriz[i][j - 1] +
            1,

          matriz[i - 1][
            j - 1
          ] +
            custo
        );
    }
  }

  return matriz[
    a.length
  ][
    b.length
  ];
}

function palavraCombina(
  palavraPesquisa,
  texto
) {
  const palavra =
    normalizarTexto(
      palavraPesquisa
    );

  const alvo =
    normalizarTexto(
      texto
    );

  if (!palavra) {
    return true;
  }

  if (
    alvo.includes(
      palavra
    )
  ) {
    return true;
  }

  const palavras =
    alvo.split(
      /\s+/
    );

  let tolerancia = 1;

  if (palavra.length >= 6) {
    tolerancia = 2;
  }

  return palavras.some(
    palavraAlvo => {
      if (
        palavraAlvo.includes(
          palavra
        )
      ) {
        return true;
      }

      if (
        Math.abs(
          palavraAlvo.length -
            palavra.length
        ) >
        tolerancia
      ) {
        return false;
      }

      return (
        distanciaLevenshtein(
          palavra,
          palavraAlvo
        ) <=
        tolerancia
      );
    }
  );
}

function comercioCombinaPesquisa(
  comercio,
  pesquisa
) {
  const busca =
    normalizarTexto(
      pesquisa
    );

  if (!busca) {
    return true;
  }

  const nome =
    normalizarTexto(
      comercio.nome
    );

  const categoria =
    normalizarTexto(
      comercio.categoria
    );

  const textoCompleto =
    `${nome} ${categoria}`;

  if (
    textoCompleto.includes(
      busca
    )
  ) {
    return true;
  }

  const palavras =
    busca
      .split(/\s+/)
      .filter(Boolean);

  return palavras.every(
    palavra => {
      return (
        palavraCombina(
          palavra,
          nome
        ) ||
        palavraCombina(
          palavra,
          categoria
        )
      );
    }
  );
}

function obterComerciosPesquisa() {
  return dadosComercios.filter(
    comercio => {
      const pesquisaOk =
        comercioCombinaPesquisa(
          comercio,
          pesquisaComercioTexto
        );

      const aberto =
        comercioEstaAberto(
          comercio
        );

      const abertoOk =
        !mostrarSomenteComercioAbertos ||
        aberto;

      return (
        pesquisaOk &&
        abertoOk
      );
    }
  );
}

function criarCardComercioLocal(
  comercio
) {
  const aberto =
    comercioEstaAberto(
      comercio
    );

  const nome =
    comercio.nome ||
    "Comércio";

  const categoria =
    comercio.categoria ||
    "Comércio";

  const endereco =
    comercio.endereco ||
    comercio.endereço ||
    "Andrelândia - MG";

  const elemento =
    document.createElement(
      "a"
    );

  elemento.className =
    "comer-item comercio-item";

  elemento.href =
    criarLinkLocal(
      comercio.id
    );

  elemento.innerHTML = `
    <div class="comer-image">

      <img
        src="${escaparHTML(
          obterImagem(
            comercio
          )
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

      <div class="comer-categoria">
        ${escaparHTML(categoria)}
      </div>

      <div class="comer-endereco">
        ${escaparHTML(endereco)}
      </div>

      <div
        class="comer-horario ${
          aberto
            ? "aberto"
            : "fechado"
        }"
      >
        ${
          aberto
            ? "Aberto agora"
            : "Fechado"
        }
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

  comercioList.innerHTML =
    "";

  const filtrados =
    obterComerciosPesquisa();

  if (
    filtrados.length === 0
  ) {
    comercioList.innerHTML = `
      <div class="comer-empty">
        ${
          pesquisaComercioTexto
            ? "Nenhum comércio encontrado para essa pesquisa."
            : "Nenhum comércio encontrado."
        }
      </div>
    `;

    if (mostrarMaisComercio) {
      mostrarMaisComercio.hidden =
        true;
    }

    return;
  }

  const quantidade =
    Math.min(
      limiteComercio,
      filtrados.length
    );

  filtrados
    .slice(
      0,
      quantidade
    )
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
      filtrados.length,

    limite:
      limiteComercio
  });
}

if (pesquisaComercio) {
  pesquisaComercio.addEventListener(
    "input",
    () => {
      pesquisaComercioTexto =
        pesquisaComercio.value.trim();

      limiteComercio =
        LIMITE_INICIAL;

      renderizarComercioLocal();
    }
  );
}

function atualizarStatusComercio() {
  if (
    !filtroAbertoComercio
  ) {
    return;
  }

  const algumAberto =
    dadosComercios.some(
      comercio =>
        comercioEstaAberto(
          comercio
        )
    );

  if (algumAberto) {
    if (
      textoStatusComercio
    ) {
      textoStatusComercio.textContent =
        "Aberto agora";
    }

    filtroAbertoComercio.classList.remove(
      "fechado"
    );
  } else {
    if (
      textoStatusComercio
    ) {
      textoStatusComercio.textContent =
        "Fechado";
    }

    filtroAbertoComercio.classList.add(
      "fechado"
    );
  }
}

if (
  filtroAbertoComercio
) {
  filtroAbertoComercio.addEventListener(
    "click",
    () => {
      mostrarSomenteComercioAbertos =
        !mostrarSomenteComercioAbertos;

      limiteComercio =
        LIMITE_INICIAL;

      filtroAbertoComercio.dataset.status =
        mostrarSomenteComercioAbertos
          ? "abertos"
          : "todos";

      filtroAbertoComercio.classList.toggle(
        "selecionado",
        mostrarSomenteComercioAbertos
      );

      renderizarComercioLocal();
    }
  );
}

if (
  mostrarMaisComercio
) {
  mostrarMaisComercio.addEventListener(
    "click",
    () => {
      limiteComercio +=
        LIMITE_INCREMENTO;

      renderizarComercioLocal();
    }
  );
}

/* =========================================================
   ONDE FICAR
   ========================================================= */

const ficarList =
  document.getElementById(
    "ficarList"
  );

const mostrarMaisFicar =
  document.getElementById(
    "mostrarMaisFicar"
  );

let limiteFicar =
  LIMITE_INICIAL;

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

  const nota =
    formatarNota(
      hospedagem.id,

      hospedagem.nota ??
        hospedagem.avaliacao ??
        hospedagem.avaliação ??
        ""
    );

  const elemento =
    document.createElement(
      "a"
    );

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
          obterImagem(
            hospedagem
          )
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

      <div class="ficar-nota">

        <img
          src="img/icones/estrela.png"
          alt="Avaliação"
        >

        <span>
          ${escaparHTML(nota)}
        </span>

      </div>

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

  ficarList.innerHTML =
    "";

  if (
    dadosHospedagem.length ===
    0
  ) {
    ficarList.innerHTML = `
      <div class="ficar-empty">
        Nenhuma hospedagem encontrada.
      </div>
    `;

    if (mostrarMaisFicar) {
      mostrarMaisFicar.hidden =
        true;
    }

    return;
  }

  const quantidade =
    Math.min(
      limiteFicar,
      dadosHospedagem.length
    );

  dadosHospedagem
    .slice(
      0,
      quantidade
    )
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

if (mostrarMaisFicar) {
  mostrarMaisFicar.addEventListener(
    "click",
    () => {
      limiteFicar +=
        LIMITE_INCREMENTO;

      renderizarHospedagens();
    }
  );
}

/* =========================================================
   CARREGAR JSON
   ========================================================= */

async function carregarJSON(
  caminho,
  nome
) {
  try {
    const resposta =
      await fetch(
        caminho
      );

    if (!resposta.ok) {
      throw new Error(
        `${nome}: HTTP ${resposta.status}`
      );
    }

    const dados =
      await resposta.json();

    if (
      !Array.isArray(
        dados
      )
    ) {
      throw new Error(
        `${nome} não contém um array JSON`
      );
    }

    console.log(
      `${nome} carregado:`,
      dados
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
   CARREGAR AVALIAÇÕES SUPABASE
   ========================================================= */

async function carregarAvaliacoes() {
  if (!supabaseClient) {
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
  }
}

/* =========================================================
   CARREGAMENTO DOS JSONs
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

  dadosHospedagem =
    resultados[2];

  await carregarAvaliacoes();

  console.log(
    "TOTAL DE LOCAIS:",
    dadosLocais.length
  );

  console.log(
    "TOTAL DE COMÉRCIOS:",
    dadosComercios.length
  );

  console.log(
    "TOTAL DE HOSPEDAGENS:",
    dadosHospedagem.length
  );

  [
    ...dadosLocais,
    ...dadosComercios,
    ...dadosHospedagem
  ].forEach(
    adicionarMarcador
  );

  renderizarOQueVisitar();

  atualizarStatusBotao();

  renderizarComercios();

  atualizarStatusComercio();

  renderizarComercioLocal();

  renderizarHospedagens();

  if (homeMap) {
    setTimeout(() => {
      homeMap.invalidateSize();
    }, 500);
  }
}

/* =========================================================
   MURAL — CONFIGURAÇÕES
   ========================================================= */

const pessoasList =
  document.getElementById(
    "pessoasList"
  );

const mostrarMaisPessoas =
  document.getElementById(
    "mostrarMaisPessoas"
  );

let limitePessoas = 10;

/* =========================================================
   CARREGAR PESSOAS
   ========================================================= */

async function carregarPessoas() {
  if (!pessoasList) {
    return;
  }

  try {
    const resposta =
      await fetch(
        "./DATA/pessoas.json"
      );

    if (!resposta.ok) {
      throw new Error(
        "Não foi possível carregar pessoas.json"
      );
    }

    pessoas =
      await resposta.json();

    if (
      !Array.isArray(
        pessoas
      )
    ) {
      throw new Error(
        "pessoas.json não contém um array"
      );
    }

    console.log(
      "PESSOAS CARREGADAS:",
      pessoas
    );

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
      mostrarMaisPessoas.hidden =
        true;
    }
  }
}

/* =========================================================
   CARREGAR VOTOS
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
        .from(
          "votos_pessoas"
        )
        .select(
          "pessoa_id, usuario_id, voto"
        );

    if (error) {
      console.error(
        "Erro ao carregar votos do mural:",
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

/* =========================================================
   CONTAGEM DE VOTOS
   ========================================================= */

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

  votos.forEach(
    voto => {
      if (
        Number(voto.voto) ===
        1
      ) {
        likes++;
      } else if (
        Number(voto.voto) ===
        -1
      ) {
        dislikes++;
      }
    }
  );

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
          String(
            pessoaId
          ) &&
        String(
          item.usuario_id
        ) ===
          String(
            usuarioAtual.id
          )
    );

  return voto
    ? Number(
        voto.voto
      )
    : 0;
}

/* =========================================================
   ORDENAR MURAL
   ========================================================= */

function ordenarPessoasPorVotos(
  lista
) {
  return [
    ...lista
  ].sort(
    (
      a,
      b
    ) => {
      const votoA =
        obterResumoVotos(
          a.id
        );

      const votoB =
        obterResumoVotos(
          b.id
        );

      /*
       * Primeiro: maior pontuação.
       * Em caso de empate: mais curtidas.
       * Depois: nome.
       */

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
        String(
          b.nome || ""
        ),
        "pt-BR"
      );
    }
  );
}

/* =========================================================
   CRIAR CARTÃO DE PESSOA
   ========================================================= */

function criarPessoaCard(
  pessoa
) {
  const link =
    document.createElement(
      "a"
    );

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
          aria-label="Curtir ${escaparHTML(nome)}"
          title="Curtir"
        >

         <img
         src="${iconeSobe}"
         alt=""
         >

          <span class="pessoa-like-count">
            ${resumo.likes}
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
          aria-label="Não curtir ${escaparHTML(nome)}"
          title="Não curtir"
        >

         <img
         src="${iconeDesce}"
         alt=""
         >

        </button>

      </div>

    </div>
  `;

  /*
   * Impede que clicar no botão de voto abra a página da pessoa.
   */

  link
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

            processarVotoPessoa(
              pessoa.id,
              Number(
                botao.dataset.voto
              )
            );
          }
        );
      }
    );

  return link;
}

/* =========================================================
   RENDERIZAR PESSOAS
   ========================================================= */

function renderizarPessoas() {
  if (!pessoasList) {
    return;
  }

  pessoasList.innerHTML =
    "";

  if (
    !Array.isArray(
      pessoas
    ) ||
    pessoas.length === 0
  ) {
    pessoasList.innerHTML = `
      <p class="lista-vazia">
        Ainda não há pessoas cadastradas no mural.
      </p>
    `;

    if (mostrarMaisPessoas) {
      mostrarMaisPessoas.hidden =
        true;
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
        criarPessoaCard(
          pessoa
        )
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
  /*
   * Usuário precisa estar logado.
   */

  if (!usuarioAtual) {
    abrirLogin();
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
          String(
            pessoaId
          ) &&
        String(
          voto.usuario_id
        ) ===
          String(
            usuarioAtual.id
          )
    );

  try {
    /*
     * Se clicou no mesmo voto: remove.
     */

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
          .from(
            "votos_pessoas"
          )
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

      /*
       * Se clicou no voto contrário: altera.
       */

    } else if (
      votoExistente
    ) {
      const {
        error
      } =
        await supabaseClient
          .from(
            "votos_pessoas"
          )
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

      /*
       * Se ainda não votou: cria.
       */

    } else {
      const {
        error
      } =
        await supabaseClient
          .from(
            "votos_pessoas"
          )
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
   MOSTRAR MAIS PESSOAS
   ========================================================= */

if (mostrarMaisPessoas) {
  mostrarMaisPessoas.addEventListener(
    "click",
    () => {
      limitePessoas += 10;

      renderizarPessoas();
    }
  );
}

/* =========================================================
   LOGIN — ESTILO
   ========================================================= */

function adicionarEstiloLogin() {
  if (
    document.getElementById(
      "estiloLoginMural"
    )
  ) {
    return;
  }

  const style =
    document.createElement(
      "style"
    );

  style.id =
    "estiloLoginMural";

  style.textContent = `
    .login-mural-overlay {
      position: fixed;
      inset: 0;
      z-index: 99999;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: rgba(0,0,0,.58);
    }

    .login-mural-overlay.aberto {
      display: flex;
    }

    .login-mural-box {
      width: min(100%, 420px);
      background: #ffffff;
      border-radius: 18px;
      padding: 28px;
      box-shadow: 0 20px 60px rgba(0,0,0,.28);
      position: relative;
    }

    .login-mural-fechar {
      position: absolute;
      top: 12px;
      right: 14px;
      border: 0;
      background: transparent;
      font-size: 28px;
      line-height: 1;
      cursor: pointer;
      color: #555;
    }

    .login-mural-tag {
      display: block;
      color: #194138;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1.2px;
      margin-bottom: 8px;
    }

    .login-mural-box h2 {
      margin: 0 0 8px;
      color: #091D1C;
      font-size: 24px;
    }

    .login-mural-box p {
      margin: 0 0 20px;
      color: #666;
      line-height: 1.5;
      font-size: 14px;
    }

    .login-mural-form {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .login-mural-form input {
      width: 100%;
      box-sizing: border-box;
      padding: 13px 14px;
      border: 1px solid #d5d5d5;
      border-radius: 10px;
      font: inherit;
      outline: none;
    }

    .login-mural-form input:focus {
      border-color: #194138;
    }

    .login-mural-entrar,
    .login-mural-cadastrar,
    .login-mural-sair {
      width: 100%;
      border: 0;
      border-radius: 10px;
      padding: 13px 16px;
      cursor: pointer;
      font: inherit;
      font-weight: 600;
    }

    .login-mural-entrar {
      background: #194138;
      color: #ffffff;
    }

    .login-mural-cadastrar {
      background: #f1f1f1;
      color: #194138;
    }

    .login-mural-mensagem {
      min-height: 20px;
      margin-top: 4px;
      font-size: 13px;
      color: #555;
    }

    .login-mural-conta {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid #e5e5e5;
    }

    .login-mural-conta strong {
      display: block;
      margin-bottom: 8px;
      color: #091D1C;
    }

    .login-mural-status {
      display: none;
    }

    .login-mural-status.aberto {
      display: block;
    }

    .login-mural-status-email {
      display: block;
      margin-bottom: 12px;
      color: #555;
      font-size: 13px;
      word-break: break-word;
    }

    .pessoa-votos {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 8px;
    }

    .pessoa-voto {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px;
      border: 0;
      background: transparent;
      cursor: pointer;
    }

    .pessoa-voto img {
      width: 22px;
      height: 22px;
      object-fit: contain;
    }

    .pessoa-voto-like .pessoa-like-count {
      font-size: 12px;
      font-weight: 600;
      color: #194138;
    }
  `;

  document.head.appendChild(
    style
  );
}

/* =========================================================
   CRIAR LOGIN
   ========================================================= */

function criarInterfaceLogin() {
  adicionarEstiloLogin();

  if (
    document.getElementById(
      "loginMuralOverlay"
    )
  ) {
    return;
  }

  const overlay =
    document.createElement(
      "div"
    );

  overlay.id =
    "loginMuralOverlay";

  overlay.className =
    "login-mural-overlay";

  overlay.innerHTML = `
    <div
      class="login-mural-box"
      role="dialog"
      aria-modal="true"
      aria-labelledby="loginMuralTitulo"
    >

      <button
        type="button"
        class="login-mural-fechar"
        id="loginMuralFechar"
        aria-label="Fechar"
      >
        ×
      </button>

      <div
        id="loginMuralFormulario"
      >

        <span class="login-mural-tag">
          MURAL DE ANDRELÂNDIA
        </span>

        <h2 id="loginMuralTitulo">
          Entre para votar
        </h2>

        <p>
          Faça login para participar do mural e votar nas pessoas de Andrelândia.
        </p>

        <form
          class="login-mural-form"
          id="formLoginMural"
        >

          <input
            type="email"
            id="loginMuralEmail"
            placeholder="Seu e-mail"
            autocomplete="email"
            required
          >

          <input
            type="password"
            id="loginMuralSenha"
            placeholder="Sua senha"
            autocomplete="current-password"
            minlength="6"
            required
          >

          <button
            type="submit"
            class="login-mural-entrar"
          >
            Entrar
          </button>

        </form>

        <div class="login-mural-conta">

          <strong>
            Ainda não possui conta?
          </strong>

          <button
            type="button"
            class="login-mural-cadastrar"
            id="loginMuralCadastrar"
          >
            Criar conta
          </button>

        </div>

        <div
          class="login-mural-mensagem"
          id="loginMuralMensagem"
        ></div>

      </div>

      <div
        class="login-mural-status"
        id="loginMuralStatus"
      >

        <span class="login-mural-tag">
          CONTA
        </span>

        <h2>
          Você está conectado
        </h2>

        <span
          class="login-mural-status-email"
          id="loginMuralStatusEmail"
        ></span>

        <button
          type="button"
          class="login-mural-sair"
          id="loginMuralSair"
        >
          Sair
        </button>

      </div>

    </div>
  `;

  document.body.appendChild(
    overlay
  );

  const fechar =
    document.getElementById(
      "loginMuralFechar"
    );

  const formulario =
    document.getElementById(
      "formLoginMural"
    );

  const cadastrar =
    document.getElementById(
      "loginMuralCadastrar"
    );

  const sair =
    document.getElementById(
      "loginMuralSair"
    );

  fechar.addEventListener(
    "click",
    fecharLogin
  );

  overlay.addEventListener(
    "click",
    event => {
      if (
        event.target ===
        overlay
      ) {
        fecharLogin();
      }
    }
  );

  formulario.addEventListener(
    "submit",
    async event => {
      event.preventDefault();

      await fazerLogin();
    }
  );

  cadastrar.addEventListener(
    "click",
    fazerCadastro
  );

  sair.addEventListener(
    "click",
    fazerLogout
  );
}

/* =========================================================
   ABRIR LOGIN
   ========================================================= */

function abrirLogin() {
  criarInterfaceLogin();

  const overlay =
    document.getElementById(
      "loginMuralOverlay"
    );

  if (!overlay) {
    return;
  }

  overlay.classList.add(
    "aberto"
  );

  atualizarInterfaceLogin();

  setTimeout(() => {
    document
      .getElementById(
        "loginMuralEmail"
      )
      ?.focus();
  }, 50);
}

function fecharLogin() {
  const overlay =
    document.getElementById(
      "loginMuralOverlay"
    );

  if (!overlay) {
    return;
  }

  overlay.classList.remove(
    "aberto"
  );
}

/* =========================================================
   MENSAGEM DO LOGIN
   ========================================================= */

function mostrarMensagemLogin(
  mensagem
) {
  const elemento =
    document.getElementById(
      "loginMuralMensagem"
    );

  if (elemento) {
    elemento.textContent =
      mensagem;
  }
}

/* =========================================================
   FAZER LOGIN
   ========================================================= */

async function fazerLogin() {
  if (!supabaseClient) {
    mostrarMensagemLogin(
      "Sistema de login indisponível."
    );

    return;
  }

  const email =
    document
      .getElementById(
        "loginMuralEmail"
      )
      ?.value
      .trim();

  const senha =
    document
      .getElementById(
        "loginMuralSenha"
      )
      ?.value;

  if (
    !email ||
    !senha
  ) {
    mostrarMensagemLogin(
      "Preencha e-mail e senha."
    );

    return;
  }

  mostrarMensagemLogin(
    "Entrando..."
  );

  const {
    data,
    error
  } =
    await supabaseClient.auth.signInWithPassword(
      {
        email,
        password:
          senha
      }
    );

  if (error) {
    console.error(
      error
    );

    mostrarMensagemLogin(
      "E-mail ou senha incorretos."
    );

    return;
  }

  usuarioAtual =
    data.user;

  mostrarMensagemLogin(
    "Login realizado."
  );

  await carregarVotosPessoas();

  renderizarPessoas();

  atualizarInterfaceLogin();

  setTimeout(
    fecharLogin,
    500
  );
}

/* =========================================================
   CADASTRO
   ========================================================= */

async function fazerCadastro() {
  if (!supabaseClient) {
    mostrarMensagemLogin(
      "Sistema de cadastro indisponível."
    );

    return;
  }

  const email =
    document
      .getElementById(
        "loginMuralEmail"
      )
      ?.value
      .trim();

  const senha =
    document
      .getElementById(
        "loginMuralSenha"
      )
      ?.value;

  if (
    !email ||
    !senha
  ) {
    mostrarMensagemLogin(
      "Informe e-mail e uma senha com pelo menos 6 caracteres."
    );

    return;
  }

  if (
    senha.length <
    6
  ) {
    mostrarMensagemLogin(
      "A senha precisa ter pelo menos 6 caracteres."
    );

    return;
  }

  mostrarMensagemLogin(
    "Criando sua conta..."
  );

  const {
    data,
    error
  } =
    await supabaseClient.auth.signUp(
      {
        email,
        password:
          senha
      }
    );

  if (error) {
    console.error(
      error
    );

    mostrarMensagemLogin(
      error.message ||
        "Não foi possível criar a conta."
    );

    return;
  }

  /*
   * Dependendo da configuração do Supabase, a confirmação de e-mail pode estar ativada.
   */

  if (
    data.session &&
    data.user
  ) {
    usuarioAtual =
      data.user;

    mostrarMensagemLogin(
      "Conta criada e login realizado."
    );

    await carregarVotosPessoas();

    renderizarPessoas();

    atualizarInterfaceLogin();

    setTimeout(
      fecharLogin,
      700
    );
  } else {
    mostrarMensagemLogin(
      "Conta criada. Verifique seu e-mail para confirmar o cadastro e depois faça login."
    );
  }
}

/* =========================================================
   LOGOUT
   ========================================================= */

async function fazerLogout() {
  if (!supabaseClient) {
    return;
  }

  const {
    error
  } =
    await supabaseClient.auth.signOut();

  if (error) {
    console.error(
      "Erro ao sair:",
      error
    );

    return;
  }

  usuarioAtual =
    null;

  await carregarVotosPessoas();

  renderizarPessoas();

  atualizarInterfaceLogin();

  fecharLogin();
}

/* =========================================================
   INTERFACE DE LOGIN
   ========================================================= */

function atualizarInterfaceLogin() {
  const formulario =
    document.getElementById(
      "loginMuralFormulario"
    );

  const status =
    document.getElementById(
      "loginMuralStatus"
    );

  const email =
    document.getElementById(
      "loginMuralStatusEmail"
    );

  if (
    !formulario ||
    !status
  ) {
    return;
  }

  if (usuarioAtual) {
    formulario.style.display =
      "none";

    status.classList.add(
      "aberto"
    );

    if (email) {
      email.textContent =
        usuarioAtual.email ||
        "";
    }
  } else {
    formulario.style.display =
      "block";

    status.classList.remove(
      "aberto"
    );
  }
}

/* =========================================================
   ESTADO DE AUTENTICAÇÃO
   ========================================================= */

async function inicializarAutenticacao() {
  if (!supabaseClient) {
    return;
  }

  const {
    data
  } =
    await supabaseClient.auth.getSession();

  usuarioAtual =
    data?.session?.user ||
    null;

  criarInterfaceLogin();

  atualizarInterfaceLogin();

  supabaseClient.auth.onAuthStateChange(
    async (
      evento,
      sessao
    ) => {
      usuarioAtual =
        sessao?.user ||
        null;

      atualizarInterfaceLogin();

      /*
       * Recarrega os votos porque o destaque do voto depende do usuário logado.
       */

      await carregarVotosPessoas();

      renderizarPessoas();
    }
  );
}

/* =========================================================
   BOTÃO DE LOGIN NO MURAL
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
      "botaoLoginMural"
    )
  ) {
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
    document.createElement(
      "div"
    );

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

  header.appendChild(
    area
  );

  const botao =
    document.getElementById(
      "abrirLoginMuralBotao"
    );

  botao.addEventListener(
    "click",
    abrirLogin
  );

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
   INICIALIZAÇÃO DO SITE
   ========================================================= */

async function iniciarSite() {
  adicionarEstiloMarcadorGenerico();

  inicializarMapa();

  descobrirSlidesHero();

  criarInterfaceLogin();

  adicionarBotaoLoginMural();

  await inicializarAutenticacao();

  atualizarBotaoLoginMural();

  await carregarDados();

  await carregarPessoas();
}

/* =========================================================
   INICIAR
   ========================================================= */

iniciarSite();

/* =========================================================
   ATUALIZAR HORÁRIOS A CADA MINUTO
   ========================================================= */

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

/* =========================================================
   ATUALIZAR TAMANHO DO MAPA
   ========================================================= */

window.addEventListener(
  "resize",
  () => {
    if (homeMap) {
      homeMap.invalidateSize();
    }
  }
);

/* =========================================================
   TECLA ESC — LOGIN
   ========================================================= */

document.addEventListener(
  "keydown",
  event => {
    if (
      event.key ===
      "Escape"
    ) {
      fecharLogin();
    }
  }
);
