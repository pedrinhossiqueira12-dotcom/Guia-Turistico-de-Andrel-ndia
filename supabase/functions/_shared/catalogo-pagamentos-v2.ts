export type FinancialSnapshot = {
  versao_financeira: number;
  taxa_plataforma_centavos: number;
  taxa_motoboy_centavos: number;
  taxa_total_centavos: number;
  somente_pix: boolean;
  ativo: boolean;
};

export type ProviderState = "aprovado" | "pendente" | "estornado" | "contestado" | "cancelado" | "expirado" | "revisao_parcial";

export type ProviderPaymentFacts = {
  id: string;
  reference: string;
  collectorId: string;
  currency: string;
  amountCentavos: number | null;
  feeCentavos: number | null;
  status: string;
  statusDetail: string;
  state: ProviderState;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function amountToCents(value: unknown): number | null {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : null;
}

export function centsToMoney(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Valor em centavos inválido.");
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

export function normalizeFinancialSnapshot(value: unknown, modalidade: string, subtotalCentavos: number): FinancialSnapshot {
  const raw = Array.isArray(value) ? record(value[0]) : record(value);
  const versao = Number(raw.versao_financeira ?? 1);
  const plataforma = Number(raw.taxa_plataforma_centavos);
  const motoboy = Number(raw.taxa_motoboy_centavos ?? 0);
  const total = Number(raw.taxa_total_centavos);
  if (!Number.isInteger(versao) || versao < 1 || versao > 2
    || !Number.isSafeInteger(plataforma) || plataforma < 0 || plataforma > 2147483647
    || !Number.isSafeInteger(motoboy) || motoboy < 0 || motoboy > 2147483647
    || !Number.isSafeInteger(total) || total < 0 || total > 2147483647
    || !Number.isSafeInteger(subtotalCentavos) || subtotalCentavos <= 0 || subtotalCentavos > 2147483647) {
    throw new Error("Snapshot financeiro inválido.");
  }
  const taxaLegada = Math.round(subtotalCentavos * 0.05);
  const taxaMotoboy = Math.round(subtotalCentavos * 0.02);
  const taxaV2 = Math.round(subtotalCentavos * 0.07);
  if (modalidade !== "entrega" && motoboy !== 0) throw new Error("Taxa de motoboy inválida para esta modalidade.");
  if (total !== plataforma + motoboy) throw new Error("Snapshot financeiro não fecha.");
  if (versao === 1) {
    if (plataforma !== taxaLegada || motoboy !== 0) throw new Error("Snapshot legado inválido.");
  } else if (modalidade === "entrega") {
    // Aceita snapshots historicos (5% + 2% separados) e os novos (7% arredondados uma vez).
    if (motoboy !== taxaMotoboy || (plataforma !== taxaLegada && plataforma !== taxaV2 - motoboy)) {
      throw new Error("Snapshot de entrega v2 divergente.");
    }
  } else if (plataforma !== taxaV2) {
    throw new Error("Snapshot sem entrega v2 divergente.");
  }
  return {
    versao_financeira: versao,
    taxa_plataforma_centavos: plataforma,
    taxa_motoboy_centavos: motoboy,
    taxa_total_centavos: total,
    somente_pix: raw.somente_pix === true,
    ativo: raw.ativo === true,
  };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function uuidFromParts(...parts: string[]): Promise<string> {
  const digest = (await sha256Hex(parts.join("\u001f"))).slice(0, 32).split("");
  digest[12] = "5";
  digest[16] = ((Number.parseInt(digest[16], 16) & 0x3) | 0x8).toString(16);
  return `${digest.slice(0, 8).join("")}-${digest.slice(8, 12).join("")}-${digest.slice(12, 16).join("")}-${digest.slice(16, 20).join("")}-${digest.slice(20).join("")}`;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===";
  const binary = atob(padded.slice(0, padded.length - (padded.length % 4)));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function hexBytes(value: string): Uint8Array {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error("Chave criptográfica inválida.");
  return Uint8Array.from(value.match(/.{1,2}/g) || [], (pair) => Number.parseInt(pair, 16));
}

export async function encryptAesGcm(value: string, keyHex: string, aad = ""): Promise<string> {
  const key = await crypto.subtle.importKey("raw", hexBytes(keyHex) as unknown as BufferSource, "AES-GCM", false, ["encrypt"]);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) }, key, new TextEncoder().encode(value)));
  return `${base64Url(iv)}.${base64Url(ciphertext)}`;
}

export async function decryptAesGcm(value: string, keyHex: string, aad = ""): Promise<string> {
  const [encodedIv, encodedCipher, extra] = value.split(".");
  if (!encodedIv || !encodedCipher || extra !== undefined || !/^[A-Za-z0-9_-]+$/.test(encodedIv) || !/^[A-Za-z0-9_-]+$/.test(encodedCipher)) throw new Error("Segredo cifrado inválido.");
  if (fromBase64Url(encodedIv).length !== 12 || fromBase64Url(encodedCipher).length < 16) throw new Error("Segredo cifrado inválido.");
  const key = await crypto.subtle.importKey("raw", hexBytes(keyHex) as unknown as BufferSource, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(encodedIv) as unknown as BufferSource, additionalData: new TextEncoder().encode(aad) as unknown as BufferSource }, key, fromBase64Url(encodedCipher) as unknown as BufferSource);
  return new TextDecoder().decode(plain);
}

export function randomHex(bytes = 32): string {
  if (!Number.isInteger(bytes) || bytes < 16 || bytes > 64) throw new Error("Tamanho de segredo inválido.");
  const output = new Uint8Array(bytes);
  crypto.getRandomValues(output);
  return Array.from(output, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomDeliveryCode(): string {
  const output = new Uint32Array(1);
  // Rejection sampling: cada código de seis dígitos tem a mesma probabilidade.
  const range = 900000;
  const limit = Math.floor(0x100000000 / range) * range;
  do { crypto.getRandomValues(output); } while (output[0] >= limit);
  return String(100000 + (output[0] % range));
}

export function constantTimeEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const size = Math.max(left.length, right.length);
  for (let index = 0; index < size; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export function parseWebhookSignature(header: string | null): { timestamp: string; v1: string } | null {
  if (typeof header !== "string") return null;
  const fields = new Map<string, string>();
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    fields.set(part.slice(0, separator).trim().toLowerCase(), part.slice(separator + 1).trim());
  }
  const timestamp = fields.get("ts") || "";
  const v1 = (fields.get("v1") || "").toLowerCase();
  if (!/^(?:\d{10}|\d{13})$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(v1)) return null;
  return { timestamp, v1 };
}

export function buildWebhookManifest(dataId: string, requestId: string, timestamp: string): string {
  return `id:${dataId.toLowerCase()};request-id:${requestId};ts:${timestamp};`;
}

export async function verifyWebhookSignature(args: {
  header: string | null;
  requestId: string;
  dataId: string;
  secret: string;
  now?: number;
  maxAgeMs?: number;
}): Promise<boolean> {
  const parsed = parseWebhookSignature(args.header);
  if (!parsed || !args.requestId || !args.dataId || !args.secret) return false;
  const timestamp = parsed.timestamp.length === 10 ? Number(parsed.timestamp) * 1000 : Number(parsed.timestamp);
  const now = args.now ?? Date.now();
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > (args.maxAgeMs ?? 5 * 60 * 1000)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(args.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(buildWebhookManifest(args.dataId, args.requestId, parsed.timestamp)));
  const expected = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return constantTimeEqual(expected, parsed.v1);
}

function statuses(value: Record<string, unknown>): string[] {
  const transactions = record(value.transactions);
  const payment = Array.isArray(transactions.payments) ? record(transactions.payments[0]) : {};
  return [value.status, value.status_detail, payment.status, payment.status_detail]
    .filter((item) => item !== undefined && item !== null)
    .map((item) => String(item).toLowerCase());
}

export function translateProviderStatus(value: unknown): ProviderState {
  const data = record(value);
  const list = statuses(data);
  const all = list.join(" ");
  if (/(?:charged[_ -]?back|chargeback|contested)/.test(all)) return "contestado";
  const refunded = amountToCents(data.transaction_amount_refunded);
  const gross = amountToCents(data.transaction_amount ?? data.total_amount);
  if (/(?:partially[_ -]?refunded|partial[_ -]?refund)/.test(all)
    || (refunded !== null && refunded > 0 && gross !== null && refunded < gross)) return "revisao_parcial";
  if (refunded !== null && gross !== null && gross > 0 && refunded >= gross) return "estornado";
  if (/(?:^|\s)(?:refunded|fully[_ -]?refunded|full[_ -]?refund)(?:$|\s)/.test(all)) return "estornado";
  // Um refund pendente/desconhecido exige revisão; não prova devolução integral.
  if (/refund/.test(all)) return "revisao_parcial";
  if (/(?:expired|expiration)/.test(all)) return "expirado";
  if (/(?:canceled|cancelled|canceling|rejected|failed|refused)/.test(all)) return "cancelado";
  if (/(?:approved|accredited|processed)/.test(all)) return "aprovado";
  return "pendente";
}

function firstPayment(value: Record<string, unknown>): Record<string, unknown> {
  const transactions = record(value.transactions);
  return Array.isArray(transactions.payments) ? record(transactions.payments[0]) : {};
}

function providerFee(value: Record<string, unknown>, payment: Record<string, unknown>, legacy: boolean): number | null {
  const raw = legacy ? (value.application_fee ?? value.marketplace_fee ?? payment.application_fee ?? payment.marketplace_fee)
    : (value.application_fee ?? payment.application_fee);
  if (raw !== null && raw !== undefined && raw !== "") return amountToCents(raw);
  const details = Array.isArray(value.fee_details) ? value.fee_details : (Array.isArray(payment.fee_details) ? payment.fee_details : []);
  const applicationFees = details.map(record).filter((fee) => fee.type === "application_fee");
  if (!applicationFees.length) return null;
  const cents = applicationFees.map((fee) => amountToCents(fee.amount));
  if (cents.some((fee) => fee === null)) return null;
  const total = cents.reduce<number>((sum, fee) => sum + (fee ?? 0), 0);
  return Number.isSafeInteger(total) ? total : null;
}

export function extractProviderPayment(value: unknown, kind: "payment" | "order"): ProviderPaymentFacts {
  const data = record(value);
  const payment = firstPayment(data);
  const id = sanitizedProviderId(data.id ?? payment.id);
  const reference = String(data.external_reference ?? payment.external_reference ?? "");
  const collectorId = String(data.collector_id ?? (kind === "order" ? data.user_id : undefined) ?? payment.collector_id ?? "");
  const currency = String(data.currency_id ?? data.currency ?? data.currency_code ?? "").toUpperCase();
  const amountRaw = kind === "payment" ? data.transaction_amount : (data.total_amount ?? payment.amount);
  const status = String(data.status ?? payment.status ?? "");
  const statusDetail = String(data.status_detail ?? payment.status_detail ?? "");
  return {
    id,
    reference,
    collectorId,
    currency,
    amountCentavos: amountToCents(amountRaw),
    feeCentavos: providerFee(data, payment, kind === "order"),
    status,
    statusDetail,
    state: translateProviderStatus(data),
  };
}

export function extractPixArtifacts(value: unknown): { code: string; qrCodeBase64: string; ticketUrl: string } {
  const data = record(value);
  const point = record(data.point_of_interaction);
  const transaction = record(point.transaction_data);
  const paymentMethod = record(data.payment_method);
  return {
    code: String(transaction.qr_code ?? paymentMethod.qr_code ?? ""),
    qrCodeBase64: String(transaction.qr_code_base64 ?? paymentMethod.qr_code_base64 ?? ""),
    ticketUrl: String(transaction.ticket_url ?? paymentMethod.ticket_url ?? ""),
  };
}

export function sanitizedProviderId(value: unknown): string {
  const id = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(id)) return "";
  return id;
}

// Fatos exclusivamente de GET autenticado ao provedor; nunca do browser/webhook.
export function providerFactsError(facts: ProviderPaymentFacts, id: string, reference: string, collector: string, amount: number): string {
  if (!id || facts.id !== id || !reference || facts.reference !== reference) return "Referência do pagamento não corresponde ao pedido.";
  if (!collector || !facts.collectorId || facts.collectorId !== collector) return "Recebedor do pagamento não corresponde ao comércio.";
  if (facts.currency !== "BRL") return "Moeda do pagamento não corresponde ao pedido.";
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 2147483647 || facts.amountCentavos !== amount) return "Valor do pagamento não corresponde ao pedido.";
  return "";
}
