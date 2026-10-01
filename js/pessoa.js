let pessoaAtual = null;

/* =========================================================
CONFIGURAÇÃO
========================================================= */

const SUPABASE_URL =
"https://xdmbkflufsfqziixzpxc.supabase.co";

const SUPABASE_MURAL_BUCKET =
"mural";

const FALLBACK_IMAGE =
"../img/sem-foto.png";

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

/*

Aceita:




URL completa:
https://...




URL do Supabase Storage:
https://.../storage/v1/object/public/mural/...




Caminho do bucket:
usuario/arquivo.webp




Caminho antigo:
./img/pessoas/arquivo.jpeg




Caminho relativo:
img/pessoas/arquivo.jpeg




Objeto:
{ url: "..." }
{ path: "..." }
*/

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

let caminho =
valor.trim();

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
URL DO SUPABASE SEM O DOMÍNIO
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
CAMINHO DO BUCKET MURAL
======================================================= */

caminho =
caminho.replace(/^\/+/, "");

if (
caminho.startsWith("mural/")
) {

caminho =
  caminho.substring(6);

}

/*

Se não parece ser um caminho antigo
do site, tratamos como arquivo do bucket mural.


Exemplos:


usuario-id/foto.webp
123456/foto.jpg
*/

if (
!caminho.startsWith("./") &&
!caminho.startsWith("../") &&
!caminho.startsWith("img/") &&
!caminho.startsWith("IMG/") &&
!caminho.startsWith("images/") &&
!caminho.startsWith("assets/")
) {

return (
  `${SUPABASE_URL}` +
  `/storage/v1/object/public/` +
  `${SUPABASE_MURAL_BUCKET}/` +
  caminho
);

}

/* =======================================================
CAMINHO ANTIGO DO SITE
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

return "../" + caminho;

}

/* =========================================================
OBTER VALOR DE IMAGEM
========================================================= */

function obterImagemPessoa(pessoa) {

if (!pessoa) {
return "";
}

/*

Novo formato
*/

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

if (
  !Array.isArray(colecao)
) {
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

/*

Adiciona uma imagem evitando duplicadas.
*/

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
NOVO FORMATO
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

if (
  !Array.isArray(colecao)
) {
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


if (
  !Array.isArray(pessoas)
) {

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

if (
!instagram
) {

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

/*

Se não houver imagens,
não deixa a galeria quebrada.
*/

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

      /*
       * Remove somente a miniatura
       * que não conseguiu carregar.
       */

      item.remove();

    };


  item.appendChild(
    img
  );


  item.addEventListener(
    "click",
    () => abrirFoto(caminho)
  );


  galeria.appendChild(
    item
  );

}

);

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
  event.key === "Escape"
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

function mostrarErro(mensagem) {

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
