import { createClient } from "npm:@supabase/supabase-js@2";
import {
  PRODUCTION_PLANS,
  amountToCents,
  assessProductionOrder,
  centsToAmountString,
  extractPixDetails,
  getProductionPlan,
  verifyWebhookSignature,
} from "./mercadopago-utils.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SECRET_KEYS = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";
const LEGACY_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MP_PRODUCTION_ENABLED = Deno.env.get("MP_PRODUCTION_ENABLED") === "true";
const MP_PROD_ACCESS_TOKEN = Deno.env.get("MP_PROD_ACCESS_TOKEN") ?? "";
const MP_PROD_SELLER_ID = Deno.env.get("MP_PROD_SELLER_ID") ?? "";
const MP_PROD_WEBHOOK_SECRET = Deno.env.get("MP_PROD_WEBHOOK_SECRET") ?? "";
const MP_OAUTH_CLIENT_ID = Deno.env.get("MP_OAUTH_CLIENT_ID") ?? "";
const MP_OAUTH_REDIRECT_URI = Deno.env.get("MP_OAUTH_REDIRECT_URI") ?? "";
const MP_API = "https://api.mercadopago.com";
const MP_USER_PROFILE_API = "https://api.mercadolibre.com";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

let serviceKey = "";
try {
  const parsed = SUPABASE_SECRET_KEYS ? JSON.parse(SUPABASE_SECRET_KEYS) : null;
  serviceKey = parsed?.default || parsed?.service_role || "";
} catch (error) {
  console.error("Unable to parse configured Supabase secret-key bundle.", String(error));
}
if (!serviceKey) serviceKey = LEGACY_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !serviceKey) throw new Error("Required Supabase server configuration is missing.");

const admin = createClient(SUPABASE_URL, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type JsonRecord = Record<string, unknown>;
type Owner = { userId: string; commerceId: string; email: string };
type Subscription = {
  id: string;
  comercio_id: string;
  status: string;
  valor: number | string | null;
  gateway: string | null;
  cobranca_id: string | null;
  expira_em: string | null;
  pago_em: string | null;
  metadata: unknown;
};
type Payment = {
  id: string;
  assinatura_id: string;
  comercio_id: string;
  gateway: string;
  plano: string;
  valor: number | string;
  referencia_externa: string;
  chave_idempotencia: string;
  order_id: string | null;
  payment_id: string | null;
  status: string;
  expira_em: string | null;
};

class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function safeString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function base64Url(bytes: Uint8Array): string { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
async function sha256Base64Url(value: string): Promise<string> { return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))); }
function randomBase64Url(size = 32): string { return base64Url(crypto.getRandomValues(new Uint8Array(size))); }
async function startMercadoPagoOAuth(owner: Owner) {
  if (!MP_OAUTH_CLIENT_ID || !MP_OAUTH_REDIRECT_URI) return { success: false, mensagem: "A conexão Mercado Pago ainda aguarda a configuração OAuth pelo administrador. Nenhuma cobrança foi criada." };
  const state = randomBase64Url(); const codeVerifier = randomBase64Url();
  const { error } = await admin.from("catalogo_oauth_estados").insert({ estado_hash: await sha256Base64Url(state), comercio_id: owner.commerceId, proprietario_id: owner.userId, code_verifier: codeVerifier, expira_em: new Date(Date.now() + 600000).toISOString() });
  if (error) throw new Error("Não foi possível iniciar a conexão segura com o Mercado Pago.");
  const authorization = new URL("https://auth.mercadopago.com.br/authorization");
  authorization.search = new URLSearchParams({ client_id: MP_OAUTH_CLIENT_ID, response_type: "code", platform_id: "mp", state, redirect_uri: MP_OAUTH_REDIRECT_URI, code_challenge: await sha256Base64Url(codeVerifier), code_challenge_method: "S256" }).toString();
  return { success: true, authorization_url: authorization.toString(), expires_in: 600 };
}

function slug(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "perfil";
}

function recordMatchesCommerce(record: JsonRecord, commerceId: string): boolean {
  const candidates = [
    record.local_id,
    record.id_publico,
    record.slug,
    record.comercio_id,
    slug(record.nome),
  ].map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean);
  return candidates.includes(commerceId.toLowerCase());
}

function requireProductionConfiguration(requireWebhook = false) {
  if (!MP_PROD_ACCESS_TOKEN || !/^\d{1,24}$/.test(MP_PROD_SELLER_ID)) {
    throw new HttpError("O checkout de produção ainda não está configurado.", 503);
  }
  if (requireWebhook && !MP_PROD_WEBHOOK_SECRET) {
    throw new HttpError("O webhook de produção ainda não está configurado.", 503);
  }
}

function requireNewChargeEnabled() {
  if (!MP_PRODUCTION_ENABLED) {
    throw new HttpError("O checkout real está desligado. Nenhuma cobrança foi criada.", 503);
  }
  requireProductionConfiguration(true);
}

async function verifyBearer(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user?.id) return null;
  const email = typeof data.user.email === "string" ? data.user.email.trim().toLowerCase() : "";
  return { user: data.user, email };
}

async function verifyCommerceOwner(userId: string, commerceId: string): Promise<Owner> {
  if (!/^[a-z0-9-]{1,180}$/.test(commerceId)) throw new HttpError("Identificador do comércio inválido.", 400);

  const { data: published, error: publishedError } = await admin
    .from("comercios_publicados")
    .select("local_id,status")
    .eq("local_id", commerceId)
    .maybeSingle();
  if (publishedError) throw new Error("Falha ao consultar o estado do comércio publicado.");
  if (!published || published.status !== "ativo") throw new HttpError("Este comércio não está publicado e ativo.", 403);

  const { data: registrations, error: registrationError } = await admin
    .from("cadastros_comercios")
    .select("id,usuario_id,nome,status,local_id")
    .eq("usuario_id", userId)
    .eq("status", "aprovado")
    .limit(100);
  if (registrationError) throw new Error("Falha ao consultar o vínculo aprovado do proprietário.");
  const registration = (registrations || []).find((item: JsonRecord) => recordMatchesCommerce(item, commerceId));
  if (!registration) throw new HttpError("A conta não está vinculada a este comércio aprovado.", 403);

  const { data: catalog, error: catalogError } = await admin
    .from("catalogos")
    .select("comercio_id,proprietario_id,bloqueado")
    .eq("comercio_id", commerceId)
    .maybeSingle();
  if (catalogError) throw new Error("Falha ao consultar o catálogo.");
  if (catalog && catalog.proprietario_id !== userId) throw new HttpError("O comércio está vinculado a outra conta.", 403);
  if (catalog?.bloqueado) throw new HttpError("Este catálogo está bloqueado pela administração.", 403);
  return { userId, commerceId, email: "" };
}

async function ensureCatalog(owner: Owner) {
  const { data, error } = await admin.from("catalogos")
    .select("comercio_id,proprietario_id,bloqueado")
    .eq("comercio_id", owner.commerceId)
    .maybeSingle();
  if (error) throw new Error("Falha ao consultar configuração do catálogo.");
  if (!data) {
    const { error: insertError } = await admin.from("catalogos").insert({
      comercio_id: owner.commerceId,
      proprietario_id: owner.userId,
    });
    if (insertError && insertError.code !== "23505") throw new Error("Não foi possível preparar o catálogo para contratação.");
  }

  // Uma conta concorrente pode ter vencido o INSERT único; sempre reler e confirmar o dono real.
  const { data: confirmed, error: confirmError } = await admin.from("catalogos")
    .select("comercio_id,proprietario_id,bloqueado")
    .eq("comercio_id", owner.commerceId)
    .maybeSingle();
  if (confirmError || !confirmed) throw new Error("Não foi possível confirmar o catálogo após a reserva.");
  if (confirmed.proprietario_id !== owner.userId || confirmed.bloqueado) {
    throw new HttpError("Este catálogo não está disponível para contratação.", 403);
  }
}

async function mpRequest(path: string, method: "GET" | "POST", body?: JsonRecord, idempotencyKey?: string, apiBase = MP_API) {
  requireProductionConfiguration();
  const headers: Record<string, string> = { Authorization: `Bearer ${MP_PROD_ACCESS_TOKEN}` };
  if (body) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new HttpError("Não foi possível conectar ao Mercado Pago. Tente consultar novamente; o estado da assinatura não foi alterado.", 502);
  }
  const data = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok) {
    console.error("Mercado Pago production request failed.", { status: response.status, path, cause: safeString(data.error ?? data.message) });
    const status = response.status === 429 ? 503 : 502;
    throw new HttpError("O Mercado Pago não confirmou a operação. Nenhum catálogo foi ativado.", status);
  }
  return data;
}

async function assertProductionSeller() {
  const user = await mpRequest("/users/me", "GET", undefined, undefined, MP_USER_PROFILE_API);
  if (safeString(user.id) !== MP_PROD_SELLER_ID || safeString(user.site_id) !== "MLB") {
    throw new HttpError("A credencial não corresponde à conta recebedora de produção configurada. Operação bloqueada.", 503);
  }
}

async function getActiveSubscription(commerceId: string) {
  const { data, error } = await admin.from("catalogo_assinaturas")
    .select("id,status,expira_em")
    .eq("comercio_id", commerceId)
    .eq("status", "ativa")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Falha ao consultar assinatura ativa.");
  if (data && (!data.expira_em || new Date(data.expira_em).getTime() > Date.now())) return data;
  return null;
}

async function getPendingSubscription(commerceId: string): Promise<Subscription | null> {
  const { data, error } = await admin.from("catalogo_assinaturas")
    .select("id,comercio_id,status,valor,gateway,cobranca_id,expira_em,pago_em,metadata")
    .eq("comercio_id", commerceId)
    .eq("status", "pendente")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Falha ao consultar assinatura pendente.");
  return data as Subscription | null;
}

async function getPaymentForSubscription(subscriptionId: string): Promise<Payment | null> {
  const { data, error } = await admin.from("catalogo_pagamentos")
    .select("id,assinatura_id,comercio_id,gateway,plano,valor,referencia_externa,chave_idempotencia,order_id,payment_id,status,expira_em")
    .eq("assinatura_id", subscriptionId)
    .eq("gateway", "mercadopago")
    .order("criado_em", { ascending: false })
    .limit(2);
  if (error) throw new Error("Falha ao consultar pagamento pendente.");
  if ((data || []).length > 1) throw new HttpError("Há mais de um pagamento vinculado a esta assinatura. A tentativa foi bloqueada para revisão.", 409);
  return ((data || [])[0] ?? null) as Payment | null;
}

async function findOrCreateAttempt(owner: Owner, planId: string): Promise<{ subscription: Subscription; payment: Payment }> {
  const plan = getProductionPlan(planId);
  if (!plan) throw new HttpError("Plano inválido.", 400);

  let subscription = await getPendingSubscription(owner.commerceId);
  if (subscription?.gateway === "mercadopago_sandbox") {
    throw new HttpError("A assinatura de teste sandbox precisa ser encerrada pela migração aprovada antes de iniciar a cobrança real.", 409);
  }
  if (subscription?.gateway && subscription.gateway !== "mercadopago") {
    throw new HttpError("Existe uma solicitação pendente de outro tipo. Nenhuma alteração foi feita.", 409);
  }

  if (subscription?.gateway === "mercadopago") {
    const existingPayment = await getPaymentForSubscription(subscription.id);
    if (!existingPayment) throw new HttpError("A solicitação de pagamento não está íntegra. Contate a administração antes de tentar novamente.", 409);
    if (existingPayment.plano !== planId) throw new HttpError("Já existe um plano pendente para este comércio. Conclua ou aguarde o encerramento antes de trocar o plano.", 409);
    return { subscription, payment: existingPayment };
  }

  const { data: existingCatalog, error: catalogError } = await admin.from("catalogos")
    .select("comercio_id,proprietario_id,bloqueado")
    .eq("comercio_id", owner.commerceId)
    .maybeSingle();
  if (catalogError || !existingCatalog) throw new Error("Não foi possível confirmar o catálogo do comércio.");
  if (existingCatalog.proprietario_id !== owner.userId || existingCatalog.bloqueado) {
    throw new HttpError("Este catálogo não está disponível para contratação.", 403);
  }

  if (subscription) {
    const oldMetadata = asRecord(subscription.metadata);
    const oldProduction = asRecord(oldMetadata.producao);
    const { data, error } = await admin.from("catalogo_assinaturas")
      .update({ valor: plan.amountCents / 100, gateway: "mercadopago", metadata: { ...oldMetadata, producao: { ...oldProduction, plano: planId, configuracao: "desligada_por_padrao", email_pagador: safeString(oldProduction.email_pagador) || owner.email } } })
      .eq("id", subscription.id)
      .eq("comercio_id", owner.commerceId)
      .eq("status", "pendente")
      .select("id,comercio_id,status,valor,gateway,cobranca_id,expira_em,pago_em,metadata")
      .maybeSingle();
    if (error || !data) throw new HttpError("Não foi possível reservar a assinatura pendente.", 409);
    subscription = data as Subscription;
  } else {
    const { data, error } = await admin.from("catalogo_assinaturas")
      .insert({ comercio_id: owner.commerceId, status: "pendente", valor: plan.amountCents / 100, gateway: "mercadopago", metadata: { producao: { plano: planId, configuracao: "desligada_por_padrao", email_pagador: owner.email } } })
      .select("id,comercio_id,status,valor,gateway,cobranca_id,expira_em,pago_em,metadata")
      .single();
    if (error || !data) {
      if (error?.code === "23505") throw new HttpError("Já existe uma solicitação pendente. Atualize a página e tente novamente.", 409);
      throw new Error("Não foi possível iniciar a assinatura.");
    }
    subscription = data as Subscription;
  }

  const reference = crypto.randomUUID();
  const idempotencyKey = crypto.randomUUID();
  const { data: paymentData, error: paymentError } = await admin.from("catalogo_pagamentos")
    .insert({
      assinatura_id: subscription.id,
      comercio_id: owner.commerceId,
      gateway: "mercadopago",
      plano: planId,
      valor: plan.amountCents / 100,
      moeda: "BRL",
      referencia_externa: reference,
      chave_idempotencia: idempotencyKey,
      status: "pendente",
      expira_em: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("id,assinatura_id,comercio_id,gateway,plano,valor,referencia_externa,chave_idempotencia,order_id,payment_id,status,expira_em")
    .single();
  if (paymentError || !paymentData) {
    if (paymentError?.code === "23505") {
      const winner = await getPaymentForSubscription(subscription.id);
      if (winner && winner.plano === planId && winner.status === "pendente") return { subscription, payment: winner };
      throw new HttpError("Já existe um pagamento vinculado a esta solicitação. Atualize a tela antes de tentar novamente.", 409);
    }
    // Compensação conservadora: não deixar um pedido sem linha de pagamento travar o catálogo.
    await admin.from("catalogo_assinaturas").update({ status: "cancelada", expira_em: new Date().toISOString() })
      .eq("id", subscription.id).eq("status", "pendente").eq("gateway", "mercadopago");
    throw new Error("Não foi possível registrar a auditoria privada do pagamento.");
  }
  return { subscription, payment: paymentData as Payment };
}

function assess(order: JsonRecord, payment: Payment) {
  return assessProductionOrder(order, {
    orderId: payment.order_id || safeString(order.id),
    externalReference: payment.referencia_externa,
    sellerId: MP_PROD_SELLER_ID,
    amountCents: amountToCents(payment.valor),
    paymentId: payment.payment_id,
  });
}

async function applyOrder(order: JsonRecord, payment: Payment) {
  const assessment = assess(order, payment);
  if (!assessment.valid) {
    console.error("Mercado Pago production order validation failed.", { orderId: safeString(order.id), problems: assessment.problems });
    throw new HttpError("A order não passou pelas validações de valor, recebedor e Pix. Nenhum catálogo foi ativado.", 502);
  }
  if (assessment.state === "desconhecido") {
    console.error("Mercado Pago returned an unmapped production status.", { orderId: safeString(order.id), status: assessment.status, detail: assessment.statusDetail, paymentStatus: assessment.paymentStatus, paymentDetail: assessment.paymentStatusDetail });
    throw new HttpError("O Mercado Pago retornou um status ainda não mapeado. Nenhuma alteração foi aplicada; a notificação será reprocessada.", 502);
  }
  if (!payment.order_id || payment.order_id !== safeString(order.id)) {
    throw new HttpError("A order não está vinculada ao pagamento interno esperado.", 409);
  }
  const { data, error } = await admin.rpc("catalogo_processar_evento_pagamento", {
    p_order_id: payment.order_id,
    p_payment_id: assessment.paymentId || null,
    p_estado: assessment.state,
    p_status_provedor: assessment.status,
    p_detalhe_status_provedor: assessment.statusDetail,
  });
  if (error) {
    console.error("Atomic payment transition failed.", { orderId: payment.order_id, code: error.code });
    throw new Error("Não foi possível registrar com segurança o estado confirmado pelo Mercado Pago.");
  }
  const transition = asRecord(data);
  if (assessment.state === "aprovado" && transition.subscription_status !== "ativa") {
    throw new HttpError("O Mercado Pago aprovou, mas a ativação não foi concluída. Acesse novamente para reconciliar; não faça outro Pix.", 409);
  }
  return { assessment, transition };
}

async function getOrder(orderId: string) {
  return await mpRequest(`/v1/orders/${encodeURIComponent(orderId)}`, "GET");
}

async function createOrReusePix(owner: Owner, planId: string) {
  requireNewChargeEnabled();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner.email)) {
    throw new HttpError("A conta do proprietário precisa ter um e-mail válido para emitir o Pix.", 400);
  }
  await assertProductionSeller();
  await ensureCatalog(owner);
  if (await getActiveSubscription(owner.commerceId)) {
    throw new HttpError("Este comércio já tem uma assinatura ativa.", 409);
  }

  const { subscription, payment } = await findOrCreateAttempt(owner, planId);
  const storedPayerEmail = safeString(asRecord(asRecord(subscription.metadata).producao).email_pagador);
  const payerEmail = storedPayerEmail || owner.email;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)) {
    throw new HttpError("A conta do proprietário precisa ter um e-mail válido para emitir o Pix.", 400);
  }
  let order: JsonRecord;
  let reused = false;
  if (payment.order_id) {
    order = await getOrder(payment.order_id) as JsonRecord;
    reused = true;
  } else {
    const plan = getProductionPlan(planId)!;
    const amount = centsToAmountString(plan.amountCents);
    order = await mpRequest("/v1/orders", "POST", {
      type: "online",
      processing_mode: "automatic",
      external_reference: payment.referencia_externa,
      total_amount: amount,
      payer: { email: payerEmail },
      transactions: {
        payments: [{ amount, payment_method: { id: "pix", type: "bank_transfer" } }],
      },
    }, payment.chave_idempotencia) as JsonRecord;

    const preflight = assessProductionOrder(order, {
      orderId: safeString(order.id),
      externalReference: payment.referencia_externa,
      sellerId: MP_PROD_SELLER_ID,
      amountCents: plan.amountCents,
      requirePixArtifacts: true,
    });
    if (!preflight.valid || !safeString(order.id)) {
      console.error("New Mercado Pago order failed production preflight.", { problems: preflight.problems });
      throw new HttpError("O Mercado Pago não confirmou uma order Pix correspondente à conta de produção. Nenhuma ativação ocorreu.", 502);
    }

    const { data: attached, error: attachError } = await admin.from("catalogo_pagamentos")
      .update({ order_id: safeString(order.id), payment_id: preflight.paymentId || null, status_provedor: preflight.status, detalhe_status_provedor: preflight.statusDetail })
      .eq("id", payment.id)
      .eq("assinatura_id", subscription.id)
      .eq("status", "pendente")
      .select("id")
      .maybeSingle();
    if (attachError || !attached) throw new HttpError("A order foi criada mas não pôde ser vinculada com segurança. Não faça um novo Pix; contate a administração.", 500);
    const { data: attachedSubscription, error: subscriptionError } = await admin.from("catalogo_assinaturas")
      .update({ cobranca_id: safeString(order.id), valor: plan.amountCents / 100, gateway: "mercadopago" })
      .eq("id", subscription.id)
      .eq("comercio_id", owner.commerceId)
      .eq("status", "pendente")
      .select("id")
      .maybeSingle();
    if (subscriptionError || !attachedSubscription) throw new HttpError("A order foi criada; a vinculação está pendente de reconciliação. Não faça um novo Pix.", 500);
  }

  const subscriptionMetadata = asRecord(subscription.metadata);
  const productionMetadata = { ...asRecord(subscriptionMetadata.producao) };
  if (safeString(productionMetadata.email_pagador)) {
    const { data: cleared, error: metadataError } = await admin.rpc("catalogo_limpar_email_pagador", { p_assinatura_id: subscription.id });
    if (metadataError || cleared !== true) throw new HttpError("A order está vinculada; a limpeza de metadata está pendente. Reconsulte o pagamento; não faça outro Pix.", 500);
  }

  const latestPayment = { ...payment, order_id: safeString(order.id) } as Payment;
  const { assessment, transition } = await applyOrder(order, latestPayment);
  const status = safeString(transition.subscription_status) || (assessment.state === "aprovado" ? "ativa" : "pendente");
  const pix = assessment.state === "pendente" ? extractPixDetails(order) : { code: "", imageBase64: "", ticketUrl: "" };
  return {
    success: true,
    production: true,
    signature_status: assessment.state,
    order_status: assessment.status,
    order_status_detail: assessment.statusDetail,
    plan: planId,
    amount_cents: amountToCents(payment.valor),
    subscription_status: status,
    catalog_activated: assessment.state === "aprovado" && status === "ativa",
    reused,
    pix,
    mensagem: assessment.state === "aprovado"
      ? "Pagamento confirmado diretamente pela API do Mercado Pago; a assinatura foi ativada."
      : assessment.state === "estornado" || assessment.state === "contestado"
        ? "Estorno/contestação confirmado. A assinatura foi cancelada e a vitrine bloqueada; nenhum reembolso foi solicitado pelo sistema."
        : assessment.state === "pendente"
          ? "Pix criado. A vitrine só será liberada após a confirmação da API do Mercado Pago."
          : "O pagamento não foi aprovado. A vitrine permanece bloqueada.",
  };
}

async function refreshPayment(owner: Owner) {
  requireProductionConfiguration();
  await assertProductionSeller();
  const { data: latestSubscription, error } = await admin.from("catalogo_assinaturas")
    .select("id,gateway")
    .eq("comercio_id", owner.commerceId)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Falha ao consultar a assinatura mais recente.");
  if (!latestSubscription || latestSubscription.gateway !== "mercadopago") {
    return { success: true, production: true, has_order: false, catalog_activated: false };
  }
  const payment = await getPaymentForSubscription(latestSubscription.id);
  if (!payment?.order_id) return { success: true, production: true, has_order: false, catalog_activated: false };
  const order = await getOrder(payment.order_id) as JsonRecord;
  const { assessment, transition } = await applyOrder(order, payment);
  const { data: subscription, error: subscriptionError } = await admin.from("catalogo_assinaturas")
    .select("status")
    .eq("id", payment.assinatura_id)
    .maybeSingle();
  if (subscriptionError) throw new Error("Falha ao confirmar a assinatura após consultar o pagamento.");
  const status = safeString(subscription?.status) || safeString(transition.subscription_status);
  return {
    success: true,
    production: true,
    has_order: true,
    signature_status: assessment.state,
    order_status: assessment.status,
    order_status_detail: assessment.statusDetail,
    plan: payment.plano,
    amount_cents: amountToCents(payment.valor),
    subscription_status: status,
    catalog_activated: assessment.state === "aprovado" && status === "ativa",
    pix: assessment.state === "pendente" ? extractPixDetails(order) : { code: "", imageBase64: "", ticketUrl: "" },
    mensagem: "Status conferido diretamente na API do Mercado Pago.",
  };
}

async function handleWebhook(request: Request, url: URL) {
  if (request.method !== "POST") return json({ success: false, mensagem: "Use POST." }, 405);
  try {
    // O webhook continua processando pagamentos já emitidos mesmo se novos checkouts forem desligados.
    requireProductionConfiguration(true);
    await assertProductionSeller();
    const body = await request.json().catch(() => ({})) as JsonRecord;
    const dataId = url.searchParams.get("data.id") || safeString(asRecord(body.data).id);
    const notificationType = url.searchParams.get("type") || safeString(body.type);
    const requestId = request.headers.get("x-request-id") || "";
    const valid = await verifyWebhookSignature({
      header: request.headers.get("x-signature") || "",
      requestId,
      dataId,
      secret: MP_PROD_WEBHOOK_SECRET,
    });
    if (!valid) return json({ success: false, mensagem: "Assinatura ou timestamp do webhook inválido." }, 401);
    if (!new Set(["order", "orders_v2"]).has(notificationType) || !dataId) return json({ success: true, ignored: true }, 200);

    const { data: payment, error } = await admin.from("catalogo_pagamentos")
      .select("id,assinatura_id,comercio_id,gateway,plano,valor,referencia_externa,chave_idempotencia,order_id,payment_id,status,expira_em")
      .eq("gateway", "mercadopago")
      .eq("order_id", dataId)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("Falha ao localizar pagamento para webhook.");
    if (!payment) return json({ success: true, ignored: true }, 200);

    const order = await getOrder(dataId) as JsonRecord;
    await applyOrder(order, payment as Payment);
    return json({ success: true, production: true, catalog_activated_only_if_verified: true }, 200);
  } catch (error) {
    if (error instanceof HttpError) return json({ success: false, mensagem: error.message }, error.status);
    console.error("Mercado Pago production webhook failed:", (error as Error).message);
    return json({ success: false, mensagem: "Falha temporária ao processar o webhook." }, 503);
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  const url = new URL(request.url);
  if (url.pathname.endsWith("/webhook") || url.searchParams.get("source") === "mercadopago") {
    return await handleWebhook(request, url);
  }
  if (request.method !== "POST") return json({ success: false, mensagem: "Use POST." }, 405);

  const authenticated = await verifyBearer(request);
  if (!authenticated) return json({ success: false, mensagem: "Sessão ausente ou inválida." }, 401);

  try {
    const body = await request.json().catch(() => ({})) as JsonRecord;
    const action = safeString(body.acao);
    const commerceId = safeString(body.comercio_id).trim();
    if (!commerceId) throw new HttpError("Informe o comércio.", 400);
    const verified = await verifyCommerceOwner(authenticated.user.id, commerceId);
    const owner = { ...verified, email: authenticated.email };

    if (action === "verificar_recebedor") {
      const { data: receiver, error: receiverError } = await admin
        .from("catalogo_recebedores")
        .select("comercio_id,provedor,conta_externa_id,status,percentual_plataforma,conectado_em,atualizado_em")
        .eq("comercio_id", commerceId)
        .maybeSingle();
      if (receiverError) throw new Error("Falha ao consultar a conta recebedora do comércio.");
      const receiverStatus = safeString(receiver?.status) || "pendente";
      return json({
        success: true,
        proprietario: true,
        receiver_status: receiverStatus,
        receiver_connected: Boolean(receiver?.conta_externa_id),
        recebedor_status: receiverStatus,
        recebedor_conectado: Boolean(receiver?.conta_externa_id),
        percentual_plataforma: Number(receiver?.percentual_plataforma ?? 5),
        checkout_enabled: false,
        production: false,
        mensagem: receiver
          ? "Configuração do recebedor consultada. O checkout de pedidos ainda não foi ativado."
          : "Nenhuma conta Mercado Pago foi conectada para este comércio.",
      });
    }

    if (action === "iniciar_conexao") {
      return json(await startMercadoPagoOAuth(owner));
    }

    if (action === "verificar_checkout") {
      let checkoutReady = MP_PRODUCTION_ENABLED
        && Boolean(MP_PROD_ACCESS_TOKEN)
        && /^\d{1,24}$/.test(MP_PROD_SELLER_ID)
        && Boolean(MP_PROD_WEBHOOK_SECRET);
      if (checkoutReady) {
        try {
          await assertProductionSeller();
        } catch (error) {
          checkoutReady = false;
          console.error("Production checkout availability check failed.", (error as Error).message);
        }
      }
      return json({
        success: true,
        proprietario: true,
        checkout_enabled: checkoutReady,
        production: true,
        mensagem: checkoutReady ? "Checkout de produção habilitado." : "Checkout de produção desligado ou incompleto; nenhuma cobrança pode ser criada.",
      });
    }
    if (action === "listar_planos") {
      requireNewChargeEnabled();
      await assertProductionSeller();
      return json({
        success: true,
        production: true,
        plans: Object.entries(PRODUCTION_PLANS).map(([id, plan]) => ({ id, label: plan.label, amount_cents: plan.amountCents, duration_days: plan.durationDays })),
      });
    }
    if (action === "criar_pix") {
      return json(await createOrReusePix(owner, safeString(body.plano)));
    }
    if (action === "consultar_pix") {
      return json(await refreshPayment(owner));
    }
    return json({ success: false, mensagem: "Ação de checkout não reconhecida." }, 400);
  } catch (error) {
    if (error instanceof HttpError) return json({ success: false, mensagem: error.message }, error.status);
    console.error("catalogo-pix-producao failed:", (error as Error).message);
    return json({ success: false, mensagem: "Não foi possível concluir a operação. A vitrine permanece protegida." }, 500);
  }
});
