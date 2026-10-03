(function () {
  "use strict";

  const SUPABASE_URL = "https://xdmbkflufsfqziixzpxc.supabase.co";
  const SUPABASE_KEY = "sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";
  const list = document.getElementById("listaPublicacoes");
  const emptyState = document.getElementById("estadoPublicacoes");
  const U = window.EditorialUtils;
  let client = null;
  let publications = [];

  if (!list || !U) return;
  if (window.supabase?.createClient) client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  const escape = U.escapeHtml;
  const siteOrigin = window.location.origin;
  const prebuiltSlugs = new Set(Array.from(list.querySelectorAll("[data-publicacao]"), (node) => node.dataset.publicacao));

  function detailHref(item) {
    return prebuiltSlugs.has(item.slug)
      ? `/pages/noticia/${encodeURIComponent(item.slug)}/`
      : `noticia.html?slug=${encodeURIComponent(item.slug)}`;
  }

  function dateLabel(item) {
    if (item.tipo === "evento" && item.inicio_evento) return U.formatEventDateRange(item.inicio_evento, item.fim_evento);
    return item.publicado_em ? U.formatDateRange(item.publicado_em, null) : "";
  }

  function renderCard(item) {
    const detail = detailHref(item);
    const image = item.imagem_capa || "../img/hero/editorial-fallback.webp";
    const imageAlt = item.imagem_capa ? `Imagem de capa: ${item.titulo}` : "Imagem não disponível";
    const cta = item.has_custom_cta ? (U.safeHref(item.url_cta, siteOrigin) || detail) : detail;
    const external = /^https?:\/\//i.test(cta) && !cta.startsWith(siteOrigin);
    const label = item.tipo === "evento" ? "Evento" : "Notícia";
    const date = dateLabel(item);
    return `<article class="publication-card" data-tipo="${escape(item.tipo)}" data-publicacao="${escape(item.slug)}">
      <a class="publication-card__media" href="${escape(detail)}" aria-label="Abrir: ${escape(item.titulo)}">
        <img src="${escape(image)}" alt="${escape(imageAlt)}" loading="lazy" decoding="async">
      </a>
      <div class="publication-card__body">
        <div class="publication-card__meta"><span class="publication-kind">${escape(label)}</span>${date ? `<time>${escape(date)}</time>` : ""}</div>
        <h2><a href="${escape(detail)}">${escape(item.titulo)}</a></h2>
        <p>${escape(item.resumo || "Veja os detalhes desta publicação do Guia Turístico.")}</p>
        <a class="editorial-card-cta" href="${escape(cta)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${escape(item.texto_cta || "Saiba mais")}</a>
      </div>
    </article>`;
  }

  function applyFilter(filter) {
    const cards = Array.from(list.querySelectorAll("[data-tipo]"));
    let visible = 0;
    cards.forEach((card) => {
      const show = filter === "todas" || card.dataset.tipo === filter;
      card.hidden = !show;
      if (show) visible += 1;
    });
    document.querySelectorAll("[data-filter]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.filter === filter));
    });
    if (emptyState) {
      emptyState.hidden = visible > 0;
      emptyState.textContent = visible === 0
        ? filter === "todas" ? "Ainda não há publicações disponíveis. Volte em breve para acompanhar as novidades de Andrelândia." : "Não há publicações nesta categoria no momento."
        : "";
    }
  }

  function render(items) {
    publications = items
      .map((row) => U.normalizePublication(row, { origin: siteOrigin, supabaseUrl: SUPABASE_URL }))
      .filter((item) => item && item.status === "publicado" && item.publicado_em && new Date(item.publicado_em) <= new Date())
      .sort((a, b) => {
        const da = new Date(a.tipo === "evento" && a.inicio_evento ? a.inicio_evento : a.publicado_em).getTime();
        const db = new Date(b.tipo === "evento" && b.inicio_evento ? b.inicio_evento : b.publicado_em).getTime();
        return db - da;
      });
    list.innerHTML = publications.length
      ? publications.map(renderCard).join("")
      : "";
    if (!publications.length && emptyState) {
      emptyState.hidden = false;
      emptyState.textContent = "Ainda não há publicações disponíveis. Volte em breve para acompanhar as novidades de Andrelândia.";
    }
    applyFilter("todas");
  }

  async function loadPublished() {
    if (!client) return;
    list.setAttribute("aria-busy", "true");
    try {
      const now = new Date().toISOString();
      const all = [];
      const pageSize = 500;
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await client.from("conteudos_editoriais")
          .select("id,slug,tipo,titulo,resumo,corpo,local_evento,inicio_evento,fim_evento,imagem_capa,galeria,texto_cta,url_cta,destaque_hero,ordem_hero,status,publicado_em")
          .eq("status", "publicado")
          .not("publicado_em", "is", null)
          .lte("publicado_em", now)
          .is("deletado_em", null)
          .order("publicado_em", { ascending: false })
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        all.push(...(data || []));
        if (!data || data.length < pageSize) break;
        if (offset + pageSize >= 10000) throw new Error("A lista excedeu o limite de segurança de 10.000 publicações; use paginação no servidor.");
      }
      render(all);
    } catch (error) {
      console.warn("Não foi possível atualizar as publicações agora.", error?.message || "");
      if (!list.querySelector(".publication-card")) {
        list.innerHTML = "";
        if (emptyState) {
          emptyState.hidden = false;
          emptyState.textContent = "As publicações não puderam ser atualizadas agora. Tente novamente mais tarde.";
        }
      }
    } finally {
      list.setAttribute("aria-busy", "false");
    }
  }

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => applyFilter(button.dataset.filter || "todas"));
  });

  loadPublished();
})();
