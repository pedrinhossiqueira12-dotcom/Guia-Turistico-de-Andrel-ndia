import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  SANDBOX_PLANS,
  amountToCents,
  assessSandboxOrder,
  buildWebhookManifest,
  centsToAmountString,
  extractPixDetails,
  getSandboxPlan,
  parseWebhookSignature,
  verifyWebhookSignature,
} from "../supabase/functions/catalogo-pix-sandbox/mercadopago-utils.mjs";

const ORDER = {
  id: "ORD_TEST_123",
  type: "online",
  external_reference: "subscription-uuid-123",
  total_amount: "59.90",
  country_code: "BRA",
  user_id: "987654321",
  status: "action_required",
  status_detail: "waiting_transfer",
  transactions: {
    payments: [{
      amount: "59.90",
      status: "action_required",
      status_detail: "waiting_transfer",
      payment_method: {
        id: "pix",
        type: "bank_transfer",
        qr_code: "000201-pix-test",
        qr_code_base64: "aW1hZ2VtLXRlc3Rl",
        ticket_url: "https://www.mercadopago.com.br/sandbox/payments/test/ticket",
      },
    }],
  },
};
const EXPECTED = { orderId: "ORD_TEST_123", subscriptionId: "subscription-uuid-123", sellerId: "987654321", amountCents: 5990 };

function makeSignature({ dataId = "ORD_TEST_123", requestId = "request-abc", timestamp = "1781009491", secret = "segredo-de-teste" } = {}) {
  const manifest = buildWebhookManifest({ dataId, requestId, timestamp });
  const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
  return { header: `ts=${timestamp},v1=${v1}`, requestId, dataId, secret };
}

test("planos sandbox têm os valores escolhidos, convertidos em centavos inteiros", () => {
  assert.equal(SANDBOX_PLANS.mensal.amountCents, 5990);
  assert.equal(SANDBOX_PLANS.anual.amountCents, 59990);
  assert.equal(getSandboxPlan("mensal").durationDays, 30);
  assert.equal(getSandboxPlan("anual").durationDays, 365);
  assert.equal(getSandboxPlan("qualquer outro"), null);
  assert.equal(centsToAmountString(5990), "59.90");
  assert.equal(centsToAmountString(59990), "599.90");
  assert.equal(amountToCents("599.90"), 59990);
  assert.equal(amountToCents("valor inválido"), null);
});

test("manifest oficial inclui data.id, x-request-id e timestamp", () => {
  assert.equal(
    buildWebhookManifest({ dataId: "ABC-1", requestId: "req-1", timestamp: "123" }),
    "id:abc-1;request-id:req-1;ts:123;",
  );
});

test("parsing de x-signature é independente da ordem dos campos", () => {
  const validHash = "a".repeat(64);
  assert.deepEqual(parseWebhookSignature(`v1=${validHash},ts=12345`), { timestamp: "12345", v1: validHash });
  assert.equal(parseWebhookSignature("v1=nope,ts=123"), null);
  assert.equal(parseWebhookSignature("ts=abc,v1=" + validHash), null);
});

test("valida assinatura HMAC correta e rejeita adulteração", async () => {
  const signature = makeSignature();
  assert.equal(await verifyWebhookSignature({ ...signature }), true);
  assert.equal(await verifyWebhookSignature({ ...signature, dataId: "ORD_TAMPERED" }), false);
  assert.equal(await verifyWebhookSignature({ ...signature, secret: "outro-segredo" }), false);
  assert.equal(await verifyWebhookSignature({ ...signature, requestId: "" }), false);
});

test("order pendente Pix só passa com seller, referência e valor esperados", () => {
  assert.deepEqual(assessSandboxOrder(ORDER, EXPECTED).state, "pending");
  assert.equal(assessSandboxOrder({ ...ORDER, user_id: "outro" }, EXPECTED).valid, false);
  assert.equal(assessSandboxOrder({ ...ORDER, external_reference: "outro" }, EXPECTED).valid, false);
  assert.equal(assessSandboxOrder({ ...ORDER, total_amount: "50.00" }, EXPECTED).valid, false);
  assert.equal(assessSandboxOrder({ ...ORDER, live_mode: true }, EXPECTED).valid, false);
  assert.equal(assessSandboxOrder({ ...ORDER, country_code: "ARG" }, EXPECTED).valid, false);
});

test("só uma order processada e acreditada é classificada como paga", () => {
  const paid = {
    ...ORDER,
    status: "processed",
    status_detail: "accredited",
    transactions: { payments: [{ ...ORDER.transactions.payments[0], status: "processed", status_detail: "accredited" }] },
  };
  assert.equal(assessSandboxOrder(paid, EXPECTED).state, "paid");
  assert.equal(assessSandboxOrder({ ...paid, status_detail: "partially_refunded" }, EXPECTED).state, "processing");
  assert.equal(assessSandboxOrder({
    ...paid,
    transactions: { payments: [{ ...paid.transactions.payments[0], status: "action_required", status_detail: "waiting_transfer" }] },
  }, EXPECTED).state, "processing");
  assert.equal(assessSandboxOrder({ ...ORDER, status: "expired", status_detail: "expired" }, EXPECTED).state, "closed");
});

test("não aceita outros métodos de pagamento como se fossem Pix", () => {
  const cardOrder = {
    ...ORDER,
    transactions: { payments: [{ amount: "59.90", payment_method: { id: "visa", type: "credit_card" } }] },
  };
  assert.equal(assessSandboxOrder(cardOrder, EXPECTED).valid, false);
});

test("extrai código, imagem e link do QR Pix sem inventar dados", () => {
  assert.deepEqual(extractPixDetails(ORDER), {
    code: "000201-pix-test",
    imageBase64: "aW1hZ2VtLXRlc3Rl",
    ticketUrl: "https://www.mercadopago.com.br/sandbox/payments/test/ticket",
  });
  assert.deepEqual(extractPixDetails({}), { code: "", imageBase64: "", ticketUrl: "" });
});
