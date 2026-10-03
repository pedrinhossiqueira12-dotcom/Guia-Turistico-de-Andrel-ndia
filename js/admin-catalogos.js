(function () {
  "use strict";
  const SUPABASE_URL = "https://xdmbkflufsfqziixzpxc.supabase.co";
  const SUPABASE_KEY = "sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";
  let supabaseClient = null;
  let catalogos = [];
  let nomesComercios = new Map();
  let carregando = false;
  const $ = (id) => document.getElementById(id);

  function client() {
    if (!supabaseClient) supabaseClient = window.supabaseLoginClient || window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);
    return supabaseClient;
  }

  function escapar(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
    })[char]);
  }

  function notice(title, text, isError = false) {
    $("noticeTitle").textContent = title;
    $("noticeText").textContent = text;
    $("adminNotice").classList.toggle("is-error", Boolean(isError));
    $("adminNotice").hidden = false;
  }

  function statusLabel(row) {
    if (row.bloqueado) return "Bloqueado pela administração";
    if (row.catalogo_ativo) return "Assinatura ativa";
    if (row.assinatura_status === "pendente") return "Pendente — sem Pix";
    if (row.assinatura_status === "expirada") return "Assinatura expirada";
    if (row.assinatura_status === "cancelada") return "Assinatura cancelada";
    if (!row.comercio_publicado) return "Comércio não publicado";
    return "Sem assinatura ativa";
  }

  function render() {
    $("contadorCatalogos").textContent = `${catalogos.length} catálogo(s)`;
    $("catalogosVazios").hidden = catalogos.length > 0;
    $("listaCatalogos").innerHTML = catalogos.map((row) => {
      const nome = nomesComercios.get(String(row.comercio_id)) || row.comercio_id;
      const status = statusLabel(row);
      const classStatus = row.bloqueado ? "status-blocked" : row.catalogo_ativo ? "status-active" : "status-pending";
      const publicLink = row.catalogo_ativo
        ? `<a class="text-link" href="catalogo.html?id=${encodeURIComponent(row.comercio_id)}" target="_blank" rel="noopener noreferrer">Abrir vitrine</a>`
        : "";
      const blockLabel = row.bloqueado ? "Liberar catálogo" : "Bloquear catálogo";
      return `
        <article class="catalog-row">
          <div class="catalog-row-main">
            <span class="status-pill ${classStatus}">${escapar(status)}</span>
            <h3>${escapar(nome)}</h3>
            <p class="catalog-id">ID: ${escapar(row.comercio_id)}</p>
            ${row.motivo_bloqueio ? `<p class="block-reason">Motivo: ${escapar(row.motivo_bloqueio)}</p>` : ""}
          </div>
          <div class="catalog-row-actions">
            <a class="text-link" href="catalogo-admin.html?id=${encodeURIComponent(row.comercio_id)}">Editar produtos</a>
            ${publicLink}
            <button class="button ${row.bloqueado ? "button-secondary" : "button-danger"}" type="button" data-toggle-block="${escapar(row.comercio_id)}" data-blocked="${String(Boolean(row.bloqueado))}">${blockLabel}</button>
          </div>
        </article>`;
    }).join("");
  }

  async function carregarNomes() {
    try {
      const response = await fetch("../DATA/comercios.json", { cache: "no-store" });
      if (!response.ok) return;
      const list = await response.json();
      if (Array.isArray(list)) nomesComercios = new Map(list.map((row) => [String(row.id), row.nome]));
    } catch (error) {
      console.warn("Não foi possível carregar os nomes dos comércios.", error);
    }
  }

  async function carregarLista() {
    if (carregando) return;
    carregando = true;
    $("atualizarCatalogos").disabled = true;
    $("feedbackCatalogos").textContent = "Consultando…";
    try {
      const { data, error } = await client().functions.invoke("catalogo-admin", {
        body: { acao: "admin_listar_catalogos" },
      });
      if (error) throw error;
      if (!data?.success || !Array.isArray(data.catalogos)) throw new Error(data?.mensagem || "A resposta da administração está incompleta.");
      catalogos = data.catalogos;
      render();
      $("adminPanel").hidden = false;
      $("feedbackCatalogos").classList.remove("is-error");
      $("feedbackCatalogos").textContent = "Lista atualizada. Nenhuma cobrança ou status de pagamento foi alterado.";
      notice("Acesso administrativo confirmado", "O painel lista somente catálogos configurados; bloqueio e liberação são reversíveis.");
    } catch (error) {
      catalogos = [];
      render();
      $("adminPanel").hidden = true;
      notice("Acesso não autorizado", error.message || "Somente a conta administrativa pode consultar este painel.", true);
    } finally {
      carregando = false;
      $("atualizarCatalogos").disabled = false;
    }
  }

  async function verificarSessao() {
    const supabase = client();
    const { data: { session } = {} } = await supabase.auth.getSession();
    if (!session) {
      $("adminPanel").hidden = true;
      $("loginCard").hidden = false;
      notice("Entre para continuar", "A administração de catálogos é exclusiva da conta administrativa do Guia.");
      return;
    }
    $("loginCard").hidden = true;
    await carregarLista();
  }

  async function alternarBloqueio(button) {
    const comercioId = button.dataset.toggleBlock;
    const vaiBloquear = button.dataset.blocked !== "true";
    const row = catalogos.find((item) => item.comercio_id === comercioId);
    if (!row) return;
    const nome = nomesComercios.get(comercioId) || comercioId;
    if (!window.confirm(`${vaiBloquear ? "Bloquear" : "Liberar"} o catálogo de ${nome}?`)) return;
    let motivo = null;
    if (vaiBloquear) {
      motivo = window.prompt("Motivo do bloqueio (opcional):", "Revisão administrativa");
      if (motivo === null) return;
      motivo = motivo.trim().slice(0, 500) || "Revisão administrativa";
    }
    button.disabled = true;
    $("feedbackCatalogos").textContent = "Salvando alteração…";
    try {
      const { data, error } = await client().functions.invoke("catalogo-admin", {
        body: { acao: "admin_bloquear_catalogo", comercio_id: comercioId, bloqueado: vaiBloquear, motivo_bloqueio: motivo },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.mensagem || "Não foi possível atualizar o bloqueio.");
      await carregarLista();
    } catch (error) {
      $("feedbackCatalogos").textContent = error.message || "Não foi possível atualizar o bloqueio.";
      $("feedbackCatalogos").classList.add("is-error");
      button.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const supabase = client();
    if (!supabase) {
      notice("Serviço de autenticação indisponível", "Tente novamente mais tarde.", true);
      return;
    }
    await carregarNomes();
    $("atualizarCatalogos").addEventListener("click", carregarLista);
    $("listaCatalogos").addEventListener("click", (event) => {
      const button = event.target.closest("[data-toggle-block]");
      if (button) alternarBloqueio(button);
    });
    supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") verificarSessao();
    });
    await verificarSessao();
  });
})();
