(function () {
  "use strict";

  const SUPABASE_URL = "https://xdmbkflufsfqziixzpxc.supabase.co";
  const SUPABASE_KEY = "sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";
  const params = new URLSearchParams(window.location.search);
  const commerceId = (params.get("id") || params.get("comercio_id") || "").trim();
  const $ = (id) => document.getElementById(id);
  let client = null;
  let busy = false;

  function supabase() {
    if (!client) client = window.supabaseLoginClient || window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);
    return client;
  }
  function status(message, kind = "info") {
    const target = $("checkoutStatus");
    if (!target) return;
    target.textContent = message;
    target.dataset.kind = kind;
  }
  function feedback(message, error = false) {
    const target = $("planFeedback");
    if (!target) return;
    target.textContent = message || "";
    target.dataset.kind = error ? "error" : "info";
  }
  function setBadge(label, kind = "info") {
    const badge = $("receiverBadge");
    if (!badge) return;
    badge.textContent = label;
    badge.dataset.kind = kind;
  }
  function setLinks() {
    const salesHref = commerceId ? `catalogo-venda.html?id=${encodeURIComponent(commerceId)}` : "catalogo-venda.html";
    const profileHref = commerceId ? `local.html?id=${encodeURIComponent(commerceId)}` : "../index.html";
    $("linkVoltarCheckout").href = salesHref;
    $("linkPerfilCheckout").href = profileHref;
  }
  async function invoke(action, extra = {}) {
    const { data, error } = await supabase().functions.invoke("catalogo-pix-producao", {
      body: { acao: action, comercio_id: commerceId, ...extra },
    });
    if (error) {
      let message = "Não foi possível consultar a configuração de recebimentos.";
      try {
        const body = error.context && typeof error.context.json === "function" ? await error.context.json() : null;
        if (body?.mensagem) message = body.mensagem;
      } catch { /* resposta pode não conter JSON */ }
      throw new Error(message);
    }
    if (data?.success === false) throw new Error(data.mensagem || "A operação não foi concluída.");
    return data || {};
  }
  function renderReceiver(data) {
    const ready = data.receiver_status === "ativo" || data.recebedor_status === "ativo";
    const connected = Boolean(data.receiver_connected || data.recebedor_conectado || ready);
    const enabled = data.checkout_enabled === true;
    $("ownerCheckout").hidden = false;
    $("paymentBox").hidden = false;
    $("receiverStatusTitle").textContent = connected ? "Conta Mercado Pago conectada" : "Conexão pendente";
    $("receiverStatusText").textContent = connected
      ? (enabled ? "O comércio está pronto para receber pedidos via Pix." : "A conta está conectada e o catálogo está liberado; o checkout global ainda está em validação.")
      : "Conecte a conta Mercado Pago do comércio para ativar o split dos pedidos.";
    $("paymentMessage").textContent = enabled
      ? "A configuração do checkout de pedidos está disponível para este comércio."
      : connected
        ? "Conta conectada. O checkout de pedidos permanece desligado até a conclusão da configuração do marketplace."
        : "O checkout de pedidos permanece desligado até a conclusão da configuração do marketplace.";
    $("refreshPayment").hidden = false;
    $("refreshPayment").disabled = false;
    $("connectMercadoPago").hidden = connected;
    $("disconnectMercadoPago").hidden = !connected;
    setBadge(enabled ? "ATIVO" : connected ? "CONECTADO" : "PENDENTE", enabled || connected ? "success" : "info");
    status(connected ? "Conta recebedora conectada." : "Aguardando configuração da conta recebedora.", connected ? "success" : "info");
  }
  async function refresh() {
    if (busy || !commerceId) return;
    busy = true;
    $("refreshPayment").disabled = true;
    status("Consultando a configuração de recebimentos…");
    try {
      const data = await invoke("verificar_recebedor");
      renderReceiver(data);
      feedback(data.mensagem || "Status atualizado.");
    } catch (error) {
      setBadge("INDISPONÍVEL", "error");
      status(error.message || "Não foi possível consultar a configuração.", "error");
      feedback(error.message, true);
    } finally {
      busy = false;
      $("refreshPayment").disabled = false;
    }
  }
  async function connect() {
    if (busy) return;
    busy = true;
    $("connectMercadoPago").disabled = true;
    feedback("Preparando a conexão segura com o Mercado Pago…");
    try {
      const data = await invoke("iniciar_conexao");
      if (!data.authorization_url) throw new Error(data.mensagem || "A conexão ainda não está configurada pelo administrador.");
      window.location.assign(data.authorization_url);
    } catch (error) {
      feedback(error.message || "Não foi possível iniciar a conexão.", true);
      status(error.message || "Conexão ainda não disponível.", "error");
    } finally {
      busy = false;
      $("connectMercadoPago").disabled = false;
    }
  }
  async function disconnect() {
    if (busy || !window.confirm("Desconectar a conta Mercado Pago deste comércio? O comércio e o histórico serão preservados.")) return;
    busy = true;
    $("disconnectMercadoPago").disabled = true;
    feedback("Desconectando a conta Mercado Pago…");
    try {
      const data = await invoke("desconectar_recebedor");
      feedback(data.mensagem || "Conta desconectada.");
      await refresh();
    } catch (error) {
      feedback(error.message || "Não foi possível desconectar a conta.", true);
      status(error.message || "Não foi possível desconectar a conta.", "error");
    } finally {
      busy = false;
      $("disconnectMercadoPago").disabled = false;
    }
  }
  async function init() {
    setLinks();
    const oauthResult = params.get("oauth");
    if (oauthResult === "success") {
      feedback("Conta Mercado Pago conectada com sucesso. Atualizando o status…");
      window.history.replaceState({}, document.title, `${window.location.pathname}?id=${encodeURIComponent(commerceId)}`);
    } else if (oauthResult === "error") {
      feedback("Não foi possível concluir a conexão. Tente novamente.", true);
      window.history.replaceState({}, document.title, `${window.location.pathname}?id=${encodeURIComponent(commerceId)}`);
    }
    if (!commerceId) {
      status("O identificador do comércio não foi informado.", "error");
      return;
    }
    if (!supabase()?.auth) {
      status("Não foi possível iniciar a sessão. Atualize a página e tente novamente.", "error");
      return;
    }
    const { data: { session } = {} } = await supabase().auth.getSession();
    if (!session) {
      setBadge("LOGIN NECESSÁRIO", "error");
      status("Entre com a conta vinculada ao comércio para configurar os recebimentos.", "error");
      return;
    }
    $("connectMercadoPago").addEventListener("click", connect);
    $("disconnectMercadoPago").addEventListener("click", disconnect);
    $("refreshPayment").addEventListener("click", refresh);
    await refresh();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
