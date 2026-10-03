import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { renderCard, renderHeroSlide, renderStaticDetail, replaceMarkerBlock } from "../scripts/build-publicacoes.mjs";

const require = createRequire(import.meta.url);
const Utils = require("../js/editorial-utils.js");

function publication(overrides = {}) {
  return Utils.normalizePublication({
    id: "2df3c71c-e877-4506-98da-fd0b2c9a0ec8",
    slug: "aviso-importante",
    tipo: "noticia",
    titulo: "Aviso <img src=x onerror=alert(1)>",
    resumo: "Descrição <script>alert(1)</script>",
    corpo: "Texto <svg onload=alert(1)>",
    status: "publicado",
    publicado_em: "2026-10-03T12:00:00.000Z",
    galeria: [],
    ...overrides,
  });
}

test("cartões e Hero escapam conteúdo editorial não confiável", () => {
  const item = publication();
  const card = renderCard(item);
  const slide = renderHeroSlide(item, 0, 1);
  assert.match(card, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(slide, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(card, /<img src=x onerror/);
  assert.doesNotMatch(slide, /<img src=x onerror/);
});

test("página estática inclui canonical, metadados e conteúdo escapado", () => {
  const html = renderStaticDetail(publication({ tipo: "evento", inicio_evento: "2026-10-03T15:00:00.000Z", local_evento: "Praça <central>" }));
  assert.match(html, /rel="canonical"/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /&lt;svg onload=alert\(1\)&gt;/);
  assert.match(html, /Praça &lt;central&gt;/);
  assert.match(html, /12:00/);
});

test("CTA externo gerado usa proteção noopener", () => {
  const html = renderCard(publication({ url_cta: "https://andrelandia.mg.gov.br/agenda", texto_cta: "Agenda oficial" }));
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /Agenda oficial/);
});

test("substituição de marcador altera somente o bloco delimitado", () => {
  const result = replaceMarkerBlock("antes<!--INICIO-->velho<!--FIM-->depois", "<!--INICIO-->", "<!--FIM-->", "novo");
  assert.equal(result, "antes<!--INICIO-->\nnovo\n<!--FIM-->depois");
});
