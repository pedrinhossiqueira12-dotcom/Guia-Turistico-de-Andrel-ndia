// Cifragem de dados pessoais financeiros. AAD impede reutilizar um segredo de outro usuário/propósito.
function courierKeyBytes(value: string): Uint8Array {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error("Criptografia de dados financeiros indisponível.");
  return Uint8Array.from(value.match(/.{2}/g) || [], pair => Number.parseInt(pair, 16));
}
function courierBase64Url(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function courierFromBase64Url(value: string): Uint8Array {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error("Dado financeiro cifrado inválido.");
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
export async function encryptCourierPix(value: string, keyHex: string, userId: string): Promise<string | null> {
  if (!value.trim()) return null;
  if (value.length > 254 || !userId) throw new Error("Chave Pix inválida.");
  const key = await crypto.subtle.importKey("raw", courierKeyBytes(keyHex) as BufferSource, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(`courier-pix-v2:${userId}`) }, key, new TextEncoder().encode(value.trim()));
  return `pix-v2:${courierBase64Url(iv)}.${courierBase64Url(new Uint8Array(ciphertext))}`;
}
export async function decryptCourierPix(value: string, keyHex: string, userId: string): Promise<string> {
  if (!value) return "";
  if (!value.startsWith("pix-v2:") || value.length > 1000 || !userId) throw new Error("Dado financeiro cifrado inválido.");
  const parts = value.slice(7).split(".");
  if (parts.length !== 2) throw new Error("Dado financeiro cifrado inválido.");
  const iv = courierFromBase64Url(parts[0]);
  if (iv.length !== 12) throw new Error("Dado financeiro cifrado inválido.");
  const key = await crypto.subtle.importKey("raw", courierKeyBytes(keyHex) as BufferSource, "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: new TextEncoder().encode(`courier-pix-v2:${userId}`) }, key, courierFromBase64Url(parts[1]) as BufferSource);
  return new TextDecoder().decode(plaintext);
}
