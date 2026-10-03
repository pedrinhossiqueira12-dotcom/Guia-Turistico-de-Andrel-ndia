import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  PRODUCTION_PLANS,
  amountToCents,
  assessProductionOrder,
  buildWebhookManifest,
  centsToAmountString,
  extractPixDetails,
  getProductionPlan,
  verifyWebhookSignature,
} from "../supabase/functions/catalogo-pix-producao/mercadopago-utils.mjs";

const ORDER = {
  id: "ORD_LIVE_1",
  type: "online",
  external_reference: "payment-ref-1",
  total_amount: "59.90",
  country_code: "BRA",
  user_id: "123456789",
  live_mode: true,
  status: "action_required",
  status_detail: "waiting_transfer",
  transactions: {
    payments: [{
      id: "PAY_LIVE_1",
      amount: "59.90",
      status: "action_required",
      status_detail: "waiting_transfer",
      payment_method: { id: "pix", type: "bank_transfer", qr_code: "pix-live-code", qr_code_base64: "bGl2ZS1xci1pbWFnZQ==", ticket_url: "https://www.mercadopago.com.br/payments/live" },
    }],
  },
};
const EXPECTED = { orderId: "ORD_LIVE_1", externalReference: "payment-ref-1", sellerId: "123456789", amountCents: 5990, paymentId: "PAY_LIVE_1" };

function signedWebhook({ now = Date.now(), dataId = "ORD_LIVE_1", requestId = "request-1", secret = "prod-webhook-test" } = {}) {
  const timestamp = String(now);
  const manifest = buildWebhookManifest({ dataId, requestId, timestamp });
  const digest = createHmac("sha256", secret).update(manifest).digest("hex");
  return { header: `ts=${timestamp},v1=${digest}`, dataId, requestId, secret, now };
}

test("planos de produção mantêm preços fixos em centavos e períodos manuais", () => {
  assert.equal(PRODUCTION_PLANS.mensal.amountCents, 5990);
  assert.equal(PRODUCTION_PLANS.anual.amountCents, 59990);
  assert.equal(getProductionPlan("mensal").durationDays, 30);
  assert.equal(getProductionPlan("anual").durationDays, 365);
  assert.equal(getProductionPlan("outro"), null);
  assert.equal(centsToAmountString(5990), "59.90");
  assert.equal(centsToAmountString(59990), "599.90");
  assert.equal(amountToCents("59.9"), 5990);
  assert.equal(amountToCents("59.901"), null);
  assert.equal(amountToCents("texto"), null);
});

test("só order online de Pix, país, recebedor configurado, referência e valores esperados é válida", () => {
  assert.equal(assessProductionOrder(ORDER, EXPECTED).state, "pendente");
  assert.equal(assessProductionOrder({ ...ORDER, live_mode: false }, EXPECTED).valid, false);
  assert.equal(assessProductionOrder({ ...ORDER, user_id: "outro" }, EXPECTED).valid, false);
  assert.equal(assessProductionOrder({ ...ORDER, external_reference: "outro" }, EXPECTED).valid, false);
  assert.equal(assessProductionOrder({ ...ORDER, total_amount: "1.00" }, EXPECTED).valid, false);
  assert.equal(assessProductionOrder({ ...ORDER, country_code: "ARG" }, EXPECTED).valid, false);
  assert.equal(assessProductionOrder({ ...ORDER, country_code: "BR", live_mode: undefined, user_id: undefined }, EXPECTED).valid, true);
  assert.equal(assessProductionOrder({ ...ORDER, transactions: { payments: [{ ...ORDER.transactions.payments[0], payment_method: { ...ORDER.transactions.payments[0].payment_method, ticket_url: "https://www.mercadopago.com.br/sandbox/payments/ticket" } }] } }, EXPECTED).valid, false);
  const missingId = { ...ORDER, transactions: { payments: [{ ...ORDER.transactions.payments[0], id: undefined }] } };
  assert.equal(assessProductionOrder(missingId, { ...EXPECTED, paymentId: undefined, requirePixArtifacts: true }).valid, false);
  const noTicket = { ...ORDER, transactions: { payments: [{ ...ORDER.transactions.payments[0], payment_method: { ...ORDER.transactions.payments[0].payment_method, ticket_url: undefined } }] } };
  assert.equal(assessProductionOrder(noTicket, EXPECTED).valid, true);
  assert.equal(assessProductionOrder(noTicket, { ...EXPECTED, requirePixArtifacts: true }).valid, false);
  assert.equal(assessProductionOrder({ ...ORDER, transactions: { payments: [{ amount: "59.90", payment_method: { id: "visa", type: "credit_card" } }] } }, EXPECTED).valid, false);
});

test("aprovação só exige status accredited na order e no pagamento Pix", () => {
  const paid = {
    ...ORDER,
    status: "processed",
    status_detail: "accredited",
    transactions: { payments: [{ ...ORDER.transactions.payments[0], status: "processed", status_detail: "accredited" }] },
  };
  assert.equal(assessProductionOrder(paid, EXPECTED).state, "aprovado");
  assert.equal(assessProductionOrder({ ...paid, status_detail: "in_process" }, EXPECTED).state, "desconhecido");
});

test("status Pix ainda não mapeado falha fechado em vez de parecer pendente", () => {
  const futureStatus = { ...ORDER, status: "new_provider_state", status_detail: "new_detail" };
  assert.equal(assessProductionOrder(futureStatus, EXPECTED).state, "desconhecido");
});

test("estorno integral/parcial e chargeback viram estados de revogação", () => {
  assert.equal(assessProductionOrder({ ...ORDER, status: "refunded", status_detail: "refunded" }, EXPECTED).state, "estornado");
  assert.equal(assessProductionOrder({ ...ORDER, status: "processed", status_detail: "partially_refunded" }, EXPECTED).state, "estornado");
  assert.equal(assessProductionOrder({ ...ORDER, status: "charged_back", status_detail: "in_process" }, EXPECTED).state, "contestado");
  assert.equal(assessProductionOrder({ ...ORDER, status: "charged_back", status_detail: "reimbursed" }, EXPECTED).state, "contestado");
  const refundedWithoutTransactionDetails = { ...ORDER, status: "refunded", status_detail: "refunded", transactions: { payments: [] } };
  assert.equal(assessProductionOrder(refundedWithoutTransactionDetails, EXPECTED).valid, true);
  assert.equal(assessProductionOrder(refundedWithoutTransactionDetails, EXPECTED).state, "estornado");
});

test("pedido expirado, cancelado ou recusado nunca é marcado como pago", () => {
  assert.equal(assessProductionOrder({ ...ORDER, status: "expired", status_detail: "expired" }, EXPECTED).state, "expirado");
  assert.equal(assessProductionOrder({ ...ORDER, status: "canceled", status_detail: "canceled" }, EXPECTED).state, "cancelado");
  assert.equal(assessProductionOrder({ ...ORDER, status: "failed", status_detail: "failed" }, EXPECTED).state, "recusado");
});

test("extrai apenas dados Pix fornecidos pela API", () => {
  assert.deepEqual(extractPixDetails(ORDER), {
    code: "pix-live-code",
    imageBase64: "bGl2ZS1xci1pbWFnZQ==",
    ticketUrl: "https://www.mercadopago.com.br/payments/live",
  });
  assert.deepEqual(extractPixDetails({}), { code: "", imageBase64: "", ticketUrl: "" });
});

test("HMAC válido com timestamp recente passa; assinatura adulterada/antiga falha", async () => {
  const now = Date.now();
  const signature = signedWebhook({ now });
  assert.equal(await verifyWebhookSignature(signature), true);
  assert.equal(await verifyWebhookSignature({ ...signature, dataId: "ORD_TAMPERED" }), false);
  assert.equal(await verifyWebhookSignature({ ...signature, secret: "different-secret" }), false);
  const stale = signedWebhook({ now: now - 25 * 60 * 60 * 1000 });
  assert.equal(await verifyWebhookSignature({ ...stale, now }), false);
});
