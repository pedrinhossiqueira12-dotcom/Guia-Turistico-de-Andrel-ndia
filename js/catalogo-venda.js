(function () {
  "use strict";
  const SUPABASE_URL = "https://xdmbkflufsfqziixzpxc.supabase.co";
  const SUPABASE_KEY = "sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";
  const parametros = new URLSearchParams(window.location.search);
  const comercioId = (parametros.get("id") || parametros.get("comercio_id") || "").trim();
  const $ = (id) => document.getElementById(id);
  let supabaseClient = null;
  let statusProprietario = null;
  let processando = false;

  function cliente() {
    if (!supabaseClient) supabaseClient = window.supabaseLoginClient || window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);
    return supabaseClient;
  }

  function feedback(texto, erro = false) {
    $("salesFeedback").textContent = texto || "";
    $("salesFeedback").style.color = erro ? "#a4332a" : "";
  }

  function linkPerfil() {
    const href = comercioId ? `local.html?id=${encodeURIComponent(comercioId)}` : "../index.html";
    $("voltarPerfilVenda").href = href;
    $("linkCriarContaVenda").href = href;
  }

  async function carregarNomeComercio() {
    if (!comercioId) {
      $("introComercio").textContent = "O identificador do comércio não foi informado. Volte ao perfil para continuar.";
      $("ativarCatalogo").disabled = true;
      return;
    }
    try {
      const response = await fetch("../DATA/comercios.json", { cache: "no-store" });
      const lista = await response.json();
      const comercio = Array.isArray(lista) ? lista.find((item) => String(item.id) === comercioId) : null;
      if (comercio) $("introComercio").textContent = `Apresente os produtos de ${comercio.nome} para moradores e visitantes de Andrelândia, sem depender de um site por produto.`;
    } catch (erro) {
      console.warn("Não foi possível obter o nome do comércio.", erro);
    }
  }

  async function verificarAcesso() {
    if (!comercioId) return;
    const supabase = cliente();
    const { data: { session } = {} } = await supabase.auth.getSession();
    $("loginCardVenda").hidden = Boolean(session);
    if (!session) {
      statusProprietario = null;
      $("ativarCatalogo").disabled = false;
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke("catalogo-admin", {
        body: { acao: "verificar_proprietario", comercio_id: comercioId },
      });
      if (error) throw error;
      if (!data?.proprietario) throw new Error(data?.mensagem || "A conta não está vinculada a este comércio.");
      statusProprietario = data;
      if (data.admin) {
        $("activationTitle").textContent = "Acesso administrativo";
        $("activationText").textContent = "A administração pode abrir o painel de correção; nenhuma contratação será iniciada por esta conta.";
        $("ativarCatalogo").hidden = true;
        $("linkGerenciar").href = `catalogo-admin.html?id=${encodeURIComponent(comercioId)}`;
        $("linkGerenciar").hidden = false;
        return;
      }
      if (data.bloqueado) {
        $("activationTitle").textContent = "Catálogo temporariamente bloqueado";
        $("activationText").textContent = "O administrador do Guia bloqueou este catálogo. Entre em contato pelo perfil do comércio para obter orientação.";
        $("ativarCatalogo").disabled = true;
        return;
      }
      if (data.ativo) {
        $("activationTitle").textContent = "Seu catálogo já está ativo";
        $("activationText").textContent = "A assinatura está ativa. Você pode seguir para o painel e atualizar sua vitrine.";
        $("ativarCatalogo").hidden = true;
        $("linkGerenciar").href = `catalogo-admin.html?id=${encodeURIComponent(comercioId)}`;
        $("linkGerenciar").hidden = false;
        return;
      }
      if (data.assinatura_status === "expirada") {
        $("activationTitle").textContent = "Assinatura expirada";
        $("activationText").textContent = "O catálogo continua fechado até que uma futura cobrança Pix seja definida e confirmada pelo servidor.";
      } else if (data.assinatura_status === "cancelada") {
        $("activationTitle").textContent = "Assinatura cancelada";
        $("activationText").textContent = "Nenhuma cobrança será criada agora. O catálogo só poderá ser reativado após a definição do provedor Pix.";
      }
      if (data.assinatura_status === "pendente") {
        $("activationTitle").textContent = "Interesse registrado";
        $("activationText").textContent = "Há uma solicitação pendente em modo de demonstração. Nenhum Pix foi gerado e o catálogo não foi liberado.";
        $("ativarCatalogo").textContent = "Solicitação já registrada";
        $("ativarCatalogo").disabled = true;
      }
    } catch (erro) {
      statusProprietario = null;
      $("ativarCatalogo").disabled = true;
      feedback(erro.message || "Não foi possível validar o proprietário. Entre pelo perfil do comércio e tente novamente.", true);
    }
  }

  async function solicitarAtivacao() {
    if (processando) return;
    const supabase = cliente();
    const { data: { session } = {} } = await supabase.auth.getSession();
    if (!session) {
      $("loginCardVenda").hidden = false;
      feedback("Entre com a conta vinculada ao comércio para continuar.");
      $("loginCardVenda").scrollIntoView({ behavior: "smooth", block: "center" });
      $("loginEmail").focus();
      return;
    }
    if (!statusProprietario?.proprietario) {
      await verificarAcesso();
      if (!statusProprietario?.proprietario) return;
    }
    if (statusProprietario.ativo || statusProprietario.bloqueado) return;

    processando = true;
    $("ativarCatalogo").disabled = true;
    $("ativarCatalogo").textContent = "Registrando…";
    feedback("Confirmando que você é proprietário. Nenhuma cobrança será criada.");
    try {
      const { data, error } = await supabase.functions.invoke("catalogo-admin", {
        body: { acao: "solicitar_ativacao", comercio_id: comercioId },
      });
      if (error) throw error;
      if (!data?.solicitacao_registrada) throw new Error(data?.mensagem || "Não foi possível registrar o interesse.");
      feedback("Interesse registrado como pendente. Nenhum Pix foi gerado e nenhuma assinatura foi ativada.");
      $("activationTitle").textContent = "Interesse registrado";
      $("activationText").textContent = "Seu pedido de ativação está pendente enquanto o preço e o provedor Pix são definidos. O catálogo permanece bloqueado.";
      $("ativarCatalogo").textContent = "Solicitação já registrada";
      $("ativarCatalogo").disabled = true;
      statusProprietario = { ...statusProprietario, assinatura_status: "pendente" };
    } catch (erro) {
      console.error("Erro ao registrar interesse:", erro);
      feedback(erro.message || "Não foi possível registrar o interesse.", true);
      $("ativarCatalogo").disabled = false;
      $("ativarCatalogo").textContent = "Ativar catálogo";
    } finally {
      processando = false;
    }
  }

  function configurarEventos() {
    $("ativarCatalogo").addEventListener("click", solicitarAtivacao);
    const supabase = cliente();
    supabase.auth.onAuthStateChange((evento) => {
      if (evento === "SIGNED_IN" || evento === "SIGNED_OUT" || evento === "TOKEN_REFRESHED") {
        verificarAcesso();
      }
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    linkPerfil();
    await carregarNomeComercio();
    configurarEventos();
    await verificarAcesso();
  });
})();
