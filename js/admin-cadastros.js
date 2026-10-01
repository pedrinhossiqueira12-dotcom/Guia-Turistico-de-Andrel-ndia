/* =========================================================
ANDRELÂNDIA — GUIA TURÍSTICO
ADMIN-CADASTROS.JS

RESPONSABILIDADES:
- Verificação do administrador
- Listagem de cadastros pendentes
- Aprovação
- Rejeição
- Listagem de comércios publicados
- Pesquisa
- Edição
- Exclusão
- Upload de até 4 imagens
========================================================= */

/* =========================================================
CONFIGURAÇÕES
========================================================= */

const SUPABASE_URL = "https://xdmbkflufsfqziixzpxc.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";
const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/whatsapp-bot`;
const ADMIN_USER_ID = "4b9a0233-6b72-4573-aebd-d596c5b15e1b";
const STORAGE_BUCKET = "cadastros";
const LIMITE_IMAGENS = 4;

/* =========================================================
CLIENTE SUPABASE
========================================================= */

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
);

/* =========================================================
ESTADO
========================================================= */

let cadastros = [];
let comerciosPublicados = [];
let pesquisaComerciosAdmin = "";
let comercioEditandoId = null;

/* =========================================================
ELEMENTOS PRINCIPAIS
========================================================= */

const carregando = document.getElementById("carregando");
const listaCadastros = document.getElementById("lista-cadastros");
const semCadastros = document.getElementById("sem-cadastros");
const mensagem = document.getElementById("mensagem");
const botaoAtualizar = document.getElementById("botao-atualizar");
const botaoSair = document.getElementById("botao-sair");

/* =========================================================
MENSAGEM
========================================================= */

function mostrarMensagem(texto, tipo = "sucesso") {
  if (!mensagem) {
    return;
  }

  mensagem.textContent = texto;
  mensagem.className = `mensagem ${tipo}`;
  mensagem.hidden = false;
}

function esconderMensagem() {
  if (!mensagem) {
    return;
  }

  mensagem.hidden = true;
}

/* =========================================================
NORMALIZA TEXTO
========================================================= */

function normalizarTexto(valor) {
  return String(valor ?? "").trim();
}

/* =========================================================
ESCAPA HTML
========================================================= */

function escaparHTML(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* =========================================================
NORMALIZA PESQUISA
========================================================= */

function normalizarPesquisa(valor) {
  return normalizarTexto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/* =========================================================
CHAMA EDGE FUNCTION
========================================================= */

async function chamarEdgeFunction(acao, dados = {}) {
  const { data: sessionData, error: erroSessao } =
    await supabaseClient.auth.getSession();

  if (erroSessao || !sessionData?.session) {
    throw new Error("Sessão administrativa não encontrada.");
  }

  const token = sessionData.session.access_token;

  const resposta = await fetch(EDGE_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "apikey": SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ acao, ...dados }),
  });

  let resultado;

  try {
    resultado = await resposta.json();
  } catch {
    throw new Error("A Edge Function retornou uma resposta inválida.");
  }

  if (!resposta.ok || resultado?.sucesso === false) {
    throw new Error(
      resultado?.erro || resultado?.mensagem || "Erro ao executar operação.",
    );
  }

  return resultado;
}

/* =========================================================
VERIFICA LOGIN / ADMIN
========================================================= */

async function verificarLogin() {
  try {
    const { data, error } = await supabaseClient.auth.getSession();

    if (error || !data?.session?.user) {
      window.location.href = "../index.html";
      return;
    }

    const usuario = data.session.user;

    if (usuario.id !== ADMIN_USER_ID) {
      alert("Você não possui permissão para acessar esta página.");
      window.location.href = "../index.html";
      return;
    }

    await carregarCadastros();
    await carregarComerciosPublicados();
    criarSecaoComerciosAdmin();
  } catch (erro) {
    console.error("Erro na verificação:", erro);
    mostrarMensagem(
      erro.message || "Erro ao carregar painel administrativo.",
      "erro",
    );
  }
}

/* =========================================================
CARREGA CADASTROS PENDENTES
========================================================= */

async function carregarCadastros() {
  if (carregando) {
    carregando.hidden = false;
  }

  try {
    const { data, error } = await supabaseClient
      .from("cadastros_comercios")
      .select("*")
      .eq("status", "pendente")
      .order("criado_em", { ascending: true });

    if (error) {
      throw error;
    }

    cadastros = data || [];
    renderizarCadastros();
  } catch (erro) {
    console.error("Erro ao carregar cadastros:", erro);
    mostrarMensagem(
      erro.message || "Não foi possível carregar os cadastros.",
      "erro",
    );
  } finally {
    if (carregando) {
      carregando.hidden = true;
    }
  }
}

/* =========================================================
RENDERIZA CADASTROS
========================================================= */

function renderizarCadastros() {
  if (!listaCadastros) {
    return;
  }

  listaCadastros.innerHTML = "";

  if (semCadastros) {
    semCadastros.hidden = cadastros.length !== 0;
  }

  if (!cadastros.length) {
    return;
  }

  cadastros.forEach((cadastro) => {
    listaCadastros.appendChild(criarCardCadastro(cadastro));
  });
}

/* =========================================================
CRIA CARD DE CADASTRO
========================================================= */

function criarCardCadastro(cadastro) {
  const card = document.createElement("article");
  card.className = "admin-cadastro-card";

  const imagens = Array.isArray(cadastro?.imagens)
    ? cadastro.imagens
        .map((imagem) => normalizarTexto(imagem))
        .filter(Boolean)
        .slice(0, LIMITE_IMAGENS)
    : [];

  /* Compatibilidade com cadastros antigos (imagem_url) */
  const imagemPrincipal = normalizarTexto(cadastro?.imagem_url);

  if (imagemPrincipal && !imagens.includes(imagemPrincipal)) {
    imagens.unshift(imagemPrincipal);
  }

  const imagensFinais = imagens.slice(0, LIMITE_IMAGENS);

  const imagensHTML = imagensFinais.length
    ? `
      <div class="admin-cadastro-imagens">
        ${imagensFinais
          .map(
            (imagem, indice) => `
              <div class="admin-cadastro-imagem ${indice === 0 ? "principal" : ""}">
                <img
                  src="${escaparHTML(imagem)}"
                  alt="${escaparHTML(cadastro.nome || "Imagem do comércio")} ${indice + 1}"
                  loading="lazy"
                  onerror="this.parentElement.style.display='none';"
                >
                ${
                  indice === 0
                    ? `<span class="admin-cadastro-imagem-capa">CAPA</span>`
                    : ""
                }
              </div>
            `,
          )
          .join("")}
      </div>
    `
    : "";

  card.innerHTML = `
    ${imagensHTML}

    <div class="admin-cadastro-conteudo">

      <span class="admin-cadastro-status">
        Pendente
      </span>

      <h3>
        ${escaparHTML(cadastro.nome || "Sem nome")}
      </h3>

      <p>
        <strong>Categoria:</strong>
        ${escaparHTML(cadastro.categoria || "Não informada")}
      </p>

      <p>
        <strong>WhatsApp:</strong>
        ${escaparHTML(cadastro.whatsapp || "Não informado")}
      </p>

      <p>
        <strong>Endereço:</strong>
        ${escaparHTML(cadastro.endereco || "Não informado")}
      </p>

      ${
        cadastro.descricao
          ? `
            <p>
              <strong>Descrição:</strong>
              ${escaparHTML(cadastro.descricao)}
            </p>
          `
          : ""
      }

      <p>
        <strong>Fotos:</strong>
        ${
          imagensFinais.length
            ? `${imagensFinais.length}/${LIMITE_IMAGENS}`
            : "Nenhuma imagem"
        }
      </p>

      <div class="admin-cadastro-acoes">

        <button
          type="button"
          class="admin-botao-aprovar"
          data-acao="aprovar"
        >
          Aprovar
        </button>

        <button
          type="button"
          class="admin-botao-rejeitar"
          data-acao="rejeitar"
        >
          Rejeitar
        </button>

      </div>

    </div>
  `;

  const botaoAprovar = card.querySelector('[data-acao="aprovar"]');
  const botaoRejeitar = card.querySelector('[data-acao="rejeitar"]');

  botaoAprovar?.addEventListener("click", () =>
    aprovarCadastro(cadastro, botaoAprovar),
  );

  botaoRejeitar?.addEventListener("click", () =>
    rejeitarCadastro(cadastro, botaoRejeitar),
  );

  return card;
}

/* =========================================================
APROVAR CADASTRO
========================================================= */

async function aprovarCadastro(cadastro, botao) {
  if (!confirm(`Aprovar "${cadastro.nome}" e publicar no site?`)) {
    return;
  }

  const textoOriginal = botao.textContent;

  botao.disabled = true;
  botao.textContent = "Publicando...";
  esconderMensagem();

  try {
    const resultado = await chamarEdgeFunction("aprovar_cadastro", {
      cadastro_id: cadastro.id,
    });

    if (resultado?.sucesso) {
      mostrarMensagem("Comércio aprovado e publicado com sucesso.", "sucesso");
      await carregarCadastros();
      await carregarComerciosPublicados();
    }
  } catch (erro) {
    console.error("Erro ao aprovar:", erro);
    mostrarMensagem(erro.message || "Erro ao aprovar cadastro.", "erro");
  } finally {
    botao.disabled = false;
    botao.textContent = textoOriginal;
  }
}

/* =========================================================
REJEITAR CADASTRO
========================================================= */

async function rejeitarCadastro(cadastro, botao) {
  const motivo = prompt(
    `Motivo da rejeição de "${cadastro.nome}"?\n\nVocê pode deixar em branco.`,
  );

  if (motivo === null) {
    return;
  }

  const textoOriginal = botao.textContent;

  botao.disabled = true;
  botao.textContent = "Rejeitando...";

  try {
    await chamarEdgeFunction("rejeitar_cadastro", {
      cadastro_id: cadastro.id,
      motivo: motivo.trim(),
    });

    mostrarMensagem("Cadastro rejeitado.", "sucesso");
    await carregarCadastros();
  } catch (erro) {
    console.error("Erro ao rejeitar:", erro);
    mostrarMensagem(erro.message || "Erro ao rejeitar cadastro.", "erro");
  } finally {
    botao.disabled = false;
    botao.textContent = textoOriginal;
  }
}

/* =========================================================
IMAGENS DO COMÉRCIO
========================================================= */

function obterImagensComercio(comercio) {
  const imagens = [];

  if (Array.isArray(comercio?.imagens)) {
    comercio.imagens.forEach((imagem) => {
      const valor = normalizarTexto(imagem);

      if (valor && !imagens.includes(valor)) {
        imagens.push(valor);
      }
    });
  }

  const imagemPrincipal = normalizarTexto(comercio?.imagem);

  if (imagemPrincipal && !imagens.includes(imagemPrincipal)) {
    imagens.unshift(imagemPrincipal);
  }

  return imagens.slice(0, LIMITE_IMAGENS);
}

/* =========================================================
PRIMEIRA IMAGEM DO COMÉRCIO
========================================================= */

function obterImagemComercio(comercio) {
  const imagens = obterImagensComercio(comercio);

  return (
    imagens[0] ||
    normalizarTexto(comercio?.imagem_url) ||
    normalizarTexto(comercio?.capa) ||
    normalizarTexto(comercio?.galeria?.[0]) ||
    normalizarTexto(comercio?.fotos?.[0]) ||
    ""
  );
}

/* =========================================================
CARREGA COMÉRCIOS PUBLICADOS
========================================================= */

async function carregarComerciosPublicados() {
  try {
    const resposta = await fetch(`../DATA/comercios.json?t=${Date.now()}`, {
      cache: "no-store",
    });

    if (!resposta.ok) {
      throw new Error("Não foi possível carregar DATA/comercios.json.");
    }

    const dados = await resposta.json();

    if (!Array.isArray(dados)) {
      throw new Error("DATA/comercios.json não contém uma lista válida.");
    }

    comerciosPublicados = dados;
    renderizarComerciosAdmin();
  } catch (erro) {
    console.error("Erro ao carregar comércios:", erro);
    mostrarMensagem(
      erro.message || "Erro ao carregar comércios publicados.",
      "erro",
    );
  }
}

/* =========================================================
CRIA SEÇÃO DE COMÉRCIOS
========================================================= */

function criarSecaoComerciosAdmin() {
  const secao = document.getElementById("secaoComercios");

  /* ---------------------------------------------------
  SEÇÃO JÁ EXISTE NO HTML
  --------------------------------------------------- */
  if (secao) {
    let lista =
      document.getElementById("lista-comercios-admin") ||
      document.getElementById("listaComercios");

    if (!lista) {
      lista = document.createElement("div");
      lista.id = "lista-comercios-admin";
      lista.className = "lista-comercios";
      secao.appendChild(lista);
    }

    let pesquisa = document.getElementById("pesquisa-comercios-admin");

    if (!pesquisa) {
      pesquisa = document.createElement("input");
      pesquisa.type = "search";
      pesquisa.id = "pesquisa-comercios-admin";
      pesquisa.className = "admin-comercios-pesquisa";
      pesquisa.placeholder = "Pesquisar comércio...";

      const cabecalho = secao.querySelector(".section-header");

      if (cabecalho) {
        cabecalho.appendChild(pesquisa);
      } else {
        secao.insertBefore(pesquisa, lista);
      }
    }

    pesquisa.addEventListener("input", () => {
      pesquisaComerciosAdmin = pesquisa.value;
      renderizarComerciosAdmin();
    });

    renderizarComerciosAdmin();
    return;
  }

  /* ---------------------------------------------------
  CRIA SEÇÃO NOVA
  --------------------------------------------------- */
  const novaSecao = document.createElement("section");

  novaSecao.className = "secao-comercios-admin";
  novaSecao.id = "secaoComercios";

  novaSecao.innerHTML = `
    <div class="admin-comercios-cabecalho">
      <div>
        <span class="admin-comercios-tag">PUBLICADOS</span>
        <h2>Comércios publicados</h2>
      </div>

      <span class="admin-comercios-contador" id="contadorComerciosAdmin">0</span>
    </div>

    <div class="admin-comercios-pesquisa-wrap">
      <input
        type="search"
        id="pesquisa-comercios-admin"
        class="admin-comercios-pesquisa"
        placeholder="Pesquisar comércio..."
        autocomplete="off"
      >
    </div>

    <div id="editor-comercio-admin" hidden></div>

    <div id="lista-comercios-admin" class="lista-comercios"></div>

    <div id="sem-comercios-admin" class="admin-empty" hidden>
      Nenhum comércio encontrado.
    </div>
  `;

  const principal = document.querySelector("main");

  if (principal) {
    principal.appendChild(novaSecao);
  } else {
    document.body.appendChild(novaSecao);
  }

  const pesquisa = document.getElementById("pesquisa-comercios-admin");

  pesquisa?.addEventListener("input", () => {
    pesquisaComerciosAdmin = pesquisa.value;
    renderizarComerciosAdmin();
  });

  renderizarComerciosAdmin();
}

/* =========================================================
RENDERIZA COMÉRCIOS
========================================================= */

function renderizarComerciosAdmin() {
  const lista =
    document.getElementById("lista-comercios-admin") ||
    document.getElementById("listaComercios");

  if (!lista) {
    return;
  }

  const termo = normalizarPesquisa(pesquisaComerciosAdmin);

  const filtrados = comerciosPublicados.filter((comercio) => {
    if (!termo) {
      return true;
    }

    const campos = [
      comercio?.nome,
      comercio?.categoria,
      comercio?.endereco,
      comercio?.descricao,
      comercio?.telefone,
      comercio?.whatsapp,
      comercio?.instagram,
    ];

    return campos.some((campo) => normalizarPesquisa(campo).includes(termo));
  });

  lista.innerHTML = "";

  const contador =
    document.getElementById("contadorComerciosAdmin") ||
    document.getElementById("contadorComercios");

  if (contador) {
    contador.textContent = filtrados.length;
  }

  const vazio =
    document.getElementById("sem-comercios-admin") ||
    document.getElementById("semComercios");

  if (vazio) {
    vazio.hidden = filtrados.length !== 0;
  }

  filtrados.forEach((comercio) => {
    lista.appendChild(criarCardComercioAdmin(comercio));
  });
}

/* =========================================================
CARD COMÉRCIO PUBLICADO
========================================================= */

function criarCardComercioAdmin(comercio) {
  const card = document.createElement("article");
  card.className = "admin-comercio-card";

  const imagem = obterImagemComercio(comercio);
  const imagens = obterImagensComercio(comercio);

  card.innerHTML = `
    <div class="admin-comercio-imagem">
      ${
        imagem
          ? `
            <img
              src="${escaparHTML(imagem)}"
              alt="${escaparHTML(comercio.nome)}"
              loading="lazy"
              onerror="this.parentElement.classList.add('sem-imagem'); this.style.display='none';"
            >
          `
          : `
            <div class="admin-comercio-sem-imagem">
              Sem imagem
            </div>
          `
      }
    </div>

    <div class="admin-comercio-conteudo">

      <span class="admin-comercio-categoria">
        ${escaparHTML(comercio.categoria || "Sem categoria")}
      </span>

      <h3>
        ${escaparHTML(comercio.nome || "Sem nome")}
      </h3>

      <p>
        ${escaparHTML(comercio.endereco || "Endereço não informado")}
      </p>

      <small>
        ID: ${escaparHTML(comercio.id)}
      </small>

      <small>
        ${imagens.length} ${imagens.length === 1 ? "imagem" : "imagens"}
      </small>

      <div class="admin-comercio-acoes">

        <button
          type="button"
          class="admin-botao-editar"
          data-acao="editar"
        >
          Editar
        </button>

        <button
          type="button"
          class="admin-botao-excluir"
          data-acao="excluir"
        >
          Excluir
        </button>

      </div>

    </div>
  `;

  card
    .querySelector('[data-acao="editar"]')
    ?.addEventListener("click", () => abrirEditorComercio(comercio));

  card
    .querySelector('[data-acao="excluir"]')
    ?.addEventListener("click", () => excluirComercio(comercio.id));

  return card;
}

/* =========================================================
CAMPOS DO EDITOR
========================================================= */

function campoEditorTexto(id, rotulo, valor, largo = false) {
  return `
    <div class="editor-campo ${largo ? "editor-campo-largo" : ""}">
      <label for="editor-${id}">${rotulo}</label>
      <input type="text" id="editor-${id}" value="${escaparHTML(valor ?? "")}">
    </div>
  `;
}

function campoEditorTextarea(id, rotulo, valor, linhas) {
  return `
    <div class="editor-campo editor-campo-largo">
      <label for="editor-${id}">${rotulo}</label>
      <textarea id="editor-${id}" rows="${linhas}">${escaparHTML(valor ?? "")}</textarea>
    </div>
  `;
}

/* =========================================================
EDITOR DE COMÉRCIO
========================================================= */

function abrirEditorComercio(comercio) {
  comercioEditandoId = comercio.id;

  const editor = document.getElementById("editor-comercio-admin");

  if (!editor) {
    console.error("Editor não encontrado.");
    return;
  }

  const imagensExistentes = obterImagensComercio(comercio);

  editor.hidden = false;

  editor.innerHTML = `
    <div class="editor-comercio-topo">
      <div>
        <span>EDITANDO COMÉRCIO</span>
        <h2>${escaparHTML(comercio.nome)}</h2>
      </div>

      <button type="button" class="editor-botao-fechar" id="editor-fechar">
        Fechar
      </button>
    </div>

    <div class="editor-comercio-campos">

      ${campoEditorTexto("nome", "Nome", comercio.nome)}
      ${campoEditorTexto("categoria", "Categoria", comercio.categoria)}
      ${campoEditorTexto("whatsapp", "WhatsApp", comercio.whatsapp)}
      ${campoEditorTexto("telefone", "Telefone", comercio.telefone)}
      ${campoEditorTexto("instagram", "Instagram", comercio.instagram)}
      ${campoEditorTexto("site", "Site", comercio.site)}
      ${campoEditorTexto("endereco", "Endereço", comercio.endereco, true)}
      ${campoEditorTexto("horario", "Horário", comercio.horario)}
      ${campoEditorTexto("latitude", "Latitude", comercio.latitude)}
      ${campoEditorTexto("longitude", "Longitude", comercio.longitude)}

      ${campoEditorTextarea("descricao", "Descrição", comercio.descricao, 4)}
      ${campoEditorTextarea("historia", "História", comercio.historia, 5)}
      ${campoEditorTextarea("curiosidades", "Curiosidades", comercio.curiosidades, 5)}

      <!-- IMAGENS -->
      <div class="editor-imagens">

        <div class="editor-imagens-cabecalho">
          <div>
            <label>Imagens</label>
            <small>
              Até ${LIMITE_IMAGENS} imagens. A primeira será a imagem principal.
            </small>
          </div>

          <span id="editor-contador-imagens" class="editor-contador-imagens">
            ${imagensExistentes.length}/${LIMITE_IMAGENS}
          </span>
        </div>

        <div id="editor-imagens-lista" class="editor-imagens-lista"></div>

        <label
          for="editor-imagem-arquivo"
          id="editor-botao-imagem"
          class="editor-botao-imagem"
        >
          + Adicionar imagens
        </label>

        <input
          type="file"
          id="editor-imagem-arquivo"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
        >

        <small class="editor-imagens-ajuda">
          JPG, PNG ou WEBP · máximo 5 MB por imagem
        </small>

        <input type="hidden" id="editor-imagens-json" value="">

      </div>

    </div>

    <div class="editor-comercio-acoes">
      <button type="button" class="editor-botao-cancelar" id="editor-cancelar">
        Cancelar
      </button>

      <button type="button" class="editor-botao-salvar" id="editor-salvar">
        Salvar alterações
      </button>
    </div>
  `;

  /* -------------------------------------------------------
  ESTADO DAS IMAGENS
  ------------------------------------------------------- */
  const imagensEditor = imagensExistentes.map((url) => ({
    url,
    arquivo: null,
    preview: "",
    nova: false,
  }));

  /* -------------------------------------------------------
  ELEMENTOS
  ------------------------------------------------------- */
  const inputArquivos = document.getElementById("editor-imagem-arquivo");
  const botaoImagem = document.getElementById("editor-botao-imagem");
  const listaImagens = document.getElementById("editor-imagens-lista");
  const contador = document.getElementById("editor-contador-imagens");
  const botaoSalvar = document.getElementById("editor-salvar");

  /* -------------------------------------------------------
  RENDERIZA IMAGENS
  ------------------------------------------------------- */
  function renderizarImagensEditor() {
    listaImagens.innerHTML = "";

    contador.textContent = `${imagensEditor.length}/${LIMITE_IMAGENS}`;
    botaoImagem.style.display =
      imagensEditor.length >= LIMITE_IMAGENS ? "none" : "";

    imagensEditor.forEach((item, indice) => {
      const bloco = document.createElement("div");
      bloco.className = "editor-imagem-item";

      const origem = item.arquivo ? item.preview : item.url;

      bloco.innerHTML = `
        <div class="editor-imagem-preview">
          <img src="${escaparHTML(origem)}" alt="Imagem ${indice + 1}">

          ${
            indice === 0
              ? `<span class="editor-imagem-principal">Principal</span>`
              : ""
          }

          <button
            type="button"
            class="editor-imagem-remover"
            data-indice="${indice}"
            title="Remover imagem"
          >
            ×
          </button>
        </div>

        <span class="editor-imagem-numero">
          Imagem ${indice + 1}
        </span>
      `;

      bloco
        .querySelector(".editor-imagem-remover")
        ?.addEventListener("click", () => removerImagemEditor(indice));

      listaImagens.appendChild(bloco);
    });

    document.getElementById("editor-imagens-json").value = JSON.stringify(
      imagensEditor.map((item) => item.url),
    );
  }

  /* -------------------------------------------------------
  REMOVE IMAGEM
  ------------------------------------------------------- */
  function removerImagemEditor(indice) {
    const item = imagensEditor[indice];

    if (item?.preview) {
      URL.revokeObjectURL(item.preview);
    }

    imagensEditor.splice(indice, 1);
    renderizarImagensEditor();
  }

  /* -------------------------------------------------------
  SELECIONA NOVAS IMAGENS
  ------------------------------------------------------- */
  inputArquivos.addEventListener("change", () => {
    const arquivos = Array.from(inputArquivos.files || []);

    if (!arquivos.length) {
      return;
    }

    const vagas = LIMITE_IMAGENS - imagensEditor.length;

    if (vagas <= 0) {
      alert(`O limite é de ${LIMITE_IMAGENS} imagens.`);
      inputArquivos.value = "";
      return;
    }

    if (arquivos.length > vagas) {
      alert(`Você pode adicionar somente mais ${vagas} imagem(ns).`);
    }

    for (const arquivo of arquivos.slice(0, vagas)) {
      if (!validarImagem(arquivo)) {
        continue;
      }

      imagensEditor.push({
        url: "",
        arquivo,
        preview: URL.createObjectURL(arquivo),
        nova: true,
      });
    }

    inputArquivos.value = "";
    renderizarImagensEditor();
  });

  /* -------------------------------------------------------
  FECHAR EDITOR
  ------------------------------------------------------- */
  const fechar = () => {
    imagensEditor.forEach((item) => {
      if (item.preview) {
        URL.revokeObjectURL(item.preview);
      }
    });

    fecharEditorComercio();
  };

  document.getElementById("editor-fechar")?.addEventListener("click", fechar);
  document.getElementById("editor-cancelar")?.addEventListener("click", fechar);

  /* -------------------------------------------------------
  SALVAR
  ------------------------------------------------------- */
  botaoSalvar?.addEventListener("click", async () => {
    await salvarComercioPublicado(comercio, imagensEditor, botaoSalvar);
  });

  /* -------------------------------------------------------
  PRIMEIRA RENDERIZAÇÃO
  ------------------------------------------------------- */
  renderizarImagensEditor();

  /* -------------------------------------------------------
  ROLA ATÉ O EDITOR
  ------------------------------------------------------- */
  editor.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* =========================================================
VALIDA IMAGEM
========================================================= */

function validarImagem(arquivo) {
  if (!arquivo) {
    return false;
  }

  const tiposPermitidos = ["image/jpeg", "image/png", "image/webp"];

  if (!tiposPermitidos.includes(arquivo.type)) {
    alert(`"${arquivo.name}" não é uma imagem válida.\n\nUse JPG, PNG ou WEBP.`);
    return false;
  }

  const limite = 5 * 1024 * 1024;

  if (arquivo.size > limite) {
    alert(`"${arquivo.name}" ultrapassa o limite de 5 MB.`);
    return false;
  }

  return true;
}

/* =========================================================
GERA NOME SEGURO PARA IMAGEM
========================================================= */

function gerarNomeImagem(usuarioId, arquivo) {
  const nomeOriginal = arquivo.name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-");

  const extensao = nomeOriginal.split(".").pop().toLowerCase();
  const nomeBase = nomeOriginal.replace(/\.[^/.]+$/, "");
  const aleatorio = Math.random().toString(36).substring(2, 9);

  return `admin/${usuarioId}/${Date.now()}-${aleatorio}-${nomeBase}.${extensao}`;
}

/* =========================================================
ENVIA IMAGEM PARA SUPABASE STORAGE
========================================================= */

async function enviarImagemEditor(arquivo, usuarioId) {
  if (!validarImagem(arquivo)) {
    throw new Error("Imagem inválida.");
  }

  const caminho = gerarNomeImagem(usuarioId, arquivo);

  const { error } = await supabaseClient.storage
    .from(STORAGE_BUCKET)
    .upload(caminho, arquivo, {
      cacheControl: "3600",
      upsert: false,
      contentType: arquivo.type,
    });

  if (error) {
    console.error("Erro ao enviar imagem:", error);
    throw new Error(error.message || "Não foi possível enviar a imagem.");
  }

  const { data } = supabaseClient.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(caminho);

  if (!data?.publicUrl) {
    throw new Error(
      "A imagem foi enviada, mas não foi possível obter sua URL pública.",
    );
  }

  return data.publicUrl;
}

/* =========================================================
SALVA COMÉRCIO PUBLICADO
========================================================= */

async function salvarComercioPublicado(comercio, imagensEditor, botao) {
  const valorCampo = (id) =>
    normalizarTexto(document.getElementById(`editor-${id}`)?.value);

  const nome = valorCampo("nome");

  if (!nome) {
    alert("Informe o nome do comércio.");
    return;
  }

  if (imagensEditor.length > LIMITE_IMAGENS) {
    alert(`O limite é de ${LIMITE_IMAGENS} imagens.`);
    return;
  }

  const textoOriginal = botao.textContent;

  botao.disabled = true;
  botao.textContent = "Preparando imagens...";

  try {
    /* USUÁRIO LOGADO */
    const { data, error } = await supabaseClient.auth.getUser();

    if (error || !data?.user) {
      throw new Error("Usuário administrador não encontrado.");
    }

    const usuarioId = data.user.id;

    /* ENVIA NOVAS IMAGENS */
    const imagensFinais = [];

    for (let i = 0; i < imagensEditor.length; i++) {
      const item = imagensEditor[i];

      if (item.arquivo) {
        botao.textContent = `Enviando imagem ${i + 1} de ${imagensEditor.length}...`;
        imagensFinais.push(await enviarImagemEditor(item.arquivo, usuarioId));
      } else if (item.url) {
        imagensFinais.push(item.url);
      }
    }

    botao.textContent = "Salvando comércio...";

    /* DADOS */
    const dados = {
      nome,
      categoria: valorCampo("categoria"),
      whatsapp: valorCampo("whatsapp"),
      telefone: valorCampo("telefone"),
      instagram: valorCampo("instagram"),
      site: valorCampo("site"),
      endereco: valorCampo("endereco"),
      horario: valorCampo("horario"),
      latitude: valorCampo("latitude"),
      longitude: valorCampo("longitude"),
      descricao: valorCampo("descricao"),
      historia: valorCampo("historia"),
      curiosidades: valorCampo("curiosidades"),
      imagem: imagensFinais[0] || "",
      imagens: imagensFinais.slice(0, LIMITE_IMAGENS),
    };

    /* ENVIA PARA EDGE FUNCTION */
    const resultado = await chamarEdgeFunction("editar_comercio", {
      comercio_id: comercio.id,
      comercio: dados,
    });

    if (!resultado?.sucesso) {
      throw new Error(
        resultado?.erro || "Não foi possível salvar as alterações.",
      );
    }

    mostrarMensagem("Comércio atualizado com sucesso.", "sucesso");
    fecharEditorComercio();
    await carregarComerciosPublicados();
  } catch (erro) {
    console.error("Erro ao salvar comércio:", erro);
    mostrarMensagem(erro.message || "Erro ao salvar comércio.", "erro");
  } finally {
    botao.disabled = false;
    botao.textContent = textoOriginal;
  }
}

/* =========================================================
FECHA EDITOR
========================================================= */

function fecharEditorComercio() {
  const editor = document.getElementById("editor-comercio-admin");

  if (editor) {
    editor.hidden = true;
    editor.innerHTML = "";
  }

  comercioEditandoId = null;
}

/* =========================================================
EXCLUI COMÉRCIO
========================================================= */

async function excluirComercio(id) {
  const comercio = comerciosPublicados.find((item) => item.id === id);

  if (!comercio) {
    return;
  }

  const confirmado = confirm(
    `Excluir "${comercio.nome}" do site?\n\n` +
      "Esta ação removerá o comércio do DATA/comercios.json " +
      "e será publicada no GitHub.",
  );

  if (!confirmado) {
    return;
  }

  try {
    mostrarMensagem("Excluindo comércio...", "sucesso");

    await chamarEdgeFunction("excluir_comercio", { comercio_id: id });

    if (comercioEditandoId === id) {
      fecharEditorComercio();
    }

    mostrarMensagem("Comércio excluído com sucesso.", "sucesso");
    await carregarComerciosPublicados();
  } catch (erro) {
    console.error("Erro ao excluir comércio:", erro);
    mostrarMensagem(erro.message || "Erro ao excluir comércio.", "erro");
  }
}

/* =========================================================
BOTÃO ATUALIZAR
========================================================= */

botaoAtualizar?.addEventListener("click", async () => {
  botaoAtualizar.disabled = true;

  const textoOriginal = botaoAtualizar.textContent;
  botaoAtualizar.textContent = "Atualizando...";

  try {
    await carregarCadastros();
    await carregarComerciosPublicados();
    mostrarMensagem("Painel atualizado.", "sucesso");
  } catch (erro) {
    console.error(erro);
  } finally {
    botaoAtualizar.disabled = false;
    botaoAtualizar.textContent = textoOriginal;
  }
});

/* =========================================================
BOTÃO SAIR
========================================================= */

botaoSair?.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  window.location.href = "../index.html";
});

/* =========================================================
ALTERAÇÃO DE AUTENTICAÇÃO
========================================================= */

supabaseClient.auth.onAuthStateChange((evento) => {
  if (evento === "SIGNED_OUT") {
    window.location.href = "../index.html";
  }
});

/* =========================================================
INICIALIZA
========================================================= */

verificarLogin();
