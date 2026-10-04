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

/*

Bucket utilizado pelas imagens cadastradas
no Mural.
*/
const SUPABASE_STORAGE_BUCKET_MURAL =
"mural";

const SUPABASE_STORAGE_PUBLIC_URL =
`${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_STORAGE_BUCKET_MURAL}`;

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
let pesquisaComer = null;
let pesquisaComerTexto = "";

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
.replace(/"/g, '&quot;')
.replace(/'/g, "&#039;");
}

function criarLinkLocal(id) {
return `pages/local.html?id=${encodeURIComponent(id || "")}`;
}

/* =========================================================
IMAGENS — LOCAIS, COMÉRCIOS E HOSPEDAGEM
========================================================= */

function obterImagem(item) {

if (!item) {
return FALLBACK_IMAGE;
}

if (
item.imagem &&
typeof item.imagem === "string" &&
item.imagem.trim()
) {
return item.imagem.trim();
}

if (
item.imagem_url &&
typeof item.imagem_url === "string" &&
item.imagem_url.trim()
) {
return item.imagem_url.trim();
}

if (
Array.isArray(item.imagens) &&
item.imagens.length > 0
) {

const primeiraImagem =
  item.imagens.find(
    imagem =>
      typeof imagem === "string" &&
      imagem.trim()
  );

if (primeiraImagem) {
  return primeiraImagem.trim();
}

}

if (
item.capa &&
typeof item.capa === "string" &&
item.capa.trim()
) {
return item.capa.trim();
}

if (
Array.isArray(item.galeria) &&
item.galeria.length > 0
) {

const primeiraImagem =
  item.galeria.find(
    imagem =>
      typeof imagem === "string" &&
      imagem.trim()
  );

if (primeiraImagem) {
  return primeiraImagem.trim();
}

}

if (
Array.isArray(item.fotos) &&
item.fotos.length > 0
) {

const primeiraFoto =
  item.fotos.find(
    imagem =>
      typeof imagem === "string" &&
      imagem.trim()
  );

if (primeiraFoto) {
  return primeiraFoto.trim();
}

}

return FALLBACK_IMAGE;
}

/* =========================================================
IMAGENS — MURAL
========================================================= */

/*

Converte qualquer formato de imagem utilizado
pelo cadastro do Mural para uma URL utilizável
pelo navegador.


Aceita:


pessoa.imagem
pessoa.imagem_url
pessoa.capa
pessoa.foto
pessoa.imagens[]
pessoa.galeria[]
pessoa.fotos[]


Também aceita:


https://...


nome.jpg


pasta/nome.jpg


/storage/v1/object/public/mural/nome.jpg
*/

function obterImagemPessoa(pessoa) {

if (!pessoa) {
return FALLBACK_IMAGE;
}

function transformarImagem(valor) {

if (
  typeof valor !== "string" ||
  !valor.trim()
) {
  return null;
}

let imagem =
  valor.trim();


/*
 * URL completa.
 */

if (
  imagem.startsWith("http://") ||
  imagem.startsWith("https://") ||
  imagem.startsWith("data:")
) {
  return imagem;
}


/*
 * Remove barras iniciais.
 */

imagem =
  imagem.replace(/^\/+/, "");


/*
 * Caso o valor já contenha
 * o caminho do Storage.
 */

const marcadorStorage =
  "/storage/v1/object/public/";

if (
  imagem.includes(
    marcadorStorage
  )
) {

  const parte =
    imagem.split(
      marcadorStorage
    )[1];

  if (parte) {

    return (
      `${SUPABASE_URL}` +
      `${marcadorStorage}` +
      parte
    );
  }
}


/*
 * Caso seja somente o caminho
 * ou nome do arquivo dentro do bucket.
 */

return (
  `${SUPABASE_STORAGE_PUBLIC_URL}/` +
  imagem
);

}

/*

Formatos principais.
*/

const candidatos = [

pessoa.imagem,

pessoa.imagem_url,

pessoa.capa,

pessoa.foto

];

for (
const candidato of candidatos
) {

const imagem =
  transformarImagem(
    candidato
  );

if (imagem) {
  return imagem;
}

}

/*

Várias imagens.
*/

if (
Array.isArray(
pessoa.imagens
)
) {

for (
  const candidato of pessoa.imagens
) {

  const imagem =
    transformarImagem(
      candidato
    );

  if (imagem) {
    return imagem;
  }
}

}

/*

Compatibilidade com estruturas antigas.
*/

const listas = [
pessoa.galeria,
pessoa.fotos
];

for (
const lista of listas
) {

if (
  !Array.isArray(lista)
) {
  continue;
}

for (
  const candidato of lista
) {

  const imagem =
    transformarImagem(
      candidato
    );

  if (imagem) {
    return imagem;
  }
}

}

return FALLBACK_IMAGE;
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
HERO / CARROSSEL
========================================================= */

const HERO_MAXIMO = 3;

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

const imagem =
  new Image();

let finalizado = false;

const finalizar =
  resultado => {

    if (finalizado) {
      return;
    }

    finalizado = true;
    resolve(resultado);
  };

imagem.onload =
  () => finalizar(true);

imagem.onerror =
  () => finalizar(false);

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

for (
  const pasta of CAMINHOS_HERO
) {

  if (encontrada) {
    break;
  }

  for (
    const extensao of EXTENSOES_HERO
  ) {

    const caminho =
      `${pasta}${numero}.${extensao}`;

    const existe =
      await verificarImagemExiste(
        caminho
      );

    if (existe) {

      encontrada =
        caminho;

      break;
    }
  }
}

if (encontrada) {
  encontrados.push(
    encontrada
  );
}

}

slidesHero =
[...new Set(encontrados)];

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

  fragmento.appendChild(
    slide
  );
}

);

heroCarousel.appendChild(
fragmento
);

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

slideHeroAtual +=
direcao;

if (
slideHeroAtual >=
slidesHero.length
) {

slideHeroAtual = 0;

}

if (
slideHeroAtual < 0
) {

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
setInterval(
() => {
mudarHero(1);
},
10000
);
}

function configurarGestosHero() {

if (!heroCarousel) {
return;
}

heroCarousel.ontouchstart =
event => {

  inicioToqueHero =
    event.changedTouches[0]?.screenX || 0;

};

heroCarousel.ontouchend =
event => {

  const final =
    event.changedTouches[0]?.screenX || 0;

  const distancia =
    final -
    inicioToqueHero;

  if (
    Math.abs(distancia) < 40
  ) {
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
document.getElementById(
"homeMap"
);

if (!elemento) {

console.error(
  "#homeMap não encontrado."
);

return;

}

if (
typeof L === "undefined"
) {

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

setTimeout(
() => {

  if (homeMap) {
    homeMap.invalidateSize();
  }

},
500

);
}

/* =========================================================
MAPA — NORMALIZAÇÃO DAS CATEGORIAS
========================================================= */

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

function obterGrupoCategoriaMapa(
categoria
) {

return normalizarGrupoMapa(
categoria
);
}

function obterGrupoItemMapa(item) {

if (!item) {
return "outros";
}

const categoria =
item.categoria || "";

const nome =
item.nome || "";

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

function criarIcone(
categoriaOuGrupo
) {

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
document.createElement(
"style"
);

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

document.head.appendChild(
style
);
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
criarLinkLocal(
item.id
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

if (
!homeMap ||
!item
) {
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

const grupo =
obterGrupoItemMapa(
item
);

const marcador =
L.marker(
[
latitude,
longitude
],
{
icon:
criarIcone(
grupo
)
}
);

marcador.bindPopup(
criarPopup(item),
{
maxWidth: 280,
minWidth: 220
}
);

marcador.addTo(
homeMap
);

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

function aplicarFiltroMapa(
categoria
) {

if (!homeMap) {
return;
}

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

function obterCategoriaBotaoMapa(
botao
) {

if (!botao) {
return "todos";
}

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

botoes.forEach(
botao => {
botao.onclick = null;
}
);

botoes.forEach(
botao => {

  botao.onclick =
    event => {

      event.preventDefault();

      botoes.forEach(
        item => {
          item.classList.remove(
            "active"
          );
        }
      );

      botao.classList.add(
        "active"
      );

      const categoria =
        obterCategoriaBotaoMapa(
          botao
        );

      aplicarFiltroMapa(
        categoria
      );

    };
}

);

let botaoAtivo =
Array.from(botoes).find(
botao =>
botao.classList.contains(
"active"
)
);

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
criarLinkLocal(
item.id
);

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
.slice(
0,
quantidade
)
.forEach(
item => {

    visitarList.appendChild(
      criarCardVisitar(item)
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

if (
  dia === "domingo"
) {
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
/(\d{1,2})\s*:\s*(\d{2})\s*(?:as|-|a)\s*(\d{1,2})\s*:\s*(\d{2})/g;

let resultado;

while (
(
resultado =
regex.exec(texto)
) !== null
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
  return AndrelandiaComercioUtils.secaoDoEstabelecimento(comercio) === "alimentacao";
}

function comercioPertenceCategoria(
comercio,
filtro
) {

if (!comercio) {
return false;
}

if (
!filtro ||
filtro === "Todos"
) {
return true;
}

const categoria =
normalizarTexto(
comercio.categoria || ""
);

const nome =
normalizarTexto(
comercio.nome || ""
);

if (
filtro === "Restaurante"
) {

return (
  categoria.includes(
    "restaurante"
  ) ||
  categoria.includes(
    "pizzaria"
  ) ||
  categoria.includes(
    "hamburgueria"
  )
);

}

if (
filtro === "Lanchonetes"
) {

return (
  categoria.includes(
    "lanchonete"
  ) ||
  categoria.includes(
    "lancheria"
  )
);

}

if (
filtro === "Cafeteria"
) {

return (
  categoria.includes(
    "cafe"
  ) ||
  categoria.includes(
    "cafeteria"
  )
);

}

if (
filtro === "Sorvete/Açaí"
) {

return (
  categoria.includes(
    "sorvete"
  ) ||
  categoria.includes(
    "sorveteria"
  ) ||
  categoria.includes(
    "acai"
  )
);

}

return false;
}

function obterComerciosFiltrados() {
  const filtrados = dadosComercios.filter((comercio) => {
    if (!AndrelandiaComercioUtils.estaAtivo(comercio) || !comercioEhAlimentacao(comercio)) {
      return false;
    }

    if (!comercioPertenceCategoria(comercio, categoriaComerFiltro)) {
      return false;
    }

    if (pesquisaComerTexto && !comercioCombinaPesquisa(comercio, pesquisaComerTexto)) {
      return false;
    }

    if (mostrarSomenteAbertos && !comercioEstaAberto(comercio)) {
      return false;
    }

    return true;
  });

  return AndrelandiaComercioUtils.ordenarComDestaque(filtrados, avaliacoes);
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

function criarHTMLAvaliacao(
localId
) {

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

function criarHTMLStatusEstabelecimento(estabelecimento, avaliacaoHTML = "") {
  const possuiHorario = Boolean(String(estabelecimento?.horario || "").trim());
  const aberto = possuiHorario && comercioEstaAberto(estabelecimento);
  const texto = possuiHorario
    ? (aberto ? "Aberto agora" : "Fechado")
    : "Horário não informado";
  const classe = possuiHorario
    ? (aberto ? "aberto" : "fechado")
    : "horario-indefinido";
  const destaque = AndrelandiaComercioUtils.estaEmDestaque(estabelecimento)
    ? '<span class="comer-destaque">Destaque</span>'
    : "";

  return `<div class="comer-status-linha">
    <div class="comer-horario ${classe}">${texto}</div>
    ${destaque}
    ${avaliacaoHTML}
  </div>`;
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

  ${criarHTMLStatusEstabelecimento(comercio, avaliacaoHTML)}

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
  lista.length,

limite:
  limiteComer

});
}

/* =========================================================
FILTROS — ONDE COMER
========================================================= */

function configurarFiltrosComer() {

const filtros =
document.querySelectorAll(
".comer-filtro"
);

filtros.forEach(
filtro => {

  filtro.addEventListener(
    "click",
    () => {

      filtros.forEach(
        item => {
          item.classList.remove(
            "active"
          );
        }
      );

      filtro.classList.add(
        "active"
      );

      categoriaComerFiltro =
        filtro.dataset.filter ||
        "Todos";

      limiteComer =
        LIMITE_INICIAL;

      renderizarComercios();

    }
  );

}

);
}

function configurarBotaoFiltroAberto() {

if (!filtroAberto) {
return;
}

filtroAberto.addEventListener(
"click",
() => {

  mostrarSomenteAbertos =
    !mostrarSomenteAbertos;

  filtroAberto.classList.toggle(
    "active",
    mostrarSomenteAbertos
  );

  textoStatus.textContent =
    mostrarSomenteAbertos
      ? "Aberto agora"
      : "Aberto agora";

  limiteComer =
    LIMITE_INICIAL;

  renderizarComercios();

}

);
}

/* =========================================================
COMÉRCIO LOCAL
========================================================= */

function distanciaLevenshtein(
a,
b
) {

a =
normalizarTexto(a);

b =
normalizarTexto(b);

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

matriz[i][0] =
  i;

}

for (
let j = 0;
j <= a.length;
j++
) {

matriz[0][j] =
  j;

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
normalizarTexto(
palavra
);

termo =
normalizarTexto(
termo
);

if (
!palavra ||
!termo
) {
return false;
}

if (
palavra.includes(
termo
)
) {
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
normalizarTexto(
pesquisa
)
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
campo.includes(
termo
) ||
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

function configurarPesquisaComer() {

if (!pesquisaComer) {
return;
}

pesquisaComer.addEventListener(
"input",
() => {

  pesquisaComerTexto =
    pesquisaComer.value
      .trim()
      .toLowerCase();

  limiteComer =
    LIMITE_INICIAL;

  renderizarComercios();

}

);
}

function obterComerciosPesquisa() {
  const filtrados = dadosComercios.filter((comercio) => {
    if (!AndrelandiaComercioUtils.estaAtivo(comercio) || comercioEhAlimentacao(comercio)) {
      return false;
    }

    if (AndrelandiaComercioUtils.secaoDoEstabelecimento(comercio) === "hospedagem") {
      return false;
    }

    if (!comercioCombinaPesquisa(comercio, pesquisaComercioTexto)) {
      return false;
    }

    if (mostrarSomenteComercioAbertos && !comercioEstaAberto(comercio)) {
      return false;
    }

    return true;
  });

  return AndrelandiaComercioUtils.ordenarComDestaque(filtrados, avaliacoes);
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

  ${criarHTMLStatusEstabelecimento(comercio, avaliacaoHTML)}

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
      event.target.value ||
      "";

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

  ${criarHTMLStatusEstabelecimento(hospedagem)}

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
  if (!ficarList) return;

  ficarList.innerHTML = "";
  const lista = AndrelandiaComercioUtils.ordenarComDestaque(dadosHospedagem, avaliacoes);

  if (!lista.length) {
    ficarList.innerHTML = `
      <div class="ficar-empty">Nenhuma hospedagem encontrada.</div>
    `;
    if (mostrarMaisFicar) mostrarMaisFicar.hidden = true;
    return;
  }

  const quantidade = Math.min(limiteFicar, lista.length);
  lista.slice(0, quantidade).forEach((hospedagem) => {
    ficarList.appendChild(criarCardHospedagem(hospedagem));
  });

  configurarMostrarMais({
    botao: mostrarMaisFicar,
    total: lista.length,
    limite: limiteFicar,
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
  await fetch(
    caminho,
    {
      cache: "no-store"
    }
  );

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
  return AndrelandiaComercioUtils.secaoDoEstabelecimento(item) === "hospedagem";
}

function obterHospedagensDosComercios() {
  return dadosComercios.filter((item) =>
    AndrelandiaComercioUtils.estaAtivo(item) && itemEhHospedagem(item)
  );
}

/* =========================================================
CARREGAR TODOS OS DADOS
========================================================= */

async function carregarDados() {
  const resultados = await Promise.all([
    carregarJSON("./DATA/locais.json", "locais.json"),
    carregarJSON("./DATA/comercios.json", "comercios.json"),
  ]);

  dadosLocais = resultados[0];
  dadosComercios = Array.isArray(resultados[1])
    ? resultados[1].filter(AndrelandiaComercioUtils.estaAtivo)
    : [];

  await carregarAvaliacoes();
  dadosHospedagem = obterHospedagensDosComercios();

  marcadores.forEach((registro) => {
    if (homeMap && homeMap.hasLayer(registro.marcador)) {
      homeMap.removeLayer(registro.marcador);
    }
  });
  marcadores.length = 0;

  dadosLocais.forEach(adicionarMarcador);
  dadosComercios.forEach(adicionarMarcador);

  renderizarOQueVisitar();
  atualizarStatusBotao();
  renderizarComercios();
  atualizarStatusComercio();
  renderizarComercioLocal();
  renderizarHospedagens();
  configurarFiltrosMapa();

  if (homeMap) {
    setTimeout(() => homeMap.invalidateSize(), 500);
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

pessoas =
  dados.filter(AndrelandiaComercioUtils.estaAtivo);

console.log(
  "Pessoas carregadas:",
  pessoas.length
);

pessoas.forEach(
  pessoa => {

    console.log(
      "Imagem do Mural:",
      pessoa.nome,
      "=>",
      obterImagemPessoa(
        pessoa
      )
    );

  }
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

votos.forEach(
voto => {

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
    obterResumoVotos(
      a.id
    );

  const votoB =
    obterResumoVotos(
      b.id
    );

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
`./pages/pessoa.html?id=${encodeURIComponent(pessoa.id)}`;

/*

CORREÇÃO PRINCIPAL:


Antes:


pessoa.capa


Agora:


obterImagemPessoa(pessoa)


Isso permite utilizar as imagens
publicadas pelo novo sistema do Mural.
*/

const imagem =
obterImagemPessoa(
pessoa
);

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
    onerror="
      if (
        this.dataset.fallbackAplicado !== '1'
      ) {
        this.dataset.fallbackAplicado = '1';
        this.src = '${FALLBACK_IMAGE}';
      }
    "
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
.forEach(
botao => {

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

  }
);

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

if (!usuarioAtual) {

abrirModalAuth(
  "login"
);

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
document.createElement(
"div"
);

area.id =
"botaoLoginMural";

area.style.marginTop =
"14px";

area.innerHTML = `<button type="button" class="status-filtro" id="abrirLoginMuralBotao">Entrar para votar</button>`;

header.appendChild(
area
);

const botao =
document.getElementById(
"abrirLoginMuralBotao"
);

if (botao) {

botao.onclick =
  () =>
    abrirModalAuth(
      "login"
    );

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

pesquisaComer =
document.getElementById(
"pesquisaComer"
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
NAVBAR: DESTACAR A SEÇÃO VISÍVEL SEM ALTERAR OS DADOS
========================================================= */
function configurarNavegacaoSecoes() {
const itens = Array.from(document.querySelectorAll(".bottom-nav .nav-item"));
const secoes = itens
  .map(item => document.querySelector(item.getAttribute("href")))
  .filter(Boolean);
if (!itens.length || !secoes.length || !("IntersectionObserver" in window)) return;
const observer = new IntersectionObserver(
  entradas => {
    const visiveis = entradas
      .filter(entrada => entrada.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
    if (!visiveis[0]) return;
    itens.forEach(item => item.classList.toggle("active", item.getAttribute("href") === `#${visiveis[0].target.id}`));
  },
  { rootMargin: "-20% 0px -55% 0px", threshold: [0.1, 0.35, 0.6] }
);
secoes.forEach(secao => observer.observe(secao));
}
function configurarMenuMovel() {
  const toggle = document.getElementById("mobileNavToggle");
  const closeButton = document.getElementById("mobileNavClose");
  const panel = document.getElementById("mobileNavPanel");
  const backdrop = document.getElementById("mobileNavBackdrop");
  const mainPanel = document.getElementById("navMainPanel");
  const profilePanel = document.getElementById("perfilUsuario");
  const backButton = document.getElementById("navBackToMain");
  if (!toggle || !panel || toggle.dataset.configurado) return;
  toggle.dataset.configurado = "true";

  const mostrarPrincipal = () => {
    if (mainPanel) mainPanel.hidden = false;
    if (profilePanel) profilePanel.hidden = true;
    panel.setAttribute("aria-label", "Navegação principal");
  };
  const mostrarPerfil = () => {
    if (mainPanel) mainPanel.hidden = true;
    if (profilePanel) profilePanel.hidden = false;
    panel.setAttribute("aria-label", "Perfil do usuário");
  };
  const fechar = () => {
    document.body.dataset.mobileNavOpen = "false";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Abrir menu de navegação");
    panel.setAttribute("aria-hidden", "true");
    if (backdrop) backdrop.hidden = true;
    mostrarPrincipal();
  };
  const abrir = () => {
    document.body.dataset.mobileNavOpen = "true";
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Fechar menu de navegação");
    panel.setAttribute("aria-hidden", "false");
    if (backdrop) backdrop.hidden = false;
  };
  toggle.addEventListener("click", () => document.body.dataset.mobileNavOpen === "true" ? fechar() : abrir());
  closeButton?.addEventListener("click", fechar);
  backdrop?.addEventListener("click", fechar);
  backButton?.addEventListener("click", mostrarPrincipal);
  panel.querySelector('[data-nav-profile="true"]')?.addEventListener("click", mostrarPerfil);
  panel.querySelectorAll('a.nav-item').forEach(item => item.addEventListener("click", fechar));
  document.addEventListener("keydown", event => { if (event.key === "Escape") fechar(); });
  document.addEventListener("click", event => {
    if (document.body.dataset.mobileNavOpen === "true" && !panel.contains(event.target) && !toggle.contains(event.target)) fechar();
  });
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

// O Hero editorial é controlado por js/editorial-hero.js, com deslocamento lateral sem fade.

configurarPesquisaComer();

configurarFiltrosMapa();

configurarFiltrosComer();

configurarBotaoFiltroAberto();

configurarComercioLocal();

configurarPaginacao();

configurarResizeMapa();

configurarNavegacaoSecoes();
configurarMenuMovel();

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
