(() => {
  "use strict";

  const SUPABASE_URL = "https://xdmbkflufsfqziixzpxc.supabase.co";
  const SUPABASE_KEY = "sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";
  const API_URL = `${SUPABASE_URL}/functions/v1/catalogo-entregas`;
  const STATUS_LABELS = {
    aguardando_pagamento: "Aguardando preparo",
    em_preparo: "Em preparo",
    pronto: "Pronto para entrega",
    entregue: "Entregue",
    cancelado: "Cancelado",
  };
  const STALE_REQUEST = "STALE_SESSION_REQUEST";

  const state = {
    client: null,
    session: null,
    sessionToken: "",
    userId: "",
    generation: 0,
    pedidos: [],
    offset: 0,
    hasMore: false,
    timer: null,
    subscription: null,
    destroyed: false,
    lockedAfterLogout: false,
    commerceNames: new Map(),
    loading: false,
  };

  const $ = (id) => document.getElementById(id);

  function obterCliente() {
    if (state.client) return state.client;
    if (window.supabaseLoginClient) {
      state.client = window.supabaseLoginClient;
      return state.client;
    }
    if (window.supabase && typeof window.supabase.createClient === "function") {
      window.supabaseLoginClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      state.client = window.supabaseLoginClient;
      return state.client;
    }
    return null;
  }

  function escapar(valor) {
    return String(valor ?? "").replace(/[&<>"']/g, (caractere) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    })[caractere]);
  }

  function definirFeedback(id, mensagem, erro = false) {
    const elemento = $(id);
    if (!elemento) return;
    elemento.textContent = mensagem || "";
    elemento.classList.toggle("is-error", Boolean(erro));
  }

  function definirAviso(titulo, texto, estado = "") {
    const aviso = $("motoboyNotice");
    if (!aviso) return;
    $("motoboyNoticeTitle").textContent = titulo || "";
    $("motoboyNoticeText").textContent = texto || "";
    aviso.classList.toggle("is-error", estado === "erro");
    aviso.classList.toggle("is-success", estado === "sucesso");
  }

  function formatarMoeda(centavos) {
    const valor = Number(centavos);
    if (!Number.isFinite(valor)) return "R$ 0,00";
    return (valor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function formatarData(valor) {
    if (!valor) return "";
    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) return "";
    return data.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || "Em acompanhamento";
  }

  function enderecoPedido(pedido) {
    return [pedido.cliente_endereco, pedido.cliente_numero, pedido.cliente_bairro, pedido.cliente_complemento, pedido.cliente_referencia, pedido.cliente_cidade]
      .filter((valor) => String(valor ?? "").trim())
      .map((valor) => String(valor).trim())
      .join(", ");
  }

  function telefoneSeguro(valor) {
    const numero = String(valor ?? "").replace(/[^\d+]/g, "");
    return numero.length >= 8 ? `tel:${numero}` : "";
  }

  function rotaSegura(pedido) {
    const destino = enderecoPedido(pedido);
    if (!destino) return "";
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destino)}`;
    try {
      const validada = new URL(url);
      return validada.protocol === "https:" ? validada.href : "";
    } catch {
      return "";
    }
  }

  function validarSessaoAtual(generation, userId) {
    if (state.destroyed || generation !== state.generation || !state.session || state.userId !== userId) {
      throw new Error(STALE_REQUEST);
    }
  }

  async function chamarApi(body, generation = state.generation, userId = state.userId) {
    const cliente = obterCliente();
    if (!cliente) throw new Error("O serviço de login não está disponível. Atualize a página e tente novamente.");
    const { data, error } = await cliente.auth.getSession();
    if (error) throw new Error("Não foi possível verificar sua sessão.");
    const token = data?.session?.access_token;
    if (!token) throw new Error("Sua sessão expirou. Entre novamente.");
    validarSessaoAtual(generation, userId);
    if (data?.session?.user?.id !== userId) throw new Error(STALE_REQUEST);

    const resposta = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const resultado = await resposta.json().catch(() => ({}));
    validarSessaoAtual(generation, userId);
    if (!resposta.ok || resultado?.success !== true) {
      const failure = new Error(resultado?.mensagem || "A operação não foi autorizada.");
      failure.status = resposta.status;
      failure.code = resultado?.codigo || "";
      throw failure;
    }
    return resultado;
  }

  function limparPedidos() {
    state.pedidos = [];
    state.offset = 0;
    state.hasMore = false;
    $("motoboyOrders").innerHTML = "";
    $("motoboyOrders").setAttribute("aria-busy", "false");
    $("motoboyEmpty").hidden = true;
    $("motoboyLoadMore").hidden = true;
  }

  function renderizarPedidos() {
    const lista = $("motoboyOrders");
    const pedidos = state.pedidos;
    if (!pedidos.length) {
      $("motoboyEmpty").hidden = false;
      lista.innerHTML = "";
    } else {
      $("motoboyEmpty").hidden = true;
      lista.innerHTML = pedidos.map(renderizarPedido).join("");
    }
    $("motoboyLoadMore").hidden = !state.hasMore || !pedidos.length;
  }

  function renderizarPedido(pedido) {
    const id = String(pedido.pedido_id || "");
    const comercioId = String(pedido.comercio_id || "");
    const endereco = enderecoPedido(pedido);
    const telefone = telefoneSeguro(pedido.cliente_telefone);
    const rota = rotaSegura(pedido);
    const pronto = pedido.status === "pronto";
    const statusClass = pronto ? "is-ready" : "is-waiting";
    const itens = Array.isArray(pedido.itens) ? pedido.itens : [];
    const itensHtml = itens.length
      ? `<ul class="motoboy-items" aria-label="Itens do pedido">${itens.map((item) => `<li>${escapar(item.quantidade)} × ${escapar(item.nome_produto)}</li>`).join("")}</ul>`
      : "";
    const contato = telefone
      ? `<a href="${escapar(telefone)}">Ligar para o cliente</a>`
      : "Telefone não informado";
    const navegacao = rota
      ? `<a href="${escapar(rota)}" target="_blank" rel="noopener noreferrer">Abrir rota no Google Maps</a>`
      : "Rota indisponível";
    const forma = ({ dinheiro: "Dinheiro", cartao_credito: "Cartão de crédito", cartao_debito: "Cartão de débito", pagamento_entrega: "Pagamento na entrega", pagamento_local: "Pagamento presencial" })[pedido.forma_pagamento] || "Pagamento presencial";
    const orientacao = pronto
      ? "Pedido pronto. Entregue os produtos, receba presencialmente e peça o código ao cliente."
      : "Aguarde o comércio deixar o pedido pronto antes de iniciar a entrega.";
    return `<article class="motoboy-delivery-card" data-pedido-id="${escapar(id)}">
      <div class="motoboy-delivery-header">
        <div>
          <h3>${escapar(state.commerceNames.get(comercioId) || pedido.comercio_nome || comercioId || "Comércio")}</h3>
          <p class="motoboy-order-total">Total do pedido: ${formatarMoeda(pedido.total_centavos)}${pedido.criado_em ? ` · ${escapar(formatarData(pedido.criado_em))}` : ""}</p>
        </div>
        <span class="motoboy-status ${statusClass}">${escapar(statusLabel(pedido.status))}</span>
      </div>
      <div class="motoboy-delivery-details">
        <div class="motoboy-detail-line"><strong>Pagamento</strong><span>${escapar(forma)} · Receber ${formatarMoeda(pedido.total_centavos)}</span></div>
        <div class="motoboy-detail-line"><strong>Cliente</strong><span>${escapar(pedido.cliente_nome || "Cliente")}</span></div>
        <div class="motoboy-detail-line"><strong>Endereço</strong><span>${escapar(endereco || "Endereço não informado")}</span><span>${navegacao}</span></div>
        <div class="motoboy-detail-line"><strong>Contato</strong><span>${contato}</span></div>
      </div>
      ${itensHtml}
      ${pedido.observacoes ? `<p class="motoboy-order-guidance"><strong>Observações:</strong> ${escapar(pedido.observacoes)}</p>` : ""}
      <p class="motoboy-order-guidance">${escapar(orientacao)}</p>
      <div class="motoboy-delivery-actions">
        <button class="motoboy-button motoboy-button-primary" type="button" data-confirmar-pedido="${escapar(id)}" data-confirmar-comercio="${escapar(comercioId)}" ${pronto ? "" : "disabled"}>${pronto ? "Confirmar entrega" : "Aguardar pedido pronto"}</button>
      </div>
    </article>`;
  }

  async function carregarEntregas({ append = false } = {}) {
    if (!state.session || state.loading || !navigator.onLine) {
      if (!navigator.onLine) definirFeedback("motoboyOrdersFeedback", "Você está offline. Use Atualizar quando a conexão voltar.", true);
      return;
    }
    const generation = state.generation;
    const userId = state.userId;
    const offset = append ? Math.min(10000, Math.max(0, Math.floor(Number(state.offset) || 0))) : 0;
    state.loading = true;
    $("motoboyOrders").setAttribute("aria-busy", "true");
    if (!append) {
      $("motoboyEmpty").hidden = true;
      $("motoboyOrders").innerHTML = '<p class="motoboy-feedback">Atualizando entregas…</p>';
    }
    definirFeedback("motoboyOrdersFeedback", "");
    try {
      const resultado = await chamarApi({ acao: "listar_entregas", offset }, generation, userId);
      validarSessaoAtual(generation, userId);
      const pedidos = Array.isArray(resultado.pedidos) ? resultado.pedidos : [];
      state.pedidos = append ? state.pedidos.concat(pedidos) : pedidos;
      state.offset = state.pedidos.length;
      state.hasMore = resultado.has_more === true;
      renderizarPedidos();
      definirAviso("Entregas atualizadas", "A lista mostra apenas pedidos presenciais ativos atribuídos a esta conta.", "sucesso");
    } catch (erro) {
      if (erro.message === STALE_REQUEST) return;
      if (erro.status === 403 || erro.status === 401) { limparPedidos(); fecharConfirmacao(); }
      if (!append) {
        $("motoboyOrders").innerHTML = "";
        $("motoboyEmpty").hidden = true;
      }
      definirFeedback("motoboyOrdersFeedback", erro.message || "Não foi possível carregar suas entregas.", true);
      definirAviso("Não foi possível atualizar", erro.message || "Verifique sua sessão e tente novamente.", "erro");
    } finally {
      if (generation === state.generation) {
        state.loading = false;
        $("motoboyOrders").setAttribute("aria-busy", "false");
      }
    }
  }

  function fecharConfirmacao() {
    const dialog = $("motoboyConfirmDialog");
    if (dialog?.open) dialog.close();
    $("motoboyConfirmForm").reset();
    definirFeedback("motoboyConfirmFeedback", "");
  }

  function abrirConfirmacao(pedidoId, comercioId) {
    if (!state.session) return;
    $("motoboyConfirmForm").reset();
    $("motoboyConfirmOrderId").value = pedidoId || "";
    $("motoboyConfirmCommerceId").value = comercioId || "";
    definirFeedback("motoboyConfirmFeedback", "");
    $("motoboyConfirmDialog").showModal();
    $("motoboyConfirmCode").focus();
  }

  async function confirmarEntrega(event) {
    event.preventDefault();
    const codigo = $("motoboyConfirmCode").value.trim();
    const pedidoId = $("motoboyConfirmOrderId").value;
    const comercioId = $("motoboyConfirmCommerceId").value;
    if (!/^\d{6}$/.test(codigo)) {
      definirFeedback("motoboyConfirmFeedback", "Informe exatamente seis números.", true);
      return;
    }
    if (!$("motoboyConfirmReceived").checked) {
      definirFeedback("motoboyConfirmFeedback", "Confirme que o produto foi entregue e o pagamento presencial foi recebido.", true);
      return;
    }
    const botao = $("motoboySendConfirm");
    const generation = state.generation;
    const userId = state.userId;
    botao.disabled = true;
    definirFeedback("motoboyConfirmFeedback", "Validando código…");
    try {
      const resultado = await chamarApi({
        acao: "confirmar_entrega",
        pedido_id: pedidoId,
        comercio_id: comercioId,
        codigo_entrega: codigo,
        recebimento_confirmado: true,
      }, generation, userId);
      validarSessaoAtual(generation, userId);
      if (resultado?.pedido?.status !== "entregue") throw new Error("A API não confirmou a entrega.");
      state.pedidos = state.pedidos.filter((pedido) => String(pedido.pedido_id) !== String(pedidoId));
      state.offset = state.pedidos.length;
      renderizarPedidos();
      fecharConfirmacao();
      definirFeedback("motoboyOrdersFeedback", "Entrega confirmada com sucesso. O pedido foi removido da sua lista.");
      definirAviso("Entrega confirmada", "O pedido foi atualizado como entregue e não será exibido novamente nesta lista.", "sucesso");
    } catch (erro) {
      if (erro.message === STALE_REQUEST) return;
      if (erro.status === 401 || (erro.status === 403 && erro.code !== "codigo_incorreto" && erro.message !== "Código de entrega incorreto.")) {
        limparPedidos(); fecharConfirmacao();
        definirFeedback("motoboyOrdersFeedback", erro.message, true);
        definirAviso("Acesso à entrega atualizado", "Sua autorização ou atribuição mudou. Atualize a lista antes de continuar.", "erro");
        return;
      }
      // A resposta da API (inclusive 403, 410 ou 429) é exibida sem tentar consumir o código no navegador.
      definirFeedback("motoboyConfirmFeedback", erro.message || "Não foi possível confirmar a entrega.", true);
    } finally {
      if (generation === state.generation) botao.disabled = false;
    }
  }

  function pararPolling() {
    if (state.timer) window.clearInterval(state.timer);
    state.timer = null;
  }

  function iniciarPolling() {
    pararPolling();
    if (!state.session || state.destroyed) return;
    state.timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine && !$("motoboyConfirmDialog")?.open) carregarEntregas();
    }, 30000);
  }

  function limparSessaoVisual() {
    state.generation += 1;
    state.session = null;
    state.sessionToken = "";
    state.userId = "";
    state.loading = false;
    pararPolling();
    limparPedidos();
    fecharConfirmacao();
    $("motoboyLoginCard").hidden = false;
    $("motoboyPanel").hidden = true;
    $("motoboyLogout").hidden = true;
    definirAviso("Entre para consultar suas entregas.", "A autorização para cada comércio é feita pelo proprietário, sem compartilhar senhas.");
  }

  async function aplicarSessao(session) {
    if (state.destroyed || (state.lockedAfterLogout && session)) return;
    const user = session?.user || null;
    const userId = user?.id || "";
    const token = session?.access_token || "";
    if (state.session && userId === state.userId && token === state.sessionToken) return;
    if (!user) {
      limparSessaoVisual();
      return;
    }
    state.generation += 1;
    state.session = session;
    state.sessionToken = token;
    state.userId = userId;
    state.loading = false;
    limparPedidos();
    fecharConfirmacao();
    $("motoboyLoginCard").hidden = true;
    $("motoboyPanel").hidden = false;
    $("motoboyLogout").hidden = false;
    definirFeedback("motoboyLoginFeedback", "");
    definirAviso("Sessão autenticada", "Verificando entregas atribuídas a esta conta…");
    iniciarPolling();
    await carregarEntregas();
  }

  async function fazerLogin(event) {
    event.preventDefault();
    const cliente = obterCliente();
    if (!cliente) {
      definirFeedback("motoboyLoginFeedback", "Não foi possível conectar ao serviço de login.", true);
      return;
    }
    const botao = $("motoboyLoginButton");
    botao.disabled = true;
    definirFeedback("motoboyLoginFeedback", "Entrando…");
    try {
      const email = $("motoboyLoginEmail").value.trim();
      const password = $("motoboyLoginPassword").value;
      const { data, error } = await cliente.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message || "E-mail ou senha incorretos.");
      if (!data?.session) throw new Error("A sessão não ficou disponível. Tente novamente.");
      state.lockedAfterLogout = false;
      $("motoboyLoginPassword").value = "";
      await aplicarSessao(data.session);
    } catch (erro) {
      definirFeedback("motoboyLoginFeedback", erro.message || "Não foi possível entrar.", true);
    } finally {
      botao.disabled = false;
    }
  }

  async function criarConta(event) {
    event.preventDefault();
    const cliente = obterCliente();
    if (!cliente) {
      definirFeedback("motoboySignupFeedback", "Não foi possível conectar ao serviço de login.", true);
      return;
    }
    const nome = $("motoboySignupName").value.trim();
    const email = $("motoboySignupEmail").value.trim();
    const password = $("motoboySignupPassword").value;
    if (!nome) {
      definirFeedback("motoboySignupFeedback", "Informe seu nome.", true);
      return;
    }
    if (password.length < 6) {
      definirFeedback("motoboySignupFeedback", "A senha precisa ter pelo menos 6 caracteres.", true);
      return;
    }
    const botao = $("motoboySignupButton");
    botao.disabled = true;
    definirFeedback("motoboySignupFeedback", "Criando sua conta…");
    try {
      const { data, error } = await cliente.auth.signUp({
        email,
        password,
        options: { data: { nome } },
      });
      if (error) throw new Error(error.message || "Não foi possível criar sua conta.");
      if (data?.session) {
        state.lockedAfterLogout = false;
        $("motoboySignupPassword").value = "";
        await aplicarSessao(data.session);
      } else {
        definirFeedback("motoboySignupFeedback", "Conta criada. Confirme o e-mail e peça ao proprietário para autorizar este e-mail antes de entrar.");
        $("motoboyLoginEmail").value = email;
        $("motoboySignupForm").reset();
      }
    } catch (erro) {
      definirFeedback("motoboySignupFeedback", erro.message || "Não foi possível criar sua conta.", true);
    } finally {
      botao.disabled = false;
    }
  }

  async function sair() {
    const cliente = obterCliente();
    if (!cliente) return;
    state.lockedAfterLogout = true;
    limparSessaoVisual();
    try {
      const { error } = await cliente.auth.signOut({ scope: "local" });
      if (error) throw error;
      definirFeedback("motoboyLoginFeedback", "Você saiu do painel.");
    } catch (erro) {
      limparSessaoVisual();
      definirFeedback("motoboyLoginFeedback", "Não foi possível encerrar a sessão remota. A tela foi bloqueada; entre novamente se precisar continuar.", true);
    }
  }

  function iniciarEventos() {
    $("motoboyLoginForm").addEventListener("submit", fazerLogin);
    $("motoboySignupForm").addEventListener("submit", criarConta);
    $("motoboyLogout").addEventListener("click", sair);
    $("motoboyRefresh").addEventListener("click", () => carregarEntregas());
    $("motoboyLoadMore").addEventListener("click", () => carregarEntregas({ append: true }));
    $("motoboyCancelConfirm").addEventListener("click", fecharConfirmacao);
    $("motoboyConfirmForm").addEventListener("submit", confirmarEntrega);
    $("motoboyOrders").addEventListener("click", (event) => {
      const botao = event.target.closest("[data-confirmar-pedido]");
      if (!botao || botao.disabled) return;
      abrirConfirmacao(botao.dataset.confirmarPedido, botao.dataset.confirmarComercio);
    });
    $("motoboyConfirmDialog").addEventListener("click", (event) => {
      if (event.target === $("motoboyConfirmDialog")) fecharConfirmacao();
    });
    $("motoboyConfirmDialog").addEventListener("close", () => {
      $("motoboyConfirmForm").reset();
      definirFeedback("motoboyConfirmFeedback", "");
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") pararPolling();
      else if (state.session) {
        iniciarPolling();
        if (!$("motoboyConfirmDialog")?.open && navigator.onLine) carregarEntregas();
      }
    });
    window.addEventListener("online", () => {
      if (state.session && document.visibilityState === "visible") carregarEntregas();
    });
    window.addEventListener("pagehide", () => {
      state.destroyed = true;
      state.generation += 1;
      state.session = null;
      state.userId = "";
      state.sessionToken = "";
      pararPolling();
      state.subscription?.unsubscribe?.();
      state.subscription = null;
      fecharConfirmacao();
      limparPedidos();
    });
    window.addEventListener("pageshow", (event) => {
      if (!event.persisted) return;
      state.destroyed = false;
      restaurarAposVoltar();
    });
  }

  async function restaurarAposVoltar() {
    const cliente = obterCliente();
    if (!cliente) return;
    if (!state.subscription) {
      const listener = cliente.auth.onAuthStateChange((_evento, session) => {
        window.setTimeout(() => { aplicarSessao(session); }, 0);
      });
      state.subscription = listener?.data?.subscription || null;
    }
    const { data, error } = await cliente.auth.getSession();
    if (!error && !state.destroyed) await aplicarSessao(data?.session || null);
  }

  async function carregarNomesPublicos() {
    try {
      const response = await fetch("../DATA/comercios.json", { cache: "no-store" });
      if (!response.ok) return;
      const rows = await response.json();
      if (!Array.isArray(rows)) return;
      state.commerceNames = new Map(rows.filter(row => row && row.id && row.nome).map(row => [String(row.id), String(row.nome)]));
    } catch { /* O ID continua como identificacao se os dados publicos falharem. */ }
  }

  async function iniciar() {
    iniciarEventos();
    carregarNomesPublicos().then(() => { if (!state.destroyed && state.session) renderizarPedidos(); });
    const cliente = obterCliente();
    if (!cliente) {
      definirAviso("Login indisponível", "Não foi possível carregar o serviço de autenticação.", "erro");
      return;
    }
    if (!state.subscription) {
    const listener = cliente.auth.onAuthStateChange((_evento, session) => {
      window.setTimeout(() => { aplicarSessao(session); }, 0);
    });
    state.subscription = listener?.data?.subscription || null;
    }
    const { data, error } = await cliente.auth.getSession();
    if (error) {
      definirAviso("Não foi possível verificar a sessão", "Entre novamente para consultar suas entregas.", "erro");
      return;
    }
    await aplicarSessao(data?.session || null);
  }

  document.addEventListener("DOMContentLoaded", iniciar, { once: true });
})();
