// COB-06: apenas mocks locais, sem permissao de rede e sem Asaas real.
import {
  conferirPagamentoAcumuloPorGet,
  observarPagamentoAcumuloSomenteGet,
  type ExpectativaAcumulo,
} from "../_shared/catalogo-asaas-acumulo-get-verificado-inerte.ts";

function exigir(ok: boolean, descricao: string) {
  if (!ok) throw new Error("TEST_FAIL: " + descricao);
}
const loteId = "22222222-3333-4444-8888-aaaaaaaaaaaa";
const expected: ExpectativaAcumulo = {
  loteId, referencia: "guia-acumulo-" + loteId,
  clienteId: "cus_cliente_ci_1234", valorCentavos: 500,
};
const payment = {
  id: "pay_cob06_12345678", customer: expected.clienteId,
  externalReference: expected.referencia, billingType: "PIX",
  value: 5, status: "PENDING",
};
async function recusa(fn: () => Promise<unknown>, code: string) {
  let erro = "";
  try { await fn(); } catch (e) { erro = String(e); }
  exigir(erro.includes("COB06_HOLD_" + code), "rejeicao esperada: " + code + " / " + erro);
}

Deno.test("COB06 GET: aceita somente ID cliente referencia valor e PIX identicos", async () => {
  let consultas = 0;
  let escritas = 0;
  const result = await observarPagamentoAcumuloSomenteGet(
    expected, payment.id,
    async (id) => { exigir(id === payment.id, "GET por ID"); consultas++; return payment; },
    async (observacao) => {
      escritas++;
      exigir(observacao.p_valor === 500 && observacao.p_status === "PENDING",
        "observacao sem arredondar");
      return { ok: true, payment_id: observacao.p_payment,
        lote_id: observacao.p_lote, pode_quitar: false, pode_liberar_motoboy: false };
    },
  );
  exigir(consultas === 1 && escritas === 1, "somente uma consulta e um registro");
  exigir(result.observacao.p_referencia === expected.referencia, "ref certa");
});

Deno.test("COB06 GET: RECEIVED/CONFIRMED nunca autorizam baixa ou repasse", async () => {
  for (const status of ["RECEIVED", "CONFIRMED", "REFUNDED", "CHARGEBACK_REQUESTED"]) {
    const v = await conferirPagamentoAcumuloPorGet(
      expected, payment.id, async () => ({ ...payment, status }),
    );
    exigir(v.p_status === status, "status permanece observado, nao liquidado");
    exigir(!("pode_quitar" in v), "nao conferir baixa em observacao");
  }
});

Deno.test("COB06 GET: recusa prova divergente sem gravar no banco", async () => {
  const casos: Array<[string, Record<string, unknown>]> = [
    ["ID_DIVERGENTE", { id: "pay_outra_123456" }],
    ["CLIENTE_DIVERGENTE", { customer: "cus_outro_cliente" }],
    ["REFERENCIA_DIVERGENTE", { externalReference: "guia-acumulo-errado" }],
    ["MODALIDADE_DIVERGENTE", { billingType: "BOLETO" }],
    ["VALOR_DIVERGENTE", { value: 4.99 }],
    ["VALOR_INVALIDO", { value: "5.009" }],
    ["STATUS_DESCONHECIDO", { status: "UNKNOWN" }],
  ];
  for (const [erro, alteracao] of casos) {
    let escritas = 0;
    await recusa(() => observarPagamentoAcumuloSomenteGet(
      expected, payment.id, async () => ({ ...payment, ...alteracao }),
      async () => { escritas++; return { ok: true }; },
    ), erro);
    exigir(escritas === 0, "nao persistir prova negativa " + erro);
  }
});

Deno.test("COB06 GET: recusa lote/cliente/pagamento invalido antes do provedor", async () => {
  let calls = 0;
  const get = async () => { calls++; return payment; };
  await recusa(() => conferirPagamentoAcumuloPorGet(
    { ...expected, referencia: "guia-acumulo-outro" }, payment.id, get,
  ), "REFERENCIA_INVALIDA");
  await recusa(() => conferirPagamentoAcumuloPorGet(
    expected, "pay_!", get,
  ), "PAGAMENTO_INVALIDO");
  exigir(calls === 0, "nao consultar provedor antes de validacao local");
});

Deno.test("COB06 GET: falha e ACK divergente permanecem HOLD", async () => {
  await recusa(() => observarPagamentoAcumuloSomenteGet(
    expected, payment.id, async () => payment,
    async () => ({ ok: true, lote_id: expected.loteId,
      payment_id: payment.id, pode_quitar: true, pode_liberar_motoboy: false }),
  ), "ACK_BANCO_INVALIDO");
  let wrote = false;
  await recusa(() => observarPagamentoAcumuloSomenteGet(
    expected, payment.id,
    async () => { throw new Error("GET_INDISPONIVEL"); },
    async () => { wrote = true; return {}; },
  ), "GET_INDISPONIVEL");
  exigir(wrote === false, "nao persistir quando GET falha");
});
