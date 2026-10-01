/* =========================================================
   ANDRELÂNDIA — GUIA TURÍSTICO
   ADMIN-CADASTROS.JS

   PAINEL ADMINISTRATIVO

   RESPONSABILIDADES:
   - Verificar usuário logado
   - Listar cadastros pendentes
   - Editar dados
   - Salvar alterações
   - Aprovar e publicar via Edge Function
   - Rejeitar cadastro
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

  mensagem.style.display = "block";
}


function esconderMensagem() {

  if (!mensagem) return;

  mensagem.style.display = "none";
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
   VERIFICAR LOGIN
   ========================================================= */

async function verificarLogin() {

/* =======================================================
ID DO ADMINISTRADOR
======================================================= */

const ADMIN_USER_ID =
"4b9a0233-6b72-4573-aebd-d596c5b15e1b";

/* =======================================================
VERIFICAR SESSÃO
======================================================= */

const {
data,
error
} =
await supabaseClient.auth.getSession();

/* -------------------------------------------------------
ERRO AO CONSULTAR SESSÃO
------------------------------------------------------- */

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

/* =======================================================
NÃO ESTÁ LOGADO
======================================================= */

if (!usuario) {

console.warn(
  "Acesso administrativo negado: usuário não autenticado."
);

window.location.href =
  "../index.html";

return;

}

/* =======================================================
VERIFICAR ADMINISTRADOR
======================================================= */

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

/* =======================================================
ACESSO AUTORIZADO
======================================================= */

console.log(
"Acesso administrativo autorizado:",
usuario.id
);

await carregarCadastros();

}

/* =========================================================
   CARREGAR CADASTROS
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
        .eq("status", "pendente")
        .order("criado_em", {
          ascending: true
        });

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
   CRIAR CARD
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
      ? `
        <div class="cadastro-imagem">
          <img
            src="${escaparHTML(
              cadastro.imagem_url
            )}"
            alt="${escaparHTML(
              cadastro.nome ||
              "Imagem do comércio"
            )}"
            loading="lazy"
            onerror="
              this.parentElement.style.display='none'
            "
          >
        </div>
      `
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


      <!-- CABEÇALHO -->

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


      <!-- INFORMAÇÕES -->

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


      <!-- LOCALIZAÇÃO -->

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


      <!-- DETALHES -->

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


      <!-- METADADOS -->

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


      <!-- AÇÕES -->

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
   OBTER DADOS
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
   SALVAR ALTERAÇÕES
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
        .from("cadastros_comercios")
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
        "login.html";

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
        "login.html";

      return;
    }


    const {
      error
    } =
      await supabaseClient
        .from("cadastros_comercios")
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
      "login.html";


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
  (evento, session) => {

    if (
      evento === "SIGNED_OUT"
    ) {

      window.location.href =
        "login.html";

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
