/* =========================================================
ANDRELÂNDIA — GUIA TURÍSTICO
LOCAL.JS

RESPONSABILIDADES:

Carregar locais, comércios e hospedagens
Preencher a página de detalhes
Galeria de imagens
Mapa Leaflet + Esri
Google Maps
WhatsApp
Instagram
Sugestão de alteração
Avaliações
Integração com login.js
Verificação do proprietário
Exclusão do próprio comércio
========================================================= */

/* =========================================================
CONFIGURAÇÕES
========================================================= */

const SUPABASE_URL =
"https://xdmbkflufsfqziixzpxc.supabase.co";

const MURAL_EDGE_FUNCTION_URL =
`${SUPABASE_URL}/functions/v1/whatsapp-bot`;

const COMERCIO_EDGE_FUNCTION_URL =
`${SUPABASE_URL}/functions/v1/whatsapp-bot`;

const FALLBACK_IMAGE =
"../img/icones/imgnaodisponivel.png";

const params =
new URLSearchParams(window.location.search);

const idLocal =
params.get("id");

/* =========================================================
SUPABASE
O login.js cria window.supabaseLoginClient
========================================================= */

let supabaseClient = null;

function obterSupabaseClient() {

if (window.supabaseLoginClient) {
return window.supabaseLoginClient;
}

if (
window.supabase &&
typeof window.supabase.createClient === "function"
) {
try {

  if (!window.__localSupabaseClient) {

    window.__localSupabaseClient =
      window.supabase.createClient(
        SUPABASE_URL,
        "sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy"
      );
  }

  return window.__localSupabaseClient;

} catch (erro) {

  console.error(
    "Erro ao criar cliente Supabase:",
    erro
  );
}

}

return null;
}

/* =========================================================
ESTADO
========================================================= */

let localAtual = null;
let mapaLocal = null;

let notaSelecionada = 0;
let avaliacaoAtual = null;

let imagensAtuais = [];

/* =========================================================
UTILITÁRIOS
========================================================= */

function escaparHTML(valor) {

if (
valor === null ||
valor === undefined
) {
return "";
}

return String(valor)
.replace(/&/g, "&")
.replace(/</g, "<")
.replace(/>/g, ">")
.replace(/"/g, '&quot;')
.replace(/'/g, "'");
}

function corrigirCaminhoImagem(caminho) {

if (
!caminho ||
typeof caminho !== "string"
) {
return FALLBACK_IMAGE;
}

caminho = caminho.trim();

if (!caminho) {
return FALLBACK_IMAGE;
}

/* URLs externas */
if (
caminho.startsWith("http://") ||
caminho.startsWith("https://") ||
caminho.startsWith("data:") ||
caminho.startsWith("blob:")
) {
return caminho;
}

/* Caminhos absolutos */
if (caminho.startsWith("/")) {
return caminho;
}

/* Página está dentro de /pages/ */
if (caminho.startsWith("../")) {
return caminho;
}

if (caminho.startsWith("./")) {
caminho = caminho.substring(2);
}

if (caminho.startsWith("img/")) {
return `../${caminho}`;
}

if (caminho.startsWith("IMG/")) {
return `../${caminho}`;
}

return `../${caminho}`;
}

function normalizarArray(valor) {

if (Array.isArray(valor)) {
return valor;
}

if (
typeof valor === "string" &&
valor.trim()
) {

try {

  const convertido =
    JSON.parse(valor);

  if (Array.isArray(convertido)) {
    return convertido;
  }

} catch (erro) {

  return valor
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

}

return [];
}

function primeiroValor(...valores) {

for (const valor of valores) {

if (
  valor !== null &&
  valor !== undefined &&
  String(valor).trim() !== ""
) {
  return valor;
}

}

return "";
}

/* =========================================================
IDENTIFICAÇÃO DO TIPO DE LOCAL
========================================================= */

function identificarTipoLocal(item) {

if (!item) {
return "local";
}

const tipo =
String(
item.tipo ||
item.origem ||
item.tipo_local ||
""
)
.trim()
.toLowerCase();

if (
tipo.includes("comerc") ||
tipo.includes("empresa") ||
tipo.includes("negocio")
) {
return "comercio";
}

if (
tipo.includes("hosped") ||
tipo.includes("hotel") ||
tipo.includes("pousada")
) {
return "hospedagem";
}

return "local";
}

function pareceComercio(item) {

if (!item) {
return false;
}

if (item._tipo === "comercio") {
return true;
}

if (item.fonte === "comercios") {
return true;
}

const tipo =
identificarTipoLocal(item);

if (tipo === "comercio") {
return true;
}

/*
Caso o JSON de comércio não tenha um campo tipo,
verificamos alguns campos característicos.
*/

if (
item.whatsapp ||
item.telefone ||
item.instagram
) {

const categoria =
  String(item.categoria || "")
    .toLowerCase();

const categoriasComerciais = [
  "comércio",
  "comercio",
  "lanchonete",
  "sorveteria",
  "restaurante",
  "cafeteria",
  "padaria",
  "loja",
  "mercado",
  "farmácia",
  "farmacia",
  "bar",
  "pizzaria",
  "doceria",
  "artesanato"
];

if (
  categoriasComerciais.some(
    categoriaComercial =>
      categoria.includes(categoriaComercial)
  )
) {
  return true;
}

}

return false;
}

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

return;

}

window.location.href = "../index.html";
}

window.voltarPagina =
voltarPagina;

/* =========================================================
CARREGAR DADOS
========================================================= */

async function carregarJSON(caminho) {

const resposta =
await fetch(caminho, {
cache: "no-cache"
});

if (!resposta.ok) {

throw new Error(
  `Não foi possível carregar ${caminho}`
);

}

return resposta.json();
}

async function carregarLocal() {

if (!idLocal) {

mostrarErroLocal(
  "Local não informado."
);

return;

}

try {

const [
  locais,
  comercios,
  hospedagem
] = await Promise.all([

  carregarJSON("../DATA/locais.json"),

  carregarJSON("../DATA/comercios.json"),

  carregarJSON("../DATA/hospedagem.json")
]);


const listaLocais =
  Array.isArray(locais)
    ? locais
    : [];

const listaComercios =
  Array.isArray(comercios)
    ? comercios
    : [];

const listaHospedagem =
  Array.isArray(hospedagem)
    ? hospedagem
    : [];


let encontrado = null;


/* =====================================================
   LOCAIS
===================================================== */

encontrado =
  listaLocais.find(
    item =>
      String(item.id) ===
      String(idLocal)
  );


if (encontrado) {

  encontrado._tipo =
    "local";

  encontrado.fonte =
    "locais";
}


/* =====================================================
   COMÉRCIOS
===================================================== */

if (!encontrado) {

  encontrado =
    listaComercios.find(
      item =>
        String(item.id) ===
        String(idLocal)
    );

  if (encontrado) {

    encontrado._tipo =
      "comercio";

    encontrado.fonte =
      "comercios";
  }
}


/* =====================================================
   HOSPEDAGEM
===================================================== */

if (!encontrado) {

  encontrado =
    listaHospedagem.find(
      item =>
        String(item.id) ===
        String(idLocal)
    );

  if (encontrado) {

    encontrado._tipo =
      "hospedagem";

    encontrado.fonte =
      "hospedagem";
  }
}


if (!encontrado) {

  mostrarErroLocal(
    "Local não encontrado."
  );

  return;
}


localAtual =
  encontrado;


preencherPagina(localAtual);

await carregarAvaliacoes();

await verificarAvaliacaoUsuario();

await verificarProprietarioComercio();

} catch (erro) {

console.error(
  "Erro ao carregar local:",
  erro
);

mostrarErroLocal(
  "Não foi possível carregar as informações deste local."
);

}
}

/* =========================================================
ERRO
========================================================= */

function mostrarErroLocal(mensagem) {

const nome =
document.getElementById(
"nomeLocal"
);

if (nome) {
nome.textContent = mensagem;
}

const conteudo =
document.querySelector(
".content-section"
);

if (conteudo) {

conteudo.innerHTML = `
  <div class="section-block">
    <p>${escaparHTML(mensagem)}</p>
  </div>
`;

}
}

/* =========================================================
PREENCHER PÁGINA
========================================================= */

function preencherPagina(item) {

document.title =
`${item.nome || "Local"} — Guia Turístico de Andrelândia`;

const nome =
document.getElementById(
"nomeLocal"
);

if (nome) {

nome.textContent =
  item.nome ||
  "Local";

}

const categoria =
document.getElementById(
"categoriaLocal"
);

if (categoria) {

categoria.textContent =
  item.categoria ||
  "LOCAL";

}

const descricao =
document.getElementById(
"descricaoLocal"
);

if (descricao) {

descricao.textContent =
  primeiroValor(
    item.descricao,
    item.sobre,
    item.resumo
  ) ||
  "Não há informações disponíveis.";

}

const historia =
document.getElementById(
"historiaLocal"
);

if (historia) {

historia.textContent =
  item.historia ||
  "Não há informações históricas disponíveis.";

}

const curiosidades =
document.getElementById(
"curiosidadesLocal"
);

if (curiosidades) {

curiosidades.textContent =
  item.curiosidades ||
  "Não há curiosidades cadastradas.";

}

preencherHorario(item);

preencherEndereco(item);

preencherWhatsApp(item);

preencherInstagram(item);

prepararSugestaoAlteracao(item);

prepararGaleria(item);

prepararMapa(item);
}

/* =========================================================
HORÁRIO
========================================================= */

function preencherHorario(item) {

const elemento =
document.getElementById(
"horarioLocal"
);

if (!elemento) {
return;
}

const horario =
primeiroValor(
item.horario,
item.horarios,
item.hora
);

if (!horario) {

elemento.textContent =
  "Não informado";

return;

}

elemento.innerHTML =
formatarHorario(horario);
}

function formatarHorario(horario) {

if (
typeof horario === "string" ||
typeof horario === "number"
) {

return escaparHTML(
  horario
).replace(
  /\n/g,
  "<br>"
);

}

if (
Array.isArray(horario)
) {

return horario
  .map(item =>
    escaparHTML(item)
  )
  .join("<br>");

}

if (
typeof horario === "object"
) {

return Object.entries(horario)
  .map(
    ([dia, valor]) =>
      `<strong>${escaparHTML(dia)}</strong>: ${escaparHTML(valor)}`
  )
  .join("<br>");

}

return "Não informado";
}

/* =========================================================
ENDEREÇO
========================================================= */

function preencherEndereco(item) {

const elemento =
document.getElementById(
"enderecoLocal"
);

if (!elemento) {
return;
}

const endereco =
primeiroValor(
item.endereco,
item.endereço,
item.rua
);

elemento.textContent =
endereco ||
"Não informado";
}

/* =========================================================
WHATSAPP
========================================================= */

function obterNumeroWhatsApp(item) {

const valor =
primeiroValor(
item.whatsapp,
item.telefone,
item.celular
);

if (!valor) {
return "";
}

let numero =
String(valor)
.replace(/\D/g, "");

if (!numero) {
return "";
}

/*
Números brasileiros normalmente possuem
DDD + número.

Se o número tiver 10 ou 11 dígitos,
adicionamos o código do Brasil.

*/

if (
numero.length === 10 ||
numero.length === 11
) {

numero =
  `55${numero}`;

}

return numero;
}

function criarMensagemWhatsApp(item) {

const nome =
primeiroValor(
item.nome,
"este comércio"
);

return (
`Olá! Encontrei a ${nome} pelo ` +
`Guia Turístico de Andrelândia e ` +
`gostaria de fazer um pedido.`
);
}

function preencherWhatsApp(item) {

const botao =
document.getElementById(
"whatsappLocal"
);

const texto =
document.getElementById(
"whatsappNome"
);

if (!botao) {
return;
}

const numero =
obterNumeroWhatsApp(item);

if (!numero) {

botao.style.display =
  "none";

return;

}

const mensagem =
criarMensagemWhatsApp(item);

botao.href =
`https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;

botao.target =
"_blank";

botao.rel =
"noopener noreferrer";

botao.style.display =
"flex";

if (texto) {

texto.textContent =
  "WhatsApp";

}
}

/* =========================================================
INSTAGRAM
========================================================= */

function obterInstagramURL(valor) {

if (!valor) {
return "";
}

let instagram =
String(valor).trim();

if (!instagram) {
return "";
}

if (
instagram.startsWith("http://") ||
instagram.startsWith("https://")
) {

return instagram;

}

instagram =
instagram
.replace(/^@/, "")
.replace(/^\/+/, "")
.replace(/\/+$/, "");

if (!instagram) {
return "";
}

return (
`https://www.instagram.com/${instagram}/`
);
}

function preencherInstagram(item) {

const botao =
document.getElementById(
"instagramLocal"
);

const texto =
document.getElementById(
"instagramNome"
);

if (!botao) {
return;
}

const valor =
primeiroValor(
item.instagram,
item.instagram_url,
item.rede_social
);

const url =
obterInstagramURL(valor);

if (!url) {

botao.style.display =
  "none";

return;

}

botao.href =
url;

botao.target =
"_blank";

botao.rel =
"noopener noreferrer";

botao.style.display =
"flex";

if (texto) {

texto.textContent =
  "Instagram";

}
}

/* =========================================================
SUGERIR ALTERAÇÃO
========================================================= */

function prepararSugestaoAlteracao(item) {

const botao =
document.getElementById(
"botaoSugerirAlteracao"
);

if (!botao) {
return;
}

botao.href =
`../pages/cadastros.html?tipo=alteracao&local=${encodeURIComponent(item.id)}`;
}

/* =========================================================
GALERIA
========================================================= */

function adicionarImagemUnica(lista, imagem) {

if (
!imagem ||
typeof imagem !== "string"
) {
return;
}

const valor =
imagem.trim();

if (!valor) {
return;
}

const url =
corrigirCaminhoImagem(valor);

if (
!lista.includes(url)
) {

lista.push(url);

}
}

function prepararGaleria(item) {

const principal =
document.getElementById(
"fotoPrincipal"
);

const miniaturas =
document.getElementById(
"miniaturas"
);

if (!principal || !miniaturas) {
return;
}

const imagens = [];

/*
Imagem principal
*/

adicionarImagemUnica(
imagens,
item.imagem
);

adicionarImagemUnica(
imagens,
item.imagem_url
);

adicionarImagemUnica(
imagens,
item.capa
);

/*
Arrays de imagens
*/

const camposGaleria = [
item.imagens,
item.galeria,
item.fotos,
item.fotos_galeria
];

camposGaleria.forEach(
campo => {

  normalizarArray(campo)
    .forEach(imagem => {

      if (
        typeof imagem === "string"
      ) {

        adicionarImagemUnica(
          imagens,
          imagem
        );

      } else if (
        imagem &&
        typeof imagem === "object"
      ) {

        adicionarImagemUnica(
          imagens,
          imagem.url ||
          imagem.src ||
          imagem.imagem
        );
      }
    });
}

);

if (!imagens.length) {

imagens.push(
  FALLBACK_IMAGE
);

}

imagensAtuais =
imagens;

principal.src =
imagens[0];

principal.alt =
item.nome ||
"Imagem do local";

principal.onerror =
function() {

  this.onerror = null;

  this.src =
    FALLBACK_IMAGE;
};

miniaturas.innerHTML =
"";

imagens
.slice(0, 4)
.forEach(
(imagem, indice) => {

    const botao =
      document.createElement(
        "button"
      );

    botao.type =
      "button";

    botao.className =
      "thumbnail";

    if (indice === 0) {

      botao.classList.add(
        "active"
      );
    }


    const img =
      document.createElement(
        "img"
      );

    img.src =
      imagem;

    img.alt =
      `${item.nome || "Local"} — foto ${indice + 1}`;


    img.onerror =
      function() {

        this.onerror = null;

        this.src =
          FALLBACK_IMAGE;
      };


    botao.appendChild(img);


    botao.addEventListener(
      "click",
      () => {

        principal.src =
          imagem;

        document
          .querySelectorAll(
            ".thumbnail"
          )
          .forEach(
            elemento =>
              elemento.classList.remove(
                "active"
              )
          );

        botao.classList.add(
          "active"
        );
      }
    );


    miniaturas.appendChild(
      botao
    );
  }
);

}

/* =========================================================
FOTO EM TELA CHEIA
========================================================= */

function abrirFotoTelaCheia() {

const viewer =
document.getElementById(
"photoViewer"
);

const imagem =
document.getElementById(
"viewerImage"
);

const principal =
document.getElementById(
"fotoPrincipal"
);

if (
!viewer ||
!imagem ||
!principal
) {
return;
}

imagem.src =
principal.src;

imagem.alt =
principal.alt;

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

window.abrirFotoTelaCheia =
abrirFotoTelaCheia;

window.fecharFotoTelaCheia =
fecharFotoTelaCheia;

document.addEventListener(
"keydown",
evento => {

if (
  evento.key === "Escape"
) {

  fecharFotoTelaCheia();
}

}
);

/* =========================================================
MAPA
========================================================= */

function prepararMapa(item) {

const elemento =
document.getElementById(
"localMap"
);

if (!elemento) {
return;
}

const latitude =
Number(
primeiroValor(
item.latitude,
item.lat
)
);

const longitude =
Number(
primeiroValor(
item.longitude,
item.lon,
item.lng
)
);

if (
!Number.isFinite(latitude) ||
!Number.isFinite(longitude)
) {

elemento.innerHTML = `
  <div style="
    height:100%;
    display:flex;
    align-items:center;
    justify-content:center;
    padding:20px;
    color:#777;
    text-align:center;
    font-size:12px;
    background:#eee;
  ">
    Localização não informada.
  </div>
`;


prepararBotaoComoChegar(
  null,
  null
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

if (mapaLocal) {

mapaLocal.remove();

mapaLocal =
  null;

}

mapaLocal =
L.map(
elemento,
{
scrollWheelZoom: true,
zoomControl: true
}
).setView(
[latitude, longitude],
17
);

L.tileLayer(
"https://{s}.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
{
attribution:
"Tiles © Esri",

  subdomains: [
    "server",
    "services"
  ],

  maxNativeZoom: 19,

  maxZoom: 22
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
`<strong>${escaparHTML( item.nome || "Local" )}</strong>`
);

prepararBotaoComoChegar(
latitude,
longitude
);

setTimeout(
() => {

  if (mapaLocal) {

    mapaLocal.invalidateSize();
  }

},
300

);
}

function prepararBotaoComoChegar(
latitude,
longitude
) {

const botao =
document.getElementById(
"comoChegar"
);

if (!botao) {
return;
}

if (
latitude === null ||
longitude === null ||
latitude === undefined ||
longitude === undefined
) {

botao.style.display =
  "none";

return;

}

botao.style.display =
"flex";

botao.href =
`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${latitude},${longitude}`)}`;

botao.target =
"_blank";

botao.rel =
"noopener noreferrer";
}

/* =========================================================
PROPRIETÁRIO DO COMÉRCIO
========================================================= */

function obterUsuarioAtual() {

/*
O login.js mantém esta variável global.
*/

if (
window.usuarioAtualSupabase
) {

return window.usuarioAtualSupabase;

}

/*
Fallback para o cliente Supabase.
*/

const cliente =
obterSupabaseClient();

if (!cliente) {
return null;
}

return null;
}

async function obterUsuarioAutenticadoLocal() {

const cliente =
obterSupabaseClient();

if (!cliente) {
return null;
}

try {

const {
  data,
  error
} =
  await cliente.auth.getUser();


if (error) {

  console.warn(
    "Não foi possível obter usuário:",
    error
  );

  return null;
}


return data?.user || null;

} catch (erro) {

console.error(
  "Erro ao obter usuário:",
  erro
);

return null;

}
}

async function verificarProprietarioComercio() {

const area =
document.getElementById(
"areaExcluirComercio"
);

if (!area) {
return;
}

/*
Começa sempre escondido.
*/

area.style.display =
"none";

/*
Só comércio pode exibir esse botão.
*/

if (
!localAtual ||
!pareceComercio(localAtual)
) {

return;

}

const cliente =
obterSupabaseClient();

if (!cliente) {

console.warn(
  "Cliente Supabase não disponível."
);

return;

}

const usuario =
await obterUsuarioAutenticadoLocal();

if (!usuario) {
return;
}

/*
Busca o cadastro pelo local_id.
*/

let cadastro = null;

try {

let resposta =
  await cliente
    .from("cadastros_comercios")
    .select(
      "id, local_id, usuario_id, status, nome"
    )
    .eq(
      "local_id",
      String(localAtual.id)
    )
    .maybeSingle();


if (
  resposta.error
) {

  console.error(
    "Erro ao buscar cadastro do comércio:",
    resposta.error
  );

  return;
}


cadastro =
  resposta.data;


/*
  Compatibilidade caso o cadastro use o
  próprio id como local_id.
*/

if (!cadastro) {

  resposta =
    await cliente
      .from("cadastros_comercios")
      .select(
        "id, local_id, usuario_id, status, nome"
      )
      .eq(
        "id",
        String(localAtual.id)
      )
      .maybeSingle();


  if (
    resposta.error
  ) {

    console.error(
      "Erro ao buscar cadastro do comércio:",
      resposta.error
    );

    return;
  }


  cadastro =
    resposta.data;
}


if (!cadastro) {
  return;
}


/*
  O usuário só pode excluir o próprio comércio.
*/

if (
  String(cadastro.usuario_id) !==
  String(usuario.id)
) {

  return;
}


/*
  Comércio já deletado não deve mostrar
  o botão.
*/

if (
  cadastro.status ===
  "deletado"
) {

  return;
}


area.style.display =
  "block";

} catch (erro) {

console.error(
  "Erro ao verificar proprietário do comércio:",
  erro
);

}
}

/* =========================================================
EXCLUIR MEU COMÉRCIO
========================================================= */

async function excluirMeuComercio() {

if (!localAtual) {

alert(
  "Não foi possível identificar o comércio."
);

return;

}

const cliente =
obterSupabaseClient();

if (!cliente) {

alert(
  "Não foi possível conectar ao sistema."
);

return;

}

const usuario =
await obterUsuarioAutenticadoLocal();

if (!usuario) {

alert(
  "Você precisa estar logado para excluir seu comércio."
);

return;

}

/*
Confirmação antes da exclusão.
*/

const confirmou =
window.confirm(
`Tem certeza que deseja excluir o comércio "${localAtual.nome || ""}"?\n\n` +
`O comércio será removido do Guia Turístico.`
);

if (!confirmou) {
return;
}

const botao =
document.getElementById(
"botaoExcluirComercio"
);

if (botao) {

botao.disabled =
  true;

botao.textContent =
  "Excluindo...";

}

try {

const {
  data,
  error
} =
  await cliente.auth.getSession();


if (error) {
  throw error;
}


const accessToken =
  data?.session?.access_token;


if (!accessToken) {

  throw new Error(
    "Sessão de usuário não encontrada."
  );
}


const resposta =
  await fetch(
    COMERCIO_EDGE_FUNCTION_URL,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",

        "Authorization":
          `Bearer ${accessToken}`
      },

      body: JSON.stringify({
        acao:
          "excluir_meu_comercio",

        comercio_id:
          localAtual.id
      })
    }
  );


let resultado = null;


try {

  resultado =
    await resposta.json();

} catch {

  resultado = null;
}


if (!resposta.ok) {

  throw new Error(
    resultado?.erro ||
    resultado?.error ||
    `Erro HTTP ${resposta.status}`
  );
}


if (
  resultado &&
  resultado.sucesso === false
) {

  throw new Error(
    resultado.erro ||
    "Não foi possível excluir o comércio."
  );
}


alert(
  "Seu comércio foi excluído com sucesso."
);


/*
  Depois da exclusão, voltamos para a página inicial.
*/

window.location.href =
  "../index.html";

} catch (erro) {

console.error(
  "Erro ao excluir comércio:",
  erro
);


alert(
  erro.message ||
  "Não foi possível excluir o comércio."
);


if (botao) {

  botao.disabled =
    false;

  botao.textContent =
    "Excluir meu comércio";
}

}
}

window.excluirMeuComercio =
excluirMeuComercio;

/* =========================================================
AVALIAÇÕES
========================================================= */

function obterClienteAvaliacoes() {

if (!supabaseClient) {

supabaseClient =
  obterSupabaseClient();

}

return supabaseClient;
}

/* =========================================================
CARREGAR AVALIAÇÕES
========================================================= */

async function carregarAvaliacoes() {

const cliente =
obterClienteAvaliacoes();

const lista =
document.getElementById(
"listaComentarios"
);

const media =
document.getElementById(
"mediaAvaliacoes"
);

const quantidade =
document.getElementById(
"quantidadeAvaliacoes"
);

const estrelas =
document.getElementById(
"estrelasMedia"
);

if (!lista) {
return;
}

if (!cliente) {

lista.innerHTML = `
  <div class="empty-comments">
    Não foi possível carregar as avaliações.
  </div>
`;

return;

}

try {

const {
  data,
  error
} =
  await cliente
    .from("avaliacoes")
    .select(
      "id, local_id, usuario_id, nome_usuario, nota, comentario, criado_em"
    )
    .eq(
      "local_id",
      String(localAtual.id)
    )
    .order(
      "criado_em",
      {
        ascending: false
      }
    );


if (error) {
  throw error;
}


const avaliacoes =
  Array.isArray(data)
    ? data
    : [];


if (!avaliacoes.length) {

  if (media) {
    media.textContent =
      "0,0";
  }

  if (quantidade) {
    quantidade.textContent =
      "Nenhuma avaliação";
  }

  if (estrelas) {
    estrelas.innerHTML =
      criarHTMLestrelas(0);
  }


  lista.innerHTML = `
    <div class="empty-comments">
      Ainda não há avaliações.<br>
      Seja o primeiro a avaliar!
    </div>
  `;

  return;
}


const soma =
  avaliacoes.reduce(
    (
      total,
      avaliacao
    ) =>
      total +
      Number(
        avaliacao.nota || 0
      ),
    0
  );


const mediaCalculada =
  soma /
  avaliacoes.length;


if (media) {

  media.textContent =
    mediaCalculada
      .toFixed(1)
      .replace(".", ",");
}


if (quantidade) {

  quantidade.textContent =
    avaliacoes.length === 1
      ? "1 avaliação"
      : `${avaliacoes.length} avaliações`;
}


if (estrelas) {

  estrelas.innerHTML =
    criarHTMLestrelas(
      mediaCalculada
    );
}


lista.innerHTML =
  avaliacoes
    .map(
      avaliacao =>
        criarHTMLAvaliacao(
          avaliacao
        )
    )
    .join("");

} catch (erro) {

console.error(
  "Erro ao carregar avaliações:",
  erro
);


lista.innerHTML = `
  <div class="empty-comments">
    Não foi possível carregar as avaliações.
  </div>
`;

}
}

/* =========================================================
ESTRELAS
========================================================= */

function criarHTMLestrelas(
nota
) {

const valor =
Number(nota) || 0;

let html = "";

for (
let i = 1;
i <= 5;
i++
) {

const imagem =
  i <= Math.round(valor)
    ? "../img/icones/estrela.png"
    : "../img/icones/estrela2.png";


html += `
  <img
    class="rating-star"
    src="${imagem}"
    alt=""
  >
`;

}

return html;
}

function criarHTMLAvaliacao(
avaliacao
) {

const nome =
escaparHTML(
avaliacao.nome_usuario ||
"Usuário"
);

const comentario =
escaparHTML(
avaliacao.comentario ||
""
);

const data =
formatarData(
avaliacao.criado_em
);

const estrelas =
criarHTMLestrelasComentario(
Number(
avaliacao.nota
)
);

const usuario =
window.usuarioAtualSupabase;

const souDono =
usuario &&
String(
usuario.id
) ===
String(
avaliacao.usuario_id
);

return `
<article class="comment" data-avaliacao-id="${escaparHTML( avaliacao.id )}" >

  <div class="comment-header">

    <strong>
      ${nome}
    </strong>

    <span>
      ${data}
    </span>

  </div>

  <div class="comment-stars">
    ${estrelas}
  </div>

  ${
    comentario
      ? `<p>${comentario}</p>`
      : ""
  }

  ${
    souDono
      ? `
        <div class="comment-actions">

          <button
            type="button"
            class="delete-comment"
            onclick="editarAvaliacao('${String(
              avaliacao.id
            )}')"
          >
            Editar
          </button>

          <button
            type="button"
            class="delete-comment"
            onclick="excluirAvaliacao('${String(
              avaliacao.id
            )}')"
          >
            Excluir
          </button>

        </div>
      `
      : ""
  }

</article>

`;
}

function criarHTMLestrelasComentario(
nota
) {

let html = "";

for (
let i = 1;
i <= 5;
i++
) {

const imagem =
  i <= nota
    ? "../img/icones/estrela.png"
    : "../img/icones/estrela2.png";


html += `
  <img
    class="comment-star"
    src="${imagem}"
    alt=""
  >
`;

}

return html;
}

/* =========================================================
DATA
========================================================= */

function formatarData(
valor
) {

if (!valor) {
return "";
}

const data =
new Date(valor);

if (
Number.isNaN(
data.getTime()
)
) {
return "";
}

return data.toLocaleDateString(
"pt-BR",
{
day: "2-digit",
month: "2-digit",
year: "numeric"
}
);
}

/* =========================================================
VERIFICAR AVALIAÇÃO DO USUÁRIO
========================================================= */

async function verificarAvaliacaoUsuario() {

const area =
document.getElementById(
"areaAvaliacao"
);

const autenticacao =
document.getElementById(
"areaAutenticacao"
);

const nomeUsuario =
document.getElementById(
"nomeUsuarioLogado"
);

if (!area || !autenticacao) {
return;
}

const cliente =
obterClienteAvaliacoes();

if (!cliente) {

area.style.display =
  "none";

autenticacao.style.display =
  "block";

return;

}

const usuario =
await obterUsuarioAutenticadoLocal();

if (!usuario) {

area.style.display =
  "none";

autenticacao.style.display =
  "block";

return;

}

autenticacao.style.display =
"none";

area.style.display =
"block";

if (nomeUsuario) {

const nome =
  usuario.user_metadata?.nome ||
  usuario.user_metadata?.name ||
  usuario.email ||
  "Usuário";


nomeUsuario.textContent =
  nome;

}

try {

const {
  data,
  error
} =
  await cliente
    .from("avaliacoes")
    .select(
      "id, local_id, usuario_id, nome_usuario, nota, comentario, criado_em"
    )
    .eq(
      "local_id",
      String(localAtual.id)
    )
    .eq(
      "usuario_id",
      usuario.id
    )
    .maybeSingle();


if (error) {

  console.error(
    "Erro ao verificar avaliação:",
    error
  );

  avaliacaoAtual =
    null;

  return;
}


avaliacaoAtual =
  data ||
  null;


if (avaliacaoAtual) {

  notaSelecionada =
    Number(
      avaliacaoAtual.nota
    );


  preencherSeletorEstrelas(
    notaSelecionada
  );


  const textarea =
    document.getElementById(
      "textoComentario"
    );


  if (textarea) {

    textarea.value =
      avaliacaoAtual.comentario ||
      "";
  }


  const botao =
    document.getElementById(
      "publicarComentario"
    );


  if (botao) {

    botao.textContent =
      "Atualizar avaliação";
  }

} else {

  notaSelecionada =
    0;


  preencherSeletorEstrelas(
    0
  );


  const textarea =
    document.getElementById(
      "textoComentario"
    );


  if (textarea) {
    textarea.value =
      "";
  }


  const botao =
    document.getElementById(
      "publicarComentario"
    );


  if (botao) {

    botao.textContent =
      "Publicar avaliação";
  }
}

} catch (erro) {

console.error(
  "Erro ao verificar avaliação:",
  erro
);

}
}

/* =========================================================
SELETOR DE ESTRELAS
========================================================= */

function preencherSeletorEstrelas(
nota
) {

const botoes =
document.querySelectorAll(
".star-button"
);

botoes.forEach(
botao => {

  const valor =
    Number(
      botao.dataset.rating
    );


  const imagem =
    botao.querySelector(
      "img"
    );


  if (!imagem) {
    return;
  }


  if (
    valor <= nota
  ) {

    imagem.src =
      "../img/icones/estrela.png";

  } else {

    imagem.src =
      "../img/icones/estrela2.png";
  }
}

);
}

/* =========================================================
PUBLICAR / ATUALIZAR AVALIAÇÃO
========================================================= */

async function publicarComentario() {

const cliente =
obterClienteAvaliacoes();

if (!cliente) {

alert(
  "Sistema de avaliações indisponível."
);

return;

}

const usuario =
await obterUsuarioAutenticadoLocal();

if (!usuario) {

alert(
  "Entre na sua conta para avaliar este local."
);

return;

}

if (
!notaSelecionada ||
notaSelecionada < 1 ||
notaSelecionada > 5
) {

alert(
  "Escolha uma nota de 1 a 5 estrelas."
);

return;

}

const textarea =
document.getElementById(
"textoComentario"
);

const texto =
textarea
? textarea.value.trim()
: "";

if (
texto.length > 500
) {

alert(
  "O comentário pode ter no máximo 500 caracteres."
);

return;

}

const nomeUsuario =
usuario.user_metadata?.nome ||
usuario.user_metadata?.name ||
usuario.email ||
"Usuário";

const botao =
document.getElementById(
"publicarComentario"
);

if (botao) {

botao.disabled =
  true;

botao.textContent =
  "Salvando...";

}

try {

if (avaliacaoAtual) {

  const {
    error
  } =
    await cliente
      .from("avaliacoes")
      .update({
        nota:
          notaSelecionada,

        comentario:
          texto,

        nome_usuario:
          nomeUsuario
      })
      .eq(
        "id",
        avaliacaoAtual.id
      )
      .eq(
        "usuario_id",
        usuario.id
      );


  if (error) {
    throw error;
  }

} else {

  const {
    error
  } =
    await cliente
      .from("avaliacoes")
      .insert({
        local_id:
          String(localAtual.id),

        usuario_id:
          usuario.id,

        nome_usuario:
          nomeUsuario,

        nota:
          notaSelecionada,

        comentario:
          texto
      });


  if (error) {
    throw error;
  }
}


await carregarAvaliacoes();

await verificarAvaliacaoUsuario();

} catch (erro) {

console.error(
  "Erro ao salvar avaliação:",
  erro
);


alert(
  erro.message ||
  "Não foi possível salvar sua avaliação."
);

} finally {

if (botao) {

  botao.disabled =
    false;
}

}
}

/* =========================================================
EDITAR AVALIAÇÃO
========================================================= */

async function editarAvaliacao(
id
) {

if (!id) {
return;
}

const cliente =
obterClienteAvaliacoes();

if (!cliente) {
return;
}

const usuario =
await obterUsuarioAutenticadoLocal();

if (!usuario) {

alert(
  "Você precisa estar logado."
);

return;

}

try {

const {
  data,
  error
} =
  await cliente
    .from("avaliacoes")
    .select(
      "id, nota, comentario"
    )
    .eq(
      "id",
      id
    )
    .eq(
      "usuario_id",
      usuario.id
    )
    .maybeSingle();


if (error) {
  throw error;
}


if (!data) {

  alert(
    "Avaliação não encontrada."
  );

  return;
}


avaliacaoAtual =
  data;


notaSelecionada =
  Number(
    data.nota
  );


preencherSeletorEstrelas(
  notaSelecionada
);


const textarea =
  document.getElementById(
    "textoComentario"
  );


if (textarea) {

  textarea.value =
    data.comentario ||
    "";

  textarea.focus();
}


const formulario =
  document.getElementById(
    "areaAvaliacao"
  );


if (formulario) {

  formulario.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
}


const botao =
  document.getElementById(
    "publicarComentario"
  );


if (botao) {

  botao.textContent =
    "Atualizar avaliação";
}

} catch (erro) {

console.error(
  "Erro ao editar avaliação:",
  erro
);


alert(
  "Não foi possível carregar sua avaliação."
);

}
}

window.editarAvaliacao =
editarAvaliacao;

/* =========================================================
EXCLUIR AVALIAÇÃO
========================================================= */

async function excluirAvaliacao(
id
) {

if (!id) {
return;
}

const confirmou =
window.confirm(
"Deseja excluir sua avaliação?"
);

if (!confirmou) {
return;
}

const cliente =
obterClienteAvaliacoes();

if (!cliente) {
return;
}

const usuario =
await obterUsuarioAutenticadoLocal();

if (!usuario) {

alert(
  "Você precisa estar logado."
);

return;

}

try {

const {
  error
} =
  await cliente
    .from("avaliacoes")
    .delete()
    .eq(
      "id",
      id
    )
    .eq(
      "usuario_id",
      usuario.id
    );


if (error) {
  throw error;
}


avaliacaoAtual =
  null;

notaSelecionada =
  0;


await carregarAvaliacoes();

await verificarAvaliacaoUsuario();

} catch (erro) {

console.error(
  "Erro ao excluir avaliação:",
  erro
);


alert(
  erro.message ||
  "Não foi possível excluir a avaliação."
);

}
}

window.excluirAvaliacao =
excluirAvaliacao;

/* =========================================================
EVENTOS
========================================================= */

function configurarEventos() {

/*
Botão publicar avaliação
*/

const publicar =
document.getElementById(
"publicarComentario"
);

if (publicar) {

publicar.addEventListener(
  "click",
  publicarComentario
);

}

/*
Estrelas
*/

const estrelas =
document.querySelectorAll(
".star-button"
);

estrelas.forEach(
botao => {

  botao.addEventListener(
    "mouseenter",
    () => {

      const nota =
        Number(
          botao.dataset.rating
        );


      preencherSeletorEstrelas(
        nota
      );
    }
  );


  botao.addEventListener(
    "mouseleave",
    () => {

      preencherSeletorEstrelas(
        notaSelecionada
      );
    }
  );


  botao.addEventListener(
    "click",
    () => {

      notaSelecionada =
        Number(
          botao.dataset.rating
        );


      preencherSeletorEstrelas(
        notaSelecionada
      );
    }
  );
}

);

/*
Fechar visualizador clicando fora da imagem
*/

const viewer =
document.getElementById(
"photoViewer"
);

if (viewer) {

viewer.addEventListener(
  "click",
  evento => {

    if (
      evento.target ===
      viewer
    ) {

      fecharFotoTelaCheia();
    }
  }
);

}
}

/* =========================================================
MONITORAMENTO DE LOGIN
========================================================= */

function configurarMonitoramentoAuth() {

const cliente =
obterSupabaseClient();

if (!cliente) {

console.warn(
  "Cliente Supabase não disponível para monitoramento."
);

return;

}

try {

cliente.auth.onAuthStateChange(
  async () => {

    /*
      Pequeno atraso para permitir que o
      login.js atualize window.usuarioAtualSupabase.
    */

    setTimeout(
      async () => {

        await verificarAvaliacaoUsuario();

        await carregarAvaliacoes();

        await verificarProprietarioComercio();

      },
      100
    );
  }
);

} catch (erro) {

console.error(
  "Erro no monitoramento de autenticação:",
  erro
);

}
}

/* =========================================================
INICIALIZAÇÃO
========================================================= */

document.addEventListener(
"DOMContentLoaded",
async () => {

supabaseClient =
  obterSupabaseClient();


configurarEventos();

configurarMonitoramentoAuth();

await carregarLocal();

}
);
