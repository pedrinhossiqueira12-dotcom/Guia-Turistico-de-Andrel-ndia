export const SANDBOX_PLANS = Object.freeze({
  mensal: Object.freeze({ label: "Mensal", amountCents: 5990, durationDays: 30 }),
  anual: Object.freeze({ label: "Anual", amountCents: 59990, durationDays: 365 }),
});

export function getSandboxPlan(planId) {
  return Object.hasOwn(SANDBOX_PLANS, planId) ? SANDBOX_PLANS[planId] : null;
}

export function centsToAmountString(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new TypeError("Valor em centavos inválido.");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function amountToCents(value) {
  const amount = typeof value === "number" ? value : Number(String(value ?? ""));
  if (!Number.isFinite(amount) || amount < 0) return null;
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function buildWebhookManifest({ dataId, requestId, timestamp }) {
  const fields = [];
  if (dataId) fields.push(`id:${String(dataId).toLowerCase()}`);
  if (requestId) fields.push(`request-id:${String(requestId)}`);
  if (timestamp) fields.push(`ts:${String(timestamp)}`);
  return fields.length ? `${fields.join(";")};` : "";
}

export function parseWebhookSignature(header) {
  if (typeof header !== "string") return null;
  const fields = new Map();
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    fields.set(part.slice(0, separator).trim().toLowerCase(), part.slice(separator + 1).trim());
  }
  const timestamp = fields.get("ts");
  const v1 = fields.get("v1");
  if (!timestamp || !/^\d+$/.test(timestamp) || !v1 || !/^[a-f0-9]{64}$/i.test(v1)) return null;
  return { timestamp, v1: v1.toLowerCase() };
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function verifyWebhookSignature({ header, requestId, dataId, secret }) {
  const parsed = parseWebhookSignature(header);
  if (!parsed || !requestId || !dataId || !secret) return false;
  const manifest = buildWebhookManifest({ dataId, requestId, timestamp: parsed.timestamp });
  if (!manifest) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  const expected = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return constantTimeEqual(expected, parsed.v1);
}

export function assessSandboxOrder(order, expected) {
  const problems = [];
  const expectedCents = Number(expected?.amountCents);
  const amountCents = amountToCents(order?.total_amount);
  if (!order || typeof order !== "object") problems.push("order_missing");
  if (String(order?.id ?? "") !== String(expected?.orderId ?? "")) problems.push("order_id_mismatch");
  if (String(order?.external_reference ?? "") !== String(expected?.subscriptionId ?? "")) problems.push("reference_mismatch");
  if (String(order?.user_id ?? "") !== String(expected?.sellerId ?? "")) problems.push("seller_mismatch");
  if (!Number.isSafeInteger(expectedCents) || amountCents !== expectedCents) problems.push("amount_mismatch");
  if (order?.country_code && order.country_code !== "BRA") problems.push("country_mismatch");
  if (order?.live_mode === true) problems.push("live_order_rejected");

  const payments = Array.isArray(order?.transactions?.payments) ? order.transactions.payments : [];
  const pixPayment = payments.find((payment) =>
    payment?.payment_method?.id === "pix" && payment?.payment_method?.type === "bank_transfer"
  );
  if (!pixPayment) problems.push("pix_method_mismatch");
  if (pixPayment && amountToCents(pixPayment.amount) !== expectedCents) problems.push("payment_amount_mismatch");

  if (problems.length) return { valid: false, problems, state: "invalid" };
  const paid = order.status === "processed"
    && order.status_detail === "accredited"
    && pixPayment.status === "processed"
    && pixPayment.status_detail === "accredited";
  const pending = order.status === "action_required"
    && ["waiting_transfer", "waiting_payment"].includes(order.status_detail)
    && pixPayment.status === "action_required"
    && ["waiting_transfer", "waiting_payment"].includes(pixPayment.status_detail);
  const state = paid ? "paid" : pending ? "pending" : ["canceled", "expired", "failed", "refunded", "charged_back"].includes(order.status) ? "closed" : "processing";
  return { valid: true, problems: [], state, status: String(order.status ?? ""), statusDetail: String(order.status_detail ?? "") };
}

export function extractPixDetails(order) {
  const payment = Array.isArray(order?.transactions?.payments)
    ? order.transactions.payments.find((item) => item?.payment_method?.id === "pix" && item?.payment_method?.type === "bank_transfer")
    : null;
  return {
    code: typeof payment?.payment_method?.qr_code === "string" ? payment.payment_method.qr_code : "",
    imageBase64: typeof payment?.payment_method?.qr_code_base64 === "string" ? payment.payment_method.qr_code_base64 : "",
    ticketUrl: typeof payment?.payment_method?.ticket_url === "string" ? payment.payment_method.ticket_url : "",
  };
}
