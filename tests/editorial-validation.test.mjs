import test from "node:test";
import assert from "node:assert/strict";
import { isValidImagePath, validatePublicUrl, validateEditorialPayload } from "../supabase/functions/noticias-admin/editorial-validation.mjs";

const base = {
  tipo: "evento",
  slug: "festa-de-sao-joao",
  titulo: "Festa de São João",
  resumo: "Programação da cidade",
  corpo: "Conteúdo em texto simples.",
  imagem_capa: "publicacoes/123/capa.webp",
  galeria: [],
  texto_cta: "Ver detalhes",
  url_cta: "/pages/noticia/festa-de-sao-joao/",
  status: "rascunho",
  destaque_hero: false,
  ordem_hero: 1,
};

test("servidor aceita conteúdo válido e normaliza evento", () => {
  const result = validateEditorialPayload({ ...base, inicio_evento: "2026-10-20T18:00:00-03:00" });
  assert.equal(result.error, undefined);
  assert.equal(result.value.tipo, "evento");
  assert.equal(result.value.inicio_evento, "2026-10-20T21:00:00.000Z");
});

test("servidor rejeita slug inválido, protocolo ativo e imagem fora do bucket", () => {
  assert.match(validateEditorialPayload({ ...base, slug: "../a" }).error, /slug/);
  assert.match(validateEditorialPayload({ ...base, url_cta: "javascript:alert(1)" }).error, /link/);
  assert.match(validateEditorialPayload({ ...base, imagem_capa: "publicacoes/../x.webp" }).error, /capa/);
  assert.equal(validatePublicUrl("//evil.example"), undefined);
});

test("destaque publicado do Hero exige imagem de capa", () => {
  assert.match(validateEditorialPayload({ ...base, status: "publicado", destaque_hero: true, imagem_capa: null }).error, /imagem de capa/);
  assert.equal(validateEditorialPayload({ ...base, status: "publicado", destaque_hero: true }).error, undefined);
});

test("paths de imagem exigem diretório e extensão permitidos", () => {
  assert.equal(isValidImagePath("publicacoes/123/a.webp"), true);
  assert.equal(isValidImagePath("publicacoes/123/a.svg"), false);
  assert.equal(isValidImagePath("../publicacoes/123/a.jpg"), false);
});

test("datas impossíveis e fim anterior ao início são rejeitados", () => {
  assert.match(validateEditorialPayload({ ...base, inicio_evento: "não é data" }).error, /data válida/);
  assert.match(validateEditorialPayload({
    ...base,
    inicio_evento: "2026-10-21T10:00:00Z",
    fim_evento: "2026-10-20T10:00:00Z",
  }).error, /anterior/);
});

test("rascunho não aceita status privilegiado e corpo preserva texto sem renderizar HTML", () => {
  const result = validateEditorialPayload({ ...base, status: "publicado; DROP TABLE" });
  assert.equal(result.value.status, "rascunho");
  const xss = validateEditorialPayload({ ...base, corpo: "<script>alert(1)</script>" });
  assert.equal(xss.value.corpo, "<script>alert(1)</script>");
});
