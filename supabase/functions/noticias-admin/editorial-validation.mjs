const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SITE_ORIGIN = "https://guia-turistico-de-andrelandia.pages.dev";
const IMAGE_PATH_PATTERN = /^publicacoes\/[a-zA-Z0-9_-]{1,80}\/[a-zA-Z0-9_-]{1,100}\.(?:jpg|jpeg|png|webp)$/i;

export function isValidImagePath(value) {
  return typeof value === "string" && IMAGE_PATH_PATTERN.test(value) && !value.split("/").includes("..");
}

export function validatePublicUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("//")) return undefined;
  try {
    const origin = new URL(SITE_ORIGIN);
    const url = new URL(raw, origin);
    if (!new Set(["https:", "http:"]).has(url.protocol) || url.username || url.password) return undefined;
    return url.origin === origin.origin ? `${url.pathname}${url.search}${url.hash}` : url.href;
  } catch {
    return undefined;
  }
}

function cleanText(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function dateValue(value, field) {
  if (value === null || value === undefined || value === "") return { value: null };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { error: `${field} não é uma data válida.` };
  return { value: date.toISOString() };
}

export function validateEditorialPayload(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "Dados editoriais inválidos." };
  const tipo = raw.tipo === "noticia" || raw.tipo === "evento" ? raw.tipo : "";
  const titulo = cleanText(raw.titulo, 140);
  const slug = cleanText(raw.slug, 100).toLowerCase();
  if (!tipo) return { error: "Escolha notícia ou evento." };
  if (!titulo) return { error: "Informe o título." };
  if (!SLUG_PATTERN.test(slug)) return { error: "O slug deve conter letras minúsculas, números e hífens." };
  if (String(raw.resumo ?? "").length > 400) return { error: "O resumo excede 400 caracteres." };
  if (String(raw.corpo ?? "").length > 30000) return { error: "O conteúdo excede 30.000 caracteres." };

  const id = raw.id ? String(raw.id) : "";
  if (id && !UUID_PATTERN.test(id)) return { error: "Identificador editorial inválido." };

  const status = ["rascunho", "publicado", "arquivado"].includes(raw.status) ? raw.status : "rascunho";
  const cover = raw.imagem_capa ? String(raw.imagem_capa) : null;
  if (cover && !isValidImagePath(cover)) return { error: "A capa deve usar um caminho de imagem válido do bucket editorial." };
  if (Boolean(raw.destaque_hero) && status === "publicado" && !cover) return { error: "Um destaque publicado no Hero precisa de imagem de capa." };
  const gallery = Array.isArray(raw.galeria) ? raw.galeria : [];
  if (gallery.length > 8 || gallery.some((path) => !isValidImagePath(path))) {
    return { error: "A galeria aceita até 8 imagens com caminho válido do bucket editorial." };
  }
  const ctaUrl = validatePublicUrl(raw.url_cta);
  if (ctaUrl === undefined) return { error: "O link do botão deve ser HTTP/HTTPS ou um caminho deste site." };
  const start = dateValue(raw.inicio_evento, "Início do evento");
  const end = dateValue(raw.fim_evento, "Fim do evento");
  if (start.error) return { error: start.error };
  if (end.error) return { error: end.error };
  if (start.value && end.value && new Date(end.value) < new Date(start.value)) {
    return { error: "O fim do evento não pode ser anterior ao início." };
  }

  const ordem = Number(raw.ordem_hero ?? 0);
  if (!Number.isInteger(ordem) || ordem < 0 || ordem > 9999) return { error: "A ordem do destaque deve ser um inteiro de 0 a 9999." };

  return {
    value: {
      ...(id ? { id } : {}),
      slug,
      tipo,
      titulo,
      resumo: cleanText(raw.resumo, 400),
      corpo: String(raw.corpo ?? ""),
      local_evento: tipo === "evento" ? cleanText(raw.local_evento, 240) || null : null,
      inicio_evento: tipo === "evento" ? start.value : null,
      fim_evento: tipo === "evento" ? end.value : null,
      imagem_capa: cover,
      galeria: gallery,
      texto_cta: cleanText(raw.texto_cta, 60) || null,
      url_cta: ctaUrl,
      destaque_hero: Boolean(raw.destaque_hero),
      ordem_hero: ordem,
      status,
    },
  };
}
