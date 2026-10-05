import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SECRET_KEYS = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";
const LEGACY_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OFFLINE_CHECKOUT_ENABLED = Deno.env.get("OFFLINE_CHECKOUT_ENABLED") === "true";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

let serviceKey = "";
try {
  const parsed = SUPABASE_SECRET_KEYS ? JSON.parse(SUPABASE_SECRET_KEYS) : null;
  serviceKey = parsed?.default || parsed?.service_role || "";
} catch {
  // O fallback mantém compatibilidade durante a rotação de secrets.
}
if (!serviceKey) serviceKey = LEGACY_SERVICE_ROLE_KEY;
const admin = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS }); }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown, max: number) { const result = typeof value === "string" ? value.trim() : ""; if (result.length > max) throw new HttpError("Um dos campos excede o limite permitido."); return result; }
function hash(value: string) { return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)).then((bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")); }
async function enforceRateLimit(rawKey: string) {
  const { data, error } = await admin.rpc("catalogo_offline_consumir_limite", { p_chave_hash: await hash(rawKey), p_limite: 10, p_janela_segundos: 60 });
  if (error) throw new Error("Não foi possível validar o limite de requisições.");
  if (data !== true) throw new HttpError("Muitas tentativas. Aguarde um minuto e tente novamente.", 429);
}
async function assertOfflineCommerceAuthorized(comercioId: string) {
  const { data, error } = await admin
    .from("catalogo_marketplace_testes")
    .select("comercio_id")
    .eq("comercio_id", comercioId)
    .eq("ativo", true)
    .maybeSingle();
  if (error) throw new Error("Falha ao validar autorização do comércio.");
  if (!data) throw new HttpError("Este comércio não está autorizado para o checkout offline.", 403);
}
function randomDigits() { const bytes = new Uint32Array(1); crypto.getRandomValues(bytes); return String(100000 + (bytes[0] % 900000)); }
function cents(value: unknown, label: string) { const amount = Number(value); if (!Number.isInteger(amount) || amount < 0 || amount > 999999999) throw new HttpError(`${label} inválido.`); return amount; }
function money(value: number) { return Math.round(value * 100); }
function validEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value) && value.length <= 180; }
const OFFLINE_METHODS = new Set(["dinheiro", "cartao_credito", "cartao_debito", "pagamento_entrega", "pagamento_local"]);

async function createOfflineOrder(body: Record<string, unknown>, rateKey: string) {
  await enforceRateLimit(rateKey);
  const comercioId = text(body.comercio_id, 180);
  const method = text(body.forma_pagamento, 40);
  if (!/^[a-z0-9-]{1,180}$/.test(comercioId) || !OFFLINE_METHODS.has(method)) throw new HttpError("Comércio ou forma de pagamento inválidos.");
  await assertOfflineCommerceAuthorized(comercioId);
  const client = record(body.cliente);
  const nome = text(client.nome, 140); const email = text(client.email, 180).toLowerCase(); const telefone = text(client.telefone, 40);
  const modalidade = text(body.modalidade, 30);
  if (!nome || !telefone || !validEmail(email)) throw new HttpError("Informe nome, telefone e e-mail válido.");
  if (!["entrega", "retirada", "consumo_local"].includes(modalidade)) throw new HttpError("Modalidade inválida.");
  const rawItems = Array.isArray(body.itens) ? body.itens : [];
  if (!rawItems.length || rawItems.length > 50) throw new HttpError("O pedido precisa ter itens válidos.");
  const requested = new Map<string, number>();
  for (const raw of rawItems) {
    const item = record(raw); const id = text(item.id, 80); const quantity = Number(item.quantidade);
    if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new HttpError("Produto ou quantidade inválidos.");
    requested.set(id, (requested.get(id) || 0) + quantity);
  }
  const ids = [...requested.keys()];
  const [{ data: catalog, error: catalogError }, { data: published, error: publishedError }, { data: products, error: productsError }] = await Promise.all([
    admin.from("catalogos").select("comercio_id,modalidades,metodos_pagamento,bloqueado").eq("comercio_id", comercioId).maybeSingle(),
    admin.from("catalogo_publicado").select("comercio_id").eq("comercio_id", comercioId).maybeSingle(),
    admin.from("catalogo_produtos").select("id,comercio_id,categoria_id,nome,descricao,preco,disponivel,deletado_em,catalogo_categorias!inner(ativa,deletado_em)").eq("comercio_id", comercioId).in("id", ids).eq("disponivel", true).is("deletado_em", null).eq("catalogo_categorias.ativa", true).is("catalogo_categorias.deletado_em", null),
  ]);
  if (catalogError || publishedError || productsError) throw new Error("Falha ao validar catálogo e produtos.");
  if (!published) throw new HttpError("Este catálogo não está publicado ou ativo.", 404);
  if (!catalog || catalog.bloqueado || !Array.isArray(catalog.modalidades) || !catalog.modalidades.includes(modalidade)) throw new HttpError("Este catálogo não aceita esta modalidade.", 409);
  if (!Array.isArray(catalog.metodos_pagamento) || !catalog.metodos_pagamento.includes(method)) throw new HttpError("Este comércio não aceita esta forma de pagamento.", 409);
  const byId = new Map((products || []).map((product: Record<string, unknown>) => [String(product.id), product]));
  if (byId.size !== ids.length) throw new HttpError("Um produto não está mais disponível. Atualize o catálogo.");
  const items = ids.map((id) => {
    const product = byId.get(id)!; const unit = money(Number(product.preco)); const quantity = requested.get(id)!;
    if (!Number.isInteger(unit) || unit <= 0) throw new HttpError("Preço de produto inválido.");
    return { produto_id: id, nome_produto: text(product.nome, 120), descricao_produto: text(product.descricao, 600), preco_unitario_centavos: unit, quantidade: quantity, total_item_centavos: unit * quantity };
  });
  const subtotal = items.reduce((sum, item) => sum + item.total_item_centavos, 0);
  const delivery = cents(body.entrega_centavos ?? 0, "Entrega");
  const fee = Math.round(subtotal * 0.05);
  const total = subtotal + delivery;
  const clienteToken = crypto.randomUUID();
  const code = randomDigits();
  const [clienteTokenHash, codeHash] = await Promise.all([hash(clienteToken), hash(code)]);
  const expiration = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const { data: order, error: orderError } = await admin.from("catalogo_pedidos").insert({
    comercio_id: comercioId, referencia_externa: `offline-${crypto.randomUUID()}`, provedor: "offline", idempotency_key: crypto.randomUUID(),
    status: "aguardando_pagamento", status_pagamento: "pendente", modalidade, forma_pagamento: method,
    subtotal_produtos_centavos: subtotal, entrega_centavos: delivery, total_centavos: total, taxa_plataforma_centavos: fee,
    repasse_bruto_comercio_centavos: subtotal - fee + delivery, cliente_nome: nome, cliente_email: email, cliente_telefone: telefone,
    cliente_endereco: text(client.endereco, 240) || null, cliente_numero: text(client.numero, 30) || null, cliente_bairro: text(client.bairro, 120) || null,
    cliente_complemento: text(client.complemento, 160) || null, cliente_referencia: text(client.referencia, 240) || null, cliente_cidade: "Andrelândia-MG",
    observacoes: text(body.observacoes, 1000) || null, cliente_token_hash: clienteTokenHash, codigo_entrega_hash: codeHash,
    codigo_entrega_expira_em: expiration, metadata: { checkout: "offline", taxa_fixa_percentual: 5, codigo_entrega: "hash_sha256" },
  }).select("id,comercio_id,status,forma_pagamento,subtotal_produtos_centavos,entrega_centavos,total_centavos,taxa_plataforma_centavos").single();
  if (orderError || !order) throw new Error("Não foi possível registrar o pedido offline.");
  const { error: itemsError } = await admin.from("catalogo_pedido_itens").insert(items.map((item) => ({ ...item, pedido_id: order.id })));
  if (itemsError) {
    await admin.from("catalogo_pedidos").update({ status: "cancelado", status_pagamento: "cancelado", motivo_cancelamento: "Falha ao registrar itens do pedido." }).eq("id", order.id);
    throw new Error("Não foi possível registrar os itens do pedido.");
  }
  // A comissão só nasce quando o código for validado e o pedido for concluído.
  // O código/token são entregues somente ao cliente nesta resposta; nunca são persistidos em claro.
  return json({ success: true, pedido_id: order.id, cliente_token: clienteToken, codigo_entrega: code, status: order.status, forma_pagamento: method, subtotal_centavos: subtotal, entrega_centavos: delivery, total_centavos: total, taxa_plataforma_centavos: fee, codigo_expira_em: expiration });
}

async function confirmDelivery(body: Record<string, unknown>, rateKey: string) {
  await enforceRateLimit(rateKey);
  const token = text(body.cliente_token, 100); const code = text(body.codigo_entrega, 20); const entregador = text(body.entregador, 120) || "não informado";
  if (!token || !/^\d{6}$/.test(code)) throw new HttpError("Código de entrega inválido.");
  const [tokenHash, codeHash] = await Promise.all([hash(token), hash(code)]);
  const { data, error } = await admin.rpc("catalogo_confirmar_pedido_offline", { p_cliente_token_hash: tokenHash, p_codigo_hash: codeHash, p_entregador: entregador });
  if (error) throw new Error("Falha ao validar o código de entrega.");
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.ok) {
    const message = String(result?.mensagem || "Não foi possível concluir o pedido.");
    const status = message.includes("não encontrado") ? 404 : message.includes("incorreto") ? 403 : message.includes("expirou") ? 410 : message.includes("Limite") ? 429 : 409;
    throw new HttpError(message, status);
  }
  return json({ success: true, pedido_id: result.pedido_id, status: result.status, status_pagamento: result.status_pagamento, comissao_registrada: true });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ success: false, mensagem: "Use POST." }, 405);
  if (!OFFLINE_CHECKOUT_ENABLED) return json({ success: false, mensagem: "O pagamento offline ainda não está habilitado." }, 503);
  try {
    const body = record(await request.json().catch(() => ({})));
    const action = text(body.acao, 40);
    const comercio = text(body.comercio_id, 180);
    const ip = (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim().slice(0, 120);
    if (action === "criar_pedido_offline") return await createOfflineOrder(body, `${ip}|${comercio}|create`);
    if (action === "confirmar_entrega") return await confirmDelivery(body, `${ip}|${text(body.cliente_token, 100)}|confirm`);
    return json({ success: false, mensagem: "Ação não reconhecida." }, 400);
  } catch (error) {
    if (error instanceof HttpError) return json({ success: false, mensagem: error.message }, error.status);
    console.error("catalogo-pedido-offline failed:", (error as Error).message);
    return json({ success: false, mensagem: "Não foi possível concluir o pedido offline." }, 500);
  }
});
