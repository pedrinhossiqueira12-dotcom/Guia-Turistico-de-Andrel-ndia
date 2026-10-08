(() => {
  "use strict";

  const SUPABASE_URL = "https://xdmbkflufsfqziixzpxc.supabase.co";
  const SUPABASE_KEY = "sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";
  const API_URL = `${SUPABASE_URL}/functions/v1/catalogo-entregas`;
  const ASAAS_ADMIN_URL = `${SUPABASE_URL}/functions/v1/catalogo-asaas-financeiro`;
  const ADMIN_USER_ID = "4b9a0233-6b72-4573-aebd-d596c5b15e1b";
  const STALE_SESSION_REQUEST = "STALE_SESSION_REQUEST";
  const state = { client: null, session: null, userId: "", token: "", generation: 0, authorized: false, destroyed: false, lockedAfterLogout: false, loading: false, data: null, availableCredits: [] };
  const $ = (id) => document.getElementById(id);

  function obterCliente() {
    if (state.client) return state.client;
    if (window.supabaseLoginClient) return (state.client = window.supabaseLoginClient);
    if (window.supabase && typeof window.supabase.createClient === "function") {
      window.supabaseLoginClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      return (state.client = window.supabaseLoginClient);
    }
    return null;
  }

  function escapar(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
  }
  function reais(centavos) {
    const value = Number(centavos);
    return Number.isFinite(value) ? (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "R$ 0,00";
  }
  function data(value) { if (!value) return ""; const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); }
  function feedback(id, message, error = false) { const element = $(id); if (!element) return; element.textContent = message || ""; element.classList.toggle("is-error", Boolean(error)); }
  function aviso(title, message, status = "") { $("operationNoticeTitle").textContent = title; $("operationNoticeText").textContent = message; $("operationNotice").classList.toggle("is-error", status === "erro"); $("operationNotice").classList.toggle("is-success", status === "sucesso"); }
  function validarSessao(generation = state.generation, userId = state.userId) { if (state.destroyed || generation !== state.generation || !state.session || state.userId !== userId) throw new Error(STALE_SESSION_REQUEST); }

  async function chamarApi(acao, dados = {}, generation = state.generation, userId = state.userId, endpoint = API_URL) {
    const client = obterCliente();
    if (!client?.auth) throw new Error("O serviço de login não está disponível.");
    const { data: sessionData, error } = await client.auth.getSession();
    if (error) throw new Error("Não foi possível verificar sua sessão.");
    const session = sessionData?.session;
    const token = session?.access_token;
    if (!token) throw new Error("Sua sessão expirou. Entre novamente.");
    validarSessao(generation, userId);
    if (session.user?.id !== userId) throw new Error(STALE_SESSION_REQUEST);
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` }, body: JSON.stringify({ acao, ...dados }) });
    const result = await response.json().catch(() => ({}));
    validarSessao(generation, userId);
    if (!response.ok || result?.success !== true) { const failure = new Error(result?.mensagem || "A operação não foi autorizada."); failure.status = response.status; throw failure; }
    return result;
  }

  function limparDados() {
    state.authorized = false;
    state.data = null;
    state.availableCredits = [];
    $("operationPanel").hidden = true;
    // Sem autorização, o painel fica fechado, mas a entrada nunca desaparece.
    $("operationLoginCard").hidden = false;
    $("operationLogout").hidden = true;
    $("listaOcorrencias").innerHTML = "";
    $("listaRepasses").innerHTML = "";
    $("historicoRepasses").innerHTML = "";
    if ($("listaSaquesAsaas")) $("listaSaquesAsaas").innerHTML = "";
    feedback("saquesAsaasFeedback", "");
    $("repassePreview").innerHTML = '<p class="empty-state">Selecione um crédito disponível para revisar as provas antes de registrar o repasse.</p>';
  }

  function autorizadoExplicitamente(result) {
    return result?.admin === true || result?.autorizado === true || result?.authorized === true || result?.role === "admin_plataforma" || result?.operador_admin === true;
  }
  function getArray(data, keys) { for (const key of keys) if (Array.isArray(data?.[key])) return data[key]; return []; }
  function idOf(item) { return String(item?.id || item?.remuneracao_id || item?.credito_id || item?.ocorrencia_id || ""); }
  function pedidosOf(item) { return Array.isArray(item?.pedido_ids) ? item.pedido_ids : (item?.pedido_id ? [item.pedido_id] : []); }

  function renderizarOcorrencias(items) {
    const list = $("listaOcorrencias");
    if (!items.length) { list.innerHTML = '<p class="empty-state">Nenhuma ocorrência pendente.</p>'; return; }
    list.innerHTML = items.map((item) => `<article class="manager-row"><div class="manager-copy"><strong>${escapar(item.titulo || item.tipo || "Ocorrência")}</strong><small>Pedido(s): ${escapar(pedidosOf(item).join(", ") || "não informado")} · ${escapar(data(item.criado_em || item.aberta_em))}</small><small>Motivo: ${escapar(item.motivo || item.descricao || "Não informado")}</small><small>Motoboy: ${escapar(item.motoboy_nome || item.beneficiario_nome || item.motoboy_id || "não informado")}</small></div><span class="status-pill is-warning">${escapar(item.status || "pendente")}</span></article>`).join("");
  }

  function renderizarCreditos(items) {
    const list = $("listaRepasses");
    const pendencias = items.filter((item) => ["pendencia_revisao", "retido"].includes(String(item.status || "")));
    const avisos = pendencias.map((item) => `<article class="manager-row"><div class="manager-copy"><strong>${escapar(item.motoboy_id || "Beneficiário")} · ${reais(item.valor_centavos)}</strong><small>Pedido: ${escapar(item.pedido_id)} · repasse anterior: ${escapar(item.repasse_id || "não realizado")}</small><small>${item.status === "pendencia_revisao" ? "Revisão financeira: estorno, divergência ou lastro revertido. Conferir cobrança e histórico; não há novo repasse disponível." : "Crédito retido até comprovação do financiamento da taxa."}</small></div><span class="status-pill is-warning">${escapar(item.status)}</span></article>`).join("");
    const disponiveis = items.filter((item) => String(item.status || "") === "a_receber" && item.pago !== true && item.financiado === true);
    state.availableCredits = disponiveis;
    if (!disponiveis.length) { list.innerHTML = avisos + '<p class="empty-state">Nenhum crédito a_receber financiado e ainda não pago.</p>'; $("repasseCredito").innerHTML = '<option value="">Nenhum crédito disponível</option>'; $("repasseCredito").disabled = true; $("registrarRepasse").disabled = true; return; }
    list.innerHTML = avisos + disponiveis.map((item) => {
      const id = idOf(item);
      const pedidos = pedidosOf(item);
      const provas = Array.isArray(item.provas) ? item.provas : (Array.isArray(item.comprovantes) ? item.comprovantes : []);
      return `<article class="manager-row" data-credito-id="${escapar(id)}"><div class="manager-copy"><strong>${escapar(item.beneficiario_nome || item.motoboy_nome || item.motoboy_id || "Beneficiário não identificado")} · ${reais(item.valor_centavos ?? item.valor_bruto_centavos)}</strong><small>Status: ${escapar(item.status || "a_receber")} · financiado: ${item.financiado === false ? "não" : "sim"}</small><small>Pedidos: ${escapar(pedidos.join(", ") || "não informados")}</small><ul class="proof-list">${provas.length ? provas.map((proof) => `<li>${escapar(typeof proof === "string" ? proof : proof.referencia || proof.tipo || "Prova registrada")}</li>`).join("") : "<li>Nenhuma prova adicional informada</li>"}</ul></div><button class="small-button" type="button" data-preview-credit="${escapar(id)}">Revisar repasse</button></article>`;
    }).join("");
    $("repasseCredito").innerHTML = '<option value="">Escolha um crédito a_receber</option>' + disponiveis.map((item) => `<option value="${escapar(idOf(item))}">${escapar(item.beneficiario_nome || item.motoboy_nome || item.motoboy_id || "Beneficiário")} · ${escapar(reais(item.valor_centavos ?? item.valor_bruto_centavos))}</option>`).join("");
    $("repasseCredito").disabled = false;
    $("registrarRepasse").disabled = false;
  }

  function renderizarHistorico(items) {
    const list = $("historicoRepasses");
    if (!items.length) { list.innerHTML = '<p class="empty-state">Nenhum repasse registrado no histórico.</p>'; return; }
    list.innerHTML = items.map((item) => `<article class="manager-row"><div class="manager-copy"><strong>${escapar(item.beneficiario_nome || item.motoboy_nome || item.motoboy_id || "Beneficiário")} · ${reais(item.valor_centavos ?? item.valor_bruto_centavos)}</strong><small>Referência: ${escapar(item.referencia || item.referencia_pagamento || "não informada")} · ${escapar(data(item.registrado_em || item.criado_em))}</small><small>Pedidos: ${escapar(pedidosOf(item).join(", ") || "não informados")}</small><small>Comprovante: ${escapar(item.comprovante || "não informado")}</small></div><span class="status-pill">${escapar(item.status || "registrado")}</span></article>`).join("");
  }

  function renderizarDados(result) {
    if (!state.authorized) return;
    state.data = result;
    const occurrences = getArray(result, ["ocorrencias", "ocorrencias_pendentes"]);
    const credits = getArray(result, ["remuneracoes", "repasses_disponiveis", "creditos"]);
    const history = getArray(result, ["historico_repasses", "repasses_historico", "repasses"]).filter((item) => String(item.status || "").toLowerCase() !== "a_receber");
    renderizarOcorrencias(occurrences);
    renderizarCreditos(credits);
    renderizarHistorico(history);
    $("operationPanel").hidden = false;
  }

  // Auditoria financeira sem expor chaves Pix nem permitir saque administrativo.
  // Uma indisponibilidade da integração não retira o acesso às entregas.
  async function carregarSaquesAsaas(generation = state.generation, userId = state.userId) {
    if (!state.authorized || !$("listaSaquesAsaas")) return;
    feedback("saquesAsaasFeedback", "Consultando histórico do provedor...");
    try {
      const result = await chamarApi("listar_saques_admin", {}, generation, userId, ASAAS_ADMIN_URL);
      validarSessao(generation, userId);
      if (!state.authorized) return;
      const saques = Array.isArray(result.saques) ? result.saques : [];
      const emissoes = Array.isArray(result.emissoes_pendentes) ? result.emissoes_pendentes : [];
      const rows = saques.map((s) => {
        const status = {reservado:"Reservado (sem confirmação externa)",enviado:"Transferência enviada",concluido:"Pix confirmado",falhou:"Transferência recusada",revisao:"Revisão obrigatória"}[s.status] || "Estado não reconhecido";
        return `<article class="manager-row"><div class="manager-copy">
          <strong>${escapar(status)} · ${escapar(reais(s.valor_centavos))}</strong>
          <small>Motoboy: ${escapar(s.motoboy_id)} · solicitação: ${escapar(data(s.criado_em))}</small>
          <small>Transferência Asaas: ${escapar(s.transferencia_id || "Não identificada")}</small>
          ${s.mensagem ? `<small>Observação: ${escapar(s.mensagem)}</small>` : ""}
          </div><span class="status-pill ${["revisao","reservado"].includes(s.status) ? "is-warning" : ""}">${escapar(s.status)}</span></article>`;
      });
      if (emissoes.length) rows.unshift(`<p class="empty-state">${emissoes.length} emissão(ões) de fatura reservada(s) ou pendente(s) de revisão. Confira a situação diretamente no Asaas antes de reemitir qualquer cobrança.</p>`);
      $("listaSaquesAsaas").innerHTML = rows.length ? rows.join("") : '<p class="empty-state">Nenhum saque Asaas registrado até agora.</p>';
      feedback("saquesAsaasFeedback", "Histórico consultado com autorização do servidor.");
    } catch (error) {
      if (error.message === STALE_SESSION_REQUEST) return;
      if (!state.authorized) return;
      $("listaSaquesAsaas").innerHTML = '<p class="empty-state">Auditoria Asaas indisponível neste ambiente.</p>';
      feedback("saquesAsaasFeedback", "Este módulo só estará disponível após instalar a nova função financeira.", true);
    }
  }

  async function carregarOperacao() {
    if (!state.session || state.loading) return;
    const generation = state.generation;
    const userId = state.userId;
    state.loading = true;
    state.authorized = false;
    $("operationPanel").hidden = true;
    aviso("Validando autorização", "Nenhum dado operacional será exibido antes da confirmação do backend.");
    try {
      const result = await chamarApi("operacao_admin", { operacao: "listar", subacao: "listar" }, generation, userId);
      validarSessao(generation, userId);
      if (!autorizadoExplicitamente(result)) throw new Error("A conta autenticada não tem autorização de administrador da plataforma.");
      state.authorized = true;
      $("operationLoginCard").hidden = true;
      $("operationLogout").hidden = false;
      renderizarDados(result);
      void carregarSaquesAsaas(generation,userId);
      aviso("Acesso administrativo confirmado", "Ocorrências e créditos foram liberados pelo backend; o painel não usa vínculo de comércio como privilégio.", "sucesso");
    } catch (error) {
      if (error.message === STALE_SESSION_REQUEST) return;
      state.authorized = false;
      $("operationPanel").hidden = true;
      // Mesmo autenticado, um usuário não autorizado precisa poder entrar com outra conta.
      // Não exibir dados privados nem depender de recarregar a página.
      $("operationLoginCard").hidden = false;
      $("operationLogout").hidden = false;
      feedback("operationLoginFeedback", error.message || "Não foi possível autorizar a operação.", true);
      aviso("Acesso não confirmado", error.message || "O backend não autorizou esta conta.", "erro");
    } finally { if (generation === state.generation) state.loading = false; }
  }

  function selecionarCredito(id) {
    const item = (state.availableCredits || []).find((credit) => idOf(credit) === String(id));
    if (!item) { $("repassePreview").innerHTML = '<p class="empty-state">Selecione um crédito disponível para revisar as provas antes de registrar o repasse.</p>'; return; }
    const proofs = Array.isArray(item.provas) ? item.provas : (Array.isArray(item.comprovantes) ? item.comprovantes : []);
    $("repassePreview").innerHTML = `<div class="operation-summary"><span>Beneficiário: ${escapar(item.beneficiario_nome || item.motoboy_nome || item.motoboy_id || "não informado")}</span><span>Valor: ${escapar(reais(item.valor_centavos ?? item.valor_bruto_centavos))}</span></div><p><strong>Pedidos:</strong> ${escapar(pedidosOf(item).join(", ") || "não informados")}</p><p><strong>Provas:</strong></p><ul class="proof-list">${proofs.length ? proofs.map((proof) => `<li>${escapar(typeof proof === "string" ? proof : proof.referencia || proof.tipo || "Prova registrada")}</li>`).join("") : "<li>Nenhuma prova adicional informada</li>"}</ul>`;
  }

  async function resolverOcorrencia(event) {
    event.preventDefault();
    if (!state.authorized) return;
    const form = event.currentTarget;
    const id = $("ocorrenciaId").value.trim();
    const decisao = $("ocorrenciaDecisao").value;
    const motivo = $("ocorrenciaMotivo").value.trim();
    if (!id || !decisao || !motivo) { feedback("ocorrenciaFeedback", "Informe ocorrência, decisão e motivo fundamentado.", true); return; }
    const button = $("resolverOcorrencia"); button.disabled = true; feedback("ocorrenciaFeedback", "Registrando revisão…");
    try { await chamarApi("resolver_ocorrencia", { ocorrencia_id: id, decisao, motivo }, state.generation, state.userId); feedback("ocorrenciaFeedback", "Ocorrência resolvida com auditoria."); $("ocorrenciaForm").reset(); await carregarOperacao(); }
    catch (error) { if (error.message !== STALE_SESSION_REQUEST) feedback("ocorrenciaFeedback", error.message || "Não foi possível resolver a ocorrência.", true); }
    finally { button.disabled = false; }
  }

  async function registrarRepasse(event) {
    event.preventDefault();
    if (!state.authorized) return;
    if (!$("transferenciaConfirmada").checked) { feedback("repasseFeedback", "Confirme que a transferência já foi realizada antes de registrar a prova.", true); return; }
    const item = (state.availableCredits || []).find((credit) => idOf(credit) === $("repasseCredito").value);
    if (!item) { feedback("repasseFeedback", "Escolha um crédito a_receber financiado.", true); return; }
    const motoboyId = String(item.motoboy_id || item.beneficiario_id || "").trim();
    const pedidoIds = pedidosOf(item);
    const referencia = $("repasseReferencia").value.trim();
    const comprovante = $("repasseComprovante").value.trim();
    if (!motoboyId || !pedidoIds.length || !referencia || !comprovante) { feedback("repasseFeedback", "Beneficiário, pedidos, referência e comprovante precisam estar presentes no crédito.", true); return; }
    const button = $("registrarRepasse"); button.disabled = true; feedback("repasseFeedback", "Registrando somente a prova do repasse…");
    try { await chamarApi("registrar_repasse", { motoboy_id: motoboyId, pedido_ids: pedidoIds, referencia, comprovante, transferencia_confirmada: true }, state.generation, state.userId); feedback("repasseFeedback", "Repasse registrado como comprovado; nenhuma transferência bancária foi executada."); $("repasseForm").reset(); selecionarCredito(""); await carregarOperacao(); }
    catch (error) { if (error.message !== STALE_SESSION_REQUEST) feedback("repasseFeedback", error.message || "Não foi possível registrar o repasse.", true); }
    finally { button.disabled = false; }
  }

  function limparSessaoVisual() {
    state.generation += 1; state.session = null; state.userId = ""; state.token = ""; state.loading = false; limparDados(); aviso("Entre para continuar", "Somente o administrador de plataforma autorizado pelo backend pode consultar este painel.");
  }
  async function aplicarSessao(session) {
    if (state.destroyed || (state.lockedAfterLogout && session)) return;
    const user = session?.user || null;
    if (!user) { limparSessaoVisual(); return; }
    const token = session.access_token || "";
    if (state.session && user.id === state.userId && token === state.token) return;
    state.generation += 1; state.session = session; state.userId = user.id; state.token = token; state.authorized = false;
    $("operationLoginCard").hidden = true; $("operationLogout").hidden = false; await carregarOperacao();
  }
  async function fazerLogin(event) {
    event.preventDefault(); const client = obterCliente(); if (!client) { feedback("operationLoginFeedback", "Login indisponível.", true); return; }
    const button = $("operationLoginButton"); button.disabled = true; feedback("operationLoginFeedback", "Entrando…");
    try { const { data, error } = await client.auth.signInWithPassword({ email: $("operationLoginEmail").value.trim(), password: $("operationLoginPassword").value }); if (error) throw new Error(error.message || "E-mail ou senha incorretos."); if (!data?.session) throw new Error("A sessão não ficou disponível."); state.lockedAfterLogout = false; $("operationLoginPassword").value = ""; await aplicarSessao(data.session); }
    catch (error) { feedback("operationLoginFeedback", error.message || "Não foi possível entrar.", true); }
    finally { button.disabled = false; }
  }
  async function sair() { const client = obterCliente(); state.lockedAfterLogout = true; limparSessaoVisual(); try { await client?.auth?.signOut({ scope: "local" }); feedback("operationLoginFeedback", "Você saiu da operação."); } catch { feedback("operationLoginFeedback", "A tela foi bloqueada; entre novamente para continuar.", true); } }
  function iniciarEventos() {
    $("operationLoginForm").addEventListener("submit", fazerLogin);
    $("operationLogout").addEventListener("click", sair);
    $("atualizarOperacao").addEventListener("click", carregarOperacao);
    $("ocorrenciaForm").addEventListener("submit", resolverOcorrencia);
    $("repasseForm").addEventListener("submit", registrarRepasse);
    $("repasseCredito").addEventListener("change", (event) => selecionarCredito(event.target.value));
    $("listaRepasses").addEventListener("click", (event) => { const button = event.target.closest("[data-preview-credit]"); if (button) { $("repasseCredito").value = button.dataset.previewCredit; selecionarCredito(button.dataset.previewCredit); } });
    window.addEventListener("pagehide", () => { state.destroyed = true; state.generation += 1; state.session = null; state.userId = ""; state.token = ""; state.subscription?.unsubscribe?.(); state.subscription = null; limparDados(); });
    window.addEventListener("pageshow", (event) => { if (!event.persisted) return; state.destroyed = false; restaurarSessao(); });
  }
  async function restaurarSessao() { const client = obterCliente(); if (!client) return; const { data, error } = await client.auth.getSession(); if (!error && !state.destroyed) await aplicarSessao(data?.session || null); }
  async function iniciar() {
    iniciarEventos(); const client = obterCliente(); if (!client) { aviso("Login indisponível", "Não foi possível carregar o serviço de autenticação.", "erro"); return; }
    const listener = client.auth.onAuthStateChange((_event, session) => { window.setTimeout(() => aplicarSessao(session), 0); }); state.subscription = listener?.data?.subscription || null;
    const { data, error } = await client.auth.getSession(); if (error) { aviso("Sessão não confirmada", "Entre novamente para continuar.", "erro"); return; } await aplicarSessao(data?.session || null);
  }
  document.addEventListener("DOMContentLoaded", iniciar, { once: true });
})();
