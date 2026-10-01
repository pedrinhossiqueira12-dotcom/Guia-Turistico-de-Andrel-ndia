/* =========================================================
ANDRELÂNDIA — GUIA TURÍSTICO
CADASTROS.JS

RESPONSABILIDADE:

Cadastro público de comércio
Envio para análise
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

/*

O login.js possui seu próprio cliente.


Aqui usamos um cliente específico para os cadastros.


Os dois clientes utilizam o mesmo projeto Supabase,
portanto a sessão de autenticação é compartilhada
pelo navegador.
*/

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

if (tipo === "erro") {

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

formularioContainer.classList.add(
"ativo"
);

opcoes.style.display =
"none";

/* -------------------------------------------------------
NOVO COMÉRCIO
------------------------------------------------------- */

if (
tipo ===
"novo_comercio"
) {

tituloFormulario.textContent =
  "Cadastrar comércio";


descricaoFormulario.textContent =
  "Preencha as informações abaixo. " +
  "O cadastro será analisado antes de ser publicado no guia.";


return;

}

/* -------------------------------------------------------
ALTERAÇÃO
------------------------------------------------------- */

tituloFormulario.textContent =
"Sugerir alteração";

descricaoFormulario.textContent =
"A seleção do comércio existente será adicionada " +
"na próxima etapa.";

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

Primeiro utilizamos a função já existente
no login.js.
*/

if (
typeof obterUsuarioLogin ===
"function"
) {

const usuario =
  obterUsuarioLogin();

  console.log("USUÁRIO LOGADO:", usuario);
console.log("UUID DO USUÁRIO:", usuario?.id);

if (usuario) {

  return usuario;

}

}

/*

Caso a sessão ainda não tenha sido carregada
pelo login.js, consultamos diretamente o Supabase.
*/

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

return data?.user || null;

}

/* =========================================================
EXIGIR LOGIN
========================================================= */

async function verificarLoginCadastro() {

const usuario =
await obterUsuarioCadastro();

if (usuario) {

return usuario;

}

/*

O usuário não está conectado.


Usamos o modal existente do login.js.
*/

if (
typeof abrirModalAuth ===
"function"
) {

abrirModalAuth(
  "login"
);

}

mostrarAviso(
"Para enviar um cadastro, entre na sua conta ou crie uma conta.",
"erro"
);

return null;

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
formulario.querySelector(
'button[type="submit"]'
);

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

const nome =
  document
    .getElementById("nome")
    .value
    .trim();


const categoria =
  document
    .getElementById("categoria")
    .value
    .trim();


const whatsapp =
  normalizarWhatsapp(
    document
      .getElementById("whatsapp")
      .value
  );


const instagram =
  document
    .getElementById("instagram")
    .value
    .trim();


const endereco =
  document
    .getElementById("endereco")
    .value
    .trim();


const horario =
  document
    .getElementById("horario")
    .value
    .trim();


const descricao =
  document
    .getElementById("descricao")
    .value
    .trim();


const latitude =
  converterCoordenada(
    document
      .getElementById("latitude")
      .value
  );


const longitude =
  converterCoordenada(
    document
      .getElementById("longitude")
      .value
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
   DADOS
----------------------------------------------------- */

const cadastro = {

  usuario_id:
    usuario.id,

  tipo:
    "novo_comercio",

  local_id:
    null,

  telefone_usuario:
    whatsapp || null,

  etapa:
    "formulario_web",

  status:
    "pendente",

  nome,

  categoria,

  whatsapp:
    whatsapp || null,

  instagram:
    instagram || null,

  endereco,

  horario:
    horario || null,

  descricao:
    descricao || null,

  imagem_url:
    null,

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


formularioContainer.scrollIntoView({
  behavior:
    "smooth",

  block:
    "start"

});

} catch (erro) {

console.error(
  "Erro ao enviar cadastro:",
  erro
);


mostrarAviso(
  erro.message ||
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

console.log(
"Cadastros — página carregada."
);
