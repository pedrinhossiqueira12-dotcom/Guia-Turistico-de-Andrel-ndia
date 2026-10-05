import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SECRET_KEYS = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";
const LEGACY_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MP_OAUTH_ENCRYPTION_KEY = Deno.env.get("MP_OAUTH_ENCRYPTION_KEY") ?? "";
const MP_MARKETPLACE_WEBHOOK_SECRET = Deno.env.get("MP_MARKETPLACE_WEBHOOK_SECRET") ?? "";
const CORS_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
let serviceKey = "";
try { const parsed = SUPABASE_SECRET_KEYS ? JSON.parse(SUPABASE_SECRET_KEYS) : null; serviceKey = parsed?.default || parsed?.service_role || ""; } catch { /* fallback */ }
if (!serviceKey) serviceKey = LEGACY_SERVICE_ROLE_KEY;
const admin = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS }); }
function base64Bytes(value: string) { const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "==="; const binary = atob(padded.slice(0, padded.length - (padded.length % 4))); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); }
function hexKey(value: string) { return Uint8Array.from(value.match(/.{1,2}/g) || [], (pair) => Number.parseInt(pair, 16)); }
async function decrypt(value: string) { const [ivEncoded, cipherEncoded] = value.split("."); const raw = hexKey(MP_OAUTH_ENCRYPTION_KEY); if (raw.length !== 32) throw new Error("OAuth encryption key inválida."); const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]); const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64Bytes(ivEncoded) }, key, base64Bytes(cipherEncoded)); return new TextDecoder().decode(plain); }
async function validSignature(signature: string, requestId: string, dataId: string) {
  if (!MP_MARKETPLACE_WEBHOOK_SECRET) return false;
  const fields = Object.fromEntries(signature.split(",").map((part) => part.trim().split("=", 2)).filter(([key, value]) => key && value)); const ts = fields.ts || ""; const v1 = fields.v1 || ""; if (!/^\d+$/.test(ts) || !v1) return false;
  if (Math.abs(Date.now() - Number(ts)) > 5 * 60 * 1000) return false;
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(MP_MARKETPLACE_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest)));
  const expected = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return expected.length === v1.length && [...expected].every((char, index) => char === v1[index]);
}
async function getOrder(token: string, orderId: string) { const response = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(orderId)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12000) }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error("Não foi possível consultar a order no Mercado Pago."); return data; }
function orderState(order: Record<string, unknown>) { const transactions = order.transactions && typeof order.transactions === "object" ? order.transactions as Record<string, unknown> : {}; const payment = Array.isArray(transactions.payments) ? (transactions.payments[0] || {}) as Record<string, unknown> : {}; const status = String(order.status || payment.status || ""); const detail = String(order.status_detail || payment.status_detail || ""); if (status === "processed" || detail === "accredited" || detail === "approved") return { status: "pago", status_pagamento: "aprovado", pago_em: new Date().toISOString(), metadata: { status_detail: detail } }; if (["canceled", "cancelled"].includes(status) || ["canceled", "cancelled", "expired", "refunded", "refunded_partially"].includes(detail)) return { status: detail === "expired" ? "expirado" : detail.includes("refund") ? "estornado" : "cancelado", status_pagamento: detail === "expired" ? "expirado" : detail.includes("refund") ? "estornado" : "cancelado", metadata: { status_detail: detail } }; return { status: "aguardando_pagamento", status_pagamento: "pendente", metadata: { status_detail: detail } }; }
Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ success: false, mensagem: "Use POST." }, 405);
  try {
    const url = new URL(request.url); const body = await request.json().catch(() => ({})); const data = body && typeof body === "object" ? body as Record<string, unknown> : {}; const dataId = url.searchParams.get("data.id") || String((data.data as Record<string, unknown> | undefined)?.id || ""); const type = url.searchParams.get("type") || String(data.type || ""); const requestId = request.headers.get("x-request-id") || "";
    if (!dataId || !["order", "orders_v2"].includes(type)) return json({ success: true, ignored: true });
    if (!(await validSignature(request.headers.get("x-signature") || "", requestId, dataId))) return json({ success: false, mensagem: "Webhook inválido." }, 401);
    const { data: pedido, error } = await admin.from("catalogo_pedidos").select("id,comercio_id,order_id,metadata").eq("order_id", dataId).maybeSingle(); if (error) throw new Error("Falha ao localizar pedido."); if (!pedido) return json({ success: true, ignored: true });
    const { data: receiver, error: receiverError } = await admin.from("catalogo_recebedores").select("oauth_access_token_enc,status").eq("comercio_id", pedido.comercio_id).maybeSingle(); if (receiverError || !receiver?.oauth_access_token_enc || receiver.status !== "ativo") throw new Error("Recebedor não disponível.");
    const order = await getOrder(await decrypt(receiver.oauth_access_token_enc), dataId) as Record<string, unknown>; if (String(order.external_reference || "") !== `guia-${pedido.id}`) return json({ success: false, mensagem: "Referência da order não corresponde ao pedido." }, 409);
    const next = orderState(order); const oldMetadata = pedido.metadata && typeof pedido.metadata === "object" ? pedido.metadata as Record<string, unknown> : {}; const { error: updateError } = await admin.from("catalogo_pedidos").update({ ...next, metadata: { ...oldMetadata, webhook: next.metadata } }).eq("id", pedido.id); if (updateError) throw new Error("Falha ao atualizar status do pedido.");
    return json({ success: true, pedido_id: pedido.id, status: next.status, status_pagamento: next.status_pagamento });
  } catch (error) { console.error("marketplace webhook failed:", (error as Error).message); return json({ success: false, mensagem: "Falha temporária no webhook." }, 503); }
});
