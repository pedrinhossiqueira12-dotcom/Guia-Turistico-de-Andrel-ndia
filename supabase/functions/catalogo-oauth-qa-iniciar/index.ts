import { createClient } from "npm:@supabase/supabase-js@2.117.2";

// Endpoint exclusivamente documental de início OAuth (sem cobrança, saque ou webhook).
const STAGING_URL = "https://jbttwihctuibchhcyqtl.supabase.co";
const CALLBACK_URL = `${STAGING_URL}/functions/v1/mercadopago-oauth-callback`;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const QA_ENABLED = Deno.env.get("MP_OAUTH_QA_ENABLED") === "true";
const QA_CLIENT_ID = Deno.env.get("MP_OAUTH_QA_CLIENT_ID") ?? "";
const QA_REDIRECT_URI = Deno.env.get("MP_OAUTH_QA_REDIRECT_URI") ?? "";
const QA_ALLOWED_COMMERCE_ID = Deno.env.get("MP_OAUTH_QA_ALLOWED_COMMERCE_ID") ?? "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey,authorization,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS });
const str = (v: unknown) => typeof v === "string" ? v.trim() : "";
function base64Url(bytes: Uint8Array) {
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
const randomSecret = () => base64Url(crypto.getRandomValues(new Uint8Array(32)));
async function sha256(value: string) {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
let serviceKey = "";
try {
  const parsed = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "null");
  serviceKey = parsed?.default || parsed?.service_role || "";
} catch { /* legacy service role fallback below */ }
if (!serviceKey) serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Não inicializar client privilegiado no ambiente incorreto.
const admin = SUPABASE_URL === STAGING_URL && serviceKey
  ? createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, mensagem: "Use POST." }, 405);
  if (!admin || !QA_ENABLED || !QA_CLIENT_ID || !/^[0-9]+$/.test(QA_CLIENT_ID)
    || QA_REDIRECT_URI !== CALLBACK_URL
    || !/^[a-z0-9][a-z0-9-]{0,179}$/.test(QA_ALLOWED_COMMERCE_ID)) {
    return json({ success: false, mensagem: "OAuth de homologação indisponível neste ambiente." }, 503);
  }
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json({ success: false, mensagem: "Sessão necessária." }, 401);
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user?.id) return json({ success: false, mensagem: "Sessão inválida." }, 401);
  const userId = auth.user.id;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ success: false, mensagem: "JSON inválido." }, 400); }
  if (str(body.acao) !== "iniciar_conexao_qa" || str(body.comercio_id) !== QA_ALLOWED_COMMERCE_ID) {
    return json({ success: false, mensagem: "Comércio fora da homologação autorizada." }, 403);
  }
  const commerceId = QA_ALLOWED_COMMERCE_ID;

  // O usuário precisa ser dono do catálogo e possuir cadastro aprovado.
  const [published, catalog, registrations, receiver] = await Promise.all([
    admin.from("comercios_publicados").select("local_id,status").eq("local_id", commerceId).maybeSingle(),
    admin.from("catalogos").select("comercio_id,proprietario_id,bloqueado").eq("comercio_id", commerceId).maybeSingle(),
    admin.from("cadastros_comercios").select("id,local_id,status,usuario_id").eq("usuario_id", userId).eq("status", "aprovado").eq("local_id", commerceId).limit(1),
    admin.from("catalogo_recebedores").select("comercio_id").eq("comercio_id", commerceId).maybeSingle(),
  ]);
  if (published.error || catalog.error || registrations.error || receiver.error) {
    return json({ success: false, mensagem: "Não foi possível validar o comércio." }, 503);
  }
  if (published.data?.status !== "ativo" || !catalog.data
    || catalog.data.proprietario_id !== userId || catalog.data.bloqueado
    || !registrations.data?.length || receiver.data) {
    return json({ success: false, mensagem: "Este comércio não está elegível para vinculação OAuth de QA." }, 403);
  }

  const state = randomSecret();
  const verifier = randomSecret();
  const { error: insertError } = await admin.from("catalogo_oauth_estados").insert({
    estado_hash: await sha256(state),
    comercio_id: commerceId,
    proprietario_id: userId,
    code_verifier: verifier,
    expira_em: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  if (insertError) return json({ success: false, mensagem: "Não foi possível iniciar a autorização." }, 503);
  const url = new URL("https://auth.mercadopago.com.br/authorization");
  url.search = new URLSearchParams({
    client_id: QA_CLIENT_ID,
    response_type: "code",
    platform_id: "mp",
    redirect_uri: QA_REDIRECT_URI,
    state,
    code_challenge: await sha256(verifier),
    code_challenge_method: "S256",
  }).toString();
  return json({ success: true, authorization_url: url.toString(), expires_in: 600 });
});
