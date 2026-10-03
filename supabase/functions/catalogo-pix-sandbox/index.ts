import { createClient } from "npm:@supabase/supabase-js@2";
import {
  SANDBOX_PLANS,
  amountToCents,
  assessSandboxOrder,
  centsToAmountString,
  extractPixDetails,
  getSandboxPlan,
  verifyWebhookSignature,
} from "./mercadopago-utils.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SECRET_BUNDLE = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MP_MODE = Deno.env.get("MP_MODE") ?? "";
const MP_TEST_ACCESS_TOKEN = Deno.env.get("MP_TEST_ACCESS_TOKEN") ?? "";
const MP_TEST_SELLER_ID = Deno.env.get("MP_TEST_SELLER_ID") ?? "";
const MP_TEST_WEBHOOK_SECRET = Deno.env.get("MP_TEST_WEBHOOK_SECRET") ?? "";
const MP_API = "https://api.mercadopago.com";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

let serviceKey = "";
try {
  const parsed = SECRET_BUNDLE ? JSON.parse(SECRET_BUNDLE) : null;
  serviceKey = parsed?.default || parsed?.service_role || "";
} catch (error) {
  console.error("Unable to parse configured Supabase service key bundle.", String(error));
}
if (!serviceKey) serviceKey = SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !serviceKey) throw new Error("Required Supabase server configuration is missing.");

const admin = createClient(SUPABASE_URL, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type JsonRecord = Record<string, unknown>;
type OwnerResult = { userId: string; commerceId: string; blocked: boolean; hasCatalog: boolean };
type SubscriptionRow = {
  id: string;
  comercio_id: string;
  status: string;
  valor: number | string | null;
  gateway: string | null;
  cobranca_id: string | null;
  criado_em: string;
  pago_em: string | null;
  expira_em: string | null;
  metadata: unknown;
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

async function verifyBearer(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return { user: data.user, token };
}

async function verifyCommerceOwner(userId: string, commerceId: string): Promise<OwnerResult> {
  if (!/^[a-z0-9-]{1,180}$/.test(commerceId)) {
    throw new HttpError("Identificador do comércio inválido.", 400);
  }

  const { data: published, error: publishedError } = await admin
    .from("comercios_publicados")
    .select("local_id,status")
    .eq("local_id", commerceId)
    .maybeSingle();
  if (publishedError) throw new Error("Falha ao consultar o estado do comércio publicado.");
  if (!published || published.status !== "ativo") {
    throw new HttpError("Este comércio não está publicado e ativo.", 403);
  }

  // Propriedade é vinculada somente pelo ID público local_id, nunca por nome/slug aproximado.
  const { data: registration, error: registrationError } = await admin
    .from("cadastros_comercios")
    .select("id,local_id,status")
    .eq("usuario_id", userId)
    .eq("status", "aprovado")
    .eq("local_id", commerceId)
    .limit(1)
    .maybeSingle();
  if (registrationError) throw new Error("Falha ao consultar o vínculo aprovado do proprietário.");
  if (!registration) throw new HttpError("A conta não está vinculada a este comércio aprovado.", 403);

  const { data: catalog, error: catalogError } = await admin
    .from("catalogos")
    .select("comercio_id,proprietario_id,bloqueado")
    .eq("comercio_id", commerceId)
    .maybeSingle();
  if (catalogError) throw new Error("Falha ao consultar o catálogo.");
  if (catalog && catalog.proprietario_id !== userId) {
    throw new HttpError("O comércio já está vinculado a outra conta.", 403);
  }
  return {
    userId,
    commerceId,
    blocked: Boolean(catalog?.bloqueado),
    hasCatalog: Boolean(catalog),
  };
}

async function ensureCatalog(owner: OwnerResult) {
  if (owner.blocked) throw new HttpError("Este catálogo está bloqueado pela administração.", 403);
  if (owner.hasCatalog) return;

  const { error } = await admin.from("catalogos").insert({
    comercio_id: owner.commerceId,
    proprietario_id: owner.userId,
  });
  if (!error) return;
  if (error.code === "23505") {
    const { data: catalog, error: lookupError } = await admin
      .from("catalogos")
      .select("proprietario_id,bloqueado")
      .eq("comercio_id", owner.commerceId)
      .maybeSingle();
    if (!lookupError && catalog?.proprietario_id === owner.userId && !catalog.bloqueado) return;
    throw new HttpError("O catálogo já está vinculado a outra conta.", 403);
  }
  throw new Error("Não foi possível preparar a configuração de sandbox do catálogo.");
}

async function getActiveSubscription(commerceId: string) {
  const { data, error } = await admin.from("catalogo_assinaturas")
    .select("id,status,expira_em")
    .eq("comercio_id", commerceId)
    .eq("status", "ativa")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Falha ao consultar a assinatura do catálogo.");
  if (!data) return null;
  if (!data.expira_em || new Date(data.expira_em).getTime() > Date.now()) return data;
  return null;
}

async function getPendingSubscription(commerceId: string): Promise<SubscriptionRow | null> {
  const { data, error } = await admin.from("catalogo_assinaturas")
    .select("id,comercio_id,status,valor,gateway,cobranca_id,criado_em,pago_em,expira_em,metadata")
    .eq("comercio_id", commerceId)
    .eq("status", "pendente")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Falha ao consultar a solicitação pendente do catálogo.");
  return data as SubscriptionRow | null;
}

function requireSandboxConfiguration(requireWebhookSecret = false) {
  if (MP_MODE !== "sandbox") {
    throw new HttpError("Sandbox do Mercado Pago não está habilitado. Nenhuma order foi criada.", 503);
  }
  if (!MP_TEST_ACCESS_TOKEN || !/^\d{1,24}$/.test(MP_TEST_SELLER_ID)) {
    throw new HttpError("Falta configurar o Access Token e o ID do vendedor de teste no Supabase. Nenhuma order foi criada.", 503);
  }
  if (requireWebhookSecret && !MP_TEST_WEBHOOK_SECRET) {
    throw new HttpError("A chave do webhook de teste ainda não foi configurada.", 503);
  }
}

async function mpRequest(path: string, method: "GET" | "POST", body?: JsonRecord, idempotencyKey?: string) {
  requireSandboxConfiguration();
  const headers: Record<string, string> = { Authorization: `Bearer ${MP_TEST_ACCESS_TOKEN}` };
  if (body) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;
  let response: Response;
  try {
    response = await fetch(`${MP_API}${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new HttpError("Não foi possível conectar ao Mercado Pago de teste. Tente novamente; nenhuma assinatura foi ativada.", 502);
  }
  const data = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok) {
    console.error("Mercado Pago sandbox request failed.", { status: response.status, path, cause: safeString(data.error ?? data.message) });
    const status = response.status === 401 || response.status === 403 ? 502 : response.status === 429 ? 503 : 502;
    throw new HttpError("O Mercado Pago recusou a operação de teste. Confira as credenciais de vendedor de teste; nenhum catálogo foi ativado.", status);
  }
  return data;
}

async function assertSandboxSeller() {
  const user = await mpRequest("/users/me", "GET");
  const actualId = safeString(user.id);
  if (actualId !== MP_TEST_SELLER_ID || safeString(user.site_id) !== "MLB") {
    throw new HttpError("A credencial não corresponde ao vendedor de teste configurado. A order foi bloqueada.", 403);
  }
  return actualId;
}

async function getMpOrder(orderId: string) {
  return await mpRequest(`/v1/orders/${encodeURIComponent(orderId)}`, "GET");
}

function metadataWithSandbox(metadata: unknown, sandbox: JsonRecord): JsonRecord {
  return {
    ...asRecord(metadata),
    sandbox_only: true,
    sandbox,
  };
}

function orderAssessment(order: JsonRecord, subscription: SubscriptionRow, sellerId: string) {
  return assessSandboxOrder(order, {
    orderId: subscription.cobranca_id || safeString(order.id),
    subscriptionId: subscription.id,
    sellerId,
    amountCents: amountToCents(subscription.valor),
  });
}

function sandboxData(order: JsonRecord, subscription: SubscriptionRow, reused: boolean) {
  const assessment = orderAssessment(order, subscription, MP_TEST_SELLER_ID);
  if (!assessment.valid) {
    console.error("Mercado Pago sandbox order validation failed.", { orderId: safeString(order.id), problems: assessment.problems });
    throw new HttpError("A resposta da ordem de teste não corresponde ao comércio, vendedor ou valor esperado.", 502);
  }
  const pix = extractPixDetails(order);
  const metadata = asRecord(subscription.metadata);
  const sandbox = asRecord(metadata.sandbox);
  return {
    success: true,
    sandbox: true,
    no_real_charge: true,
    signature_status: assessment.state,
    order_status: assessment.status,
    order_status_detail: assessment.statusDetail,
    plan: safeString(sandbox.plan),
    amount_cents: amountToCents(subscription.valor),
    subscription_status: subscription.status,
    catalog_activated: false,
    reused,
    pix,
    mensagem: assessment.state === "paid"
      ? "O Mercado Pago marcou o teste como aprovado. A assinatura permanece pendente e a vitrine continua fechada."
      : "QR/código Pix de teste pronto. Este sandbox não movimenta dinheiro real e não libera a vitrine.",
  };
}

async function saveSandboxOrderState(subscription: SubscriptionRow, order: JsonRecord, sellerId: string) {
  const assessment = orderAssessment(order, subscription, sellerId);
  if (!assessment.valid) {
    console.error("Ignoring invalid sandbox order state.", { orderId: safeString(order.id), problems: assessment.problems });
    return false;
  }
  const base = asRecord(subscription.metadata);
  const sandbox = asRecord(base.sandbox);
  const metadata = metadataWithSandbox(base, {
    ...sandbox,
    sandbox_only: true,
    status: assessment.state,
    order_status: assessment.status,
    order_status_detail: assessment.statusDetail,
    verified_at: new Date().toISOString(),
  });
  const { data, error } = await admin.from("catalogo_assinaturas")
    .update({ metadata })
    .eq("id", subscription.id)
    .eq("comercio_id", subscription.comercio_id)
    .eq("status", "pendente")
    .eq("gateway", "mercadopago_sandbox")
    .eq("cobranca_id", safeString(order.id))
    .select("id")
    .maybeSingle();
  if (error) throw new Error("Falha ao registrar o estado isolado do teste.");
  return Boolean(data);
}

async function savePendingAttempt(
  commerceId: string,
  planId: string,
  amountCents: number,
  sellerId: string,
  idempotencyKey: string,
  existing: SubscriptionRow | null,
): Promise<SubscriptionRow> {
  const base = asRecord(existing?.metadata);
  const previousSandbox = asRecord(base.sandbox);
  const metadata = metadataWithSandbox(base, {
    ...previousSandbox,
    sandbox_only: true,
    plan: planId,
    amount_cents: amountCents,
    status: "creating",
    seller_id: sellerId,
    idempotency_key: idempotencyKey,
    created_at: new Date().toISOString(),
  });
  if (existing) {
    const { data, error } = await admin.from("catalogo_assinaturas")
      .update({ valor: amountCents / 100, gateway: "mercadopago_sandbox", cobranca_id: null, metadata })
      .eq("id", existing.id)
      .eq("comercio_id", commerceId)
      .eq("status", "pendente")
      .select("id,comercio_id,status,valor,gateway,cobranca_id,criado_em,pago_em,expira_em,metadata")
      .maybeSingle();
    if (error || !data) throw new HttpError("Não foi possível preparar o pedido de teste. Tente novamente.", 409);
    return data as SubscriptionRow;
  }
  const { data, error } = await admin.from("catalogo_assinaturas")
    .insert({ comercio_id: commerceId, status: "pendente", valor: amountCents / 100, gateway: "mercadopago_sandbox", metadata })
    .select("id,comercio_id,status,valor,gateway,cobranca_id,criado_em,pago_em,expira_em,metadata")
    .single();
  if (error || !data) {
    if (error?.code === "23505") throw new HttpError("Já existe uma solicitação pendente. Atualize a página e tente novamente.", 409);
    throw new Error("Não foi possível registrar o pedido sandbox.");
  }
  return data as SubscriptionRow;
}

async function attachCreatedOrder(subscription: SubscriptionRow, order: JsonRecord, sellerId: string) {
  const orderId = safeString(order.id);
  const candidate = { ...subscription, cobranca_id: orderId };
  const assessment = orderAssessment(order, candidate, sellerId);
  if (!assessment.valid || !orderId) {
    console.error("Invalid order response from Mercado Pago sandbox.", { orderId, problems: assessment.problems });
    throw new HttpError("A resposta do Mercado Pago não passou pela validação de sandbox.", 502);
  }
  const base = asRecord(subscription.metadata);
  const sandbox = asRecord(base.sandbox);
  const metadata = metadataWithSandbox(base, {
    ...sandbox,
    sandbox_only: true,
    order_id: orderId,
    status: assessment.state,
    order_status: assessment.status,
    order_status_detail: assessment.statusDetail,
    created_at: new Date().toISOString(),
  });
  const { data, error } = await admin.from("catalogo_assinaturas")
    .update({ gateway: "mercadopago_sandbox", cobranca_id: orderId, metadata })
    .eq("id", subscription.id)
    .eq("comercio_id", subscription.comercio_id)
    .eq("status", "pendente")
    .select("id,comercio_id,status,valor,gateway,cobranca_id,criado_em,pago_em,expira_em,metadata")
    .maybeSingle();
  if (error || !data) throw new HttpError("A order foi criada, mas não foi possível vinculá-la à solicitação. Não ative o catálogo; contate o suporte técnico.", 500);
  return data as SubscriptionRow;
}

async function startPixTest(owner: OwnerResult, planId: string) {
  const plan = getSandboxPlan(planId);
  if (!plan) throw new HttpError("Plano de teste inválido.", 400);
  requireSandboxConfiguration();
  const sellerId = await assertSandboxSeller();
  await ensureCatalog(owner);
  if (await getActiveSubscription(owner.commerceId)) {
    throw new HttpError("Este comércio já tem uma assinatura ativa. Não gere order sandbox para uma assinatura ativa.", 409);
  }

  let pending = await getPendingSubscription(owner.commerceId);
  if (pending && pending.gateway && pending.gateway !== "mercadopago_sandbox") {
    throw new HttpError("Já existe uma solicitação de outro tipo. Nenhuma alteração foi feita.", 409);
  }

  if (pending?.gateway === "mercadopago_sandbox" && pending.cobranca_id) {
    const previous = asRecord(pending.metadata);
    const previousSandbox = asRecord(previous.sandbox);
    if (safeString(previousSandbox.plan) === planId) {
      const order = await getMpOrder(pending.cobranca_id);
      const result = sandboxData(order, pending, true);
      await saveSandboxOrderState(pending, order, sellerId);
      if (result.signature_status !== "closed") return result;
    }
  }

  const existingMetadata = asRecord(pending?.metadata);
  const existingSandbox = asRecord(existingMetadata.sandbox);
  const canReuseKey = pending?.gateway === "mercadopago_sandbox"
    && safeString(existingSandbox.plan) === planId
    && typeof existingSandbox.idempotency_key === "string"
    && !pending.cobranca_id;
  const idempotencyKey = canReuseKey ? String(existingSandbox.idempotency_key) : crypto.randomUUID();
  pending = await savePendingAttempt(owner.commerceId, planId, plan.amountCents, sellerId, idempotencyKey, pending);

  const amount = centsToAmountString(plan.amountCents);
  const orderRequest: JsonRecord = {
    type: "online",
    external_reference: pending.id,
    total_amount: amount,
    payer: {
      email: "test_user_br@testuser.com",
      first_name: "APRO",
    },
    transactions: {
      payments: [{
        amount,
        payment_method: { id: "pix", type: "bank_transfer" },
      }],
    },
  };
  const order = await mpRequest("/v1/orders", "POST", orderRequest, idempotencyKey);
  const linked = await attachCreatedOrder(pending, order, sellerId);
  return sandboxData(order, linked, false);
}

async function refreshPixTest(owner: OwnerResult) {
  requireSandboxConfiguration();
  const sellerId = await assertSandboxSeller();
  const pending = await getPendingSubscription(owner.commerceId);
  if (!pending || pending.gateway !== "mercadopago_sandbox" || !pending.cobranca_id || asRecord(asRecord(pending.metadata).sandbox).sandbox_only !== true) {
    return { success: true, sandbox: true, has_order: false, subscription_status: pending?.status ?? "sem_assinatura", catalog_activated: false };
  }
  const order = await getMpOrder(pending.cobranca_id);
  const result = sandboxData(order, pending, true);
  await saveSandboxOrderState(pending, order, sellerId);
  return { ...result, has_order: true };
}

async function handleWebhook(request: Request, url: URL) {
  if (request.method !== "POST") return json({ success: false, mensagem: "Use POST." }, 405);
  try {
    requireSandboxConfiguration(true);
    const body = await request.json().catch(() => ({})) as JsonRecord;
    const dataId = url.searchParams.get("data.id") || safeString(asRecord(body.data).id);
    const notificationType = url.searchParams.get("type") || safeString(body.type);
    const requestId = request.headers.get("x-request-id") || "";
    const valid = await verifyWebhookSignature({
      header: request.headers.get("x-signature") || "",
      requestId,
      dataId,
      secret: MP_TEST_WEBHOOK_SECRET,
    });
    if (!valid) return json({ success: false, mensagem: "Assinatura do webhook inválida." }, 401);
    if (notificationType !== "order" || !dataId) return json({ success: true, ignored: true }, 200);

    const { data: subscription, error } = await admin.from("catalogo_assinaturas")
      .select("id,comercio_id,status,valor,gateway,cobranca_id,criado_em,pago_em,expira_em,metadata")
      .eq("gateway", "mercadopago_sandbox")
      .eq("cobranca_id", dataId)
      .eq("status", "pendente")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("Falha ao localizar o registro sandbox.");
    if (!subscription || asRecord(asRecord(subscription.metadata).sandbox).sandbox_only !== true) {
      return json({ success: true, ignored: true }, 200);
    }

    const order = await getMpOrder(dataId);
    const assessment = orderAssessment(order, subscription as SubscriptionRow, MP_TEST_SELLER_ID);
    if (!assessment.valid) {
      console.error("Ignoring Mercado Pago webhook for a non-matching sandbox order.", { orderId: dataId, problems: assessment.problems });
      return json({ success: true, ignored: true }, 200);
    }
    await saveSandboxOrderState(subscription as SubscriptionRow, order, MP_TEST_SELLER_ID);
    // Deliberately update metadata only. Never write status='ativa', pago_em or expira_em here.
    return json({ success: true, sandbox: true, catalog_activated: false }, 200);
  } catch (error) {
    if (error instanceof HttpError) return json({ success: false, mensagem: error.message }, error.status);
    console.error("Mercado Pago sandbox webhook failed:", (error as Error).message);
    return json({ success: false, mensagem: "Falha temporária no webhook sandbox." }, 503);
  }
}

// Deploy with verify_jwt=false only because the same function receives Mercado Pago webhooks.
// Browser actions still require a Bearer token validated with admin.auth.getUser above.
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
    const owner = await verifyCommerceOwner(authenticated.user.id, commerceId);
    if (owner.blocked) throw new HttpError("Este catálogo está bloqueado pela administração.", 403);

    if (action === "verificar_proprietario") {
      return json({ success: true, proprietario: true, comercio_id: commerceId, catalogo_configurado: owner.hasCatalog, sandbox: true });
    }
    if (action === "listar_planos") {
      // The private test page must not show a checkout option until the sandbox token
      // has been verified as belonging to the configured test seller.
      await assertSandboxSeller();
      return json({
        success: true,
        sandbox: true,
        no_real_charge: true,
        plans: Object.entries(SANDBOX_PLANS).map(([id, plan]) => ({
          id,
          label: plan.label,
          amount_cents: plan.amountCents,
          duration_days: plan.durationDays,
        })),
        mensagem: "Valores exibidos somente nesta área privada de teste. Não há cobrança de produção nem ativação.",
      });
    }
    if (action === "criar_pix_teste") {
      const planId = safeString(body.plano);
      const result = await startPixTest(owner, planId);
      return json(result);
    }
    if (action === "consultar_pix_teste") {
      return json(await refreshPixTest(owner));
    }
    return json({ success: false, mensagem: "Ação sandbox não reconhecida." }, 400);
  } catch (error) {
    if (error instanceof HttpError) return json({ success: false, mensagem: error.message }, error.status);
    console.error("catalogo-pix-sandbox failed:", (error as Error).message);
    return json({ success: false, mensagem: "Não foi possível concluir o teste. Nenhuma assinatura foi ativada." }, 500);
  }
});
