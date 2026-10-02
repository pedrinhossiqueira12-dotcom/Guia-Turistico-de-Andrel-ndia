/* =========================================================
ANDRELÂNDIA — GUIA TURÍSTICO
PESSOA.JS

RESPONSABILIDADES:

Carregar perfil público
Exibir foto e galeria
Exibir Instagram
Verificar proprietário do perfil
Exibir botão "Excluir meu perfil"
Solicitar exclusão segura pela Edge Function
========================================================= */

/* =========================================================
CONFIGURAÇÕES
========================================================= */

const SUPABASE_URL =
"https://xdmbkflufsfqziixzpxc.supabase.co";

const SUPABASE_ANON_KEY =
"sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";

const SUPABASE_MURAL_BUCKET =
"mural-imagens";

const EDGE_FUNCTION_URL =
`${SUPABASE_URL}/functions/v1/whatsapp-bot`;

const FALLBACK_IMAGE =
"../img/sem-foto.png";

/* =========================================================
ESTADO
========================================================= */

let pessoaAtual = null;
let cadastroMuralAtual = null;

/* =========================================================
CLIENTE SUPABASE
========================================================= */

function obterClienteSupabasePessoa() {

/*
Primeiro tenta utilizar o cliente já criado pelo
login.js para evitar criar múltiplas instâncias.
*/

if (window.supabaseClient) {
return window.supabaseClient;
}

/*
Caso o login.js não tenha criado o cliente,
tenta criar utilizando a biblioteca Supabase disponível.
*/

if (
window.supabase &&
typeof window.supabase.createClient === "function"
) {

window.supabaseClient =
  window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );

return window.supabaseClient;

}

return null;
}

/* =========================================================
INICIALIZAÇÃO
========================================================= */

document.addEventListener(
"DOMContentLoaded",
carregarPessoa
);

/* =========================================================
CARREGAR PESSOA
========================================================= */

async function carregarPessoa() {

try {

const parametros =
  new URLSearchParams(
    window.location.search
  );

const id =
  parametros.get("id");

if (!id) {

  mostrarErro(
    "Perfil não encontrado."
  );

  return;
}


const resposta =
  await fetch(
    `../DATA/pessoas.json?t=${Date.now()}`
  );

if (!resposta.ok) {

  throw new Error(
    "Não foi possível carregar os perfis."
  );
}


const pessoas =
  await resposta.json();


pessoaAtual =
  pessoas.find(
    pessoa =>
      String(pessoa.id) === String(id)
  );


if (!pessoaAtual) {

  mostrarErro(
    "Perfil não encontrado."
  );

  return;
}


preencherPagina(
  pessoaAtual
);


/*
   A verificação do proprietário acontece
   depois que o perfil público foi carregado.
*/

await verificarProprietarioPerfil(
  pessoaAtual.id
);

} catch (erro) {

console.error(
  "Erro ao carregar perfil:",
  erro
);

mostrarErro(
  "Não foi possível carregar este perfil."
);

}

}

/* =========================================================
PREENCHER PÁGINA
========================================================= */

function preencherPagina(
pessoa
) {

document.title =
`${pessoa.nome || "Perfil"} — Andrelândia`;

const titulo =
document.getElementById(
"tituloPessoa"
);

const nome =
document.getElementById(
"nomePessoa"
);

const categoria =
document.getElementById(
"categoriaPessoa"
);

const categoriaTexto =
document.getElementById(
"categoriaPessoaTexto"
);

const descricao =
document.getElementById(
"descricaoPessoa"
);

const sobre =
document.getElementById(
"sobrePessoa"
);

const foto =
document.getElementById(
"fotoPessoa"
);

if (titulo) {

titulo.textContent =
  pessoa.nome || "Perfil";

}

if (nome) {

nome.textContent =
  pessoa.nome || "";

}

if (categoria) {

categoria.textContent =
  pessoa.categoria || "";

categoria.style.display =
  pessoa.categoria
    ? ""
    : "none";

}

if (categoriaTexto) {

categoriaTexto.textContent =
  pessoa.categoria || "";

categoriaTexto.style.display =
  pessoa.categoria
    ? ""
    : "none";

}

if (descricao) {

descricao.textContent =
  pessoa.descricao || "";

descricao.style.display =
  pessoa.descricao
    ? ""
    : "none";

}

if (sobre) {

sobre.textContent =
  pessoa.sobre || "";

sobre.style.display =
  pessoa.sobre
    ? ""
    : "none";

}

if (foto) {

foto.src =
  obterImagemPessoa(
    pessoa
  );

foto.alt =
  pessoa.nome
    ? `Foto de ${pessoa.nome}`
    : "Foto do perfil";

foto.onerror =
  function () {

    this.onerror = null;

    this.src =
      FALLBACK_IMAGE;

  };

}

configurarInstagram(
pessoa
);

montarGaleria(
pessoa
);

}

/* =========================================================
CORRIGIR CAMINHO DE IMAGEM
========================================================= */

function corrigirCaminhoImagem(
imagem
) {

if (!imagem) {
return FALLBACK_IMAGE;
}

/* -----------------------------------------
OBJETO
----------------------------------------- */

if (
typeof imagem === "object" &&
imagem !== null
) {

imagem =
  imagem.url ||
  imagem.path ||
  imagem.caminho ||
  imagem.src ||
  imagem.nome ||
  "";

}

if (
typeof imagem !== "string"
) {

return FALLBACK_IMAGE;

}

let caminho =
imagem.trim();

if (!caminho) {
return FALLBACK_IMAGE;
}

/* -----------------------------------------
URL ABSOLUTA
----------------------------------------- */

if (
caminho.startsWith("http://") ||
caminho.startsWith("https://") ||
caminho.startsWith("data:")
) {

return caminho;

}

/* -----------------------------------------
CAMINHO SUPABASE STORAGE
----------------------------------------- */

if (
caminho.includes(
"/storage/v1/object/"
)
) {

if (
  caminho.includes(
    "/storage/v1/object/public/"
  )
) {

  return caminho;

}


const indice =
  caminho.indexOf(
    "/storage/v1/object/"
  );


if (indice !== -1) {

  const parte =
    caminho.substring(
      indice
    );


  return (
    SUPABASE_URL +
    parte.replace(
      "/storage/v1/object/",
      "/storage/v1/object/public/"
    )
  );

}

}

/* -----------------------------------------
REMOVER BARRAS INICIAIS
----------------------------------------- */

caminho =
caminho.replace(
/^\/+/,
""
);

/* -----------------------------------------
JÁ É CAMINHO LOCAL
----------------------------------------- */

if (
caminho.startsWith("../") ||
caminho.startsWith("./") ||
caminho.startsWith("img/")
) {

return caminho;

}

/* -----------------------------------------
CAMINHO DO BUCKET MURAL
----------------------------------------- */

if (
caminho.startsWith(
`${SUPABASE_MURAL_BUCKET}/`
)
) {

const arquivo =
  caminho.substring(
    `${SUPABASE_MURAL_BUCKET}/`.length
  );


return (
  `${SUPABASE_URL}/storage/v1/object/public/` +
  `${SUPABASE_MURAL_BUCKET}/${arquivo}`
);

}

/* -----------------------------------------
ARQUIVO DO BUCKET
----------------------------------------- */

return (
`${SUPABASE_URL}/storage/v1/object/public/` +
`${SUPABASE_MURAL_BUCKET}/${caminho}`
);

}

/* =========================================================
OBTER IMAGEM PRINCIPAL
========================================================= */

function obterImagemPessoa(
pessoa
) {

if (!pessoa) {
return FALLBACK_IMAGE;
}

const imagem =
pessoa.imagem ||
pessoa.foto ||
pessoa.image ||
pessoa.avatar;

return corrigirCaminhoImagem(
imagem
);

}

/* =========================================================
OBTER GALERIA
========================================================= */

function obterGaleriaPessoa(
pessoa
) {

if (!pessoa) {
return [];
}

let galeria =
pessoa.imagens ||
pessoa.galeria ||
pessoa.fotos ||
[];

if (!Array.isArray(galeria)) {

galeria =
  [galeria];

}

return galeria
.filter(Boolean)
.map(
corrigirCaminhoImagem
);

}

/* =========================================================
INSTAGRAM
========================================================= */

function configurarInstagram(
pessoa
) {

const botao =
document.getElementById(
"instagramPessoa"
);

if (!botao) {
return;
}

let instagram =
pessoa.instagram || "";

instagram =
String(
instagram
).trim();

if (!instagram) {

botao.style.display =
  "none";

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

botao.href =
instagram;

botao.target =
"_blank";

botao.rel =
"noopener noreferrer";

botao.style.display =
"";

}

/* =========================================================
GALERIA
========================================================= */

function montarGaleria(
pessoa
) {

const galeriaElemento =
document.getElementById(
"galeriaPessoa"
);

if (!galeriaElemento) {
return;
}

galeriaElemento.innerHTML =
"";

const galeria =
obterGaleriaPessoa(
pessoa
);

const imagemPrincipal =
obterImagemPessoa(
pessoa
);

const todasImagens = [
imagemPrincipal,
...galeria
];

const imagensUnicas =
[
...new Set(
todasImagens.filter(Boolean)
)
];

imagensUnicas.forEach(
(
imagem,
indice
) => {

  const item =
    document.createElement(
      "img"
    );


  item.src =
    imagem;


  item.alt =
    `${pessoa.nome || "Perfil"} — foto ${indice + 1}`;


  item.loading =
    "lazy";


  item.onerror =
    function () {

      this.onerror = null;

      this.src =
        FALLBACK_IMAGE;

    };


  item.addEventListener(
    "click",
    () => {

      abrirVisualizador(
        imagem
      );

    }
  );


  galeriaElemento.appendChild(
    item
  );

}

);

}

/* =========================================================
VERIFICAR PROPRIETÁRIO
========================================================= */

async function verificarProprietarioPerfil(
pessoaId
) {

const botao =
document.getElementById(
"botaoExcluirPerfil"
);

/*
Por segurança, o botão começa sempre escondido.
*/

if (botao) {

botao.style.display =
  "none";

}

cadastroMuralAtual =
null;

try {

const supabase =
  obterClienteSupabasePessoa();


if (!supabase) {

  console.warn(
    "Cliente Supabase não disponível."
  );

  return;

}


/* -----------------------------------------
   OBTER USUÁRIO AUTENTICADO
----------------------------------------- */

let usuario =
  null;


/*
   Primeiro utiliza o sistema de login
   existente, se disponível.
*/

if (
  typeof obterUsuarioLogin ===
  "function"
) {

  try {

    usuario =
      await obterUsuarioLogin();

  } catch (erroLogin) {

    console.warn(
      "Não foi possível obter usuário pelo login.js:",
      erroLogin
    );

  }

}


/*
   Fallback direto para Supabase Auth.
*/

if (!usuario) {

  const resultadoAuth =
    await supabase.auth.getUser();


  usuario =
    resultadoAuth.data?.user ||
    null;

}


/*
   Visitante não pode visualizar o botão.
*/

if (!usuario) {
  return;
}


/* -----------------------------------------
   LOCALIZAR CADASTRO
----------------------------------------- */

const resposta =
  await supabase
    .from("mural_cadastros")
    .select(
      "id, usuario_id, status"
    )
    .eq(
      "id",
      pessoaId
    )
    .maybeSingle();


if (resposta.error) {

  console.error(
    "Erro ao localizar cadastro do mural:",
    resposta.error
  );

  return;

}


cadastroMuralAtual =
  resposta.data ||
  null;


if (!cadastroMuralAtual) {
  return;
}


/* -----------------------------------------
   CONFIRMAR PROPRIETÁRIO
----------------------------------------- */

const ehProprietario =
  String(
    cadastroMuralAtual.usuario_id
  ) ===
  String(
    usuario.id
  );


/*
   Perfis públicos existentes no
   pessoas.json devem estar aprovados.

   O status pendente é mantido fora do
   controle público.
*/

const statusPermitido =
  cadastroMuralAtual.status ===
  "aprovado";


if (
  ehProprietario &&
  statusPermitido &&
  botao
) {

  botao.style.display =
    "inline-flex";

  configurarEstiloBotaoExcluir();

}

} catch (erro) {

console.error(
  "Erro ao verificar proprietário do perfil:",
  erro
);

/*
   Em qualquer erro, o botão permanece oculto.
*/

if (botao) {

  botao.style.display =
    "none";

}

}

}

/* =========================================================
ESTILO DO BOTÃO EXCLUIR
========================================================= */

function configurarEstiloBotaoExcluir() {

const botao =
document.getElementById(
"botaoExcluirPerfil"
);

if (!botao) {
return;
}

botao.style.alignItems =
"center";

botao.style.justifyContent =
"center";

botao.style.gap =
"8px";

botao.style.width =
"100%";

botao.style.marginTop =
"20px";

botao.style.padding =
"12px 18px";

botao.style.border =
"1px solid #b42318";

botao.style.borderRadius =
"8px";

botao.style.background =
"#ffffff";

botao.style.color =
"#b42318";

botao.style.fontSize =
"14px";

botao.style.fontWeight =
"600";

botao.style.cursor =
"pointer";

botao.style.boxSizing =
"border-box";

}

/* =========================================================
EXCLUIR MEU PERFIL
========================================================= */

async function excluirMeuPerfil() {

if (!pessoaAtual) {

alert(
  "Perfil não encontrado."
);

return;

}

/*
Confirmação antes de iniciar a exclusão.
*/

const confirmou =
confirm(
"Tem certeza que deseja excluir seu perfil?\n\n" +
"O perfil será removido do mural público e " +
"marcado como deletado no sistema.\n\n" +
"Esta ação não poderá ser desfeita."
);

if (!confirmou) {
return;
}

const botao =
document.getElementById(
"botaoExcluirPerfil"
);

try {

if (botao) {

  botao.disabled =
    true;

  botao.style.opacity =
    "0.6";

  botao.style.cursor =
    "wait";

  botao.innerHTML =
    "Excluindo...";

}


const supabase =
  obterClienteSupabasePessoa();


if (!supabase) {

  throw new Error(
    "Não foi possível conectar ao Supabase."
  );

}


/* -----------------------------------------
   OBTER SESSÃO ATUAL
----------------------------------------- */

const sessao =
  await supabase.auth.getSession();


const accessToken =
  sessao.data?.session?.access_token;


if (!accessToken) {

  throw new Error(
    "Sua sessão expirou. Faça login novamente."
  );

}


/* -----------------------------------------
   CHAMAR EDGE FUNCTION
----------------------------------------- */

const resposta =
  await fetch(
    EDGE_FUNCTION_URL,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",

        "Authorization":
          `Bearer ${accessToken}`
      },

      body:
        JSON.stringify({
          acao:
            "excluir_mural",

          pessoa_id:
            pessoaAtual.id
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
    {};

}


/* -----------------------------------------
   ERRO HTTP
----------------------------------------- */

if (!resposta.ok) {

  throw new Error(
    resultado.erro ||
    resultado.error ||
    resultado.message ||
    "Não foi possível excluir o perfil."
  );

}


/* -----------------------------------------
   ERRO RETORNADO PELA EDGE FUNCTION
----------------------------------------- */

if (
  resultado.sucesso === false
) {

  throw new Error(
    resultado.erro ||
    resultado.error ||
    resultado.message ||
    "A exclusão não foi concluída."
  );

}


/* -----------------------------------------
   SUCESSO
----------------------------------------- */

alert(
  resultado.mensagem ||
  "Seu perfil foi excluído com sucesso."
);


/*
   Volta para a página inicial.
   O pessoas.json já foi atualizado
   pela Edge Function.
*/

window.location.href =
  "../index.html";

} catch (erro) {

console.error(
  "Erro ao excluir perfil:",
  erro
);


alert(
  erro.message ||
  "Não foi possível excluir o perfil."
);


if (botao) {

  botao.disabled =
    false;

  botao.innerHTML =
    `
      <span class="botao-excluir-perfil-icone">
        ×
      </span>

      <span>
        Excluir meu perfil
      </span>
    `;

  botao.style.opacity =
    "1";

  botao.style.cursor =
    "pointer";

  configurarEstiloBotaoExcluir();

}

}

}

/* =========================================================
VISUALIZADOR DE FOTOS
========================================================= */

function abrirVisualizador(
imagem
) {

const viewer =
document.getElementById(
"photoViewer"
);

const viewerImage =
document.getElementById(
"viewerImage"
);

if (
!viewer ||
!viewerImage
) {

return;

}

viewerImage.src =
imagem;

viewerImage.alt =
pessoaAtual?.nome
? `Foto de ${pessoaAtual.nome}`
: "Foto do perfil";

viewer.style.display =
"flex";

document.body.style.overflow =
"hidden";

}

/* =========================================================
FECHAR VISUALIZADOR
========================================================= */

function fecharVisualizador() {

const viewer =
document.getElementById(
"photoViewer"
);

if (!viewer) {
return;
}

viewer.style.display =
"none";

document.body.style.overflow =
"";

}

/* =========================================================
ESC FECHA VISUALIZADOR
========================================================= */

document.addEventListener(
"keydown",
function (evento) {

if (
  evento.key === "Escape"
) {

  fecharVisualizador();

}

}
);

/* =========================================================
CLIQUE FORA DA IMAGEM
========================================================= */

document.addEventListener(
"click",
function (evento) {

const viewer =
  document.getElementById(
    "photoViewer"
  );


if (!viewer) {
  return;
}


if (
  evento.target === viewer
) {

  fecharVisualizador();

}

}
);

/* =========================================================
VOLTAR
========================================================= */

function voltarPagina() {

if (
window.history.length > 1
) {

window.history.back();

} else {

window.location.href =
  "../index.html";

}

}

/* =========================================================
MOSTRAR ERRO
========================================================= */

function mostrarErro(
mensagem
) {

const nome =
document.getElementById(
"nomePessoa"
);

const descricao =
document.getElementById(
"descricaoPessoa"
);

if (nome) {

nome.textContent =
  mensagem;

}

if (descricao) {

descricao.textContent =
  "";

descricao.style.display =
  "none";

}

const foto =
document.getElementById(
"fotoPessoa"
);

if (foto) {

foto.src =
  FALLBACK_IMAGE;

}

const botaoExcluir =
document.getElementById(
"botaoExcluirPerfil"
);

if (botaoExcluir) {

botaoExcluir.style.display =
  "none";

}

}
