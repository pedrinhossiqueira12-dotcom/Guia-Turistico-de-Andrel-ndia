export const STORAGE_BUCKETS = Object.freeze(["cadastros", "mural-imagens"]);

/**
 * Accepts Supabase public/signed/authenticated object URLs and bucket-relative
 * references. Rejects local assets, unknown buckets and traversal segments.
 */
export function parseStorageObjectReference(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const hasStorageMarker = raw.includes("/storage/v1/object/");
  if (/^https?:\/\//i.test(raw) && !hasStorageMarker) return null;

  let pathname;
  try {
    pathname = new URL(raw, "https://local.invalid").pathname;
  } catch {
    return null;
  }

  let segments;
  const marker = "/storage/v1/object/";
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

  if (segments.some((part) => part === "." || part === ".." || part.includes("\\"))) return null;
  const bucket_id = segments.shift();
  const object_name = segments.join("/");
  if (!STORAGE_BUCKETS.includes(bucket_id) || !object_name) return null;
  return { bucket_id, object_name };
}

export function storageObjectKey(reference) {
  const parsed = parseStorageObjectReference(reference);
  return parsed ? `${parsed.bucket_id}/${parsed.object_name}` : null;
}
