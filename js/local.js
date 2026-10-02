/* =========================================================
ANDRELÂNDIA — GUIA TURÍSTICO
LOCAL.JS

RESPONSABILIDADES:

Carregar local/comércio/hospedagem
Galeria de imagens
Mapa Esri
WhatsApp / Instagram
Sugestão de alteração
Avaliações
Login
Identificação do proprietário
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
"https://xdmbkflufsfqziixzpxc.supabase.co/functions/v1/whatsapp-bot";

const FALLBACK_IMAGE =
"../img/icones/imgnaodisponivel.png";

const ESTRELA_DESATIVADA =
"../img/icones/estrela2.png";

const ESTRELA_ATIVADA =
"../img/icones/estrela.png";

/* =========================================================
ESTADO
========================================================= */

const parametrosURL =
new URLSearchParams(
window.location.search
);

const idLocal =
parametrosURL.get("id");

let localAtual = null;

let mapaLocal = null;

let imagensAtuais = [];

let notaSelecionada = 0;

let notaHover = 0;

let avaliacaoAtual = null;

let supabaseClient = null;

let usuarioProprietarioVerificado = null;

let verificacaoProprietarioEmAndamento = false;

/* =========================================================
SUPABASE
========================================================= */

function obterSupabaseClient() {

if (supabaseClient) {
return supabaseClient;
}

if (window.supabaseLoginClient) {

supabaseClient =
window.supabaseLoginClient;

return supabaseClient;

}

if (
window.supabase &&
typeof window.supabase.createClient === "function"
) {

supabaseClient =
window.supabase.createClient(
SUPABASE_URL,
SUPABASE_ANON_KEY
);

return supabaseClient;

}

console.error(
"Supabase não está disponível."
);

return null;

}

/* =========================================================
ESCAPAR HTML
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

/* =========================================================
NORMALIZAR TEXTO
========================================================= */

function normalizarTexto(valor) {

return String(valor || "")
.trim()
.toLowerCase()
.normalize("NFD")
.replace(/[\u0300-\u036f]/g, "");

}

/* =========================================================
IDENTIFICAR COMÉRCIO
========================================================= */

function pareceComercio(item) {

if (!item) {
return false;
}

const tipo =
normalizarTexto(
item._tipo ||
item.tipo ||
item.fonte ||
""
);

const categoria =
normalizarTexto(
item.categoria ||
""
);

const categoriasComercio = [

"comercio",
"loja",
"mercado",
"supermercado",
"lanchonete",
"restaurante",
"cafeteria",
"sorveteria",
"padaria",
"bar",
"mercearia",
"farmacia",
"autopecas",
"oficina",
"hotel",
"pousada",
"servico"

];

return (
tipo.includes("comerc") ||
categoriasComercio.includes(
categoria
)
);

}

/* =========================================================
CARREGAR LOCAL
========================================================= */

async function carregarLocal() {

console.log(
"LOCAL.JS iniciado."
);

if (!idLocal) {

console.error(
"Nenhum ID foi informado na URL."
);

return;

}

try {

const [
respostaLocais,
respostaComercios,
respostaHospedagem
] = await Promise.all([

fetch(
"../DATA/locais.json"
),

fetch(
"../DATA/comercios.json"
),

fetch(
"../DATA/hospedagem.json"
)

]);

const locais =
respostaLocais.ok
? await respostaLocais.json()
: [];

const comercios =
respostaComercios.ok
? await respostaComercios.json()
: [];

const hospedagem =
respostaHospedagem.ok
? await respostaHospedagem.json()
: [];

let encontrado = null;

/* =====================================================
LOCAIS
===================================================== */

encontrado =
locais.find(
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
comercios.find(
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
hospedagem.find(
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

/* =====================================================
VERIFICAR RESULTADO
===================================================== */

if (!encontrado) {

console.error(
"Local não encontrado:",
idLocal
);

return;

}

localAtual =
encontrado;

console.log(
"Local carregado:",
localAtual
);

preencherPagina();

await carregarAvaliacoes();

await verificarAvaliacaoUsuario();

await verificarProprietarioComercio();

} catch (erro) {

console.error(
"Erro ao carregar local:",
erro
);

}

}

/* =========================================================
PREENCHER PÁGINA
========================================================= */

function preencherPagina() {

if (!localAtual) {
return;
}

document.title =
`${localAtual.nome || "Local"} — Guia Turístico de Andrelândia`;

/* =====================================================
CATEGORIA
===================================================== */

const categoria =
document.getElementById(
"categoriaLocal"
);

if (categoria) {

categoria.textContent =
localAtual.categoria ||
"";

}

/* =====================================================
NOME
===================================================== */

const nome =
document.getElementById(
"nomeLocal"
);

if (nome) {

nome.textContent =
localAtual.nome ||
"";

}

/* =====================================================
DESCRIÇÃO
===================================================== */

const descricao =
document.getElementById(
"descricaoLocal"
);

if (descricao) {

descricao.textContent =
localAtual.descricao ||
localAtual.sobre ||
"Informações sobre este local ainda não disponíveis.";

}

/* =====================================================
HISTÓRIA
===================================================== */

const historia =
document.getElementById(
"historiaLocal"
);

if (historia) {

historia.textContent =
localAtual.historia ||
"Ainda não há informações históricas cadastradas.";

}

/* =====================================================
CURIOSIDADES
===================================================== */

const curiosidades =
document.getElementById(
"curiosidadesLocal"
);

if (curiosidades) {

curiosidades.textContent =
localAtual.curiosidades ||
"Ainda não há curiosidades cadastradas.";

}

/* =====================================================
HORÁRIO
===================================================== */

const horario =
document.getElementById(
"horarioLocal"
);

if (horario) {

horario.textContent =
localAtual.horario ||
"Não informado";

}

/* =====================================================
ENDEREÇO
===================================================== */

const endereco =
document.getElementById(
"enderecoLocal"
);

if (endereco) {

endereco.textContent =
localAtual.endereco ||
"Não informado";

}

preencherWhatsApp();

preencherInstagram();

preencherGaleria();

inicializarMapa();

/* =====================================================
SUGESTÃO
===================================================== */

const botaoSugerir =
document.getElementById(
"botaoSugerirAlteracao"
);

if (botaoSugerir) {

botaoSugerir.onclick =
sugerirAlteracao;

}

}

/* =========================================================
WHATSAPP
========================================================= */

function preencherWhatsApp() {

const elemento =
document.getElementById(
"whatsappLocal"
);

const nome =
document.getElementById(
"whatsappNome"
);

if (!elemento) {
return;
}

const numero =
localAtual.whatsapp ||
localAtual.telefone ||
"";

if (!numero) {

elemento.style.display =
"none";

if (nome) {
nome.style.display =
"none";
}

return;

}

const numeroLimpo =
String(numero)
.replace(/\D/g, "");

const mensagem =
`Olá! Encontrei a ${localAtual.nome} pelo Guia Turístico de Andrelândia e gostaria de fazer um pedido.`;

elemento.href =
`https://wa.me/${numeroLimpo}?text=${encodeURIComponent(mensagem)}`;

elemento.target =
"_blank";

elemento.rel =
"noopener noreferrer";

elemento.style.display =
"";

if (nome) {

nome.style.display =
"";

nome.textContent =
localAtual.nome ||
"WhatsApp";

}

}

/* =========================================================
INSTAGRAM
========================================================= */

function preencherInstagram() {

const elemento =
document.getElementById(
"instagramLocal"
);

const nome =
document.getElementById(
"instagramNome"
);

if (!elemento) {
return;
}

let instagram =
localAtual.instagram ||
"";

instagram =
String(instagram).trim();

if (!instagram) {

elemento.style.display =
"none";

if (nome) {
nome.style.display =
"none";
}

return;

}

if (
!instagram.startsWith("http://") &&
!instagram.startsWith("https://")
) {

instagram =
instagram.replace(
/^@/,
""
);

instagram =
`https://instagram.com/${instagram}`;

}

elemento.href =
instagram;

elemento.target =
"_blank";

elemento.rel =
"noopener noreferrer";

elemento.style.display =
"";

if (nome) {

nome.style.display =
"";

nome.textContent =
localAtual.nome ||
"Instagram";

}

}

/* =========================================================
GALERIA
========================================================= */

function obterImagensLocal() {

if (!localAtual) {
return [];
}

let imagens = [];

if (
Array.isArray(
localAtual.imagens
)
) {

imagens =
localAtual.imagens
.filter(
imagem =>
typeof imagem === "string" &&
imagem.trim() !== ""
)
.map(
imagem =>
imagem.trim()
);

}

if (
!imagens.length &&
typeof localAtual.imagem === "string" &&
localAtual.imagem.trim() !== ""
) {

imagens = [
localAtual.imagem.trim()
];

}

if (!imagens.length) {

imagens = [
FALLBACK_IMAGE
];

}

return imagens.slice(
0,
5
);

}

/* =========================================================
PREENCHER GALERIA
========================================================= */

function preencherGaleria() {

const principal =
document.getElementById(
"fotoPrincipal"
);

const miniaturas =
document.getElementById(
"miniaturas"
);

if (!principal) {
return;
}

const imagens =
obterImagensLocal();

imagensAtuais =
imagens;

principal.src =
imagens[0];

principal.alt =
`${localAtual?.nome || "Local"} — foto principal`;

principal.onerror =
function () {

if (this.dataset.fallbackAplicado) {
return;
}

this.dataset.fallbackAplicado =
"1";

this.src =
FALLBACK_IMAGE;

};

principal.onclick =
function () {

abrirVisualizador(
0
);

};

if (!miniaturas) {
return;
}

miniaturas.innerHTML =
"";

if (imagens.length <= 1) {

miniaturas.style.display =
"none";

return;

}

miniaturas.style.display =
"grid";

imagens
.slice(
0,
4
)
.forEach(
(
imagem,
indice
) => {

const miniatura =
document.createElement(
"button"
);

miniatura.type =
"button";

miniatura.className =
"thumbnail";

const img =
document.createElement(
"img"
);

img.src =
imagem;

img.alt =
`${localAtual?.nome || "Local"} — Foto ${indice + 1}`;

img.loading =
"lazy";

img.decoding =
"async";

img.onerror =
function () {

if (this.dataset.fallbackAplicado) {
return;
}

this.dataset.fallbackAplicado =
"1";

this.src =
FALLBACK_IMAGE;

};

miniatura.appendChild(
img
);

if (indice === 0) {

miniatura.classList.add(
"active"
);

}

miniatura.addEventListener(
"click",
() => {

principal.src =
imagem;

principal.alt =
`${localAtual?.nome || "Local"} — Foto ${indice + 1}`;

miniaturas
.querySelectorAll(
".thumbnail"
)
.forEach(
item => {

item.classList.remove(
"active"
);

}
);

miniatura.classList.add(
"active"
);

abrirVisualizador(
indice
);

});

miniaturas.appendChild(
miniatura
);

});

}

/* =========================================================
VISUALIZADOR
========================================================= */

function abrirVisualizador(
indice = 0
) {

const viewer =
document.getElementById(
"photoViewer"
);

const imagem =
document.getElementById(
"viewerImage"
);

if (
!viewer ||
!imagem ||
!imagensAtuais[indice]
) {
return;
}

imagem.src =
imagensAtuais[indice];

imagem.alt =
`${localAtual?.nome || "Local"} — foto ampliada`;

imagem.onerror =
function () {

if (this.dataset.fallbackAplicado) {
return;
}

this.dataset.fallbackAplicado =
"1";

this.src =
FALLBACK_IMAGE;

};

viewer.style.display =
"flex";

document.body.style.overflow =
"hidden";

}

function fecharVisualizador() {

const viewer =
document.getElementById(
"photoViewer"
);

if (viewer) {

viewer.style.display =
"none";

}

document.body.style.overflow =
"";

}

function abrirFotoTelaCheia(
indice = 0
) {

abrirVisualizador(
indice
);

}

function fecharFotoTelaCheia() {

fecharVisualizador();

}

/* =========================================================
VOLTAR
========================================================= */

function voltarPagina() {

if (
window.history.length > 1
) {

window.history.back();

return;

}

window.location.href =
"../index.html";

}

/* =========================================================
MAPA ESRI
========================================================= */

function inicializarMapa() {

const elemento =
document.getElementById(
"localMap"
);

if (!elemento) {
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

const latitude =
Number(
localAtual?.latitude
);

const longitude =
Number(
localAtual?.longitude
);

if (
!Number.isFinite(latitude) ||
!Number.isFinite(longitude)
) {

elemento.style.display =
"none";

return;

}

if (mapaLocal) {

mapaLocal.remove();

mapaLocal =
null;

}

elemento.style.width =
"100%";

mapaLocal =
L.map(
elemento,
{
zoomControl:
true,

scrollWheelZoom:
true,

attributionControl:
true
}
)
.setView(
[
latitude,
longitude
],
17
);

const camadaEsri =
L.tileLayer(
"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
{
maxNativeZoom:
19,

maxZoom:
22,

tileSize:
256,

attribution:
"Tiles © Esri"
}
);

camadaEsri.addTo(
mapaLocal
);

const marcador =
L.marker(
[
latitude,
longitude
]
)
.addTo(
mapaLocal
);

marcador.bindPopup(
`<strong>${escaparHTML(localAtual.nome || "")}</strong>`
);

const comoChegar =
document.getElementById(
"comoChegar"
);

if (comoChegar) {

comoChegar.href =
`https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;

comoChegar.target =
"_blank";

comoChegar.rel =
"noopener noreferrer";

}

requestAnimationFrame(
() => {

if (mapaLocal) {

mapaLocal.invalidateSize(
true
);

}

}
);

setTimeout(
() => {

if (mapaLocal) {

mapaLocal.invalidateSize(
true
);

}

},
300
);

setTimeout(
() => {

if (mapaLocal) {

mapaLocal.invalidateSize(
true
);

}

},
800
);

}

/* =========================================================
USUÁRIO AUTENTICADO
========================================================= */

async function obterUsuarioAutenticadoLocal() {

try {

if (
window.usuarioAtualSupabase
) {

return window.usuarioAtualSupabase;

}

const supabase =
obterSupabaseClient();

if (!supabase) {
return null;
}

const resultado =
await supabase.auth.getUser();

if (
resultado.error ||
!resultado.data ||
!resultado.data.user
) {

return null;

}

return resultado.data.user;

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
document.createElement(
"div"
);

area.id =
"areaExcluirComercio";

area.style.display =
"none";

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

pagina.appendChild(
area
);

} else {

document.body.appendChild(
area
);

}

}

return area;

}

/* =========================================================
CRIAR BOTÕES DO PROPRIETÁRIO
========================================================= */

function criarBotoesProprietario() {

const area =
obterAreaBotoesComercio();

if (!area) {
return;
}

area.innerHTML =
"";

const titulo =
document.createElement(
"div"
);

titulo.className =
"gerenciar-comercio-titulo";

titulo.textContent =
"Gerenciar meu comércio";

const botoes =
document.createElement(
"div"
);

botoes.className =
"gerenciar-comercio-botoes";

const editar =
document.createElement(
"button"
);

editar.type =
"button";

editar.id =
"botaoEditarComercio";

editar.className =
"botao-editar-perfil";

editar.textContent =
"Editar meu comércio";

editar.addEventListener(
"click",
editarMeuComercio
);

const excluir =
document.createElement(
"button"
);

excluir.type =
"button";

excluir.id =
"botaoExcluirComercio";

excluir.className =
"botao-excluir-perfil";

excluir.textContent =
"Excluir meu comércio";

excluir.addEventListener(
"click",
excluirMeuComercio
);

botoes.appendChild(
editar
);

botoes.appendChild(
excluir
);

area.appendChild(
titulo
);

area.appendChild(
botoes
);

area.style.display =
"block";

}

function esconderBotoesProprietario() {

const area =
document.getElementById(
"areaExcluirComercio"
);

if (area) {

area.innerHTML =
"";

area.style.display =
"none";

}

}

/* =========================================================
VERIFICAR PROPRIETÁRIO
========================================================= */

async function verificarProprietarioComercio() {

if (!localAtual) {
return;
}

if (
!pareceComercio(
localAtual
)
) {

esconderBotoesProprietario();

return;

}

if (
verificacaoProprietarioEmAndamento
) {

return;

}

verificacaoProprietarioEmAndamento =
true;

try {

const usuario =
await obterUsuarioAutenticadoLocal();

console.log(
"Usuário logado:",
usuario
? usuario.id
: null
);

if (!usuario) {

esconderBotoesProprietario();

usuarioProprietarioVerificado =
null;

return;

}

const supabase =
obterSupabaseClient();

if (!supabase) {

esconderBotoesProprietario();

return;

}

const resposta =
await supabase
.from(
"cadastros_comercios"
)
.select("*")
.eq(
"usuario_id",
usuario.id
);

if (resposta.error) {

console.error(
"Erro ao buscar cadastros do usuário:",
resposta.error
);

esconderBotoesProprietario();

return;

}

const cadastros =
resposta.data || [];

console.log(
"Cadastros do usuário encontrados:",
cadastros
);

const idAtual =
String(
localAtual.id || ""
);

const nomeAtual =
normalizarTexto(
localAtual.nome
);

const cadastroEncontrado =
cadastros.find(
cadastro => {

const localId =
String(
cadastro.local_id ||
""
);

const cadastroId =
String(
cadastro.id ||
""
);

const nomeCadastro =
normalizarTexto(
cadastro.nome
);

return (
localId === idAtual ||
cadastroId === idAtual ||
(
nomeAtual &&
nomeCadastro &&
nomeAtual ===
nomeCadastro
)
);

}
);

if (cadastroEncontrado) {

localAtual._cadastroSupabase =
cadastroEncontrado;

console.log(
"Cadastro do proprietário encontrado:",
cadastroEncontrado
);

criarBotoesProprietario();

usuarioProprietarioVerificado =
usuario.id;

return;

}

console.log(
"Nenhum cadastro do usuário encontrado para este comércio."
);

esconderBotoesProprietario();

usuarioProprietarioVerificado =
null;

} catch (erro) {

console.error(
"Erro ao verificar proprietário:",
erro
);

esconderBotoesProprietario();

} finally {

verificacaoProprietarioEmAndamento =
false;

}

}

/* =========================================================
TOKEN
========================================================= */

async function obterTokenSupabase() {

try {

const supabase =
obterSupabaseClient();

if (!supabase) {
return null;
}

const resposta =
await supabase.auth.getSession();

if (
resposta.error ||
!resposta.data ||
!resposta.data.session
) {

return null;

}

return (
resposta.data.session.access_token
);

} catch (erro) {

console.error(
"Erro ao obter token:",
erro
);

return null;

}

}

/* =========================================================
PREENCHER IMAGENS DO EDITOR
========================================================= */

function preencherImagensEditor() {

const container =
document.getElementById(
"editarImagensAtuais"
);

if (!container) {
return;
}

container.innerHTML =
"";

const imagens =
obterImagensLocal();

if (!imagens.length) {
return;
}

const titulo =
document.createElement(
"span"
);

titulo.className =
"editar-imagens-titulo";

titulo.textContent =
"Fotos atuais";

container.appendChild(
titulo
);

const galeria =
document.createElement(
"div"
);

galeria.className =
"editar-imagens-preview";

imagens
.slice(
0,
4
)
.forEach(
imagem => {

const img =
document.createElement(
"img"
);

img.src =
imagem;

img.alt =
"Foto atual";

img.onerror =
function () {

this.src =
FALLBACK_IMAGE;

};

galeria.appendChild(
img
);

});

container.appendChild(
galeria
);

}

/* =========================================================
EDITAR MEU COMÉRCIO
========================================================= */

function editarMeuComercio() {

if (!localAtual) {
return;
}

const usuario =
window.usuarioAtualSupabase;

if (!usuario) {

abrirLoginSeNecessario();

return;

}

const cadastro =
localAtual._cadastroSupabase;

if (!cadastro) {

console.error(
"Não foi possível identificar o cadastro deste comércio."
);

return;

}

const modal =
document.getElementById(
"modalEditarComercio"
);

if (!modal) {

console.error(
"Modal de edição não encontrado no local.html."
);

return;

}

const campos = {

nome:
"editarNome",

categoria:
"editarCategoria",

whatsapp:
"editarWhatsapp",

instagram:
"editarInstagram",

endereco:
"editarEndereco",

horario:
"editarHorario",

descricao:
"editarDescricao",

latitude:
"editarLatitude",

longitude:
"editarLongitude"

};

Object.entries(
campos
).forEach(
(
[
chave,
id
]
) => {

const campo =
document.getElementById(
id
);

if (!campo) {
return;
}

campo.value =
localAtual[chave] ??
cadastro[chave] ??
"";

}
);

preencherImagensEditor();

const mensagem =
document.getElementById(
"mensagemEditarComercio"
);

if (mensagem) {

mensagem.textContent =
"";

}

modal.style.display =
"flex";

modal.setAttribute(
"aria-hidden",
"false"
);

document.body.classList.add(
"modal-edicao-aberto"
);

const primeiroCampo =
document.getElementById(
"editarNome"
);

if (primeiroCampo) {

setTimeout(
() => {

primeiroCampo.focus();

},
50
);

}

}

/* =========================================================
FECHAR EDITOR
========================================================= */

function fecharEditorComercio() {

const modal =
document.getElementById(
"modalEditarComercio"
);

if (!modal) {
return;
}

modal.style.display =
"none";

modal.setAttribute(
"aria-hidden",
"true"
);

document.body.classList.remove(
"modal-edicao-aberto"
);

}

/* =========================================================
ABRIR LOGIN
========================================================= */

function abrirLoginSeNecessario() {

if (
typeof window.abrirModalAuth ===
"function"
) {

window.abrirModalAuth(
"login"
);

return;

}

const modal =
document.getElementById(
"authModal"
);

if (modal) {

modal.style.display =
"flex";

}

}

/* =========================================================
MENSAGEM DO EDITOR
========================================================= */

function mostrarMensagemEdicao(
mensagem,
tipo = ""
) {

const elemento =
document.getElementById(
"mensagemEditarComercio"
);

if (!elemento) {
return;
}

elemento.textContent =
mensagem;

elemento.className =
"mensagem-editar-comercio";

if (tipo) {

elemento.classList.add(
tipo
);

}

}

/* =========================================================
SALVAR EDIÇÃO
========================================================= */

async function salvarEdicaoComercio() {

if (!localAtual) {
return;
}

const cadastro =
localAtual._cadastroSupabase;

if (!cadastro) {
return;
}

const token =
await obterTokenSupabase();

if (!token) {

mostrarMensagemEdicao(
"Faça login novamente para continuar.",
"erro"
);

return;

}

const obterValor =
id => {

const campo =
document.getElementById(
id
);

return campo
? campo.value.trim()
: "";

};

const dadosComercio = {

nome:
obterValor(
"editarNome"
),

categoria:
obterValor(
"editarCategoria"
),

whatsapp:
obterValor(
"editarWhatsapp"
),

instagram:
obterValor(
"editarInstagram"
),

endereco:
obterValor(
"editarEndereco"
),

horario:
obterValor(
"editarHorario"
),

descricao:
obterValor(
"editarDescricao"
),

latitude:
obterValor(
"editarLatitude"
) || null,

longitude:
obterValor(
"editarLongitude"
) || null,

imagem:
localAtual.imagem ||
null,

imagens:
Array.isArray(
localAtual.imagens
)
? localAtual.imagens
: []

};

const botaoSalvar =
document.getElementById(
"salvarEdicaoComercio"
);

if (botaoSalvar) {

botaoSalvar.disabled =
true;

botaoSalvar.textContent =
"Salvando...";

}

mostrarMensagemEdicao(
"Salvando alterações..."
);

try {

const resposta =
await fetch(
EDGE_FUNCTION_URL,
{
method:
"POST",

headers: {

"Content-Type":
"application/json",

"Authorization":
`Bearer ${token}`

},

body:
JSON.stringify({

acao:
"editar_meu_comercio",

comercio_id:
cadastro.id,

comercio:
dadosComercio

})

}
);

const resultado =
await resposta.json();

if (!resposta.ok) {

console.error(
"Erro ao editar comércio:",
resultado
);

mostrarMensagemEdicao(
resultado?.erro ||
"Não foi possível salvar as alterações.",
"erro"
);

if (botaoSalvar) {

botaoSalvar.disabled =
false;

botaoSalvar.textContent =
"Salvar alterações";

}

return;

}

console.log(
"Comércio atualizado:",
resultado
);

mostrarMensagemEdicao(
"Alterações salvas com sucesso.",
"sucesso"
);

setTimeout(
() => {

fecharEditorComercio();

window.location.reload();

},
800
);

} catch (erro) {

console.error(
"Erro ao editar comércio:",
erro
);

mostrarMensagemEdicao(
"Erro de conexão. Tente novamente.",
"erro"
);

if (botaoSalvar) {

botaoSalvar.disabled =
false;

botaoSalvar.textContent =
"Salvar alterações";

}

}

}

/* =========================================================
EXCLUIR MEU COMÉRCIO
========================================================= */

async function excluirMeuComercio() {

if (!localAtual) {
return;
}

const usuario =
await obterUsuarioAutenticadoLocal();

if (!usuario) {

abrirLoginSeNecessario();

return;

}

const cadastro =
localAtual._cadastroSupabase;

if (!cadastro) {

console.error(
"Não foi possível identificar o cadastro deste comércio."
);

return;

}

const confirmacao =
confirm(
`Tem certeza que deseja excluir "${localAtual.nome}"?\n\nO comércio será removido do Guia Turístico.`
);

if (!confirmacao) {
return;
}

try {

const token =
await obterTokenSupabase();

if (!token) {
return;
}

const resposta =
await fetch(
EDGE_FUNCTION_URL,
{
method:
"POST",

headers: {

"Content-Type":
"application/json",

"Authorization":
`Bearer ${token}`

},

body:
JSON.stringify({

acao:
"excluir_meu_comercio",

comercio_id:
cadastro.id

})

}
);

const resultado =
await resposta.json();

if (!resposta.ok) {

console.error(
"Erro ao excluir comércio:",
resultado
);

return;

}

window.location.href =
"../index.html";

} catch (erro) {

console.error(
"Erro ao excluir comércio:",
erro
);

}

}

/* =========================================================
SUGERIR ALTERAÇÃO
========================================================= */

function sugerirAlteracao() {

if (!localAtual) {
return;
}

const assunto =
encodeURIComponent(
`Sugestão de alteração — ${localAtual.nome || ""}`
);

const corpo =
encodeURIComponent(
`Olá!\n\nGostaria de sugerir uma alteração no cadastro de "${localAtual.nome || ""}" no Guia Turístico de Andrelândia.\n\nSugestão:\n`
);

window.location.href =
`mailto:pedrinhossiqueira12@gmail.com?subject=${assunto}&body=${corpo}`;

}

/* =========================================================
CARREGAR AVALIAÇÕES
========================================================= */

async function carregarAvaliacoes() {

const supabase =
obterSupabaseClient();

if (
!supabase ||
!localAtual
) {
return;
}

try {

const resposta =
await supabase
.from(
"avaliacoes"
)
.select("*")
.eq(
"local_id",
localAtual.id
)
.order(
"criado_em",
{
ascending:
false
}
);

if (resposta.error) {

console.error(
"Erro ao carregar avaliações:",
resposta.error
);

return;

}

const avaliacoes =
resposta.data || [];

atualizarResumoAvaliacoes(
avaliacoes
);

renderizarComentarios(
avaliacoes
);

} catch (erro) {

console.error(
"Erro ao carregar avaliações:",
erro
);

}

}

/* =========================================================
CRIAR ESTRELA EM HTML
========================================================= */

function criarEstrelaHTML(
ativa = false,
tamanho = ""
) {

return `
<img
class="estrela-avaliacao ${tamanho}"
src="${ativa ? ESTRELA_ATIVADA : ESTRELA_DESATIVADA}"
alt=""




`;

}

/* =========================================================
ESTRELAS PARA MÉDIA / COMENTÁRIOS
========================================================= */

function gerarEstrelas(
nota,
classe = ""
) {

const valor =
Number(nota) || 0;

const arredondada =
Math.round(
valor
);

let resultado =
"";

for (
let i = 1;
i <= 5;
i++
) {

resultado +=
criarEstrelaHTML(
i <= arredondada,
classe
);

}

return resultado;

}

/* =========================================================
RESUMO DAS AVALIAÇÕES
========================================================= */

function atualizarResumoAvaliacoes(
avaliacoes
) {

const quantidade =
avaliacoes.length;

const media =
quantidade
? avaliacoes.reduce(
(
total,
avaliacao
) =>
total +
Number(
avaliacao.nota ||
0
),
0
) / quantidade
: 0;

const mediaElemento =
document.getElementById(
"mediaAvaliacoes"
);

const estrelas =
document.getElementById(
"estrelasMedia"
);

const quantidadeElemento =
document.getElementById(
"quantidadeAvaliacoes"
);

if (mediaElemento) {

mediaElemento.textContent =
media.toFixed(1).replace(
".",
","
);

}

if (estrelas) {

estrelas.innerHTML =
gerarEstrelas(
media,
"media"
);

}

if (quantidadeElemento) {

quantidadeElemento.textContent =
quantidade === 0
? "Nenhuma avaliação"
: `${quantidade} ${ quantidade === 1 ? "avaliação" : "avaliações" }`;

}

}

/* =========================================================
COMENTÁRIOS
========================================================= */

function renderizarComentarios(
avaliacoes
) {

const lista =
document.getElementById(
"listaComentarios"
);

if (!lista) {
return;
}

lista.innerHTML =
"";

if (!avaliacoes.length) {

lista.innerHTML = `

<div class="empty-comments"> Ainda não há avaliações. <br> Seja o primeiro a avaliar! </div> `;

return;

}

avaliacoes.forEach(
avaliacao => {

const item =
document.createElement(
"article"
);

item.className =
"comentario-item";

const cabecalho =
document.createElement(
"div"
);

cabecalho.className =
"comentario-cabecalho";

const usuario =
document.createElement(
"div"
);

usuario.className =
"comentario-usuario";

usuario.textContent =
avaliacao.nome_usuario ||
"Usuário";

const estrelas =
document.createElement(
"div"
);

estrelas.className =
"comentario-estrelas";

estrelas.innerHTML =
gerarEstrelas(
Number(
avaliacao.nota ||
0
),
"comentario"
);

cabecalho.appendChild(
usuario
);

cabecalho.appendChild(
estrelas
);

const texto =
document.createElement(
"p"
);

texto.className =
"comentario-texto";

texto.textContent =
avaliacao.comentario ||
"";

item.appendChild(
cabecalho
);

item.appendChild(
texto
);

if (avaliacao.criado_em) {

const data =
document.createElement(
"time"
);

data.className =
"comentario-data";

const dataObjeto =
new Date(
avaliacao.criado_em
);

if (
!Number.isNaN(
dataObjeto.getTime()
)
) {

data.textContent =
dataObjeto.toLocaleDateString(
"pt-BR"
);

}

item.appendChild(
data
);

}

lista.appendChild(
item
);

});

}

/* =========================================================
VERIFICAR AVALIAÇÃO DO USUÁRIO
========================================================= */

async function verificarAvaliacaoUsuario() {

const supabase =
obterSupabaseClient();

if (
!supabase ||
!localAtual
) {
return;
}

try {

const usuario =
await obterUsuarioAutenticadoLocal();

const areaAuth =
document.getElementById(
"areaAutenticacao"
);

const areaAvaliacao =
document.getElementById(
"areaAvaliacao"
);

const mensagemAuth =
document.getElementById(
"mensagemAutenticacao"
);

if (!usuario) {

if (areaAuth) {

areaAuth.style.display =
"";

}

if (areaAvaliacao) {

areaAvaliacao.style.display =
"none";

}

if (mensagemAuth) {

mensagemAuth.textContent =
"Entre ou crie uma conta para avaliar este local.";

}

avaliacaoAtual =
null;

notaSelecionada =
0;

notaHover =
0;

atualizarSeletorEstrelas();

return;

}

if (areaAuth) {

areaAuth.style.display =
"none";

}

if (areaAvaliacao) {

areaAvaliacao.style.display =
"";

}

const resposta =
await supabase
.from(
"avaliacoes"
)
.select("*")
.eq(
"local_id",
localAtual.id
)
.eq(
"usuario_id",
usuario.id
)
.maybeSingle();

if (resposta.error) {

console.error(
"Erro ao verificar avaliação:",
resposta.error
);

return;

}

avaliacaoAtual =
resposta.data ||
null;

const nomeUsuario =
document.getElementById(
"nomeUsuarioLogado"
);

if (nomeUsuario) {

nomeUsuario.textContent =
usuario.user_metadata?.nome ||
usuario.email ||
"Usuário";

}

const comentario =
document.getElementById(
"textoComentario"
);

if (avaliacaoAtual) {

notaSelecionada =
Number(
avaliacaoAtual.nota
) || 0;

notaHover =
0;

if (comentario) {

comentario.value =
avaliacaoAtual.comentario ||
"";

}

} else {

notaSelecionada =
0;

notaHover =
0;

if (comentario) {

comentario.value =
"";

}

}

atualizarSeletorEstrelas();

} catch (erro) {

console.error(
"Erro ao verificar avaliação:",
erro
);

}

}

/* =========================================================
ATUALIZAR ESTRELAS DO FORMULÁRIO
========================================================= */

function atualizarSeletorEstrelas(
valorVisual = null
) {

const botoes =
document.querySelectorAll(
"#seletorEstrelas .star-button"
);

const notaVisual =
valorVisual !== null
? Number(valorVisual)
: (
notaHover > 0
? notaHover
: notaSelecionada
);

botoes.forEach(
(
botao,
indice
) => {

const valor =
indice + 1;

const imagem =
botao.querySelector(
"img"
);

const ativa =
valor <= notaVisual;

botao.classList.toggle(
"selecionada",
ativa
);

if (imagem) {

imagem.src =
ativa
? ESTRELA_ATIVADA
: ESTRELA_DESATIVADA;

}

});

}

/* =========================================================
SELECIONAR NOTA
========================================================= */

function selecionarNota(
nota
) {

notaSelecionada =
Number(nota);

notaHover =
0;

atualizarSeletorEstrelas();

}

/* =========================================================
PUBLICAR AVALIAÇÃO
========================================================= */

async function publicarAvaliacao() {

const supabase =
obterSupabaseClient();

if (
!supabase ||
!localAtual
) {
return;
}

const usuario =
await obterUsuarioAutenticadoLocal();

if (!usuario) {

abrirLoginSeNecessario();

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

const campoComentario =
document.getElementById(
"textoComentario"
);

const comentario =
campoComentario
? campoComentario.value.trim()
: "";

if (!comentario) {

alert(
"Escreva um comentário antes de publicar."
);

return;

}

if (
comentario.length > 500
) {

alert(
"O comentário pode ter no máximo 500 caracteres."
);

return;

}

try {

const botao =
document.getElementById(
"publicarComentario"
);

if (botao) {

botao.disabled =
true;

botao.textContent =
"Publicando...";

}

/* ===================================================
ATUALIZAR
=================================================== */

if (avaliacaoAtual) {

const resposta =
await supabase
.from(
"avaliacoes"
)
.update({

nota:
notaSelecionada,

comentario:
comentario

})
.eq(
"id",
avaliacaoAtual.id
)
.eq(
"usuario_id",
usuario.id
);

if (resposta.error) {

throw resposta.error;

}

} else {

/* ===================================================
CRIAR
=================================================== */

const resposta =
await supabase
.from(
"avaliacoes"
)
.insert({

local_id:
localAtual.id,

usuario_id:
usuario.id,

nome_usuario:
usuario.user_metadata?.nome ||
usuario.email ||
"Usuário",

nota:
notaSelecionada,

comentario:
comentario

});

if (resposta.error) {

throw resposta.error;

}

}

await carregarAvaliacoes();

await verificarAvaliacaoUsuario();

if (botao) {

botao.disabled =
false;

botao.textContent =
avaliacaoAtual
? "Atualizar avaliação"
: "Publicar avaliação";

}

} catch (erro) {

console.error(
"Erro ao publicar avaliação:",
erro
);

alert(
"Não foi possível publicar a avaliação. Tente novamente."
);

const botao =
document.getElementById(
"publicarComentario"
);

if (botao) {

botao.disabled =
false;

botao.textContent =
"Publicar avaliação";

}

}

}

/* =========================================================
SAIR
========================================================= */

async function sairUsuarioLocal() {

const supabase =
obterSupabaseClient();

if (!supabase) {
return;
}

try {

await supabase.auth.signOut();

window.location.reload();

} catch (erro) {

console.error(
"Erro ao sair:",
erro
);

}

}

/* =========================================================
INICIALIZAR ESTRELAS
========================================================= */

function inicializarEstrelas() {

const botoesEstrelas =
document.querySelectorAll(
"#seletorEstrelas .star-button"
);

botoesEstrelas.forEach(
(
botao,
indice
) => {

const nota =
indice + 1;

botao.addEventListener(
"mouseenter",
() => {

notaHover =
nota;

atualizarSeletorEstrelas();

}
);

botao.addEventListener(
"mouseleave",
() => {

notaHover =
0;

atualizarSeletorEstrelas();

}
);

botao.addEventListener(
"click",
() => {

selecionarNota(
nota
);

}
);

});

}

/* =========================================================
DOM
========================================================= */

document.addEventListener(
"DOMContentLoaded",
() => {

/* =====================================================
PUBLICAR AVALIAÇÃO
===================================================== */

const publicar =
document.getElementById(
"publicarComentario"
);

if (publicar) {

publicar.onclick =
publicarAvaliacao;

}

/* =====================================================
SAIR
===================================================== */

const botaoSair =
document.getElementById(
"botaoSair"
);

if (botaoSair) {

botaoSair.onclick =
sairUsuarioLocal;

}

/* =====================================================
ESTRELAS
===================================================== */

inicializarEstrelas();

/* =====================================================
MODAL DE EDIÇÃO
===================================================== */

const fecharEdicao =
document.getElementById(
"fecharModalEditarComercio"
);

if (fecharEdicao) {

fecharEdicao.onclick =
fecharEditorComercio;

}

const cancelarEdicao =
document.getElementById(
"cancelarEdicaoComercio"
);

if (cancelarEdicao) {

cancelarEdicao.onclick =
fecharEditorComercio;

}

const formularioEdicao =
document.getElementById(
"formEditarComercio"
);

if (formularioEdicao) {

formularioEdicao.addEventListener(
"submit",
event => {

event.preventDefault();

salvarEdicaoComercio();

}
);

}

/* =====================================================
FECHAR MODAL CLICANDO FORA
===================================================== */

const modalEdicao =
document.getElementById(
"modalEditarComercio"
);

if (modalEdicao) {

modalEdicao.addEventListener(
"click",
event => {

if (
event.target ===
modalEdicao
) {

fecharEditorComercio();

}

});

}

/* =====================================================
ESC
===================================================== */

document.addEventListener(
"keydown",
event => {

if (
event.key ===
"Escape"
) {

fecharVisualizador();

fecharEditorComercio();

}

});

/* =====================================================
CARREGAR
===================================================== */

carregarLocal();

});

/* =========================================================
MONITORAR LOGIN
========================================================= */

setTimeout(
() => {

const supabase =
obterSupabaseClient();

if (!supabase) {
return;
}

supabase.auth.onAuthStateChange(
async (
evento,
sessao
) => {

const novoUsuario =
sessao?.user?.id ||
null;

if (
novoUsuario ===
usuarioProprietarioVerificado
) {

await verificarAvaliacaoUsuario();

return;

}

usuarioProprietarioVerificado =
novoUsuario;

await verificarAvaliacaoUsuario();

await carregarAvaliacoes();

await verificarProprietarioComercio();

});

setTimeout(
async () => {

await verificarAvaliacaoUsuario();

await verificarProprietarioComercio();

},
300
);

},
500
);
