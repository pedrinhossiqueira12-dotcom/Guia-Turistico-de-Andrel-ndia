import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SECRET_KEYS = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";
const LEGACY_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MP_OAUTH_ENCRYPTION_KEY = Deno.env.get("MP_OAUTH_ENCRYPTION_KEY") ?? "";
const MARKETPLACE_CHECKOUT_ENABLED = Deno.env.get("MARKETPLACE_CHECKOUT_ENABLED") === "true";
const MP_API = "https://api.mercadopago.com";
const CORS_HEADERS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
let serviceKey = "";
try { const parsed = SUPABASE_SECRET_KEYS ? JSON.parse(SUPABASE_SECRET_KEYS) : null; serviceKey = parsed?.default || parsed?.service_role || ""; } catch { /* fallback */ }
if (!serviceKey) serviceKey = LEGACY_SERVICE_ROLE_KEY;
const admin = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
class HttpError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS }); }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown, max: number) { const result = typeof value === "string" ? value.trim() : ""; if (result.length > max) throw new HttpError("Um dos campos excede o limite permitido."); return result; }
function cents(value: unknown, label: string) { const number = Number(value); if (!Number.isInteger(number) || number < 0 || number > 999999999) throw new HttpError(`${label} inválido.`); return number; }
function money(centsValue: number) { return (centsValue / 100).toFixed(2); }
function hexKey(value: string) { return Uint8Array.from(value.match(/.{1,2}/g) || [], (pair) => Number.parseInt(pair, 16)); }
function base64Bytes(value: string) { const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "==="; const binary = atob(padded.slice(0, padded.length - (padded.length % 4))); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); }
async function decrypt(value: string) {
  try {
    const [ivEncoded, cipherEncoded] = value.split("."); const raw = hexKey(MP_OAUTH_ENCRYPTION_KEY);
    if (raw.length !== 32 || !ivEncoded || !cipherEncoded) throw new Error("invalid encryption configuration");
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64Bytes(ivEncoded) }, key, base64Bytes(cipherEncoded));
    return new TextDecoder().decode(plain);
  } catch (error) {
    console.error("Marketplace receiver token could not be decrypted", error instanceof Error ? error.message : String(error));
    throw new HttpError("A conexão deste comércio com o Mercado Pago está inválida. Reconecte a conta antes de gerar um Pix.", 503);
  }
}
function validEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value) && value.length <= 180; }
function orderPix(data: Record<string, unknown>) {
  const transactions = asRecord(data.transactions); const payment = asRecord(Array.isArray(transactions.payments) ? transactions.payments[0] : null); const method = asRecord(payment.payment_method);
  return { order_id: String(data.id || ""), payment_id: String(payment.id || ""), status: String(data.status || payment.status || ""), status_detail: String(data.status_detail || payment.status_detail || ""), pix_codigo: String(method.qr_code || ""), pix_qr_code_base64: String(method.qr_code_base64 || ""), ticket_url: String(method.ticket_url || "") };
}
async function mpOrder(token: string, payload: Record<string, unknown>, idempotency: string) {
  const response = await fetch(`${MP_API}/v1/orders`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json", "X-Idempotency-Key": idempotency }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) { console.error("Marketplace order failed", { status: response.status, cause: String(data.message || data.error || "unknown") }); throw new HttpError("O Mercado Pago não criou o Pix. Nenhum pagamento foi confirmado.", response.status === 429 ? 503 : 502); }
  return data;
}
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ success: false, mensagem: "Use POST." }, 405);
  if (!MARKETPLACE_CHECKOUT_ENABLED) return json({ success: false, mensagem: "O checkout de pedidos permanece desligado até a conclusão dos testes." }, 503);
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const comercioId = text(body.comercio_id, 180);
    const requestId = text(body.request_id, 80);
    if (!/^[a-z0-9-]{1,180}$/.test(comercioId)) throw new HttpError("Comércio inválido.");
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new HttpError("Identificador da tentativa inválido.");
    const cliente = asRecord(body.cliente); const nome = text(cliente.nome, 140); const email = text(cliente.email, 180).toLowerCase(); const telefone = text(cliente.telefone, 40);
    const modalidade = text(body.modalidade, 30); const endereco = text(cliente.endereco, 240); const numero = text(cliente.numero, 30); const bairro = text(cliente.bairro, 120); const complemento = text(cliente.complemento, 160); const referencia = text(cliente.referencia, 240); const observacoes = text(body.observacoes, 1000);
    if (!nome || !telefone || !validEmail(email)) throw new HttpError("Informe nome, telefone e um e-mail válido.");
    if (!["entrega", "retirada", "consumo_local"].includes(modalidade)) throw new HttpError("Modalidade inválida.");
    if (modalidade === "entrega" && (!endereco || !numero || !bairro)) throw new HttpError("Informe endereço, número e bairro para entrega.");
    const rawItems = Array.isArray(body.itens) ? body.itens : []; if (!rawItems.length || rawItems.length > 50) throw new HttpError("O pedido precisa ter itens válidos.");
    const requested = new Map<string, number>(); for (const raw of rawItems) { const item = asRecord(raw); const id = text(item.id, 80); const quantity = Math.floor(Number(item.quantidade)); if (!id || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new HttpError("Quantidade de produto inválida."); requested.set(id, (requested.get(id) || 0) + quantity); }
    const ids = [...requested.keys()];
    const [{ data: catalog, error: catalogError }, { data: products, error: productError }, { data: receiver, error: receiverError }, { data: existing, error: existingError }] = await Promise.all([
      admin.from("catalogo_publicado").select("comercio_id").eq("comercio_id", comercioId).maybeSingle(),
      admin.from("catalogo_produtos").select("id,comercio_id,nome,descricao,preco,disponivel,deletado_em").eq("comercio_id", comercioId).in("id", ids).eq("disponivel", true).is("deletado_em", null),
      admin.from("catalogo_recebedores").select("comercio_id,status,conta_externa_id,oauth_access_token_enc,percentual_plataforma").eq("comercio_id", comercioId).maybeSingle(),
      admin.from("catalogo_pedidos").select("id,order_id,payment_id,status,status_pagamento,pix_codigo,pix_qr_code_base64,metadata").eq("idempotency_key", requestId).maybeSingle(),
    ]);
    if (catalogError || productError || receiverError || existingError) throw new Error("Falha ao validar o catálogo e o recebedor.");
    if (!catalog) throw new HttpError("Este catálogo não está disponível para pedidos.", 404);
    if (existing?.order_id) return json({ success: true, reused: true, pedido_id: existing.id, ...existing });
    if (!receiver || receiver.status !== "ativo" || !receiver.conta_externa_id || !receiver.oauth_access_token_enc) throw new HttpError("Este comércio ainda não está habilitado para receber Pix.", 409);
    const byId = new Map((products || []).map((product: Record<string, unknown>) => [String(product.id), product])); if (byId.size !== ids.length) throw new HttpError("Um produto não está mais disponível. Atualize o catálogo.");
    const items = ids.map((id) => { const product = byId.get(id)!; const unit = Math.round(Number(product.preco) * 100); if (!Number.isInteger(unit) || unit <= 0) throw new HttpError("Preço de produto inválido."); const quantity = requested.get(id)!; return { produto_id: id, nome_produto: text(product.nome, 120), descricao_produto: text(product.descricao, 600), preco_unitario_centavos: unit, quantidade: quantity, total_item_centavos: unit * quantity }; });
    const subtotal = items.reduce((sum, item) => sum + item.total_item_centavos, 0); const delivery = 0; const fee = Math.round(subtotal * 0.05); const total = subtotal + delivery;
    const token = await decrypt(String(receiver.oauth_access_token_enc));
    const { data: orderRow, error: orderError } = await admin.from("catalogo_pedidos").insert({ comercio_id: comercioId, referencia_externa: `guia-${requestId}`, idempotency_key: requestId, modalidade, forma_pagamento: "pix", subtotal_produtos_centavos: subtotal, entrega_centavos: delivery, total_centavos: total, taxa_plataforma_centavos: fee, repasse_bruto_comercio_centavos: subtotal - fee + delivery, cliente_nome: nome, cliente_email: email, cliente_telefone: telefone, cliente_endereco: endereco || null, cliente_numero: numero || null, cliente_bairro: bairro || null, cliente_complemento: complemento || null, cliente_referencia: referencia || null, cliente_cidade: "Andrelândia-MG", observacoes: observacoes || null, metadata: { checkout: "orders_api", marketplace_fee_centavos: fee } }).select("id").single();
    if (orderError || !orderRow) { if (orderError?.code === "23505") throw new HttpError("Esta tentativa de pedido já está sendo processada.", 409); throw new Error("Não foi possível reservar o pedido."); }
    let mpData: Record<string, unknown>;
    try {
      mpData = await mpOrder(token, { type: "online", total_amount: money(total), external_reference: `guia-${orderRow.id}`, description: `Pedido no catálogo ${comercioId}`, processing_mode: "automatic", marketplace_fee: money(fee), transactions: { payments: [{ amount: money(total), payment_method: { id: "pix", type: "bank_transfer" }, expiration_time: "PT24H" }] }, payer: { email } }, requestId);
    } catch (error) {
      await admin.from("catalogo_pedidos").delete().eq("id", orderRow.id).is("order_id", null);
      throw error;
    }
    const pix = orderPix(mpData);
    const { error: updateError } = await admin.from("catalogo_pedidos").update({ order_id: pix.order_id, payment_id: pix.payment_id || null, status: "aguardando_pagamento", status_pagamento: "pendente", pix_codigo: pix.pix_codigo, pix_qr_code_base64: pix.pix_qr_code_base64, pix_expira_em: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), metadata: { checkout: "orders_api", marketplace_fee_centavos: fee, status_detail: pix.status_detail } }).eq("id", orderRow.id);
    if (updateError) throw new Error("Pix criado, mas não foi possível registrar o pedido com segurança.");
    const { error: itemError } = await admin.from("catalogo_pedido_itens").insert(items.map((item) => ({ ...item, pedido_id: orderRow.id })));
    if (itemError) throw new Error("Pix criado, mas não foi possível registrar os itens do pedido com segurança.");
    return json({ success: true, pedido_id: orderRow.id, order_id: pix.order_id, payment_id: pix.payment_id, total_centavos: total, taxa_plataforma_centavos: fee, pix_codigo: pix.pix_codigo, pix_qr_code_base64: pix.pix_qr_code_base64, ticket_url: pix.ticket_url, status: pix.status, status_detail: pix.status_detail });
  } catch (error) { if (error instanceof HttpError) return json({ success: false, mensagem: error.message }, error.status); console.error("catalogo-pedido-pix failed:", (error as Error).message); return json({ success: false, mensagem: "Não foi possível criar o Pix. Nenhum pagamento foi confirmado." }, 500); }
});
