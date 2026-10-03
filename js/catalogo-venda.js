(function () {
  "use strict";

  const SUPABASE_URL = "https://xdmbkflufsfqziixzpxc.supabase.co";
  const SUPABASE_KEY = "sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";
  const parametros = new URLSearchParams(window.location.search);
  const comercioId = (parametros.get("id") || parametros.get("comercio_id") || "").trim();
  const $ = (id) => document.getElementById(id);
  let supabaseClient = null;
  let verificando = false;

  function cliente() {
    if (!supabaseClient) {
      supabaseClient = window.supabaseLoginClient || window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
    return supabaseClient;
  }

  function feedback(texto, erro = false) {
    const target = $("salesFeedback");
    target.textContent = texto || "";
    target.dataset.kind = erro ? "error" : "info";
  }

  function configurarLinks() {
    const hrefPerfil = comercioId ? `local.html?id=${encodeURIComponent(comercioId)}` : "../index.html";
    $("voltarPerfilVenda").href = hrefPerfil;
    $("linkCriarContaVenda").href = hrefPerfil;
    $("linkTestePix").href = `catalogo-pix-teste.html?id=${encodeURIComponent(comercioId)}`;
    $("linkPixProducao").href = `catalogo-pix-producao.html?id=${encodeURIComponent(comercioId)}`;
    $("linkGerenciar").href = `catalogo-admin.html?id=${encodeURIComponent(comercioId)}`;
  }

  function ocultarAcoes() {
    $("linkTestePix").hidden = true;
    $("linkPixProducao").hidden = true;
    $("linkGerenciar").hidden = true;
  }

  async function carregarNomeComercio() {
    if (!comercioId) {
      $("introComercio").textContent = "O identificador do comércio não foi informado. Volte ao perfil para continuar.";
      return;
    }
    try {
      const response = await fetch("../DATA/comercios.json", { cache: "no-store" });
      if (!response.ok) return;
      const lista = await response.json();
      const comercio = Array.isArray(lista) ? lista.find((item) => String(item.id) === comercioId) : null;
      if (comercio) {
        $("introComercio").textContent = `Apresente os produtos de ${comercio.nome} para moradores e visitantes de Andrelândia, sem depender de um site por produto.`;
      }
    } catch (erro) {
      console.warn("Não foi possível obter o nome do comércio.", erro);
    }
  }

  async function verificarAcesso() {
    if (verificando) return;
    verificando = true;
    ocultarAcoes();
    $("loginCardVenda").hidden = false;

    try {
      if (!comercioId) throw new Error("O identificador do comércio não foi informado.");
      const supabase = cliente();
      if (!supabase?.auth) throw new Error("Não foi possível iniciar a sessão. Atualize a página e tente novamente.");

      const { data: { session } = {} } = await supabase.auth.getSession();
      if (!session) {
        $("activationTitle").textContent = "Acesso restrito ao proprietário";
        $("activationText").textContent = "Entre com a conta vinculada ao comércio. Visitantes não recebem opções de teste ou gestão.";
        feedback("");
        return;
      }

      const { data, error } = await supabase.functions.invoke("catalogo-admin", {
        body: { acao: "verificar_proprietario", comercio_id: comercioId },
      });
      if (error) throw error;
      if (!data?.proprietario) throw new Error(data?.mensagem || "Esta conta não está vinculada a este comércio.");

      $("loginCardVenda").hidden = true;
      if (data.bloqueado) {
        $("activationTitle").textContent = "Catálogo temporariamente bloqueado";
        $("activationText").textContent = "O administrador do Guia bloqueou este catálogo. O teste e a gestão estão indisponíveis.";
        feedback(data.motivo_bloqueio || "Entre em contato com a administração do Guia para obter orientação.", true);
        return;
      }

      if (data.ativo) {
        $("activationTitle").textContent = "Seu catálogo está ativo";
        $("activationText").textContent = "A assinatura está ativa. Você pode atualizar produtos, categorias e opções de pedido.";
        $("linkGerenciar").hidden = false;
        feedback("");
        return;
      }

      let checkoutProducaoAtivo = false;
      try {
        const checkout = await supabase.functions.invoke("catalogo-pix-producao", {
          body: { acao: "verificar_checkout", comercio_id: comercioId },
        });
        checkoutProducaoAtivo = !checkout.error && checkout.data?.proprietario === true && checkout.data?.checkout_enabled === true;
      } catch (erro) {
        console.warn("Checkout de produção indisponível; mantendo somente a opção sandbox.", erro);
      }

      if (checkoutProducaoAtivo) {
        $("activationTitle").textContent = "Contratação Pix disponível";
        $("activationText").textContent = "Acesse a área privada para revisar o comércio, o valor e o período antes de gerar um Pix real. A renovação é manual.";
        $("linkPixProducao").hidden = false;
      } else {
        $("activationTitle").textContent = data.assinatura_status === "pendente"
          ? "Solicitação pendente"
          : "Checkout real ainda desligado";
        $("activationText").textContent = "Nenhuma cobrança real pode ser criada nesta etapa. A opção sandbox permanece isolada e não libera a vitrine pública.";
        $("linkTestePix").hidden = false;
      }
      feedback("");
    } catch (erro) {
      $("activationTitle").textContent = "Acesso do proprietário não confirmado";
      $("activationText").textContent = "As opções de teste e gestão permanecem ocultas até que o servidor confirme o vínculo aprovado.";
      feedback(erro.message || "Não foi possível validar a conta. Tente novamente.", true);
    } finally {
      verificando = false;
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    configurarLinks();
    await carregarNomeComercio();
    const supabase = cliente();
    if (supabase?.auth) {
      supabase.auth.onAuthStateChange((evento) => {
        if (["SIGNED_IN", "SIGNED_OUT", "TOKEN_REFRESHED"].includes(evento)) void verificarAcesso();
      });
    }
    await verificarAcesso();
  });
})();
