import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  amountToCents,
  assessFaturaOrder,
  buildWebhookManifest,
  centsToAmountString,
  chaveIdempotenciaFatura,
  detalheCobrancaDaOrder,
  estadoCobrancaDaOrder,
  extractPixDetails,
  isCompetencia,
  montarReferenciaFatura,
  podeEmitirCobranca,
  verifyWebhookSignature,
} from "../supabase/functions/catalogo-fatura-pix/fatura-utils.mjs";

const FECHAMENTO_ID = "9f1c2eb6-3bc0-4a6e-9d33-1d0b1c2d3e4f";
const REFERENCIA = "fatura-comercio-de-exemplo-2026-09";
const ORDER = {
  id: "ORD_FATURA_1",
  type: "online",
  external_reference: REFERENCIA,
  total_amount: "12.35",
  country_code: "BRA",
  user_id: "123456789",
  live_mode: true,
  status: "action_required",
  status_detail: "waiting_transfer",
  transactions: {
    payments: [{
      id: "PAY_FATURA_1",
      amount: "12.35",
      status: "action_required",
      status_detail: "waiting_transfer",
      payment_method: { id: "pix", type: "bank_transfer", qr_code: "00020126-pix-fatura", qr_code_base64: "ZmF0dXJh", ticket_url: "https://www.mercadopago.com.br/payments/1" },
    }],
  },
};
const EXPECTED = {
  orderId: "ORD_FATURA_1",
  externalReference: REFERENCIA,
  sellerId: "123456789",
  amountCents: 1235,
  requirePixArtifacts: true,
};

function signedHeader({ now = Date.now(), dataId = "ORD_FATURA_1", requestId = "req-1", secret = "fatura-secret" } = {}) {
  const timestamp = String(Math.floor(now / 1000));
  const manifest = buildWebhookManifest({ dataId, requestId, timestamp });
  const digest = createHmac("sha256", secret).update(manifest).digest("hex");
  // A assinatura é feita no instante indicado; o instante da verificação é informado à parte.
  return { header: `ts=${timestamp},v1=${digest}`, dataId, requestId, secret };
}

test("valores em centavos são convertidos sem perda e sem aceitar lixo", () => {
  assert.equal(centsToAmountString(1235), "12.35");
  assert.equal(centsToAmountString(5990), "59.90");
  assert.equal(amountToCents("12.35"), 1235);
  assert.equal(amountToCents("12.3"), 1230);
  assert.equal(amountToCents("12.351"), null);
  assert.equal(amountToCents("texto"), null);
  assert.throws(() => centsToAmountString(-1));
});

test("referência e chave de idempotência da fatura são estáveis", () => {
  assert.equal(montarReferenciaFatura("comercio-de-exemplo", "2026-09"), REFERENCIA);
  assert.equal(montarReferenciaFatura("comercio-de-exemplo", "2026-09-14"), REFERENCIA);
  assert.equal(montarReferenciaFatura("Comércio Inválido", "2026-09"), "");
  assert.equal(montarReferenciaFatura("comercio-de-exemplo", "setembro"), "");
  assert.equal(isCompetencia("2026-09"), true);
  assert.equal(isCompetencia("2026/09"), false);
  assert.equal(chaveIdempotenciaFatura({ fechamentoId: FECHAMENTO_ID }), `fatura-${FECHAMENTO_ID}`);
  assert.equal(chaveIdempotenciaFatura({ fechamentoId: FECHAMENTO_ID, tentativa: 2 }), `fatura-${FECHAMENTO_ID}-t2`);
  assert.equal(chaveIdempotenciaFatura({ fechamentoId: "abc" }), "");
});

test("fatura só é cobrável quando está fechada, não paga e com valor devido", () => {
  assert.equal(podeEmitirCobranca({ status: "faturado", total_comissao_centavos: 1235 }).ok, true);
  assert.equal(podeEmitirCobranca({ status: "vencido", total_comissao_centavos: 1235 }).valorCentavos, 1235);
  assert.equal(podeEmitirCobranca({ status: "bloqueado", total_comissao_centavos: 500 }).ok, true);
  assert.equal(podeEmitirCobranca({ status: "aberto", total_comissao_centavos: 1235 }).ok, false);
  assert.equal(podeEmitirCobranca({ status: "pago", total_comissao_centavos: 1235 }).ok, false);
  assert.equal(podeEmitirCobranca({ status: "faturado", total_comissao_centavos: 0 }).ok, false);
  assert.equal(podeEmitirCobranca(null).ok, false);
});

test("order Pix íntegra e correspondente à fatura é aceita", () => {
  const avaliacao = assessFaturaOrder(ORDER, EXPECTED);
  assert.equal(avaliacao.valid, true);
  assert.equal(avaliacao.state, "pendente");
  assert.equal(avaliacao.paymentId, "PAY_FATURA_1");
  assert.deepEqual(extractPixDetails(ORDER), { code: "00020126-pix-fatura", imageBase64: "ZmF0dXJh", ticketUrl: "https://www.mercadopago.com.br/payments/1" });
});

test("order com valor, referência, recebedor ou ticket divergente é recusada", () => {
  assert.equal(assessFaturaOrder({ ...ORDER, total_amount: "99.00" }, EXPECTED).valid, false);
  assert.equal(assessFaturaOrder({ ...ORDER, external_reference: "outra-referencia" }, EXPECTED).valid, false);
  assert.equal(assessFaturaOrder({ ...ORDER, user_id: "outro-recebedor" }, EXPECTED).valid, false);
  assert.equal(assessFaturaOrder({ ...ORDER, live_mode: false }, EXPECTED).valid, false);
  assert.equal(assessFaturaOrder({ ...ORDER, country_code: "ARG" }, EXPECTED).valid, false);
  const sandboxOrder = structuredClone(ORDER);
  sandboxOrder.transactions.payments[0].payment_method.ticket_url = "https://sandbox.mercadopago.com.br/payments/1";
  assert.equal(assessFaturaOrder(sandboxOrder, EXPECTED).valid, false);
  const semPix = structuredClone(ORDER);
  semPix.transactions.payments[0].payment_method.id = "credit_card";
  assert.equal(assessFaturaOrder(semPix, EXPECTED).valid, false);
});

test("estados da order são traduzidos para os estados aceitos pela rotina SQL", () => {
  assert.equal(estadoCobrancaDaOrder("aprovado"), "pago");
  assert.equal(estadoCobrancaDaOrder("pendente"), "pendente");
  assert.equal(estadoCobrancaDaOrder("expirado"), "expirado");
  assert.equal(estadoCobrancaDaOrder("cancelado"), "cancelado");
  assert.equal(estadoCobrancaDaOrder("recusado"), "cancelado");
  assert.equal(estadoCobrancaDaOrder("estornado"), "estornado");
  assert.equal(estadoCobrancaDaOrder("contestado"), "contestado");
  assert.equal(estadoCobrancaDaOrder("desconhecido"), "");
  assert.match(detalheCobrancaDaOrder(ORDER), /action_required/);
});

test("pagamento aprovado exige order e transação acreditadas", () => {
  const aprovada = structuredClone(ORDER);
  aprovada.status = "processed";
  aprovada.status_detail = "accredited";
  aprovada.transactions.payments[0].status = "processed";
  aprovada.transactions.payments[0].status_detail = "accredited";
  const avaliacao = assessFaturaOrder(aprovada, { ...EXPECTED, requirePixArtifacts: false });
  assert.equal(avaliacao.valid, true);
  assert.equal(avaliacao.state, "aprovado");
  assert.equal(estadoCobrancaDaOrder(avaliacao.state), "pago");
});

test("assinatura do webhook da fatura é validada por HMAC e expira", async () => {
  const assinado = signedHeader();
  assert.equal(await verifyWebhookSignature(assinado), true);
  assert.equal(await verifyWebhookSignature({ ...assinado, header: `ts=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}` }), false);
  assert.equal(await verifyWebhookSignature({ ...assinado, dataId: "outro-id" }), false);
  assert.equal(await verifyWebhookSignature({ ...assinado, requestId: "" }), false);
  const antigo = Date.now() - 48 * 60 * 60 * 1000;
  assert.equal(await verifyWebhookSignature({ ...signedHeader({ now: antigo }), now: Date.now() }), false);
  assert.equal(await verifyWebhookSignature({ ...signedHeader({ now: antigo }), now: Date.now(), maxAgeMs: 72 * 60 * 60 * 1000 }), true);
});