import { consultarPagamentoAcumuloSandboxGet } from "../_shared/catalogo-asaas-acumulo-get-sandbox-inerte.ts";
import { conferirPagamentoAcumuloPorGet } from "../_shared/catalogo-asaas-acumulo-get-verificado-inerte.ts";

const id = "pay_cob06_test123";
const lote = "22222222-3333-4444-8888-aaaaaaaaaaaa";
const esperado = { loteId: lote, referencia: "guia-acumulo-" + lote,
  clienteId: "cus_cob06_test123", valorCentavos: 500 };
const remoto = { id, externalReference: esperado.referencia, customer: esperado.clienteId,
  value: 5, billingType: "PIX", status: "PENDING" };
function assert(ok: unknown, why: string) { if (!ok) throw new Error(why); }
async function hold(fn: () => Promise<unknown>, codigo: string) {
  let error = "";
  try { await fn(); } catch (e) { error = String(e); }
  assert(error.includes("COB06_HOLD_" + codigo), "esperado HOLD " + codigo + ":" + error);
}
Deno.test("COB06 GET Sandbox usa somente endpoint fixo, GET e token do servidor", async () => {
  let requests = 0;
  const mock = (async (url: string | URL | Request, init?: RequestInit) => {
    requests++;
    assert(url === "https://api-sandbox.asaas.com/v3/payments/" + id, "URL fixa");
    assert(init?.method === "GET" && init.redirect === "error", "GET sem redirect");
    assert((init.headers as Record<string,string>).access_token === "segredo-ci", "token servidor");
    return new Response(JSON.stringify(remoto), { status: 200,
      headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const observacao = await conferirPagamentoAcumuloPorGet(esperado, id,
    (paymentId) => consultarPagamentoAcumuloSandboxGet(paymentId, "segredo-ci", mock));
  assert(requests === 1 && observacao.p_valor === 500, "GET unico e cents exatos");
});
Deno.test("COB06 GET Sandbox falha fechado antes de consultar", async () => {
  let requests = 0;
  const mock = (async () => { requests++; throw Error("nao chamar"); }) as typeof fetch;
  await hold(() => consultarPagamentoAcumuloSandboxGet("pay_!", "segredo-ci", mock), "PAGAMENTO_INVALIDO");
  await hold(() => consultarPagamentoAcumuloSandboxGet(id, "", mock), "CREDENCIAL_INDISPONIVEL");
  assert(requests === 0, "sem rede antes da validacao");
});
Deno.test("COB06 GET Sandbox rejeita erros, MIME, excesso e documento malformado", async () => {
  const casos: Array<[string, Response, string]> = [
    ["HTTP", new Response("erro", { status: 503 }), "GET_INDISPONIVEL"],
    ["HTML", new Response("<html>", { headers: { "content-type": "text/html" } }), "RESPOSTA_INVALIDA"],
    ["grande", new Response("x".repeat(65537), { headers: { "content-type": "application/json" } }), "RESPOSTA_INVALIDA"],
    ["JSON", new Response("{", { headers: { "content-type": "application/json" } }), "RESPOSTA_INVALIDA"],
  ];
  for (const [, response, codigo] of casos) {
    await hold(() => consultarPagamentoAcumuloSandboxGet(id, "segredo-ci",
      (async () => response) as typeof fetch), codigo);
  }
});
