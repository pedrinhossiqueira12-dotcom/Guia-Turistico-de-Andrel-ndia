// Cobrança Pix da fatura mensal de comissões presenciais.
// A função é instalada desligada: sem FATURA_PIX_ENABLED=true e sem as credenciais da
// conta recebedora da plataforma, nenhuma order é criada no Mercado Pago.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  assessFaturaOrder,
  centsToAmountString,
  chaveIdempotenciaFatura,
  detalheCobrancaDaOrder,
  estadoCobrancaDaOrder,
  extractPixDetails,
  isComercioId,
  isCompetencia,
  montarReferenciaFatura,
  podeEmitirCobranca,
  verifyWebhookSignature,
} from "./fatura-utils.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SECRET_KEYS = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";
const LEGACY_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FATURA_PIX_ENABLED = Deno.env.get("FATURA_PIX_ENABLED") === "true";
const MP_ACCESS_TOKEN = Deno.env.get("MP_PLATFORM_ACCESS_TOKEN") ?? "";
const MP_SELLER_ID = Deno.env.get("MP_PLATFORM_SELLER_ID") ?? "";
const MP_WEBHOOK_SECRET = Deno.env.get("MP_PLATFORM_WEBHOOK_SECRET") ?? "";
const ADMIN_USER_ID = Deno.env.get("ADMIN_USER_ID") ?? "4b9a0233-6b72-4573-aebd-d596c5b15e1b";
const MP_API = "https://api.mercadopago.com";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info, x-signature, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

let serviceKey = "";
try {
  const parsed = SUPABASE_SECRET_KEYS ? JSON.parse(SUPABASE_SECRET_KEYS) : null;
  serviceKey = parsed?.default || parsed?.service_role || "";
} catch { /* fallback durante rotação de secrets */ }
if (!serviceKey) serviceKey = LEGACY_SERVICE_ROLE_KEY;
const admin = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS }); }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown, max: number) { const result = typeof value === "string" ? value.trim() : ""; if (result.length > max) throw new HttpError("Um dos campos excede o limite permitido."); return result; }

function requireEnabled() {
  if (!FATURA_PIX_ENABLED) {
    throw new HttpError("A cobrança Pix da fatura ainda não está habilitada. Nenhuma cobrança foi criada.", 503);
  }
  if (!MP_ACCESS_TOKEN || !MP_SELLER_ID || !MP_WEBHOOK_SECRET) {
    throw new HttpError("A conta recebedora da plataforma ainda não está configurada. Nenhuma cobrança foi criada.", 503);
  }
}

async function mpRequest(path: string, method: string, body?: unknown, idempotencyKey?: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${MP_ACCESS_TOKEN}`, "Content-Type": "application/json" };
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;
  const response = await fetch(`${MP_API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Mercado Pago recusou a requisição da fatura.", { path, status: response.status });
    throw new HttpError("O Mercado Pago não confirmou a operação. Nenhuma cobrança foi registrada.", 502);
  }
  return data as Record<string, unknown>;
}

async function assertSeller() {
  const me = await mpRequest("/users/me", "GET") as Record<string, unknown>;
  if (String(me.id ?? "") !== String(MP_SELLER_ID)) {
    throw new HttpError("A credencial configurada não pertence à conta recebedora esperada. Nenhuma cobrança foi criada.", 503);
  }
  return String(me.id ?? "");
}

async function auth(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new HttpError("Sessão ausente.", 401);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError("Sessão inválida.", 401);
  return data.user;
}

async function owner(userId: string, comercioId: string) {
  if (!isComercioId(comercioId)) throw new HttpError("Comércio inválido.");
  if (userId === ADMIN_USER_ID) return { admin: true };
  const { data, error } = await admin.from("catalogos").select("comercio_id,proprietario_id,bloqueado").eq("comercio_id", comercioId).maybeSingle();
  if (error) throw new Error("Falha ao verificar propriedade.");
  if (!data || data.proprietario_id !== userId) throw new HttpError("Acesso não autorizado.", 403);
  return { admin: false, bloqueado: Boolean(data.bloqueado) };
}

async function configuracoes() {
  const { data, error } = await admin.from("catalogo_automacao_config").select("fatura_pix_ativo,fechamento_offline_ativo").eq("id", true).maybeSingle();
  if (error) throw new Error("Falha ao consultar a configuração da automação.");
  return {
    fatura_pix_ativo: Boolean(data?.fatura_pix_ativo),
    fechamento_offline_ativo: Boolean(data?.fechamento_offline_ativo),
    emissao_habilitada: FATURA_PIX_ENABLED && Boolean(MP_ACCESS_TOKEN) && Boolean(MP_SELLER_ID) && Boolean(MP_WEBHOOK_SECRET),
  };
}

async function carregarFatura(comercioId: string, competencia: string) {
  const { data: fechamento, error } = await admin
    .from("catalogo_fechamentos_offline")
    .select("id,comercio_id,competencia,total_pedidos,total_comissao_centavos,status,vencimento_em,pago_em,referencia_pagamento")
    .eq("comercio_id", comercioId)
    .eq("competencia", `${competencia}-01`)
    .maybeSingle();
  if (error) throw new Error("Falha ao consultar a fatura.");

  let cobranca: Record<string, unknown> | null = null;
  if (fechamento?.id) {
    const { data, error: chargeError } = await admin
      .from("catalogo_fatura_cobrancas")
      .select("id,order_id,status,valor_centavos,qr_code,qr_code_base64,ticket_url,expira_em,pago_em,divergencia,tentativas,criado_em")
      .eq("fechamento_id", fechamento.id)
      .maybeSingle();
    if (chargeError) throw new Error("Falha ao consultar a cobrança da fatura.");
    cobranca = data || null;
  }
  return { fechamento: fechamento || null, cobranca };
}

async function obterFatura(userId: string, body: Record<string, unknown>) {
  const comercioId = text(body.comercio_id, 180);
  const competencia = text(body.competencia, 7);
  await owner(userId, comercioId);
  if (!isCompetencia(competencia)) throw new HttpError("Competência inválida. Use o formato AAAA-MM.");
  const config = await configuracoes();
  const fatura = await carregarFatura(comercioId, competencia);
  const disponibilidade = podeEmitirCobranca(fatura.fechamento);
  return json({
    success: true,
    ...fatura,
    pagamento_disponivel: Boolean(config.emissao_habilitada && config.fatura_pix_ativo && disponibilidade.ok),
    aviso: config.emissao_habilitada && config.fatura_pix_ativo ? "" : "A cobrança Pix da fatura ainda não está habilitada para este projeto.",
  });
}

async function criarCobranca(userId: string, body: Record<string, unknown>) {
  requireEnabled();
  const comercioId = text(body.comercio_id, 180);
  const competencia = text(body.competencia, 7);
  const access = await owner(userId, comercioId);
  if (!isCompetencia(competencia)) throw new HttpError("Competência inválida. Use o formato AAAA-MM.");
  const config = await configuracoes();
  if (!config.fatura_pix_ativo) throw new HttpError("A emissão de cobrança da fatura está desligada pela configuração. Nenhuma cobrança foi criada.", 503);

  const fatura = await carregarFatura(comercioId, competencia);
  const disponibilidade = podeEmitirCobranca(fatura.fechamento);
  if (!disponibilidade.ok) throw new HttpError(disponibilidade.mensagem, 409);
  const valorCentavos = disponibilidade.valorCentavos!;
  const fechamento = fatura.fechamento!;
  const referencia = montarReferenciaFatura(comercioId, competencia);
  if (!referencia) throw new HttpError("Não foi possível montar a referência da fatura.");
  const sellerId = await assertSeller();

  const cobrancaExistente = fatura.cobranca;
  if (cobrancaExistente?.order_id && cobrancaExistente.status === "pendente") {
    const order = await mpRequest(`/v1/orders/${encodeURIComponent(String(cobrancaExistente.order_id))}`, "GET");
    const avaliacao = assessFaturaOrder(order, {
      orderId: String(cobrancaExistente.order_id), externalReference: referencia,
      sellerId, amountCents: valorCentavos, requirePixArtifacts: false,
    });
    if (avaliacao.valid && avaliacao.state === "pendente") {
      const pix = extractPixDetails(order);
      return json({
        success: true, reutilizada: true, pedido_id: null, fatura: fechamento,
        cobranca_status: "pendente", order_id: cobrancaExistente.order_id,
        valor_centavos: valorCentavos, pix, mensagem: "Já existe um Pix pendente para esta fatura; ele foi reapresentado.",
      });
    }
    if (avaliacao.valid && ["cancelado", "expirado", "recusado"].includes(avaliacao.state)) {
      await conciliar(String(cobrancaExistente.order_id), order, avaliacao, referencia, valorCentavos);
    }
  }
  if (cobrancaExistente?.status === "pago") throw new HttpError("Esta fatura já está paga.", 409);

  const tentativa = Number(cobrancaExistente?.tentativas || 0) + 1;
  const chave = chaveIdempotenciaFatura({ fechamentoId: String(fechamento.id), tentativa });
  if (!chave) throw new HttpError("Não foi possível montar a chave de idempotência da cobrança.");
  const valor = centsToAmountString(valorCentavos);

  const order = await mpRequest("/v1/orders", "POST", {
    type: "online",
    processing_mode: "automatic",
    external_reference: referencia,
    total_amount: valor,
    transactions: { payments: [{ amount: valor, payment_method: { id: "pix", type: "bank_transfer" } }] },
  }, chave);

  const orderId = String(order.id ?? "");
  const preflight = assessFaturaOrder(order, {
    orderId, externalReference: referencia, sellerId, amountCents: valorCentavos, requirePixArtifacts: true,
  });
  if (!preflight.valid || !orderId) {
    console.error("Order de fatura reprovada na pré-validação.", { problems: preflight.problems });
    throw new HttpError("O Mercado Pago não confirmou uma order Pix correspondente à fatura. Nenhuma cobrança foi registrada.", 502);
  }

  const pix = extractPixDetails(order);
  const { data: registro, error } = await admin.rpc("catalogo_registrar_cobranca_fatura", {
    p_fechamento_id: fechamento.id, p_order_id: orderId, p_valor_centavos: valorCentavos,
    p_qr_code: pix.code || null, p_qr_code_base64: pix.imageBase64 || null, p_ticket_url: pix.ticketUrl || null,
    p_expira_em: null, p_detalhe: `order ${preflight.status}/${preflight.statusDetail}`,
  });
  if (error || !registro?.ok) throw new HttpError("A order foi criada mas não pôde ser vinculada com segurança. Reconsulte a fatura antes de gerar outro Pix.", 500);

  const reconciliado = await conciliar(orderId, order, preflight, referencia, valorCentavos);
  return json({
    success: true, reutilizada: false, fatura: fechamento,
    cobranca_status: reconciliado?.status || "pendente", order_id: orderId,
    valor_centavos: valorCentavos, pix,
    administrador: access.admin,
    mensagem: preflight.state === "aprovado"
      ? "Pagamento confirmado; a fatura foi quitada."
      : "Pix criado. A quitação só será registrada após a confirmação do Mercado Pago.",
  });
}

async function conciliar(orderId: string, order: Record<string, unknown>, avaliacao: { state: string; paymentId?: string }, referencia: string, valorCentavos: number) {
  if (String(order.external_reference ?? "") !== referencia) {
    throw new HttpError("A referência da order não corresponde à fatura. Nenhuma quitação foi registrada.", 409);
  }
  const estado = estadoCobrancaDaOrder(avaliacao.state);
  if (!estado) {
    console.error("Estado de order de fatura não reconhecido.", { state: avaliacao.state });
    return null;
  }
  const { data, error } = await admin.rpc("catalogo_confirmar_cobranca_fatura", {
    p_order_id: orderId, p_estado: estado, p_payment_id: avaliacao.paymentId || null,
    p_valor_centavos: valorCentavos, p_detalhe: detalheCobrancaDaOrder(order),
  });
  if (error) throw new Error("Falha ao conciliar a cobrança da fatura.");
  return record(data);
}

async function consultarCobranca(userId: string, body: Record<string, unknown>) {
  const comercioId = text(body.comercio_id, 180);
  const competencia = text(body.competencia, 7);
  await owner(userId, comercioId);
  if (!isCompetencia(competencia)) throw new HttpError("Competência inválida. Use o formato AAAA-MM.");
  const fatura = await carregarFatura(comercioId, competencia);
  if (!fatura.cobranca?.order_id) {
    return json({ success: true, ...fatura, cobranca_status: null, mensagem: "Nenhuma cobrança emitida para esta fatura." });
  }
  if (fatura.cobranca.status === "pago") return json({ success: true, ...fatura, cobranca_status: "pago" });
  requireEnabled();
  const sellerId = await assertSeller();
  const order = await mpRequest(`/v1/orders/${encodeURIComponent(String(fatura.cobranca.order_id))}`, "GET");
  const avaliacao = assessFaturaOrder(order, {
    orderId: String(fatura.cobranca.order_id), externalReference: montarReferenciaFatura(comercioId, competencia),
    sellerId, amountCents: Number(fatura.cobranca.valor_centavos), requirePixArtifacts: false,
  });
  const resultado = await conciliar(String(fatura.cobranca.order_id), order, avaliacao, montarReferenciaFatura(comercioId, competencia), Number(fatura.cobranca.valor_centavos));
  const atualizada = await carregarFatura(comercioId, competencia);
  return json({
    success: true,
    ...atualizada,
    cobranca_status: atualizada.cobranca?.status || null,
    conciliacao: resultado,
    pix: updatedPix(order, atualizada.cobranca || {}),
  });
}

// Reapresenta o Pix já emitido quando o provedor não devolve os artefatos de novo.
function updatedPix(order: Record<string, unknown>, cobranca: Record<string, unknown>) {
  const pix = extractPixDetails(order);
  if (pix.code || pix.ticketUrl) return pix;
  return {
    code: typeof cobranca.qr_code === "string" ? cobranca.qr_code : "",
    imageBase64: typeof cobranca.qr_code_base64 === "string" ? cobranca.qr_code_base64 : "",
    ticketUrl: typeof cobranca.ticket_url === "string" ? cobranca.ticket_url : "",
  };
}

async function webhook(request: Request) {
  const url = new URL(request.url);
  const body = record(await request.json().catch(() => ({})));
  const data = record(body.data);
  const orderId = url.searchParams.get("data.id") || text(data.id, 64);
  const tipo = url.searchParams.get("type") || text(body.type, 40);
  const requestId = request.headers.get("x-request-id") || "";
  if (!orderId || !["order", "orders_v2"].includes(tipo)) return json({ success: true, ignorado: true });
  if (!(await verifyWebhookSignature({ header: request.headers.get("x-signature") || "", requestId, dataId: orderId, secret: MP_WEBHOOK_SECRET }))) {
    return json({ success: false, mensagem: "Webhook inválido." }, 401);
  }
  const { data: cobranca, error } = await admin
    .from("catalogo_fatura_cobrancas")
    .select("id,comercio_id,competencia,valor_centavos,status")
    .eq("order_id", orderId)
    .maybeSingle();
  if (error) throw new Error("Falha ao localizar a cobrança da fatura.");
  if (!cobranca) return json({ success: true, ignorado: true });

  const order = await mpRequest(`/v1/orders/${encodeURIComponent(orderId)}`, "GET");
  const referencia = montarReferenciaFatura(String(cobranca.comercio_id), String(cobranca.competencia));
  const avaliacao = assessFaturaOrder(order, {
    orderId, externalReference: referencia, sellerId: MP_SELLER_ID,
    amountCents: Number(cobranca.valor_centavos), requirePixArtifacts: false,
  });
  const resultado = await conciliar(orderId, order, avaliacao, referencia, Number(cobranca.valor_centavos));
  return json({ success: true, cobranca_id: cobranca.id, status: resultado?.status || null });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ success: false, mensagem: "Use POST." }, 405);
  try {
    if (new URL(request.url).pathname.replace(/\/$/, "").endsWith("/webhook")) return await webhook(request);
    const userId = (await auth(request)).id;
    const body = record(await request.json().catch(() => ({})));
    const acao = text(body.acao, 40);
    if (acao === "obter_fatura") return await obterFatura(userId, body);
    if (acao === "criar_cobranca") return await criarCobranca(userId, body);
    if (acao === "consultar_cobranca") return await consultarCobranca(userId, body);
    return json({ success: false, mensagem: "Ação não reconhecida." }, 400);
  } catch (error) {
    if (error instanceof HttpError) return json({ success: false, mensagem: error.message }, error.status);
    console.error("catalogo-fatura-pix failed:", (error as Error).message);
    return json({ success: false, mensagem: "Não foi possível processar a cobrança da fatura." }, 500);
  }
});
