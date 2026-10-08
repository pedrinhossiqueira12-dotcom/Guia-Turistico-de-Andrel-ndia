// Testes puros de roteamento do webhook: SEM importar a Edge Function,
// sem iniciar servidor e sem qualquer rede / banco / credencial.
import { canonicalOrderType, eventId, eventKind } from "../_shared/catalogo-webhook-events.ts";
import {
  extractProviderPayment, providerFactsError, translateProviderStatus,
  verifyWebhookSignature, buildWebhookManifest,
} from "../_shared/catalogo-pagamentos-v2.ts";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}
function url(params: string): URL {
  return new URL("https://ci.example.invalid/functions/v1/mercadopago-marketplace-webhook?" + params);
}

Deno.test("webhook escolhe apenas notificacoes de pagamento ou order conhecidas", () => {
  const paymentTypes = ["payment", "payments", "payment.created", "PAYMENT.updated"];
  for (const type of paymentTypes) assert(eventKind(type, {}) === "payment", `Tipo ${type} nao identificado`);
  const orderTypes = ["order", "orders", "orders_v2", "order.created", "ORDER.updated"];
  for (const type of orderTypes) assert(eventKind(type, {}) === "order", `Tipo ${type} nao identificado`);
  for (const type of ["", "catalog", "subscription", "chargeback", "merchant_order", "custom_payment"]) {
    if (!type) continue;
    assert(eventKind(type, { status: "approved", resource: "/v1/payments/123" }) === null, `Evento desconhecido promovido: ${type}`);
  }
  assert(eventKind("", { resource: "https://api.mercadopago.com/v1/payments/123" }) === "payment", "Fallback de payment quebrado");
  assert(eventKind("", { resource: "/v1/orders/order_123" }) === "order", "Fallback de order quebrado");
  assert(eventKind("", { status: "approved" }) === null, "Status nao comprova tipo de evento");
});

Deno.test("webhook usa data.id assinado, nao id de notificacao", () => {
  assert(eventId(url("type=payment&data.id=pay_123"), { id: "webhook-987", data: { id: "pay_123" } }) === "pay_123", "ID da notificacao substituiu ID do pagamento");
  assert(eventId(url("type=payment&data.id=pay_123"), { id: "webhook-987", data: { id: "pay_999" } }) === "", "IDs de pagamento conflitantes aceitos");
  assert(eventId(url("type=payment&data.id=pay_123"), { data: { id: "pay_123" }, id: "some-unrelated-notification" }) === "pay_123", "ID authoritative incorreto");
  assert(eventId(url("type=payment"), { data: { id: "pay_123" }, id: "webhook-987" }) === "pay_123", "Body data.id nao teve prioridade");
  assert(eventId(url("id=pay_123"), {}) === "pay_123", "ID legado nao encontrado");
  assert(eventId(url("id=pay_123"), { id: "pay_999" }) === "", "IDs legados conflitantes aceitos");
  assert(eventId(url("type=payment"), {}) === "", "ID vazio aceito");
  assert(eventId(url("type=payment&data.id=..%2Fpayments%2F1"), { data: { id: "../payments/1" } }) === "", "Path traversal aceito");
  assert(eventId(url("type=payment&data.id=123"), { data: { id: " 123 " } }) === "123", "ID numerico valido recusado");
  assert(eventId(url("type=payment&data.id=pay%3Fadmin%3D1"), {}) === "", "Parametro URL incorporado ao ID");
  assert(eventId(url("type=payment"), { data: { id: {} } }) === "", "ID de objeto aceito");
  assert(eventId(url("type=payment"), { data: { id: "a".repeat(121) } }) === "", "ID longo aceito");
});

Deno.test("reenvio de order para fatura preserva somente o tipo canonico", () => {
  assert(canonicalOrderType(url("type=orders_v2"), {}) === "orders_v2", "Orders V2 nao canonico");
  assert(canonicalOrderType(url("type=orders"), {}) === "orders_v2", "Alias orders nao canonico");
  assert(canonicalOrderType(url("type=order"), {}) === "order", "Order V1 nao canonico");
  assert(canonicalOrderType(url("type=unknown"), { type: "orders_v2" }) === "order", "Query inesperada promovida a orders_v2");
  assert(canonicalOrderType(url(""), { type: "orders_v2" }) === "orders_v2", "Body V2 valido nao reconhecido");
});

Deno.test("webhook ignora campos financeiros enviados no POST e usa fatos autenticados", () => {
  // Factos do Mercado Pago são a ÚNICA fonte financeira; body do webhook não
  // participa de extractProviderPayment/providerFactsError.
  const provider = {
    id: "pay_verified", external_reference: "guia-ci-123", collector_id: 1234,
    currency_id: "BRL", transaction_amount: "1.01", application_fee: "0.07",
    status: "approved",
  };
  const fakeNotification = {
    id: "notification-1", data: { id: "pay_verified" }, status: "approved",
    transaction_amount: "9000000.00", collector_id: 9999, application_fee: "0.00",
  };
  assert(eventId(url("type=payment&data.id=pay_verified"), fakeNotification) === provider.id, "Pagamento autenticado nao identificado");
  const facts = extractProviderPayment(provider, "payment");
  assert(!providerFactsError(facts, "pay_verified", "guia-ci-123", "1234", 101), "Fatos autenticados rejeitados");
  assert(facts.feeCentavos === 7 && facts.amountCentavos === 101, "Valor do POST substituiu fatos do provedor");
  for (const [mutation, label] of [
    [{ ...provider, id: "pay_fake" }, "payment_id"],
    [{ ...provider, external_reference: "guia-outro" }, "reference"],
    [{ ...provider, collector_id: 9999 }, "seller"],
    [{ ...provider, currency_id: "USD" }, "currency"],
    [{ ...provider, transaction_amount: "1.00" }, "amount"],
    [{ ...provider, transaction_amount: "1.001" }, "precision"],
  ] as const) {
    assert(Boolean(providerFactsError(extractProviderPayment(mutation, "payment"), "pay_verified", "guia-ci-123", "1234", 101)), `Fatos falsos aceitos: ${label}`);
  }
});

Deno.test("order V2 valida valor, recebedor, referencia e estado terminal", () => {
  const order = {
    id: "order_verified", external_reference: "guia-ci-456", user_id: 1234,
    currency_code: "BRL", total_amount: "1.01",
    status: "processed", status_detail: "accredited",
    transactions: { payments: [{ id: "payment_verified", amount: "1.01", application_fee: "0.07" }] },
  };
  const facts = extractProviderPayment(order, "order");
  assert(!providerFactsError(facts, "order_verified", "guia-ci-456", "1234", 101), "Order valida recusada");
  assert(facts.state === "aprovado" && facts.feeCentavos === 7, "Order perdeu status/taxa");
  assert(translateProviderStatus({ ...order, status: "charged_back" }) === "contestado", "Chargeback aprovado");
  assert(translateProviderStatus({ ...order, status: "refunded" }) === "estornado", "Estorno aprovado");
  assert(translateProviderStatus({ ...order, status: "approved", transaction_amount: "1.01", transaction_amount_refunded: "0.50" }) === "revisao_parcial", "Estorno parcial virou aprovacao");
});

Deno.test("HMAC de notificacao requer ID e request-id corretos e janela temporal", async () => {
  const secret = "ci-webhook-secret-nao-real", requestId = "ci-req-123", dataId = "pay_123";
  const now = 1760000000000, ts = String(Math.floor(now / 1000));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(buildWebhookManifest(dataId, requestId, ts)));
  const hmac = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  const header = `ts=${ts},v1=${hmac}`;
  const check = (changes: Record<string,unknown> = {}) =>
    verifyWebhookSignature({ header, requestId, dataId, secret, now, ...changes });
  assert(await check(), "Assinatura valida recusada");
  assert(!(await check({ dataId: "pay_999" })), "ID trocado e assinado incorretamente aceito");
  assert(!(await check({ requestId: "ci-req-999" })), "Request ID falsificado aceito");
  assert(!(await check({ secret: "ci-outro-secret" })), "Secret falsificado aceito");
  assert(!(await check({ now: now + 6 * 60 * 1000 })), "Replay apos janela aceito");
  assert(!(await check({ now: now - 6 * 60 * 1000 })), "Timestamp futuro aceito");
  assert(!(await check({ header: "ts=1760000000,v1=" + "0".repeat(64) })), "Assinatura incorreta aceita");
});
