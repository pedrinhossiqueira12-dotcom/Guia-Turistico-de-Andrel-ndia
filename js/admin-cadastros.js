/* =========================================================
ANDRELÂNDIA — GUIA TURÍSTICO
ADMIN-CADASTROS.JS

PAINEL ADMINISTRATIVO

RESPONSABILIDADES:

Verificar usuário logado
Listar cadastros pendentes
Editar dados
Salvar alterações
Aprovar e publicar via Edge Function
Rejeitar cadastro
Listar comércios publicados
Pesquisar comércios
Editar comércio publicado
Excluir comércio publicado
========================================================= */

/* =========================================================
CONFIGURAÇÕES
========================================================= */

const LOGIN_SUPABASE_URL =
  "https://xdmbkflufsfqziixzpxc.supabase.co";

const LOGIN_SUPABASE_KEY =
  "sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";

const EDGE_FUNCTION_URL =
  `${LOGIN_SUPABASE_URL}/functions/v1/whatsapp-bot`;

const ADMIN_USER_ID =
"4b9a0233-6b72-4573-aebd-d596c5b15e1b";

/* =========================================================
SUPABASE
========================================================= */

const supabaseClient =
window.supabase.createClient(
LOGIN_SUPABASE_URL,
LOGIN_SUPABASE_KEY
);

/* =========================================================
ELEMENTOS
========================================================= */

const carregando =
document.getElementById("carregando");

const listaCadastros =
document.getElementById("lista-cadastros");

const semCadastros =
document.getElementById("sem-cadastros");

const mensagem =
document.getElementById("mensagem");

const botaoAtualizar =
document.getElementById("botao-atualizar");

const botaoSair =
document.getElementById("botao-sair");

/* =========================================================
VARIÁVEIS — COMÉRCIOS PUBLICADOS
========================================================= */

let comerciosPublicados = [];

let pesquisaComerciosAdmin = "";

let comercioEditandoId = null;

/* =========================================================
UTILITÁRIOS
========================================================= */

function mostrarMensagem(
texto,
tipo = "sucesso"
) {

if (!mensagem) return;

mensagem.textContent = texto;

  mensagem.className =
    `mensagem ${tipo}`;

mensagem.style.display =
"block";
}

function esconderMensagem() {

if (!mensagem) return;

mensagem.style.display =
"none";
}

function escaparHTML(valor) {

if (
valor === null ||
valor === undefined
) {
return "";
}

  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


function valorOuVazio(valor) {

if (
valor === null ||
valor === undefined
) {
return "";
}

return String(valor);
}

/* =========================================================
FORMATAÇÃO
========================================================= */

function formatarData(data) {

if (!data) {
return "-";
}

const dataObj =
new Date(data);

if (
Number.isNaN(
dataObj.getTime()
)
) {
return "-";
}

return dataObj.toLocaleDateString(
"pt-BR",
{
day: "2-digit",
month: "2-digit",
year: "numeric",
hour: "2-digit",
minute: "2-digit"
}
);
}

function formatarTelefone(
telefone
) {

if (!telefone) {
return "-";
}

return telefone;
}

/* =========================================================
IMAGEM
========================================================= */

function obterImagemComercio(
comercio
) {

if (!comercio) {
return "";
}

if (
comercio.imagem &&
typeof comercio.imagem === "string" &&
comercio.imagem.trim()
) {
return comercio.imagem.trim();
}

if (
comercio.imagem_url &&
typeof comercio.imagem_url === "string" &&
comercio.imagem_url.trim()
) {
return comercio.imagem_url.trim();
}

if (
Array.isArray(comercio.imagens)
) {

const imagem =
  comercio.imagens.find(
    item =>
      typeof item === "string" &&
      item.trim()
  );

if (imagem) {
  return imagem.trim();
}

}

if (
comercio.capa &&
typeof comercio.capa === "string" &&
comercio.capa.trim()
) {
return comercio.capa.trim();
}

if (
Array.isArray(comercio.galeria)
) {

const imagem =
  comercio.galeria.find(
    item =>
      typeof item === "string" &&
      item.trim()
  );

if (imagem) {
  return imagem.trim();
}

}

if (
Array.isArray(comercio.fotos)
) {

const imagem =
  comercio.fotos.find(
    item =>
      typeof item === "string" &&
      item.trim()
  );

if (imagem) {
  return imagem.trim();
}

}

return "";
}

/* =========================================================
VERIFICAR LOGIN
========================================================= */

async function verificarLogin() {

const {
data,
error
} =
await supabaseClient
.auth
.getSession();

if (error) {

console.error(
  "Erro ao verificar sessão:",
  error
);

window.location.href =
  "../index.html";

return;

}

const session =
data?.session;

const usuario =
session?.user;

if (!usuario) {

console.warn(
  "Acesso administrativo negado: usuário não autenticado."
);

window.location.href =
  "../index.html";

return;

}

if (
usuario.id !==
ADMIN_USER_ID
) {

console.warn(
  "Acesso administrativo negado:",
  usuario.id
);

alert(
  "Você não possui permissão para acessar esta área."
);

window.location.href =
  "../index.html";

return;

}

console.log(
"Acesso administrativo autorizado:",
usuario.id
);

await carregarCadastros();

await carregarComerciosPublicados();

criarSecaoComerciosAdmin();
}

/* =========================================================
CARREGAR CADASTROS PENDENTES
========================================================= */

async function carregarCadastros() {

if (carregando) {

carregando.style.display =
  "block";

}

if (listaCadastros) {

listaCadastros.innerHTML =
  "";

}

if (semCadastros) {

semCadastros.style.display =
  "none";

}

try {

const {
  data,
  error
} =
  await supabaseClient
    .from("cadastros_comercios")
    .select("*")
    .eq(
      "status",
      "pendente"
    )
    .order(
      "criado_em",
      {
        ascending: true
      }
    );

if (error) {
  throw error;
}

if (carregando) {

  carregando.style.display =
    "none";
}

if (
  !data ||
  data.length === 0
) {

  if (semCadastros) {

    semCadastros.style.display =
      "block";
  }

  return;
}

data.forEach(
  cadastro => {

    criarCadastro(
      cadastro
    );

  }
);

} catch (erro) {

console.error(
  "Erro ao carregar cadastros:",
  erro
);

if (carregando) {

  carregando.style.display =
    "none";
}

mostrarMensagem(
  "Erro ao carregar os cadastros.",
  "erro"
);

}
}

/* =========================================================
CRIAR CARD — CADASTRO PENDENTE
========================================================= */

function criarCadastro(
cadastro
) {

if (!listaCadastros) {
return;
}

const card =
document.createElement(
"article"
);

card.className =
"cadastro-card";

card.dataset.id =
cadastro.id;

const imagem =
cadastro.imagem_url
? `<div class="cadastro-imagem"> <img src="${escaparHTML( cadastro.imagem_url )}" alt="${escaparHTML( cadastro.nome || "Imagem do comércio" )}" loading="lazy" onerror=" this.parentElement.style.display='none' " > </div>`
: `
<div class="cadastro-imagem cadastro-imagem-vazia">
<div class="cadastro-imagem-icone">
🏪
</div>

      <span>
        Sem imagem
      </span>
    </div>
  `;

card.innerHTML = `

${imagem}


<div class="cadastro-conteudo">


  <div class="cadastro-topo">

    <div>

      <span class="cadastro-label-topo">
        CADASTRO PENDENTE
      </span>

      <h2 class="cadastro-nome">
        ${escaparHTML(
          cadastro.nome ||
          "Sem nome"
        )}
      </h2>

      <p class="cadastro-categoria">
        ${escaparHTML(
          cadastro.categoria ||
          "Categoria não informada"
        )}
      </p>

    </div>


    <span class="cadastro-status">
      Pendente
    </span>

  </div>


  <div class="cadastro-secao">

    <div class="cadastro-secao-titulo">

      <span class="cadastro-secao-icone">
        📋
      </span>

      <div>
        <strong>
          Informações do comércio
        </strong>

        <small>
          Dados principais
        </small>
      </div>

    </div>


    <div class="cadastro-campos">


      <label>

        <span>
          Nome
        </span>

        <input
          type="text"
          id="nome-${cadastro.id}"
          value="${escaparHTML(
            valorOuVazio(
              cadastro.nome
            )
          )}"
        >

      </label>


      <label>

        <span>
          Categoria
        </span>

        <input
          type="text"
          id="categoria-${cadastro.id}"
          value="${escaparHTML(
            valorOuVazio(
              cadastro.categoria
            )
          )}"
        >

      </label>


      <label>

        <span>
          WhatsApp
        </span>

        <input
          type="text"
          id="whatsapp-${cadastro.id}"
          value="${escaparHTML(
            valorOuVazio(
              cadastro.whatsapp
            )
          )}"
        >

      </label>


      <label>

        <span>
          Instagram
        </span>

        <input
          type="text"
          id="instagram-${cadastro.id}"
          value="${escaparHTML(
            valorOuVazio(
              cadastro.instagram
            )
          )}"
        >

      </label>


    </div>

  </div>


  <div class="cadastro-secao">

    <div class="cadastro-secao-titulo">

      <span class="cadastro-secao-icone">
        📍
      </span>

      <div>

        <strong>
          Localização
        </strong>

        <small>
          Endereço e coordenadas
        </small>

      </div>

    </div>


    <div class="cadastro-campos">


      <label class="campo-largo">

        <span>
          Endereço
        </span>

        <textarea
          id="endereco-${cadastro.id}"
          rows="2"
        >${escaparHTML(
          valorOuVazio(
            cadastro.endereco
          )
        )}</textarea>

      </label>


      <label>

        <span>
          Latitude
        </span>

        <input
          type="number"
          step="any"
          id="latitude-${cadastro.id}"
          value="${escaparHTML(
            valorOuVazio(
              cadastro.latitude
            )
          )}"
        >

      </label>


      <label>

        <span>
          Longitude
        </span>

        <input
          type="number"
          step="any"
          id="longitude-${cadastro.id}"
          value="${escaparHTML(
            valorOuVazio(
              cadastro.longitude
            )
          )}"
        >

      </label>


    </div>

  </div>


  <div class="cadastro-secao">

    <div class="cadastro-secao-titulo">

      <span class="cadastro-secao-icone">
        ✏️
      </span>

      <div>

        <strong>
          Detalhes
        </strong>

        <small>
          Informações exibidas no guia
        </small>

      </div>

    </div>


    <div class="cadastro-campos">


      <label>

        <span>
          Horário
        </span>

        <textarea
          id="horario-${cadastro.id}"
          rows="2"
        >${escaparHTML(
          valorOuVazio(
            cadastro.horario
          )
        )}</textarea>

      </label>


      <label>

        <span>
          URL da imagem
        </span>

        <input
          type="url"
          id="imagem-${cadastro.id}"
          value="${escaparHTML(
            valorOuVazio(
              cadastro.imagem_url
            )
          )}"
          placeholder="https://..."
        >

      </label>


      <label class="campo-largo">

        <span>
          Descrição
        </span>

        <textarea
          id="descricao-${cadastro.id}"
          rows="4"
        >${escaparHTML(
          valorOuVazio(
            cadastro.descricao
          )
        )}</textarea>

      </label>


    </div>

  </div>


  <div class="cadastro-meta">

    <div>

      <span>
        ID do cadastro
      </span>

      <strong>
        ${escaparHTML(
          cadastro.id
        )}
      </strong>

    </div>


    <div>

      <span>
        Enviado em
      </span>

      <strong>
        ${formatarData(
          cadastro.criado_em
        )}
      </strong>

    </div>


    <div>

      <span>
        Telefone do cadastro
      </span>

      <strong>
        ${escaparHTML(
          formatarTelefone(
            cadastro.telefone_usuario
          )
        )}
      </strong>

    </div>

  </div>


  <div class="cadastro-acoes">


    <button
      type="button"
      class="botao-salvar"
      onclick="salvarCadastro('${cadastro.id}')"
    >
      <span>💾</span>
      <span>Salvar alterações</span>
    </button>


    <button
      type="button"
      class="botao-aprovar"
      onclick="aprovarCadastro('${cadastro.id}')"
    >
      <span>✓</span>
      <span>Aprovar e publicar</span>
    </button>


    <button
      type="button"
      class="botao-rejeitar"
      onclick="rejeitarCadastro('${cadastro.id}')"
    >
      <span>×</span>
      <span>Rejeitar</span>
    </button>


  </div>


</div>

`;

listaCadastros.appendChild(
card
);
}

/* =========================================================
OBTER DADOS DO CARD
========================================================= */

function obterDadosCard(
id
) {

const nome =
document.getElementById(
`nome-${id}`
)?.value.trim() || "";

const categoria =
document.getElementById(
`categoria-${id}`
)?.value.trim() || "";

const whatsapp =
document.getElementById(
`whatsapp-${id}`
)?.value.trim() || "";

const instagram =
document.getElementById(
`instagram-${id}`
)?.value.trim() || "";

const endereco =
document.getElementById(
`endereco-${id}`
)?.value.trim() || "";

const horario =
document.getElementById(
`horario-${id}`
)?.value.trim() || "";

const descricao =
document.getElementById(
`descricao-${id}`
)?.value.trim() || "";

const imagem_url =
document.getElementById(
`imagem-${id}`
)?.value.trim() || "";

const latitudeTexto =
document.getElementById(
`latitude-${id}`
)?.value.trim() || "";

const longitudeTexto =
document.getElementById(
`longitude-${id}`
)?.value.trim() || "";

const latitude =
latitudeTexto === ""
? null
: Number(
latitudeTexto
);

const longitude =
longitudeTexto === ""
? null
: Number(
longitudeTexto
);

return {

id,

nome,

categoria,

whatsapp,

instagram,

endereco,

horario,

descricao,

imagem_url,

latitude,

longitude

};
}

/* =========================================================
VALIDAR
========================================================= */

function validarDadosCadastro(
dados
) {

if (!dados.nome) {

mostrarMensagem(
  "Informe o nome do comércio.",
  "erro"
);

return false;

}

if (!dados.categoria) {

mostrarMensagem(
  "Informe a categoria do comércio.",
  "erro"
);

return false;

}

if (
dados.latitude === null ||
dados.longitude === null
) {

mostrarMensagem(
  "Informe latitude e longitude.",
  "erro"
);

return false;

}

if (
!Number.isFinite(
dados.latitude
) ||
!Number.isFinite(
dados.longitude
)
) {

mostrarMensagem(
  "Latitude e longitude precisam ser números válidos.",
  "erro"
);

return false;

}

if (
dados.latitude < -90 ||
dados.latitude > 90
) {

mostrarMensagem(
  "Latitude inválida.",
  "erro"
);

return false;

}

if (
dados.longitude < -180 ||
dados.longitude > 180
) {

mostrarMensagem(
  "Longitude inválida.",
  "erro"
);

return false;

}

return true;
}

/* =========================================================
SALVAR ALTERAÇÕES — CADASTRO PENDENTE
========================================================= */

async function salvarCadastro(
id
) {

try {

esconderMensagem();

const dados =
  obterDadosCard(id);

if (
  !validarDadosCadastro(
    dados
  )
) {
  return;
}


const {
  error
} =
  await supabaseClient
    .from(
      "cadastros_comercios"
    )
    .update({

      nome:
        dados.nome,

      categoria:
        dados.categoria,

      whatsapp:
        dados.whatsapp,

      instagram:
        dados.instagram,

      endereco:
        dados.endereco,

      horario:
        dados.horario,

      descricao:
        dados.descricao,

      imagem_url:
        dados.imagem_url,

      latitude:
        dados.latitude,

      longitude:
        dados.longitude,

      atualizado_em:
        new Date().toISOString()

    })
    .eq(
      "id",
      id
    )
    .eq(
      "status",
      "pendente"
    );


if (error) {
  throw error;
}


mostrarMensagem(
  "Alterações salvas com sucesso.",
  "sucesso"
);


await carregarCadastros();

} catch (erro) {

console.error(
  "Erro ao salvar cadastro:",
  erro
);


mostrarMensagem(
  "Não foi possível salvar as alterações.",
  "erro"
);

}
}

/* =========================================================
APROVAR E PUBLICAR
========================================================= */

async function aprovarCadastro(
id
) {

const confirmar =
confirm(

  "Aprovar e publicar este comércio?\n\n" +

  "O cadastro será enviado para o GitHub e poderá aparecer no Guia Turístico após a atualização do site.\n\n" +

  "Essa ação não deve ser feita se os dados ainda estiverem incorretos."

);

if (!confirmar) {
return;
}

try {

esconderMensagem();

const card =
  document.querySelector(
    `.cadastro-card[data-id="${id}"]`
  );


const botao =
  card?.querySelector(
    ".botao-aprovar"
  );


if (botao) {

  botao.disabled =
    true;

  botao.innerHTML =
    `
      <span>⏳</span>
      <span>Publicando...</span>
    `;
}


const {
  data,
  error
} =
  await supabaseClient
    .auth
    .getSession();


if (error) {
  throw error;
}


const session =
  data.session;


if (!session) {

  window.location.href =
    "../index.html";

  return;
}


const resposta =
  await fetch(
    EDGE_FUNCTION_URL,
    {

      method: "POST",

      headers: {

        "Authorization":
          `Bearer ${session.access_token}`,

        "Content-Type":
          "application/json"

      },

      body:
        JSON.stringify({

          acao:
            "aprovar_cadastro",

          cadastro_id:
            id

        })

    }
  );


let resultado;

try {

  resultado =
    await resposta.json();

} catch {

  resultado = {

    ok: false,

    error:
      "A Edge Function não retornou JSON válido."

  };
}


console.log(
  "Resposta da aprovação:",
  resultado
);


if (
  !resposta.ok ||
  !resultado.ok
) {

  throw new Error(

    resultado.error ||
    resultado.mensagem ||
    `Erro HTTP ${resposta.status}`

  );
}


const comercio =
  resultado.comercio;


alert(

  "Cadastro aprovado com sucesso!\n\n" +

  `Comércio: ${
    comercio?.nome ||
    "Comércio"
  }\n\n` +

  "O cadastro foi publicado no GitHub."

);


mostrarMensagem(
  "Cadastro aprovado e publicado com sucesso.",
  "sucesso"
);


await carregarCadastros();

await carregarComerciosPublicados();

} catch (erro) {

console.error(
  "Erro ao aprovar cadastro:",
  erro
);


mostrarMensagem(
  `Não foi possível aprovar: ${erro.message}`,
  "erro"
);


const card =
  document.querySelector(
    `.cadastro-card[data-id="${id}"]`
  );


const botao =
  card?.querySelector(
    ".botao-aprovar"
  );


if (botao) {

  botao.disabled =
    false;

  botao.innerHTML =
    `
      <span>✓</span>
      <span>Aprovar e publicar</span>
    `;
}

}
}

/* =========================================================
REJEITAR
========================================================= */

async function rejeitarCadastro(
id
) {

const motivo =
prompt(
"Informe o motivo da rejeição:"
);

if (
motivo === null
) {
return;
}

const motivoFinal =
motivo.trim();

if (!motivoFinal) {

mostrarMensagem(
  "Informe um motivo para rejeitar o cadastro.",
  "erro"
);

return;

}

const confirmar =
confirm(

  "Deseja realmente rejeitar este cadastro?\n\n" +

  `Motivo: ${motivoFinal}`

);

if (!confirmar) {
return;
}

try {

esconderMensagem();


const {
  data: usuarioData,
  error: usuarioError
} =
  await supabaseClient
    .auth
    .getUser();


if (usuarioError) {
  throw usuarioError;
}


const usuario =
  usuarioData.user;


if (!usuario) {

  window.location.href =
    "../index.html";

  return;
}


const {
  error
} =
  await supabaseClient
    .from(
      "cadastros_comercios"
    )
    .update({

      status:
        "rejeitado",

      revisado_por:
        usuario.id,

      revisado_em:
        new Date().toISOString(),

      motivo_rejeicao:
        motivoFinal,

      atualizado_em:
        new Date().toISOString()

    })
    .eq(
      "id",
      id
    )
    .eq(
      "status",
      "pendente"
    );


if (error) {
  throw error;
}


mostrarMensagem(
  "Cadastro rejeitado com sucesso.",
  "sucesso"
);


await carregarCadastros();

} catch (erro) {

console.error(
  "Erro ao rejeitar cadastro:",
  erro
);


mostrarMensagem(
  "Não foi possível rejeitar o cadastro.",
  "erro"
);

}
}

/* =========================================================
COMÉRCIOS PUBLICADOS
========================================================= */

async function carregarComerciosPublicados() {

try {

const resposta =
  await fetch(
    "../DATA/comercios.json",
    {
      cache: "no-store"
    }
  );


if (!resposta.ok) {

  throw new Error(
    `HTTP ${resposta.status}`
  );
}


const dados =
  await resposta.json();


if (
  !Array.isArray(dados)
) {

  throw new Error(
    "comercios.json não contém um array."
  );
}


comerciosPublicados =
  dados;


console.log(
  "Comércios publicados carregados:",
  comerciosPublicados.length
);


renderizarComerciosAdmin();

} catch (erro) {

console.error(
  "Erro ao carregar comércios publicados:",
  erro
);


comerciosPublicados =
  [];


renderizarComerciosAdmin();

}
}

/* =========================================================
CRIAR SEÇÃO ADMINISTRATIVA
========================================================= */

function criarSecaoComerciosAdmin() {

if (
document.getElementById(
"secao-comercios-admin"
)
) {
return;
}

const secao =
document.createElement(
"section"
);

secao.id =
"secao-comercios-admin";

secao.className =
"secao-comercios-admin";

secao.innerHTML = `

<div class="admin-comercios-cabecalho">

  <div>

    <span class="admin-comercios-tag">
      GUIA TURÍSTICO
    </span>

    <h2>
      Comércios publicados
    </h2>

    <p>
      Gerencie os comércios que já aparecem no Guia.
    </p>

  </div>

  <span
    class="admin-comercios-contador"
    id="contador-comercios-admin"
  >
    0
  </span>

</div>


<div class="admin-comercios-pesquisa">

  <input
    type="search"
    id="pesquisa-comercios-admin"
    placeholder="Pesquisar comércio..."
    autocomplete="off"
  >

</div>


<div
  id="editor-comercio-admin"
  class="editor-comercio-admin"
  hidden
></div>


<div
  id="lista-comercios-admin"
  class="lista-comercios-admin"
></div>


<div
  id="sem-comercios-admin"
  class="sem-comercios-admin"
  hidden
>
  Nenhum comércio encontrado.
</div>

`;

const referencia =
document.getElementById(
"lista-cadastros"
)?.parentElement;

if (referencia) {

referencia.appendChild(
  secao
);

} else {

document.body.appendChild(
  secao
);

}

const pesquisa =
document.getElementById(
"pesquisa-comercios-admin"
);

if (pesquisa) {

pesquisa.addEventListener(
  "input",
  event => {

    pesquisaComerciosAdmin =
      event.target.value
        .trim()
        .toLowerCase();


    renderizarComerciosAdmin();

  }
);

}

renderizarComerciosAdmin();
}

/* =========================================================
FILTRAR COMÉRCIOS
========================================================= */

function obterComerciosFiltradosAdmin() {

const termo =
pesquisaComerciosAdmin
.normalize("NFD")
.replace(
/[\u0300-\u036f]/g,
""
);

if (!termo) {

return [
  ...comerciosPublicados
];

}

return comerciosPublicados.filter(
comercio => {

  const texto = [

    comercio.nome,

    comercio.categoria,

    comercio.endereco,

    comercio.endereço,

    comercio.descricao,

    comercio.telefone,

    comercio.whatsapp,

    comercio.instagram

  ]
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase();


  return texto.includes(
    termo
  );
}

);
}

/* =========================================================
RENDERIZAR COMÉRCIOS ADMIN
========================================================= */

function renderizarComerciosAdmin() {

const lista =
document.getElementById(
"lista-comercios-admin"
);

const vazio =
document.getElementById(
"sem-comercios-admin"
);

const contador =
document.getElementById(
"contador-comercios-admin"
);

if (!lista) {
return;
}

lista.innerHTML =
"";

const resultados =
obterComerciosFiltradosAdmin();

if (contador) {

contador.textContent =
  resultados.length;

}

if (!resultados.length) {

if (vazio) {
  vazio.hidden =
    false;
}

return;

}

if (vazio) {
vazio.hidden =
true;
}

resultados.forEach(
comercio => {

  lista.appendChild(
    criarCardComercioAdmin(
      comercio
    )
  );

}

);
}

/* =========================================================
CARD — COMÉRCIO PUBLICADO
========================================================= */

function criarCardComercioAdmin(
comercio
) {

const card =
document.createElement(
"article"
);

card.className =
"admin-comercio-card";

card.dataset.id =
comercio.id;

const imagem =
obterImagemComercio(
comercio
);

const imagemHTML =
imagem
? `<div class="admin-comercio-imagem"> <img src="${escaparHTML(imagem)}" alt="${escaparHTML( comercio.nome || "Comércio" )}" loading="lazy" onerror=" this.parentElement.classList.add('sem-imagem') this.style.display='none' " > </div>`
: `<div class="admin-comercio-imagem sem-imagem"> <span>🏪</span> </div>` ;

card.innerHTML = `

${imagemHTML}


<div class="admin-comercio-conteudo">

  <div class="admin-comercio-info">

    <span class="admin-comercio-categoria">
      ${escaparHTML(
        comercio.categoria ||
        "Comércio"
      )}
    </span>

    <h3>
      ${escaparHTML(
        comercio.nome ||
        "Sem nome"
      )}
    </h3>

    <p>
      ${escaparHTML(
        comercio.endereco ||
        comercio.endereço ||
        "Endereço não informado"
      )}
    </p>

    <small>
      ID: ${escaparHTML(
        comercio.id
      )}
    </small>

  </div>


  <div class="admin-comercio-acoes">

    <button
      type="button"
      class="admin-botao-editar"
    >
      ✏️ Editar
    </button>

    <button
      type="button"
      class="admin-botao-excluir"
    >
      🗑️ Excluir
    </button>

  </div>

</div>

`;

const botaoEditar =
card.querySelector(
".admin-botao-editar"
);

if (botaoEditar) {

botaoEditar.onclick =
  () => {

    abrirEditorComercio(
      comercio
    );

  };

}

const botaoExcluir =
card.querySelector(
".admin-botao-excluir"
);

if (botaoExcluir) {

botaoExcluir.onclick =
  () => {

    excluirComercio(
      comercio.id
    );

  };

}

return card;
}

/* =========================================================
ABRIR EDITOR
========================================================= */

function abrirEditorComercio(
comercio
) {

const editor =
document.getElementById(
"editor-comercio-admin"
);

if (!editor) {
return;
}

comercioEditandoId =
comercio.id;

editor.hidden =
false;

editor.innerHTML = `

<div class="editor-comercio-topo">

  <div>

    <span>
      EDITANDO COMÉRCIO
    </span>

    <h3>
      ${escaparHTML(
        comercio.nome ||
        "Comércio"
      )}
    </h3>

  </div>

  <button
    type="button"
    id="fechar-editor-comercio"
  >
    ×
  </button>

</div>


<div class="editor-comercio-campos">

  <label>

    <span>
      Nome
    </span>

    <input
      type="text"
      id="editor-nome"
      value="${escaparHTML(
        valorOuVazio(
          comercio.nome
        )
      )}"
    >

  </label>


  <label>

    <span>
      Categoria
    </span>

    <input
      type="text"
      id="editor-categoria"
      value="${escaparHTML(
        valorOuVazio(
          comercio.categoria
        )
      )}"
    >

  </label>


  <label>

    <span>
      WhatsApp
    </span>

    <input
      type="text"
      id="editor-whatsapp"
      value="${escaparHTML(
        valorOuVazio(
          comercio.whatsapp
        )
      )}"
    >

  </label>


  <label>

    <span>
      Telefone
    </span>

    <input
      type="text"
      id="editor-telefone"
      value="${escaparHTML(
        valorOuVazio(
          comercio.telefone
        )
      )}"
    >

  </label>


  <label>

    <span>
      Instagram
    </span>

    <input
      type="text"
      id="editor-instagram"
      value="${escaparHTML(
        valorOuVazio(
          comercio.instagram
        )
      )}"
    >

  </label>


  <label>

    <span>
      Site
    </span>

    <input
      type="url"
      id="editor-site"
      value="${escaparHTML(
        valorOuVazio(
          comercio.site
        )
      )}"
      placeholder="https://..."
    >

  </label>


  <label class="campo-largo">

    <span>
      Endereço
    </span>

    <textarea
      id="editor-endereco"
      rows="2"
    >${escaparHTML(
      valorOuVazio(
        comercio.endereco ||
        comercio.endereço
      )
    )}</textarea>

  </label>


  <label class="campo-largo">

    <span>
      Horário
    </span>

    <textarea
      id="editor-horario"
      rows="3"
    >${escaparHTML(
      valorOuVazio(
        comercio.horario
      )
    )}</textarea>

  </label>


  <label>

    <span>
      Latitude
    </span>

    <input
      type="number"
      step="any"
      id="editor-latitude"
      value="${escaparHTML(
        valorOuVazio(
          comercio.latitude
        )
      )}"
    >

  </label>


  <label>

    <span>
      Longitude
    </span>

    <input
      type="number"
      step="any"
      id="editor-longitude"
      value="${escaparHTML(
        valorOuVazio(
          comercio.longitude
        )
      )}"
    >

  </label>


  <label class="campo-largo">

    <span>
      URL da imagem
    </span>

    <input
      type="url"
      id="editor-imagem"
      value="${escaparHTML(
        obterImagemComercio(
          comercio
        )
      )}"
      placeholder="https://..."
    >

  </label>


  <label class="campo-largo">

    <span>
      Descrição
    </span>

    <textarea
      id="editor-descricao"
      rows="5"
    >${escaparHTML(
      valorOuVazio(
        comercio.descricao
      )
    )}</textarea>

  </label>


  <label class="campo-largo">

    <span>
      História
    </span>

    <textarea
      id="editor-historia"
      rows="5"
    >${escaparHTML(
      valorOuVazio(
        comercio.historia
      )
    )}</textarea>

  </label>


  <label class="campo-largo">

    <span>
      Curiosidades
    </span>

    <textarea
      id="editor-curiosidades"
      rows="5"
    >${escaparHTML(
      valorOuVazio(
        comercio.curiosidades
      )
    )}</textarea>

  </label>

</div>


<div class="editor-comercio-acoes">

  <button
    type="button"
    class="editor-botao-cancelar"
    id="cancelar-editor-comercio"
  >
    Cancelar
  </button>

  <button
    type="button"
    class="editor-botao-salvar"
    id="salvar-editor-comercio"
  >
    💾 Salvar alterações
  </button>

</div>

`;

const fechar =
document.getElementById(
"fechar-editor-comercio"
);

const cancelar =
document.getElementById(
"cancelar-editor-comercio"
);

if (fechar) {

fechar.onclick =
  fecharEditorComercio;

}

if (cancelar) {

cancelar.onclick =
  fecharEditorComercio;

}

const salvar =
document.getElementById(
"salvar-editor-comercio"
);

if (salvar) {

salvar.onclick =
  salvarComercioPublicado;

}

editor.scrollIntoView({
behavior: "smooth",
block: "start"
});
}

/* =========================================================
FECHAR EDITOR
========================================================= */

function fecharEditorComercio() {

const editor =
document.getElementById(
"editor-comercio-admin"
);

if (!editor) {
return;
}

editor.hidden =
true;

editor.innerHTML =
"";

comercioEditandoId =
null;
}

/* =========================================================
OBTER DADOS DO EDITOR
========================================================= */

function obterDadosEditorComercio() {

const obter =
id =>
document.getElementById(
id
)?.value.trim() || "";

const latitudeTexto =
obter(
"editor-latitude"
);

const longitudeTexto =
obter(
"editor-longitude"
);

const latitude =
latitudeTexto === ""
? null
: Number(
latitudeTexto
);

const longitude =
longitudeTexto === ""
? null
: Number(
longitudeTexto
);

return {

id:
  comercioEditandoId,

nome:
  obter(
    "editor-nome"
  ),

categoria:
  obter(
    "editor-categoria"
  ),

whatsapp:
  obter(
    "editor-whatsapp"
  ),

telefone:
  obter(
    "editor-telefone"
  ),

instagram:
  obter(
    "editor-instagram"
  ),

site:
  obter(
    "editor-site"
  ),

endereco:
  obter(
    "editor-endereco"
  ),

horario:
  obter(
    "editor-horario"
  ),

latitude,

longitude,

imagem:
  obter(
    "editor-imagem"
  ),

descricao:
  obter(
    "editor-descricao"
  ),

historia:
  obter(
    "editor-historia"
  ),

curiosidades:
  obter(
    "editor-curiosidades"
  )

};
}

/* =========================================================
VALIDAR COMÉRCIO PUBLICADO
========================================================= */

function validarComercioPublicado(
dados
) {

if (!dados.nome) {

mostrarMensagem(
  "Informe o nome do comércio.",
  "erro"
);

return false;

}

if (!dados.categoria) {

mostrarMensagem(
  "Informe a categoria.",
  "erro"
);

return false;

}

if (
dados.latitude !== null &&
(
!Number.isFinite(
dados.latitude
) ||
dados.latitude < -90 ||
dados.latitude > 90
)
) {

mostrarMensagem(
  "Latitude inválida.",
  "erro"
);

return false;

}

if (
dados.longitude !== null &&
(
!Number.isFinite(
dados.longitude
) ||
dados.longitude < -180 ||
dados.longitude > 180
)
) {

mostrarMensagem(
  "Longitude inválida.",
  "erro"
);

return false;

}

return true;
}

/* =========================================================
SALVAR COMÉRCIO PUBLICADO
========================================================= */

async function salvarComercioPublicado() {

if (!comercioEditandoId) {
return;
}

const dados =
obterDadosEditorComercio();

if (
!validarComercioPublicado(
dados
)
) {
return;
}

const confirmar =
confirm(
"Salvar as alterações deste comércio?\n\n" +
"As alterações serão publicadas no DATA/comercios.json."
);

if (!confirmar) {
return;
}

const botao =
document.getElementById(
"salvar-editor-comercio"
);

try {

esconderMensagem();


if (botao) {

  botao.disabled =
    true;

  botao.textContent =
    "⏳ Salvando...";
}


const {
  data,
  error
} =
  await supabaseClient
    .auth
    .getSession();


if (error) {
  throw error;
}


const session =
  data?.session;


if (!session) {

  window.location.href =
    "../index.html";

  return;
}


const resposta =
  await fetch(
    EDGE_FUNCTION_URL,
    {

      method: "POST",

      headers: {

        "Authorization":
          `Bearer ${session.access_token}`,

        "Content-Type":
          "application/json"

      },

      body:
        JSON.stringify({

          acao:
            "editar_comercio",

          comercio_id:
            comercioEditandoId,

          comercio:
            dados

        })

    }
  );


const resultado =
  await resposta.json();


console.log(
  "Resposta da edição:",
  resultado
);


if (
  !resposta.ok ||
  !resultado.ok
) {

  throw new Error(
    resultado.error ||
    resultado.mensagem ||
    `Erro HTTP ${resposta.status}`
  );
}


mostrarMensagem(
  "Comércio atualizado com sucesso.",
  "sucesso"
);


fecharEditorComercio();


await carregarComerciosPublicados();

} catch (erro) {

console.error(
  "Erro ao editar comércio:",
  erro
);


mostrarMensagem(
  `Não foi possível editar o comércio: ${erro.message}`,
  "erro"
);


if (botao) {

  botao.disabled =
    false;

  botao.textContent =
    "💾 Salvar alterações";
}

}
}

/* =========================================================
EXCLUIR COMÉRCIO
========================================================= */

async function excluirComercio(
id
) {

const comercio =
comerciosPublicados.find(
item =>
String(
item.id
) ===
String(id)
);

if (!comercio) {

mostrarMensagem(
  "Comércio não encontrado.",
  "erro"
);

return;

}

const confirmar =
confirm(

  "Excluir este comércio?\n\n" +

  `Comércio: ${
    comercio.nome ||
    "Sem nome"
  }\n\n` +

  "Essa ação removerá o comércio do DATA/comercios.json."

);

if (!confirmar) {
return;
}

try {

esconderMensagem();


const {
  data,
  error
} =
  await supabaseClient
    .auth
    .getSession();


if (error) {
  throw error;
}


const session =
  data?.session;


if (!session) {

  window.location.href =
    "../index.html";

  return;
}


const card =
  document.querySelector(
    `.admin-comercio-card[data-id="${id}"]`
  );


const botao =
  card?.querySelector(
    ".admin-botao-excluir"
  );


if (botao) {

  botao.disabled =
    true;

  botao.textContent =
    "⏳ Excluindo...";
}


const resposta =
  await fetch(
    EDGE_FUNCTION_URL,
    {

      method: "POST",

      headers: {

        "Authorization":
          `Bearer ${session.access_token}`,

        "Content-Type":
          "application/json"

      },

      body:
        JSON.stringify({

          acao:
            "excluir_comercio",

          comercio_id:
            id

        })

    }
  );


const resultado =
  await resposta.json();


console.log(
  "Resposta da exclusão:",
  resultado
);


if (
  !resposta.ok ||
  !resultado.ok
) {

  throw new Error(
    resultado.error ||
    resultado.mensagem ||
    `Erro HTTP ${resposta.status}`
  );
}


mostrarMensagem(
  "Comércio excluído com sucesso.",
  "sucesso"
);


if (
  comercioEditandoId ===
  id
) {

  fecharEditorComercio();
}


await carregarComerciosPublicados();

} catch (erro) {

console.error(
  "Erro ao excluir comércio:",
  erro
);


mostrarMensagem(
  `Não foi possível excluir o comércio: ${erro.message}`,
  "erro"
);


const card =
  document.querySelector(
    `.admin-comercio-card[data-id="${id}"]`
  );


const botao =
  card?.querySelector(
    ".admin-botao-excluir"
  );


if (botao) {

  botao.disabled =
    false;

  botao.textContent =
    "🗑️ Excluir";
}

}
}

/* =========================================================
SAIR
========================================================= */

async function sair() {

try {

const {
  error
} =
  await supabaseClient
    .auth
    .signOut();


if (error) {
  throw error;
}


window.location.href =
  "../index.html";

} catch (erro) {

console.error(
  "Erro ao sair:",
  erro
);


mostrarMensagem(
  "Não foi possível sair.",
  "erro"
);

}
}

/* =========================================================
EVENTOS
========================================================= */

if (botaoAtualizar) {

botaoAtualizar.addEventListener(
"click",
async () => {

  esconderMensagem();

  await carregarCadastros();

  await carregarComerciosPublicados();

}

);

}

if (botaoSair) {

botaoSair.addEventListener(
"click",
sair
);

}

/* =========================================================
AUTENTICAÇÃO
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

}

}
);

/* =========================================================
INICIALIZAÇÃO
========================================================= */

document.addEventListener(
"DOMContentLoaded",
() => {

verificarLogin();

}
);
