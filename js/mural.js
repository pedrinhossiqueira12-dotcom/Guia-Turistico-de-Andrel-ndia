/* =========================================================
ANDRELÂNDIA — GUIA TURÍSTICO
MURAL.JS

RESPONSABILIDADES:

Cadastro público de pessoas
Verificação de login
Upload de até 4 imagens
Integração com Supabase
Envio para análise
Controle dos cadastros do próprio usuário
Limite de até 3 perfis ativos por conta

NÃO CONTÉM:

Login
Logout
Aprovação administrativa
Edição administrativa
========================================================= */

/* =========================================================
CONFIGURAÇÃO SUPABASE
========================================================= */

const MURAL_SUPABASE_URL =
"https://xdmbkflufsfqziixzpxc.supabase.co";

const MURAL_SUPABASE_KEY =
"sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";

/* =========================================================
CLIENTE SUPABASE
========================================================= */

const muralSupabase =
window.supabase.createClient(
MURAL_SUPABASE_URL,
MURAL_SUPABASE_KEY
);

/* =========================================================
CONFIGURAÇÕES
========================================================= */

const LIMITE_PERFIS_MURAL =
3;

const LIMITE_IMAGENS_MURAL =
4;

const TAMANHO_MAXIMO_IMAGEM_MURAL =
5 * 1024 * 1024;

const TIPOS_IMAGEM_MURAL = [
"image/jpeg",
"image/png",
"image/webp"
];

const STATUS_ATIVOS_MURAL = [
"pendente",
"aprovado"
];

/* =========================================================
ELEMENTOS
========================================================= */

const formularioMural =
document.getElementById(
"formularioMural"
);

const formularioContainerMural =
document.getElementById(
"formularioContainer"
);

const botaoCancelarMural =
document.getElementById(
"botaoCancelar"
);

const botaoEnviarMural =
document.getElementById(
"botaoEnviar"
);

const avisoMural =
document.getElementById(
"aviso"
);

const usuarioBox =
document.getElementById(
"usuarioBox"
);

const usuarioNome =
document.getElementById(
"usuarioNome"
);

const usuarioEmail =
document.getElementById(
"usuarioEmail"
);

const inputImagensMural =
document.getElementById(
"mural-imagens"
);

const previewImagensMural =
document.getElementById(
"mural-preview-imagens"
);

/* =========================================================
ESTADO
========================================================= */

let imagensMural = [];

let usuarioMural = null;

let cadastrosMuralUsuario = [];

/* =========================================================
AVISO
========================================================= */

function mostrarAvisoMural(
mensagem,
tipo = "info"
) {

if (!avisoMural) {
return;
}

avisoMural.textContent =
mensagem;

avisoMural.className =
"aviso ativo";

if (
tipo === "erro"
) {

avisoMural.classList.add(
  "aviso-erro"
);

} else {

avisoMural.classList.add(
  "aviso-info"
);

}

}

/* =========================================================
LIMPAR AVISO
========================================================= */

function limparAvisoMural() {

if (!avisoMural) {
return;
}

avisoMural.textContent =
"";

avisoMural.className =
"aviso";

}

/* =========================================================
OBTER USUÁRIO
========================================================= */

async function obterUsuarioMural() {

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

Depois consulta diretamente
a sessão do Supabase.
*/

try {

const {
  data,
  error
} =
  await muralSupabase
    .auth
    .getUser();


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

}

catch (erro) {

console.error(
  "Erro ao consultar usuário:",
  erro
);

return null;

}

}

/* =========================================================
VERIFICAR LOGIN
========================================================= */

async function verificarLoginMural() {

let usuario = null;

/*

Se login.js possuir verificarUsuario(),
utilizamos a função existente.
*/

if (
typeof verificarUsuario ===
"function"
) {

try {

  usuario =
    await verificarUsuario();

}

catch (erro) {

  console.error(
    "Erro em verificarUsuario():",
    erro
  );

}

}

/*

Fallback.
*/

if (!usuario) {

usuario =
  await obterUsuarioMural();

}

/*

Usuário não autenticado.
*/

if (!usuario) {

if (
  typeof abrirModalAuth ===
  "function"
) {

  abrirModalAuth(
    "login"
  );

}

else {

  console.error(
    "abrirModalAuth() não está disponível."
  );

}


mostrarAvisoMural(
  "Entre na sua conta para cadastrar seu perfil no mural.",
  "erro"
);

return null;

}

return usuario;

}

/* =========================================================
MOSTRAR USUÁRIO
========================================================= */

function mostrarDadosUsuarioMural(
usuario
) {

if (!usuario) {
return;
}

const nome =
usuario?.user_metadata?.nome ||
usuario?.user_metadata?.name ||
"Usuário autenticado";

const email =
usuario?.email ||
"";

if (usuarioNome) {

usuarioNome.textContent =
  nome;

}

if (usuarioEmail) {

usuarioEmail.textContent =
  email;

}

if (usuarioBox) {

usuarioBox.style.display =
  "flex";

}

}

/* =========================================================
SLUG
========================================================= */

function gerarSlugMural(
nome
) {

return String(
nome || ""
)
.normalize("NFD")
.replace(
/[\u0300-\u036f]/g,
""
)
.toLowerCase()
.trim()
.replace(
/[^a-z0-9\s-]/g,
""
)
.replace(
/\s+/g,
"-"
)
.replace(
/-+/g,
"-"
)
.replace(
/^-|-$/g,
""
)
.substring(
0,
60
);

}

/* =========================================================
GERAR ID ÚNICO
========================================================= */

async function gerarIdPessoaMural(
nome
) {

const slug =
gerarSlugMural(
nome
);

if (!slug) {

throw new Error(
  "Informe um nome válido para gerar o perfil."
);

}

let id =
slug;

/*

Verifica se o ID já existe.


Mesmo que o cadastro esteja deletado,
não reutilizamos o ID.


Isso preserva o histórico dos votos.
*/

const {
data,
error
} =
await muralSupabase
.from(
"mural_cadastros"
)
.select(
"id"
)
.eq(
"id",
id
)
.maybeSingle();

if (error) {

throw new Error(
  "Não foi possível verificar o identificador do perfil."
);

}

if (!data) {

return id;

}

/*

Se já existir:


pedro
pedro-2
pedro-3
pedro-4
*/

let contador =
2;

while (
contador <= 999
) {

const novoId =
  `${slug}-${contador}`;


const {
  data: existente,
  error: erroConsulta
} =
  await muralSupabase
    .from(
      "mural_cadastros"
    )
    .select(
      "id"
    )
    .eq(
      "id",
      novoId
    )
    .maybeSingle();


if (erroConsulta) {

  throw new Error(
    "Não foi possível verificar o identificador do perfil."
  );

}


if (!existente) {

  return novoId;

}


contador++;

}

throw new Error(
"Não foi possível gerar um identificador disponível."
);

}

/* =========================================================
BUSCAR TODOS OS CADASTROS DO USUÁRIO
========================================================= */

async function buscarCadastrosMuralUsuario(
usuario
) {

if (
!usuario?.id
) {

return [];

}

const {
data,
error
} =
await muralSupabase
.from(
"mural_cadastros"
)
.select(
"id, nome, status, motivo_recusa, criado_em, atualizado_em"
)
.eq(
"usuario_id",
usuario.id
)
.order(
"criado_em",
{
ascending: false
}
);

if (error) {

console.error(
  "Erro ao consultar cadastros:",
  error
);

throw new Error(
  "Não foi possível verificar seus cadastros no mural."
);

}

return data || [];

}

/* =========================================================
VERIFICAR CADASTROS EXISTENTES
========================================================= */

async function verificarCadastrosExistentesMural(
usuario
) {

const cadastros =
await buscarCadastrosMuralUsuario(
usuario
);

cadastrosMuralUsuario =
cadastros;

return cadastros;

}

/* =========================================================
CADASTROS ATIVOS
========================================================= */

function obterCadastrosAtivosMural(
cadastros
) {

if (
!Array.isArray(cadastros)
) {

return [];

}

return cadastros.filter(
cadastro =>
STATUS_ATIVOS_MURAL.includes(
cadastro.status
)
);

}

/* =========================================================
VAGAS DISPONÍVEIS
========================================================= */

function obterVagasDisponiveisMural(
cadastros
) {

const ativos =
obterCadastrosAtivosMural(
cadastros
);

return Math.max(
0,
LIMITE_PERFIS_MURAL -
ativos.length
);

}

/* =========================================================
VERIFICAR LIMITE DE PERFIS
========================================================= */

async function verificarLimitePerfisMural(
usuario
) {

const cadastros =
await verificarCadastrosExistentesMural(
usuario
);

const ativos =
obterCadastrosAtivosMural(
cadastros
);

const vagas =
Math.max(
0,
LIMITE_PERFIS_MURAL -
ativos.length
);

return {
permitido:
ativos.length <
LIMITE_PERFIS_MURAL,

totalAtivos:
  ativos.length,

vagas,

cadastros,

ativos

};

}

/* =========================================================
MOSTRAR STATUS DOS PERFIS
========================================================= */

function mostrarStatusPerfisMural(
resultado
) {

if (!resultado) {
return;
}

const {
totalAtivos,
vagas
} =
resultado;

if (
totalAtivos >=
LIMITE_PERFIS_MURAL
) {

mostrarAvisoMural(
  "Você já possui 3 perfis ativos no mural. Exclua um deles para liberar uma nova vaga."
);

if (
  botaoEnviarMural
) {

  botaoEnviarMural.disabled =
    true;

  botaoEnviarMural.textContent =
    "Limite de 3 perfis atingido";

}

return;

}

if (
vagas === 1
) {

mostrarAvisoMural(
  "Você possui 1 vaga disponível para um novo perfil."
);

}

else if (
vagas > 1
) {

mostrarAvisoMural(
  `Você possui ${vagas} vagas disponíveis para novos perfis.`
);

}

}

/* =========================================================
PREVIEW — LIBERAR
========================================================= */

function liberarPreviewsMural() {

imagensMural.forEach(
item => {

  if (
    item?.preview
  ) {

    URL.revokeObjectURL(
      item.preview
    );

  }

}

);

}

/* =========================================================
LIMPAR IMAGENS
========================================================= */

function limparImagensMural() {

liberarPreviewsMural();

imagensMural =
[];

if (
inputImagensMural
) {

inputImagensMural.value =
  "";

}

renderizarPreviewMural();

}

/* =========================================================
PREVIEW
========================================================= */

function renderizarPreviewMural() {

if (
!previewImagensMural
) {

return;

}

previewImagensMural.innerHTML =
"";

imagensMural.forEach(
(
item,
index
) => {

  const elemento =
    document.createElement(
      "div"
    );


  elemento.className =
    "cadastro-imagem-item";


  const imagem =
    document.createElement(
      "img"
    );


  imagem.src =
    item.preview;


  imagem.alt =
    index === 0
      ? "Imagem de capa"
      : `Imagem ${index + 1}`;


  elemento.appendChild(
    imagem
  );


  if (
    index === 0
  ) {

    const capa =
      document.createElement(
        "span"
      );


    capa.className =
      "cadastro-imagem-capa";


    capa.textContent =
      "CAPA";


    elemento.appendChild(
      capa
    );

  }


  const remover =
    document.createElement(
      "button"
    );


  remover.type =
    "button";


  remover.className =
    "cadastro-imagem-remover";


  remover.textContent =
    "×";


  remover.setAttribute(
    "aria-label",
    `Remover imagem ${index + 1}`
  );


  remover.addEventListener(
    "click",
    function () {

      const removida =
        imagensMural[index];


      if (
        removida?.preview
      ) {

        URL.revokeObjectURL(
          removida.preview
        );

      }


      imagensMural.splice(
        index,
        1
      );


      renderizarPreviewMural();

    }
  );


  elemento.appendChild(
    remover
  );


  previewImagensMural.appendChild(
    elemento
  );

}

);

}

/* =========================================================
VALIDAR IMAGEM
========================================================= */

function validarImagemMural(
arquivo
) {

if (!arquivo) {

throw new Error(
  "Arquivo de imagem inválido."
);

}

if (
arquivo.size >
TAMANHO_MAXIMO_IMAGEM_MURAL
) {

throw new Error(
  `A imagem "${arquivo.name}" ultrapassa o limite de 5 MB.`
);

}

if (
!TIPOS_IMAGEM_MURAL.includes(
arquivo.type
)
) {

throw new Error(
  `A imagem "${arquivo.name}" deve estar em JPG, PNG ou WEBP.`
);

}

}

/* =========================================================
SELEÇÃO DE IMAGENS
========================================================= */

if (
inputImagensMural
) {

inputImagensMural.addEventListener(
"change",
function () {

  const arquivos =
    Array.from(
      inputImagensMural.files || []
    );


  if (
    !arquivos.length
  ) {

    return;

  }


  const espacoDisponivel =
    LIMITE_IMAGENS_MURAL -
    imagensMural.length;


  if (
    espacoDisponivel <= 0
  ) {

    alert(
      "Você já adicionou o limite de 4 imagens."
    );


    inputImagensMural.value =
      "";


    return;

  }


  const selecionados =
    arquivos.slice(
      0,
      espacoDisponivel
    );


  for (
    const arquivo
    of selecionados
  ) {

    try {

      validarImagemMural(
        arquivo
      );


      imagensMural.push({

        arquivo,

        preview:
          URL.createObjectURL(
            arquivo
          )

      });

    }

    catch (erro) {

      alert(
        erro.message
      );

    }

  }


  if (
    arquivos.length >
    espacoDisponivel
  ) {

    alert(
      "O limite máximo é de 4 imagens."
    );

  }


  renderizarPreviewMural();


  inputImagensMural.value =
    "";

}

);

}

/* =========================================================
NOME DA IMAGEM
========================================================= */

function gerarNomeImagemMural(
usuarioId,
arquivo,
indice
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
indice +
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
UPLOAD DE IMAGEM
========================================================= */

async function enviarImagemMural(
arquivo,
usuario,
indice
) {

validarImagemMural(
arquivo
);

const caminho =
gerarNomeImagemMural(
usuario.id,
arquivo,
indice
);

const {
error
} =
await muralSupabase
.storage
.from(
"mural-imagens"
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
  "Não foi possível enviar uma imagem: " +
  error.message
);

}

const {
data
} =
muralSupabase
.storage
.from(
"mural-imagens"
)
.getPublicUrl(
caminho
);

const url =
data?.publicUrl ||
null;

if (!url) {

throw new Error(
  "A imagem foi enviada, mas sua URL não pôde ser obtida."
);

}

return url;

}

/* =========================================================
ENVIAR TODAS AS IMAGENS
========================================================= */

async function enviarImagensMural(
usuario
) {

if (
!imagensMural.length
) {

return [];

}

const urls =
[];

for (
let i = 0;
i < imagensMural.length;
i++
) {

mostrarAvisoMural(
  `Enviando imagem ${i + 1} de ${imagensMural.length}...`
);


const url =
  await enviarImagemMural(
    imagensMural[i].arquivo,
    usuario,
    i
  );


if (url) {

  urls.push(
    url
  );

}

}

return urls;

}

/* =========================================================
ENVIAR CADASTRO
========================================================= */

async function enviarCadastroMural(
evento
) {

evento.preventDefault();

/*

Garantir usuário autenticado.
*/

const usuario =
await verificarLoginMural();

if (!usuario) {

return;

}

usuarioMural =
usuario;

/*

Verificar limite de 3 perfis.


Somente pendente e aprovado
ocupam vaga.
*/

const limite =
await verificarLimitePerfisMural(
usuario
);

if (
!limite.permitido
) {

mostrarAvisoMural(
  "Você já possui 3 perfis ativos no mural. Exclua um perfil para liberar uma nova vaga.",
  "erro"
);


return;

}

if (!formularioMural) {

return;

}

/*

Campos.
*/

const campoNome =
document.getElementById(
"nome"
);

const campoCategoria =
document.getElementById(
"categoria"
);

const campoDescricao =
document.getElementById(
"descricao"
);

const campoSobre =
document.getElementById(
"sobre"
);

const campoInstagram =
document.getElementById(
"instagram"
);

if (
!campoNome ||
!campoCategoria
) {

mostrarAvisoMural(
  "Não foi possível localizar os campos obrigatórios.",
  "erro"
);


return;

}

const nome =
campoNome.value.trim();

const categoria =
campoCategoria.value.trim();

const descricao =
campoDescricao?.value.trim() ||
"";

const sobre =
campoSobre?.value.trim() ||
"";

const instagram =
campoInstagram?.value.trim() ||
"";

/*

Validação.
*/

if (!nome) {

mostrarAvisoMural(
  "Informe o nome que será exibido no mural.",
  "erro"
);


campoNome.focus();


return;

}

if (!categoria) {

mostrarAvisoMural(
  "Selecione uma categoria.",
  "erro"
);


campoCategoria.focus();


return;

}

if (
imagensMural.length >
LIMITE_IMAGENS_MURAL
) {

mostrarAvisoMural(
  "O limite máximo é de 4 imagens.",
  "erro"
);


return;

}

/*

Botão.
*/

const textoOriginal =
botaoEnviarMural?.textContent ||
"Enviar para análise";

if (
botaoEnviarMural
) {

botaoEnviarMural.disabled =
  true;


botaoEnviarMural.textContent =
  "Preparando...";

}

try {

/*
 * Gerar ID público.
 */

const id =
  await gerarIdPessoaMural(
    nome
  );


/*
 * Upload.
 */

let imagensUrls =
  [];


if (
  imagensMural.length
) {

  imagensUrls =
    await enviarImagensMural(
      usuario
    );

}


const imagemUrl =
  imagensUrls.length
    ? imagensUrls[0]
    : "";


/*
 * Cadastro.
 */

mostrarAvisoMural(
  "Enviando cadastro para análise..."
);


const cadastro = {

  id,

  usuario_id:
    usuario.id,

  nome,

  categoria,

  descricao,

  sobre,

  instagram,

  imagem:
    imagemUrl,

  imagens:
    imagensUrls,

  status:
    "pendente",

  motivo_recusa:
    "",

  criado_em:
    new Date().toISOString(),

  atualizado_em:
    new Date().toISOString()

};


console.log(
  "Cadastro do mural:",
  cadastro
);


const {
  data,
  error
} =
  await muralSupabase
    .from(
      "mural_cadastros"
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
  "Cadastro do mural criado:",
  data
);


/*
 * Atualiza o estado local.
 */

cadastrosMuralUsuario.push(
  data
);


/*
 * Limpeza.
 */

limparImagensMural();


formularioMural.reset();


/*
 * Sucesso.
 */

mostrarAvisoMural(
  "Cadastro enviado com sucesso! Seu perfil ficará pendente de análise e só aparecerá publicamente após aprovação."
);


if (
  formularioContainerMural
) {

  formularioContainerMural.scrollIntoView({
    behavior:
      "smooth",

    block:
      "start"
  });

}


/*
 * Evita novo envio desta página.
 */

if (
  botaoEnviarMural
) {

  botaoEnviarMural.disabled =
    true;


  botaoEnviarMural.textContent =
    "Cadastro enviado";

}

}

catch (erro) {

console.error(
  "Erro no cadastro do mural:",
  erro
);


mostrarAvisoMural(
  erro?.message ||
  "Ocorreu um erro ao enviar seu cadastro.",
  "erro"
);

}

finally {

/*
 * Se não foi concluído,
 * libera o botão.
 */

if (
  botaoEnviarMural &&
  botaoEnviarMural.textContent !==
  "Cadastro enviado"
) {

  botaoEnviarMural.disabled =
    false;


  botaoEnviarMural.textContent =
    textoOriginal;

}

}

}

/* =========================================================
CANCELAR
========================================================= */

function cancelarCadastroMural() {

limparImagensMural();

if (
formularioMural
) {

formularioMural.reset();

}

limparAvisoMural();

if (
typeof window.history !==
"undefined"
) {

window.location.href =
  "../index.html";

}

}

/* =========================================================
EVENTOS
========================================================= */

if (
formularioMural
) {

formularioMural.addEventListener(
"submit",
enviarCadastroMural
);

}

if (
botaoCancelarMural
) {

botaoCancelarMural.addEventListener(
"click",
cancelarCadastroMural
);

}

/* =========================================================
INICIALIZAÇÃO
========================================================= */

document.addEventListener(
"DOMContentLoaded",
async () => {

console.log(
  "Mural — página carregada."
);


const usuario =
  await verificarLoginMural();


if (!usuario) {

  return;

}


usuarioMural =
  usuario;


mostrarDadosUsuarioMural(
  usuario
);


/*
 * Busca todos os cadastros da conta.
 */

try {

  const resultado =
    await verificarLimitePerfisMural(
      usuario
    );


  /*
   * Se já atingiu o limite,
   * bloqueia o formulário.
   */

  if (
    !resultado.permitido
  ) {

    mostrarStatusPerfisMural(
      resultado
    );

    return;

  }


  /*
   * Caso ainda tenha vagas,
   * informa ao usuário.
   */

  if (
    resultado.totalAtivos > 0
  ) {

    mostrarStatusPerfisMural(
      resultado
    );

  }


  /*
   * Mostra no console os perfis
   * encontrados, inclusive deletados.
   */

  console.log(
    "Cadastros do usuário:",
    resultado.cadastros
  );


  console.log(
    "Perfis ativos:",
    resultado.ativos
  );


  console.log(
    "Vagas disponíveis:",
    resultado.vagas
  );

}

catch (erro) {

  console.error(
    "Erro ao verificar cadastros:",
    erro
  );


  mostrarAvisoMural(
    erro.message ||
    "Não foi possível verificar seus cadastros.",
    "erro"
  );

}

}
);

/* =========================================================
PÁGINA CARREGADA
========================================================= */

console.log(
"Mural — sistema carregado."
);
