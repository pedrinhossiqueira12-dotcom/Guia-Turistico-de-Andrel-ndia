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

  function supabase() {
    if (!client) client = window.supabaseLoginClient || window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);
    return client;
  }

  function setStatus(message, kind = "info") {
    const target = $("testStatus");
    target.textContent = message;
    target.dataset.kind = kind;
  }

  function setFeedback(id, message, error = false) {
    const target = $(id);
    if (!target) return;
    target.textContent = message || "";
    target.dataset.kind = error ? "error" : "info";
  }

  function setProfileLinks() {
    const profileHref = commerceId ? `local.html?id=${encodeURIComponent(commerceId)}` : "../index.html";
    $("linkPerfilTeste").href = profileHref;
    $("linkCriarConta").href = profileHref;
    $("salesPageLink").href = commerceId ? `catalogo-venda.html?id=${encodeURIComponent(commerceId)}` : "catalogo-venda.html";
    if (!commerceId) {
      setStatus("Informe o comércio na URL para continuar. Nenhuma order será criada.", "error");
      $("loginCard").hidden = true;
      return false;
    }
    return true;
  }

  async function invoke(action, extra = {}) {
    const { data, error } = await supabase().functions.invoke("catalogo-pix-sandbox", {
      body: { acao: action, comercio_id: commerceId, ...extra },
    });
    if (error) {
      let message = "Não foi possível falar com a função sandbox.";
      try {
        const context = error.context;
        const body = context && typeof context.json === "function" ? await context.json() : null;
        if (body?.mensagem) message = body.mensagem;
      } catch { /* não há corpo JSON legível */ }
      throw new Error(message);
    }
    if (data?.success === false) throw new Error(data.mensagem || "A operação de teste falhou.");
    return data || {};
  }

  function priceText(cents) {
    const value = Number(cents);
    if (!Number.isSafeInteger(value) || value < 0) return "";
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
  }

  function renderPlans(plans) {
    const container = $("planList");
    container.replaceChildren();
    if (!Array.isArray(plans) || plans.length === 0) {
      setFeedback("planFeedback", "Os planos de teste não estão disponíveis.", true);
      return;
    }
    for (const plan of plans) {
      if (!plan || !["mensal", "anual"].includes(plan.id)) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "test-plan";
      if (plan.id === "anual") button.classList.add("recommended");
      button.dataset.plan = plan.id;
      const title = document.createElement("strong");
      title.textContent = plan.id === "mensal" ? "Mensal" : "Anual";
      const price = document.createElement("span");
      price.className = "test-price";
      price.textContent = priceText(plan.amount_cents);
      const note = document.createElement("small");
      note.textContent = `Teste de ${Number(plan.duration_days) === 365 ? "365 dias" : "30 dias"}; sem renovação automática e sem ativação real.`;
      button.dataset.price = price.textContent;
      button.dataset.note = note.textContent;
      button.append(title, price, note);
      button.addEventListener("click", () => criarPix(plan.id, button));
      container.append(button);
    }
    setFeedback("planFeedback", "Selecione uma opção. Nenhum preço é publicado na página comercial.");
  }

  function clearPolling() {
    if (pollingTimer) window.clearTimeout(pollingTimer);
    pollingTimer = null;
    pollCount = 0;
  }

  function renderPayment(data) {
    const box = $("paymentBox");
    box.hidden = false;
    const label = data.plan === "anual" ? "Anual" : "Mensal";
    $("paymentTitle").textContent = `${label} — ${priceText(data.amount_cents)}`;
    const status = data.signature_status || "pending";
    const paid = status === "paid";
    $("paymentBadge").textContent = paid ? "APROVADO NO TESTE" : status === "closed" ? "ENCERRADO" : "PENDENTE";
    $("paymentMessage").textContent = paid
      ? "O Mercado Pago aprovou a order de teste. Nenhum valor real foi movimentado e a assinatura continua pendente."
      : "Order de sandbox criada. O QR/código serve somente para o fluxo de teste; a vitrine real continua bloqueada.";
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
      $("pixImageFallback").textContent = pix.code ? "QR de imagem indisponível; use o código de teste ao lado." : "QR sandbox não retornado.";
    }
    $("pixCode").value = typeof pix.code === "string" ? pix.code : "";
    $("copyPixCode").disabled = !$("pixCode").value;
    const ticket = $("pixTicketLink");
    const ticketUrl = typeof pix.ticketUrl === "string" ? pix.ticketUrl : "";
    let safeTicket = false;
    try {
      const parsed = new URL(ticketUrl);
      safeTicket = parsed.protocol === "https:" && parsed.hostname === "www.mercadopago.com.br" && parsed.pathname.includes("/sandbox/");
    } catch { /* link ausente/inválido */ }
    if (safeTicket) {
      ticket.href = ticketUrl;
      ticket.hidden = false;
    } else {
      ticket.removeAttribute("href");
      ticket.hidden = true;
    }
    $("refreshPayment").hidden = paid || status === "closed";
    setFeedback("paymentFeedback", paid
      ? "Confirmação registrada somente em metadata.sandbox. O status não foi alterado para ativa."
      : "Aguardando atualização de status da order de teste.");
  }

  async function refreshStatus(showFeedback = true) {
    try {
      const data = await invoke("consultar_pix_teste");
      if (!data.has_order) {
        if (showFeedback) setFeedback("paymentFeedback", "Nenhuma order de teste pendente para este comércio.");
        return null;
      }
      renderPayment(data);
      if (data.signature_status === "paid") {
        clearPolling();
        setStatus("Teste do Mercado Pago concluído. A vitrine real permanece fechada.", "success");
        return data;
      }
      if (data.signature_status === "closed") {
        clearPolling();
        setStatus("A order de teste foi encerrada. Você pode iniciar uma nova simulação.", "info");
        return data;
      }
      return data;
    } catch (error) {
      if (showFeedback) setFeedback("paymentFeedback", error.message, true);
      return null;
    }
  }

  function schedulePoll() {
    if (pollingTimer || pollCount >= 12) return;
    pollCount += 1;
    pollingTimer = window.setTimeout(async () => {
      pollingTimer = null;
      const result = await refreshStatus(false);
      if (result?.signature_status !== "paid" && result?.signature_status !== "closed") schedulePoll();
    }, 3000);
  }

  async function criarPix(planId, button) {
    if (busy) return;
    busy = true;
    clearPolling();
    const buttons = Array.from($("planList").querySelectorAll("button"));
    buttons.forEach((item) => { item.disabled = true; });
    const note = button.querySelector("small");
    if (note) note.textContent = "Preparando order sandbox…";
    setFeedback("planFeedback", "Validando proprietário e vendedor de teste. Nenhuma cobrança real será criada.");
    try {
      const data = await invoke("criar_pix_teste", { plano: planId });
      if (!data.sandbox || data.catalog_activated !== false || data.subscription_status !== "pendente") {
        throw new Error("O servidor não confirmou o isolamento do sandbox. Order não será exibida.");
      }
      renderPayment(data);
      setStatus("Order de teste gerada. A confirmação não ativa o catálogo.", "success");
      $("paymentBox").scrollIntoView({ behavior: "smooth", block: "center" });
      if (data.signature_status !== "paid" && data.signature_status !== "closed") schedulePoll();
    } catch (error) {
      setFeedback("planFeedback", error.message, true);
      setStatus(error.message, "error");
    } finally {
      busy = false;
      buttons.forEach((item) => { item.disabled = false; });
      const restoredNote = button.querySelector("small");
      if (restoredNote) restoredNote.textContent = button.dataset.note || "Somente sandbox; sem ativação.";
    }
  }

  async function initialize() {
    if (!setProfileLinks()) return;
    let supa;
    try { supa = supabase(); } catch { supa = null; }
    if (!supa?.auth) {
      setStatus("Não foi possível inicializar a sessão. Atualize a página ou abra o perfil do comércio.", "error");
      return;
    }
    const { data: { session } = {} } = await supa.auth.getSession();
    $("loginCard").hidden = Boolean(session);
    if (!session) {
      $("ownerPanel").hidden = true;
      setStatus("Entre com a conta do proprietário. Não há preços nem informações de teste liberados para visitantes.");
      return;
    }
    try {
      const access = await invoke("verificar_proprietario");
      if (!access.proprietario) throw new Error("Esta conta não é proprietária aprovada deste comércio.");
      $("ownerPanel").hidden = false;
      $("introTeste").textContent = `Acesso validado para ${commerceId}. Esta rota não aparece no perfil público.`;
      const plans = await invoke("listar_planos");
      renderPlans(plans.plans);
      setStatus("Proprietário confirmado. As opções exibidas são exclusivamente de sandbox.", "success");
      const latest = await refreshStatus(false);
      if (latest && latest.signature_status !== "paid" && latest.signature_status !== "closed") schedulePoll();
    } catch (error) {
      $("ownerPanel").hidden = true;
      setStatus(error.message || "Não foi possível verificar o vínculo com o comércio.", "error");
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    setProfileLinks();
    $("copyPixCode").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText($("pixCode").value);
        setFeedback("paymentFeedback", "Código Pix de teste copiado.");
      } catch {
        $("pixCode").focus();
        $("pixCode").select();
        setFeedback("paymentFeedback", "Selecione e copie o código manualmente.", true);
      }
    });
    $("refreshPayment").addEventListener("click", async () => {
      $("refreshPayment").disabled = true;
      await refreshStatus();
      $("refreshPayment").disabled = false;
    });
    const supa = supabase();
    supa.auth.onAuthStateChange((event) => {
      if (["SIGNED_IN", "SIGNED_OUT", "TOKEN_REFRESHED"].includes(event)) initialize();
    });
    initialize();
  });
})();
