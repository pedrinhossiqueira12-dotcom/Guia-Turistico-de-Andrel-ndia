import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import {
  amountToCents, centsToMoney, decryptAesGcm, encryptAesGcm,
  extractPixArtifacts, extractProviderPayment, normalizeFinancialSnapshot,
  providerFactsError, randomDeliveryCode, randomHex, sanitizedProviderId, sha256Hex, uuidFromParts,
} from "../_shared/catalogo-pagamentos-v2.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const MP_OAUTH_ENCRYPTION_KEY = Deno.env.get("MP_OAUTH_ENCRYPTION_KEY") ?? "";
const MARKETPLACE_CHECKOUT_ENABLED = Deno.env.get("MARKETPLACE_CHECKOUT_ENABLED") === "true";
const MP_API = "https://api.mercadopago.com";
const CODE_TTL_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
};
let serviceKey = "";
try {
  const parsed = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "null");
  serviceKey = parsed?.default || parsed?.service_role || "";
} catch { /* Compatibilidade com rotação de secrets. */ }
if (!serviceKey) serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const ORDER_FIELDS = "id,comercio_id,referencia_externa,idempotency_key,payment_id,order_id,status,status_pagamento,modalidade,subtotal_produtos_centavos,entrega_centavos,total_centavos,versao_financeira,taxa_plataforma_centavos,taxa_motoboy_centavos,taxa_total_centavos,codigo_entrega_hash,codigo_entrega_enc,codigo_entrega_expira_em,status_token_hash,pix_codigo,pix_qr_code_base64,pix_expira_em,cancelado_em,aceito_em,metadata";
type Row = Record<string, unknown>;
type FrozenItem = { id: string; pedido_id: string; produto_id: string; nome_produto: string; descricao_produto: string; preco_unitario_centavos: number; quantidade: number; total_item_centavos: number };
class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
function json(data: unknown, status = 200): Response { return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS }); }
function record(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function text(value: unknown, max: number): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (result.length > max) throw new HttpError("Um dos campos excede o limite permitido.");
  return result;
}
function cents(value: unknown, label: string, positive = false): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < (positive ? 1 : 0) || result > 2147483647) throw new HttpError(`${label} inválido.`);
  return result;
}
function snapshotFromOrder(order: Row) {
  const metadata = record(order.metadata);
  return normalizeFinancialSnapshot({
    versao_financeira: order.versao_financeira ?? metadata.versao_financeira ?? 1,
    taxa_plataforma_centavos: order.taxa_plataforma_centavos ?? metadata.taxa_plataforma_centavos,
    taxa_motoboy_centavos: order.taxa_motoboy_centavos ?? metadata.taxa_motoboy_centavos ?? 0,
    taxa_total_centavos: order.taxa_total_centavos ?? metadata.taxa_total_centavos ?? order.taxa_plataforma_centavos,
    somente_pix: metadata.somente_pix === true, ativo: Number(order.versao_financeira) === 2,
  }, String(order.modalidade), Number(order.subtotal_produtos_centavos));
}
async function locateOrder(comercioId: string, key: string): Promise<Row | null> {
  const { data, error } = await admin.from("catalogo_pedidos").select(ORDER_FIELDS).eq("comercio_id", comercioId).eq("idempotency_key", key).maybeSingle();
  if (error) throw new HttpError("Falha ao localizar tentativa de pedido.", 503);
  return data ? record(data) : null;
}
async function readOrder(pedidoId: string, comercioId: string): Promise<Row> {
  const { data, error } = await admin.from("catalogo_pedidos").select(ORDER_FIELDS).eq("id", pedidoId).eq("comercio_id", comercioId).single();
  if (error || !data) throw new HttpError("Conciliação local pendente. Tente novamente.", 503);
  return record(data);
}
function assertIdentity(order: Row, comercioId: string, requestId: string, identityHash: string, fingerprint: string) {
  const metadata = record(order.metadata);
  if (order.comercio_id !== comercioId || metadata.request_id !== requestId || metadata.buyer_identity_hash !== identityHash) throw new HttpError("Pedido não localizado para esta identidade.", 404);
  if (metadata.request_fingerprint !== fingerprint) throw new HttpError("A tentativa já foi usada com outros dados. Inicie uma nova tentativa.", 409);
}
async function secretsFor(order: Row, comercioId: string, requestId: string, identityHash: string, fingerprint: string) {
  assertIdentity(order, comercioId, requestId, identityHash, fingerprint);
  const pedidoId = String(order.id);
  const metadata = record(order.metadata);
  try {
    const code = await decryptAesGcm(String(order.codigo_entrega_enc || ""), MP_OAUTH_ENCRYPTION_KEY, `delivery-code-v2:${pedidoId}`);
    const statusToken = await decryptAesGcm(String(metadata.status_token_enc || ""), MP_OAUTH_ENCRYPTION_KEY, `catalogo-pedido-pix:status:${comercioId}:${pedidoId}`);
    if (!/^\d{6}$/.test(code) || !/^[a-f0-9]{64}$/.test(statusToken) || await sha256Hex(code) !== order.codigo_entrega_hash || await sha256Hex(statusToken) !== order.status_token_hash) throw new Error("Prova inválida");
    return { code, statusToken };
  } catch { throw new HttpError("Não foi possível recuperar com segurança os dados do pedido.", 503); }
}
function contractFields(order: Row, secrets: { code: string; statusToken: string }) {
  const snapshot = snapshotFromOrder(order);
  return {
    success: true, pedido_id: String(order.id), payment_id: order.payment_id ? String(order.payment_id) : null,
    pix_codigo: String(order.pix_codigo || ""), pix_qr_code_base64: String(order.pix_qr_code_base64 || ""),
    status_token: secrets.statusToken, codigo_entrega: secrets.code,
    codigo_expira_em: String(order.codigo_entrega_expira_em || ""),
    status: String(order.status), status_pagamento: String(order.status_pagamento),
    versao_financeira: snapshot.versao_financeira, total_centavos: Number(order.total_centavos),
    taxa_plataforma_centavos: snapshot.taxa_plataforma_centavos, taxa_motoboy_centavos: snapshot.taxa_motoboy_centavos, taxa_total_centavos: snapshot.taxa_total_centavos,
  };
}
async function snapshotForOrder(subtotal: number, modalidade: string, comercioId: string) {
  const { data, error } = await admin.rpc("catalogo_fluxo_precificar", { p_modalidade: modalidade, p_subtotal_centavos: subtotal, p_comercio_id: comercioId });
  if (error) throw new HttpError("Não foi possível obter o snapshot financeiro.", 503);
  const result = record(data);
  if (result.ok === false) throw new HttpError(String(result.mensagem || "Snapshot financeiro recusado."), Number(result.http_status) || 409);
  return normalizeFinancialSnapshot(data, modalidade, subtotal);
}
async function validateCatalog(comercioId: string, modalidade: string, ids: string[]) {
  const [{ data: catalog, error: catalogError }, { data: published, error: publishedError }, { data: products, error: productError }] = await Promise.all([
    admin.from("catalogos").select("comercio_id,modalidades,metodos_pagamento,bloqueado").eq("comercio_id", comercioId).maybeSingle(),
    admin.from("catalogo_publicado").select("comercio_id,modalidades,metodos_pagamento").eq("comercio_id", comercioId).maybeSingle(),
    admin.from("catalogo_produtos").select("id,comercio_id,categoria_id,nome,descricao,preco,disponivel,deletado_em,catalogo_categorias!inner(ativa,deletado_em)")
      .eq("comercio_id", comercioId).in("id", ids).eq("disponivel", true).is("deletado_em", null).eq("catalogo_categorias.ativa", true).is("catalogo_categorias.deletado_em", null),
  ]);
  if (catalogError || publishedError || productError) throw new HttpError("Falha ao validar catálogo e produtos.", 503);
  const c = record(catalog), p = record(published);
  const modes = Array.isArray(c.modalidades) ? c.modalidades : (Array.isArray(p.modalidades) ? p.modalidades : []);
  const methods = Array.isArray(c.metodos_pagamento) ? c.metodos_pagamento : (Array.isArray(p.metodos_pagamento) ? p.metodos_pagamento : []);
  if (!catalog || !published || c.bloqueado || !modes.includes(modalidade) || !methods.includes("pix")) throw new HttpError("Este catálogo não aceita esta modalidade ou Pix.", 409);
  const byId = new Map((Array.isArray(products) ? products : []).map((product: Row) => [String(product.id), product]));
  if (byId.size !== ids.length) throw new HttpError("Um produto ou categoria não está mais disponível. Atualize o catálogo.");
  return byId;
}
async function receiverFor(comercioId: string) {
  const { data, error } = await admin.from("catalogo_recebedores").select("comercio_id,status,conta_externa_id,oauth_access_token_enc").eq("comercio_id", comercioId).maybeSingle();
  const receiver = record(data);
  if (error) throw new HttpError("Falha ao validar o recebedor Mercado Pago.", 503);
  if (!data || receiver.status !== "ativo" || !receiver.conta_externa_id || !receiver.oauth_access_token_enc) throw new HttpError("Este comércio ainda não está habilitado para receber Pix.", 409);
  return { token: await decryptAesGcm(String(receiver.oauth_access_token_enc), MP_OAUTH_ENCRYPTION_KEY), conta: String(receiver.conta_externa_id) };
}
// Compare-and-swap de JSONB evita sobrescrever metadados adicionados por conciliação concorrente.
// Este caminho NÃO modifica status físico/financeiro, nem snapshots, códigos ou idempotência.
async function persistProviderArtifact(pedidoId: string, comercioId: string, patch: Row, metadataPatch: Row): Promise<Row> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const current = await readOrder(pedidoId, comercioId);
    if (patch.payment_id && current.payment_id && patch.payment_id !== current.payment_id) throw new HttpError("Identificador do pagamento divergente.", 409);
    const oldMetadata = record(current.metadata);
    let query = admin.from("catalogo_pedidos").update({ ...patch, metadata: { ...oldMetadata, ...metadataPatch } })
      .eq("id", pedidoId).eq("comercio_id", comercioId).eq("metadata", JSON.stringify(oldMetadata));
    query = current.payment_id ? query.eq("payment_id", current.payment_id) : query.is("payment_id", null);
    const { data, error } = await query.select(ORDER_FIELDS).maybeSingle();
    if (error) throw new HttpError("Conciliação local pendente. Tente novamente com a mesma tentativa.", 503);
    if (data) return record(data);
  }
  throw new HttpError("Pedido em conciliação concorrente. Tente novamente.", 503);
}
function frozenItems(order: Row): FrozenItem[] {
  const metadata = record(order.metadata);
  if (!Array.isArray(metadata.items_snapshot) || !metadata.items_snapshot.length) throw new HttpError("Snapshot dos itens ausente; não foi criada nova cobrança.", 409);
  const items = metadata.items_snapshot.map((value) => record(value) as unknown as FrozenItem);
  let subtotal = 0;
  for (const item of items) {
    if (!UUID.test(item.id) || item.pedido_id !== order.id || !UUID.test(item.produto_id) || !item.nome_produto || item.nome_produto.length > 120 || item.descricao_produto.length > 600) throw new HttpError("Snapshot dos itens inválido.", 409);
    cents(item.preco_unitario_centavos, "Preço", true); cents(item.total_item_centavos, "Item", true);
    if (!Number.isInteger(item.quantidade) || item.quantidade < 1 || item.quantidade > 99 || item.total_item_centavos !== item.preco_unitario_centavos * item.quantidade) throw new HttpError("Quantidade ou valor do item divergente.", 409);
    subtotal += item.total_item_centavos;
  }
  if (cents(subtotal, "Subtotal", true) !== order.subtotal_produtos_centavos || new Set(items.map((i) => i.id)).size !== items.length) throw new HttpError("Snapshot dos itens divergente.", 409);
  return items;
}
async function ensureItems(order: Row): Promise<void> {
  const items = frozenItems(order);
  // Um único INSERT bulk é transacional no PostgREST. IDs determinísticos + DO NOTHING
  // recuperam falha e concorrência sem apagar ou regenerar itens já cobrados.
  if (!order.payment_id) {
    const { error } = await admin.from("catalogo_pedido_itens").upsert(items, { onConflict: "id", ignoreDuplicates: true });
    if (error) {
      await persistProviderArtifact(String(order.id), String(order.comercio_id), {}, { itens_registro_pendente: true });
      throw new HttpError("Não foi possível registrar os itens. Repita a mesma tentativa; nenhuma nova cobrança foi criada.", 503);
    }
  }
  const { data, error: readError } = await admin.from("catalogo_pedido_itens").select("id,pedido_id,produto_id,nome_produto,descricao_produto,preco_unitario_centavos,quantidade,total_item_centavos").eq("pedido_id", order.id);
  const saved = Array.isArray(data) ? data.map(record) : [];
  const fields = ["id", "pedido_id", "produto_id", "nome_produto", "descricao_produto", "preco_unitario_centavos", "quantidade", "total_item_centavos"];
  if (readError || saved.length !== items.length || items.some((item) => !saved.some((row) => fields.every((key) => row[key] === (item as unknown as Row)[key])))) throw new HttpError("Itens incompletos ou divergentes; nenhuma nova cobrança foi criada.", 503);
}
function assertNotCanceled(order: Row) {
  if (["cancelado", "expirado", "estornado", "contestado"].includes(String(order.status)) || ["cancelado", "expirado", "estornado", "contestado", "recusado"].includes(String(order.status_pagamento)) || order.cancelado_em) throw new HttpError("Este pedido foi encerrado. Inicie uma nova tentativa.", 409);
}
async function providerGet(token: string, id: string): Promise<Row> {
  const response = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  const data = record(await response.json().catch(() => ({})));
  if (!response.ok) throw new HttpError("Não foi possível verificar o pagamento no Mercado Pago. Repita a mesma tentativa.", 503);
  return data;
}
async function fetchPayment(token: string, payload: Row, idempotencyKey: string): Promise<{ id: string; data: Row }> {
  const response = await fetch(`${MP_API}/v1/payments`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json", "X-Idempotency-Key": idempotencyKey },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
  });
  const data = record(await response.json().catch(() => ({})));
  const id = sanitizedProviderId(data.id);
  if (!id) throw new HttpError("O Mercado Pago não confirmou a criação do Pix. Repita a mesma tentativa.", response.status === 429 ? 503 : 502);
  // Nem HTTP 2xx nem um id em HTTP erro provam pagamento: sempre verificar GET.
  return { id, data: await providerGet(token, id) };
}
async function reconcileVerified(order: Row, provider: Row, id: string, collector: string): Promise<boolean> {
  const facts = extractProviderPayment(provider, "payment");
  const mismatch = providerFactsError(facts, id, String(order.referencia_externa || `guia-${order.id}`), collector, Number(order.total_centavos));
  if (mismatch) throw new HttpError(mismatch, 409);
  const expectedFee = cents(order.taxa_total_centavos, "Taxa");
  const feeMismatch = facts.feeCentavos !== null && facts.feeCentavos !== expectedFee;
  if (feeMismatch) await persistProviderArtifact(String(order.id), String(order.comercio_id), {}, {
    provider_fee_review: { motivo: "taxa_divergente", esperado_centavos: expectedFee, observado_centavos: facts.feeCentavos, payment_id: facts.id, verificado_em: new Date().toISOString() },
  });
  if (facts.state !== "pendente" || feeMismatch) {
    const rpcStatus = facts.state === "contestado" ? "charged_back" : facts.state === "estornado" ? "estornado" : feeMismatch ? "revisao_parcial" : facts.state === "expirado" ? "cancelado" : facts.state;
    // Taxa divergente não é prova de financiamento. O fato observado fica auditado acima;
    // null permite ao RPC congelar/reverter sem fabricar retenção do snapshot.
    const { data, error } = await admin.rpc("catalogo_aplicar_pagamento_v2", { p_pedido_id: order.id, p_status: rpcStatus, p_valor_centavos: facts.amountCentavos, p_taxa_centavos: feeMismatch ? null : facts.feeCentavos, p_referencia: facts.id });
    if (error) throw new HttpError("Conciliação financeira pendente. Repita a mesma tentativa.", 503);
    const result = record(data);
    if (result.ok !== true) throw new HttpError(String(result.mensagem || "Conciliação financeira recusada."), Number(result.http_status) || 409);
  }
  if (feeMismatch) throw new HttpError("Taxa divergente; pagamento encaminhado para revisão financeira, sem declarar saldo disponível.", 409);
  if (!["pendente", "aprovado"].includes(facts.state)) throw new HttpError("Pagamento encerrado ou em revisão financeira.", 409);
  return facts.state === "aprovado";
}
async function createPix(body: Row, request: Request): Promise<Response> {
  if (!MARKETPLACE_CHECKOUT_ENABLED) throw new HttpError("O checkout de pedidos permanece desligado até a conclusão dos testes.", 503);
  const comercioId = text(body.comercio_id, 180).toLowerCase();
  const requestId = text(body.request_id, 80).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,179}$/.test(comercioId) || !REQUEST_UUID.test(requestId)) throw new HttpError("Comércio ou identificador aleatório da tentativa inválidos.");
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const { data: allowed, error: limitError } = await admin.rpc("catalogo_offline_consumir_limite", { p_chave_hash: await sha256Hex(`pix:${comercioId}:${ip}`), p_limite: 15, p_janela_segundos: 60 });
  if (limitError) throw new HttpError("Proteção temporariamente indisponível.", 503);
  if (allowed !== true) throw new HttpError("Muitas tentativas. Aguarde antes de tentar novamente.", 429);
  const cliente = record(body.cliente);
  const nome = text(cliente.nome, 140), email = text(cliente.email, 180).toLowerCase(), telefone = text(cliente.telefone, 40);
  const modalidade = text(body.modalidade, 30), formaPagamento = text(body.forma_pagamento || "pix", 30).toLowerCase();
  const endereco = text(cliente.endereco, 240), numero = text(cliente.numero, 30), bairro = text(cliente.bairro, 120);
  const complemento = text(cliente.complemento, 160), referencia = text(cliente.referencia, 240), observacoes = text(body.observacoes, 1000);
  if (!nome || telefone.length < 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email) || formaPagamento !== "pix") throw new HttpError("Informe comprador, telefone, e-mail válido e Pix.");
  if (!["entrega", "retirada", "consumo_local"].includes(modalidade)) throw new HttpError("Modalidade inválida.");
  if (modalidade === "entrega" && (!endereco || !numero || !bairro)) throw new HttpError("Para entrega, informe endereço, número e bairro.");
  // Catálogos atuais não definem frete. O backend cobra zero; o caller não decide a parcela.
  const delivery = 0;
  if (cents(body.entrega_centavos ?? 0, "Entrega") !== delivery) throw new HttpError("Frete não configurado pelo comércio; entrega deve ser zero.");
  const rawItems = Array.isArray(body.itens) ? body.itens : [];
  if (!rawItems.length || rawItems.length > 50) throw new HttpError("O pedido precisa ter itens válidos.");
  const requested = new Map<string, number>();
  for (const raw of rawItems) {
    const item = record(raw), id = text(item.id, 80).toLowerCase(), quantity = Number(item.quantidade);
    if (!UUID.test(id) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new HttpError("Produto ou quantidade inválidos.");
    const sum = (requested.get(id) || 0) + quantity;
    if (sum > 99) throw new HttpError("Quantidade acumulada do produto excede 99.");
    requested.set(id, sum);
  }
  const ids = [...requested.keys()].sort();
  const identityHash = await sha256Hex(`${email}|${telefone.replace(/\D/g, "") || telefone}`);
  const fingerprint = await sha256Hex(JSON.stringify({ itens: ids.map((id) => [id, requested.get(id)]), modalidade, delivery, nome, email, telefone, endereco, numero, bairro, complemento, referencia, observacoes }));
  // Raiz independente do modelo da API e do snapshot: retries não mudam a idempotência MP.
  const idempotencyKey = await uuidFromParts("catalogo-pix", comercioId, requestId, identityHash);
  let order = await locateOrder(comercioId, idempotencyKey);
  if (order) assertIdentity(order, comercioId, requestId, identityHash, fingerprint);
  if (!order) {
    const byId = await validateCatalog(comercioId, modalidade, ids);
    const pedidoId = crypto.randomUUID();
    const items: FrozenItem[] = [];
    for (const id of ids) {
      const product = byId.get(id)!, category = record(product.catalogo_categorias);
      if (product.comercio_id !== comercioId || category.ativa !== true || category.deletado_em) throw new HttpError("Categoria de produto inválida.");
      const unit = amountToCents(product.preco), quantity = requested.get(id)!;
      if (unit === null) throw new HttpError("Preço de produto inválido.");
      cents(unit, "Preço", true); cents(unit * quantity, "Item", true);
      const productName = text(product.nome, 120);
      if (!productName) throw new HttpError("Nome de produto inválido.");
      items.push({ id: await uuidFromParts("catalogo-pix-item", pedidoId, id), pedido_id: pedidoId, produto_id: id, nome_produto: productName, descricao_produto: text(product.descricao, 600), preco_unitario_centavos: unit, quantidade: quantity, total_item_centavos: unit * quantity });
    }
    const subtotal = cents(items.reduce((sum, item) => sum + item.total_item_centavos, 0), "Subtotal", true);
    const total = cents(subtotal + delivery, "Total", true), snapshot = await snapshotForOrder(subtotal, modalidade, comercioId);
    cents(snapshot.taxa_total_centavos, "Taxa");
    const code = randomDeliveryCode(), statusToken = randomHex(32), expiration = new Date(Date.now() + CODE_TTL_MS).toISOString();
    const metadata = {
      checkout: "payments_api", api_model: "payments_v1", request_id: requestId, buyer_identity_hash: identityHash, request_fingerprint: fingerprint,
      ...snapshot, application_fee_centavos: snapshot.taxa_total_centavos,
      provider_idempotency_key: idempotencyKey,
      provider_payload: {
        transaction_amount: Number(centsToMoney(total)), description: `Pedido no catálogo ${comercioId}`, payment_method_id: "pix", payer: { email },
        external_reference: `guia-${pedidoId}`, application_fee: Number(centsToMoney(snapshot.taxa_total_centavos)),
        notification_url: `${SUPABASE_URL}/functions/v1/mercadopago-marketplace-webhook`,
        metadata: { pedido_id: pedidoId, comercio_id: comercioId, versao_financeira: snapshot.versao_financeira, modelo_api: "payments_v1", application_fee_centavos: snapshot.taxa_total_centavos },
      },
      items_snapshot: items, itens_registro_pendente: true,
      status_token_enc: await encryptAesGcm(statusToken, MP_OAUTH_ENCRYPTION_KEY, `catalogo-pedido-pix:status:${comercioId}:${pedidoId}`), code_storage: "aes-gcm-aad-pedido",
    };
    const { data, error } = await admin.from("catalogo_pedidos").insert({
      id: pedidoId, comercio_id: comercioId, referencia_externa: `guia-${pedidoId}`, provedor: "mercadopago", idempotency_key: idempotencyKey,
      status: "aguardando_pagamento", status_pagamento: "pendente", modalidade, forma_pagamento: "pix",
      subtotal_produtos_centavos: subtotal, entrega_centavos: delivery, total_centavos: total,
      versao_financeira: snapshot.versao_financeira, taxa_plataforma_centavos: snapshot.taxa_plataforma_centavos,
      taxa_motoboy_centavos: snapshot.taxa_motoboy_centavos, taxa_total_centavos: snapshot.taxa_total_centavos,
      repasse_bruto_comercio_centavos: cents(subtotal - snapshot.taxa_total_centavos + delivery, "Repasse"),
      cliente_nome: nome, cliente_email: email, cliente_telefone: telefone, cliente_endereco: endereco || null, cliente_numero: numero || null,
      cliente_bairro: bairro || null, cliente_complemento: complemento || null, cliente_referencia: referencia || null, cliente_cidade: "Andrelândia-MG", observacoes: observacoes || null,
      status_token_hash: await sha256Hex(statusToken), codigo_entrega_hash: await sha256Hex(code),
      codigo_entrega_enc: await encryptAesGcm(code, MP_OAUTH_ENCRYPTION_KEY, `delivery-code-v2:${pedidoId}`), codigo_entrega_expira_em: expiration, metadata,
    }).select(ORDER_FIELDS).single();
    if (error || !data) {
      if (error?.code !== "23505") throw new HttpError("Não foi possível reservar o pedido.", 503);
      order = await locateOrder(comercioId, idempotencyKey);
      if (!order) throw new HttpError("Esta tentativa já está sendo processada.", 503);
      assertIdentity(order, comercioId, requestId, identityHash, fingerprint);
    } else order = record(data);
  }
  const secrets = await secretsFor(order, comercioId, requestId, identityHash, fingerprint);
  assertNotCanceled(order);
  // Inclusive no ramo 23505: não existe POST ao MP antes de conferir os itens completos.
  await ensureItems(order);
  order = await persistProviderArtifact(String(order.id), comercioId, {}, { itens_registro_pendente: false });
  assertNotCanceled(order);
  const receiver = await receiverFor(comercioId);
  // Revalida depois do await de OAuth, antes de qualquer novo POST.
  order = await readOrder(String(order.id), comercioId);
  assertNotCanceled(order);
  const reused = !!order.payment_id;
  let provider: Row, id: string;
  if (order.payment_id) {
    id = sanitizedProviderId(order.payment_id);
    if (!id) throw new HttpError("Identificador do pagamento inválido.", 409);
    provider = await providerGet(receiver.token, id);
  } else {
    const metadata = record(order.metadata), payload = record(metadata.provider_payload);
    if (metadata.provider_idempotency_key !== idempotencyKey || payload.external_reference !== order.referencia_externa
      || amountToCents(payload.transaction_amount) !== order.total_centavos || amountToCents(payload.application_fee) !== order.taxa_total_centavos
      || record(payload.payer).email !== email || payload.payment_method_id !== "pix") throw new HttpError("Payload de pagamento congelado inválido; não foi criada nova cobrança.", 409);
    const created = await fetchPayment(receiver.token, payload, idempotencyKey);
    id = created.id; provider = created.data;
  }
  const facts = extractProviderPayment(provider, "payment");
  const factsError = providerFactsError(facts, id, String(order.referencia_externa), receiver.conta, Number(order.total_centavos));
  if (factsError) throw new HttpError(factsError, 409);
  const artifacts = extractPixArtifacts(provider);
  order = await persistProviderArtifact(String(order.id), comercioId, {
    payment_id: id, pix_codigo: artifacts.code || null, pix_qr_code_base64: artifacts.qrCodeBase64 || null, pix_expira_em: order.codigo_entrega_expira_em,
  }, { provider_payment_id: id, pix_ticket_url: artifacts.ticketUrl, payment_created_at: record(order.metadata).payment_created_at || new Date().toISOString() });
  const approved = await reconcileVerified(order, provider, id, receiver.conta);
  if (!artifacts.code && !approved) throw new HttpError("Pagamento reservado, mas o Pix ainda não possui código. Repita a mesma tentativa.", 503);
  const finalOrder = await readOrder(String(order.id), comercioId);
  return json({ ...contractFields(finalOrder, secrets), ticket_url: artifacts.ticketUrl, reused, taxa_conferida: facts.feeCentavos !== null, revisao_financeira: facts.feeCentavos === null });
}
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ success: false, mensagem: "Use POST." }, 405);
  try { return await createPix(record(await request.json().catch(() => ({}))), request); }
  catch (error) {
    if (error instanceof HttpError) return json({ success: false, mensagem: error.message }, error.status);
    console.error("catalogo-pedido-pix failed:", error instanceof Error ? error.message : String(error));
    return json({ success: false, mensagem: "Falha temporária. Repita a mesma tentativa; nenhum pagamento foi confirmado nesta resposta." }, 503);
  }
});
