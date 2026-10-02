let pessoaAtual = null;
let cadastroMuralAtual = null;

/* =========================================================
CONFIGURAÇÃO
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
CLIENTE SUPABASE
========================================================= */

let pessoaSupabase = null;

function obterClienteSupabasePessoa() {

/*

Se o login.js já criou um cliente global,
tentamos reutilizá-lo.
*/

if (
typeof window.supabaseClient !== "undefined" &&
window.supabaseClient
) {

return window.supabaseClient;

}

if (
typeof window.supabase !== "undefined" &&
typeof window.supabase.createClient === "function"
) {

if (!pessoaSupabase) {

  pessoaSupabase =
    window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY
    );

}

return pessoaSupabase;

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
NORMALIZAR IMAGEM
========================================================= */

function corrigirCaminhoImagem(valor) {

if (!valor) {
return "";
}

/* =======================================================
OBJETO DE IMAGEM
======================================================= */

if (typeof valor === "object") {

if (valor.url) {
  return corrigirCaminhoImagem(valor.url);
}

if (valor.publicUrl) {
  return corrigirCaminhoImagem(valor.publicUrl);
}

if (valor.public_url) {
  return corrigirCaminhoImagem(valor.public_url);
}

if (valor.path) {
  return corrigirCaminhoImagem(valor.path);
}

if (valor.name) {
  return corrigirCaminhoImagem(valor.name);
}

return "";

}

if (typeof valor !== "string") {
return "";
}

let caminho = valor.trim();

if (!caminho) {
return "";
}

/* =======================================================
URL ABSOLUTA
======================================================= */

if (
caminho.startsWith("http://") ||
caminho.startsWith("https://")
) {

return caminho;

}

/* =======================================================
URL DO SUPABASE SEM DOMÍNIO
======================================================= */

if (
caminho.startsWith(
"storage/v1/object/public/"
)
) {

return `${SUPABASE_URL}/${caminho}`;

}

if (
caminho.startsWith(
"/storage/v1/object/public/"
)
) {

return `${SUPABASE_URL}${caminho}`;

}

if (
caminho.startsWith(
"object/public/"
)
) {

return `${SUPABASE_URL}/storage/v1/${caminho}`;

}

/* =======================================================
CAMINHO DO STORAGE COM BUCKET
======================================================= */

caminho = caminho.replace(/^\/+/, "");

if (
caminho.startsWith(
`${SUPABASE_MURAL_BUCKET}/`
)
) {

caminho =
  caminho.substring(
    SUPABASE_MURAL_BUCKET.length + 1
  );

return (
  `${SUPABASE_URL}` +
  `/storage/v1/object/public/` +
  `${SUPABASE_MURAL_BUCKET}/` +
  caminho
);

}

/*

Caso venha no formato:


public/mural-imagens/arquivo.webp
*/

const prefixoPublico =
`public/${SUPABASE_MURAL_BUCKET}/`;

if (
caminho.startsWith(prefixoPublico)
) {

caminho =
  caminho.substring(
    prefixoPublico.length
  );

return (
  `${SUPABASE_URL}` +
  `/storage/v1/object/public/` +
  `${SUPABASE_MURAL_BUCKET}/` +
  caminho
);

}

/* =======================================================
CAMINHOS LOCAIS DO SITE
======================================================= */

if (
caminho.startsWith("./")
) {

return (
  "../" +
  caminho.substring(2)
);

}

if (
caminho.startsWith("../")
) {

return caminho;

}

if (
caminho.startsWith("img/") ||
caminho.startsWith("IMG/") ||
caminho.startsWith("images/") ||
caminho.startsWith("assets/")
) {

return "../" + caminho;

}

/*

Caminho absoluto do próprio site.
*/

if (
caminho.startsWith("/")
) {

return caminho;

}

/* =======================================================
CAMINHO DE IMAGEM DO MURAL
======================================================= */

/*

Se não parece ser um caminho local,
tratamos como arquivo do bucket mural-imagens.


Exemplos:


usuario-id/foto.webp
123456/foto.jpg
perfil/foto.png
*/

return (
`${SUPABASE_URL}` +
`/storage/v1/object/public/` +
`${SUPABASE_MURAL_BUCKET}/` +
caminho
);
}

/* =========================================================
OBTER VALOR DE IMAGEM
========================================================= */

function obterImagemPessoa(pessoa) {

if (!pessoa) {
return "";
}

/* =======================================================
CAMPOS PRINCIPAIS
======================================================= */

const camposPrincipais = [

pessoa.imagem,

pessoa.imagem_url,

pessoa.foto,

pessoa.foto_url,

pessoa.avatar,

pessoa.avatar_url,

pessoa.capa

];

for (
const imagem of camposPrincipais
) {

const caminho =
  corrigirCaminhoImagem(imagem);

if (caminho) {
  return caminho;
}

}

/* =======================================================
ARRAYS DE IMAGENS
======================================================= */

const colecoes = [

pessoa.imagens,

pessoa.galeria,

pessoa.fotos

];

for (
const colecao of colecoes
) {

if (!Array.isArray(colecao)) {
  continue;
}

for (
  const imagem of colecao
) {

  const caminho =
    corrigirCaminhoImagem(imagem);

  if (caminho) {
    return caminho;
  }

}

}

return "";
}

/* =========================================================
OBTER TODAS AS IMAGENS
========================================================= */

function obterGaleriaPessoa(pessoa) {

if (!pessoa) {
return [];
}

const imagens = [];

function adicionarImagem(valor) {

const caminho =
  corrigirCaminhoImagem(valor);

if (
  caminho &&
  !imagens.includes(caminho)
) {

  imagens.push(caminho);

}

}

/* =======================================================
CAMPOS PRINCIPAIS
======================================================= */

adicionarImagem(
pessoa.imagem
);

adicionarImagem(
pessoa.imagem_url
);

adicionarImagem(
pessoa.foto
);

adicionarImagem(
pessoa.foto_url
);

adicionarImagem(
pessoa.avatar
);

adicionarImagem(
pessoa.avatar_url
);

adicionarImagem(
pessoa.capa
);

/* =======================================================
ARRAYS
======================================================= */

const colecoes = [

pessoa.imagens,

pessoa.galeria,

pessoa.fotos

];

for (
const colecao of colecoes
) {

if (!Array.isArray(colecao)) {
  continue;
}

colecao.forEach(
  adicionarImagem
);

}

return imagens;
}

/* =========================================================
CARREGAR PESSOA
========================================================= */

async function carregarPessoa() {

const params =
new URLSearchParams(
window.location.search
);

const id =
params.get("id");

if (!id) {

mostrarErro(
  "Pessoa não encontrada."
);

return;

}

try {

const resposta =
  await fetch(
    "../DATA/pessoas.json?t=" +
    Date.now()
  );

if (!resposta.ok) {

  throw new Error(
    "Não foi possível carregar pessoas.json."
  );

}

const pessoas =
  await resposta.json();

if (!Array.isArray(pessoas)) {

  throw new Error(
    "pessoas.json não possui um array válido."
  );

}

pessoaAtual =
  pessoas.find(
    pessoa =>
      String(pessoa.id) ===
      String(id)
  );

if (!pessoaAtual) {

  mostrarErro(
    "Pessoa não encontrada."
  );

  return;

}

preencherPagina(
  pessoaAtual
);

/*
 * Depois de preencher a página,
 * verificamos se o usuário atual
 * é dono deste perfil.
 */

await verificarProprietarioPerfil(
  pessoaAtual.id
);

}

catch (erro) {

console.error(
  "Erro ao carregar pessoa:",
  erro
);

mostrarErro(
  "Não foi possível carregar as informações."
);

}

}

/* =========================================================
PREENCHER PÁGINA
========================================================= */

function preencherPagina(pessoa) {

const nome =
pessoa.nome ||
"Pessoa";

const categoria =
pessoa.categoria ||
"Pessoa";

document.title =
`${nome} — Guia Turístico de Andrelândia`;

/* =======================================================
CABEÇALHO
======================================================= */

const categoriaCabecalho =
document.getElementById(
"categoriaPessoa"
);

const nomeCabecalho =
document.getElementById(
"nomePessoa"
);

if (categoriaCabecalho) {

categoriaCabecalho.textContent =
  categoria;

}

if (nomeCabecalho) {

nomeCabecalho.textContent =
  nome;

}

/* =======================================================
INTRODUÇÃO
======================================================= */

const categoriaTexto =
document.getElementById(
"categoriaPessoaTexto"
);

const titulo =
document.getElementById(
"tituloPessoa"
);

const descricao =
document.getElementById(
"descricaoPessoa"
);

if (categoriaTexto) {

categoriaTexto.textContent =
  categoria;

}

if (titulo) {

titulo.textContent =
  nome;

}

if (descricao) {

descricao.textContent =
  pessoa.descricao ||
  "";

}

/* =======================================================
SOBRE
======================================================= */

const sobre =
document.getElementById(
"sobrePessoa"
);

if (sobre) {

sobre.textContent =
  pessoa.sobre ||
  pessoa.descricao ||
  "";

}

/* =======================================================
FOTO PRINCIPAL
======================================================= */

const foto =
document.getElementById(
"fotoPessoa"
);

const imagemPrincipal =
obterImagemPessoa(
pessoa
);

if (foto) {

foto.src =
  imagemPrincipal ||
  FALLBACK_IMAGE;

foto.alt =
  nome;

foto.onerror =
  function () {

    if (
      this.dataset.fallback ===
      "true"
    ) {

      return;

    }

    this.dataset.fallback =
      "true";

    this.src =
      FALLBACK_IMAGE;

  };

}

/* =======================================================
INSTAGRAM
======================================================= */

configurarInstagram(
pessoa
);

/* =======================================================
GALERIA
======================================================= */

montarGaleria(
pessoa
);

}

/* =========================================================
INSTAGRAM
========================================================= */

function configurarInstagram(pessoa) {

const botao =
document.getElementById(
"instagramPessoa"
);

if (!botao) {
return;
}

if (
!pessoa.instagram ||
pessoa.instagram === "#"
) {

botao.style.display =
  "none";

return;

}

let instagram =
String(
pessoa.instagram
).trim();

if (!instagram) {

botao.style.display =
  "none";

return;

}

/*

Caso o JSON tenha apenas:


@usuario
*/

if (
instagram.startsWith("@")
) {

instagram =
  "https://instagram.com/" +
  instagram.substring(1);

}

/*

Caso tenha apenas:


instagram.com/usuario
*/

if (
!instagram.startsWith(
"http://"
) &&
!instagram.startsWith(
"https://"
)
) {

instagram =
  "https://" +
  instagram;

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

function montarGaleria(pessoa) {

const galeria =
document.getElementById(
"galeriaPessoa"
);

if (!galeria) {
return;
}

galeria.innerHTML =
"";

const fotos =
obterGaleriaPessoa(
pessoa
);

if (
fotos.length === 0
) {

return;

}

fotos.forEach(
(caminho, index) => {

  if (!caminho) {
    return;
  }

  const item =
    document.createElement(
      "button"
    );

  item.type =
    "button";

  item.className =
    "galeria-item";

  item.setAttribute(
    "aria-label",
    `Abrir foto ${index + 1}`
  );

  const img =
    document.createElement(
      "img"
    );

  img.src =
    caminho;

  img.alt =
    `${pessoa.nome || "Pessoa"} — foto ${index + 1}`;

  img.loading =
    index === 0
      ? "eager"
      : "lazy";

  img.onerror =
    function () {

      item.remove();

    };

  item.appendChild(
    img
  );

  item.addEventListener(
    "click",
    () =>
      abrirFoto(
        caminho
      )
  );

  galeria.appendChild(
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

if (!botao) {
return;
}

/*

Por segurança, começa sempre oculto.
*/

botao.style.display =
"none";

cadastroMuralAtual =
null;

try {

/*
 * Primeiro tentamos usar a função
 * existente do sistema de login.
 */

let usuario = null;

if (
  typeof obterUsuarioLogin ===
  "function"
) {

  try {

    usuario =
      await obterUsuarioLogin();

  }

  catch (erro) {

    console.warn(
      "Não foi possível obter usuário pelo login.js.",
      erro
    );

  }

}

/*
 * Se não conseguimos pelo login.js,
 * tentamos diretamente no Supabase.
 */

const cliente =
  obterClienteSupabasePessoa();

if (
  !usuario &&
  cliente
) {

  const resultado =
    await cliente.auth.getUser();

  usuario =
    resultado?.data?.user ||
    null;

}

if (!usuario) {

  return;

}

if (!cliente) {

  console.warn(
    "Cliente Supabase não disponível para verificar proprietário."
  );

  return;

}

/*
 * Procuramos o cadastro correspondente
 * ao ID público da pessoa.
 */

const resultado =
  await cliente
    .from("mural_cadastros")
    .select(
      "id, usuario_id, status, nome"
    )
    .eq(
      "id",
      pessoaId
    )
    .maybeSingle();

if (
  resultado.error
) {

  console.error(
    "Erro ao consultar proprietário do perfil:",
    resultado.error
  );

  return;

}

const cadastro =
  resultado.data;

if (!cadastro) {

  /*
   * Perfil antigo/manual no JSON.
   * Não existe vínculo com usuário.
   */

  return;

}

cadastroMuralAtual =
  cadastro;

/*
 * Só o próprio usuário pode
 * visualizar o botão.
 */

const ehProprietario =
  String(
    cadastro.usuario_id
  ) ===
  String(
    usuario.id
  );

/*
 * Perfis deletados não podem
 * ser excluídos novamente.
 */

const perfilAtivo =
  cadastro.status ===
    "aprovado" ||
  cadastro.status ===
    "pendente";

if (
  ehProprietario &&
  perfilAtivo
) {

  botao.style.display =
    "flex";

  configurarEstiloBotaoExcluir();

}

}

catch (erro) {

console.error(
  "Erro ao verificar proprietário:",
  erro
);

botao.style.display =
  "none";

}

}

/* =========================================================
ESTILO DO BOTÃO DE EXCLUSÃO
========================================================= */

function configurarEstiloBotaoExcluir() {

const botao =
document.getElementById(
"botaoExcluirPerfil"
);

if (!botao) {
return;
}

/*

O botão recebe somente os estilos necessários
caso eles ainda não existam no pessoa.css.
*/

botao.style.display =
"flex";

botao.style.alignItems =
"center";

botao.style.justifyContent =
"center";

botao.style.gap =
"8px";

botao.style.width =
"100%";

botao.style.marginTop =
"12px";

botao.style.padding =
"12px 16px";

botao.style.border =
"1px solid #d6d6d6";

botao.style.borderRadius =
"8px";

botao.style.background =
"#ffffff";

botao.style.color =
"#555555";

botao.style.fontFamily =
"Roboto, sans-serif";

botao.style.fontSize =
"14px";

botao.style.fontWeight =
"600";

botao.style.cursor =
"pointer";

botao.style.transition =
"all 0.2s ease";

botao.onmouseenter =
function () {

  this.style.background =
    "#f5f5f5";

  this.style.borderColor =
    "#bdbdbd";

};

botao.onmouseleave =
function () {

  this.style.background =
    "#ffffff";

  this.style.borderColor =
    "#d6d6d6";

};

}

/* =========================================================
EXCLUIR MEU PERFIL
========================================================= */

async function excluirMeuPerfil() {

const botao =
document.getElementById(
"botaoExcluirPerfil"
);

if (!botao) {
return;
}

if (!cadastroMuralAtual) {

alert(
  "Não foi possível identificar o cadastro deste perfil."
);

return;

}

const confirmacao =
window.confirm(
"Tem certeza que deseja excluir seu perfil do Mural?\n\n" +
"O perfil será removido da página pública e ficará marcado como deletado. " +
"Você poderá cadastrar outro perfil depois."
);

if (!confirmacao) {
return;
}

const confirmacaoFinal =
window.confirm(
"Esta ação removerá seu perfil do Mural.\n\n" +
"Deseja realmente continuar?"
);

if (!confirmacaoFinal) {
return;
}

const cliente =
obterClienteSupabasePessoa();

if (!cliente) {

alert(
  "Não foi possível conectar ao sistema de autenticação."
);

return;

}

try {

botao.disabled =
  true;

const textoOriginal =
  botao.innerHTML;

botao.dataset.textoOriginal =
  textoOriginal;

botao.innerHTML =
  "<span>Excluindo...</span>";

/*
 * Obtém a sessão atual para enviar
 * o JWT à Edge Function.
 */

const sessao =
  await cliente.auth.getSession();

const accessToken =
  sessao?.data?.session?.access_token;

if (!accessToken) {

  throw new Error(
    "Sessão de usuário não encontrada."
  );

}

/*
 * A Edge Function faz a verificação
 * definitiva de propriedade.
 *
 * Nunca confiamos apenas no JavaScript
 * do navegador para autorização.
 */

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

      body: JSON.stringify({
        action:
          "excluir_mural",

        pessoa_id:
          pessoaAtual.id
      })
    }
  );

const resultado =
  await resposta.json()
  .catch(
    () => ({})
  );

if (!resposta.ok) {

  throw new Error(
    resultado.error ||
    resultado.message ||
    "Não foi possível excluir o perfil."
  );

}

if (
  resultado.success === false
) {

  throw new Error(
    resultado.error ||
    "A exclusão não foi concluída."
  );

}

alert(
  "Seu perfil foi excluído com sucesso."
);

/*
 * O perfil já foi removido do JSON
 * pela Edge Function.
 *
 * Voltamos para a página inicial.
 */

window.location.href =
  "../index.html";

}

catch (erro) {

console.error(
  "Erro ao excluir perfil:",
  erro
);

alert(
  erro.message ||
  "Não foi possível excluir seu perfil."
);

botao.disabled =
  false;

if (
  botao.dataset.textoOriginal
) {

  botao.innerHTML =
    botao.dataset.textoOriginal;

}

configurarEstiloBotaoExcluir();

}

}

/* =========================================================
ABRIR FOTO
========================================================= */

function abrirFoto(foto) {

if (!foto) {
return;
}

const viewer =
document.getElementById(
"photoViewer"
);

const image =
document.getElementById(
"viewerImage"
);

if (
!viewer ||
!image
) {

return;

}

image.src =
foto;

image.alt =
pessoaAtual?.nome ||
"Foto";

image.onerror =
function () {

  this.src =
    FALLBACK_IMAGE;

};

viewer.classList.add(
"open"
);

document.body.style.overflow =
"hidden";

}

/* =========================================================
FOTO PRINCIPAL EM TELA CHEIA
========================================================= */

function abrirFotoTelaCheia() {

if (!pessoaAtual) {
return;
}

const foto =
obterImagemPessoa(
pessoaAtual
);

if (foto) {

abrirFoto(
  foto
);

}

}

/* =========================================================
FECHAR FOTO
========================================================= */

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

/* =========================================================
ESC
========================================================= */

document.addEventListener(
"keydown",
event => {

if (
  event.key ===
  "Escape"
) {

  fecharFotoTelaCheia();

}

}
);

/* =========================================================
CLICAR FORA DA FOTO
========================================================= */

document
.getElementById(
"photoViewer"
)
?.addEventListener(
"click",
event => {

  if (
    event.target.id ===
    "photoViewer"
  ) {

    fecharFotoTelaCheia();

  }

}

);

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

}

else {

window.location.href =
  "../index.html";

}

}

/* =========================================================
ERRO
========================================================= */

function mostrarErro(
mensagem
) {

const categoria =
document.getElementById(
"categoriaPessoa"
);

const nome =
document.getElementById(
"nomePessoa"
);

if (categoria) {

categoria.textContent =
  "ERRO";

}

if (nome) {

nome.textContent =
  mensagem;

}

const apresentacao =
document.querySelector(
".pessoa-apresentacao"
);

const sobre =
document.querySelector(
".sobre-pessoa"
);

const galeria =
document.querySelector(
".galeria-pessoa"
);

if (apresentacao) {

apresentacao.style.display =
  "none";

}

if (sobre) {

sobre.style.display =
  "none";

}

if (galeria) {

galeria.style.display =
  "none";

}

}
