import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { decryptAesGcm, extractProviderPayment, providerFactsError, parseWebhookSignature, verifyWebhookSignature } from "../_shared/catalogo-pagamentos-v2.ts";
import { eventKind, eventId, canonicalOrderType } from "../_shared/catalogo-webhook-events.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const MP_OAUTH_ENCRYPTION_KEY = Deno.env.get("MP_OAUTH_ENCRYPTION_KEY") ?? "";
const MP_WEBHOOK_SECRET_RAW = Deno.env.get("MP_MARKETPLACE_WEBHOOK_SECRET") ?? "";
const MP_MARKETPLACE_WEBHOOK_SECRET = MP_WEBHOOK_SECRET_RAW.trim();
const MP_API = "https://api.mercadopago.com";
const CORS_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
let serviceKey = "";
try {
  const parsed = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "null");
  serviceKey = parsed?.default || parsed?.service_role || "";
} catch { /* Compatibilidade durante rotação de secrets. */ }
if (!serviceKey) serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
function json(data: unknown, status = 200): Response { return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS }); }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
async function providerGet(token: string, kind: "payment" | "order", id: string) {
  const resource = kind === "payment" ? `/v1/payments/${encodeURIComponent(id)}` : `/v1/orders/${encodeURIComponent(id)}`;
  const response = await fetch(`${MP_API}${resource}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
  const data = record(await response.json().catch(() => ({})));
  if (!response.ok) throw new Error("Não foi possível verificar o pagamento diretamente no Mercado Pago.");
  return data;
}
async function lookupPedido(kind: "payment" | "order", id: string) {
  const { data, error } = await admin.from("catalogo_pedidos")
    .select("id,comercio_id,referencia_externa,provedor,order_id,payment_id,total_centavos,versao_financeira,taxa_plataforma_centavos,taxa_motoboy_centavos,taxa_total_centavos,metadata,status,status_pagamento")
    .eq(kind === "payment" ? "payment_id" : "order_id", id).maybeSingle();
  if (error) throw new Error("Falha ao localizar o pedido para conciliação.");
  return data ? record(data) : null;
}
async function lookupFaturaCobranca(orderId: string) {
  const { data, error } = await admin.from("catalogo_fatura_cobrancas")
    .select("id,order_id").eq("order_id", orderId).maybeSingle();
  if (error) throw new Error("Falha ao localizar o vínculo da cobrança da fatura.");
  return data ? record(data) : null;
}
async function forwardFaturaWebhook(request: Request, url: URL, body: Record<string, unknown>, orderId: string): Promise<Response> {
  if (!SUPABASE_URL) throw new Error("SUPABASE_URL ausente para encaminhar o webhook da fatura.");
  const destination = new URL("/functions/v1/catalogo-fatura-pix/webhook", SUPABASE_URL);
  destination.searchParams.set("type", canonicalOrderType(url, body));
  destination.searchParams.set("data.id", orderId);
  const downstream = await fetch(destination.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-signature": request.headers.get("x-signature") || "",
      "x-request-id": request.headers.get("x-request-id") || "",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  return new Response(await downstream.text(), { status: downstream.status, headers: CORS_HEADERS });
}
async function receiverToken(comercioId: string) {
  const { data, error } = await admin.from("catalogo_recebedores").select("status,conta_externa_id,oauth_access_token_enc").eq("comercio_id", comercioId).maybeSingle();
  if (error || !data || data.status !== "ativo" || !data.conta_externa_id || !data.oauth_access_token_enc) throw new Error("Recebedor Mercado Pago indisponível.");
  return { token: await decryptAesGcm(String(data.oauth_access_token_enc), MP_OAUTH_ENCRYPTION_KEY), conta: String(data.conta_externa_id) };
}
async function auditFeeMismatch(pedido: Record<string, unknown>, expected: number, observed: number | null, id: string) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: current, error: readError } = await admin.from("catalogo_pedidos").select("id,comercio_id,metadata").eq("id", pedido.id).eq("comercio_id", pedido.comercio_id).single();
    if (readError || !current) throw new Error("Falha ao auditar taxa divergente.");
    const metadata = record(current.metadata);
    const { data, error } = await admin.from("catalogo_pedidos").update({ metadata: {
      ...metadata, provider_fee_review: { motivo: "taxa_divergente", esperado_centavos: expected, observado_centavos: observed, payment_id: id, verificado_em: new Date().toISOString() },
    } }).eq("id", pedido.id).eq("comercio_id", pedido.comercio_id).eq("metadata", JSON.stringify(metadata)).select("id").maybeSingle();
    if (error) throw new Error("Falha ao persistir auditoria de taxa divergente.");
    if (data) return;
  }
  throw new Error("Conciliação concorrente; repetir auditoria de taxa.");
}
async function reconcile(request: Request): Promise<Response> {
  const url = new URL(request.url), body = record(await request.json().catch(() => ({})));
  const kind = eventKind(String(url.searchParams.get("type") || body.type || body.action || ""), body);
  if (!kind) return json({ success: true, ignored: true });
  const id = eventId(url, body), requestId = (request.headers.get("x-request-id") || "").trim();
  const signatureHeader = request.headers.get("x-signature");
  if (!id || !requestId || requestId.length > 200) {
    console.error("marketplace webhook rejected:", JSON.stringify({ fase: "identificacao", recurso_valido: Boolean(id), request_id_presente: Boolean(requestId), request_id_tamanho_valido: requestId.length <= 200, assinatura_presente: Boolean(signatureHeader) }));
    return json({ success: false, mensagem: "Webhook inválido." }, 401);
  }
  if (!await verifyWebhookSignature({ header: signatureHeader, requestId, dataId: id, secret: MP_MARKETPLACE_WEBHOOK_SECRET })) {
    const parsed = parseWebhookSignature(signatureHeader);
    const timestamp = parsed ? Number(parsed.timestamp) * (parsed.timestamp.length === 10 ? 1000 : 1) : NaN;
    // A conferência fora da janela serve SOMENTE ao diagnóstico. Ela nunca
    // autoriza a notificação: este caminho sempre encerra com HTTP 401.
    const hmacMatches = parsed && MP_MARKETPLACE_WEBHOOK_SECRET
      ? await verifyWebhookSignature({ header: signatureHeader, requestId, dataId: id, secret: MP_MARKETPLACE_WEBHOOK_SECRET, now: timestamp, maxAgeMs: 0 })
      : false;
    console.error("marketplace webhook rejected:", JSON.stringify({ fase: "assinatura", pagamento_id: id, assinatura_presente: Boolean(signatureHeader), formato_valido: Boolean(parsed), segredo_configurado: Boolean(MP_MARKETPLACE_WEBHOOK_SECRET), segredo_normalizado: MP_WEBHOOK_SECRET_RAW !== MP_MARKETPLACE_WEBHOOK_SECRET, idade_segundos: Number.isFinite(timestamp) ? Math.round((Date.now() - timestamp) / 1000) : null, hmac_confere: Boolean(hmacMatches) }));
    return json({ success: false, mensagem: "Webhook inválido." }, 401);
  }
  const pedido = await lookupPedido(kind, id);
  // Webhook pode chegar antes do POST persistir payment_id. Nunca ACK definitivo:
  // o provedor deve repetir após a reserva local publicar os artefatos (mesma idempotência).
  if (!pedido && kind === "order" && await lookupFaturaCobranca(id)) {
    return await forwardFaturaWebhook(request, url, body, id);
  }
  if (!pedido) return json({ success: false, retry: true, mensagem: "Pagamento ainda não localizado; repetir conciliação." }, 503);
  if (pedido.provedor !== "mercadopago") return json({ success: false, mensagem: "Provedor do pedido inválido." }, 409);
  const receiver = await receiverToken(String(pedido.comercio_id));
  const provider = await providerGet(receiver.token, kind, id), facts = extractProviderPayment(provider, kind);
  // Pedidos Orders antigos usam guia-UUID; o snapshot de referência é preservado.
  const expectedReference = String(pedido.referencia_externa || `guia-${pedido.id}`);
  const mismatch = providerFactsError(facts, id, expectedReference, receiver.conta, Number(pedido.total_centavos));
  if (mismatch) return json({ success: false, mensagem: mismatch }, 409);
  const feeExpected = Number(pedido.taxa_total_centavos ?? record(pedido.metadata).taxa_total_centavos ?? pedido.taxa_plataforma_centavos);
  if (!Number.isSafeInteger(feeExpected) || feeExpected < 0) return json({ success: false, mensagem: "Snapshot financeiro inválido." }, 409);
  const feeMismatch = facts.feeCentavos !== null && facts.feeCentavos !== feeExpected;
  if (feeMismatch) await auditFeeMismatch(pedido, feeExpected, facts.feeCentavos, facts.id);
  const rpcStatus = facts.state === "contestado" ? "charged_back" : facts.state === "estornado" ? "estornado" : feeMismatch ? "revisao_parcial" : facts.state === "expirado" ? "cancelado" : facts.state;
  let result: Record<string, unknown> = {};
  if (facts.state !== "pendente" || feeMismatch) {
    const { data, error } = await admin.rpc("catalogo_aplicar_pagamento_v2", {
      p_pedido_id: pedido.id, p_status: rpcStatus,
      p_valor_centavos: facts.amountCentavos, p_taxa_centavos: feeMismatch ? null : facts.feeCentavos, p_referencia: facts.id,
    });
    if (error) throw new Error("Falha ao aplicar conciliação financeira idempotente.");
    result = record(data);
    if (result.ok !== true) return json({ success: false, mensagem: String(result.mensagem || "Conciliação recusada.") }, Number(result.http_status) || 409);
  }
  if (feeMismatch) return json({ success: false, revisao_financeira: true, taxa_conferida: false, mensagem: "Taxa divergente encaminhada para revisão financeira; nenhum saldo declarado disponível." }, 409);
  return json({
    success: true, pedido_id: pedido.id, payment_id: kind === "payment" ? id : (pedido.payment_id || null), order_id: kind === "order" ? id : (pedido.order_id || null),
    status: facts.state, status_pagamento: result.status_pagamento ?? pedido.status_pagamento,
    taxa_centavos: facts.feeCentavos, taxa_conferida: facts.feeCentavos !== null,
    revisao_financeira: facts.state === "revisao_parcial" || facts.feeCentavos === null,
    financiamento_comprovado: result.financiamento_comprovado === true,
  });
}
Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ success: false, mensagem: "Use POST." }, 405);
  try { return await reconcile(request); }
  catch (error) {
    console.error("marketplace webhook failed:", error instanceof Error ? error.message : String(error));
    return json({ success: false, retry: true, mensagem: "Falha temporária no webhook." }, 503);
  }
});
