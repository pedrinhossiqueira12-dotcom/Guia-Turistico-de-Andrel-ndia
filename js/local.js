/* =========================================================
ANDRELÂNDIA — GUIA TURÍSTICO
LOCAL.JS
========================================================= */

/* =========================================================
SUPABASE
========================================================= */

const supabaseClient = window.supabaseLoginClient;

/* =========================================================
IDENTIFICAÇÃO DO LOCAL
========================================================= */

const parametrosURL = new URLSearchParams(window.location.search);
const idLocal = parametrosURL.get("id");

let localAtual = null;
let mapaLocal = null;

let notaSelecionada = 0;
let avaliacaoAtual = null;

/* =========================================================
VOLTAR
========================================================= */

function voltarPagina() {
if (document.referrer) {
history.back();
} else {
window.location.href = "../index.html";
}
}

/* =========================================================
ESCAPAR HTML
========================================================= */

function escaparHTML(valor) {

if (valor === null || valor === undefined) {
return "";
}

return String(valor)
.replace(/&/g, "&")
.replace(/</g, "<")
.replace(/>/g, ">")
.replace(/"/g, """)
.replace(/'/g, "'");
}

/* =========================================================
CORRIGIR CAMINHO DAS IMAGENS
========================================================= */

function corrigirCaminhoImagem(caminho) {

if (!caminho) {
return "";
}

const valor = String(caminho).trim();

if (!valor) {
return "";
}

if (
valor.startsWith("http://") ||
valor.startsWith("https://") ||
valor.startsWith("data:")
) {
return valor;
}

if (valor.startsWith("/")) {
return valor;
}

if (valor.startsWith("./img/")) {
return ../${valor.substring(2)};
}

if (valor.startsWith("img/")) {
return ../${valor};
}

if (valor.startsWith("../")) {
return valor;
}

return valor;
}

/* =========================================================
CARREGAR LOCAL
========================================================= */

async function carregarLocal() {

try {

if (!idLocal) {
  mostrarErro("Local não informado.");
  return;
}

const respostas = await Promise.all([
  fetch("../DATA/locais.json"),
  fetch("../DATA/comercios.json"),
  fetch("../DATA/hospedagem.json")
]);

for (const resposta of respostas) {

  if (!resposta.ok) {
    throw new Error(
      `Erro ao carregar dados (${resposta.status}).`
    );
  }
}

const locais = await respostas[0].json();
const comercios = await respostas[1].json();
const hospedagem = await respostas[2].json();

const listaLocais = Array.isArray(locais)
  ? locais
  : [];

const listaComercios = Array.isArray(comercios)
  ? comercios
  : [];

const listaHospedagem = Array.isArray(hospedagem)
  ? hospedagem
  : [];

const todos = [
  ...listaLocais,
  ...listaComercios,
  ...listaHospedagem
];

localAtual = todos.find(
  item => String(item.id) === String(idLocal)
);

if (!localAtual) {
  mostrarErro("Local não encontrado.");
  return;
}

preencherPagina(localAtual);

await carregarAvaliacoes();

await verificarAvaliacaoUsuario();

} catch (erro) {

console.error(
  "Erro ao carregar local:",
  erro
);

mostrarErro(
  "Não foi possível carregar as informações deste local."
);

}
}

/* =========================================================
PREENCHER PÁGINA
========================================================= */

function preencherPagina(item) {

document.title =
${item.nome || "Local"} — Guia Turístico de Andrelândia;

const titulo = document.getElementById("tituloLocal");
const categoria = document.getElementById("categoriaLocal");
const descricao = document.getElementById("descricaoLocal");
const historia = document.getElementById("historiaLocal");
const curiosidades = document.getElementById("curiosidadesLocal");

if (titulo) {
titulo.textContent = item.nome || "";
}

if (categoria) {
categoria.textContent = item.categoria || "";
}

if (descricao) {
descricao.textContent =
item.descricao || "Nenhuma descrição disponível.";
}

if (historia) {

const blocoHistoria =
  historia.closest(".secao-local");

if (item.historia) {

  historia.textContent = item.historia;

  if (blocoHistoria) {
    blocoHistoria.style.display = "";
  }

} else {

  if (blocoHistoria) {
    blocoHistoria.style.display = "none";
  }
}

}

if (curiosidades) {

const blocoCuriosidades =
  curiosidades.closest(".secao-local");

if (item.curiosidades) {

  curiosidades.textContent =
    item.curiosidades;

  if (blocoCuriosidades) {
    blocoCuriosidades.style.display = "";
  }

} else {

  if (blocoCuriosidades) {
    blocoCuriosidades.style.display = "none";
  }
}

}

/* =======================================================
INFORMAÇÕES
======================================================= */

const horario =
document.getElementById("horarioLocal");

const endereco =
document.getElementById("enderecoLocal");

const entrada =
document.getElementById("entradaLocal");

const telefone =
document.getElementById("telefoneLocal");

const site =
document.getElementById("siteLocal");

if (horario) {
horario.textContent =
formatarHorario(item.horario);
}

if (endereco) {
endereco.textContent =
item.endereco || "Não informado";
}

if (entrada) {

const blocoEntrada =
  entrada.closest(".informacao-item");

if (item.entrada) {

  entrada.textContent =
    item.entrada;

  if (blocoEntrada) {
    blocoEntrada.style.display = "";
  }

} else {

  if (blocoEntrada) {
    blocoEntrada.style.display = "none";
  }
}

}

if (telefone) {

const blocoTelefone =
  telefone.closest(".informacao-item");

if (item.telefone) {

  telefone.textContent =
    item.telefone;

  if (blocoTelefone) {
    blocoTelefone.style.display = "";
  }

} else {

  if (blocoTelefone) {
    blocoTelefone.style.display = "none";
  }
}

}

if (site) {

const blocoSite =
  site.closest(".informacao-item");

if (item.site) {

  site.href = item.site;
  site.textContent = item.site;

  if (blocoSite) {
    blocoSite.style.display = "";
  }

} else {

  if (blocoSite) {
    blocoSite.style.display = "none";
  }
}

}

/* =======================================================
INSTAGRAM
======================================================= */

configurarInstagram(item);

/* =======================================================
WHATSAPP
======================================================= */

configurarWhatsApp(item);

/* =======================================================
GALERIA
======================================================= */

configurarGaleria(item);

/* =======================================================
MAPA
======================================================= */

configurarMapa(item);

/* =======================================================
GOOGLE MAPS
======================================================= */

configurarGoogleMaps(item);

/* =======================================================
SUGESTÃO DE ALTERAÇÃO
======================================================= */

configurarSugestaoAlteracao();
}

/* =========================================================
HORÁRIO
========================================================= */

function formatarHorario(horario) {

if (!horario) {
return "Não informado";
}

if (typeof horario === "string") {
return horario;
}

if (typeof horario === "object") {

return Object.entries(horario)
  .map(([dia, valor]) => {

    return `${dia}: ${valor}`;

  })
  .join(" • ");

}

return String(horario);
}

/* =========================================================
INSTAGRAM
========================================================= */

function configurarInstagram(item) {

const link =
document.getElementById("instagramLocal");

if (!link) {
return;
}

const bloco =
link.closest(".informacao-item");

let url =
item.instagram || "";

if (!url) {

if (bloco) {
  bloco.style.display = "none";
}

return;

}

url = String(url).trim();

if (!/^https?:///i.test(url)) {

url =
  `https://www.instagram.com/${url.replace(/^@/, "")}/`;

}

link.href = url;
link.target = "_blank";
link.rel = "noopener noreferrer";

if (bloco) {
bloco.style.display = "";
}
}

/* =========================================================
WHATSAPP
========================================================= */

function configurarWhatsApp(item) {

const link =
document.getElementById("whatsappLocal");

if (!link) {
return;
}

const bloco =
link.closest(".informacao-item");

const telefone =
item.whatsapp || "";

if (!telefone) {

if (bloco) {
  bloco.style.display = "none";
}

return;

}

const numero =
String(telefone).replace(/\D/g, "");

if (!numero) {

if (bloco) {
  bloco.style.display = "none";
}

return;

}

link.href =
https://wa.me/${numero};

link.target = "_blank";
link.rel = "noopener noreferrer";

if (bloco) {
bloco.style.display = "";
}
}

/* =========================================================
GALERIA
========================================================= */

function configurarGaleria(item) {

const imagemPrincipal =
document.getElementById("imagemPrincipal");

const miniaturas =
document.getElementById("miniaturas");

if (!imagemPrincipal || !miniaturas) {
return;
}

let imagens = [];

if (item.capa) {
imagens.push(item.capa);
}

if (Array.isArray(item.galeria)) {
imagens.push(...item.galeria);
}

if (Array.isArray(item.fotos)) {
imagens.push(...item.fotos);
}

imagens = imagens
.filter(Boolean)
.map(corrigirCaminhoImagem)
.filter(Boolean);

imagens = [...new Set(imagens)];

miniaturas.innerHTML = "";

if (!imagens.length) {

imagemPrincipal.style.display = "none";

return;

}

imagemPrincipal.src = imagens[0];
imagemPrincipal.alt =
item.nome || "Imagem do local";

imagemPrincipal.style.display = "block";

imagens.forEach((imagem, indice) => {

const botao =
  document.createElement("button");

botao.type = "button";
botao.className = "miniatura";

if (indice === 0) {
  botao.classList.add("ativa");
}

const img =
  document.createElement("img");

img.src = imagem;

img.alt =
  `${item.nome || "Local"} — imagem ${indice + 1}`;

img.loading = "lazy";

botao.appendChild(img);

botao.addEventListener(
  "click",
  () => {

    imagemPrincipal.src = imagem;

    document
      .querySelectorAll(".miniatura")
      .forEach(elemento => {
        elemento.classList.remove("ativa");
      });

    botao.classList.add("ativa");
  }
);

miniaturas.appendChild(botao);

});
}

/* =========================================================
MAPA
========================================================= */

function configurarMapa(item) {

const elementoMapa =
document.getElementById("mapaLocal");

if (!elementoMapa) {
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

elementoMapa.style.display = "none";

return;

}

if (mapaLocal) {

mapaLocal.remove();

mapaLocal = null;

}

mapaLocal =
L.map(elementoMapa, {
zoomControl: true,
scrollWheelZoom: false
}).setView(
[latitude, longitude],
18
);

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
"Tiles © Esri"
}
).addTo(mapaLocal);

L.marker([
latitude,
longitude
])
.addTo(mapaLocal)
.bindPopup(
escaparHTML(item.nome || "Local")
)
.openPopup();
}

/* =========================================================
GOOGLE MAPS
========================================================= */

function configurarGoogleMaps(item) {

const botao =
document.getElementById("botaoGoogleMaps");

if (!botao) {
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

botao.style.display = "none";

return;

}

const destino =
${latitude},${longitude};

botao.href =
https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destino)};

botao.target = "_blank";
botao.rel = "noopener noreferrer";

botao.style.display = "";
}

/* =========================================================
SUGERIR ALTERAÇÃO
========================================================= */

function configurarSugestaoAlteracao() {

const botao =
document.getElementById("botaoSugerirAlteracao");

if (!botao || !idLocal) {
return;
}

botao.href =
../pages/cadastros.html?tipo=alteracao&local=${encodeURIComponent(idLocal)};
}

/* =========================================================
FOTO EM TELA CHEIA
========================================================= */

function abrirImagemFullscreen(imagem) {

if (!imagem) {
return;
}

const src =
imagem.src || imagem;

if (!src) {
return;
}

const fundo =
document.createElement("div");

fundo.className =
"imagem-fullscreen";

const imagemGrande =
document.createElement("img");

imagemGrande.src = src;

imagemGrande.alt =
imagem.alt || "Imagem ampliada";

fundo.appendChild(imagemGrande);

fundo.addEventListener(
"click",
() => fundo.remove()
);

document.body.appendChild(fundo);
}

function fecharImagemFullscreen() {

const elemento =
document.querySelector(
".imagem-fullscreen"
);

if (elemento) {
elemento.remove();
}
}

/* =========================================================
TECLADO — ESC
========================================================= */

document.addEventListener(
"keydown",
evento => {

if (evento.key === "Escape") {
  fecharImagemFullscreen();
}

}
);

/* =========================================================
AVALIAÇÕES — USUÁRIO
========================================================= */

function obterUsuarioAtual() {

return window.usuarioAtualSupabase || null;
}

/* =========================================================
VERIFICAR AVALIAÇÃO DO USUÁRIO
========================================================= */

async function verificarAvaliacaoUsuario() {

if (!supabaseClient || !idLocal) {
return;
}

const usuario =
obterUsuarioAtual();

if (!usuario) {

avaliacaoAtual = null;

return;

}

try {

const {
  data,
  error
} = await supabaseClient
  .from("avaliacoes")
  .select("*")
  .eq("local_id", idLocal)
  .eq("usuario_id", usuario.id)
  .maybeSingle();

if (error) {
  throw error;
}

avaliacaoAtual =
  data || null;

if (avaliacaoAtual) {

  notaSelecionada =
    Number(avaliacaoAtual.nota) || 0;

  const comentario =
    document.getElementById(
      "comentarioAvaliacao"
    );

  if (comentario) {
    comentario.value =
      avaliacaoAtual.comentario || "";
  }

  atualizarEstrelas();

  const botao =
    document.getElementById(
      "botaoPublicarAvaliacao"
    );

  if (botao) {
    botao.textContent =
      "Atualizar avaliação";
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
CARREGAR AVALIAÇÕES
========================================================= */

async function carregarAvaliacoes() {

if (!supabaseClient || !idLocal) {
return;
}

try {

const {
  data,
  error
} = await supabaseClient
  .from("avaliacoes")
  .select("*")
  .eq("local_id", idLocal)
  .order("criado_em", {
    ascending: false
  });

if (error) {
  throw error;
}

const avaliacoes =
  data || [];

atualizarResumoAvaliacoes(
  avaliacoes
);

const lista =
  document.getElementById(
    "listaAvaliacoes"
  );

if (!lista) {
  return;
}

lista.innerHTML = "";

if (!avaliacoes.length) {

  lista.innerHTML =
    `<p class="sem-avaliacoes">
      Ainda não há avaliações.
    </p>`;

  return;
}

const usuario =
  obterUsuarioAtual();

avaliacoes.forEach(
  avaliacao => {

    const item =
      document.createElement("div");

    item.className =
      "avaliacao-item";

    const nome =
      escaparHTML(
        avaliacao.nome_usuario ||
        "Usuário"
      );

    const comentario =
      escaparHTML(
        avaliacao.comentario || ""
      );

    const data =
      formatarData(
        avaliacao.criado_em
      );

    let botoes = "";

    if (
      usuario &&
      usuario.id === avaliacao.usuario_id
    ) {

      botoes = `
        <div class="acoes-avaliacao">
          <button
            type="button"
            onclick="editarAvaliacao('${avaliacao.id}')"
          >
            Editar
          </button>

          <button
            type="button"
            onclick="excluirAvaliacao('${avaliacao.id}')"
          >
            Excluir
          </button>
        </div>
      `;
    }

    item.innerHTML = `
      <div class="avaliacao-cabecalho">
        <strong>${nome}</strong>
        <span>${data}</span>
      </div>

      <div class="avaliacao-estrelas">
        ${criarHTMLestrelas(
          Number(avaliacao.nota) || 0
        )}
      </div>

      <p class="avaliacao-comentario">
        ${comentario}
      </p>

      ${botoes}
    `;

    lista.appendChild(item);
  }
);

} catch (erro) {

console.error(
  "Erro ao carregar avaliações:",
  erro
);

}
}

/* =========================================================
RESUMO DAS AVALIAÇÕES
========================================================= */

function atualizarResumoAvaliacoes(
avaliacoes
) {

const mediaElemento =
document.getElementById(
"mediaAvaliacoes"
);

const totalElemento =
document.getElementById(
"totalAvaliacoes"
);

if (!avaliacoes.length) {

if (mediaElemento) {
  mediaElemento.textContent =
    "0,0";
}

if (totalElemento) {
  totalElemento.textContent =
    "0 avaliações";
}

return;

}

const soma =
avaliacoes.reduce(
(total, avaliacao) =>
total +
(Number(avaliacao.nota) || 0),
0
);

const media =
soma / avaliacoes.length;

if (mediaElemento) {

mediaElemento.textContent =
  media.toFixed(1).replace(".", ",");

}

if (totalElemento) {

totalElemento.textContent =
  `${avaliacoes.length} ${
    avaliacoes.length === 1
      ? "avaliação"
      : "avaliações"
  }`;

}
}

/* =========================================================
ESTRELAS
========================================================= */

function criarHTMLestrelas(nota) {

let html = "";

for (let i = 1; i <= 5; i++) {

html +=
  i <= nota
    ? "★"
    : "☆";

}

return html;
}

function atualizarEstrelas() {

const estrelas =
document.querySelectorAll(
".estrela-avaliacao"
);

estrelas.forEach(
(estrela, indice) => {

  const numero =
    indice + 1;

  estrela.classList.toggle(
    "selecionada",
    numero <= notaSelecionada
  );
}

);
}

/* =========================================================
DATA
========================================================= */

function formatarData(data) {

if (!data) {
return "";
}

const valor =
new Date(data);

if (Number.isNaN(valor.getTime())) {
return "";
}

return valor.toLocaleDateString(
"pt-BR",
{
day: "2-digit",
month: "2-digit",
year: "numeric"
}
);
}

/* =========================================================
PUBLICAR / ATUALIZAR COMENTÁRIO
========================================================= */

async function publicarComentario() {

const usuario =
obterUsuarioAtual();

if (!usuario) {

if (
  typeof abrirModalAuth ===
  "function"
) {

  abrirModalAuth("login");

} else {

  alert(
    "Faça login para avaliar este local."
  );
}

return;

}

if (!notaSelecionada) {

alert(
  "Selecione uma nota de 1 a 5 estrelas."
);

return;

}

const campoComentario =
document.getElementById(
"comentarioAvaliacao"
);

const comentario =
campoComentario
? campoComentario.value.trim()
: "";

if (!comentario) {

alert(
  "Escreva um comentário."
);

return;

}

if (comentario.length > 500) {

alert(
  "O comentário deve ter no máximo 500 caracteres."
);

return;

}

const botao =
document.getElementById(
"botaoPublicarAvaliacao"
);

if (botao) {
botao.disabled = true;
botao.textContent = "Salvando...";
}

try {

const dados = {

  local_id: idLocal,

  usuario_id: usuario.id,

  nome_usuario:
    obterNomeUsuarioLocal(usuario),

  nota:
    notaSelecionada,

  comentario:
    comentario
};

let erro;

if (avaliacaoAtual) {

  const resposta =
    await supabaseClient
      .from("avaliacoes")
      .update(dados)
      .eq("id", avaliacaoAtual.id)
      .eq("usuario_id", usuario.id);

  erro =
    resposta.error;

} else {

  const resposta =
    await supabaseClient
      .from("avaliacoes")
      .insert(dados);

  erro =
    resposta.error;
}

if (erro) {
  throw erro;
}

alert(
  "Avaliação salva com sucesso."
);

await carregarAvaliacoes();

await verificarAvaliacaoUsuario();

} catch (erro) {

console.error(
  "Erro ao salvar avaliação:",
  erro
);

alert(
  "Não foi possível salvar sua avaliação."
);

} finally {

if (botao) {

  botao.disabled = false;

  botao.textContent =
    avaliacaoAtual
      ? "Atualizar avaliação"
      : "Publicar avaliação";
}

}
}

/* =========================================================
NOME DO USUÁRIO
========================================================= */

function obterNomeUsuarioLocal(usuario) {

if (!usuario) {
return "Usuário";
}

return (
usuario.user_metadata?.nome ||
usuario.user_metadata?.name ||
usuario.email?.split("@")[0] ||
"Usuário"
);
}

/* =========================================================
EDITAR AVALIAÇÃO
========================================================= */

async function editarAvaliacao(id) {

if (!supabaseClient) {
return;
}

try {

const {
  data,
  error
} = await supabaseClient
  .from("avaliacoes")
  .select("*")
  .eq("id", id)
  .maybeSingle();

if (error) {
  throw error;
}

if (!data) {
  return;
}

avaliacaoAtual =
  data;

notaSelecionada =
  Number(data.nota) || 0;

const comentario =
  document.getElementById(
    "comentarioAvaliacao"
  );

if (comentario) {
  comentario.value =
    data.comentario || "";
}

atualizarEstrelas();

const botao =
  document.getElementById(
    "botaoPublicarAvaliacao"
  );

if (botao) {
  botao.textContent =
    "Atualizar avaliação";
}

const campo =
  document.getElementById(
    "comentarioAvaliacao"
  );

if (campo) {
  campo.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
}

} catch (erro) {

console.error(
  "Erro ao editar avaliação:",
  erro
);

}
}

/* =========================================================
EXCLUIR AVALIAÇÃO
========================================================= */

async function excluirAvaliacao(id) {

const usuario =
obterUsuarioAtual();

if (!usuario) {
return;
}

const confirmar =
window.confirm(
"Deseja realmente excluir esta avaliação?"
);

if (!confirmar) {
return;
}

try {

const {
  error
} = await supabaseClient
  .from("avaliacoes")
  .delete()
  .eq("id", id)
  .eq("usuario_id", usuario.id);

if (error) {
  throw error;
}

avaliacaoAtual = null;
notaSelecionada = 0;

const comentario =
  document.getElementById(
    "comentarioAvaliacao"
  );

if (comentario) {
  comentario.value = "";
}

atualizarEstrelas();

const botao =
  document.getElementById(
    "botaoPublicarAvaliacao"
  );

if (botao) {
  botao.textContent =
    "Publicar avaliação";
}

await carregarAvaliacoes();

} catch (erro) {

console.error(
  "Erro ao excluir avaliação:",
  erro
);

alert(
  "Não foi possível excluir a avaliação."
);

}
}

/* =========================================================
MOSTRAR ERRO
========================================================= */

function mostrarErro(mensagem) {

const carregando =
document.getElementById(
"carregando"
);

if (carregando) {
carregando.style.display = "none";
}

const erro =
document.getElementById(
"erroLocal"
);

if (erro) {

erro.textContent =
  mensagem;

erro.style.display =
  "block";

return;

}

const conteudo =
document.querySelector(
"main"
);

if (conteudo) {

const mensagemErro =
  document.createElement("p");

mensagemErro.textContent =
  mensagem;

mensagemErro.style.padding =
  "30px";

mensagemErro.style.textAlign =
  "center";

conteudo.prepend(
  mensagemErro
);

}
}

/* =========================================================
EVENTOS
========================================================= */

function configurarEventos() {

const botaoVoltar =
document.getElementById(
"botaoVoltar"
);

if (botaoVoltar) {

botaoVoltar.addEventListener(
  "click",
  evento => {

    evento.preventDefault();

    voltarPagina();
  }
);

}

/* =======================================================
ESTRELAS
======================================================= */

const estrelas =
document.querySelectorAll(
".estrela-avaliacao"
);

estrelas.forEach(
(estrela, indice) => {

  estrela.addEventListener(
    "click",
    () => {

      notaSelecionada =
        indice + 1;

      atualizarEstrelas();
    }
  );
}

);

/* =======================================================
BOTÃO AVALIAR
======================================================= */

const botaoAvaliacao =
document.getElementById(
"botaoPublicarAvaliacao"
);

if (botaoAvaliacao) {

botaoAvaliacao.addEventListener(
  "click",
  publicarComentario
);

}

/* =======================================================
FOTO PRINCIPAL
======================================================= */

const imagemPrincipal =
document.getElementById(
"imagemPrincipal"
);

if (imagemPrincipal) {

imagemPrincipal.addEventListener(
  "click",
  () => {
    abrirImagemFullscreen(
      imagemPrincipal
    );
  }
);

}
}

/* =========================================================
MONITORAMENTO DE LOGIN
========================================================= */

if (
supabaseClient &&
supabaseClient.auth
) {

supabaseClient.auth.onAuthStateChange(
async (_evento, usuario) => {

  window.usuarioAtualSupabase =
    usuario || null;

  await verificarAvaliacaoUsuario();

  await carregarAvaliacoes();
}

);
}

/* =========================================================
INICIALIZAÇÃO
========================================================= */

document.addEventListener(
"DOMContentLoaded",
() => {

configurarEventos();

carregarLocal();

}
);
