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
    maisPedidos: false,
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
    state.maisMotoboys = false; state.maisPedidos = false;
    if ($("maisMotoboys")) $("maisMotoboys").hidden = true;
    if ($("maisAtribuicoes")) $("maisAtribuicoes").hidden = true;
    if ($("listaMotoboys")) $("listaMotoboys").innerHTML = "";
    $("autorizarMotoboyForm").reset();
    if ($("listaAtribuicoes")) $("listaAtribuicoes").innerHTML = "";
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

  function opcoesMotoboys(pedido) {
    const ativos = state.motoboys.filter((motoboy) => motoboy.ativo === true);
    const atual = String(pedido.motoboy_id || "");
    const opcaoAtual = atual && !ativos.some((motoboy) => String(motoboy.usuario_id) === atual)
      ? '<option value="" selected>Retirar atribuição</option>'
      : '<option value="">Retirar atribuição</option>';
    return opcaoAtual + ativos.map((motoboy) => `<option value="${escapar(motoboy.usuario_id)}" ${String(motoboy.usuario_id) === atual ? "selected" : ""}>${escapar(motoboy.nome || motoboy.email || "Entregador")}</option>`).join("");
  }

  function renderizarAtribuicoes() {
    $("maisAtribuicoes").hidden = !state.maisPedidos;
    const lista = $("listaAtribuicoes");
    if (!state.pedidos.length) {
      lista.innerHTML = '<p class="motoboy-feedback">Nenhum pedido ativo de entrega para atribuir.</p>';
      return;
    }
    lista.innerHTML = state.pedidos.map((pedido) => {
      const atual = state.motoboys.find((motoboy) => String(motoboy.usuario_id) === String(pedido.motoboy_id || ""));
      const endereco = enderecoPedido(pedido);
      const itens = Array.isArray(pedido.itens) ? pedido.itens.map((item) => `${item.quantidade} × ${item.nome_produto}`).join(" · ") : "";
      return `<article class="motoboy-assignment-card">
        <h3>${escapar(pedido.cliente_nome || "Cliente")}</h3>
        <p class="motoboy-assignment-meta"><strong>${escapar(statusLabel(pedido.status))}</strong>${pedido.comercio_nome ? ` · ${escapar(state.commerceNames.get(String(pedido.comercio_id)) || pedido.comercio_nome)}` : ""}${pedido.criado_em ? ` · ${escapar(formatarData(pedido.criado_em))}` : ""}<br>${escapar(endereco || "Endereço não informado")}${itens ? `<br>Itens: ${escapar(itens)}` : ""}</p>
        <p class="motoboy-assignment-meta">${atual ? `Atribuído atualmente a: <strong>${escapar(atual.nome || atual.email || "Entregador")}</strong>` : pedido.motoboy_id ? "Atribuição atual está suspensa; escolha um entregador ativo." : "Sem entregador atribuído."}</p>
        <div class="motoboy-assignment-form">
          <label for="atribuir-${escapar(pedido.pedido_id)}">Entregador ativo</label>
          <select id="atribuir-${escapar(pedido.pedido_id)}" class="motoboy-assignment-select" data-pedido-select="${escapar(pedido.pedido_id)}">${opcoesMotoboys(pedido)}</select>
          <button class="motoboy-small-button" type="button" data-atribuir-pedido="${escapar(pedido.pedido_id)}">Atribuir pedido</button>
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

  async function carregarAtribuicoes(generation = state.generation, userId = state.userId) {
    const resultado = await chamarApi("listar_para_atribuicao", {}, generation, userId);
    validarSessaoAtual(generation, userId);
    state.pedidos = Array.isArray(resultado.pedidos) ? resultado.pedidos : [];
    state.maisPedidos = resultado.has_more === true;
    renderizarAtribuicoes();
  }

  async function carregarPainel() {
    if (!state.session || state.loading) return;
    const generation = state.generation;
    const userId = state.userId;
    state.loading = true;
    $("listaMotoboys").setAttribute("aria-busy", "true");
    $("listaAtribuicoes").setAttribute("aria-busy", "true");
    $("listaMotoboys").innerHTML = '<p class="motoboy-feedback">Atualizando autorizações…</p>';
    $("listaAtribuicoes").innerHTML = '<p class="motoboy-feedback">Atualizando pedidos…</p>';
    try {
      const [motoboys, pedidos] = await Promise.all([
        chamarApi("listar_motoboys", {}, generation, userId),
        chamarApi("listar_para_atribuicao", {}, generation, userId),
      ]);
      validarSessaoAtual(generation, userId);
      state.motoboys = Array.isArray(motoboys.motoboys) ? motoboys.motoboys : [];
      state.pedidos = Array.isArray(pedidos.pedidos) ? pedidos.pedidos : [];
      state.maisMotoboys = motoboys.has_more === true; state.maisPedidos = pedidos.has_more === true;
      renderizarMotoboys();
      renderizarAtribuicoes();
      $("entregadoresPanel").hidden = false;
      aviso("Acesso confirmado", "A lista é deste comércio. A API continua validando o papel do proprietário no servidor.", "sucesso");
    } catch (erro) {
      if (erro.message === STALE_REQUEST) return;
      limparDados();
      $("entregadoresPanel").hidden = true;
      feedback("listaMotoboysFeedback", erro.message || "Não foi possível carregar os entregadores.", true);
      feedback("listaAtribuicoesFeedback", erro.message || "Não foi possível carregar os pedidos.", true);
      aviso("Acesso não confirmado", erro.message || "A API recusou esta operação.", "erro");
    } finally {
      if (generation === state.generation) {
        state.loading = false;
        $("listaMotoboys").setAttribute("aria-busy", "false");
        $("listaAtribuicoes").setAttribute("aria-busy", "false");
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

  async function atribuirPedido(pedidoId, botao) {
    const selecao = Array.from(document.querySelectorAll("[data-pedido-select]"))
      .find((elemento) => String(elemento.dataset.pedidoSelect) === String(pedidoId));
    if (!selecao) return;
    botao.disabled = true;
    feedback("listaAtribuicoesFeedback", "Salvando atribuição…");
    try {
      await chamarApi("atribuir_pedido", { pedido_id: pedidoId, motoboy_id: selecao.value || null });
      feedback("listaAtribuicoesFeedback", selecao.value ? "Pedido atribuído. O entregador verá a entrega ao atualizar o painel." : "Atribuição retirada do pedido.");
      await carregarAtribuicoes();
    } catch (erro) {
      if (erro.message !== STALE_REQUEST) feedback("listaAtribuicoesFeedback", erro.message || "Não foi possível atribuir o pedido.", true);
    } finally {
      botao.disabled = false;
    }
  }

  async function carregarMais(tipo) {
    if (!state.session || state.loading) return;
    const generation = state.generation, userId = state.userId;
    const motoboys = tipo === "motoboys";
    const botao = $(motoboys ? "maisMotoboys" : "maisAtribuicoes");
    state.loading = true; botao.disabled = true;
    try {
      const result = await chamarApi(motoboys ? "listar_motoboys" : "listar_para_atribuicao", {
        offset: motoboys ? state.motoboys.length : state.pedidos.length,
      }, generation, userId);
      validarSessaoAtual(generation, userId);
      if (motoboys) {
        const combined = new Map(state.motoboys.map(item => [item.usuario_id, item]));
        for (const item of result.motoboys || []) combined.set(item.usuario_id, item);
        state.motoboys = [...combined.values()]; state.maisMotoboys = result.has_more === true;
        renderizarMotoboys(); renderizarAtribuicoes();
      } else {
        const combined = new Map(state.pedidos.map(item => [item.pedido_id, item]));
        for (const item of result.pedidos || []) combined.set(item.pedido_id, item);
        state.pedidos = [...combined.values()]; state.maisPedidos = result.has_more === true;
        renderizarAtribuicoes();
      }
    } catch (error) {
      if (error.message !== STALE_REQUEST) feedback(motoboys ? "listaMotoboysFeedback" : "listaAtribuicoesFeedback", error.message, true);
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
    $("maisAtribuicoes").addEventListener("click", () => carregarMais("pedidos"));
    $("atualizarMotoboys").addEventListener("click", carregarPainel);
    $("atualizarAtribuicoes").addEventListener("click", carregarPainel);
    $("listaMotoboys").addEventListener("click", (event) => {
      const botao = event.target.closest("[data-suspender-motoboy]");
      if (botao) suspenderMotoboy(botao.dataset.suspenderMotoboy, botao);
    });
    $("listaAtribuicoes").addEventListener("click", (event) => {
      const botao = event.target.closest("[data-atribuir-pedido]");
      if (botao) atribuirPedido(botao.dataset.atribuirPedido, botao);
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
    carregarNomesPublicos().then(() => { if (!state.destroyed) { configurarLinks(); if (state.session) renderizarAtribuicoes(); } });
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
