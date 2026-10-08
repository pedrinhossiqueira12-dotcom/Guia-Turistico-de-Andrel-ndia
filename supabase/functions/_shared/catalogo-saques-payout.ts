// Payouts via Pix: testável sem rede, usando o contrato da API Mercado Pago.
export type PayoutRequest = { external_reference: string; description: string; transactions: Array<{
  description: string; type: "pix"; pix: { type: string; chave: string };
  amount: { currency: "BRL"; value: number }; external_reference: string;
}> };
export function tipoChavePix(input: string): { type: "EMAIL"|"PHONE"|"CPF"|"CNPJ"|"PIX_CODE"; chave: string } {
  const key = String(input || "").trim();
  if (/^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$/.test(key)) return { type: "EMAIL", chave: key };
  const digits = key.replace(/[.\s()/\-]/g, "");
  if (/^\d{11}$/.test(digits)) return { type: "CPF", chave: digits };
  if (/^\d{14}$/.test(digits)) return { type: "CNPJ", chave: digits };
  if (/^\+55\d{10,11}$/.test(digits)) return { type: "PHONE", chave: digits };
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(key)) {
    return { type: "PIX_CODE", chave: key };
  }
  throw new Error("Chave Pix sem formato reconhecido. Cadastre uma chave válida.");
}
export function montarLotePix(input: {
  referencia: string; valor_centavos: number; chave_pix: string;
}): PayoutRequest {
  const ref = String(input.referencia || "");
  if (!/^[a-zA-Z0-9_-]{1,50}$/.test(ref)) throw new Error("Referência de payout inválida.");
  const cent = input.valor_centavos;
  if (!Number.isSafeInteger(cent) || cent < 100 || cent > 1000000000)
    throw new Error("Valor de payout inválido.");
  return {
    external_reference: ref,
    description: "Saque mensal do entregador",
    transactions: [{
      description: "Remuneracao por entregas",
      type: "pix",
      pix: tipoChavePix(input.chave_pix),
      amount: { currency: "BRL", value: cent / 100 },
      external_reference: ref,
    }],
  };
}
export function creditoComprovado(tx: Record<string, unknown>, input: {
  referencia: string; valor_centavos: number;
}): boolean {
  const amount = tx.amount as Record<string, unknown> | undefined;
  const money = amount?.value;
  return tx.status === "success" &&
    tx.status_detail === "accredited" &&
    tx.external_reference === input.referencia &&
    amount?.currency === "BRL" &&
    typeof money === "number" && Number.isFinite(money) &&
    Math.round(money * 100) === input.valor_centavos;
}
export function payoutIds(data: Record<string, unknown>): { payoutId: string; transactionId: string } {
  const payoutId = String(data.id || "");
  const list = Array.isArray(data.transactions) ? data.transactions : [];
  const transactionId = String((list[0] as Record<string, unknown> | undefined)?.id || "");
  if (list.length !== 1 || !/^[A-Za-z0-9_-]{4,100}$/.test(payoutId) ||
      !/^[A-Za-z0-9_-]{4,100}$/.test(transactionId)) {
    throw new Error("Provedor não retornou comprovante inequívoco de um único payout.");
  }
  return { payoutId, transactionId };
}
