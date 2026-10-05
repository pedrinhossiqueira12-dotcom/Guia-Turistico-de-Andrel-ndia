import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SECRET_KEYS = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";
const LEGACY_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MP_OAUTH_CLIENT_ID = Deno.env.get("MP_OAUTH_CLIENT_ID") ?? "";
const MP_OAUTH_CLIENT_SECRET = Deno.env.get("MP_OAUTH_CLIENT_SECRET") ?? "";
const MP_OAUTH_REDIRECT_URI = Deno.env.get("MP_OAUTH_REDIRECT_URI") ?? "";
const MP_OAUTH_ENCRYPTION_KEY = Deno.env.get("MP_OAUTH_ENCRYPTION_KEY") ?? "";
const SITE_URL = (Deno.env.get("SITE_URL") || "https://guia-turistico-de-andrelandia.pages.dev").replace(/\/$/, "");
const CORS_HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" };
let serviceKey = "";
try {
  const parsed = SUPABASE_SECRET_KEYS ? JSON.parse(SUPABASE_SECRET_KEYS) : null;
  serviceKey = parsed?.default || parsed?.service_role || "";
} catch { /* fallback abaixo */ }
if (!serviceKey) serviceKey = LEGACY_SERVICE_ROLE_KEY;
const admin = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
function html(message: string, redirect: string | null = null) {
  const safe = message.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
  const script = redirect ? `<meta http-equiv="refresh" content="2;url=${redirect}"><script>setTimeout(()=>location.replace(${JSON.stringify(redirect)}),1800)</script>` : "";
  return new Response(`<!doctype html><meta charset="utf-8"><title>Mercado Pago</title>${script}<main style="font:16px system-ui;max-width:620px;margin:12vh auto;padding:24px"><h1>Conexão Mercado Pago</h1><p>${safe}</p></main>`, { headers: CORS_HEADERS });
}
function base64Url(bytes: Uint8Array) { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
async function sha256(value: string) { return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))); }
function hexKey(value: string) { return Uint8Array.from(value.match(/.{1,2}/g) || [], (pair) => Number.parseInt(pair, 16)); }
async function encrypt(value: string) {
  const raw = hexKey(MP_OAUTH_ENCRYPTION_KEY);
  if (raw.length !== 32) throw new Error("MP_OAUTH_ENCRYPTION_KEY deve ter 64 caracteres hexadecimais.");
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value)));
  return `${base64Url(iv)}.${base64Url(cipher)}`;
}
async function exchangeCode(code: string, verifier: string) {
  const response = await fetch("https://api.mercadopago.com/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams({ client_id: MP_OAUTH_CLIENT_ID, client_secret: MP_OAUTH_CLIENT_SECRET, grant_type: "authorization_code", code, redirect_uri: MP_OAUTH_REDIRECT_URI, code_verifier: verifier }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token || !data.refresh_token || !data.user_id) throw new Error("Mercado Pago não autorizou a conta recebedora.");
  return data;
}
Deno.serve(async (request: Request) => {
  if (request.method !== "GET") return html("Use o endereço de callback enviado pelo Mercado Pago.");
  const url = new URL(request.url); const code = url.searchParams.get("code") || ""; const state = url.searchParams.get("state") || ""; const error = url.searchParams.get("error") || "";
  if (error || !code || !state) return html("A autorização foi cancelada ou retornou dados incompletos.");
  if (!MP_OAUTH_CLIENT_ID || !MP_OAUTH_CLIENT_SECRET || !MP_OAUTH_REDIRECT_URI || !MP_OAUTH_ENCRYPTION_KEY) return html("O OAuth ainda não foi configurado pelo administrador.");
  try {
    const stateHash = await sha256(state);
    const { data: oauthState, error: stateError } = await admin.from("catalogo_oauth_estados").select("id,comercio_id,proprietario_id,code_verifier,expira_em,usado_em").eq("estado_hash", stateHash).maybeSingle();
    if (stateError || !oauthState || oauthState.usado_em || new Date(oauthState.expira_em).getTime() < Date.now()) return html("A autorização expirou. Volte ao catálogo e tente novamente.");
    const credentials = await exchangeCode(code, oauthState.code_verifier); const now = new Date().toISOString();
    const { error: updateStateError } = await admin.from("catalogo_oauth_estados").update({ usado_em: now }).eq("id", oauthState.id).is("usado_em", null);
    if (updateStateError) throw new Error("Não foi possível finalizar o estado OAuth.");
    const { error: receiverError } = await admin.from("catalogo_recebedores").upsert({ comercio_id: oauthState.comercio_id, provedor: "mercadopago", conta_externa_id: String(credentials.user_id), oauth_user_id: String(credentials.user_id), oauth_access_token_enc: await encrypt(String(credentials.access_token)), oauth_refresh_token_enc: await encrypt(String(credentials.refresh_token)), oauth_expires_at: new Date(Date.now() + Number(credentials.expires_in || 15552000) * 1000).toISOString(), oauth_scope: String(credentials.scope || ""), oauth_public_key: String(credentials.public_key || ""), oauth_live_mode: Boolean(credentials.live_mode), oauth_conectado_em: now, conectado_em: now, status: "ativo", atualizado_em: now }, { onConflict: "comercio_id" });
    if (receiverError) throw new Error("Autorização recebida, mas não foi possível salvar o recebedor.");
    const redirect = `${SITE_URL}/pages/catalogo-pix-producao.html?id=${encodeURIComponent(oauthState.comercio_id)}&oauth=success`;
    return html("Conta Mercado Pago conectada com sucesso. Você será redirecionado.", redirect);
  } catch (error) { console.error("Mercado Pago OAuth callback failed:", (error as Error).message); return html("Não foi possível concluir a conexão. Nenhum pagamento foi criado. Volte ao catálogo e tente novamente."); }
});
