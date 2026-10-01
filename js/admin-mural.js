/* =========================================================
ANDRELÂNDIA — GUIA TURÍSTICO
ADMIN-MURAL.JS

RESPONSABILIDADES:

Verificação do administrador
Listagem de cadastros pendentes do Mural
Edição de perfis
Gerenciamento das imagens
Aprovação
Rejeição
Listagem dos perfis publicados
Exclusão de perfis publicados
Comunicação com a Edge Function administrativa

IMPORTANTE:

O ID público do perfil nunca é recriado durante edição.

A aprovação deve preservar o mesmo ID utilizado em
votos_pessoas.pessoa_id.

A exclusão de um perfil publicado também é feita pela
Edge Function para que o arquivo DATA/pessoas.json e
os dados relacionados sejam tratados no servidor.
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

const ADMIN_USER_ID =
"4b9a0233-6b72-4573-aebd-d596c5b15e1b";

const STORAGE_BUCKET =
"mural";

const LIMITE_IMAGENS =
4;

const TAMANHO_MAXIMO_IMAGEM =
5 * 1024 * 1024;

/* =========================================================
SUPABASE
========================================================= */

const supabaseClient =
window.supabase.createClient(
SUPABASE_URL,
SUPABASE_ANON_KEY
);

/* =========================================================
ESTADO
========================================================= */

let cadastrosMural = [];

let muralPublicados = [];

let pesquisaMuralAdmin = "";

let muralEditandoId = null;

let imagensMuralEditando = [];

/* =========================================================
ELEMENTOS
========================================================= */

const carregando =
document.getElementById("carregando");

const listaMural =
document.getElementById("lista-mural");

const semMural =
document.getElementById("sem-mural");

const mensagem =
document.getElementById("mensagem");

const botaoAtualizar =
document.getElementById("botao-atualizar");

const botaoSair =
document.getElementById("botao-sair");

/* Editor */

const editorMural =
document.getElementById("editor-mural-admin");

const editorFechar =
document.getElementById("editor-mural-fechar");

const editorCancelar =
document.getElementById("editor-mural-cancelar");

const editorSalvar =
document.getElementById("editor-mural-salvar");

const editorAprovar =
document.getElementById("editor-mural-aprovar");

const editorRejeitar =
document.getElementById("editor-mural-rejeitar");

const formEditor =
document.getElementById("form-editor-mural");

const editorId =
document.getElementById("editor-mural-id");

const editorNome =
document.getElementById("editor-mural-nome");

const editorCategoria =
document.getElementById("editor-mural-categoria");

const editorInstagram =
document.getElementById("editor-mural-instagram");

const editorDescricao =
document.getElementById("editor-mural-descricao");

const editorSobre =
document.getElementById("editor-mural-sobre");

const editorStatus =
document.getElementById("editor-mural-status");

const editorUsuario =
document.getElementById("editor-mural-usuario");

const editorCriado =
document.getElementById("editor-mural-criado");

const editorAtualizado =
document.getElementById("editor-mural-atualizado");

const editorMotivoRecusa =
document.getElementById("editor-mural-motivo-recusa");

const editorImagensJson =
document.getElementById("editor-mural-imagens-json");

const editorImagemArquivo =
document.getElementById("editor-mural-imagem-arquivo");

const editorImagensLista =
document.getElementById("editor-mural-imagens-lista");

const editorContadorImagens =
document.getElementById("editor-mural-contador-imagens");

const editorBotaoImagem =
document.getElementById("editor-mural-botao-imagem");

const editorRecusaBloco =
document.getElementById("editor-mural-recusa-bloco");

/* Publicados */

const pesquisaPublicados =
document.getElementById("pesquisa-mural-admin");

const carregandoPublicados =
document.getElementById("carregandoMuralPublicados");

const semPublicados =
document.getElementById("semMuralPublicados");

const listaPublicados =
document.getElementById("listaMuralPublicados");

const contadorPublicados =
document.getElementById("contadorMuralPublicados");

/* =========================================================
UTILITÁRIOS
========================================================= */

function mostrarMensagem(
texto,
tipo = "sucesso"
) {

if (!mensagem) {
return;
}

mensagem.textContent =
texto;

mensagem.className =
`mensagem ${tipo}`;

mensagem.hidden =
false;

window.scrollTo({
top: 0,
behavior: "smooth"
});

}

function esconderMensagem() {

if (!mensagem) {
return;
}

mensagem.hidden =
true;

mensagem.textContent =
"";

}

function normalizarTexto(valor) {

if (
valor === null ||
valor === undefined
) {

return "";

}

return String(valor)
.normalize("NFD")
.replace(/[\u0300-\u036f]/g, "")
.toLowerCase()
.trim();

}

function escaparHTML(valor) {

return String(
valor === null ||
valor === undefined
? ""
: valor
)
.replace(/&/g, "&amp;")
.replace(/</g, "&lt;")
.replace(/>/g, "&gt;")
.replace(/"/g, '&quot;')
.replace(/'/g, "&#039;");

}

function formatarData(valor) {

if (!valor) {
return "—";
}

const data =
new Date(valor);

if (
Number.isNaN(
data.getTime()
)
) {

return valor;

}

return data.toLocaleString(
"pt-BR",
{
dateStyle: "short",
timeStyle: "short"
}
);

}

function gerarAleatorio() {

return Math.random()
.toString(36)
.substring(2, 10);

}

function obterNomeArquivoSeguro(nome) {

return String(nome || "imagem")
.normalize("NFD")
.replace(/[\u0300-\u036f]/g, "")
.replace(/[^a-zA-Z0-9._-]/g, "-")
.replace(/-+/g, "-")
.toLowerCase();

}

/* =========================================================
IMAGENS
========================================================= */

function obterImagensCadastro(cadastro) {

let imagens = [];

if (
cadastro &&
Array.isArray(cadastro.imagens)
) {

imagens =
cadastro.imagens.filter(
imagem =>
typeof imagem === "string" &&
imagem.trim() !== ""
);

}

/*
Compatibilidade caso a tabela utilize
uma imagem principal separada.
*/

if (
cadastro &&
cadastro.imagem &&
typeof cadastro.imagem === "string" &&
cadastro.imagem.trim() !== ""
) {

if (
!imagens.includes(
cadastro.imagem
)
) {

imagens.unshift(
cadastro.imagem
);

}

}

if (
cadastro &&
cadastro.imagem_url &&
typeof cadastro.imagem_url === "string" &&
cadastro.imagem_url.trim() !== ""
) {

if (
!imagens.includes(
cadastro.imagem_url
)
) {

imagens.unshift(
cadastro.imagem_url
);

}

}

return imagens.slice(
0,
LIMITE_IMAGENS
);

}

function atualizarEstadoImagens() {

imagensMuralEditando =
Array.isArray(imagensMuralEditando)
? imagensMuralEditando.slice(
0,
LIMITE_IMAGENS
)
: [];

if (editorImagensJson) {

editorImagensJson.value =
JSON.stringify(
imagensMuralEditando
);

}

if (editorContadorImagens) {

editorContadorImagens.textContent =
`${imagensMuralEditando.length}/${LIMITE_IMAGENS}`;

}

if (editorBotaoImagem) {

const bloqueado =
imagensMuralEditando.length >=
LIMITE_IMAGENS;

editorBotaoImagem.classList.toggle(
"editor-imagem-desativado",
bloqueado
);

editorBotaoImagem.setAttribute(
"aria-disabled",
bloqueado
? "true"
: "false"
);

}

}

function renderizarImagensEditor() {

if (!editorImagensLista) {
return;
}

editorImagensLista.innerHTML =
"";

imagensMuralEditando.forEach(
(imagem, index) => {

const item =
document.createElement("div");

item.className =
"editor-imagem-item";

const img =
document.createElement("img");

img.className =
"editor-imagem-preview";

img.src =
imagem;

img.alt =
`Imagem ${index + 1} do perfil`;

img.loading =
"lazy";

img.onerror = () => {

img.style.display =
"none";

};

if (index === 0) {

const capa =
document.createElement("span");

capa.className =
"editor-imagem-principal";

capa.textContent =
"Capa";

item.appendChild(
capa
);

}

const numero =
document.createElement("span");

numero.className =
"editor-imagem-numero";

numero.textContent =
`${index + 1}`;

item.appendChild(
img
);

item.appendChild(
numero
);

const remover =
document.createElement("button");

remover.type =
"button";

remover.className =
"editor-imagem-remover";

remover.setAttribute(
"aria-label",
`Remover imagem ${index + 1}`
);

remover.innerHTML =
"×";

remover.addEventListener(
"click",
() => {

imagensMuralEditando.splice(
index,
1
);

atualizarEstadoImagens();

renderizarImagensEditor();

}
);

item.appendChild(
remover
);

editorImagensLista.appendChild(
item
);

}
);

atualizarEstadoImagens();

}

async function fazerUploadImagem(
arquivo,
usuarioId
) {

if (!arquivo) {

throw new Error(
"Nenhuma imagem foi selecionada."
);

}

if (
arquivo.size >
TAMANHO_MAXIMO_IMAGEM
) {

throw new Error(
`A imagem "${arquivo.name}" ultrapassa o limite de 5 MB.`
);

}

const tiposPermitidos = [
"image/jpeg",
"image/png",
"image/webp"
];

if (
!tiposPermitidos.includes(
arquivo.type
)
) {

throw new Error(
`O arquivo "${arquivo.name}" não é JPG, PNG ou WEBP.`
);

}

const nomeBase =
obterNomeArquivoSeguro(
arquivo.name
);

const partes =
nomeBase.split(".");

const extensao =
partes.length > 1
? partes.pop()
: "jpg";

const nomeSemExtensao =
partes.join(".") ||
"imagem";

const caminho =
`admin/${usuarioId}/${Date.now()}-${gerarAleatorio()}-${nomeSemExtensao}.${extensao}`;

const {
error
} =
await supabaseClient
.storage
.from(STORAGE_BUCKET)
.upload(
caminho,
arquivo,
{
cacheControl: "3600",
upsert: false,
contentType:
arquivo.type
}
);

if (error) {

throw error;

}

const {
data
} =
supabaseClient
.storage
.from(STORAGE_BUCKET)
.getPublicUrl(
caminho
);

return data.publicUrl;

}

/* =========================================================
SELEÇÃO DE IMAGENS
========================================================= */

async function processarArquivosSelecionados(
arquivos
) {

if (!arquivos || !arquivos.length) {
return;
}

if (
imagensMuralEditando.length >=
LIMITE_IMAGENS
) {

mostrarMensagem(
"O perfil já possui 4 imagens.",
"erro"
);

return;

}

let usuarioId =
null;

const {
data: {
user
}
} =
await supabaseClient.auth.getUser();

if (!user) {

mostrarMensagem(
"Sua sessão expirou.",
"erro"
);

return;

}

usuarioId =
user.id;

const disponiveis =
LIMITE_IMAGENS -
imagensMuralEditando.length;

const arquivosProcessar =
Array.from(arquivos)
.slice(
0,
disponiveis
);

if (
arquivos.length >
disponiveis
) {

mostrarMensagem(
`Só é possível adicionar mais ${disponiveis} imagem(ns).`,
"erro"
);

}

editorImagemArquivo.disabled =
true;

if (editorBotaoImagem) {

editorBotaoImagem.style.opacity =
"0.5";

}

try {

for (
const arquivo of arquivosProcessar
) {

mostrarMensagem(
`Enviando imagem ${imagensMuralEditando.length + 1} de ${LIMITE_IMAGENS}...`,
"sucesso"
);

const url =
await fazerUploadImagem(
arquivo,
usuarioId
);

imagensMuralEditando.push(
url
);

atualizarEstadoImagens();

renderizarImagensEditor();

}

mostrarMensagem(
"Imagens atualizadas no editor.",
"sucesso"
);

} catch (erro) {

console.error(
"Erro ao enviar imagem:",
erro
);

mostrarMensagem(
erro.message ||
"Não foi possível enviar a imagem.",
"erro"
);

} finally {

editorImagemArquivo.disabled =
false;

if (editorBotaoImagem) {

editorBotaoImagem.style.opacity =
"";

}

editorImagemArquivo.value =
"";

}

}

/* =========================================================
EDGE FUNCTION
========================================================= */

async function chamarEdgeFunction(
acao,
dados = {}
) {

const {
data: {
session
}
} =
await supabaseClient.auth.getSession();

if (!session) {

throw new Error(
"Sessão expirada. Faça login novamente."
);

}

const resposta =
await fetch(
EDGE_FUNCTION_URL,
{
method: "POST",

headers: {
"Authorization":
`Bearer ${session.access_token}`,

"apikey":
SUPABASE_ANON_KEY,

"Content-Type":
"application/json"
},

body:
JSON.stringify({
acao,
...dados
})
}
);

let resultado =
null;

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
`Erro HTTP ${resposta.status}.`
);

}

if (
resultado &&
resultado.erro
) {

throw new Error(
resultado.erro
);

}

if (
resultado &&
resultado.error
) {

throw new Error(
resultado.error
);

}

return resultado;

}

/* =========================================================
VERIFICAÇÃO DO ADMINISTRADOR
========================================================= */

async function verificarLogin() {

try {

const {
data: {
session
}
} =
await supabaseClient.auth.getSession();

if (!session) {

window.location.href =
"../index.html";

return false;

}

const usuario =
session.user;

if (
!usuario ||
usuario.id !== ADMIN_USER_ID
) {

alert(
"Acesso restrito ao administrador."
);

await supabaseClient.auth.signOut();

window.location.href =
"../index.html";

return false;

}

return true;

} catch (erro) {

console.error(
"Erro ao verificar administrador:",
erro
);

alert(
"Não foi possível verificar seu acesso."
);

window.location.href =
"../index.html";

return false;

}

}

/* =========================================================
CARREGAR CADASTROS PENDENTES
========================================================= */

async function carregarCadastrosMural() {

if (carregando) {

carregando.hidden =
false;

}

if (listaMural) {

listaMural.innerHTML =
"";

}

if (semMural) {

semMural.hidden =
true;

}

try {

const {
data,
error
} =
await supabaseClient
.from("mural_cadastros")
.select("*")
.eq(
"status",
"pendente"
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

cadastrosMural =
Array.isArray(data)
? data
: [];

renderizarCadastrosMural();

} catch (erro) {

console.error(
"Erro ao carregar cadastros do mural:",
erro
);

mostrarMensagem(
`Não foi possível carregar os cadastros do mural: ${erro.message}`,
"erro"
);

} finally {

if (carregando) {

carregando.hidden =
true;

}

}

}

/* =========================================================
RENDERIZAR PENDENTES
========================================================= */

function renderizarCadastrosMural() {

if (!listaMural) {
return;
}

listaMural.innerHTML =
"";

if (!cadastrosMural.length) {

if (semMural) {

semMural.hidden =
false;

}

return;

}

if (semMural) {

semMural.hidden =
true;

}

cadastrosMural.forEach(
cadastro => {

listaMural.appendChild(
criarCardMural(
cadastro,
true
)
);

}
);

}

/* =========================================================
CRIAR CARD
========================================================= */

function criarCardMural(
cadastro,
pendente = false
) {

const card =
document.createElement("article");

card.className =
"admin-mural-card";

/* Imagens */

const imagens =
obterImagensCadastro(
cadastro
);

const imagensDiv =
document.createElement("div");

imagensDiv.className =
"admin-mural-imagens";

if (imagens.length) {

imagens.forEach(
(url, index) => {

const div =
document.createElement("div");

div.className =
"admin-mural-imagem";

if (index === 0) {

div.classList.add(
"admin-mural-imagem-capa"
);

}

const img =
document.createElement("img");

img.src =
url;

img.alt =
cadastro.nome
? `${cadastro.nome} — imagem ${index + 1}`
: `Imagem ${index + 1}`;

img.loading =
"lazy";

div.appendChild(
img
);

imagensDiv.appendChild(
div
);

}
);

} else {

const div =
document.createElement("div");

div.className =
"admin-mural-imagem";

div.style.gridColumn =
"1 / -1";

div.style.display =
"flex";

div.style.alignItems =
"center";

div.style.justifyContent =
"center";

div.style.color =
"#6b6b6b";

div.textContent =
"Sem imagem";

imagensDiv.appendChild(
div
);

}

card.appendChild(
imagensDiv
);

/* Conteúdo */

const conteudo =
document.createElement("div");

conteudo.className =
"admin-mural-conteudo";

/* Status */

const status =
document.createElement("span");

status.className =
"admin-mural-status";

const statusAtual =
String(
cadastro.status ||
"pendente"
).toLowerCase();

if (
statusAtual ===
"aprovado"
) {

status.classList.add(
"admin-mural-status-aprovado"
);

status.textContent =
"Aprovado";

} else if (
statusAtual ===
"recusado"
) {

status.classList.add(
"admin-mural-status-recusado"
);

status.textContent =
"Recusado";

} else {

status.classList.add(
"admin-mural-status-pendente"
);

status.textContent =
"Pendente";

}

conteudo.appendChild(
status
);

/* Nome */

const titulo =
document.createElement("h3");

titulo.textContent =
cadastro.nome ||
"Sem nome";

conteudo.appendChild(
titulo
);

/* Categoria */

if (cadastro.categoria) {

const categoria =
document.createElement("div");

categoria.className =
"admin-mural-categoria";

categoria.textContent =
cadastro.categoria;

conteudo.appendChild(
categoria
);

}

/* Descrição */

if (cadastro.descricao) {

const descricao =
document.createElement("p");

descricao.className =
"admin-mural-descricao";

descricao.textContent =
cadastro.descricao;

conteudo.appendChild(
descricao
);

}

/* Metadados */

const metadados =
document.createElement("div");

metadados.className =
"admin-mural-metadados";

const idMeta =
document.createElement("div");

idMeta.className =
"admin-mural-metadado";

idMeta.innerHTML =
`<strong>ID:</strong> ${escaparHTML(cadastro.id || "—")}`;

metadados.appendChild(
idMeta
);

const usuarioMeta =
document.createElement("div");

usuarioMeta.className =
"admin-mural-metadado";

usuarioMeta.innerHTML =
`<strong>Usuário:</strong> ${escaparHTML(cadastro.usuario_id || "—")}`;

metadados.appendChild(
usuarioMeta
);

const dataMeta =
document.createElement("div");

dataMeta.className =
"admin-mural-metadado";

dataMeta.innerHTML =
`<strong>Enviado:</strong> ${escaparHTML(formatarData(cadastro.criado_em))}`;

metadados.appendChild(
dataMeta
);

const imagensMeta =
document.createElement("div");

imagensMeta.className =
"admin-mural-metadado";

imagensMeta.innerHTML =
`<strong>Imagens:</strong> ${imagens.length}/4`;

metadados.appendChild(
imagensMeta
);

if (
cadastro.instagram
) {

const instagramMeta =
document.createElement("div");

instagramMeta.className =
"admin-mural-metadado";

instagramMeta.innerHTML =
`<strong>Instagram:</strong> ${escaparHTML(cadastro.instagram)}`;

metadados.appendChild(
instagramMeta
);

}

conteudo.appendChild(
metadados
);

/* =========================================================
AÇÕES
========================================================= */

const acoes =
document.createElement("div");

acoes.className =
"admin-mural-acoes-card";

/* Editar */

const editar =
document.createElement("button");

editar.type =
"button";

editar.className =
"admin-mural-botao-editar";

editar.textContent =
"Editar";

editar.addEventListener(
"click",
() => {

abrirEditorMural(
cadastro
);

}
);

acoes.appendChild(
editar
);

/* Aprovar / Rejeitar */

if (pendente) {

const aprovar =
document.createElement("button");

aprovar.type =
"button";

aprovar.className =
"admin-mural-botao-aprovar";

aprovar.textContent =
"Aprovar";

aprovar.addEventListener(
"click",
() => {

aprovarCadastroMural(
cadastro,
aprovar
);

}
);

acoes.appendChild(
aprovar
);

const rejeitar =
document.createElement("button");

rejeitar.type =
"button";

rejeitar.className =
"admin-mural-botao-rejeitar";

rejeitar.textContent =
"Rejeitar";

rejeitar.addEventListener(
"click",
() => {

rejeitarCadastroMural(
cadastro,
rejeitar
);

}
);

acoes.appendChild(
rejeitar
);

}

conteudo.appendChild(
acoes
);

card.appendChild(
conteudo
);

return card;

}

/* =========================================================
EDITOR
========================================================= */

function abrirEditorMural(
cadastro
) {

if (!editorMural) {
return;
}

muralEditandoId =
cadastro.id;

imagensMuralEditando =
obterImagensCadastro(
cadastro
);

editorId.value =
cadastro.id || "";

editorNome.value =
cadastro.nome || "";

editorCategoria.value =
cadastro.categoria || "";

editorInstagram.value =
cadastro.instagram || "";

editorDescricao.value =
cadastro.descricao || "";

editorSobre.value =
cadastro.sobre || "";

editorStatus.value =
cadastro.status || "";

editorUsuario.value =
cadastro.usuario_id || "";

editorCriado.value =
formatarData(
cadastro.criado_em
);

editorAtualizado.value =
formatarData(
cadastro.atualizado_em
);

editorMotivoRecusa.value =
cadastro.motivo_recusa || "";

atualizarEstadoImagens();

renderizarImagensEditor();

atualizarBotoesEditor(
cadastro.status
);

editorMural.hidden =
false;

document.body.style.overflow =
"hidden";

}

function fecharEditorMural() {

if (!editorMural) {
return;
}

editorMural.hidden =
true;

document.body.style.overflow =
"";

muralEditandoId =
null;

imagensMuralEditando =
[];

if (editorImagemArquivo) {

editorImagemArquivo.value =
"";

}

}

function atualizarBotoesEditor(
status
) {

const statusAtual =
String(
status || ""
).toLowerCase();

const pendente =
statusAtual ===
"pendente";

if (editorAprovar) {

editorAprovar.style.display =
pendente
? ""
: "none";

}

if (editorRejeitar) {

editorRejeitar.style.display =
pendente
? ""
: "none";

}

if (editorRecusaBloco) {

editorRecusaBloco.style.display =
statusAtual === "recusado"
? ""
: "";

}

}

/* =========================================================
DADOS DO EDITOR
========================================================= */

function obterDadosEditor() {

return {

id:
muralEditandoId,

nome:
editorNome.value.trim(),

categoria:
editorCategoria.value.trim(),

descricao:
editorDescricao.value.trim(),

sobre:
editorSobre.value.trim(),

instagram:
editorInstagram.value.trim(),

imagem:
imagensMuralEditando[0] ||
"",

imagens:
imagensMuralEditando.slice(
0,
LIMITE_IMAGENS
)

};

}

function validarDadosEditor(
dados
) {

if (!dados.id) {

throw new Error(
"ID do perfil não encontrado."
);

}

if (!dados.nome) {

throw new Error(
"Informe o nome do perfil."
);

}

if (!dados.categoria) {

throw new Error(
"Informe a categoria do perfil."
);

}

if (
dados.nome.length >
150
) {

throw new Error(
"O nome é muito longo."
);

}

if (
dados.categoria.length >
100
) {

throw new Error(
"A categoria é muito longa."
);

}

if (
dados.descricao.length >
1000
) {

throw new Error(
"A descrição é muito longa."
);

}

return true;

}

/* =========================================================
SALVAR EDIÇÃO
========================================================= */

async function salvarEdicaoMural(
evento
) {

if (evento) {

evento.preventDefault();

}

if (!muralEditandoId) {

mostrarMensagem(
"Nenhum perfil está sendo editado.",
"erro"
);

return;

}

const dados =
obterDadosEditor();

try {

validarDadosEditor(
dados
);

editorSalvar.disabled =
true;

mostrarMensagem(
"Salvando alterações...",
"sucesso"
);

/*
A Edge Function verifica novamente
se o usuário da sessão é administrador.
*/

await chamarEdgeFunction(
"editar_mural",
{
cadastro_id:
muralEditandoId,

perfil:
dados
}
);

mostrarMensagem(
"Perfil atualizado com sucesso.",
"sucesso"
);

fecharEditorMural();

await carregarCadastrosMural();

await carregarMuralPublicados();

} catch (erro) {

console.error(
"Erro ao salvar perfil:",
erro
);

mostrarMensagem(
erro.message ||
"Não foi possível salvar o perfil.",
"erro"
);

} finally {

editorSalvar.disabled =
false;

}

}

/* =========================================================
APROVAR
========================================================= */

async function aprovarCadastroMural(
cadastro,
botao = null
) {

const nome =
cadastro.nome ||
"este perfil";

const confirmar =
window.confirm(
`Deseja aprovar "${nome}" e publicar o perfil no Mural?`
);

if (!confirmar) {
return;
}

if (botao) {

botao.disabled =
true;

}

try {

mostrarMensagem(
"Publicando perfil no Mural...",
"sucesso"
);

/*
A Edge Function deverá:

verificar ADMIN_USER_ID;
buscar o cadastro;
manter o mesmo cadastro.id;
atualizar status para aprovado;
publicar/atualizar DATA/pessoas.json;
manter a relação com votos_pessoas.pessoa_id.
*/

await chamarEdgeFunction(
"aprovar_mural",
{
cadastro_id:
cadastro.id
}
);

mostrarMensagem(
"Perfil aprovado e publicado com sucesso.",
"sucesso"
);

await carregarCadastrosMural();

await carregarMuralPublicados();

} catch (erro) {

console.error(
"Erro ao aprovar mural:",
erro
);

mostrarMensagem(
erro.message ||
"Não foi possível aprovar o perfil.",
"erro"
);

} finally {

if (botao) {

botao.disabled =
false;

}

}

}

/* =========================================================
REJEITAR
========================================================= */

async function rejeitarCadastroMural(
cadastro,
botao = null
) {

const nome =
cadastro.nome ||
"este perfil";

const motivo =
window.prompt(
`Informe o motivo da rejeição de "${nome}":`
);

if (
motivo === null
) {

return;

}

const motivoFinal =
motivo.trim();

if (!motivoFinal) {

alert(
"Informe um motivo para rejeitar o cadastro."
);

return;

}

if (botao) {

botao.disabled =
true;

}

try {

mostrarMensagem(
"Rejeitando cadastro...",
"sucesso"
);

await chamarEdgeFunction(
"rejeitar_mural",
{
cadastro_id:
cadastro.id,

motivo:
motivoFinal
}
);

mostrarMensagem(
"Cadastro rejeitado.",
"sucesso"
);

await carregarCadastrosMural();

} catch (erro) {

console.error(
"Erro ao rejeitar mural:",
erro
);

mostrarMensagem(
erro.message ||
"Não foi possível rejeitar o cadastro.",
"erro"
);

} finally {

if (botao) {

botao.disabled =
false;

}

}

}

/* =========================================================
APROVAR PELO EDITOR
========================================================= */

async function aprovarPeloEditor() {

if (!muralEditandoId) {
return;
}

const cadastro =
cadastrosMural.find(
item =>
String(item.id) ===
String(muralEditandoId)
);

if (!cadastro) {

alert(
"Não foi possível localizar o cadastro original."
);

return;

}

fecharEditorMural();

await aprovarCadastroMural(
cadastro
);

}

/* =========================================================
REJEITAR PELO EDITOR
========================================================= */

async function rejeitarPeloEditor() {

if (!muralEditandoId) {
return;
}

const cadastro =
cadastrosMural.find(
item =>
String(item.id) ===
String(muralEditandoId)
);

if (!cadastro) {

alert(
"Não foi possível localizar o cadastro original."
);

return;

}

fecharEditorMural();

await rejeitarCadastroMural(
cadastro
);

}

/* =========================================================
CARREGAR PUBLICADOS
========================================================= */

async function carregarMuralPublicados() {

if (carregandoPublicados) {

carregandoPublicados.hidden =
false;

}

try {

const resposta =
await fetch(
`../DATA/pessoas.json?t=${Date.now()}`,
{
cache: "no-store"
}
);

if (!resposta.ok) {

throw new Error(
`Não foi possível carregar pessoas.json (${resposta.status}).`
);

}

const dados =
await resposta.json();

muralPublicados =
Array.isArray(dados)
? dados
: [];

renderizarMuralPublicados();

} catch (erro) {

console.error(
"Erro ao carregar perfis publicados:",
erro
);

muralPublicados =
[];

if (listaPublicados) {

listaPublicados.innerHTML =
"";

}

if (semPublicados) {

semPublicados.hidden =
false;

semPublicados.textContent =
"Não foi possível carregar os perfis publicados.";

}

mostrarMensagem(
`Não foi possível carregar os perfis publicados: ${erro.message}`,
"erro"
);

} finally {

if (carregandoPublicados) {

carregandoPublicados.hidden =
true;

}

}

}

/* =========================================================
RENDERIZAR PUBLICADOS
========================================================= */

function renderizarMuralPublicados() {

if (!listaPublicados) {
return;
}

listaPublicados.innerHTML =
"";

const pesquisa =
normalizarTexto(
pesquisaMuralAdmin
);

const filtrados =
muralPublicados.filter(
pessoa => {

if (!pesquisa) {
return true;
}

const texto = [
pessoa.id,
pessoa.nome,
pessoa.categoria,
pessoa.descricao,
pessoa.sobre,
pessoa.instagram
]
.map(
normalizarTexto
)
.join(" ");

return texto.includes(
pesquisa
);

}
);

if (contadorPublicados) {

contadorPublicados.textContent =
String(
filtrados.length
);

}

if (!filtrados.length) {

if (semPublicados) {

semPublicados.hidden =
false;

}

return;

}

if (semPublicados) {

semPublicados.hidden =
true;

}

filtrados.forEach(
pessoa => {

listaPublicados.appendChild(
criarCardPublicado(
pessoa
)
);

}
);

}

/* =========================================================
IMAGENS DO PERFIL PUBLICADO
========================================================= */

function obterImagensPublicado(
pessoa
) {

let imagens = [];

if (
Array.isArray(
pessoa.imagens
)
) {

imagens =
pessoa.imagens.filter(
imagem =>
typeof imagem === "string" &&
imagem.trim() !== ""
);

}

if (
pessoa.capa &&
typeof pessoa.capa === "string"
) {

if (
!imagens.includes(
pessoa.capa
)
) {

imagens.unshift(
pessoa.capa
);

}

}

if (
pessoa.imagem &&
typeof pessoa.imagem === "string"
) {

if (
!imagens.includes(
pessoa.imagem
)
) {

imagens.unshift(
pessoa.imagem
);

}

}

return imagens.slice(
0,
LIMITE_IMAGENS
);

}

/* =========================================================
CARD PUBLICADO
========================================================= */

function criarCardPublicado(
pessoa
) {

const card =
document.createElement("article");

card.className =
"admin-mural-card";

const imagens =
obterImagensPublicado(
pessoa
);

const galeria =
document.createElement("div");

galeria.className =
"admin-mural-imagens";

if (imagens.length) {

imagens.forEach(
(url, index) => {

const div =
document.createElement("div");

div.className =
"admin-mural-imagem";

if (index === 0) {

div.classList.add(
"admin-mural-imagem-capa"
);

}

const img =
document.createElement("img");

img.src =
url;

img.alt =
pessoa.nome
? `${pessoa.nome} — imagem ${index + 1}`
: `Imagem ${index + 1}`;

img.loading =
"lazy";

div.appendChild(
img
);

galeria.appendChild(
div
);

}
);

} else {

const div =
document.createElement("div");

div.className =
"admin-mural-imagem";

div.style.gridColumn =
"1 / -1";

div.style.display =
"flex";

div.style.alignItems =
"center";

div.style.justifyContent =
"center";

div.style.color =
"#6b6b6b";

div.textContent =
"Sem imagem";

galeria.appendChild(
div
);

}

card.appendChild(
galeria
);

const conteudo =
document.createElement("div");

conteudo.className =
"admin-mural-conteudo";

const status =
document.createElement("span");

status.className =
"admin-mural-status admin-mural-status-aprovado";

status.textContent =
"Publicado";

conteudo.appendChild(
status
);

const titulo =
document.createElement("h3");

titulo.textContent =
pessoa.nome ||
"Sem nome";

conteudo.appendChild(
titulo
);

if (pessoa.categoria) {

const categoria =
document.createElement("div");

categoria.className =
"admin-mural-categoria";

categoria.textContent =
pessoa.categoria;

conteudo.appendChild(
categoria
);

}

if (pessoa.descricao) {

const descricao =
document.createElement("p");

descricao.className =
"admin-mural-descricao";

descricao.textContent =
pessoa.descricao;

conteudo.appendChild(
descricao
);

}

/* Metadados */

const metadados =
document.createElement("div");

metadados.className =
"admin-mural-metadados";

const id =
document.createElement("div");

id.className =
"admin-mural-metadado";

id.innerHTML =
`<strong>ID:</strong> ${escaparHTML(pessoa.id || "—")}`;

metadados.appendChild(
id
);

if (pessoa.instagram) {

const instagram =
document.createElement("div");

instagram.className =
"admin-mural-metadado";

instagram.innerHTML =
`<strong>Instagram:</strong> ${escaparHTML(pessoa.instagram)}`;

metadados.appendChild(
instagram
);

}

const totalImagens =
document.createElement("div");

totalImagens.className =
"admin-mural-metadado";

totalImagens.innerHTML =
`<strong>Imagens:</strong> ${imagens.length}`;

metadados.appendChild(
totalImagens
);

conteudo.appendChild(
metadados
);

/* =========================================================
AÇÕES DO PERFIL PUBLICADO
========================================================= */

const acoes =
document.createElement("div");

acoes.className =
"admin-mural-acoes-card";

/* EDITAR */

const editar =
document.createElement("button");

editar.type =
"button";

editar.className =
"admin-mural-botao-editar";

editar.textContent =
"Editar";

editar.addEventListener(
"click",
() => {

abrirEditorPublicado(
pessoa
);

}
);

acoes.appendChild(
editar
);

/* =========================================================
EXCLUIR
========================================================= */

const excluir =
document.createElement("button");

excluir.type =
"button";

excluir.className =
"admin-mural-botao-excluir";

excluir.textContent =
"Excluir";

excluir.addEventListener(
"click",
() => {

excluirMuralPublicado(
pessoa,
excluir
);

}
);

acoes.appendChild(
excluir
);

conteudo.appendChild(
acoes
);

card.appendChild(
conteudo
);

return card;

}

/* =========================================================
EXCLUIR PERFIL PUBLICADO
========================================================= */

async function excluirMuralPublicado(
pessoa,
botao = null
) {

if (!pessoa || !pessoa.id) {

mostrarMensagem(
"Não foi possível identificar o perfil que será excluído.",
"erro"
);

return;

}

const nome =
pessoa.nome ||
"este perfil";

const id =
String(
pessoa.id
);

/*
Primeira confirmação.
*/

const confirmar =
window.confirm(
`Deseja realmente excluir "${nome}" do Mural?\n\nID: ${id}\n\nEssa ação removerá o perfil da publicação.`
);

if (!confirmar) {
return;
}

/*
Segunda confirmação para evitar
exclusões acidentais.
*/

const confirmarNovamente =
window.confirm(
`Confirme a exclusão de "${nome}".\n\nO perfil será removido do Mural publicado.`
);

if (!confirmarNovamente) {
return;
}

if (botao) {

botao.disabled =
true;

botao.textContent =
"Excluindo...";

}

try {

mostrarMensagem(
`Excluindo "${nome}"...`,
"sucesso"
);

/*
A Edge Function deverá:

verificar se o usuário é administrador;
localizar o perfil pelo ID público;
remover o perfil de DATA/pessoas.json;
preservar o ID dos demais perfis;
tratar os dados relacionados ao perfil conforme
a regra definida no servidor;
publicar a alteração no GitHub/Cloudflare.
*/

await chamarEdgeFunction(
"excluir_mural",
{
pessoa_id:
id
}
);

mostrarMensagem(
`O perfil "${nome}" foi excluído do Mural.`,
"sucesso"
);

/*
Atualiza imediatamente as duas listas.
*/

await carregarCadastrosMural();

await carregarMuralPublicados();

} catch (erro) {

console.error(
"Erro ao excluir perfil publicado:",
erro
);

mostrarMensagem(
erro.message ||
"Não foi possível excluir o perfil publicado.",
"erro"
);

} finally {

if (botao) {

botao.disabled =
false;

botao.textContent =
"Excluir";

}

}

}

/* =========================================================
EDITAR PUBLICADO
========================================================= */

function abrirEditorPublicado(
pessoa
) {

muralEditandoId =
pessoa.id;

imagensMuralEditando =
obterImagensPublicado(
pessoa
);

editorId.value =
pessoa.id || "";

editorNome.value =
pessoa.nome || "";

editorCategoria.value =
pessoa.categoria || "";

editorInstagram.value =
pessoa.instagram || "";

editorDescricao.value =
pessoa.descricao || "";

editorSobre.value =
pessoa.sobre || "";

editorStatus.value =
"publicado";

editorUsuario.value =
pessoa.usuario_id || "—";

editorCriado.value =
formatarData(
pessoa.criado_em
);

editorAtualizado.value =
formatarData(
pessoa.atualizado_em
);

editorMotivoRecusa.value =
"";

atualizarEstadoImagens();

renderizarImagensEditor();

/*
Perfil publicado não possui botão
de aprovação/rejeição.
*/

if (editorAprovar) {

editorAprovar.style.display =
"none";

}

if (editorRejeitar) {

editorRejeitar.style.display =
"none";

}

editorMural.hidden =
false;

document.body.style.overflow =
"hidden";

}

/* =========================================================
PESQUISA
========================================================= */

function configurarPesquisa() {

if (!pesquisaPublicados) {
return;
}

pesquisaPublicados.addEventListener(
"input",
evento => {

pesquisaMuralAdmin =
evento.target.value;

renderizarMuralPublicados();

}
);

}

/* =========================================================
EVENTOS
========================================================= */

if (botaoAtualizar) {

botaoAtualizar.addEventListener(
"click",
async () => {

esconderMensagem();

await carregarCadastrosMural();

await carregarMuralPublicados();

}
);

}

if (botaoSair) {

botaoSair.addEventListener(
"click",
async () => {

await supabaseClient.auth.signOut();

window.location.href =
"../index.html";

}
);

}

if (editorFechar) {

editorFechar.addEventListener(
"click",
fecharEditorMural
);

}

if (editorCancelar) {

editorCancelar.addEventListener(
"click",
fecharEditorMural
);

}

if (editorMural) {

editorMural
.querySelector(
".editor-mural-overlay"
)
?.addEventListener(
"click",
fecharEditorMural
);

}

if (formEditor) {

formEditor.addEventListener(
"submit",
salvarEdicaoMural
);

}

if (editorAprovar) {

editorAprovar.addEventListener(
"click",
aprovarPeloEditor
);

}

if (editorRejeitar) {

editorRejeitar.addEventListener(
"click",
rejeitarPeloEditor
);

}

if (editorImagemArquivo) {

editorImagemArquivo.addEventListener(
"change",
evento => {

processarArquivosSelecionados(
evento.target.files
);

}
);

}

configurarPesquisa();

/* =========================================================
ESC
========================================================= */

document.addEventListener(
"keydown",
evento => {

if (
evento.key === "Escape" &&
editorMural &&
!editorMural.hidden
) {

fecharEditorMural();

}

}
);

/* =========================================================
AUTH STATE
========================================================= */

supabaseClient.auth.onAuthStateChange(
(
evento,
session
) => {

if (
evento ===
"SIGNED_OUT"
) {

window.location.href =
"../index.html";

return;

}

if (
evento ===
"SIGNED_IN" &&
session &&
session.user.id !==
ADMIN_USER_ID
) {

supabaseClient.auth.signOut();

window.location.href =
"../index.html";

}

}
);

/* =========================================================
INICIALIZAÇÃO
========================================================= */

async function iniciarAdminMural() {

const autorizado =
await verificarLogin();

if (!autorizado) {
return;
}

await carregarCadastrosMural();

await carregarMuralPublicados();

}

iniciarAdminMural();
