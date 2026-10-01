/* =========================================================
ANDRELÂNDIA — GUIA TURÍSTICO
CADASTROS.JS

RESPONSABILIDADE:

Cadastro público de comércio
Envio para análise
Upload de imagem
Integração com Supabase
Integração com login.js

NÃO CONTÉM:

Login
Logout
Autenticação
Aprovação administrativa
========================================================= */

/* =========================================================
CONFIGURAÇÃO SUPABASE
========================================================= */

const CADASTROS_SUPABASE_URL =
"https://xdmbkflufsfqziixzpxc.supabase.co";

const CADASTROS_SUPABASE_KEY =
"sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";

/* =========================================================
CLIENTE SUPABASE
========================================================= */

const cadastrosSupabase =
window.supabase.createClient(
CADASTROS_SUPABASE_URL,
CADASTROS_SUPABASE_KEY
);

/* =========================================================
ELEMENTOS
========================================================= */

const opcaoNovo =
document.getElementById(
"opcaoNovo"
);

const opcaoAlteracao =
document.getElementById(
"opcaoAlteracao"
);

const opcoes =
document.getElementById(
"opcoes"
);

const formularioContainer =
document.getElementById(
"formularioContainer"
);

const tituloFormulario =
document.getElementById(
"tituloFormulario"
);

const descricaoFormulario =
document.getElementById(
"descricaoFormulario"
);

const botaoCancelar =
document.getElementById(
"botaoCancelar"
);

const formulario =
document.getElementById(
"formularioCadastro"
);

const aviso =
document.getElementById(
"aviso"
);

/* =========================================================
ESTADO
========================================================= */

let tipoCadastro =
"novo_comercio";

/* =========================================================
AVISO
========================================================= */

function mostrarAviso(
mensagem,
tipo = "info"
) {

if (!aviso) {
return;
}

aviso.textContent =
mensagem;

aviso.className =
"aviso ativo";

if (
tipo ===
"erro"
) {

aviso.classList.add(
  "aviso-erro"
);

} else {

aviso.classList.add(
  "aviso-info"
);

}

}

/* =========================================================
LIMPAR AVISO
========================================================= */

function limparAviso() {

if (!aviso) {
return;
}

aviso.textContent =
"";

aviso.className =
"aviso";

}

/* =========================================================
ABRIR FORMULÁRIO
========================================================= */

function abrirFormulario(
tipo
) {

if (!formulario) {
return;
}

formulario.reset();

limparAviso();

tipoCadastro =
tipo;

if (formularioContainer) {

formularioContainer.classList.add(
  "ativo"
);

}

if (opcoes) {

opcoes.style.display =
  "none";

}

/* -------------------------------------------------------
NOVO COMÉRCIO
------------------------------------------------------- */

if (
tipo ===
"novo_comercio"
) {

if (tituloFormulario) {

  tituloFormulario.textContent =
    "Cadastrar comércio";

}


if (descricaoFormulario) {

  descricaoFormulario.textContent =
    "Preencha as informações abaixo. " +
    "O cadastro será analisado antes de ser publicado no guia.";

}

return;

}

/* -------------------------------------------------------
ALTERAÇÃO
------------------------------------------------------- */

if (tituloFormulario) {

tituloFormulario.textContent =
  "Sugerir alteração";

}

if (descricaoFormulario) {

descricaoFormulario.textContent =
  "A seleção do comércio existente será adicionada " +
  "na próxima etapa.";

}

mostrarAviso(
"A função de alteração será ativada na próxima etapa. " +
"Primeiro vamos concluir o cadastro de novos comércios."
);

}

/* =========================================================
FECHAR FORMULÁRIO
========================================================= */

function fecharFormulario() {

if (formularioContainer) {

formularioContainer.classList.remove(
  "ativo"
);

}

if (opcoes) {

opcoes.style.display =
  "";

}

if (formulario) {

formulario.reset();

}

limparAviso();

tipoCadastro =
"novo_comercio";

}

/* =========================================================
COORDENADAS
========================================================= */

function converterCoordenada(
valor
) {

if (!valor) {
return null;
}

const numero =
Number(
String(valor)
.trim()
.replace(",", ".")
);

if (
!Number.isFinite(
numero
)
) {

return null;

}

return numero;

}

/* =========================================================
WHATSAPP
========================================================= */

function normalizarWhatsapp(
valor
) {

if (!valor) {
return "";
}

return String(valor)
.replace(
/\D/g,
""
);

}

/* =========================================================
OBTER USUÁRIO
========================================================= */

async function obterUsuarioCadastro() {

/*

Primeiro tenta utilizar o estado
mantido pelo login.js.
*/

if (
typeof obterUsuarioLogin ===
"function"
) {

const usuario =
  obterUsuarioLogin();


if (usuario) {

  return usuario;

}

}

/*

Caso a sessão ainda não tenha sido
disponibilizada pelo login.js,
consultamos diretamente o Supabase.
*/

try {

const {
  data,
  error
} =
  await cadastrosSupabase.auth.getUser();


if (error) {

  console.error(
    "Erro ao obter usuário:",
    error
  );

  return null;

}


return (
  data?.user ||
  null
);

} catch (erro) {

console.error(
  "Erro ao consultar sessão:",
  erro
);

return null;

}

}

/* =========================================================
VERIFICAR LOGIN
========================================================= */

async function verificarLoginCadastro() {

/*

Obtém o usuário atual.
*/

const usuario =
await obterUsuarioCadastro();

/*

Usuário já está logado.
*/

if (usuario) {

return usuario;

}

/*

Usuário não está logado.


Abre o mesmo modal utilizado
pelo index.html e local.html.
*/

if (
typeof abrirModalAuth ===
"function"
) {

abrirModalAuth(
  "login"
);

} else {

console.error(
  "A função abrirModalAuth() não está disponível. " +
  "Verifique se login.js foi carregado antes de cadastros.js."
);

}

mostrarAviso(
"Para enviar um cadastro, entre na sua conta ou crie uma conta.",
"erro"
);

return null;

}

/* =========================================================
OBTENER ARQUIVO DA FOTO
========================================================= */

function obterArquivoImagem() {

/*

O formulário utiliza normalmente:


id="imagem"


Também aceitamos:


id="foto"
*/

const campoImagem =
document.getElementById(
"imagem"
) ||
document.getElementById(
"foto"
);

if (!campoImagem) {

console.warn(
  "Campo de imagem não encontrado."
);

return null;

}

return (
campoImagem.files?.[0] ||
null
);

}

/* =========================================================
VALIDAR IMAGEM
========================================================= */

function validarImagem(
arquivo
) {

if (!arquivo) {
return;
}

/* -------------------------------------------------------
TAMANHO MÁXIMO
------------------------------------------------------- */

const tamanhoMaximo =
5 * 1024 * 1024;

if (
arquivo.size >
tamanhoMaximo
) {

throw new Error(
  "A imagem deve ter no máximo 5 MB."
);

}

/* -------------------------------------------------------
FORMATOS PERMITIDOS
------------------------------------------------------- */

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
  "A imagem deve estar em JPG, PNG ou WEBP."
);

}

}

/* =========================================================
GERAR NOME DA IMAGEM
========================================================= */

function gerarNomeImagem(
usuarioId,
arquivo
) {

const extensao =
arquivo.name
.split(".")
.pop()
.toLowerCase()
.replace(
/[^a-z0-9]/g,
""
) ||
"jpg";

const nomeSeguro =
String(
arquivo.name
)
.replace(
/[.][^/.]+$/,
""
)
.normalize(
"NFD"
)
.replace(
/[\u0300-\u036f]/g,
""
)
.replace(
/[^a-zA-Z0-9_-]/g,
"-"
)
.toLowerCase()
.substring(
0,
60
);

const identificador =
Date.now() +
"-" +
Math.random()
.toString(36)
.substring(
2,
9
);

return (
usuarioId +
"/" +
identificador +
"-" +
nomeSeguro +
"." +
extensao
);

}

/* =========================================================
UPLOAD DA IMAGEM
========================================================= */

async function enviarImagem(
arquivo,
usuario
) {

if (!arquivo) {

return null;

}

validarImagem(
arquivo
);

const caminho =
gerarNomeImagem(
usuario.id,
arquivo
);

console.log(
"Enviando imagem para:",
caminho
);

const {
error
} =
await cadastrosSupabase
.storage
.from(
"cadastros"
)
.upload(
caminho,
arquivo,
{

      cacheControl:
        "3600",

      upsert:
        false,

      contentType:
        arquivo.type

    }
  );

if (error) {

console.error(
  "Erro ao enviar imagem:",
  error
);


throw new Error(
  "Não foi possível enviar a imagem: " +
  error.message
);

}

/* -------------------------------------------------------
GERAR URL PÚBLICA
------------------------------------------------------- */

const {
data
} =
cadastrosSupabase
.storage
.from(
"cadastros"
)
.getPublicUrl(
caminho
);

const imagemUrl =
data?.publicUrl ||
null;

if (!imagemUrl) {

throw new Error(
  "A imagem foi enviada, mas não foi possível obter sua URL."
);

}

console.log(
"Imagem enviada:",
imagemUrl
);

return imagemUrl;

}

/* =========================================================
ENVIAR CADASTRO
========================================================= */

async function enviarCadastro(
evento
) {

evento.preventDefault();

/* -------------------------------------------------------
VERIFICAR LOGIN
------------------------------------------------------- */

const usuario =
await verificarLoginCadastro();

if (!usuario) {

return;

}

/* -------------------------------------------------------
TIPO
------------------------------------------------------- */

if (
tipoCadastro !==
"novo_comercio"
) {

mostrarAviso(
  "A função de alteração será ativada na próxima etapa.",
  "erro"
);

return;

}

/* -------------------------------------------------------
BOTÃO
------------------------------------------------------- */

const botaoEnviar =
formulario?.querySelector(
'button[type="submit"]'
);

if (!botaoEnviar) {

console.error(
  "Botão de envio do formulário não encontrado."
);

return;

}

const textoOriginal =
botaoEnviar.textContent;

botaoEnviar.disabled =
true;

botaoEnviar.textContent =
"Enviando...";

try {

/* -----------------------------------------------------
   CAMPOS
----------------------------------------------------- */

const campoNome =
  document.getElementById(
    "nome"
  );

const campoCategoria =
  document.getElementById(
    "categoria"
  );

const campoWhatsapp =
  document.getElementById(
    "whatsapp"
  );

const campoInstagram =
  document.getElementById(
    "instagram"
  );

const campoEndereco =
  document.getElementById(
    "endereco"
  );

const campoHorario =
  document.getElementById(
    "horario"
  );

const campoDescricao =
  document.getElementById(
    "descricao"
  );

const campoLatitude =
  document.getElementById(
    "latitude"
  );

const campoLongitude =
  document.getElementById(
    "longitude"
  );


/* -----------------------------------------------------
   VALIDAR CAMPOS EXISTENTES
----------------------------------------------------- */

if (
  !campoNome ||
  !campoCategoria ||
  !campoEndereco
) {

  throw new Error(
    "Não foi possível localizar os campos obrigatórios do formulário."
  );

}


/* -----------------------------------------------------
   LER CAMPOS
----------------------------------------------------- */

const nome =
  campoNome.value
    .trim();


const categoria =
  campoCategoria.value
    .trim();


const whatsapp =
  normalizarWhatsapp(
    campoWhatsapp?.value ||
    ""
  );


const instagram =
  campoInstagram?.value
    .trim() ||
  "";


const endereco =
  campoEndereco.value
    .trim();


const horario =
  campoHorario?.value
    .trim() ||
  "";


const descricao =
  campoDescricao?.value
    .trim() ||
  "";


const latitude =
  converterCoordenada(
    campoLatitude?.value ||
    ""
  );


const longitude =
  converterCoordenada(
    campoLongitude?.value ||
    ""
  );


/* -----------------------------------------------------
   VALIDAÇÃO
----------------------------------------------------- */

if (!nome) {

  throw new Error(
    "Informe o nome do comércio."
  );

}


if (!categoria) {

  throw new Error(
    "Selecione uma categoria."
  );

}


if (!endereco) {

  throw new Error(
    "Informe o endereço."
  );

}


/* -----------------------------------------------------
   FOTO
----------------------------------------------------- */

const arquivoImagem =
  obterArquivoImagem();


if (arquivoImagem) {

  validarImagem(
    arquivoImagem
  );

}


/* -----------------------------------------------------
   UPLOAD
----------------------------------------------------- */

let imagemUrl =
  null;


if (arquivoImagem) {

  botaoEnviar.textContent =
    "Enviando foto...";


  mostrarAviso(
    "Enviando a foto..."
  );


  imagemUrl =
    await enviarImagem(
      arquivoImagem,
      usuario
    );

}


/* -----------------------------------------------------
   DADOS DO CADASTRO
----------------------------------------------------- */

const cadastro = {

  usuario_id:
    usuario.id,

  tipo:
    "novo_comercio",

  local_id:
    null,

  telefone_usuario:
    whatsapp ||
    null,

  etapa:
    "formulario_web",

  status:
    "pendente",

  nome,

  categoria,

  whatsapp:
    whatsapp ||
    null,

  instagram:
    instagram ||
    null,

  endereco,

  horario:
    horario ||
    null,

  descricao:
    descricao ||
    null,

  imagem_url:
    imagemUrl,

  latitude,

  longitude

};


console.log(
  "Enviando cadastro:",
  cadastro
);


/* -----------------------------------------------------
   SUPABASE
----------------------------------------------------- */

botaoEnviar.textContent =
  "Enviando cadastro...";


const {
  data,
  error
} =
  await cadastrosSupabase
    .from(
      "cadastros_comercios"
    )
    .insert(
      cadastro
    )
    .select()
    .single();


if (error) {

  console.error(
    "Erro Supabase:",
    error
  );


  throw new Error(
    error.message ||
    "Não foi possível enviar o cadastro."
  );

}


console.log(
  "Cadastro enviado com sucesso:",
  data
);


/* -----------------------------------------------------
   SUCESSO
----------------------------------------------------- */

formulario.reset();


mostrarAviso(
  "Cadastro enviado com sucesso! " +
  "Ele ficará pendente de análise e só será publicado " +
  "após aprovação."
);


if (formularioContainer) {

  formularioContainer.scrollIntoView({

    behavior:
      "smooth",

    block:
      "start"

  });

}

} catch (erro) {

console.error(
  "Erro ao enviar cadastro:",
  erro
);


mostrarAviso(
  erro?.message ||
  "Ocorreu um erro ao enviar o cadastro.",
  "erro"
);

} finally {

botaoEnviar.disabled =
  false;


botaoEnviar.textContent =
  textoOriginal;

}

}

/* =========================================================
EVENTOS
========================================================= */

if (opcaoNovo) {

opcaoNovo.addEventListener(
"click",
function () {

  abrirFormulario(
    "novo_comercio"
  );

}

);

}

if (opcaoAlteracao) {

opcaoAlteracao.addEventListener(
"click",
function () {

  abrirFormulario(
    "alteracao_comercio"
  );

}

);

}

if (botaoCancelar) {

botaoCancelar.addEventListener(
"click",
fecharFormulario
);

}

if (formulario) {

formulario.addEventListener(
"submit",
enviarCadastro
);

}

/* =========================================================
INICIALIZAÇÃO
========================================================= */

document.addEventListener(
"DOMContentLoaded",
async () => {

/*
 * Aguarda o login.js verificar a sessão.
 *
 * Isso evita abrir o modal de login por engano
 * enquanto o Supabase ainda está carregando
 * uma sessão existente.
 */

let usuario =
  null;


if (
  typeof verificarUsuario ===
  "function"
) {

  usuario =
    await verificarUsuario();

} else {

  usuario =
    await obterUsuarioCadastro();

}


/*
 * Se não estiver logado,
 * abre automaticamente o modal.
 */

if (!usuario) {

  if (
    typeof abrirModalAuth ===
    "function"
  ) {

    abrirModalAuth(
      "login"
    );

  } else {

    console.error(
      "A função abrirModalAuth() não está disponível."
    );

  }

  return;

}


console.log(
  "Cadastros — usuário autenticado:",
  usuario.id
);

}
);

/* =========================================================
PÁGINA CARREGADA
========================================================= */

console.log(
"Cadastros — página carregada."
);
