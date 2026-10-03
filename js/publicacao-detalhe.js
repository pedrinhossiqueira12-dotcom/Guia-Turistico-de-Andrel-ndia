(function () {
  "use strict";
  const SUPABASE_URL = "https://xdmbkflufsfqziixzpxc.supabase.co";
  const SUPABASE_KEY = "sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";
  const U = window.EditorialUtils;
  const root = document.getElementById("detalhePublicacao");
  if (!U || !root || !window.supabase?.createClient) return;
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const slug = new URLSearchParams(window.location.search).get("slug") || "";

  function setMeta(name, content, property = false) {
    const selector = property ? `meta[property="${name}"]` : `meta[name="${name}"]`;
    let el = document.head.querySelector(selector);
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute(property ? "property" : "name", name);
      document.head.appendChild(el);
    }
    el.content = content;
  }

  function render(item) {
    const e = U.escapeHtml;
    const typeLabel = item.tipo === "evento" ? "Evento" : "Notícia";
    const date = item.tipo === "evento" ? U.formatEventDateRange(item.inicio_evento, item.fim_evento) : U.formatDateRange(item.publicado_em);
    const eventInfo = item.tipo === "evento" && (date || item.local_evento)
      ? `<aside class="publication-detail__event">${date ? `<p><strong>Quando:</strong> ${e(date)}</p>` : ""}${item.local_evento ? `<p><strong>Onde:</strong> ${e(item.local_evento)}</p>` : ""}</aside>`
      : "";
    const cover = item.imagem_capa ? `<figure class="publication-detail__hero"><img src="${e(item.imagem_capa)}" alt="${e(item.titulo)}" fetchpriority="high"></figure>` : "";
    const gallery = item.galeria.length
      ? `<div class="publication-detail__gallery">${item.galeria.map((url, index) => `<img src="${e(url)}" alt="Imagem ${index + 1} de ${e(item.titulo)}" loading="lazy">`).join("")}</div>`
      : "";
    const cta = item.has_custom_cta ? U.safeHref(item.url_cta, window.location.origin) : "";
    const ctaExternal = cta && /^https?:\/\//i.test(cta) && !cta.startsWith(window.location.origin);
    root.innerHTML = `<article class="publication-detail">
      ${cover}
      <div class="publication-detail__meta"><span class="publication-kind">${e(typeLabel)}</span>${date ? `<time>${e(date)}</time>` : ""}</div>
      <h1>${e(item.titulo)}</h1>
      ${item.resumo ? `<p class="publication-detail__summary">${e(item.resumo)}</p>` : ""}
      ${eventInfo}
      <div class="publication-detail__body">${U.renderPlainText(item.corpo)}</div>
      ${gallery}
      ${cta ? `<div class="publication-detail__cta"><a href="${e(cta)}"${ctaExternal ? ' target="_blank" rel="noopener noreferrer"' : ""}>${e(item.texto_cta || "Saiba mais")}</a></div>` : ""}
      <a class="editorial-back-link" href="noticias.html">← Todas as notícias e eventos</a>
    </article>`;
    document.title = `${item.titulo} — Andrelândia`;
    setMeta("description", U.descriptionFromText(item.resumo || item.corpo, 160));
  }

  async function init() {
    if (!slug) {
      root.innerHTML = '<p class="editorial-empty">Publicação não encontrada. <a href="noticias.html">Voltar às notícias e eventos.</a></p>';
      return;
    }
    try {
      const { data, error } = await client.from("conteudos_editoriais")
        .select("id,slug,tipo,titulo,resumo,corpo,local_evento,inicio_evento,fim_evento,imagem_capa,galeria,texto_cta,url_cta,destaque_hero,ordem_hero,status,publicado_em")
        .eq("slug", slug)
        .eq("status", "publicado")
        .not("publicado_em", "is", null)
        .lte("publicado_em", new Date().toISOString())
        .is("deletado_em", null)
        .maybeSingle();
      if (error) throw error;
      const item = U.normalizePublication(data, { origin: window.location.origin, supabaseUrl: SUPABASE_URL });
      if (!item) throw new Error("not-found");
      render(item);
    } catch (error) {
      console.warn("Publicação indisponível.", error?.message || "");
      root.innerHTML = '<section class="editorial-empty"><h1>Publicação não encontrada</h1><p>Este conteúdo pode ter sido removido ou ainda não estar disponível.</p><a href="noticias.html">Voltar às notícias e eventos</a></section>';
      setMeta("robots", "noindex,follow");
    }
  }
  init();
})();
