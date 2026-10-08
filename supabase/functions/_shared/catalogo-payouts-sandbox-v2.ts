/**
 * Mercado Pago Payouts — adaptador SOMENTE de TESTE (sem endpoint público).
 *
 * Referência oficial (2026):
 * https://www.mercadopago.com.br/developers/pt/docs/payouts/integration-configuration/money-transfers
 *
 * Nenhuma Edge Function importa/chama este módulo em produção. Não suporta
 * assinatura Ed25519 de produção; por desenho, só envia com X-test-token:true.
 * O transport é OBRIGATÓRIO e injetado pelo chamador, sem fetch implícito.
 * Criar payout (202) NUNCA equivale a registrar crédito como pago.
 */
import { validarChavePixTipadaV2, type TipoChavePixV2 } from "./catalogo-pix-chave-v2.ts";

export type PayoutPixType = TipoChavePixV2;
export type PayoutTransport = (url: string, init: RequestInit) => Promise<Response>;
export type PayoutRequest = {
  saqueId: string;
  valorCentavos: number;
  pixType: PayoutPixType;
  chavePix: string;
  notificationUrl?: string;
};
export type PayoutPrepared = {
  saqueId: string;
  valorCentavos: number;
  externalReference: string;
  transactionReference: string;
  idempotencyKey: string;
  body: {
    external_reference: string;
    description: string;
    config?: { notification_url: string };
    transactions: Array<{
      external_reference: string;
      description: string;
      type: "pix";
      pix: { type: PayoutPixType; chave: string };
      amount: { currency: "BRL"; value: number };
    }>;
  };
};

const ENDPOINT = "https://api.mercadopago.com/v1/payouts";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESOURCE_RE = /^(POP|TOP)[A-Z0-9]{8,60}$/i;
function parseNotificationUrl(url: string): string {
  let parsed: URL;
  try { parsed = new URL(url); }
  catch { throw new Error("URL de webhook de payout inválida."); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
    !parsed.hostname.includes(".") ||
    /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0)/i.test(parsed.hostname)) {
    throw new Error("Webhook deve ser HTTPS com domínio público.");
  }
  return parsed.toString();
}
export function prepararPayoutSandbox(input: PayoutRequest): PayoutPrepared {
  if (!UUID_RE.test(input.saqueId)) throw new Error("ID da solicitação de saque inválido.");
  if (!Number.isSafeInteger(input.valorCentavos) ||
      input.valorCentavos < 100 || input.valorCentavos > 1_000_000_000_000) {
    throw new Error("Payouts exige no mínimo R$ 1,00 e valor válido em centavos.");
  }
  const chave = typeof input.chavePix === "string" ? input.chavePix.trim() : "";
  if (!validarChavePixTipadaV2(input.pixType, chave)) throw new Error("Chave Pix/tipo inválidos.");
  const suffix = input.saqueId.replace(/-/g, "").toLowerCase();
  const reference = "saque_" + suffix;
  const txReference = "motoboy_" + suffix;
  // Dinheiro deve vir do banco, nunca de JSON do navegador.
  // A aplicação real deverá validar o snapshot dentro de transação SQL.
  const body: PayoutPrepared["body"] = {
    external_reference: reference,
    description: "Repasse mensal motoboy",
    transactions: [{
      external_reference: txReference,
      description: "Comissao de entregas",
      type: "pix",
      pix: { type: input.pixType, chave },
      amount: { currency: "BRL", value: Number((input.valorCentavos / 100).toFixed(2)) },
    }],
  };
  if (input.notificationUrl) body.config = { notification_url: parseNotificationUrl(input.notificationUrl) };
  return { saqueId: input.saqueId, valorCentavos: input.valorCentavos,
    externalReference: reference, transactionReference: txReference,
    idempotencyKey: input.saqueId.toLowerCase(), body };
}
function bearer(testAccessToken: string): string {
  if (typeof testAccessToken !== "string" ||
      !/^[A-Za-z0-9_\-:.]{12,2048}$/.test(testAccessToken)) {
    throw new Error("Access Token de TESTE de Payouts não configurado.");
  }
  return "Bearer " + testAccessToken;
}
function testTransport(transport: PayoutTransport, explicitOptIn: boolean): PayoutTransport {
  if (explicitOptIn !== true || typeof transport !== "function") {
    throw new Error("Envio de Payouts desabilitado: requer autorização explícita de teste e transporte injetado.");
  }
  return transport;
}
function headers(token: string): HeadersInit {
  return {
    Authorization: bearer(token),
    "Content-Type": "application/json",
    "X-test-token": "true",
    "X-enforce-signature": "false",
  };
}
function resultObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Resposta inválida do provedor; manter em revisão.");
  }
  return value as Record<string, unknown>;
}
function textField(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function resourceId(value: unknown, prefix: "POP" | "TOP"): string {
  const id = textField(value);
  if (!RESOURCE_RE.test(id) || !id.toUpperCase().startsWith(prefix)) {
    throw new Error("Identificador de payout/transação inválido.");
  }
  return id;
}
async function providerJson(response: Response, statusExpected: number): Promise<Record<string, unknown>> {
  if (response.status !== statusExpected) {
    // Não registrar dados bancários nem resposta bruta; 401/403 exigem checar habilitação.
    throw new Error("Payout de teste não autorizado/concluído pelo provedor (HTTP " + response.status + ").");
  }
  const data = await response.json().catch(() => null);
  return resultObject(data);
}

/**
 * Envia APENAS um payout de teste com transport injetado. 202 = EM PROCESSAMENTO.
 * NUNCA marca remuneração ou solicitação como paga.
 */
export async function criarPayoutSandbox(
  prepared: PayoutPrepared,
  options: { testAccessToken: string; transport: PayoutTransport; testApproved: boolean },
): Promise<{ payoutId: string; transactionId: string; situacao: "em_processamento" }> {
  const transport = testTransport(options.transport, options.testApproved);
  const response = await transport(ENDPOINT, {
    method: "POST",
    headers: { ...headers(options.testAccessToken), "X-Idempotency-Key": prepared.idempotencyKey },
    body: JSON.stringify(prepared.body),
  });
  const data = await providerJson(response, 202);
  if (textField(data.external_reference) !== prepared.externalReference ||
      !Array.isArray(data.transactions) || data.transactions.length !== 1) {
    throw new Error("Referência de criação divergente; verificar payout no provedor antes de qualquer retry.");
  }
  const transaction = resultObject(data.transactions[0]);
  if (textField(transaction.external_reference) !== prepared.transactionReference) {
    throw new Error("Transação divergente; não conciliar automaticamente.");
  }
  return {
    payoutId: resourceId(data.id, "POP"),
    transactionId: resourceId(transaction.id, "TOP"),
    situacao: "em_processamento",
  };
}

/** GET autoritativo: webhooks são apenas gatilhos para esta consulta. */
export async function consultarTransacaoSandbox(
  params: { payoutId: string; transactionId: string },
  options: { testAccessToken: string; transport: PayoutTransport; testApproved: boolean },
): Promise<Record<string, unknown>> {
  const transport = testTransport(options.transport, options.testApproved);
  const payoutId = resourceId(params.payoutId, "POP");
  const transactionId = resourceId(params.transactionId, "TOP");
  const response = await transport(ENDPOINT + "/" + encodeURIComponent(payoutId) +
    "/transactions/" + encodeURIComponent(transactionId), {
    method: "GET", headers: headers(options.testAccessToken),
  });
  const data = await providerJson(response, 200);
  if (textField(data.id) !== transactionId) throw new Error("Transação diferente da solicitada.");
  return data;
}

/**
 * Apenas classifica prova do provedor — a baixa financeira ainda será
 * implementada em transação SQL, com idempotência e trava dos créditos.
 */
export function classificarTransacaoPayout(
  data: Record<string, unknown>,
  expected: { transactionId: string; externalReference: string; valorCentavos: number },
): "confirmado" | "em_processamento" | "falhou" | "revisar" {
  if (textField(data.id) !== expected.transactionId ||
      textField(data.external_reference) !== expected.externalReference) return "revisar";
  const amount = data.amount && typeof data.amount === "object" && !Array.isArray(data.amount)
    ? data.amount as Record<string, unknown> : {};
  const value = amount.value;
  if (amount.currency !== "BRL" || typeof value !== "number" || !Number.isFinite(value) ||
      !Number.isSafeInteger(expected.valorCentavos) ||
      Math.round(value * 100) !== expected.valorCentavos) return "revisar";
  // Reembolso total/parcial tem precedência sobre qualquer estado intermediário.
  if (data.status === "refunded" || data.status_detail === "partially_refunded") return "revisar";
  if (data.status === "success" && data.status_detail === "accredited") return "confirmado";
  // O catálogo oficial também documenta estados transitórios por banco/autorizações.
  // "success" SEM accredited NÃO garante que o destinatário recebeu o valor.
  if ((data.status === "success" && data.status_detail === "in_progress") ||
      (data.status === "transaction_in_process" &&
        ["pending_authorized", "pending_bank"].includes(textField(data.status_detail))) ||
      ["created", "approved", "pending", "in_process", "processing"].includes(textField(data.status))) {
    return "em_processamento";
  }
  // Reembolso após crédito exige conciliação de estorno, não repetição de saque.
  if (data.status === "processed" && data.status_detail === "approved") return "revisar";
  if (["error", "canceled", "rejected", "failed"].includes(textField(data.status))) return "falhou";
  return "revisar";
}
