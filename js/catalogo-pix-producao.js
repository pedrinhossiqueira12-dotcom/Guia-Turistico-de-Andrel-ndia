(function () {
  "use strict";

  const SUPABASE_URL = "https://xdmbkflufsfqziixzpxc.supabase.co";
  const SUPABASE_KEY = "sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";
  const params = new URLSearchParams(window.location.search);
  const commerceId = (params.get("id") || params.get("comercio_id") || "").trim();
  const $ = (id) => document.getElementById(id);
  let client = null;
  let pollingTimer = null;
  let pollCount = 0;
  let busy = false;
  let commerceName = commerceId;
  let viewGeneration = 0;

  function supabase() {
    if (!client) client = window.supabaseLoginClient || window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);
    return client;
  }

  function status(message, kind = "info") {
    $("checkoutStatus").textContent = message;
    $("checkoutStatus").dataset.kind = kind;
  }

  function feedback(id, message, error = false) {
    const target = $(id);
    if (!target) return;
    target.textContent = message || "";
    target.dataset.kind = error ? "error" : "info";
  }

  function setLinks() {
    const salesHref = commerceId ? `catalogo-venda.html?id=${encodeURIComponent(commerceId)}` : "catalogo-venda.html";
    const profileHref = commerceId ? `local.html?id=${encodeURIComponent(commerceId)}` : "../index.html";
    $("linkVoltarCheckout").href = salesHref;
    $("linkPerfilCheckout").href = profileHref;
    if (!commerceId) {
      status("Informe o comércio pela página do Catálogo. Nenhum Pix foi criado.", "error");
      return false;
    }
    return true;
  }

  async function loadCommerceName() {
    try {
      const response = await fetch("../DATA/comercios.json", { cache: "no-store" });
      if (!response.ok) return commerceId;
      const records = await response.json();
      const commerce = Array.isArray(records) ? records.find((item) => String(item.id) === commerceId) : null;
      return commerce?.nome ? String(commerce.nome) : commerceId;
    } catch {
      return commerceId;
    }
  }

  async function invoke(action, extra = {}) {
    const { data, error } = await supabase().functions.invoke("catalogo-pix-producao", {
      body: { acao: action, comercio_id: commerceId, ...extra },
    });
    if (error) {
      let message = "Não foi possível consultar o checkout.";
      try {
        const body = error.context && typeof error.context.json === "function" ? await error.context.json() : null;
        if (body?.mensagem) message = body.mensagem;
      } catch { /* resposta pode não conter JSON */ }
      throw new Error(message);
    }
    if (data?.success === false) throw new Error(data.mensagem || "A operação não foi concluída.");
    return data || {};
  }

  function money(cents) {
    const value = Number(cents);
    if (!Number.isSafeInteger(value) || value < 0) return "";
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
  }

  function stopPolling() {
    if (pollingTimer) window.clearTimeout(pollingTimer);
    pollingTimer = null;
    pollCount = 0;
  }

  function clearPaymentDisplay() {
    viewGeneration += 1;
    stopPolling();
    $("paymentBox").hidden = true;
    $("paymentTitle").textContent = "";
    $("paymentBadge").textContent = "";
    $("paymentMessage").textContent = "";
    $("pixImage").removeAttribute("src");
    $("pixImage").hidden = true;
    $("pixImageFallback").hidden = true;
    $("pixCode").value = "";
    $("copyPixCode").disabled = true;
    $("pixTicketLink").removeAttribute("href");
    $("pixTicketLink").hidden = true;
    $("refreshPayment").hidden = true;
    feedback("paymentFeedback", "");
  }

  function statusLabel(value) {
    return ({
      aprovado: "PAGO",
      pendente: "AGUARDANDO PIX",
      expirado: "EXPIRADO",
      cancelado: "CANCELADO",
      recusado: "RECUSADO",
      estornado: "ESTORNADO",
      contestado: "CONTESTADO",
    })[value] || "PROCESSANDO";
  }

  function renderPayment(data) {
    $("paymentBox").hidden = false;
    const planName = data.plan === "anual" ? "Anual" : "Mensal";
    $("paymentTitle").textContent = `${planName} — ${money(data.amount_cents)}`;
    const paymentState = data.signature_status || "pendente";
    $("paymentBadge").textContent = statusLabel(paymentState);
    $("paymentMessage").textContent = data.mensagem || "Status consultado diretamente no servidor.";

    const pix = data.pix || {};
    const image = $("pixImage");
    if (typeof pix.imageBase64 === "string" && /^[A-Za-z0-9+/=]+$/.test(pix.imageBase64)) {
      image.src = `data:image/png;base64,${pix.imageBase64}`;
      image.hidden = false;
      $("pixImageFallback").hidden = true;
    } else {
      image.removeAttribute("src");
      image.hidden = true;
      $("pixImageFallback").hidden = false;
      $("pixImageFallback").textContent = pix.code ? "QR indisponível; use o código Pix ao lado." : "QR não disponível para este estado.";
    }

    $("pixCode").value = typeof pix.code === "string" ? pix.code : "";
    $("copyPixCode").disabled = $("pixCode").value.length === 0;

    const link = $("pixTicketLink");
    let safeLink = false;
    try {
      const parsed = new URL(typeof pix.ticketUrl === "string" ? pix.ticketUrl : "");
      safeLink = parsed.protocol === "https:" && ["www.mercadopago.com.br", "mercadopago.com.br"].includes(parsed.hostname);
    } catch { /* URL ausente ou inválida */ }
    if (safeLink) {
      link.href = pix.ticketUrl;
      link.hidden = false;
    } else {
      link.removeAttribute("href");
      link.hidden = true;
    }

    const finalState = ["aprovado", "estornado", "contestado", "expirado", "cancelado", "recusado"].includes(paymentState);
    $("refreshPayment").hidden = finalState;
    $("refreshPayment").disabled = false;
    feedback("paymentFeedback", data.catalog_activated
      ? "Pagamento confirmado pela API e assinatura ativada."
      : paymentState === "estornado" || paymentState === "contestado"
        ? "A assinatura foi cancelada e a vitrine bloqueada conforme a regra aprovada."
        : "A vitrine só é liberada após confirmação válida do pagamento.");
    return paymentState;
  }

  async function refresh(showFeedback = true) {
    const generation = viewGeneration;
    try {
      const data = await invoke("consultar_pix");
      if (generation !== viewGeneration) return null;
      if (!data.has_order) {
        clearPaymentDisplay();
        if (showFeedback) feedback("paymentFeedback", "Nenhuma cobrança de produção pendente para este comércio.");
        return null;
      }
      const paymentState = renderPayment(data);
      if (paymentState === "aprovado" && data.catalog_activated) {
        stopPolling();
        status("Pagamento confirmado; assinatura ativa. A vitrine poderá ser gerenciada pelo proprietário.", "success");
      } else if (["estornado", "contestado"].includes(paymentState)) {
        stopPolling();
        status("Estorno/contestação confirmado; assinatura cancelada e vitrine bloqueada.", "error");
      } else if (["expirado", "cancelado", "recusado"].includes(paymentState)) {
        stopPolling();
        status("A cobrança foi encerrada sem ativar a vitrine.");
      }
      return data;
    } catch (error) {
      if (generation !== viewGeneration) return null;
      if (/sessão ausente|sessão inválida|não está vinculada|proprietária aprovada/i.test(error.message)) {
        clearPaymentDisplay();
        $("ownerCheckout").hidden = true;
      }
      if (showFeedback) feedback("paymentFeedback", error.message, true);
      return null;
    }
  }

  function schedulePoll() {
    if (pollingTimer || pollCount >= 30) return;
    pollCount += 1;
    pollingTimer = window.setTimeout(async () => {
      pollingTimer = null;
      const result = await refresh(false);
      if (result && !["aprovado", "estornado", "contestado", "expirado", "cancelado", "recusado"].includes(result.signature_status)) schedulePoll();
    }, 4000);
  }

  async function createPix(plan, button) {
    if (busy) return;
    const amount = money(plan.amount_cents);
    const term = Number(plan.duration_days) === 365 ? "365 dias" : "30 dias";
    const accepted = window.confirm(
      `Comércio: ${commerceName}\nPlano: ${term}\nValor: ${amount}\nRecebedor: conta Mercado Pago que administra o Guia Turístico de Andrelândia.\n\nVocê vai gerar um Pix REAL; ele só será cobrado se for pago. A renovação é manual e não há débito automático. Deseja continuar?`,
    );
    if (!accepted) return;

    busy = true;
    const generation = viewGeneration;
    stopPolling();
    const buttons = Array.from($("planList").querySelectorAll("button"));
    buttons.forEach((item) => { item.disabled = true; });
    button.setAttribute("aria-busy", "true");
    feedback("planFeedback", "Validando conta recebedora e preparando Pix real. Não feche a página.");
    try {
      const data = await invoke("criar_pix", { plano: plan.id });
      if (generation !== viewGeneration) return;
      if (data.production !== true || !["pendente", "aprovado", "estornado", "contestado", "expirado", "cancelado", "recusado"].includes(data.signature_status)) {
        throw new Error("O servidor não confirmou o estado esperado. Não gere outro Pix.");
      }
      const paymentState = renderPayment(data);
      if (paymentState === "pendente") {
        status("Pix real emitido. A vitrine continua fechada até a confirmação da API.", "success");
        schedulePoll();
      } else if (paymentState === "aprovado" && data.catalog_activated) {
        status("Pagamento confirmado e assinatura ativada.", "success");
      } else {
        status(data.mensagem || "A operação foi processada sem ativar a vitrine.", paymentState === "estornado" || paymentState === "contestado" ? "error" : "info");
      }
      $("paymentBox").scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (error) {
      if (generation === viewGeneration) {
        if (/sessão ausente|sessão inválida|não está vinculada|proprietária aprovada/i.test(error.message)) {
          clearPaymentDisplay();
          $("ownerCheckout").hidden = true;
        }
        feedback("planFeedback", error.message, true);
        status(error.message, "error");
      }
    } finally {
      busy = false;
      button.removeAttribute("aria-busy");
      buttons.forEach((item) => { item.disabled = false; });
    }
  }

  function renderPlans(plans) {
    const container = $("planList");
    container.replaceChildren();
    if (!Array.isArray(plans) || !plans.length) {
      feedback("planFeedback", "Os planos não estão disponíveis.", true);
      return;
    }
    for (const plan of plans) {
      if (!plan || !["mensal", "anual"].includes(plan.id)) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "test-plan";
      const name = document.createElement("strong");
      name.textContent = plan.id === "anual" ? "Anual" : "Mensal";
      const price = document.createElement("span");
      price.className = "test-price";
      price.textContent = money(plan.amount_cents);
      const note = document.createElement("small");
      note.textContent = `${Number(plan.duration_days) === 365 ? "365 dias" : "30 dias"}; renovação manual por novo Pix.`;
      const action = document.createElement("span");
      action.className = "plan-action-label";
      action.textContent = "Gerar Pix real";
      button.append(name, price, note, action);
      button.addEventListener("click", () => createPix(plan, button));
      container.append(button);
    }
    feedback("planFeedback", "Confira o comércio e o período; será exibida uma confirmação antes de gerar qualquer cobrança.");
  }

  async function initialize() {
    if (!setLinks()) return;
    clearPaymentDisplay();
    const supa = supabase();
    if (!supa?.auth) {
      status("Não foi possível iniciar a sessão Supabase. Atualize a página.", "error");
      return;
    }
    const { data: { session } = {} } = await supa.auth.getSession();
    if (!session) {
      status("Entre com a conta vinculada ao comércio para continuar. Nenhuma cobrança foi criada.", "error");
      $("ownerCheckout").hidden = true;
      return;
    }
    try {
      const access = await invoke("verificar_checkout");
      if (!access.proprietario) throw new Error("Esta conta não é proprietária aprovada deste comércio.");
      commerceName = await loadCommerceName();
      $("introCheckout").textContent = `Acesso validado para ${commerceName}.`;
      if (access.checkout_enabled !== true) {
        $("ownerCheckout").hidden = true;
        status("O checkout real está desligado. Nenhum Pix ou cobrança real pode ser criado neste momento.");
        return;
      }
      const response = await invoke("listar_planos");
      if (response.production !== true) throw new Error("O servidor não confirmou o ambiente de produção.");
      $("ownerCheckout").hidden = false;
      renderPlans(response.plans);
      status("Proprietário confirmado. Revise o valor antes de gerar o Pix real.", "success");
      const latest = await refresh(false);
      if (latest && !["aprovado", "estornado", "contestado", "expirado", "cancelado", "recusado"].includes(latest.signature_status)) schedulePoll();
    } catch (error) {
      clearPaymentDisplay();
      $("ownerCheckout").hidden = true;
      status(error.message || "Não foi possível validar o checkout. Nenhum Pix foi criado.", "error");
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!setLinks()) return;
    $("copyPixCode").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText($("pixCode").value);
        feedback("paymentFeedback", "Código Pix copiado.");
      } catch {
        $("pixCode").focus();
        $("pixCode").select();
        feedback("paymentFeedback", "Selecione e copie o código manualmente.", true);
      }
    });
    $("refreshPayment").addEventListener("click", async () => {
      $("refreshPayment").disabled = true;
      try {
        await refresh();
      } finally {
        $("refreshPayment").disabled = false;
      }
    });
    const supa = supabase();
    if (!supa?.auth) {
      status("Não foi possível iniciar a sessão Supabase. Atualize a página.", "error");
      return;
    }
    supa.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        clearPaymentDisplay();
        $("ownerCheckout").hidden = true;
        status("Sessão encerrada. O código Pix foi removido desta tela.", "error");
      } else if (event === "SIGNED_IN") {
        void initialize();
      }
    });
    void initialize();
  });
})();
