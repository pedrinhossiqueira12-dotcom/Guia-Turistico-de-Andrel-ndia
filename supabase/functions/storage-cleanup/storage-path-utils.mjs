export const STORAGE_BUCKETS = Object.freeze(["cadastros", "mural-imagens", "catalogos"]);

/**
 * Aceita URLs públicas/assinadas/autenticadas do Supabase e referências
 * relativas no formato bucket/caminho. Rejeita assets locais, buckets
 * desconhecidos, traversal e segmentos codificados com barra.
 */
export function parseStorageObjectReference(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const marker = "/storage/v1/object/";
  const markerIndexRaw = raw.indexOf(marker);
  const hasStorageMarker = markerIndexRaw >= 0;
  if (/^https?:\/\//i.test(raw) && !hasStorageMarker) return null;

  const candidatePath = hasStorageMarker
    ? raw.slice(markerIndexRaw + marker.length).split(/[?#]/, 1)[0]
    : raw.split(/[?#]/, 1)[0];
  try {
    const rawSegments = candidatePath.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    if (rawSegments.some((part) => part === "." || part === ".." || part.includes("\\") || part.includes("/"))) return null;
  } catch {
    return null;
  }

  let pathname;
  try {
    pathname = new URL(raw, "https://local.invalid").pathname;
  } catch {
    return null;
  }

  let segments;
  const markerIndex = pathname.indexOf(marker);
  if (markerIndex >= 0) {
    segments = pathname.slice(markerIndex + marker.length).split("/").filter(Boolean);
    if (["public", "sign", "authenticated"].includes(segments[0])) segments.shift();
  } else {
    segments = pathname.replace(/^\/+/, "").split("/").filter(Boolean);
  }

  try {
    segments = segments.map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }

  if (segments.some((part) => part === "." || part === ".." || part.includes("\\") || part.includes("/"))) return null;
  const bucket_id = segments.shift();
  const object_name = segments.join("/");
  if (!STORAGE_BUCKETS.includes(bucket_id) || !object_name) return null;
  return { bucket_id, object_name };
}

export function storageObjectKey(reference) {
  const parsed = parseStorageObjectReference(reference);
  return parsed ? `${parsed.bucket_id}/${parsed.object_name}` : null;
}
