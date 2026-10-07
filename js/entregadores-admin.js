(() => {
  "use strict";

  const SUPABASE_URL = "https://xdmbkflufsfqziixzpxc.supabase.co";
  const SUPABASE_KEY = "sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";
  const API_URL = `${SUPABASE_URL}/functions/v1/catalogo-entregas`;
  const parametros = new URLSearchParams(window.location.search);
  const COMERCIO_ID = (parametros.get("id") || parametros.get("comercio_id") || "").trim();
  const STALE_REQUEST = "STALE_SESSION_REQUEST";
  const STATUS_LABELS = {
    aguardando_pagamento: "Aguardando preparo",
    em_preparo: "Em preparo",
    pronto: "Pronto para entrega",
    entregue: "Entregue",
    cancelado: "Cancelado",
  };
  const state = {
    client: null,
    session: null,
    sessionToken: "",
    userId: "",
    generation: 0,
    motoboys: [],
    pedidos: [],
    maisMotoboys: false,
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

  function feedback(id, mensagem, erro = false) {
    const elemento = $(id);
    if (!elemento) return;
    elemento.textContent = mensagem || "";
    elemento.classList.toggle("is-error", Boolean(erro));
  }

  function aviso(titulo, texto, estado = "") {
    $("entregadoresNoticeTitle").textContent = titulo || "";
    $("entregadoresNoticeText").textContent = texto || "";
    $("entregadoresNotice").classList.toggle("is-error", estado === "erro");
    $("entregadoresNotice").classList.toggle("is-success", estado === "sucesso");
  }

  function validarSessaoAtual(generation, userId) {
    if (state.destroyed || generation !== state.generation || !state.session || state.userId !== userId) {
      throw new Error(STALE_REQUEST);
    }
  }

  async function chamarApi(acao, dados = {}, generation = state.generation, userId = state.userId) {
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
      body: JSON.stringify({ acao, comercio_id: COMERCIO_ID, ...dados }),
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

  function limparDados() {
    state.motoboys = [];
    state.pedidos = [];
    state.maisMotoboys = false;
    if ($("maisMotoboys")) $("maisMotoboys").hidden = true;
    if ($("listaMotoboys")) $("listaMotoboys").innerHTML = "";
    $("autorizarMotoboyForm").reset();
  }

  function formatarData(valor) {
    if (!valor) return "";
    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) return "";
    return data.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }

  function enderecoPedido(pedido) {
    return [pedido.cliente_endereco, pedido.cliente_numero, pedido.cliente_bairro, pedido.cliente_complemento, pedido.cliente_referencia, pedido.cliente_cidade]
      .filter((valor) => String(valor ?? "").trim())
      .join(", ");
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || "Em acompanhamento";
  }

  function renderizarMotoboys() {
    $("maisMotoboys").hidden = !state.maisMotoboys;
    const lista = $("listaMotoboys");
    if (!state.motoboys.length) {
      lista.innerHTML = '<p class="motoboy-feedback">Nenhum entregador autorizado para este comércio.</p>';
      return;
    }
    lista.innerHTML = state.motoboys.map((motoboy) => {
      const ativo = motoboy.ativo === true;
      const nome = motoboy.nome || "Entregador";
      return `<article class="motoboy-owner-row">
        <div class="motoboy-owner-copy">
          <strong>${escapar(nome)}</strong>
          <small>${escapar(motoboy.email || "E-mail não informado")}</small>
          <small>${ativo ? "Ativo neste comércio" : "Suspenso neste comércio"}</small>
        </div>
        <div class="motoboy-owner-actions">
          ${ativo ? `<button class="motoboy-small-button is-danger" type="button" data-suspender-motoboy="${escapar(motoboy.usuario_id)}">Suspender</button>` : '<span class="motoboy-status is-waiting">Suspenso</span>'}
        </div>
      </article>`;
    }).join("");
  }

  async function carregarMotoboys(generation = state.generation, userId = state.userId) {
    const resultado = await chamarApi("listar_motoboys", {}, generation, userId);
    validarSessaoAtual(generation, userId);
    state.motoboys = Array.isArray(resultado.motoboys) ? resultado.motoboys : [];
    state.maisMotoboys = resultado.has_more === true;
    renderizarMotoboys();
  }

  async function carregarPainel() {
    if (!state.session || state.loading) return;
    const generation = state.generation;
    const userId = state.userId;
    state.loading = true;
    $("listaMotoboys").setAttribute("aria-busy", "true");
    $("listaMotoboys").innerHTML = '<p class="motoboy-feedback">Atualizando autorizações…</p>';
    try {
      const motoboys = await chamarApi("listar_motoboys", {}, generation, userId);
      validarSessaoAtual(generation, userId);
      state.motoboys = Array.isArray(motoboys.motoboys) ? motoboys.motoboys : [];
      state.maisMotoboys = motoboys.has_more === true;
      renderizarMotoboys();
      $("entregadoresPanel").hidden = false;
      aviso("Acesso confirmado", "A lista é deste comércio. A API continua validando o papel do proprietário no servidor.", "sucesso");
    } catch (erro) {
      if (erro.message === STALE_REQUEST) return;
      limparDados();
      $("entregadoresPanel").hidden = true;
      feedback("listaMotoboysFeedback", erro.message || "Não foi possível carregar os entregadores.", true);
      aviso("Acesso não confirmado", erro.message || "A API recusou esta operação.", "erro");
    } finally {
      if (generation === state.generation) {
        state.loading = false;
        $("listaMotoboys").setAttribute("aria-busy", "false");
      }
    }
  }

  async function autorizarMotoboy(event) {
    event.preventDefault();
    const email = $("autorizarMotoboyEmail").value.trim();
    const nome = $("autorizarMotoboyNome").value.trim();
    if (!email || !nome) { feedback("autorizarMotoboyFeedback", "Informe nome e e-mail do entregador.", true); return; }
    const botao = $("autorizarMotoboyButton");
    botao.disabled = true;
    feedback("autorizarMotoboyFeedback", "Verificando a conta…");
    try {
      await chamarApi("autorizar_motoboy", { email, nome });
      $("autorizarMotoboyForm").reset();
      feedback("autorizarMotoboyFeedback", "Entregador autorizado para este comércio.");
      await carregarPainel();
    } catch (erro) {
      if (erro.message !== STALE_REQUEST) feedback("autorizarMotoboyFeedback", erro.message || "Não foi possível autorizar o entregador.", true);
    } finally {
      botao.disabled = false;
    }
  }

  async function suspenderMotoboy(motoboyId, botao) {
    if (!motoboyId || !window.confirm("Suspender este entregador para este comércio? A revogação pode ser revertida ao autorizar o mesmo e-mail novamente.")) return;
    botao.disabled = true;
    feedback("listaMotoboysFeedback", "Suspensão em andamento…");
    try {
      await chamarApi("suspender_motoboy", { motoboy_id: motoboyId });
      feedback("listaMotoboysFeedback", "Entregador suspenso. As entregas deste comércio ficam bloqueadas para ele.");
      await carregarPainel();
    } catch (erro) {
      if (erro.message !== STALE_REQUEST) feedback("listaMotoboysFeedback", erro.message || "Não foi possível suspender o entregador.", true);
    } finally {
      botao.disabled = false;
    }
  }

  async function carregarMais(tipo) {
    if (!state.session || state.loading) return;
    const generation = state.generation, userId = state.userId;
    const botao = $("maisMotoboys");
    state.loading = true; botao.disabled = true;
    try {
      const result = await chamarApi("listar_motoboys", {
        offset: state.motoboys.length,
      }, generation, userId);
      validarSessaoAtual(generation, userId);
      const combined = new Map(state.motoboys.map(item => [item.usuario_id, item]));
      for (const item of result.motoboys || []) combined.set(item.usuario_id, item);
      state.motoboys = [...combined.values()]; state.maisMotoboys = result.has_more === true;
      renderizarMotoboys();
    } catch (error) {
      if (error.message !== STALE_REQUEST) feedback("listaMotoboysFeedback", error.message, true);
    } finally { if (generation === state.generation) { state.loading = false; botao.disabled = false; } }
  }

  function limparSessaoVisual() {
    state.generation += 1;
    state.session = null;
    state.sessionToken = "";
    state.userId = "";
    state.loading = false;
    limparDados();
    $("entregadoresLoginCard").hidden = false;
    $("entregadoresPanel").hidden = true;
    $("entregadoresLogout").hidden = true;
    aviso("Entre para continuar.", "Somente o proprietário autenticado pode administrar as autorizações deste comércio.");
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
    limparDados();
    $("entregadoresLoginCard").hidden = true;
    $("entregadoresPanel").hidden = true;
    $("entregadoresLogout").hidden = false;
    feedback("entregadoresLoginFeedback", "");
    aviso("Sessão autenticada", "Verificando a autorização do proprietário…");
    await carregarPainel();
  }

  async function fazerLogin(event) {
    event.preventDefault();
    const cliente = obterCliente();
    if (!cliente) {
      feedback("entregadoresLoginFeedback", "Não foi possível conectar ao serviço de login.", true);
      return;
    }
    if (!COMERCIO_ID) {
      feedback("entregadoresLoginFeedback", "O comércio desta página não foi identificado.", true);
      return;
    }
    const botao = $("entregadoresLoginButton");
    botao.disabled = true;
    feedback("entregadoresLoginFeedback", "Entrando…");
    try {
      const email = $("entregadoresLoginEmail").value.trim();
      const password = $("entregadoresLoginPassword").value;
      const { data, error } = await cliente.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message || "E-mail ou senha incorretos.");
      if (!data?.session) throw new Error("A sessão não ficou disponível. Tente novamente.");
      state.lockedAfterLogout = false;
      $("entregadoresLoginPassword").value = "";
      await aplicarSessao(data.session);
    } catch (erro) {
      feedback("entregadoresLoginFeedback", erro.message || "Não foi possível entrar.", true);
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
      feedback("entregadoresLoginFeedback", "Você saiu da gestão.");
    } catch (erro) {
      limparSessaoVisual();
      feedback("entregadoresLoginFeedback", "Não foi possível encerrar a sessão remota. A tela foi bloqueada; entre novamente se precisar continuar.", true);
    }
  }

  function iniciarEventos() {
    $("entregadoresLoginForm").addEventListener("submit", fazerLogin);
    $("entregadoresLogout").addEventListener("click", sair);
    $("autorizarMotoboyForm").addEventListener("submit", autorizarMotoboy);
    $("maisMotoboys").addEventListener("click", () => carregarMais("motoboys"));
    $("atualizarMotoboys").addEventListener("click", carregarPainel);
    $("listaMotoboys").addEventListener("click", (event) => {
      const botao = event.target.closest("[data-suspender-motoboy]");
      if (botao) suspenderMotoboy(botao.dataset.suspenderMotoboy, botao);
    });
    window.addEventListener("pagehide", () => {
      state.destroyed = true;
      state.generation += 1;
      state.session = null;
      state.userId = "";
      state.sessionToken = "";
      state.subscription?.unsubscribe?.();
      state.subscription = null;
      limparDados();
    });
    window.addEventListener("pageshow", (event) => {
      if (!event.persisted) return;
      state.destroyed = false;
      restaurarAposVoltar();
    });
  }

  function configurarLinks() {
    const query = COMERCIO_ID ? `?id=${encodeURIComponent(COMERCIO_ID)}` : "";
    $("linkVoltarCatalogo").href = `catalogo-admin.html${query}`;
    $("linkAbrirMotoboy").href = "motoboy.html";
    $("entregadoresCommerceName").textContent = COMERCIO_ID
      ? `Autorize as contas que podem receber pedidos de entrega deste comércio (${state.commerceNames.get(COMERCIO_ID) || COMERCIO_ID}).`
      : "Esta página precisa do identificador do comércio para continuar.";
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
    carregarNomesPublicos().then(() => { if (!state.destroyed) configurarLinks(); });
    configurarLinks();
    iniciarEventos();
    if (!COMERCIO_ID) {
      $("entregadoresLoginCard").hidden = true;
      aviso("Comércio não identificado", "Abra esta tela pelo catálogo do comércio para administrar entregadores.", "erro");
      return;
    }
    const cliente = obterCliente();
    if (!cliente) {
      aviso("Login indisponível", "Não foi possível carregar o serviço de autenticação.", "erro");
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
      aviso("Não foi possível verificar a sessão", "Entre novamente para abrir a gestão.", "erro");
      return;
    }
    await aplicarSessao(data?.session || null);
  }

  document.addEventListener("DOMContentLoaded", iniciar, { once: true });
})();
