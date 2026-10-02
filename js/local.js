/* =========================================================
ANDRELÂNDIA — GUIA TURÍSTICO
LOCAL.JS

RESPONSABILIDADES:

Carregar locais
Carregar comércios
Carregar hospedagens
Preencher página
Galeria
Foto em tela cheia
Mapa Leaflet + Esri
Google Maps
WhatsApp
Instagram
Sugestão de alteração
Avaliações
Login compartilhado
Verificação do proprietário
Editar meu comércio
Excluir meu comércio
========================================================= */

/* =========================================================
CONFIGURAÇÕES
========================================================= */

const SUPABASE_URL =
"https://xdmbkflufsfqziixzpxc.supabase.co";

const SUPABASE_ANON_KEY =
"sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";

const EDGE_FUNCTION_URL =
`${SUPABASE_URL}/functions/v1/whatsapp-bot`;

const FALLBACK_IMAGE =
"../img/icones/imgnaodisponivel.png";

/* =========================================================
URL
========================================================= */

const params =
new URLSearchParams(window.location.search);

const idLocal =
params.get("id");

/* =========================================================
ESTADO
========================================================= */

let localAtual = null;
let mapaLocal = null;
let imagensAtuais = [];
let notaSelecionada = 0;
let avaliacaoAtual = null;
let supabaseClient = null;

/* =========================================================
SUPABASE
========================================================= */

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
        SUPABASE_ANON_KEY
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

function obterClienteAvaliacoes() {

if (!supabaseClient) {
supabaseClient = obterSupabaseClient();
}

return supabaseClient;
}

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
.replace(/"/g, '"')
.replace(/'/g, "'");
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

} catch {

  return valor
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

}

return [];
}

function corrigirCaminhoImagem(caminho) {

if (
!caminho ||
typeof caminho !== "string"
) {
return FALLBACK_IMAGE;
}

let valor = caminho.trim();

if (!valor) {
return FALLBACK_IMAGE;
}

if (
valor.startsWith("http://") ||
valor.startsWith("https://") ||
valor.startsWith("data:") ||
valor.startsWith("blob:")
) {
return valor;
}

if (valor.startsWith("/")) {
return valor;
}

if (valor.startsWith("../")) {
return valor;
}

if (valor.startsWith("./")) {
valor = valor.substring(2);
}

if (
valor.startsWith("img/") ||
valor.startsWith("IMG/")
) {
return `../${valor}`;
}

return `../${valor}`;
}

/* =========================================================
IDENTIFICAÇÃO DO TIPO
========================================================= */

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
String(
item.tipo ||
item.tipo_local ||
item.origem ||
""
).toLowerCase();

if (
tipo.includes("comerc") ||
tipo.includes("empresa") ||
tipo.includes("negocio")
) {
return true;
}

const categoria =
String(
item.categoria || ""
).toLowerCase();

const categorias = [
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
"artesanato",
"açougue",
"acougue",
"pet shop",
"salão",
"salao"
];

return categorias.some(
categoriaComercial =>
categoria.includes(categoriaComercial)
);
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

window.location.href =
"../index.html";
}

window.voltarPagina =
voltarPagina;

/* =========================================================
CARREGAR JSON
========================================================= */

async function carregarJSON(caminho) {

const resposta =
await fetch(
caminho,
{
cache: "no-cache"
}
);

if (!resposta.ok) {

throw new Error(
  `Não foi possível carregar ${caminho}`
);

}

return resposta.json();
}

/* =========================================================
CARREGAR LOCAL
========================================================= */

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

let encontrado =
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

console.log(
  "Local carregado:",
  localAtual
);

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
nome.textContent =
mensagem;
}

const conteudo =
document.querySelector(
".content-section"
);

if (conteudo) {

conteudo.innerHTML = `
  <div class="section-block">
    <p>
      ${escaparHTML(mensagem)}
    </p>
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

return escaparHTML(horario)
  .replace(/\n/g, "<br>");

}

if (Array.isArray(horario)) {

return horario
  .map(
    item =>
      escaparHTML(item)
  )
  .join("<br>");

}

if (
typeof horario === "object" &&
horario !== null
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
String(valor).replace(/\D/g, "");

if (!numero) {
return "";
}

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
SUGESTÃO DE ALTERAÇÃO
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

function adicionarImagemUnica(
lista,
imagem
) {

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

if (!lista.includes(url)) {
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

if (
!principal ||
!miniaturas
) {
return;
}

const imagens = [];

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

[
item.imagens,
item.galeria,
item.fotos,
item.fotos_galeria
].forEach(campo => {

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

});

if (!imagens.length) {
imagens.push(FALLBACK_IMAGE);
}

imagensAtuais =
imagens;

principal.src =
imagens[0];

principal.alt =
item.nome ||
"Imagem do local";

principal.onerror =
function () {

  this.onerror = null;
  this.src = FALLBACK_IMAGE;
};

miniaturas.innerHTML =
"";

imagens
.slice(0, 4)
.forEach(
(imagem, indice) => {

    const botao =
      document.createElement("button");

    botao.type =
      "button";

    botao.className =
      "thumbnail";

    if (indice === 0) {
      botao.classList.add("active");
    }

    const img =
      document.createElement("img");

    img.src =
      imagem;

    img.alt =
      `${item.nome || "Local"} — foto ${indice + 1}`;

    img.onerror =
      function () {

        this.onerror = null;
        this.src = FALLBACK_IMAGE;
      };

    botao.appendChild(img);

    botao.addEventListener(
      "click",
      () => {

        principal.src =
          imagem;

        document
          .querySelectorAll(".thumbnail")
          .forEach(
            elemento =>
              elemento.classList.remove("active")
          );

        botao.classList.add("active");
      }
    );

    miniaturas.appendChild(botao);
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

viewer.classList.add("open");

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

viewer.classList.remove("open");

document.body.style.overflow =
"";
}

window.abrirFotoTelaCheia =
abrirFotoTelaCheia;

window.fecharFotoTelaCheia =
fecharFotoTelaCheia;

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
)
.setView(
[
latitude,
longitude
],
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

  maxNativeZoom:
    19,

  maxZoom:
    22
}

).addTo(mapaLocal);

const marcador =
L.marker([
latitude,
longitude
]).addTo(mapaLocal);

marcador.bindPopup(
`<strong>${escaparHTML(item.nome || "Local")}</strong>`
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
USUÁRIO
========================================================= */

async function obterUsuarioAutenticadoLocal() {

if (
window.usuarioAtualSupabase
) {

return window.usuarioAtualSupabase;

}

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
    "Erro ao obter usuário:",
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

/* =========================================================
ÁREA DOS BOTÕES
========================================================= */

function obterAreaBotoesComercio() {

let area =
document.getElementById(
"areaExcluirComercio"
);

if (area) {
return area;
}

area =
document.createElement("div");

area.id =
"areaExcluirComercio";

const mapa =
document.querySelector(
".local-map-section"
);

if (mapa) {

mapa.parentNode.insertBefore(
  area,
  mapa
);

} else {

const pagina =
  document.querySelector(
    ".local-page"
  );

if (pagina) {
  pagina.appendChild(area);
}

}

return area;
}

/* =========================================================
ESTILO DOS BOTÕES
========================================================= */

function prepararEstiloBotoesComercio() {

if (
document.getElementById(
"estiloBotoesComercio"
)
) {
return;
}

const estilo =
document.createElement("style");

estilo.id =
"estiloBotoesComercio";

estilo.textContent = `
#areaExcluirComercio {
display: none;
width: 100%;
margin: 20px 0;
gap: 10px;
}

#botaoEditarComercio,
#botaoExcluirComercio {
  width: 100%;
  border: 0;
  border-radius: 8px;
  padding: 13px 16px;
  font-size: 14px;
  font-family: inherit;
  cursor: pointer;
  transition: opacity .2s ease;
}

#botaoEditarComercio {
  background: #194138;
  color: #ffffff;
}

#botaoExcluirComercio {
  background: #8b2e2e;
  color: #ffffff;
}

#botaoEditarComercio:hover,
#botaoExcluirComercio:hover {
  opacity: .88;
}

#botaoEditarComercio:disabled,
#botaoExcluirComercio:disabled {
  opacity: .55;
  cursor: wait;
}

.editar-comercio-modal {
  position: fixed;
  inset: 0;
  z-index: 100001;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0,0,0,.65);
}

.editar-comercio-modal.aberto {
  display: flex;
}

.editar-comercio-caixa {
  width: 100%;
  max-width: 600px;
  max-height: 90vh;
  overflow-y: auto;
  background: #ffffff;
  border-radius: 12px;
  padding: 22px;
  box-sizing: border-box;
}

.editar-comercio-caixa h2 {
  margin: 0 0 18px;
  color: #091D1C;
}

.editar-comercio-campo {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 13px;
}

.editar-comercio-campo label {
  font-size: 13px;
  font-weight: 600;
  color: #333333;
}

.editar-comercio-campo input,
.editar-comercio-campo textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 11px 12px;
  border: 1px solid #cccccc;
  border-radius: 7px;
  font-family: inherit;
  font-size: 14px;
  outline: none;
}

.editar-comercio-campo textarea {
  min-height: 90px;
  resize: vertical;
}

.editar-comercio-acoes {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}

.editar-comercio-acoes button {
  flex: 1;
  border: 0;
  border-radius: 7px;
  padding: 12px;
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
}

.editar-comercio-cancelar {
  background: #eeeeee;
  color: #333333;
}

.editar-comercio-salvar {
  background: #194138;
  color: #ffffff;
}

`;

document.head.appendChild(estilo);
}

/* =========================================================
VERIFICAR PROPRIETÁRIO DO COMÉRCIO
========================================================= */

async function verificarProprietarioComercio() {

const area =
obterAreaBotoesComercio();

if (!area) {
return;
}

prepararEstiloBotoesComercio();

area.style.display =
"none";

/*

Só comércio possui proprietário.
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
  "Supabase não disponível."
);

return;

}

const usuario =
await obterUsuarioAutenticadoLocal();

if (!usuario) {

console.log(
  "Nenhum usuário logado."
);

return;

}

console.log(
"Usuário logado:",
usuario.id
);

console.log(
"Comércio atual:",
localAtual.id,
localAtual.nome
);

let cadastro = null;

try {

/*
 * =====================================================
 * CORREÇÃO PRINCIPAL
 *
 * NÃO consultar:
 *
 * id = "pedrox-do-grau"
 *
 * porque cadastros_comercios.id é UUID.
 *
 * O ID público do JSON fica em local_id.
 * =====================================================
 */

const resposta =
  await cliente
    .from("cadastros_comercios")
    .select("*")
    .eq(
      "local_id",
      String(localAtual.id)
    )
    .eq(
      "usuario_id",
      usuario.id
    )
    .maybeSingle();

if (resposta.error) {

  console.error(
    "Erro ao buscar cadastro pelo local_id:",
    resposta.error
  );

  return;
}

cadastro =
  resposta.data || null;

console.log(
  "Cadastro encontrado pelo local_id:",
  cadastro
);

if (!cadastro) {

  console.log(
    "Nenhum cadastro do usuário encontrado para este comércio."
  );

  return;
}

/*
 * Só comércio aprovado aparece publicamente.
 */

if (
  String(cadastro.status || "")
    .toLowerCase() !==
  "aprovado"
) {

  console.log(
    "Cadastro encontrado, mas não está aprovado:",
    cadastro.status
  );

  return;
}

/*
 * Guarda o cadastro.
 */

localAtual._cadastroSupabase =
  cadastro;

/*
 * Limpa os botões anteriores.
 */

area.innerHTML =
  "";

/*
 * BOTÃO EDITAR
 */

const botaoEditar =
  document.createElement("button");

botaoEditar.type =
  "button";

botaoEditar.id =
  "botaoEditarComercio";

botaoEditar.className =
  "botao-editar-comercio";

botaoEditar.textContent =
  "Editar meu comércio";

botaoEditar.addEventListener(
  "click",
  editarMeuComercio
);

/*
 * BOTÃO EXCLUIR
 */

const botaoExcluir =
  document.createElement("button");

botaoExcluir.type =
  "button";

botaoExcluir.id =
  "botaoExcluirComercio";

botaoExcluir.className =
  "botao-excluir-perfil";

botaoExcluir.textContent =
  "Excluir meu comércio";

botaoExcluir.addEventListener(
  "click",
  excluirMeuComercio
);

area.appendChild(
  botaoEditar
);

area.appendChild(
  botaoExcluir
);

area.style.display =
  "flex";

console.log(
  "PROPRIETÁRIO CONFIRMADO."
);

console.log(
  "Botões Editar e Excluir exibidos."
);

} catch (erro) {

console.error(
  "Erro ao verificar proprietário:",
  erro
);

}
}

/* =========================================================
EDITAR MEU COMÉRCIO
========================================================= */

async function editarMeuComercio() {

if (!localAtual) {

alert(
  "Comércio não identificado."
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
  "Você precisa estar logado."
);

return;

}

const cadastro =
localAtual._cadastroSupabase;

if (!cadastro) {

alert(
  "Cadastro do comércio não encontrado."
);

return;

}

/*

Revalida proprietário no banco.
*/

if (
String(cadastro.usuario_id) !==
String(usuario.id)
) {

alert(
  "Você não é o proprietário deste comércio."
);

return;

}

abrirModalEdicaoComercio();
}

function criarCampoEdicao(
formulario,
nome,
valor,
tipo = "input"
) {

const grupo =
document.createElement("div");

grupo.className =
"editar-comercio-campo";

const label =
document.createElement("label");

label.textContent =
nome;

const campo =
document.createElement(
tipo === "textarea"
? "textarea"
: "input"
);

campo.value =
valor ?? "";

campo.dataset.campo =
nome;

grupo.appendChild(label);
grupo.appendChild(campo);

formulario.appendChild(
grupo
);

return campo;
}

function obterHorarioParaEdicao(horario) {

if (
typeof horario === "string" ||
typeof horario === "number"
) {
return String(horario);
}

if (Array.isArray(horario)) {
return horario.join("\n");
}

if (
typeof horario === "object" &&
horario !== null
) {

return Object.entries(horario)
  .map(
    ([dia, valor]) =>
      `${dia}: ${valor}`
  )
  .join("\n");

}

return "";
}

function abrirModalEdicaoComercio() {

const existente =
document.getElementById(
"modalEditarComercio"
);

if (existente) {

existente.classList.add(
  "aberto"
);

return;

}

const modal =
document.createElement("div");

modal.id =
"modalEditarComercio";

modal.className =
"editar-comercio-modal";

const caixa =
document.createElement("div");

caixa.className =
"editar-comercio-caixa";

const titulo =
document.createElement("h2");

titulo.textContent =
"Editar meu comércio";

caixa.appendChild(titulo);

const formulario =
document.createElement("div");

const campoNome =
criarCampoEdicao(
formulario,
"Nome",
localAtual.nome,
"input"
);

const campoCategoria =
criarCampoEdicao(
formulario,
"Categoria",
localAtual.categoria,
"input"
);

const campoDescricao =
criarCampoEdicao(
formulario,
"Descrição",
localAtual.descricao,
"textarea"
);

const campoEndereco =
criarCampoEdicao(
formulario,
"Endereço",
primeiroValor(
localAtual.endereco,
localAtual.endereço
),
"input"
);

const campoHorario =
criarCampoEdicao(
formulario,
"Horário",
obterHorarioParaEdicao(
localAtual.horario
),
"textarea"
);

const campoTelefone =
criarCampoEdicao(
formulario,
"Telefone",
localAtual.telefone,
"input"
);

const campoWhatsApp =
criarCampoEdicao(
formulario,
"WhatsApp",
localAtual.whatsapp ||
localAtual.telefone,
"input"
);

const campoInstagram =
criarCampoEdicao(
formulario,
"Instagram",
localAtual.instagram,
"input"
);

caixa.appendChild(
formulario
);

const acoes =
document.createElement("div");

acoes.className =
"editar-comercio-acoes";

const cancelar =
document.createElement("button");

cancelar.type =
"button";

cancelar.className =
"editar-comercio-cancelar";

cancelar.textContent =
"Cancelar";

const salvar =
document.createElement("button");

salvar.type =
"button";

salvar.className =
"editar-comercio-salvar";

salvar.textContent =
"Salvar alterações";

acoes.appendChild(
cancelar
);

acoes.appendChild(
salvar
);

caixa.appendChild(
acoes
);

modal.appendChild(
caixa
);

document.body.appendChild(
modal
);

cancelar.addEventListener(
"click",
() => {

  modal.classList.remove(
    "aberto"
  );
}

);

modal.addEventListener(
"click",
evento => {

  if (
    evento.target ===
    modal
  ) {

    modal.classList.remove(
      "aberto"
    );
  }
}

);

salvar.addEventListener(
"click",
async () => {

  salvar.disabled =
    true;

  salvar.textContent =
    "Salvando...";

  try {

    await enviarEdicaoComercio({
      nome:
        campoNome.value.trim(),

      categoria:
        campoCategoria.value.trim(),

      descricao:
        campoDescricao.value.trim(),

      endereco:
        campoEndereco.value.trim(),

      horario:
        campoHorario.value.trim(),

      telefone:
        campoTelefone.value.trim(),

      whatsapp:
        campoWhatsApp.value.trim(),

      instagram:
        campoInstagram.value.trim()
    });

    modal.classList.remove(
      "aberto"
    );

  } catch (erro) {

    console.error(
      "Erro ao editar comércio:",
      erro
    );

    alert(
      erro.message ||
      "Não foi possível atualizar o comércio."
    );

  } finally {

    salvar.disabled =
      false;

    salvar.textContent =
      "Salvar alterações";
  }
}

);

modal.classList.add(
"aberto"
);
}

async function enviarEdicaoComercio(
dados
) {

const cliente =
obterSupabaseClient();

if (!cliente) {

throw new Error(
  "Sistema Supabase indisponível."
);

}

const usuario =
await obterUsuarioAutenticadoLocal();

if (!usuario) {

throw new Error(
  "Sua sessão expirou. Faça login novamente."
);

}

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

const comercio = {

id:
  localAtual.id,

nome:
  dados.nome,

categoria:
  dados.categoria,

descricao:
  dados.descricao,

endereco:
  dados.endereco,

horario:
  dados.horario,

telefone:
  dados.telefone,

whatsapp:
  dados.whatsapp,

instagram:
  dados.instagram,

latitude:
  localAtual.latitude,

longitude:
  localAtual.longitude,

imagem:
  localAtual.imagem,

imagens:
  localAtual.imagens

};

const resposta =
await fetch(
EDGE_FUNCTION_URL,
{
method:
"POST",

    headers:
      {
        "Content-Type":
          "application/json",

        "Authorization":
          `Bearer ${accessToken}`
      },

    body:
      JSON.stringify({
        acao:
          "editar_meu_comercio",

        comercio_id:
          localAtual.id,

        comercio:
          comercio
      })
  }
);

let resultado = null;

try {

resultado =
  await resposta.json();

} catch {

resultado =
  null;

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
  "Não foi possível atualizar o comércio."
);

}

alert(
"Comércio atualizado com sucesso."
);

window.location.reload();
}

window.editarMeuComercio =
editarMeuComercio;

/* =========================================================
EXCLUIR MEU COMÉRCIO
========================================================= */

async function excluirMeuComercio() {

if (!localAtual) {

alert(
  "Comércio não identificado."
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

const cadastro =
localAtual._cadastroSupabase;

if (!cadastro) {

alert(
  "Cadastro do comércio não encontrado."
);

return;

}

if (
String(cadastro.usuario_id) !==
String(usuario.id)
) {

alert(
  "Você não é o proprietário deste comércio."
);

return;

}

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
    EDGE_FUNCTION_URL,
    {
      method:
        "POST",

      headers:
        {
          "Content-Type":
            "application/json",

          "Authorization":
            `Bearer ${accessToken}`
        },

      body:
        JSON.stringify({
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

  resultado =
    null;
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
    (total, avaliacao) =>
      total +
      Number(
        avaliacao.nota || 0
      ),
    0
  );

const mediaCalculada =
  soma / avaliacoes.length;

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

function criarHTMLestrelas(nota) {

const valor =
Number(nota) || 0;

let html =
"";

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

function criarHTMLestrelasComentario(nota) {

let html =
"";

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
HTML DE UMA AVALIAÇÃO
========================================================= */

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
String(usuario.id) ===
String(avaliacao.usuario_id);

return `
<article class="comment" data-avaliacao-id="${escaparHTML(avaliacao.id)}" >

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
            data-editar-avaliacao="${escaparHTML(
              avaliacao.id
            )}"
          >
            Editar
          </button>

          <button
            type="button"
            class="delete-comment"
            data-excluir-avaliacao="${escaparHTML(
              avaliacao.id
            )}"
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

/* =========================================================
DATA
========================================================= */

function formatarData(valor) {

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

if (
!area ||
!autenticacao
) {
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
  data || null;

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

  preencherSeletorEstrelas(0);

  const textarea =
    document.getElementById(
      "textoComentario"
    );

  if (textarea) {
    textarea.value = "";
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

function preencherSeletorEstrelas(nota) {

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

  imagem.src =
    valor <= nota
      ? "../img/icones/estrela.png"
      : "../img/icones/estrela2.png";
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

const comentario =
textarea
? textarea.value.trim()
: "";

if (
comentario.length > 500
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
          comentario,

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
          comentario
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

async function editarAvaliacao(id) {

if (!id) {
return;
}

const cliente =
obterClienteAvaliacoes();

const usuario =
await obterUsuarioAutenticadoLocal();

if (
!cliente ||
!usuario
) {
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
  Number(data.nota);

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

async function excluirAvaliacao(id) {

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

const usuario =
await obterUsuarioAutenticadoLocal();

if (
!cliente ||
!usuario
) {
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

const estrelas =
document.querySelectorAll(
".star-button"
);

estrelas.forEach(
botao => {

  botao.addEventListener(
    "mouseenter",
    () => {

      preencherSeletorEstrelas(
        Number(
          botao.dataset.rating
        )
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

document.addEventListener(
"click",
evento => {

  const editar =
    evento.target.closest(
      "[data-editar-avaliacao]"
    );

  if (editar) {

    editarAvaliacao(
      editar.dataset.editarAvaliacao
    );

    return;
  }

  const excluir =
    evento.target.closest(
      "[data-excluir-avaliacao]"
    );

  if (excluir) {

    excluirAvaliacao(
      excluir.dataset.excluirAvaliacao
    );
  }
}

);

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

document.addEventListener(
"keydown",
evento => {

  if (
    evento.key ===
    "Escape"
  ) {

    fecharFotoTelaCheia();

    const modal =
      document.getElementById(
        "modalEditarComercio"
      );

    if (modal) {

      modal.classList.remove(
        "aberto"
      );
    }
  }
}

);
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
  () => {

    setTimeout(
      async () => {

        await verificarAvaliacaoUsuario();

        await carregarAvaliacoes();

        await verificarProprietarioComercio();

      },
      150
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

console.log(
  "LOCAL.JS iniciado."
);

supabaseClient =
  obterSupabaseClient();

prepararEstiloBotoesComercio();

configurarEventos();

configurarMonitoramentoAuth();

await carregarLocal();

}
);
