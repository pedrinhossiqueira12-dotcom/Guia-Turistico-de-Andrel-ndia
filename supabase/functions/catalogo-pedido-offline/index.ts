import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SECRET_KEYS = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";
const LEGACY_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OFFLINE_CHECKOUT_ENABLED = Deno.env.get("OFFLINE_CHECKOUT_ENABLED") === "true";
// Compartilhado com o PaymentAgent: chave MP_OAUTH_ENCRYPTION_KEY e AAD por pedido.
const COMPROVANTE_KEY = Deno.env.get("MP_OAUTH_ENCRYPTION_KEY") || Deno.env.get("CATALOGO_COMPROVANTE_KEY") || Deno.env.get("SUPABASE_COMPROVANTE_KEY") || "";
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_TOKEN_RE = /^[0-9a-f]{64}$/i;
const OFFLINE_METHODS = new Set(["dinheiro", "cartao_credito", "cartao_debito", "pagamento_entrega", "pagamento_local"]);
const STATUS_SELECT = "id,comercio_id,provedor,status,status_pagamento,versao_financeira,entrega_status,aceito_em,reembolso_pendente,concluido_em,codigo_entrega_usado_em,codigo_entrega_expira_em,codigo_entrega_tentativas,status_token_hash,codigo_entrega_enc,cliente_email";
const LEGACY_STATUS_SELECT = "id,comercio_id,provedor,status,status_pagamento,concluido_em,codigo_entrega_usado_em,codigo_entrega_expira_em,codigo_entrega_tentativas,status_token_hash,cliente_email";

class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS }); }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown, max: number) {
  const result = typeof value === "string" ? value.trim() : "";
  if (result.length > max) throw new HttpError("Um dos campos excede o limite permitido.");
  return result;
}
function hash(value: string) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)).then((bytes) =>
    [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  );
}
function equalHex(left: string, right: string) {
  const a = String(left || "").toLowerCase();
  const b = String(right || "").toLowerCase();
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
}
async function enforceRateLimit(rawKey: string) {
  const { data, error } = await admin.rpc("catalogo_offline_consumir_limite", {
    p_chave_hash: await hash(rawKey), p_limite: 10, p_janela_segundos: 60,
  });
  if (error) throw new Error("Não foi possível validar o limite de requisições.");
  if (data !== true) throw new HttpError("Muitas tentativas. Aguarde um minuto e tente novamente.", 429);
}
async function assertOfflineCommerceAuthorized(comercioId: string) {
  const [{ data: receiver, error: receiverError }, { data: catalog, error: catalogError }, { data: published, error: publishedError }] = await Promise.all([
    admin.from("catalogo_recebedores").select("comercio_id,status,conta_externa_id")
      .eq("comercio_id", comercioId).eq("status", "ativo").not("conta_externa_id", "is", null).maybeSingle(),
    admin.from("catalogos").select("comercio_id,bloqueado").eq("comercio_id", comercioId).maybeSingle(),
    admin.from("comercios_publicados").select("local_id,status").eq("local_id", comercioId).eq("status", "ativo").maybeSingle(),
  ]);

  if (receiverError || catalogError || publishedError) {
    console.error("Offline authorization lookup failed", { comercioId, receiver: receiverError?.message || null, catalog: catalogError?.message || null, published: publishedError?.message || null });
    throw new Error("Falha ao validar a conta Mercado Pago e o catálogo.");
  }
  if (!receiver) throw new HttpError("Conecte a conta Mercado Pago do comércio antes de aceitar pedidos.", 403);
  if (!catalog || catalog.bloqueado || !published) throw new HttpError("Este catálogo não está ativo para receber pedidos.", 403);
}
function randomDigits() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(100000 + (bytes[0] % 900000));
}
function randomStatusToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function cents(value: unknown, label: string) {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < 0 || amount > 999999999) throw new HttpError(`${label} inválido.`);
  return amount;
}
function money(value: number) { return Math.round(value * 100); }
function validEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value) && value.length <= 180; }
function isMissingColumn(error: unknown) {
  const item = record(error);
  return ["42703", "PGRST204", "PGRST205"].includes(String(item.code || "")) || /column .* does not exist|could not find the .* column/i.test(String(item.message || ""));
}
function firstRow(value: unknown): Record<string, unknown> {
  return Array.isArray(value) ? record(value[0]) : record(value);
}
function decodeKey(value: string) {
  if (/^[0-9a-f]{64}$/i.test(value)) return Uint8Array.from(value.match(/.{2}/g) || [], (pair) => Number.parseInt(pair, 16));
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "===";
    const binary = atob(normalized.slice(0, normalized.length - (normalized.length % 4)));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch { return new Uint8Array(); }
}
function base64Url(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function fromBase64(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "===";
  const binary = atob(normalized.slice(0, normalized.length - (normalized.length % 4)));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
async function encryptCode(code: string, pedidoId: string) {
  const raw = decodeKey(COMPROVANTE_KEY);
  if (raw.length !== 32) throw new HttpError("A proteção do comprovante ainda não está configurada. Nenhum pedido foi criado.", 503);
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = new TextEncoder().encode(`delivery-code-v2:${pedidoId}`);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, key, new TextEncoder().encode(code));
  return `${base64Url(iv)}.${base64Url(new Uint8Array(cipher))}`;
}
async function decryptCode(value: unknown, pedidoId: string) {
  const encoded = text(value, 500);
  if (!encoded || !encoded.includes(".")) return "";
  const raw = decodeKey(COMPROVANTE_KEY);
  if (raw.length !== 32) return "";
  try {
    const [ivEncoded, cipherEncoded] = encoded.split(".");
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    const additionalData = new TextEncoder().encode(`delivery-code-v2:${pedidoId}`);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(ivEncoded), additionalData }, key, fromBase64(cipherEncoded));
    const code = new TextDecoder().decode(plain);
    return /^\d{6}$/.test(code) ? code : "";
  } catch { return ""; }
}
async function priceOrder(modalidade: string, subtotal: number, comercioId: string) {
  const { data, error } = await admin.rpc("catalogo_fluxo_precificar", { p_modalidade: modalidade, p_subtotal_centavos: subtotal, p_comercio_id: comercioId });
  if (error) throw new Error("Não foi possível calcular o preço do pedido.");
  const priced = firstRow(data);
  if (priced.ok === false) throw new HttpError(String(priced.mensagem || "Modalidade não habilitada."), Number(priced.http_status) || 409);
  const version = Number(priced.versao_financeira);
  const platform = Number(priced.taxa_plataforma_centavos);
  const motoboy = Number(priced.taxa_motoboy_centavos);
  const totalFee = Number(priced.taxa_total_centavos);
  if (![version, platform, motoboy, totalFee].every(Number.isInteger) || version < 1 || platform < 0 || motoboy < 0 || totalFee < 0 || totalFee !== platform + motoboy) {
    throw new Error("A precificação do pedido retornou dados inválidos.");
  }
  return { versao_financeira: version, taxa_plataforma_centavos: platform, taxa_motoboy_centavos: motoboy, taxa_total_centavos: totalFee, somente_pix: priced.somente_pix === true, ativo: priced.ativo === true };
}
async function readOrder(pedidoId: string, comercioId: string) {
  const base = admin.from("catalogo_pedidos").select(STATUS_SELECT).eq("id", pedidoId).eq("comercio_id", comercioId).in("provedor", ["offline", "mercadopago", "pix"]).maybeSingle();
  const result = await base;
  if (!result.error) return result.data as Record<string, unknown> | null;
  if (!isMissingColumn(result.error)) throw new Error("Falha ao consultar estado do pedido.");
  const legacy = await admin.from("catalogo_pedidos").select(LEGACY_STATUS_SELECT).eq("id", pedidoId).eq("comercio_id", comercioId).in("provedor", ["offline", "mercadopago", "pix"]).maybeSingle();
  if (legacy.error) throw new Error("Falha ao consultar estado do pedido.");
  return legacy.data as Record<string, unknown> | null;
}
async function insertOrder(payload: Record<string, unknown>) {
  let result = await admin.from("catalogo_pedidos").insert(payload).select("id,comercio_id,provedor,status,status_pagamento,forma_pagamento,subtotal_produtos_centavos,entrega_centavos,total_centavos,taxa_plataforma_centavos,taxa_motoboy_centavos,taxa_total_centavos,versao_financeira,reembolso_pendente").single();
  if (result.error && isMissingColumn(result.error)) {
    const legacyPayload = { ...payload };
    ["versao_financeira", "taxa_motoboy_centavos", "taxa_total_centavos", "aceito_em", "reembolso_pendente", "codigo_entrega_enc"].forEach((key) => delete legacyPayload[key]);
    result = await admin.from("catalogo_pedidos").insert(legacyPayload).select("id,comercio_id,provedor,status,status_pagamento,forma_pagamento,subtotal_produtos_centavos,entrega_centavos,total_centavos,taxa_plataforma_centavos").single();
  }
  return result;
}
async function createOfflineOrder(body: Record<string, unknown>, rateKey: string) {
  if (decodeKey(COMPROVANTE_KEY).length !== 32) throw new HttpError("A proteção do comprovante ainda não está configurada. Nenhum pedido foi criado.", 503);
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
    if (!UUID_RE.test(id) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new HttpError("Produto ou quantidade inválidos.");
    requested.set(id, (requested.get(id) || 0) + quantity);
  }
  const ids = [...requested.keys()];
  const [{ data: catalog, error: catalogError }, { data: published, error: publishedError }, { data: products, error: productsError }] = await Promise.all([
    admin.from("catalogos").select("comercio_id,modalidades,metodos_pagamento,bloqueado").eq("comercio_id", comercioId).maybeSingle(),
    admin.from("comercios_publicados").select("local_id,status").eq("local_id", comercioId).eq("status", "ativo").maybeSingle(),
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
  // Compatibilidade v1 quando a configuração v2 está desligada: const fee = Math.round(subtotal * 0.05);
  const pricing = await priceOrder(modalidade, subtotal, comercioId);
  if (pricing.somente_pix && method !== "pix") throw new HttpError("Este fluxo está configurado para aceitar somente Pix.", 409);
  const code = randomDigits();
  const codeHash = await hash(code);
  const statusToken = randomStatusToken();
  const statusTokenHash = await hash(statusToken);
  const expiration = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const total = subtotal + delivery;
  const payload: Record<string, unknown> = {
    comercio_id: comercioId, referencia_externa: `offline-${crypto.randomUUID()}`, provedor: "offline", idempotency_key: crypto.randomUUID(),
    status: "aguardando_pagamento", status_pagamento: "pendente", modalidade, forma_pagamento: method,
    subtotal_produtos_centavos: subtotal, entrega_centavos: delivery, total_centavos: total,
    taxa_plataforma_centavos: pricing.taxa_plataforma_centavos, taxa_motoboy_centavos: pricing.taxa_motoboy_centavos, taxa_total_centavos: pricing.taxa_total_centavos,
    repasse_bruto_comercio_centavos: subtotal - pricing.taxa_total_centavos + delivery,
    cliente_nome: nome, cliente_email: email, cliente_telefone: telefone,
    cliente_endereco: text(client.endereco, 240) || null, cliente_numero: text(client.numero, 30) || null, cliente_bairro: text(client.bairro, 120) || null,
    cliente_complemento: text(client.complemento, 160) || null, cliente_referencia: text(client.referencia, 240) || null, cliente_cidade: "Andrelândia-MG",
    observacoes: text(body.observacoes, 1000) || null, codigo_entrega_hash: codeHash, status_token_hash: statusTokenHash,
    codigo_entrega_expira_em: expiration, codigo_entrega_enc: null, versao_financeira: pricing.versao_financeira,
    reembolso_pendente: false,
    metadata: { checkout: "offline", versao_financeira: pricing.versao_financeira, taxa_plataforma_centavos: pricing.taxa_plataforma_centavos, taxa_motoboy_centavos: pricing.taxa_motoboy_centavos, taxa_total_centavos: pricing.taxa_total_centavos, codigo_entrega: "hash_sha256", status_token: "hash_sha256" },
  };
  const { data: order, error: orderError } = await insertOrder(payload);
  if (orderError || !order) throw new Error("Não foi possível registrar o pedido offline.");
  const encryptedCode = await encryptCode(code, String(order.id));
  if (encryptedCode) {
    const { error: receiptError } = await admin.from("catalogo_pedidos").update({ codigo_entrega_enc: encryptedCode }).eq("id", order.id);
    if (receiptError) {
      await admin.from("catalogo_pedidos").update({ status: "cancelado", status_pagamento: "cancelado", motivo_cancelamento: "Falha ao proteger comprovante recuperável." }).eq("id", order.id);
      throw new Error("Não foi possível proteger o comprovante do pedido.");
    }
  }
  const { error: itemsError } = await admin.from("catalogo_pedido_itens").insert(items.map((item) => ({ ...item, pedido_id: order.id })));
  if (itemsError) {
    await admin.from("catalogo_pedidos").update({ status: "cancelado", status_pagamento: "cancelado", motivo_cancelamento: "Falha ao registrar itens do pedido." }).eq("id", order.id);
    throw new Error("Não foi possível registrar os itens do pedido.");
  }
  return json({ success: true, pedido_id: order.id, provedor: "offline", codigo_entrega: code, status_token: statusToken, status: order.status, status_pagamento: order.status_pagamento, aceito_em: null, reembolso_pendente: false, codigo_ativo: true, concluido: false, forma_pagamento: method, subtotal_centavos: subtotal, entrega_centavos: delivery, total_centavos: total, taxa_plataforma_centavos: pricing.taxa_plataforma_centavos, taxa_motoboy_centavos: pricing.taxa_motoboy_centavos, taxa_total_centavos: pricing.taxa_total_centavos, versao_financeira: pricing.versao_financeira, codigo_expira_em: expiration });
}
async function legacyViewer(request: Request, comercioId: string, order: Record<string, unknown>) {
  const jwt = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!jwt) return false;
  const { data, error: authError } = await admin.auth.getUser(jwt);
  const viewer = !authError ? data?.user : null;
  if (!viewer) return false;
  const buyerEmail = Boolean(viewer.email && order.cliente_email && viewer.email_confirmed_at && String(viewer.email).toLowerCase() === String(order.cliente_email).toLowerCase());
  const { data: catalog, error: ownerError } = await admin.from("catalogos").select("proprietario_id").eq("comercio_id", comercioId).maybeSingle();
  if (ownerError) throw new Error("Falha ao validar identidade do comprador.");
  return buyerEmail || catalog?.proprietario_id === viewer.id || viewer.id === "4b9a0233-6b72-4573-aebd-d596c5b15e1b";
}
async function orderStatus(body: Record<string, unknown>, request: Request, ip: string) {
  const comercioId = text(body.comercio_id, 180); const pedidoId = text(body.pedido_id, 36); const token = text(body.status_token, 80);
  if (!/^[a-z0-9-]{1,180}$/.test(comercioId) || !UUID_RE.test(pedidoId)) throw new HttpError("Pedido inválido.");
  if (token && !STATUS_TOKEN_RE.test(token)) throw new HttpError("Consulta não autorizada.", 403);
  await enforceRateLimit(`${ip}|${comercioId}|${pedidoId}|status`);
  const order = await readOrder(pedidoId, comercioId);
  const strongToken = STATUS_TOKEN_RE.test(token);
  let allowed = Boolean(order && strongToken && await hash(token).then((digest) => equalHex(digest, String(order.status_token_hash || ""))));
  if (!token && order && Number(order.versao_financeira || 1) === 1 && !order.status_token_hash) allowed = await legacyViewer(request, comercioId, order);
  if (!allowed || !order) throw new HttpError("Consulta não autorizada.", 403);
  const concluded = order.status === "entregue" || Boolean(order.concluido_em || order.codigo_entrega_usado_em);
  const accepted = Boolean(order.aceito_em) || ["reservado", "coletado", "em_entrega"].includes(String(order.entrega_status || ""));
  const expired = !order.codigo_entrega_expira_em || Date.parse(String(order.codigo_entrega_expira_em)) <= Date.now();
  const attempts = Number(order.codigo_entrega_tentativas || 0);
  const isOffline = order.provedor === "offline";
  const paid = ["aprovado", "approved"].includes(String(order.status_pagamento || "").toLowerCase());
  const active = !concluded && order.status !== "cancelado" && !expired && attempts < 5 && (isOffline || paid);
  const response: Record<string, unknown> = {
    success: true, pedido_id: order.id, provedor: order.provedor, status: order.status, status_pagamento: order.status_pagamento,
    aceito_em: order.aceito_em || null, reembolso_pendente: order.reembolso_pendente === true, codigo_ativo: active, concluido: concluded, codigo_expira_em: order.codigo_entrega_expira_em || null,
  };
  // O owner/admin pode acompanhar estado legado, mas nunca recebe o código. Só o token forte pode recuperá-lo.
  if (strongToken && active) {
    const code = await decryptCode(order.codigo_entrega_enc, String(order.id));
    if (code) response.codigo_entrega = code;
  }
  return json(response);
}
async function cancelOrder(body: Record<string, unknown>, ip: string) {
  const comercioId = text(body.comercio_id, 180); const pedidoId = text(body.pedido_id, 36); const token = text(body.status_token, 80); const motivo = text(body.motivo, 500);
  if (!/^[a-z0-9-]{1,180}$/.test(comercioId) || !UUID_RE.test(pedidoId)) throw new HttpError("Pedido inválido.");
  if (!STATUS_TOKEN_RE.test(token)) throw new HttpError("Cancelamento não autorizado.", 403);
  await enforceRateLimit(`${ip}|${comercioId}|${pedidoId}|cancel`);
  const order = await readOrder(pedidoId, comercioId);
  if (!order || !["offline", "mercadopago", "pix"].includes(String(order.provedor || ""))) throw new HttpError("Cancelamento não autorizado.", 403);
  const tokenHash = await hash(token);
  const { data, error } = await admin.rpc("catalogo_cancelar_comprador_v2", { p_pedido_id: pedidoId, p_status_token_hash: tokenHash, p_motivo: motivo || null });
  if (error) {
    console.error("Buyer cancellation RPC failed", { code: error.code || null });
    throw new Error("Não foi possível solicitar o cancelamento.");
  }
  const result = firstRow(data);
  if (result.ok !== true) throw new HttpError(String(result.mensagem || "Este pedido não pode ser cancelado."), Number(result.http_status) || 409);
  return json({ success: true, pedido_id: pedidoId, status: result.status || "cancelado", status_pagamento: result.status_pagamento || order.status_pagamento, aceito_em: result.aceito_em || order.aceito_em || null, reembolso_pendente: result.reembolso_pendente === true || order.status_pagamento === "aprovado", codigo_ativo: false, concluido: false });
}
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ success: false, mensagem: "Use POST." }, 405);
  try {
    const body = record(await request.json().catch(() => ({})));
    const action = text(body.acao, 40);
    const comercio = text(body.comercio_id, 180);
    const ip = (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim().slice(0, 120);
    if (action === "consultar_status") return await orderStatus(body, request, ip);
    if (action === "cancelar_pedido") return await cancelOrder(body, ip);
    if (action === "criar_pedido_offline") {
      if (!OFFLINE_CHECKOUT_ENABLED) return json({ success: false, mensagem: "O pagamento offline ainda não está habilitado." }, 503);
      return await createOfflineOrder(body, `${ip}|${comercio}|create`);
    }
    if (action === "confirmar_entrega") return json({ success: false, mensagem: "A confirmação deve ser feita pelo painel autenticado do comércio." }, 410);
    return json({ success: false, mensagem: "Ação não reconhecida." }, 400);
  } catch (error) {
    if (error instanceof HttpError) return json({ success: false, mensagem: error.message }, error.status);
    console.error("catalogo-pedido-offline failed:", error instanceof Error ? error.message : String(error));
    return json({ success: false, mensagem: "Não foi possível concluir o pedido offline." }, 500);
  }
});
