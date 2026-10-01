/* =========================================================
ANDRELÂNDIA — GUIA TURÍSTICO
LOCAL.JS
========================================================= */

/* =========================================================
SUPABASE
========================================================= */

const supabaseClient = window.supabaseLoginClient || null;

/* =========================================================
ID DO LOCAL
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
return;
}

window.location.href = "../index.html";
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
CAMINHO DA IMAGEM
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

if (valor.startsWith("../")) {
return valor;
}

if (valor.startsWith("./")) {
return ../${valor.substring(2)};
}

if (valor.startsWith("img/")) {
return ../${valor};
}

return valor;
}

/* =========================================================
CARREGAR DADOS
========================================================= */

async function carregarLocal() {

try {

if (!idLocal) {
  mostrarErro("Local não informado.");
  return;
}

const respostaLocais =
  await fetch("../DATA/locais.json");

const respostaComercios =
  await fetch("../DATA/comercios.json");

const respostaHospedagem =
  await fetch("../DATA/hospedagem.json");


if (!respostaLocais.ok) {
  throw new Error(
    `Erro em locais.json: ${respostaLocais.status}`
  );
}

if (!respostaComercios.ok) {
  throw new Error(
    `Erro em comercios.json: ${respostaComercios.status}`
  );
}

if (!respostaHospedagem.ok) {
  throw new Error(
    `Erro em hospedagem.json: ${respostaHospedagem.status}`
  );
}


const locais =
  await respostaLocais.json();

const comercios =
  await respostaComercios.json();

const hospedagem =
  await respostaHospedagem.json();


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


const todosOsLocais = [
  ...listaLocais,
  ...listaComercios,
  ...listaHospedagem
];


localAtual =
  todosOsLocais.find(
    item => String(item.id) === String(idLocal)
  );


if (!localAtual) {
  mostrarErro(
    "Local não encontrado."
  );
  return;
}


preencherPagina(localAtual);

esconderCarregando();


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
ESCONDER CARREGAMENTO
========================================================= */

function esconderCarregando() {

const carregando =
document.getElementById("carregando");

if (carregando) {
carregando.style.display = "none";
}
}

/* =========================================================
PREENCHER PÁGINA
========================================================= */

function preencherPagina(item) {

document.title =
${item.nome || "Local"} — Guia Turístico de Andrelândia;

const titulo =
document.getElementById("tituloLocal");

if (titulo) {
titulo.textContent =
item.nome || "";
}

const categoria =
document.getElementById("categoriaLocal");

if (categoria) {
categoria.textContent =
item.categoria || "";
}

const descricao =
document.getElementById("descricaoLocal");

if (descricao) {
descricao.textContent =
item.descricao ||
"Nenhuma descrição disponível.";
}

const historia =
document.getElementById("historiaLocal");

if (historia) {

historia.textContent =
  item.historia || "";

const bloco =
  historia.closest(".secao-local");

if (bloco) {

  bloco.style.display =
    item.historia ? "" : "none";
}

}

const curiosidades =
document.getElementById("curiosidadesLocal");

if (curiosidades) {

curiosidades.textContent =
  item.curiosidades || "";

const bloco =
  curiosidades.closest(".secao-local");

if (bloco) {

  bloco.style.display =
    item.curiosidades ? "" : "none";
}

}

const horario =
document.getElementById("horarioLocal");

if (horario) {

horario.textContent =
  formatarHorario(item.horario);

}

const endereco =
document.getElementById("enderecoLocal");

if (endereco) {

endereco.textContent =
  item.endereco || "Não informado";

}

const entrada =
document.getElementById("entradaLocal");

if (entrada) {

entrada.textContent =
  item.entrada || "Não informado";

}

const telefone =
document.getElementById("telefoneLocal");

if (telefone) {

telefone.textContent =
  item.telefone || "";

}

configurarInstagram(item);

configurarWhatsApp(item);

configurarGaleria(item);

configurarMapa(item);

configurarGoogleMaps(item);

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

if (!item.instagram) {

link.style.display = "none";
return;

}

let url =
String(item.instagram).trim();

if (!/^https?:///i.test(url)) {

url =
  "https://www.instagram.com/" +
  url.replace(/^@/, "") +
  "/";

}

link.href = url;

link.target = "_blank";

link.rel =
"noopener noreferrer";

link.style.display = "";
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

if (!item.whatsapp) {

link.style.display = "none";
return;

}

const numero =
String(item.whatsapp)
.replace(/\D/g, "");

if (!numero) {

link.style.display = "none";
return;

}

link.href =
https://wa.me/${numero};

link.target = "_blank";

link.rel =
"noopener noreferrer";

link.style.display = "";
}

/* =========================================================
GALERIA
========================================================= */

function configurarGaleria(item) {

const imagemPrincipal =
document.getElementById("imagemPrincipal");

const miniaturas =
document.getElementById("miniaturas");

if (!imagemPrincipal) {
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

imagens =
imagens
.filter(Boolean)
.map(corrigirCaminhoImagem)
.filter(Boolean);

imagens =
[...new Set(imagens)];

if (!imagens.length) {

imagemPrincipal.style.display =
  "none";

if (miniaturas) {
  miniaturas.innerHTML = "";
}

return;

}

imagemPrincipal.src =
imagens[0];

imagemPrincipal.alt =
item.nome || "Imagem do local";

imagemPrincipal.style.display =
"block";

if (!miniaturas) {
return;
}

miniaturas.innerHTML = "";

imagens.forEach(
(imagem, indice) => {

  const botao =
    document.createElement("button");

  botao.type =
    "button";

  botao.className =
    "miniatura";


  if (indice === 0) {

    botao.classList.add(
      "ativa"
    );
  }


  const img =
    document.createElement("img");

  img.src =
    imagem;

  img.alt =
    `${item.nome || "Local"} - imagem ${indice + 1}`;

  img.loading =
    "lazy";


  botao.appendChild(img);


  botao.addEventListener(
    "click",
    function() {

      imagemPrincipal.src =
        imagem;


      document
        .querySelectorAll(".miniatura")
        .forEach(
          elemento => {
            elemento.classList.remove(
              "ativa"
            );
          }
        );


      botao.classList.add(
        "ativa"
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

elementoMapa.style.display =
  "none";

return;

}

if (mapaLocal) {

mapaLocal.remove();

mapaLocal = null;

}

mapaLocal =
L.map(
elementoMapa,
{
zoomControl: true,
scrollWheelZoom: false
}
).setView(
[
latitude,
longitude
],
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
attribution: "Tiles © Esri"
}
).addTo(mapaLocal);

L.marker(
[
latitude,
longitude
]
)
.addTo(mapaLocal)
.bindPopup(
escaparHTML(
item.nome || "Local"
)
);
}

/* =========================================================
GOOGLE MAPS
========================================================= */

function configurarGoogleMaps(item) {

const botao =
document.getElementById(
"botaoGoogleMaps"
);

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

botao.style.display =
  "none";

return;

}

const destino =
${latitude},${longitude};

botao.href =
"https://www.google.com/maps/dir/?api=1&destination=" +
encodeURIComponent(destino);

botao.target =
"_blank";

botao.rel =
"noopener noreferrer";

botao.style.display =
"";
}

/* =========================================================
SUGERIR ALTERAÇÃO
========================================================= */

function configurarSugestaoAlteracao() {

const botao =
document.getElementById(
"botaoSugerirAlteracao"
);

if (!botao) {
return;
}

if (!idLocal) {
return;
}

botao.href =
"../pages/cadastros.html?tipo=alteracao&local=" +
encodeURIComponent(idLocal);
}

/* =========================================================
TELA CHEIA DA IMAGEM
========================================================= */

function abrirImagemFullscreen(imagem) {

if (!imagem || !imagem.src) {
return;
}

const fundo =
document.createElement("div");

fundo.className =
"imagem-fullscreen";

const imagemGrande =
document.createElement("img");

imagemGrande.src =
imagem.src;

imagemGrande.alt =
imagem.alt || "Imagem ampliada";

fundo.appendChild(
imagemGrande
);

fundo.addEventListener(
"click",
function() {
fundo.remove();
}
);

document.body.appendChild(
fundo
);
}

/* =========================================================
ESC — FECHAR IMAGEM
========================================================= */

document.addEventListener(
"keydown",
function(evento) {

if (
  evento.key === "Escape"
) {

  const tela =
    document.querySelector(
      ".imagem-fullscreen"
    );

  if (tela) {
    tela.remove();
  }
}

}
);

/* =========================================================
USUÁRIO
========================================================= */

function obterUsuarioAtual() {

return (
window.usuarioAtualSupabase ||
null
);
}

/* =========================================================
VERIFICAR AVALIAÇÃO DO USUÁRIO
========================================================= */

async function verificarAvaliacaoUsuario() {

if (
!supabaseClient ||
!idLocal
) {
return;
}

const usuario =
obterUsuarioAtual();

if (!usuario) {

avaliacaoAtual = null;
notaSelecionada = 0;

return;

}

try {

const resposta =
  await supabaseClient
    .from("avaliacoes")
    .select("*")
    .eq("local_id", idLocal)
    .eq("usuario_id", usuario.id)
    .maybeSingle();


if (resposta.error) {
  throw resposta.error;
}


avaliacaoAtual =
  resposta.data || null;


if (!avaliacaoAtual) {
  return;
}


notaSelecionada =
  Number(
    avaliacaoAtual.nota
  ) || 0;


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

if (
!supabaseClient ||
!idLocal
) {
return;
}

try {

const resposta =
  await supabaseClient
    .from("avaliacoes")
    .select("*")
    .eq("local_id", idLocal)
    .order(
      "criado_em",
      {
        ascending: false
      }
    );


if (resposta.error) {
  throw resposta.error;
}


const avaliacoes =
  resposta.data || [];


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
    '<p class="sem-avaliacoes">Ainda não há avaliações.</p>';

  return;
}


const usuario =
  obterUsuarioAtual();


avaliacoes.forEach(
  function(avaliacao) {

    const item =
      document.createElement(
        "div"
      );


    item.className =
      "avaliacao-item";


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


    let botoes =
      "";


    if (
      usuario &&
      usuario.id ===
        avaliacao.usuario_id
    ) {

      botoes =
        `
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


    item.innerHTML =
      `
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


    lista.appendChild(
      item
    );
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
RESUMO
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
function(total, avaliacao) {

    return (
      total +
      (Number(avaliacao.nota) || 0)
    );
  },
  0
);

const media =
soma / avaliacoes.length;

if (mediaElemento) {

mediaElemento.textContent =
  media
    .toFixed(1)
    .replace(".", ",");

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

for (
let i = 1;
i <= 5;
i++
) {

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
function(estrela, indice) {

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

if (
Number.isNaN(
valor.getTime()
)
) {
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
NOME DO USUÁRIO
========================================================= */

function obterNomeUsuarioLocal(
usuario
) {

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
PUBLICAR AVALIAÇÃO
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

botao.disabled =
  true;

botao.textContent =
  "Salvando...";

}

try {

const dados = {

  local_id:
    idLocal,

  usuario_id:
    usuario.id,

  nome_usuario:
    obterNomeUsuarioLocal(
      usuario
    ),

  nota:
    notaSelecionada,

  comentario:
    comentario
};


let resposta;


if (avaliacaoAtual) {

  resposta =
    await supabaseClient
      .from("avaliacoes")
      .update(dados)
      .eq(
        "id",
        avaliacaoAtual.id
      )
      .eq(
        "usuario_id",
        usuario.id
      );

} else {

  resposta =
    await supabaseClient
      .from("avaliacoes")
      .insert(dados);
}


if (resposta.error) {
  throw resposta.error;
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

  botao.disabled =
    false;

  botao.textContent =
    avaliacaoAtual
      ? "Atualizar avaliação"
      : "Publicar avaliação";
}

}
}

/* =========================================================
EDITAR AVALIAÇÃO
========================================================= */

async function editarAvaliacao(
id
) {

if (!supabaseClient) {
return;
}

try {

const resposta =
  await supabaseClient
    .from("avaliacoes")
    .select("*")
    .eq("id", id)
    .maybeSingle();


if (resposta.error) {
  throw resposta.error;
}


if (!resposta.data) {
  return;
}


avaliacaoAtual =
  resposta.data;


notaSelecionada =
  Number(
    resposta.data.nota
  ) || 0;


const comentario =
  document.getElementById(
    "comentarioAvaliacao"
  );


if (comentario) {

  comentario.value =
    resposta.data.comentario || "";
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


if (comentario) {

  comentario.scrollIntoView(
    {
      behavior: "smooth",
      block: "center"
    }
  );
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

async function excluirAvaliacao(
id
) {

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

const resposta =
  await supabaseClient
    .from("avaliacoes")
    .delete()
    .eq("id", id)
    .eq(
      "usuario_id",
      usuario.id
    );


if (resposta.error) {
  throw resposta.error;
}


avaliacaoAtual =
  null;

notaSelecionada =
  0;


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
ERRO
========================================================= */

function mostrarErro(
mensagem
) {

esconderCarregando();

const elementoErro =
document.getElementById(
"erroLocal"
);

if (elementoErro) {

elementoErro.textContent =
  mensagem;

elementoErro.style.display =
  "block";

return;

}

const main =
document.querySelector(
"main"
);

if (main) {

const mensagemElemento =
  document.createElement(
    "p"
  );


mensagemElemento.textContent =
  mensagem;


mensagemElemento.style.padding =
  "30px";

mensagemElemento.style.textAlign =
  "center";


main.prepend(
  mensagemElemento
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
  function(evento) {

    evento.preventDefault();

    voltarPagina();
  }
);

}

const estrelas =
document.querySelectorAll(
".estrela-avaliacao"
);

estrelas.forEach(
function(estrela, indice) {

  estrela.addEventListener(
    "click",
    function() {

      notaSelecionada =
        indice + 1;

      atualizarEstrelas();
    }
  );
}

);

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

const imagemPrincipal =
document.getElementById(
"imagemPrincipal"
);

if (imagemPrincipal) {

imagemPrincipal.addEventListener(
  "click",
  function() {

    abrirImagemFullscreen(
      imagemPrincipal
    );
  }
);

}
}

/* =========================================================
AUTENTICAÇÃO
========================================================= */

if (
supabaseClient &&
supabaseClient.auth
) {

supabaseClient.auth.onAuthStateChange(
async function(
_evento,
usuario
) {

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
function() {

configurarEventos();

carregarLocal();

}
);
