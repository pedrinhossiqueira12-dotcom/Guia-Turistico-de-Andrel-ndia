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


/* =========================================================
   DADOS
========================================================= */

let dadosLocais = [];
let dadosComercios = [];
let dadosHospedagem = [];

let limiteVisiveis = LIMITE_INICIAL;


/* =========================================================
   UTILITÁRIOS
========================================================= */

function normalizarTexto(texto = "") {
  return String(texto)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}


/* =========================================================
   CATEGORIAS DO MAPA
========================================================= */

const CATEGORIAS_MAPA_COMERCIO = {

  alimentacao: [
    "restaurante",
    "lanchonete",
    "pizzaria",
    "cafeteria",
    "cafe",
    "padaria",
    "panificadora",
    "bar",
    "sorveteria",
    "sorvete",
    "acai",
    "hamburgueria",
    "hamburguer",
    "confeitaria",
    "doceria",
    "pastelaria",
    "churrascaria",
    "buffet",
    "emporio",
    "vinicola",
    "hortifruti",
    "alimentacao",
    "fast food",
    "food"
  ],

  mercados: [
    "supermercado",
    "mercado",
    "mercearia",
    "acougue"
  ],

  compras: [
    "loja de roupas",
    "loja de calcados",
    "loja de presentes",
    "comercio",
    "papelaria",
    "flores",
    "enxovais",
    "eletrodomesticos"
  ],

  saude: [
    "farmacia",
    "otica"
  ],

  animais: [
    "pet shop",
    "clinica veterinaria"
  ],

  automotivo: [
    "autopecas",
    "oficina mecanica",
    "oficina de motos",
    "posto de combustivel",
    "lava-jato",
    "lava jato"
  ],

  casa: [
    "material de construcao",
    "vidracaria",
    "ferragens",
    "ferramentas",
    "moveis"
  ],

  servicos: [
    "servicos",
    "cartorio",
    "despachante",
    "grafica",
    "comunicacao visual",
    "embalagens",
    "transporte"
  ],

  beleza: [
    "salao de beleza",
    "barbearia"
  ],

  agro: [
    "agropecuaria",
    "laticinios"
  ],

  tecnologia: [
    "informatica",
    "assistencia tecnica",
    "eletronicos",
    "celulares",
    "telefonia"
  ],

  hospedagem: [
    "hotel",
    "pousada"
  ],

  esportes: [
    "academia",
    "esportes"
  ]

};


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
   CAMADA DE SATÉLITE
========================================================= */

L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    attribution:
      "Tiles &copy; Esri",
    maxNativeZoom: 19,
    maxZoom: 22
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

let marcadores = [];


/* =========================================================
   ÍCONES
========================================================= */

function criarIcone(categoria) {

  const categoriaNormalizada =
    normalizarTexto(categoria);

  let arquivo = "local.png";


  /* TURISMO */

  if (
    categoriaNormalizada.includes("igreja")
  ) {
    arquivo = "igreja.png";
  }

  else if (
    categoriaNormalizada.includes("mirante")
  ) {
    arquivo = "mirante.png";
  }

  else if (
    categoriaNormalizada.includes("natureza")
  ) {
    arquivo = "natureza.png";
  }

  else if (
    categoriaNormalizada.includes("historico") ||
    categoriaNormalizada.includes("historia")
  ) {
    arquivo = "historico.png";
  }


  /* ALIMENTAÇÃO */

  else if (
    categoriaNormalizada === "cafeteria" ||
    categoriaNormalizada === "cafe"
  ) {
    arquivo = "cafeteria.png";
  }

  else if (
    CATEGORIAS_MAPA_COMERCIO.alimentacao.some(
      categoria =>
        categoriaNormalizada.includes(
          normalizarTexto(categoria)
        )
    )
  ) {
    arquivo = "alimentacao.png";
  }


  /* HOSPEDAGEM */

  else if (
    CATEGORIAS_MAPA_COMERCIO.hospedagem.some(
      categoria =>
        categoriaNormalizada.includes(
          normalizarTexto(categoria)
        )
    )
  ) {
    arquivo = "hotel.png";
  }


  /* ESPORTES */

  else if (
    CATEGORIAS_MAPA_COMERCIO.esportes.some(
      categoria =>
        categoriaNormalizada.includes(
          normalizarTexto(categoria)
        )
    )
  ) {
    arquivo = "esporte.png";
  }


  /* COMÉRCIO */

  else if (
    Object.values(CATEGORIAS_MAPA_COMERCIO)
      .some(lista =>
        lista.some(categoria =>
          categoriaNormalizada.includes(
            normalizarTexto(categoria)
          )
        )
      )
  ) {
    arquivo = "comercio.png";
  }


  return L.icon({

    iconUrl: `./img/interface/${arquivo}`,

    iconSize: [38, 38],

    iconAnchor: [19, 38],

    popupAnchor: [0, -38]

  });

}


/* =========================================================
   CRIAR POPUP
========================================================= */

function criarPopup(item) {

  const nome =
    item.nome || "Local";

  const categoria =
    item.categoria || "";

  const capa =
    item.capa || FALLBACK_IMAGE;

  const pagina =
    item.pagina || "local.html";

  const id =
    item.id || "";


  return `

    <div class="map-popup">

      <img
        src="${capa}"
        alt="${nome}"
        class="popup-image"
        onerror="this.src='${FALLBACK_IMAGE}'"
      >

      <div class="popup-content">

        <h3>
          ${nome}
        </h3>

        ${
          categoria
            ? `<span class="popup-category">
                ${categoria}
              </span>`
            : ""
        }

        <a
          href="./PAGES/${pagina}?id=${encodeURIComponent(id)}"
          class="popup-button"
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

  if (
    item.latitude === null ||
    item.longitude === null ||
    item.latitude === undefined ||
    item.longitude === undefined
  ) {
    return;
  }


  const latitude =
    Number(item.latitude);

  const longitude =
    Number(item.longitude);


  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return;
  }


  const marcador =
    L.marker(
      [latitude, longitude],
      {
        icon: criarIcone(item.categoria)
      }
    );


  marcador.bindPopup(
    criarPopup(item)
  );


  marcadores.push({

    marcador,

    categoria:
      item.categoria || "",

    tipo:
      item.tipo || "",

    id:
      item.id || "",

    nome:
      item.nome || ""

  });


  marcador.addTo(homeMap);

}


/* =========================================================
   VERIFICAR CATEGORIA DO COMÉRCIO
========================================================= */

function comercioPertenceCategoriaMapa(
  item,
  filtro
) {

  const filtroNormalizado =
    normalizarTexto(filtro);

  const categoria =
    normalizarTexto(item.categoria);

  const tipo =
    normalizarTexto(item.tipo);


  /* TODOS */

  if (
    filtroNormalizado === "todos"
  ) {
    return true;
  }


  /* TURISMO */

  if (
    filtroNormalizado === "turismo"
  ) {
    return tipo === "local";
  }


  /* HOSPEDAGEM */

  if (
    filtroNormalizado === "hospedagem"
  ) {

    return (
      tipo === "hospedagem" ||

      CATEGORIAS_MAPA_COMERCIO
        .hospedagem
        .some(categoriaFiltro =>
          categoria.includes(
            normalizarTexto(categoriaFiltro)
          )
        )
    );

  }


  /*
    A PARTIR DAQUI,
    OS FILTROS SÃO EXCLUSIVOS
    PARA COMÉRCIOS
  */

  if (
    tipo !== "comercio"
  ) {
    return false;
  }


  const categoriasFiltro =
    CATEGORIAS_MAPA_COMERCIO[
      filtroNormalizado
    ];


  /*
    Se o filtro existir na lista,
    verifica se a categoria do JSON
    pertence ao grupo.
  */

  if (
    categoriasFiltro
  ) {

    return categoriasFiltro.some(
      categoriaFiltro =>
        categoria.includes(
          normalizarTexto(categoriaFiltro)
        )
    );

  }


  /*
    Fallback:
    permite que o filtro funcione
    também com uma categoria específica.
  */

  return (
    categoria === filtroNormalizado
  );

}


/* =========================================================
   FILTRO DO MAPA
========================================================= */

function aplicarFiltroMapa(
  filtro
) {

  marcadores.forEach(item => {

    const mostrar =
      comercioPertenceCategoriaMapa(
        item,
        filtro
      );


    if (mostrar) {

      item.marcador.addTo(
        homeMap
      );

    }

    else {

      homeMap.removeLayer(
        item.marcador
      );

    }

  });


  /*
    Depois de filtrar, força o Leaflet
    a recalcular o tamanho do mapa.
  */

  setTimeout(() => {

    homeMap.invalidateSize();

  }, 100);

}


/* =========================================================
   FILTROS DO MAPA
========================================================= */

document
  .querySelectorAll(".map-filter")
  .forEach(botao => {

    botao.addEventListener(
      "click",
      () => {

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


        const filtro =
          botao.dataset.filter ||
          "Todos";


        aplicarFiltroMapa(
          filtro
        );

      }
    );

  });


/* =========================================================
   FUNÇÕES DE COMÉRCIO
========================================================= */

const CATEGORIAS_COMIDA = [

  "restaurante",
  "lanchonete",
  "cafeteria",
  "cafe",
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
  "fast food",
  "food"

];


function comercioEhAlimentacao(
  comercio
) {

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
      item =>
        categoria.includes(
          normalizarTexto(item)
        )
    )
  ) {
    return true;
  }


  return CATEGORIAS_COMIDA.some(
    item =>
      nome.includes(
        normalizarTexto(item)
      )
  );

}


/* =========================================================
   CATEGORIAS DE COMÉRCIO DO SITE
========================================================= */

function comercioPertenceCategoria(
  comercio,
  categoriaFiltro
) {

  const categoria =
    normalizarTexto(
      comercio.categoria
    );


  const filtro =
    normalizarTexto(
      categoriaFiltro
    );


  if (
    filtro === "todos"
  ) {
    return true;
  }


  if (
    filtro === "alimentacao"
  ) {
    return comercioEhAlimentacao(
      comercio
    );
  }


  if (
    filtro === "sorvete/acai"
  ) {

    return (
      categoria.includes("sorvete") ||
      categoria.includes("sorveteria") ||
      categoria.includes("acai")
    );

  }


  if (
    filtro === "cafe"
  ) {

    return (
      categoria.includes("cafe") ||
      categoria.includes("cafeteria")
    );

  }


  return categoria.includes(
    filtro
  );

}


/* =========================================================
   STATUS DE FUNCIONAMENTO
========================================================= */

function comercioEstaAberto(
  comercio
) {

  /*
    Caso não exista horário,
    consideramos desconhecido.
  */

  if (
    !comercio.horario ||
    comercio.horario.trim() === ""
  ) {
    return null;
  }


  /*
    Esta função pode continuar usando
    sua lógica atual de horários caso
    você tenha uma estrutura específica
    no JSON.
  */

  return null;

}


/* =========================================================
   IMAGEM SEGURA
========================================================= */

function imagemSegura(
  caminho
) {

  return caminho &&
    caminho.trim() !== ""
    ? caminho
    : FALLBACK_IMAGE;

}


/* =========================================================
   CARREGAR DADOS
========================================================= */

async function carregarDados() {

  try {

    const [
      respostaLocais,
      respostaComercios,
      respostaHospedagem
    ] = await Promise.all([

      fetch(
        "./DATA/locais.json"
      ),

      fetch(
        "./DATA/comercios.json"
      ),

      fetch(
        "./DATA/hospedagem.json"
      )

    ]);


    if (
      !respostaLocais.ok
    ) {
      throw new Error(
        "Erro ao carregar locais.json"
      );
    }


    if (
      !respostaComercios.ok
    ) {
      throw new Error(
        "Erro ao carregar comercios.json"
      );
    }


    if (
      !respostaHospedagem.ok
    ) {
      throw new Error(
        "Erro ao carregar hospedagem.json"
      );
    }


    dadosLocais =
      await respostaLocais.json();


    dadosComercios =
      await respostaComercios.json();


    dadosHospedagem =
      await respostaHospedagem.json();


    /*
      IMPORTANTE:
      cada grupo recebe seu próprio tipo.
    */

    dadosLocais.forEach(
      item => {

        adicionarMarcador({

          ...item,

          tipo: "local"

        });

      }
    );


    dadosComercios.forEach(
      item => {

        adicionarMarcador({

          ...item,

          tipo: "comercio"

        });

      }
    );


    dadosHospedagem.forEach(
      item => {

        adicionarMarcador({

          ...item,

          tipo: "hospedagem"

        });

      }
    );


    /*
      Mantém todos visíveis
      inicialmente.
    */

    aplicarFiltroMapa(
      "Todos"
    );


    /*
      Atualiza as seções do site.
    */

    atualizarPagina();


  }

  catch (erro) {

    console.error(
      "Erro ao carregar dados:",
      erro
    );

  }

}


/* =========================================================
   ATUALIZAR PÁGINA
========================================================= */

function atualizarPagina() {

  /*
    Mantém a atualização das
    funções existentes da página.

    Caso suas funções de renderização
    já existam no seu JS original,
    elas podem continuar aqui.
  */

  if (
    typeof renderizarLocais === "function"
  ) {

    renderizarLocais();

  }


  if (
    typeof renderizarComercios === "function"
  ) {

    renderizarComercios();

  }


  if (
    typeof renderizarHospedagem === "function"
  ) {

    renderizarHospedagem();

  }

}


/* =========================================================
   REDIMENSIONAR MAPA
========================================================= */

window.addEventListener(
  "resize",
  () => {

    homeMap.invalidateSize();

  }
);


/* =========================================================
   INICIALIZAÇÃO
========================================================= */

carregarDados();
