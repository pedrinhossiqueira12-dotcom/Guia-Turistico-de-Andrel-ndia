// Testes puros de validação de ordens Pix de fatura, sem API do Mercado Pago,
// sem credenciais, sem chamadas externas, sem Supabase de produção.
import {
  amountToCents, centsToAmountString, isComercioId, isCompetencia,
  normalizarCompetencia, montarReferenciaFatura, chaveIdempotenciaFatura,
  podeEmitirCobranca, assessFaturaOrder, estadoCobrancaDaOrder,
  extractPixDetails, verifyWebhookSignature, buildWebhookManifest,
} from "../catalogo-fatura-pix/fatura-utils.mjs";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function orderFixture() {
  return {
    id: "order_ci_123",
    external_reference: "fatura-comercio-de-exemplo-2026-10",
    user_id: 1234, type: "online", country_code: "BR",
    live_mode: true, total_amount: "0.14",
    status: "processed", status_detail: "accredited",
    transactions: { payments: [{
      id: "pay_ci_123", amount: "0.14",
      status: "processed", status_detail: "accredited",
      payment_method: { id: "pix", type: "bank_transfer" },
    }] },
  };
}
const expected = {
  orderId: "order_ci_123",
  externalReference: "fatura-comercio-de-exemplo-2026-10",
  sellerId: "1234", amountCents: 14,
  paymentId: "pay_ci_123", requirePixArtifacts: true,
};

Deno.test("fatura exige valor e competencia canonicos e identificador de comercio seguro", () => {
  for (const [input, cents] of [["0", 0], ["0.01", 1], ["1.01", 101], ["15.9", 1590]] as const) {
    assert(amountToCents(input) === cents, `Valor ${input} convertido errado`);
    assert(centsToAmountString(cents) === (cents/100).toFixed(2), `Valor ${input} formatado errado`);
  }
  for (const value of ["-1", "1.001", "1e4", "R$10", "1,00", "Infinity", ""]) {
    assert(amountToCents(value) === null, `Valor indevido aceito: ${value}`);
  }
  for (const invalid of ["../admin", "loja/1", "Loja", "áéí", "", "a".repeat(181)]) {
    assert(!isComercioId(invalid), `Identificador indevido aceito: ${invalid}`);
  }
  assert(isComercioId("comercio-de-exemplo"), "Loja valida recusada");
  assert(isCompetencia("2026-10"), "Competencia canonica recusada");
  assert(!isCompetencia("2026-10-01"), "Dia aceito como mes canonico");
  assert(!isCompetencia("2026-13"), "Mes invalido aceito");
  assert(normalizarCompetencia("2026-10-31") === "2026-10", "Normalizacao do mes divergente");
  assert(montarReferenciaFatura("comercio-de-exemplo", "2026-10") === expected.externalReference, "Referencia de fatura incorreta");
  assert(montarReferenciaFatura("../admin", "2026-10") === "", "Referencia insegura aceita");
});

Deno.test("fatura so emite valor devido positivo e chave de idempotencia valida", () => {
  const closed = { status: "faturado", total_comissao_centavos: 14 };
  assert(podeEmitirCobranca(closed).ok && podeEmitirCobranca(closed).valorCentavos === 14, "Fatura válida nao cobrável");
  for (const status of ["pago", "aberto", "cancelado", "contestada"]) {
    assert(!podeEmitirCobranca({ status, total_comissao_centavos: 14 }).ok, `Status ${status} gerou cobrança`);
  }
  for (const amount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert(!podeEmitirCobranca({ status: "faturado", total_comissao_centavos: amount }).ok, `Valor invalido liberado: ${amount}`);
  }
  const id = "00000000-0000-4000-8000-000000000099";
  assert(chaveIdempotenciaFatura({ fechamentoId: id }) === `fatura-${id}`, "Chave base incorreta");
  assert(chaveIdempotenciaFatura({ fechamentoId: id, tentativa: 2 }) === `fatura-${id}-t2`, "Chave de reemissao incorreta");
  assert(chaveIdempotenciaFatura({ fechamentoId: "../1" }) === "", "Idempotencia recebeu caminho perigoso");
});

Deno.test("fatura confere order Pix aprovada diretamente contra o recebedor", () => {
  const order = orderFixture();
  const result = assessFaturaOrder(order, expected);
  assert(result.valid === true && result.state === "aprovado" && result.paymentId === "pay_ci_123", `Order válida recusada: ${JSON.stringify(result)}`);
  for (const [mutation, issue] of [
    [{ ...order, id: "order_ci_999" }, "order_id_mismatch"],
    [{ ...order, external_reference: "fatura-outra-loja-2026-10" }, "reference_mismatch"],
    [{ ...order, user_id: 9999 }, "seller_mismatch"],
    [{ ...order, type: "offline" }, "order_type_mismatch"],
    [{ ...order, country_code: "AR" }, "country_mismatch"],
    [{ ...order, total_amount: "0.13" }, "amount_mismatch"],
    [{ ...order, live_mode: false }, "not_live_order"],
    [{ ...order, transactions: { payments: [{ ...order.transactions.payments[0], amount: "0.13" }] } }, "payment_amount_mismatch"],
    [{ ...order, transactions: { payments: [{ ...order.transactions.payments[0], id: "pay_wrong" }] } }, "payment_id_mismatch"],
    [{ ...order, transactions: { payments: [{ ...order.transactions.payments[0], payment_method: { id: "master", type: "credit_card" } }] } }, "pix_method_mismatch"],
    [{ ...order, transactions: { payments: [order.transactions.payments[0], { ...order.transactions.payments[0], id: "another_pix" }] } }, "multiple_pix_payments"],
  ] as const) {
    const res = assessFaturaOrder(mutation, expected);
    assert(!res.valid && res.problems.includes(issue), `Adulteracao de provedor nao detectada: ${issue}: ${JSON.stringify(res)}`);
  }
});

Deno.test("fatura pendente so aceita ticket Pix HTTPS do Mercado Pago esperado", () => {
  const base = orderFixture();
  base.status = "action_required";
  base.status_detail = "waiting_transfer";
  base.transactions.payments[0].status = "action_required";
  base.transactions.payments[0].status_detail = "waiting_transfer";
  const ticket = "https://www.mercadopago.com.br/payments/ticket-ci-123";
  const valid = structuredClone(base);
  (valid.transactions.payments[0].payment_method as Record<string,unknown>).ticket_url = ticket;
  const res = assessFaturaOrder(valid, expected);
  assert(res.valid && res.state === "pendente", `Pix pendente legítimo recusado: ${JSON.stringify(res)}`);

  const invalidTickets = [
    "http://www.mercadopago.com.br/ticket/123",
    "https://mercadopago.com.br.evil.invalid/ticket/123",
    "https://www.mercadopago.com.br@evil.invalid/ticket/123",
    "https://www.mercadopago.com.br/payments/sandbox/123",
    "javascript:alert(1)", "", "https://example.invalid/ticket/123",
  ];
  for (const unsafe of invalidTickets) {
    const modified = structuredClone(base);
    (modified.transactions.payments[0].payment_method as Record<string,unknown>).ticket_url = unsafe;
    const check = assessFaturaOrder(modified, expected);
    assert(check.valid === false, `Ticket inseguro aceito: ${unsafe}`);
  }
  assert(extractPixDetails(valid).ticketUrl === ticket, "URL original de Pix nao preservada");
});

Deno.test("fatura traduz estados terminais sem reaprovar contestacoes", () => {
  for (const [input, expectedState] of [
    ["aprovado", "pago"], ["pendente", "pendente"],
    ["expirado", "expirado"], ["cancelado", "cancelado"],
    ["recusado", "cancelado"], ["estornado", "estornado"],
    ["contestado", "contestado"],
  ] as const) {
    assert(estadoCobrancaDaOrder(input) === expectedState, `Estado ${input} divergente`);
  }
  for (const input of ["refunded", "charged_back", "foobar", "", "approved"]) {
    assert(estadoCobrancaDaOrder(input) === "", `Estado desconhecido convertido: ${input}`);
  }
  const chargeback = orderFixture();
  chargeback.status = "charged_back";
  const result = assessFaturaOrder(chargeback, { ...expected, requirePixArtifacts: false });
  assert(result.valid && result.state === "contestado", "Chargeback reconhecido incorretamente");
  const refund = orderFixture();
  refund.status = "refunded";
  const refunded = assessFaturaOrder(refund, { ...expected, requirePixArtifacts: false });
  assert(refunded.valid && refunded.state === "estornado", "Estorno reconhecido incorretamente");
});

Deno.test("estorno parcial de fatura fica em contestacao e nunca vira devolucao integral", () => {
  // Mesmo se a order disser 'refunded', o detalhe 'partially_refunded'
  // invalida a interpretacao de estorno integral.
  const cases = [
    { orderStatus: "processed", detail: "partially_refunded", paymentStatus: "processed", paymentDetail: "accredited" },
    { orderStatus: "refunded", detail: "partially_refunded", paymentStatus: "refunded", paymentDetail: "refunded" },
    { orderStatus: "processed", detail: "accredited", paymentStatus: "processed", paymentDetail: "partially_refunded" },
    { orderStatus: "processed", detail: "refund_pending", paymentStatus: "processed", paymentDetail: "accredited" },
    { orderStatus: "processed", detail: "accredited", paymentStatus: "processed", paymentDetail: "refund_in_process" },
  ];
  for (const item of cases) {
    const order = orderFixture();
    order.status = item.orderStatus;
    order.status_detail = item.detail;
    order.transactions.payments[0].status = item.paymentStatus;
    order.transactions.payments[0].status_detail = item.paymentDetail;
    const result = assessFaturaOrder(order, { ...expected, requirePixArtifacts: false });
    assert(result.valid, `Estorno parcial bem identificado foi rejeitado: ${JSON.stringify(item)} => ${JSON.stringify(result)}`);
    assert(result.state === "contestado", `Estorno parcial tratado como integral/aprovado: ${JSON.stringify(item)} => ${result.state}`);
    assert(estadoCobrancaDaOrder(result.state) === "contestado", "Contestado nao propagado para a RPC segura da fatura");
  }

  // Em revisao parcial/pendente o MP pode devolver apenas o estado da order.
  // So admitimos transacao ausente em estado terminal/contestacao quando
  // o payment ID esperado ja esta vinculado, alem de conferir seller/valor/ref.
  const orderWithoutPayments = orderFixture();
  orderWithoutPayments.status = "processed";
  orderWithoutPayments.status_detail = "refund_pending";
  orderWithoutPayments.transactions.payments = [];
  const pending = assessFaturaOrder(orderWithoutPayments, { ...expected, requirePixArtifacts: false });
  assert(pending.valid && pending.state === "contestado",
    `Refund pendente sem dados da transacao nao foi bloqueado para revisao: ${JSON.stringify(pending)}`);
  const noKnownPayment = assessFaturaOrder(orderWithoutPayments, {
    ...expected, paymentId: "", requirePixArtifacts: false,
  });
  assert(!noKnownPayment.valid,
    "Refund sem transacao nem identificador financeiro previo foi aceito");

  const detailOmitted = orderFixture();
  detailOmitted.status_detail = "partially_refunded";
  detailOmitted.transactions.payments = [{
    id: "pay_ci_123", amount: "0.14", status: "processed", status_detail: "accredited",
    payment_method: {} as { id: string; type: string },
  }];
  const missingMethod = assessFaturaOrder(detailOmitted, { ...expected, requirePixArtifacts: false });
  assert(missingMethod.valid && missingMethod.state === "contestado",
    "Pagamento conhecido com metodo Pix omitido em estorno parcial perdeu bloqueio seguro");

  const full = orderFixture();
  full.status = "refunded";
  full.status_detail = "refunded";
  full.transactions.payments[0].status = "refunded";
  full.transactions.payments[0].status_detail = "refunded";
  const result = assessFaturaOrder(full, { ...expected, requirePixArtifacts: false });
  assert(result.valid && result.state === "estornado", "Devolucao integral nao foi reconhecida");
  assert(estadoCobrancaDaOrder(result.state) === "estornado", "Devolucao integral nao chegou ao estado correto da fatura");

  const approved = assessFaturaOrder(orderFixture(), expected);
  assert(approved.valid && approved.state === "aprovado", "Correcao afetou pagamento integral confirmado");
});

Deno.test("assinatura do webhook da fatura exige timestamp, request-id e HMAC", async () => {
  const secret="segredo-testes-fatura", requestId="req-ci-12", dataId="order_ci_123";
  const now=1760000000000, timestamp=String(now/1000);
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const bytes=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(buildWebhookManifest({dataId,requestId,timestamp})));
  const signature=Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,"0")).join("");
  const header=`ts=${timestamp},v1=${signature}`;
  const verify=(changes:Record<string,unknown>={})=>verifyWebhookSignature({header,secret,requestId,dataId,now,...changes});
  assert(await verify(),"Webhook válido recusado");
  assert(!(await verify({requestId:"outro"})),"request-id substituído");
  assert(!(await verify({dataId:"outro"})),"data.id substituído");
  assert(!(await verify({secret:"outro"})),"secret substituído");
  assert(!(await verify({now:now+25*60*60*1000})),"timestamp fora da janela aceito");
  assert(!(await verify({header:"ts=0,v1=bad"})),"assinatura malformada aceita");
});
