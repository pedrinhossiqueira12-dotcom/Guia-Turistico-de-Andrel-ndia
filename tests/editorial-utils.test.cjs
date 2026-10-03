const test = require("node:test");
const assert = require("node:assert/strict");
const {
  slugify,
  safeHref,
  escapeHtml,
  publicImageUrl,
  normalizePublication,
  renderPlainText,
  descriptionFromText,
  formatEventDateRange,
} = require("../js/editorial-utils.js");

test("slug editorial remove acentos e caracteres inseguros", () => {
  assert.equal(slugify("Festa de São João — 2026!"), "festa-de-sao-joao-2026");
  assert.equal(slugify("../../"), "");
});

test("CTA aceita somente HTTP/HTTPS e resolve caminhos internos", () => {
  assert.equal(safeHref("javascript:alert(1)"), "");
  assert.equal(safeHref("//evil.example/"), "");
  assert.equal(safeHref("https://user:pass@site.example/"), "");
  assert.equal(safeHref("/pages/noticias.html"), "/pages/noticias.html");
});

test("texto editorial é escapado antes de entrar no HTML estático", () => {
  assert.equal(escapeHtml(`<script>alert("x")</script>`), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  assert.equal(renderPlainText("Primeiro <texto>\nlinha dois\n\nSegundo & texto"), "<p>Primeiro &lt;texto&gt;<br>linha dois</p>\n<p>Segundo &amp; texto</p>");
});

test("imagens usam URLs públicas do bucket esperado e rejeitam traversal", () => {
  assert.equal(
    publicImageUrl("publicacoes/abc/capa.webp"),
    "https://xdmbkflufsfqziixzpxc.supabase.co/storage/v1/object/public/noticias-eventos/publicacoes/abc/capa.webp",
  );
  assert.equal(publicImageUrl("publicacoes/../segredo.jpg"), "");
  assert.equal(publicImageUrl("http://example.com/a.jpg"), "");
  assert.equal(publicImageUrl("https://example.com/a.jpg"), "");
});

test("normalização mantém somente notícia/evento e destino CTA seguro", () => {
  const result = normalizePublication({
    id: "1",
    slug: "festa-de-sao-joao",
    tipo: "evento",
    titulo: "Festa de São João",
    resumo: "Agenda da cidade",
    url_cta: "javascript:alert(1)",
    destaque_hero: true,
    galeria: ["publicacoes/abc/foto.webp"],
  });
  assert.equal(result.slug, "festa-de-sao-joao");
  assert.equal(result.url_cta, "https://guia-turistico-de-andrelandia.pages.dev/pages/noticia/festa-de-sao-joao/");
  assert.equal(result.has_custom_cta, false);
  assert.equal(normalizePublication(result).has_custom_cta, false);
  assert.equal(result.galeria.length, 1);
  assert.equal(normalizePublication({ tipo: "noticia", titulo: "Aviso", url_cta: "https://andrelandia.mg.gov.br" }).has_custom_cta, true);
  assert.equal(normalizePublication({ tipo: "outro", titulo: "X" }), null);
});

test("descrições são limitadas sem cortar em tamanho incorreto", () => {
  assert.equal(descriptionFromText("curto", 5), "curto");
  assert.equal(descriptionFromText("muito longo", 5), "muit…");
});

test("eventos exibem data e horários de São Paulo", () => {
  const label = formatEventDateRange("2026-10-03T15:00:00.000Z", "2026-10-03T18:30:00.000Z");
  assert.match(label, /3 de outubro de 2026/);
  assert.match(label, /12:00/);
  assert.match(label, /15:30/);
});
