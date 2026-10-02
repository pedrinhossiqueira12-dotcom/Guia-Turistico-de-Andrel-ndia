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

const categoria =
document.getElementById(
"categoriaLocal"
);

const nome =
document.getElementById(
"nomeLocal"
);

if (categoria) {

categoria.textContent =
  localAtual.categoria ||
  "";

}

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
!instagram.startsWith(
"http://"
) &&
!instagram.startsWith(
"https://"
)
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

nome.textContent =
  localAtual.nome ||
  "Instagram";

}
}

/* =========================================================
GALERIA
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

let imagens = [];

if (
Array.isArray(
localAtual.imagens
)
) {

imagens =
  localAtual.imagens
    .filter(Boolean);

} else if (
localAtual.imagem
) {

imagens =
  [
    localAtual.imagem
  ];

}

if (!imagens.length) {

imagens =
  [
    FALLBACK_IMAGE
  ];

}

imagensAtuais =
imagens;

if (principal) {

principal.src =
  imagens[0];


principal.onerror =
  function () {

    this.src =
      FALLBACK_IMAGE;
  };


principal.onclick =
  function () {

    abrirVisualizador(
      0
    );
  };

}

if (!miniaturas) {
return;
}

miniaturas.innerHTML =
"";

imagens
.slice(0, 4)
.forEach(
(
imagem,
indice
) => {

    const img =
      document.createElement(
        "img"
      );


    img.src =
      imagem;


    img.alt =
      `${localAtual.nome || "Local"} - Foto ${indice + 1}`;


    img.onerror =
      function () {

        this.src =
          FALLBACK_IMAGE;
      };


    img.onclick =
      function () {

        if (principal) {

          principal.src =
            imagem;
        }


        abrirVisualizador(
          indice
        );
      };


    miniaturas.appendChild(
      img
    );
  }
);

}

/* =========================================================
VISUALIZADOR
========================================================= */

function abrirVisualizador(
indice
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

imagem.onerror =
function () {

  this.src =
    FALLBACK_IMAGE;
};

viewer.style.display =
"flex";
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

const latitude =
Number(
localAtual.latitude
);

const longitude =
Number(
localAtual.longitude
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

mapaLocal =
L.map(
elemento,
{
zoomControl: true,
scrollWheelZoom: true
}
).setView(
[
latitude,
longitude
],
17
);

/* =====================================================
ESRI WORLD IMAGERY

 URL CORRETA:
 server.arcgisonline.com

 Não utilizar:
 serverservices.arcgisonline.com
 serverserver.arcgisonline.com

===================================================== */

L.tileLayer(
"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
{
maxNativeZoom: 19,
maxZoom: 22,

  attribution:
    "Tiles © Esri"
}

).addTo(
mapaLocal
);

/* =====================================================
MARCADOR
===================================================== */

const marcador =
L.marker(
[
latitude,
longitude
]
).addTo(
mapaLocal
);

marcador.bindPopup(
`<strong>${escaparHTML(localAtual.nome || "")}</strong>`
);

/* =====================================================
COMO CHEGAR
===================================================== */

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

setTimeout(
() => {

  if (mapaLocal) {

    mapaLocal.invalidateSize();
  }

},
200

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

area.style.margin =
"20px 0";

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
CRIAR BOTÕES
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

titulo.textContent =
"Gerenciar meu comércio";

titulo.style.fontWeight =
"600";

titulo.style.marginBottom =
"10px";

const botoes =
document.createElement(
"div"
);

botoes.style.display =
"flex";

botoes.style.gap =
"10px";

botoes.style.flexWrap =
"wrap";

/* =====================================================
EDITAR
===================================================== */

const editar =
document.createElement(
"button"
);

editar.type =
"button";

editar.id =
"botaoEditarComercio";

editar.textContent =
"Editar meu comércio";

editar.style.padding =
"11px 16px";

editar.style.border =
"none";

editar.style.borderRadius =
"8px";

editar.style.cursor =
"pointer";

editar.style.background =
"#194138";

editar.style.color =
"#ffffff";

editar.style.fontWeight =
"600";

editar.onclick =
editarMeuComercio;

/* =====================================================
EXCLUIR
===================================================== */

const excluir =
document.createElement(
"button"
);

excluir.type =
"button";

excluir.id =
"botaoExcluirComercio";

excluir.textContent =
"Excluir meu comércio";

excluir.style.padding =
"11px 16px";

excluir.style.border =
"none";

excluir.style.borderRadius =
"8px";

excluir.style.cursor =
"pointer";

excluir.style.background =
"#8b1e1e";

excluir.style.color =
"#ffffff";

excluir.style.fontWeight =
"600";

excluir.onclick =
excluirMeuComercio;

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

/* =========================================================
ESCONDER BOTÕES
========================================================= */

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


/* ===================================================
   BUSCAR CADASTROS DO USUÁRIO
=================================================== */

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


/* ===================================================
   COMPARAR COMÉRCIO ATUAL
=================================================== */

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
OBTER TOKEN
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
  resposta.data.session
    .access_token
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
EDITAR MEU COMÉRCIO
========================================================= */

async function editarMeuComercio() {

if (!localAtual) {
return;
}

const usuario =
await obterUsuarioAutenticadoLocal();

if (!usuario) {

alert(
  "Você precisa estar logado para editar seu comércio."
);

return;

}

const cadastro =
localAtual._cadastroSupabase;

if (!cadastro) {

alert(
  "Não foi possível identificar o cadastro deste comércio."
);

return;

}

const nome =
prompt(
"Nome do comércio:",
localAtual.nome || ""
);

if (nome === null) {
return;
}

const categoria =
prompt(
"Categoria:",
localAtual.categoria || ""
);

if (categoria === null) {
return;
}

const descricao =
prompt(
"Descrição:",
localAtual.descricao || ""
);

if (descricao === null) {
return;
}

const endereco =
prompt(
"Endereço:",
localAtual.endereco || ""
);

if (endereco === null) {
return;
}

const horario =
prompt(
"Horário:",
localAtual.horario || ""
);

if (horario === null) {
return;
}

const telefone =
prompt(
"Telefone:",
localAtual.telefone || ""
);

if (telefone === null) {
return;
}

const whatsapp =
prompt(
"WhatsApp:",
localAtual.whatsapp || ""
);

if (whatsapp === null) {
return;
}

const instagram =
prompt(
"Instagram:",
localAtual.instagram || ""
);

if (instagram === null) {
return;
}

const dadosComercio = {

nome:
  nome.trim(),

categoria:
  categoria.trim(),

descricao:
  descricao.trim(),

endereco:
  endereco.trim(),

horario:
  horario.trim(),

telefone:
  telefone.trim(),

whatsapp:
  whatsapp.trim(),

instagram:
  instagram.trim(),

latitude:
  localAtual.latitude ??
  null,

longitude:
  localAtual.longitude ??
  null,

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

try {

const token =
  await obterTokenSupabase();


if (!token) {

  alert(
    "Sua sessão expirou. Faça login novamente."
  );

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
            "editar_meu_comercio",

          /*
            IMPORTANTE:

            Aqui usamos o UUID real
            do cadastro Supabase.
          */

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


  alert(
    resultado.erro ||
    resultado.error ||
    "Não foi possível editar o comércio."
  );


  return;
}


alert(
  "Comércio atualizado com sucesso."
);


window.location.reload();

} catch (erro) {

console.error(
  "Erro ao editar comércio:",
  erro
);


alert(
  "Erro de conexão ao editar o comércio."
);

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

alert(
  "Você precisa estar logado para excluir seu comércio."
);

return;

}

const cadastro =
localAtual._cadastroSupabase;

if (!cadastro) {

alert(
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

  alert(
    "Sua sessão expirou. Faça login novamente."
  );

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

          /*
            UUID real do cadastro
            no Supabase.
          */

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


  alert(
    resultado.erro ||
    resultado.error ||
    "Não foi possível excluir o comércio."
  );


  return;
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
  "Erro de conexão ao excluir o comércio."
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
    .from("avaliacoes")
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
  media.toFixed(1);

}

if (estrelas) {

estrelas.textContent =
  gerarEstrelas(
    media
  );

}

if (quantidadeElemento) {

quantidadeElemento.textContent =
  `${quantidade} ${
    quantidade === 1
      ? "avaliação"
      : "avaliações"
  }`;

}
}

/* =========================================================
ESTRELAS
========================================================= */

function gerarEstrelas(
nota
) {

const arredondada =
Math.round(
Number(nota) || 0
);

let resultado =
"";

for (
let i = 1;
i <= 5;
i++
) {

resultado +=
  i <= arredondada
    ? "★"
    : "☆";

}

return resultado;
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

lista.innerHTML =
  "<p>Ainda não há avaliações.</p>";

return;

}

avaliacoes.forEach(
avaliacao => {

  const item =
    document.createElement(
      "div"
    );


  item.className =
    "comentario-item";


  const nome =
    avaliacao.nome_usuario ||
    "Usuário";


  const nota =
    Number(
      avaliacao.nota ||
      0
    );


  const comentario =
    avaliacao.comentario ||
    "";


  item.innerHTML = `

    <div class="comentario-cabecalho">

      <strong>
        ${escaparHTML(nome)}
      </strong>

      <span>
        ${gerarEstrelas(nota)}
      </span>

    </div>

    <p>
      ${escaparHTML(comentario)}
    </p>

  `;


  lista.appendChild(
    item
  );
}

);
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
      "Faça login para avaliar este local.";
  }


  avaliacaoAtual =
    null;


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
    .from("avaliacoes")
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


if (avaliacaoAtual) {

  notaSelecionada =
    Number(
      avaliacaoAtual.nota
    );


  atualizarSeletorEstrelas();


  const comentario =
    document.getElementById(
      "textoComentario"
    );


  if (comentario) {

    comentario.value =
      avaliacaoAtual.comentario ||
      "";
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
SELECIONAR NOTA
========================================================= */

function selecionarNota(
nota
) {

notaSelecionada =
Number(nota);

atualizarSeletorEstrelas();
}

function atualizarSeletorEstrelas() {

const botoes =
document.querySelectorAll(
"#seletorEstrelas button"
);

botoes.forEach(
(
botao,
indice
) => {

  const valor =
    indice + 1;


  botao.classList.toggle(
    "selecionada",
    valor <=
      notaSelecionada
  );
}

);
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

alert(
  "Faça login para publicar uma avaliação."
);

return;

}

if (
notaSelecionada < 1 ||
notaSelecionada > 5
) {

alert(
  "Selecione uma nota de 1 a 5 estrelas."
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
  "Escreva um comentário."
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

if (avaliacaoAtual) {

  const resposta =
    await supabase
      .from("avaliacoes")
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

  const resposta =
    await supabase
      .from("avaliacoes")
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


alert(
  "Avaliação publicada com sucesso."
);


await carregarAvaliacoes();

await verificarAvaliacaoUsuario();

} catch (erro) {

console.error(
  "Erro ao publicar avaliação:",
  erro
);


alert(
  "Não foi possível publicar sua avaliação."
);

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
DOM
========================================================= */

document.addEventListener(
"DOMContentLoaded",
() => {

const fecharViewer =
  document.getElementById(
    "close-viewer"
  );


if (fecharViewer) {

  fecharViewer.onclick =
    fecharVisualizador;
}


const publicar =
  document.getElementById(
    "publicarComentario"
  );


if (publicar) {

  publicar.onclick =
    publicarAvaliacao;
}


const botaoSair =
  document.getElementById(
    "botaoSair"
  );


if (botaoSair) {

  botaoSair.onclick =
    sairUsuarioLocal;
}


const botoesEstrelas =
  document.querySelectorAll(
    "#seletorEstrelas button"
  );


botoesEstrelas.forEach(
  (
    botao,
    indice
  ) => {

    botao.addEventListener(
      "click",
      () => {

        selecionarNota(
          indice + 1
        );
      }
    );
  }
);


carregarLocal();

}
);

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
  }
);


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
