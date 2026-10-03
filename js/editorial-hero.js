(function () {
  "use strict";

  const SUPABASE_URL = "https://xdmbkflufsfqziixzpxc.supabase.co";
  const SUPABASE_KEY = "sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";
  const IMAGE_FALLBACK = "./img/hero/editorial-fallback.webp";
  const track = document.getElementById("heroTrack");
  const carousel = document.getElementById("heroCarousel");
  const prevButton = document.getElementById("heroAnterior");
  const nextButton = document.getElementById("heroProximo");
  const dotsRoot = document.getElementById("heroDots");
  const U = window.EditorialUtils;
  if (!track || !carousel || !U) return;

  let items = [];
  let physicalIndex = 0;
  let itemCount = 1;
  let timer = 0;
  let touchStartX = 0;
  let touchStartY = 0;
  let pauseReasons = new Set();
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false;
  const e = U.escapeHtml;
  const prebuiltSlugs = new Set();

  function detailUrl(item) {
    return prebuiltSlugs.has(item.slug)
      ? `/pages/noticia/${encodeURIComponent(item.slug)}/`
      : `/pages/noticia.html?slug=${encodeURIComponent(item.slug)}`;
  }

  function getCta(item) {
    if (!item.has_custom_cta) return detailUrl(item);
    const raw = String(item.url_cta || "").trim();
    const result = U.safeHref(raw, window.location.origin);
    return result || detailUrl(item);
  }

  function slideMarkup(item, index, clone = false) {
    const image = item.imagem_capa || IMAGE_FALLBACK;
    const label = item.tipo === "evento" ? "Evento em Andrelândia" : "Notícia de Andrelândia";
    const cta = getCta(item);
    const external = /^https?:\/\//i.test(cta) && !cta.startsWith(window.location.origin);
    const date = item.tipo === "evento" && item.inicio_evento ? U.formatEventDateRange(item.inicio_evento, item.fim_evento) : "";
    const itemLabel = date ? `${label} · ${date}` : label;
    return `<article class="hero-slide" role="group" aria-roledescription="slide" aria-label="${index + 1} de ${itemCount}"${clone ? ' aria-hidden="true"' : ""}>
      <img class="hero-slide-image" src="${e(image)}" alt="${e(item.titulo)}" ${index === 0 && !clone ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">
      <div class="hero-slide-copy">
        <span class="hero-slide-label">${e(itemLabel)}</span>
        <h1>${e(item.titulo)}</h1>
        <p>${e(item.resumo || "Acompanhe as novidades, eventos e histórias de Andrelândia.")}</p>
        <a class="hero-editorial-cta" href="${e(cta)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${e(item.texto_cta || "Saiba mais")}</a>
      </div>
    </article>`;
  }

  function render() {
    itemCount = items.length;
    if (!itemCount) return;
    const multiple = itemCount > 1;
    const rendered = multiple
      ? [items[itemCount - 1], ...items, items[0]]
      : [items[0]];
    track.innerHTML = rendered.map((item, index) => slideMarkup(item, multiple ? (index === 0 ? itemCount - 1 : index === itemCount + 1 ? 0 : index - 1) : 0, multiple && (index === 0 || index === rendered.length - 1))).join("");
    track.style.width = `${rendered.length * 100}%`;
    Array.from(track.children).forEach((slide) => {
      slide.style.flexBasis = `${100 / rendered.length}%`;
      if (slide.getAttribute("aria-hidden") === "true") slide.inert = true;
    });
    physicalIndex = multiple ? 1 : 0;
    positionTrack(false);
    if (dotsRoot) {
      dotsRoot.innerHTML = multiple
        ? items.map((item, index) => `<button type="button" class="hero-dot" data-index="${index}" aria-label="Mostrar destaque ${index + 1}: ${e(item.titulo)}" aria-current="${index === 0}"></button>`).join("")
        : "";
    }
    if (prevButton) prevButton.hidden = !multiple;
    if (nextButton) nextButton.hidden = !multiple;
    if (dotsRoot) dotsRoot.hidden = !multiple;
    if (multiple && !reducedMotion) startTimer();
  }

  function positionTrack(animate = true) {
    if (!animate) track.classList.add("is-jumping");
    const percent = (physicalIndex * 100) / track.children.length;
    track.style.transform = `translate3d(-${percent}%, 0, 0)`;
    Array.from(track.children).forEach((slide, index) => {
      const active = index === physicalIndex;
      if (slide.getAttribute("aria-hidden") !== "true") slide.setAttribute("aria-hidden", String(!active));
      slide.inert = !active;
    });
    if (!animate) requestAnimationFrame(() => track.classList.remove("is-jumping"));
    updateDots();
  }

  function logicalIndex() {
    if (itemCount <= 1) return 0;
    if (physicalIndex === 0) return itemCount - 1;
    if (physicalIndex === itemCount + 1) return 0;
    return physicalIndex - 1;
  }

  function updateDots() {
    if (!dotsRoot) return;
    dotsRoot.querySelectorAll(".hero-dot").forEach((dot, index) => {
      dot.setAttribute("aria-current", String(index === logicalIndex()));
    });
  }

  function goTo(index) {
    if (itemCount <= 1) return;
    const normalized = (index + itemCount) % itemCount;
    physicalIndex = normalized + 1;
    positionTrack(true);
    restartTimer();
  }

  function step(direction) {
    if (itemCount <= 1) return;
    physicalIndex += direction;
    positionTrack(true);
    restartTimer();
  }

  track.addEventListener("transitionend", (event) => {
    if (event.target !== track || itemCount <= 1) return;
    if (physicalIndex === 0) {
      physicalIndex = itemCount;
      positionTrack(false);
    } else if (physicalIndex === itemCount + 1) {
      physicalIndex = 1;
      positionTrack(false);
    }
  });

  function clearTimer() {
    if (timer) window.clearInterval(timer);
    timer = 0;
  }

  function startTimer() {
    clearTimer();
    if (reducedMotion || itemCount <= 1 || pauseReasons.size) return;
    timer = window.setInterval(() => step(1), 9000);
  }

  function restartTimer() {
    clearTimer();
    startTimer();
  }

  function pause(reason, shouldPause) {
    if (shouldPause) pauseReasons.add(reason);
    else pauseReasons.delete(reason);
    if (pauseReasons.size) clearTimer();
    else startTimer();
  }

  prevButton?.addEventListener("click", () => step(-1));
  nextButton?.addEventListener("click", () => step(1));
  dotsRoot?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-index]");
    if (button) goTo(Number(button.dataset.index));
  });
  carousel.addEventListener("mouseenter", () => pause("hover", true));
  carousel.addEventListener("mouseleave", () => pause("hover", false));
  carousel.addEventListener("focusin", () => pause("focus", true));
  carousel.addEventListener("focusout", (event) => {
    if (!carousel.contains(event.relatedTarget)) pause("focus", false);
  });
  document.addEventListener("visibilitychange", () => pause("hidden", document.hidden));
  carousel.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    touchStartX = event.clientX;
    touchStartY = event.clientY;
  }, { passive: true });
  carousel.addEventListener("pointerup", (event) => {
    if (event.pointerType !== "touch") return;
    const dx = event.clientX - touchStartX;
    const dy = event.clientY - touchStartY;
    if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.2) step(dx < 0 ? 1 : -1);
  }, { passive: true });

  async function readGeneratedFile() {
    try {
      const response = await fetch("/DATA/conteudos-publicados.json", { cache: "no-store" });
      if (!response.ok) return [];
      const data = await response.json();
      if (Array.isArray(data.published)) data.published.forEach((item) => { if (item?.slug) prebuiltSlugs.add(String(item.slug)); });
      return Array.isArray(data.featured) ? data.featured : Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async function readSupabase() {
    if (!window.supabase?.createClient) return { ok: false, rows: [] };
    try {
      const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      const { data, error } = await client.from("conteudos_editoriais")
        .select("id,slug,tipo,titulo,resumo,corpo,local_evento,inicio_evento,fim_evento,imagem_capa,galeria,texto_cta,url_cta,destaque_hero,ordem_hero,status,publicado_em")
        .eq("status", "publicado")
        .eq("destaque_hero", true)
        .not("publicado_em", "is", null)
        .lte("publicado_em", new Date().toISOString())
        .is("deletado_em", null)
        .order("ordem_hero", { ascending: true })
        .order("publicado_em", { ascending: false })
        .limit(6);
      if (error) return { ok: false, rows: [] };
      return { ok: true, rows: data || [] };
    } catch {
      return { ok: false, rows: [] };
    }
  }

  function restoreFallback() {
    const template = document.getElementById("heroFallback");
    if (!template?.content) return;
    track.innerHTML = template.innerHTML;
    track.style.width = "100%";
    track.style.transform = "translate3d(0,0,0)";
    const slide = track.firstElementChild;
    if (slide) {
      slide.style.flexBasis = "100%";
      slide.removeAttribute("aria-hidden");
      slide.inert = false;
    }
  }

  async function init() {
    const generated = await readGeneratedFile();
    const live = await readSupabase();
    const rows = live.ok ? live.rows : generated;
    const normalized = rows
      .map((row) => U.normalizePublication(row, { origin: window.location.origin, supabaseUrl: SUPABASE_URL }))
      .filter((item) => item && item.status === "publicado" && item.destaque_hero && item.publicado_em && new Date(item.publicado_em) <= new Date() && item.imagem_capa)
      .sort((a, b) => a.ordem_hero - b.ordem_hero || new Date(b.publicado_em) - new Date(a.publicado_em))
      .slice(0, 6);
    if (normalized.length) {
      items = normalized;
      render();
    } else {
      // A marcação estática de fallback permanece visível caso ainda não haja destaques publicados.
      items = [];
      restoreFallback();
      if (prevButton) prevButton.hidden = true;
      if (nextButton) nextButton.hidden = true;
      if (dotsRoot) dotsRoot.hidden = true;
    }
  }

  init();
})();
