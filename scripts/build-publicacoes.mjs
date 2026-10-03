import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Utils = require("../js/editorial-utils.js");
const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://xdmbkflufsfqziixzpxc.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_dvwNkLDf3oZrCqvZ5uAaRA_VsfiuZFy";
const SITE_URL = (process.env.PUBLIC_SITE_URL || "https://guia-turistico-de-andrelandia.pages.dev").replace(/\/$/, "");
const PAGE_SIZE = 500;
const MAX_ITEMS = 10000;
const COLUMNS = [
  "id", "slug", "tipo", "titulo", "resumo", "corpo", "local_evento", "inicio_evento", "fim_evento",
  "imagem_capa", "galeria", "texto_cta", "url_cta", "destaque_hero", "ordem_hero", "status", "publicado_em",
].join(",");

function assertConfiguration() {
  const api = new URL(SUPABASE_URL);
  const site = new URL(SITE_URL);
  if (api.protocol !== "https:" || site.protocol !== "https:") throw new Error("SUPABASE_URL e PUBLIC_SITE_URL devem usar HTTPS.");
  if (!SUPABASE_KEY) throw new Error("SUPABASE_ANON_KEY não foi definido.");
}

async function fetchPublished() {
  const endpoint = new URL(`${SUPABASE_URL}/rest/v1/conteudos_editoriais`);
  endpoint.searchParams.set("select", COLUMNS);
  endpoint.searchParams.set("status", "eq.publicado");
  endpoint.searchParams.set("publicado_em", `lte.${new Date().toISOString()}`);
  endpoint.searchParams.set("deletado_em", "is.null");
  endpoint.searchParams.set("order", "publicado_em.desc,id.asc");
  endpoint.searchParams.set("limit", String(PAGE_SIZE));
  const all = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    endpoint.searchParams.set("offset", String(offset));
    const response = await fetch(endpoint, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Consulta editorial falhou (${response.status}): ${await response.text()}`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("A resposta editorial do Supabase não é uma lista.");
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    if (all.length >= MAX_ITEMS) throw new Error("Há mais de 10.000 publicações; interrompendo o build sem truncar dados.");
  }
  return all
    .map((row) => Utils.normalizePublication(row, { origin: SITE_URL, supabaseUrl: SUPABASE_URL }))
    .filter((item) => item && item.status === "publicado" && item.publicado_em && new Date(item.publicado_em) <= new Date())
    .sort((a, b) => new Date(b.publicado_em).getTime() - new Date(a.publicado_em).getTime());
}

function escapeXml(value) {
  return String(value ?? "").replace(/[<>&'\"]/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;",
  })[character]);
}

function htmlDate(item) {
  if (item.tipo === "evento" && item.inicio_evento) return Utils.formatEventDateRange(item.inicio_evento, item.fim_evento);
  return item.publicado_em ? Utils.formatDateRange(item.publicado_em) : "";
}

function staticDetailUrl(item) {
  return `/pages/noticia/${encodeURIComponent(item.slug)}/`;
}

function ctaFor(item) {
  if (!item.has_custom_cta) return staticDetailUrl(item);
  return Utils.safeHref(item.url_cta, SITE_URL) || staticDetailUrl(item);
}

function externalAttrs(url) {
  try {
    return new URL(url, SITE_URL).origin !== new URL(SITE_URL).origin ? ' target="_blank" rel="noopener noreferrer"' : "";
  } catch {
    return "";
  }
}

function renderCard(item) {
  const e = Utils.escapeHtml;
  const detail = staticDetailUrl(item);
  const image = item.imagem_capa || "../img/hero/editorial-fallback.webp";
  const date = htmlDate(item);
  const type = item.tipo === "evento" ? "Evento" : "Notícia";
  const cta = ctaFor(item);
  return `<article class="publication-card" data-tipo="${e(item.tipo)}" data-publicacao="${e(item.slug)}">
    <a class="publication-card__media" href="${e(detail)}" aria-label="Abrir: ${e(item.titulo)}"><img src="${e(image)}" alt="${e(item.titulo)}" loading="lazy" decoding="async"></a>
    <div class="publication-card__body">
      <div class="publication-card__meta"><span class="publication-kind">${e(type)}</span>${date ? `<time>${e(date)}</time>` : ""}</div>
      <h2><a href="${e(detail)}">${e(item.titulo)}</a></h2>
      <p>${e(item.resumo || "Veja os detalhes desta publicação do Guia Turístico.")}</p>
      <a class="editorial-card-cta" href="${e(cta)}"${externalAttrs(cta)}>${e(item.texto_cta || "Saiba mais")}</a>
    </div>
  </article>`;
}

function renderHeroSlide(item, index, count) {
  const e = Utils.escapeHtml;
  const date = item.tipo === "evento" && item.inicio_evento ? Utils.formatEventDateRange(item.inicio_evento, item.fim_evento) : "";
  const label = date ? `Evento em Andrelândia · ${date}` : item.tipo === "evento" ? "Evento em Andrelândia" : "Notícia de Andrelândia";
  const cta = ctaFor(item);
  return `<article class="hero-slide" role="group" aria-roledescription="slide" aria-label="${index + 1} de ${count}">
    <img class="hero-slide-image" src="${e(item.imagem_capa || "img/hero/editorial-fallback.webp")}" alt="${e(item.titulo)}"${index === 0 ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async">
    <div class="hero-slide-copy"><span class="hero-slide-label">${e(label)}</span><h1>${e(item.titulo)}</h1><p>${e(item.resumo || "Acompanhe as novidades, eventos e histórias de Andrelândia.")}</p>
      <a class="hero-editorial-cta" href="${e(cta)}"${externalAttrs(cta)}>${e(item.texto_cta || "Saiba mais")}</a>
    </div>
  </article>`;
}

function replaceMarkerBlock(html, startMarker, endMarker, content) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker);
  if (start < 0 || end < 0 || end < start) throw new Error(`Marcadores não encontrados: ${startMarker}`);
  return `${html.slice(0, start + startMarker.length)}\n${content}\n${html.slice(end)}`;
}

function jsonLd(item) {
  const url = `${SITE_URL}${staticDetailUrl(item)}`;
  const isEvent = item.tipo === "evento";
  const data = {
    "@context": "https://schema.org",
    "@type": isEvent ? "Event" : "NewsArticle",
    headline: item.titulo,
    description: Utils.descriptionFromText(item.resumo || item.corpo, 300),
    image: item.imagem_capa || undefined,
    datePublished: item.publicado_em || undefined,
    url,
    publisher: { "@type": "Organization", name: "Andrelândia — Guia Turístico", url: SITE_URL },
  };
  if (isEvent) {
    data.startDate = item.inicio_evento || undefined;
    data.endDate = item.fim_evento || undefined;
    if (item.local_evento) data.location = { "@type": "Place", name: item.local_evento, address: { "@type": "PostalAddress", addressLocality: "Andrelândia", addressRegion: "MG", addressCountry: "BR" } };
  }
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function renderStaticDetail(item) {
  const e = Utils.escapeHtml;
  const date = htmlDate(item);
  const isEvent = item.tipo === "evento";
  const type = isEvent ? "Evento" : "Notícia";
  const url = `${SITE_URL}${staticDetailUrl(item)}`;
  const description = Utils.descriptionFromText(item.resumo || item.corpo, 160);
  const image = item.imagem_capa || `${SITE_URL}/img/hero/editorial-fallback.webp`;
  const gallery = item.galeria.length
    ? `<div class="publication-detail__gallery">${item.galeria.map((src, index) => `<img src="${e(src)}" alt="Imagem ${index + 1} de ${e(item.titulo)}" loading="lazy" decoding="async">`).join("")}</div>`
    : "";
  const eventInfo = isEvent && (date || item.local_evento)
    ? `<aside class="publication-detail__event">${date ? `<p><strong>Quando:</strong> ${e(date)}</p>` : ""}${item.local_evento ? `<p><strong>Onde:</strong> ${e(item.local_evento)}</p>` : ""}</aside>`
    : "";
  const cta = item.has_custom_cta ? ctaFor(item) : "";
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#091d1c">
  <meta name="description" content="${e(description)}"><meta name="robots" content="index,follow">
  <meta property="og:type" content="${isEvent ? "event" : "article"}"><meta property="og:title" content="${e(item.titulo)} — Andrelândia">
  <meta property="og:description" content="${e(description)}"><meta property="og:site_name" content="Andrelândia — Guia Turístico"><meta property="og:image" content="${e(image)}"><meta property="og:url" content="${e(url)}">
  <meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${e(item.titulo)} — Andrelândia"><meta name="twitter:description" content="${e(description)}"><meta name="twitter:image" content="${e(image)}">
  <link rel="canonical" href="${e(url)}"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600;700&display=swap" rel="stylesheet"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/styles/editorial.css">
  <title>${e(item.titulo)} — Andrelândia</title><script type="application/ld+json">${jsonLd(item)}</script>
</head>
<body class="editorial-page" data-editorial-static="true">
  <header class="editorial-header"><a class="editorial-brand" href="/index.html"><span><strong>ANDRELÂNDIA</strong><small>AGENDA &amp; NOTÍCIAS</small></span></a><nav class="editorial-nav" aria-label="Navegação principal"><a href="/index.html">Início</a><a href="/pages/noticias.html">Notícias e Eventos</a></nav></header>
  <main class="editorial-shell editorial-detail"><article class="publication-detail">${item.imagem_capa ? `<figure class="publication-detail__hero"><img src="${e(item.imagem_capa)}" alt="${e(item.titulo)}" fetchpriority="high"></figure>` : ""}
    <div class="publication-detail__meta"><span class="publication-kind">${e(type)}</span>${date ? `<time datetime="${e(isEvent ? item.inicio_evento : item.publicado_em)}">${e(date)}</time>` : ""}</div>
    <h1>${e(item.titulo)}</h1>${item.resumo ? `<p class="publication-detail__summary">${e(item.resumo)}</p>` : ""}${eventInfo}
    <div class="publication-detail__body">${Utils.renderPlainText(item.corpo)}</div>${gallery}
    ${cta ? `<div class="publication-detail__cta"><a href="${e(cta)}"${externalAttrs(cta)}>${e(item.texto_cta || "Saiba mais")}</a></div>` : ""}
    <a class="editorial-back-link" href="/pages/noticias.html">← Todas as notícias e eventos</a></article></main>
  <footer class="editorial-footer"><a href="/pages/noticias.html">← Notícias e Eventos</a><a href="/index.html">Início do Guia</a></footer>
</body></html>`;
  return html;
}

async function copyPublicSite() {
  const excludedDirectories = new Set([".git", ".github", ".devcontainer", "node_modules", "dist", "supabase", "tests", "scripts"]);
  const excludedFiles = new Set(["TODO.md", "README.md", "PLANO-CATALOGO-DIGITAL.md", "SUPABASE-ALTERACOES-PENDENTES.md", "package.json", "package-lock.json", "pnpm-lock.yaml", "deno.json", "deno.lock"]);
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });
  const shouldCopy = (source) => {
      const relative = path.relative(ROOT, source);
      const parts = relative.split(path.sep);
      if (parts.some((part) => excludedDirectories.has(part))) return false;
      if (parts.some((part) => part.startsWith(".") && part !== ".well-known")) return false;
      const basename = path.basename(source);
      if (excludedFiles.has(basename) || basename.endsWith(".md") || basename.endsWith(".patch")) return false;
      if (basename === ".env" || basename.startsWith(".env.")) return false;
      return true;
  };
  for (const name of await fs.readdir(ROOT)) {
    const source = path.join(ROOT, name);
    if (!shouldCopy(source)) continue;
    await fs.cp(source, path.join(DIST, name), { recursive: true, filter: shouldCopy });
  }
}

async function main() {
  assertConfiguration();
  const items = await fetchPublished();
  const featured = items.filter((item) => item.destaque_hero && item.imagem_capa).sort((a, b) => a.ordem_hero - b.ordem_hero || new Date(b.publicado_em) - new Date(a.publicado_em)).slice(0, 6);
  await copyPublicSite();

  const listPath = path.join(DIST, "pages", "noticias.html");
  let listHtml = await fs.readFile(listPath, "utf8");
  listHtml = listHtml.replace('data-editorial-static="false"', 'data-editorial-static="true"');
  listHtml = replaceMarkerBlock(listHtml, "<!-- PUBLICATIONS:START -->", "<!-- PUBLICATIONS:END -->", items.length ? items.map(renderCard).join("\n") : '<p class="editorial-empty">Ainda não há notícias ou eventos publicados. Volte em breve para acompanhar as novidades de Andrelândia.</p>');
  await fs.writeFile(listPath, listHtml);

  const indexPath = path.join(DIST, "index.html");
  let indexHtml = await fs.readFile(indexPath, "utf8");
  indexHtml = indexHtml.replace("<body>", '<body data-editorial-static="true">');
  if (featured.length) indexHtml = replaceMarkerBlock(indexHtml, "<!-- HERO_PUBLICATIONS:START -->", "<!-- HERO_PUBLICATIONS:END -->", featured.map((item, index) => renderHeroSlide(item, index, featured.length)).join("\n"));
  await fs.writeFile(indexPath, indexHtml);

  const details = path.join(DIST, "pages", "noticia");
  await fs.rm(details, { recursive: true, force: true });
  for (const item of items) {
    const dir = path.join(details, item.slug);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "index.html"), renderStaticDetail(item));
  }

  const publicData = {
    generated_at: new Date().toISOString(),
    published: items,
    featured,
  };
  await fs.mkdir(path.join(DIST, "DATA"), { recursive: true });
  await fs.writeFile(path.join(DIST, "DATA", "conteudos-publicados.json"), `${JSON.stringify(publicData, null, 2)}\n`);

  let previousUrls = [];
  try {
    const previousSitemap = await fs.readFile(path.join(ROOT, "sitemap.xml"), "utf8");
    previousUrls = [...previousSitemap.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)].map((match) => match[1].trim()
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'"))
      .filter((value) => {
        try {
          const url = new URL(value);
          return url.origin === new URL(SITE_URL).origin && !url.pathname.startsWith("/pages/noticia/");
        } catch { return false; }
      });
  } catch {}
  const urls = [...new Set([...previousUrls, `${SITE_URL}/`, `${SITE_URL}/pages/noticias.html`, ...items.map((item) => `${SITE_URL}${staticDetailUrl(item)}`)])];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`).join("\n")}\n</urlset>\n`;
  await fs.writeFile(path.join(DIST, "sitemap.xml"), sitemap);
  let robots = "";
  try { robots = await fs.readFile(path.join(ROOT, "robots.txt"), "utf8"); } catch {}
  if (!robots.trim()) robots = "User-agent: *\n";
  const additions = [
    "Disallow: /pages/admin-noticias.html",
    "Disallow: /pages/catalogo-admin.html",
    "Disallow: /pages/catalogo-pix-teste.html",
    `Sitemap: ${SITE_URL}/sitemap.xml`,
  ];
  for (const line of additions) if (!robots.split(/\r?\n/).includes(line)) robots += `${robots.endsWith("\n") ? "" : "\n"}${line}\n`;
  await fs.writeFile(path.join(DIST, "robots.txt"), robots);
  console.log(`Build editorial concluído: ${items.length} publicação(ões), ${featured.length} destaque(s), ${items.length} página(s) de detalhe em ${path.relative(ROOT, DIST)}.`);
}

export { renderCard, renderHeroSlide, renderStaticDetail, replaceMarkerBlock };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error("Build editorial interrompido; nenhum artefato de saída foi publicado:", error?.message || error);
    process.exitCode = 1;
  });
}
