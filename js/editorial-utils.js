(function attachEditorialUtils(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.EditorialUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createEditorialUtils() {
  "use strict";

  const DEFAULT_ORIGIN = "https://guia-turistico-de-andrelandia.pages.dev";
  const DEFAULT_SUPABASE_URL = "https://xdmbkflufsfqziixzpxc.supabase.co";
  const IMAGE_BUCKET = "noticias-eventos";

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function slugify(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100)
      .replace(/-+$/g, "");
  }

  function safeHref(value, origin = DEFAULT_ORIGIN) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    if (raw.startsWith("//")) return "";
    try {
      const base = new URL(origin);
      const url = new URL(raw, base);
      if (!new Set(["https:", "http:"]).has(url.protocol) || url.username || url.password) return "";
      if (url.origin === base.origin) return `${url.pathname}${url.search}${url.hash}`;
      return url.href;
    } catch {
      return "";
    }
  }

  function publicImageUrl(value, supabaseUrl = DEFAULT_SUPABASE_URL) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    try {
      const base = new URL(supabaseUrl);
      if (/^https?:\/\//i.test(raw)) {
        const url = new URL(raw);
        if (url.protocol !== "https:") return "";
        const prefix = `/storage/v1/object/public/${IMAGE_BUCKET}/`;
        if (url.hostname !== base.hostname || !url.pathname.startsWith(prefix)) return "";
        const path = decodeURIComponent(url.pathname.slice(prefix.length));
        if (!path || path.split("/").some((part) => !part || part === "." || part === "..")) return "";
        return url.href;
      }
      const prefix = `${IMAGE_BUCKET}/`;
      const path = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw.replace(/^\/+/, "");
      if (!path || path.split("/").some((part) => !part || part === "." || part === "..")) return "";
      const encoded = path.split("/").map(encodeURIComponent).join("/");
      return `${base.origin}/storage/v1/object/public/${IMAGE_BUCKET}/${encoded}`;
    } catch {
      return "";
    }
  }

  function normalizePublication(row, options = {}) {
    if (!row || typeof row !== "object") return null;
    const slug = slugify(row.slug || row.titulo);
    const tipo = row.tipo === "evento" ? "evento" : row.tipo === "noticia" ? "noticia" : "";
    const titulo = String(row.titulo ?? "").trim().slice(0, 140);
    if (!slug || !tipo || !titulo) return null;
    const baseOrigin = options.origin || DEFAULT_ORIGIN;
    const detailUrl = `${baseOrigin.replace(/\/$/, "")}/pages/noticia/${encodeURIComponent(slug)}/`;
    const customCta = row.has_custom_cta === false ? "" : safeHref(row.url_cta, baseOrigin);
    const ctaUrl = customCta || detailUrl;
    const gallery = Array.isArray(row.galeria)
      ? row.galeria.map((item) => publicImageUrl(item, options.supabaseUrl)).filter(Boolean).slice(0, 8)
      : [];
    return {
      id: String(row.id ?? ""),
      slug,
      tipo,
      titulo,
      resumo: String(row.resumo ?? "").trim().slice(0, 400),
      corpo: String(row.corpo ?? ""),
      local_evento: String(row.local_evento ?? "").trim(),
      inicio_evento: row.inicio_evento || null,
      fim_evento: row.fim_evento || null,
      imagem_capa: publicImageUrl(row.imagem_capa, options.supabaseUrl),
      galeria: gallery,
      texto_cta: String(row.texto_cta ?? "").trim().slice(0, 60) || "Saiba mais",
      url_cta: ctaUrl,
      has_custom_cta: Boolean(customCta),
      detalhe_url: detailUrl,
      destaque_hero: Boolean(row.destaque_hero),
      ordem_hero: Number.isFinite(Number(row.ordem_hero)) ? Number(row.ordem_hero) : 0,
      status: String(row.status ?? ""),
      publicado_em: row.publicado_em || null,
    };
  }

  function renderPlainText(value) {
    return String(value ?? "")
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
      .join("\n");
  }

  function formatDateRange(start, end, locale = "pt-BR") {
    const parse = (value) => {
      if (!value) return null;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    };
    const first = parse(start);
    const last = parse(end);
    const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "America/Sao_Paulo" });
    if (!first) return "";
    const localDay = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    if (!last || localDay(first) === localDay(last)) return formatter.format(first);
    return `${formatter.format(first)} a ${formatter.format(last)}`;
  }

  function formatEventDateRange(start, end, locale = "pt-BR") {
    const parse = (value) => {
      if (!value) return null;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    };
    const first = parse(start);
    const last = parse(end);
    if (!first) return "";
    const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "America/Sao_Paulo" });
    const timeFormatter = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
    const dayKey = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    const startLabel = `${dateFormatter.format(first)} às ${timeFormatter.format(first)}`;
    if (!last) return startLabel;
    if (dayKey(first) === dayKey(last)) return `${dateFormatter.format(first)}, das ${timeFormatter.format(first)} às ${timeFormatter.format(last)}`;
    return `${startLabel} até ${dateFormatter.format(last)} às ${timeFormatter.format(last)}`;
  }

  function descriptionFromText(value, maxLength = 160) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1).trimEnd()}…`;
  }

  return Object.freeze({
    DEFAULT_ORIGIN,
    DEFAULT_SUPABASE_URL,
    IMAGE_BUCKET,
    escapeHtml,
    slugify,
    safeHref,
    publicImageUrl,
    normalizePublication,
    renderPlainText,
    formatDateRange,
    formatEventDateRange,
    descriptionFromText,
  });
});
