import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1.0.17";
import { montarLotePix, tipoChavePix, creditoComprovado, payoutIds } from "../_shared/catalogo-saques-payout.ts";

Deno.test("payout mensal cria uma unica transferencia Pix sem segredo, com valor em reais", () => {
  const lote = montarLotePix({
    referencia: "saque_12345678-1234-4123-8123-123456789012",
    chave_pix: "entregador@example.com",
    valor_centavos: 1234,
  });
  assertEquals(lote.external_reference, lote.transactions[0].external_reference);
  assertEquals(lote.transactions.length, 1);
  assertEquals(lote.transactions[0].pix.type, "EMAIL");
  assertEquals(lote.transactions[0].amount, { currency: "BRL", value: 12.34 });
});
Deno.test("chaves Pix somente com formatos suportados, sem numero de conta inventado", () => {
  assertEquals(tipoChavePix("123.456.789-01").type, "CPF");
  assertEquals(tipoChavePix("12.345.678/0001-90").type, "CNPJ");
  assertEquals(tipoChavePix("+5532999999999").type, "PHONE");
  assertEquals(tipoChavePix("12345678-1234-1234-1234-123456789012").type, "PIX_CODE");
  assertThrows(() => tipoChavePix("valor arbitrario"));
  assertThrows(() => montarLotePix({ referencia: "saque_test", chave_pix: "a@example.com", valor_centavos: 99 }));
});
Deno.test("apenas success/accredited com valor e referencia exatos reconhece dinheiro creditado", () => {
  const t = { id: "TOP1234", external_reference: "saque_abc", amount: { currency: "BRL", value: 12.34 },
    status: "success", status_detail: "accredited" };
  const r = { referencia: "saque_abc", valor_centavos: 1234 };
  assert(creditoComprovado(t, r));
  for (const overrides of [
    { status: "approved" }, { status: "created" },
    { status: "success", status_detail: "in_progress" },
    { status: "rejected" }, { external_reference: "saque_outro" },
    { amount: { currency: "BRL", value: 13.34 } },
    { amount: { currency: "USD", value: 12.34 } },
  ]) assertEquals(creditoComprovado({ ...t, ...overrides }, r), false);
});
Deno.test("HTTP 202 retorna IDs mas nunca confirma pagamento", () => {
  assertEquals(payoutIds({ id: "POP12345", transactions: [{ id: "TOP12345" }] }),
    { payoutId: "POP12345", transactionId: "TOP12345" });
  assertThrows(() => payoutIds({ id: "POP12345", transactions: [] }));
  assertThrows(() => payoutIds({ id: "POP12345", transactions: [{ id: "T1" }, { id: "T2" }] }));
});
