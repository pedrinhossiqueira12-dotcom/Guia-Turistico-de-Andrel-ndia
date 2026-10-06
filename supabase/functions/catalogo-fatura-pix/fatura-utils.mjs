// Utilitários puros da cobrança Pix da fatura mensal de comissões presenciais.
// Nenhuma chamada de rede acontece aqui: as funções apenas validam e normalizam
// dados, para que possam ser testadas localmente sem credenciais.

export function centsToAmountString(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new TypeError("Valor em centavos inválido.");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function amountToCents(value) {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function isComercioId(value) {
  return typeof value === "string" && /^[a-z0-9-]{1,180}$/.test(value);
}

export function isCompetencia(value) {
  return normalizarCompetencia(value) === value;
}

// Aceita `AAAA-MM` e também `AAAA-MM-DD`, devolvendo sempre a competência do mês.
export function normalizarCompetencia(value) {
  if (typeof value !== "string") return "";
  const match = /^(\d{4}-\d{2})(?:-\d{2})?$/.exec(value.trim());
  return match ? match[1] : "";
}

// Referência estável da fatura: permite reconciliar a order do provedor com a
// competência do comércio sem depender apenas do ID gerado pelo Mercado Pago.
export function montarReferenciaFatura(comercioId, competencia) {
  const mes = normalizarCompetencia(competencia);
  if (!isComercioId(comercioId) || !mes) return "";
  return `fatura-${comercioId}-${mes}`;
}

export function chaveIdempotenciaFatura({ fechamentoId, tentativa = 1 }) {
  const id = String(fechamentoId ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return "";
  const numero = Number.isInteger(tentativa) && tentativa > 1 ? `-t${tentativa}` : "";
  return `fatura-${id}${numero}`;
}

// A fatura só é liberada quando está faturada, vencida ou bloqueada por dívida
// e possui valor devido positivo. Fatura paga nunca gera nova cobrança.
export function podeEmitirCobranca(fechamento) {
  if (!fechamento || typeof fechamento !== "object") return { ok: false, mensagem: "Fatura não encontrada.", valorCentavos: 0 };
  const status = String(fechamento.status ?? "");
  const valor = Number(fechamento.total_comissao_centavos ?? 0);
  if (status === "pago") return { ok: false, mensagem: "Esta fatura já está paga.", valorCentavos: 0 };
  if (!["faturado", "vencido", "bloqueado"].includes(status)) {
    return { ok: false, mensagem: "A fatura ainda não está fechada para cobrança.", valorCentavos: 0 };
  }
  if (!Number.isSafeInteger(valor) || valor <= 0) return { ok: false, mensagem: "Não há comissão a cobrar nesta competência.", valorCentavos: 0 };
  return { ok: true, mensagem: "", valorCentavos: valor };
}

function firstPixPayment(order) {
  const payments = Array.isArray(order?.transactions?.payments) ? order.transactions.payments : [];
  return payments.find((payment) =>
    payment?.payment_method?.id === "pix" && payment?.payment_method?.type === "bank_transfer"
  ) || null;
}

export function extractPixDetails(order) {
  const payment = firstPixPayment(order);
  return {
    code: typeof payment?.payment_method?.qr_code === "string" ? payment.payment_method.qr_code : "",
    imageBase64: typeof payment?.payment_method?.qr_code_base64 === "string" ? payment.payment_method.qr_code_base64 : "",
    ticketUrl: typeof payment?.payment_method?.ticket_url === "string" ? payment.payment_method.ticket_url : "",
  };
}

// Traduz o estado consolidado da order para o estado aceito pela rotina SQL.
export function estadoCobrancaDaOrder(estado) {
  const mapa = {
    aprovado: "pago",
    pendente: "pendente",
    expirado: "expirado",
    cancelado: "cancelado",
    recusado: "cancelado",
    estornado: "estornado",
    contestado: "contestado",
  };
  return Object.hasOwn(mapa, estado) ? mapa[estado] : "";
}

export function detalheCobrancaDaOrder(order) {
  const payments = Array.isArray(order?.transactions?.payments) ? order.transactions.payments : [];
  const payment = payments[0] || {};
  const status = String(order?.status ?? "");
  const statusDetail = String(order?.status_detail ?? "");
  const paymentStatus = String(payment?.status ?? "");
  const paymentStatusDetail = String(payment?.status_detail ?? "");
  const resumo = [status, statusDetail, paymentStatus, paymentStatusDetail].filter(Boolean).join(" / ");
  return resumo.slice(0, 480);
}

// Mesma régua de validação usada na assinatura: só aceita order Pix íntegra,
// da conta recebedora esperada, com o valor exato da fatura e referência conferida.
export function assessFaturaOrder(order, expected) {
  const problems = [];
  const expectedCents = Number(expected?.amountCents);
  const payments = Array.isArray(order?.transactions?.payments) ? order.transactions.payments : [];
  const pixPayments = payments.filter((payment) =>
    payment?.payment_method?.id === "pix" && payment?.payment_method?.type === "bank_transfer"
  );
  const pixPayment = pixPayments.length === 1 ? pixPayments[0] : null;
  const expectedPaymentId = String(expected?.paymentId ?? "");
  const matchedPayment = expectedPaymentId
    ? payments.find((payment) => String(payment?.id ?? "") === expectedPaymentId) || null
    : null;
  const orderStatus = String(order?.status ?? "");
  const orderStatusDetail = String(order?.status_detail ?? "");
  const matchedStatus = String((pixPayment || matchedPayment)?.status ?? "");
  const matchedStatusDetail = String((pixPayment || matchedPayment)?.status_detail ?? "");
  const rawStatuses = `${orderStatus} ${orderStatusDetail} ${matchedStatus} ${matchedStatusDetail}`.toLowerCase();
  const terminalState = orderStatus === "charged_back" || rawStatuses.includes("charged_back")
    || ["refunded", "partially_refunded"].some((value) => rawStatuses.includes(value))
    || ["expired", "canceled", "cancelled", "failed"].some((value) => rawStatuses.split(/\s+/).includes(value));
  const matchedMethod = matchedPayment?.payment_method;
  const matchedMethodOmitted = !matchedMethod || (matchedMethod.id == null && matchedMethod.type == null);
  const allowMissingTransaction = terminalState && Boolean(expectedPaymentId)
    && (payments.length === 0 || (payments.length === 1 && Boolean(matchedPayment) && matchedMethodOmitted));
  const paymentRecord = pixPayment || (allowMissingTransaction ? matchedPayment : null);
  const amountCents = amountToCents(order?.total_amount);
  const ticketUrl = String(paymentRecord?.payment_method?.ticket_url ?? "");
  let validTicketUrl = false;
  try {
    const parsedTicket = new URL(ticketUrl);
    validTicketUrl = parsedTicket.protocol === "https:"
      && ["www.mercadopago.com.br", "mercadopago.com.br"].includes(parsedTicket.hostname)
      && !/sandbox/i.test(ticketUrl);
  } catch { /* ticket ausente ou inválido */ }

  if (!order || typeof order !== "object" || Array.isArray(order)) problems.push("order_missing");
  if (String(order?.id ?? "") !== String(expected?.orderId ?? "")) problems.push("order_id_mismatch");
  if (String(order?.external_reference ?? "") !== String(expected?.externalReference ?? "")) problems.push("reference_mismatch");
  if (order?.type !== "online") problems.push("order_type_mismatch");
  if (order?.user_id !== undefined && order?.user_id !== null && String(order.user_id) !== String(expected?.sellerId ?? "")) problems.push("seller_mismatch");
  if (!Number.isSafeInteger(expectedCents) || amountCents !== expectedCents) problems.push("amount_mismatch");
  if (!["BR", "BRA"].includes(String(order?.country_code ?? ""))) problems.push("country_mismatch");
  if (order?.live_mode === false) problems.push("not_live_order");
  if (pixPayments.length > 1) problems.push("multiple_pix_payments");
  if (!pixPayment && !allowMissingTransaction) problems.push("pix_method_mismatch");
  if (!pixPayment && matchedPayment && !allowMissingTransaction) problems.push("pix_method_mismatch");
  if (pixPayment && expectedPaymentId && String(pixPayment.id ?? "") && String(pixPayment.id) !== expectedPaymentId) problems.push("payment_id_mismatch");
  if (paymentRecord && amountToCents(paymentRecord.amount) !== expectedCents && !(terminalState && amountToCents(paymentRecord.amount) === null)) problems.push("payment_amount_mismatch");

  const status = orderStatus;
  const statusDetail = orderStatusDetail;
  const paymentStatus = matchedStatus;
  const paymentStatusDetail = matchedStatusDetail;
  const allStatus = `${status} ${statusDetail} ${paymentStatus} ${paymentStatusDetail}`.toLowerCase();

  let state = "desconhecido";
  if (status === "charged_back" || allStatus.includes("charged_back")) {
    state = "contestado";
  } else if (
    status === "refunded" || statusDetail === "refunded" || statusDetail === "partially_refunded" ||
    paymentStatus === "refunded" || paymentStatusDetail === "refunded" || paymentStatusDetail === "partially_refunded"
  ) {
    state = "estornado";
  } else if (
    status === "processed" && statusDetail === "accredited" &&
    paymentStatus === "processed" && paymentStatusDetail === "accredited"
  ) {
    state = "aprovado";
  } else if (status === "expired" || statusDetail === "expired") {
    state = "expirado";
  } else if (["canceled", "cancelled"].includes(status)) {
    state = "cancelado";
  } else if (status === "failed") {
    state = "recusado";
  } else if (
    (status === "action_required" && ["waiting_transfer", "waiting_payment"].includes(statusDetail)
      && paymentStatus === "action_required" && paymentStatusDetail === statusDetail) ||
    (status === "processing" && statusDetail === "in_process"
      && ["processing", "action_required"].includes(paymentStatus)
      && ["in_process", "waiting_transfer", "waiting_payment"].includes(paymentStatusDetail)) ||
    (status === "created" && statusDetail === "created"
      && ["created", "action_required"].includes(paymentStatus)
      && ["created", "waiting_transfer", "waiting_payment"].includes(paymentStatusDetail))
  ) {
    state = "pendente";
  }

  if (expected?.requirePixArtifacts === true) {
    if (!pixPayment || !String(pixPayment.id ?? "")) problems.push("payment_id_missing");
    if (state === "pendente" && !validTicketUrl) problems.push("ticket_url_invalid_or_missing");
  }
  if (ticketUrl && /sandbox/i.test(ticketUrl) && (expected?.requirePixArtifacts === true || state === "pendente")) {
    problems.push("sandbox_ticket");
  }

  if (problems.length) return { valid: false, problems, state: "invalid" };

  return {
    valid: true,
    problems: [],
    state,
    status,
    statusDetail,
    paymentStatus,
    paymentStatusDetail,
    paymentId: String(paymentRecord?.id ?? expectedPaymentId),
  };
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
  if (!timestamp || !/^\d{10,13}$/.test(timestamp) || !v1 || !/^[a-f0-9]{64}$/i.test(v1)) return null;
  return { timestamp, v1: v1.toLowerCase() };
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function verifyWebhookSignature({ header, requestId, dataId, secret, now = Date.now(), maxAgeMs = 24 * 60 * 60 * 1000 }) {
  const parsed = parseWebhookSignature(header);
  if (!parsed || !requestId || !dataId || !secret) return false;
  const timestampMs = parsed.timestamp.length === 10 ? Number(parsed.timestamp) * 1000 : Number(parsed.timestamp);
  if (!Number.isSafeInteger(timestampMs) || Math.abs(now - timestampMs) > maxAgeMs) return false;

  const manifest = buildWebhookManifest({ dataId, requestId, timestamp: parsed.timestamp });
  if (!manifest) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  const expected = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return constantTimeEqual(expected, parsed.v1);
}
