/* =========================================================
   ANDRELÂNDIA — GUIA TURÍSTICO
   ADMIN-CADASTROS.JS

   RESPONSABILIDADE:
   - Verificar usuário logado
   - Listar cadastros pendentes
   - Editar dados
   - Salvar alterações
   - Testar aprovação via Edge Function
   - Rejeitar cadastro

   PUBLICAÇÃO:
   - A publicação NÃO é feita diretamente pelo navegador.
   - A aprovação será feita pela Edge Function.
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

  if (valor === null || valor === undefined) {
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
   VERIFICAR LOGIN
   ========================================================= */

async function verificarLogin() {

  try {

    esconderMensagem();

    const {
      data,
      error
    } = await supabaseClient.auth.getSession();

    if (error) {
      throw error;
    }

    const session = data.session;

    if (!session) {

      window.location.href = "login.html";

      return;
    }

    await carregarCadastros();

  } catch (erro) {

    console.error(
      "Erro ao verificar login:",
      erro
    );

    mostrarMensagem(
      "Não foi possível verificar o acesso.",
      "erro"
    );
  }
}


/* =========================================================
   CARREGAR CADASTROS PENDENTES
   ========================================================= */

async function carregarCadastros() {

  if (carregando) {
    carregando.style.display = "block";
  }

  if (listaCadastros) {
    listaCadastros.innerHTML = "";
  }

  if (semCadastros) {
    semCadastros.style.display = "none";
  }

  try {

    const {
      data,
      error
    } = await supabaseClient
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
      carregando.style.display = "none";
    }

    if (!data || data.length === 0) {

      if (semCadastros) {
        semCadastros.style.display = "block";
      }

      return;
    }

    data.forEach(cadastro => {

      criarCadastro(cadastro);

    });

  } catch (erro) {

    console.error(
      "Erro ao carregar cadastros:",
      erro
    );

    if (carregando) {
      carregando.style.display = "none";
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

function criarCadastro(cadastro) {

  if (!listaCadastros) {
    return;
  }

  const card =
    document.createElement("div");

  card.className =
    "cadastro-card";

  card.dataset.id =
    cadastro.id;

  const imagem =
    cadastro.imagem_url
      ? `
        <div class="cadastro-imagem">
          <img
            src="${escaparHTML(cadastro.imagem_url)}"
            alt="${escaparHTML(cadastro.nome)}"
            loading="lazy"
            onerror="this.style.display='none'"
          >
        </div>
      `
      : "";


  card.innerHTML = `

    ${imagem}

    <div class="cadastro-conteudo">

      <div class="cadastro-titulo">

        <h2>
          ${escaparHTML(
            cadastro.nome || "Sem nome"
          )}
        </h2>

        <span class="cadastro-status">
          Pendente
        </span>

      </div>


      <div class="cadastro-campos">

        <label>
          Nome
          <input
            type="text"
            id="nome-${cadastro.id}"
            value="${escaparHTML(
              valorOuVazio(cadastro.nome)
            )}"
          >
        </label>


        <label>
          Categoria
          <input
            type="text"
            id="categoria-${cadastro.id}"
            value="${escaparHTML(
              valorOuVazio(cadastro.categoria)
            )}"
          >
        </label>


        <label>
          WhatsApp
          <input
            type="text"
            id="whatsapp-${cadastro.id}"
            value="${escaparHTML(
              valorOuVazio(cadastro.whatsapp)
            )}"
          >
        </label>


        <label>
          Instagram
          <input
            type="text"
            id="instagram-${cadastro.id}"
            value="${escaparHTML(
              valorOuVazio(cadastro.instagram)
            )}"
          >
        </label>


        <label>
          Endereço
          <textarea
            id="endereco-${cadastro.id}"
          >${escaparHTML(
            valorOuVazio(cadastro.endereco)
          )}</textarea>
        </label>


        <label>
          Horário
          <textarea
            id="horario-${cadastro.id}"
          >${escaparHTML(
            valorOuVazio(cadastro.horario)
          )}</textarea>
        </label>


        <label>
          Descrição
          <textarea
            id="descricao-${cadastro.id}"
          >${escaparHTML(
            valorOuVazio(cadastro.descricao)
          )}</textarea>
        </label>


        <label>
          Imagem URL
          <input
            type="url"
            id="imagem-${cadastro.id}"
            value="${escaparHTML(
              valorOuVazio(cadastro.imagem_url)
            )}"
          >
        </label>


        <label>
          Latitude
          <input
            type="number"
            step="any"
            id="latitude-${cadastro.id}"
            value="${escaparHTML(
              valorOuVazio(cadastro.latitude)
            )}"
          >
        </label>


        <label>
          Longitude
          <input
            type="number"
            step="any"
            id="longitude-${cadastro.id}"
            value="${escaparHTML(
              valorOuVazio(cadastro.longitude)
            )}"
          >
        </label>

      </div>


      <div class="cadastro-acoes">

        <button
          type="button"
          class="botao-salvar"
          onclick="salvarCadastro('${cadastro.id}')"
        >
          Salvar alterações
        </button>


        <button
          type="button"
          class="botao-aprovar"
          onclick="aprovarCadastro('${cadastro.id}')"
        >
          Testar aprovação
        </button>


        <button
          type="button"
          class="botao-rejeitar"
          onclick="rejeitarCadastro('${cadastro.id}')"
        >
          Rejeitar
        </button>

      </div>

    </div>
  `;


  listaCadastros.appendChild(card);
}


/* =========================================================
   OBTER DADOS DO CARD
   ========================================================= */

function obterDadosCard(id) {

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
      : Number(latitudeTexto);

  const longitude =
    longitudeTexto === ""
      ? null
      : Number(longitudeTexto);


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
   VALIDAR DADOS
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


  return true;
}


/* =========================================================
   SALVAR ALTERAÇÕES
   ========================================================= */

async function salvarCadastro(id) {

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
    } = await supabaseClient
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
      .eq("id", id)
      .eq("status", "pendente");


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
   TESTAR APROVAÇÃO
   =========================================================

   IMPORTANTE:

   ESTA FUNÇÃO AINDA NÃO APROVA.

   Ela chama a Edge Function com:

   acao: "testar_aprovacao"

   A Edge Function verifica:
   - JWT
   - ADMIN_USER_ID
   - cadastro pendente

   E retorna os dados que seriam publicados.

   NADA é alterado no banco.
   NADA é enviado para o GitHub.
   ========================================================= */

async function aprovarCadastro(id) {

  const confirmar =
    confirm(
      "Deseja testar a aprovação deste cadastro?\n\n" +
      "Neste momento nenhum dado será publicado e o cadastro continuará pendente."
    );


  if (!confirmar) {
    return;
  }


  try {

    esconderMensagem();


    const {
      data,
      error
    } = await supabaseClient.auth.getSession();


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

          body: JSON.stringify({

            acao:
              "testar_aprovacao",

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
      "Resposta da Edge Function:",
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


    const resumo = [

      `Nome: ${comercio.nome || "-"}`,

      `Categoria: ${comercio.categoria || "-"}`,

      `Endereço: ${comercio.endereco || "-"}`,

      `Latitude: ${comercio.latitude ?? "-"}`,

      `Longitude: ${comercio.longitude ?? "-"}`,

      "",

      "TESTE CONCLUÍDO.",

      "Nada foi publicado.",

      "O cadastro continua pendente."

    ].join("\n");


    alert(resumo);


    mostrarMensagem(
      "Teste de aprovação concluído. Nada foi publicado.",
      "sucesso"
    );


  } catch (erro) {

    console.error(
      "Erro no teste de aprovação:",
      erro
    );


    mostrarMensagem(
      `Erro no teste: ${erro.message}`,
      "erro"
    );
  }
}


/* =========================================================
   REJEITAR CADASTRO
   ========================================================= */

async function rejeitarCadastro(id) {

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
      "Deseja realmente rejeitar este cadastro?"
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
      await supabaseClient.auth.getUser();


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
    } = await supabaseClient
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
      .eq("id", id)
      .eq("status", "pendente");


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
      await supabaseClient.auth.signOut();


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
    carregarCadastros
  );

}


if (botaoSair) {

  botaoSair.addEventListener(
    "click",
    sair
  );

}


/* =========================================================
   ALTERAÇÃO DE AUTENTICAÇÃO
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