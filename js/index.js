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
   DADOS
   ========================================================= */

let dadosLocais = [];
let dadosComercios = [];
let dadosHospedagem = [];


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
    Math.PI / 180;

  const dLon =
    (lon2 - lon1) *
    Math.PI / 180;

  const a =
    Math.sin(dLat / 2) *
    Math.sin(dLat / 2) +

    Math.cos(
      lat1 * Math.PI / 180
    ) *

    Math.cos(
      lat2 * Math.PI / 180
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


function formatarDistancia(distancia) {

  if (distancia < 1) {

    return `${Math.round(distancia * 1000)} m do centro`;
  }

  return `${distancia.toFixed(1).replace(".", ",")} km do centro`;
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
   MAPA
   ========================================================= */

const homeMap = L.map("homeMap", {

  zoomControl: false,

  scrollWheelZoom: true,

  maxZoom: 22

}).setView(
  [
    CENTRO_ANDRELANDIA.latitude,
    CENTRO_ANDRELANDIA.longitude
  ],
  15
);


/* =========================================================
   MAPA SATÉLITE
   ========================================================= */

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
).addTo(homeMap);


/* =========================================================
   CONTROLE DE ZOOM
   ========================================================= */

L.control.zoom({
  position: "bottomright"
}).addTo(homeMap);


/* =========================================================
   MARCADORES
   ========================================================= */

const marcadores = [];


/* =========================================================
   ÍCONE DO MARCADOR
   ========================================================= */

function criarIcone(categoria) {

  const categoriaNormalizada =
    normalizarTexto(categoria);

  let arquivo = "local.png";

  switch (categoriaNormalizada) {

    case "igreja":
      arquivo = "igreja.png";
      break;

    case "mirante":
      arquivo = "mirante.png";
      break;

    case "natureza":
      arquivo = "natureza.png";
      break;

    case "historico":
    case "historia":
      arquivo = "historico.png";
      break;

    case "alimentacao":
      arquivo = "alimentacao.png";
      break;

    case "cafe":
    case "cafeteria":
      arquivo = "cafeteria.png";
      break;

    case "hospedagem":
      arquivo = "hotel.png";
      break;

    case "comercio":
      arquivo = "comercio.png";
      break;

    case "cultura":
      arquivo = "cultura.png";
      break;

    case "esporte":
    case "esportes":
      arquivo = "esporte.png";
      break;

    default:
      arquivo = "local.png";
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
      descricao.substring(0, 140) +
      "...";
  }

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

  const textoDescricao =
    escaparHTML(descricao);

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

function adicionarMarcador(item) {

  const latitude =
    Number(item.latitude);

  const longitude =
    Number(item.longitude);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
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
          criarIcone(item.categoria)
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
      item.categoria || "",

    id:
      item.id,

    nome:
      item.nome || ""
  });

  marcador.addTo(homeMap);
}


/* =========================================================
   FILTROS DO MAPA
   ========================================================= */

function aplicarFiltroMapa(categoria) {

  const filtroNormalizado =
    normalizarTexto(categoria);

  marcadores.forEach(item => {

    const categoriaItem =
      normalizarTexto(
        item.categoria
      );

    const mostrar =
      filtroNormalizado === "todos" ||
      categoriaItem === filtroNormalizado;

    if (mostrar) {

      item.marcador.addTo(
        homeMap
      );

    } else {

      homeMap.removeLayer(
        item.marcador
      );
    }

  });
}


document
  .querySelectorAll(".map-filter")
  .forEach(botao => {

    botao.addEventListener(
      "click",
      () => {

        const filtro =
          botao.dataset.filter ||
          "Todos";

        document
          .querySelectorAll(".map-filter")
          .forEach(item => {

            item.classList.remove(
              "active"
            );

          });

        botao.classList.add(
          "active"
        );

        aplicarFiltroMapa(
          filtro
        );
      }
    );

  });


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


function criarCardVisitar(item) {

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
    Number(item.latitude);

  const longitude =
    Number(item.longitude);

  let localizacao =
    "Andrelândia - MG";

  if (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude)
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
    document.createElement("a");

  elemento.className =
    "visitar-item";

  elemento.href =
    criarLinkLocal(item.id);

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

  if (dadosLocais.length === 0) {

    visitarList.innerHTML = `
      <div class="visitar-empty">
        Nenhum ponto turístico encontrado.
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


  /* =======================================================
     VERIFICAÇÃO DO DIA
     ======================================================= */

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


  /*
     Segunda a sábado
  */

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

  }


  /*
     Segunda a sexta
  */

  else if (
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


  /*
     Somente sábado
  */

  else if (
    texto.includes(
      "sabado"
    ) &&
    !texto.includes(
      "segunda a sabado"
    )
  ) {

    if (
      texto.includes("segunda") ||
      texto.includes("terca") ||
      texto.includes("quarta") ||
      texto.includes("quinta") ||
      texto.includes("sexta")
    ) {

      diaPermitido = true;

    }

  }


  if (!diaPermitido) {
    return false;
  }


  /* =======================================================
     HORÁRIOS
  ======================================================= */

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
        horaAtual >= horaInicial &&
        horaAtual <= horaFinal
      ) {

        return true;
      }

    } else {

      if (
        horaAtual >= horaInicial ||
        horaAtual <= horaFinal
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
  "açai",

  "pizzaria",
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
  "alimentação",

  "food",

  "fast food"
].map(normalizarTexto);


/* =========================================================
   IDENTIFICAR ESTABELECIMENTO DE COMIDA
   ========================================================= */

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


  /*
     Primeiro verifica a categoria.
  */

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


  /*
     Alguns estabelecimentos podem
     ter categoria genérica.
     Neste caso verificamos o nome.
  */

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

  ].map(normalizarTexto);


  return palavrasComida.some(
    palavra =>
      nome.includes(palavra)
  );
}


/* =========================================================
   CATEGORIA DO FILTRO — ONDE COMER
   ========================================================= */

function comercioPertenceCategoria(
  comercio,
  filtro
) {

  if (
    filtro === "Todos"
  ) {

    return comercioEhAlimentacao(
      comercio
    );
  }

  const categoria =
    normalizarTexto(
      comercio.categoria
    );

  switch (normalizarTexto(filtro)) {

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
        categoria.includes("cafe") ||
        categoria.includes("cafeteria")
      );

    case "sorvete/acai":

    case "sorvete/acai":

      return (
        categoria.includes("sorvete") ||
        categoria.includes("acai")
      );

    default:

      return (
        categoria ===
        normalizarTexto(filtro)
      );
  }
}


/* =========================================================
   COMÉRCIOS FILTRADOS — ONDE COMER
   ========================================================= */

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


/* =========================================================
   STATUS DO BOTÃO — ONDE COMER
   ========================================================= */

function atualizarStatusBotao() {

  if (!filtroAberto) {
    return;
  }

  const algumAberto =
    dadosComercios
      .filter(comercio =>
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


/* =========================================================
   RENDERIZAR — ONDE COMER
   ========================================================= */

function renderizarComercios() {

  if (!comerList) {
    return;
  }

  comerList.innerHTML = "";

  const filtrados =
    obterComerciosFiltrados();


  if (
    filtrados.length === 0
  ) {

    comerList.innerHTML = `
      <div class="comer-empty">
        Nenhum lugar para comer encontrado.
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
      filtrados.length
    );


  filtrados
    .slice(0, quantidade)
    .forEach(comercio => {

      comerList.appendChild(
        criarCardComercio(
          comercio
        )
      );

    });


  configurarMostrarMais({

    botao:
      mostrarMaisComer,

    total:
      filtrados.length,

    limite:
      limiteComer
  });
}


/* =========================================================
   BOTÃO MOSTRAR MAIS — ONDE COMER
   ========================================================= */

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


/* =========================================================
   FILTROS — ONDE COMER
   ========================================================= */

document
  .querySelectorAll(
    ".comer-filtro"
  )
  .forEach(botao => {

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
          .forEach(item => {

            item.classList.remove(
              "active"
            );

          });

        botao.classList.add(
          "active"
        );

        renderizarComercios();
      }
    );

  });


/* =========================================================
   ABERTO AGORA — ONDE COMER
   ========================================================= */

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

let pesquisaComercioTexto = "";

let mostrarSomenteComercioAbertos =
  false;

let limiteComercio =
  LIMITE_INICIAL;


/* =========================================================
   DISTÂNCIA DE TEXTO
   ========================================================= */

function distanciaLevenshtein(
  textoA,
  textoB
) {

  const a =
    normalizarTexto(textoA);

  const b =
    normalizarTexto(textoB);

  if (!a) {
    return b.length;
  }

  if (!b) {
    return a.length;
  }

  const matriz =
    Array.from(
      {
        length: a.length + 1
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
        a[i - 1] === b[j - 1]
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

  return matriz[a.length][b.length];
}


/* =========================================================
   PESQUISA APROXIMADA
   ========================================================= */

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
    alvo.includes(palavra)
  ) {

    return true;
  }


  const palavras =
    alvo.split(
      /\s+/
    );


  /*
     Tolerância de erro:

     1 erro para palavras pequenas
     2 erros para palavras maiores
  */

  let tolerancia = 1;

  if (
    palavra.length >= 6
  ) {

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


      /*
         Evita comparar palavras
         muito diferentes em tamanho.
      */

      if (
        Math.abs(
          palavraAlvo.length -
          palavra.length
        ) > tolerancia
      ) {

        return false;
      }


      return (
        distanciaLevenshtein(
          palavra,
          palavraAlvo
        ) <= tolerancia
      );
    }
  );
}


/* =========================================================
   VERIFICAR PESQUISA DO COMÉRCIO
   ========================================================= */

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


  /*
     A pesquisa pode encontrar:

     - nome
     - categoria
     - nome + categoria
  */

  const textoCompleto =
    `${nome} ${categoria}`;


  /*
     Primeiro tenta a frase completa.
  */

  if (
    textoCompleto.includes(
      busca
    )
  ) {

    return true;
  }


  /*
     Depois separa cada palavra.

     Exemplo:

     "supermercado nogueira"

     procura:

     supermercado
     +
     nogueira
  */

  const palavras =
    busca.split(
      /\s+/
    ).filter(Boolean);


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


/* =========================================================
   COMÉRCIOS FILTRADOS — COMÉRCIO LOCAL
   ========================================================= */

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


/* =========================================================
   CARD DE COMÉRCIO
   =========================================================
   
   Usa as mesmas classes dos cards
   de "Onde comer" para reaproveitar
   o CSS existente.
   ========================================================= */

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
    document.createElement("a");


  /*
     Reaproveita .comer-item
     para não duplicar CSS.
  */

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


/* =========================================================
   RENDERIZAR COMÉRCIO LOCAL
   ========================================================= */

function renderizarComercioLocal() {

  if (!comercioList) {
    return;
  }


  comercioList.innerHTML = "";


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
      mostrarMaisComercio.hidden = true;
    }


    return;
  }


  const quantidade =
    Math.min(
      limiteComercio,
      filtrados.length
    );


  filtrados
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
      filtrados.length,

    limite:
      limiteComercio
  });
}


/* =========================================================
   PESQUISA EM TEMPO REAL
   ========================================================= */

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


/* =========================================================
   STATUS — COMÉRCIO LOCAL
   ========================================================= */

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

    if (textoStatusComercio) {

      textoStatusComercio.textContent =
        "Aberto agora";
    }

    filtroAbertoComercio.classList.remove(
      "fechado"
    );

  } else {

    if (textoStatusComercio) {

      textoStatusComercio.textContent =
        "Fechado";
    }

    filtroAbertoComercio.classList.add(
      "fechado"
    );
  }
}


/* =========================================================
   BOTÃO ABERTO AGORA — COMÉRCIO
   ========================================================= */

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


/* =========================================================
   MOSTRAR MAIS — COMÉRCIO
   ========================================================= */

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


/* =========================================================
   CARD — ONDE FICAR
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

  const nota =
    hospedagem.nota ??
    hospedagem.avaliacao ??
    hospedagem.avaliação ??
    "";

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


/* =========================================================
   RENDERIZAR — ONDE FICAR
   ========================================================= */

function renderizarHospedagens() {

  if (!ficarList) {
    return;
  }

  ficarList.innerHTML = "";

  if (
    dadosHospedagem.length === 0
  ) {

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
    .forEach(hospedagem => {

      ficarList.appendChild(
        criarCardHospedagem(
          hospedagem
        )
      );

    });

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
   CARREGAR UM JSON
   ========================================================= */

async function carregarJSON(
  caminho,
  nome
) {

  try {

    const resposta =
      await fetch(caminho);

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
   CARREGAMENTO DOS JSONs
   ========================================================= */

async function carregarDados() {

  dadosLocais =
    await carregarJSON(
      "./DATA/locais.json",
      "locais.json"
    );

  dadosComercios =
    await carregarJSON(
      "./DATA/comercios.json",
      "comercios.json"
    );

  dadosHospedagem =
    await carregarJSON(
      "./DATA/hospedagem.json",
      "hospedagem.json"
    );


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


  /* =======================================================
     MAPA
  ======================================================= */

  [
    ...dadosLocais,
    ...dadosComercios,
    ...dadosHospedagem
  ].forEach(
    adicionarMarcador
  );


  /* =======================================================
     O QUE VISITAR
  ======================================================= */

  renderizarOQueVisitar();


  /* =======================================================
     ONDE COMER
  ======================================================= */

  atualizarStatusBotao();

  renderizarComercios();


  /* =======================================================
     COMÉRCIO LOCAL
  ======================================================= */

  atualizarStatusComercio();

  renderizarComercioLocal();


  /* =======================================================
     ONDE FICAR
  ======================================================= */

  renderizarHospedagens();
}


/* =========================================================
   INICIAR SITE
   ========================================================= */

carregarDados();


/* =========================================================
   ATUALIZAR STATUS A CADA MINUTO
   ========================================================= */

setInterval(
  () => {

    if (
      dadosComercios.length === 0
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
   MURAL DE ANDRELÂNDIA
   ========================================================= */

const pessoasList =
  document.getElementById(
    "pessoasList"
  );

const mostrarMaisPessoas =
  document.getElementById(
    "mostrarMaisPessoas"
  );

let pessoas = [];

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

    if (!Array.isArray(pessoas)) {

      throw new Error(
        "pessoas.json não contém um array"
      );
    }

    console.log(
      "PESSOAS CARREGADAS:",
      pessoas
    );

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
   CRIAR CARTÃO
   ========================================================= */

function criarPessoaCard(pessoa) {

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
    "./img/sem-foto.png";

  const nome =
    pessoa.nome ||
    "Pessoa";

  const categoria =
    pessoa.categoria ||
    "Personalidade";

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

    </div>

  `;

  return link;
}


/* =========================================================
   RENDERIZAR PESSOAS
   ========================================================= */

function renderizarPessoas() {

  if (!pessoasList) {
    return;
  }

  pessoasList.innerHTML = "";

  if (
    !Array.isArray(pessoas) ||
    pessoas.length === 0
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

  const fragmento =
    document.createDocumentFragment();

  const pessoasVisiveis =
    pessoas.slice(
      0,
      limitePessoas
    );

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
      pessoas.length <= limitePessoas;
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
   INICIAR MURAL
   ========================================================= */

carregarPessoas();
