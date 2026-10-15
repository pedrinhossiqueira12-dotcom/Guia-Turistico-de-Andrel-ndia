// COB-06 / PR39: adaptador isolado (NAO importado pela Edge publica).
// GET do provedor deve ser implementado somente no backend confiavel.
// Este codigo NUNCA faz POST de Pix e NUNCA interpreta RECEIVED como quitação.
export type ExpectativaAcumulo = {
  loteId: string;
  referencia: string;
  clienteId: string;
  valorCentavos: number;
};
export type ObservacaoRemota = {
  p_lote: string;
  p_payment: string;
  p_customer: string;
  p_referencia: string;
  p_valor: number;
  p_status: string;
};
type ConsultarAsaas = (paymentId: string) => Promise<unknown>;
type RegistrarObservacao = (params: ObservacaoRemota) => Promise<unknown>;
const estados = new Set([
  "PENDING", "OVERDUE", "CONFIRMED", "RECEIVED",
  "REFUNDED", "PARTIALLY_REFUNDED", "REFUND_IN_PROGRESS",
  "CHARGEBACK_REQUESTED", "DELETED",
]);

function exige(ok: boolean, motivo: string): asserts ok {
  if (!ok) throw new Error("COB06_HOLD_" + motivo);
}
function objeto(v: unknown): Record<string, unknown> {
  exige(v !== null && typeof v === "object" && !Array.isArray(v), "GET_INVALIDO");
  return v as Record<string, unknown>;
}
function centsExatos(valor: unknown): number {
  exige(typeof valor === "string" || typeof valor === "number", "VALOR_INVALIDO");
  // Rejeitar arredondamento, valores negativos, exponenciais e mais de 2 casas.
  const texto = String(valor);
  exige(/^\d{1,9}(?:\.\d{1,2})?$/.test(texto), "VALOR_INVALIDO");
  const [inteiro, decimal = ""] = texto.split(".");
  const centavos = Number(inteiro) * 100 + Number(decimal.padEnd(2, "0"));
  exige(Number.isSafeInteger(centavos), "VALOR_INVALIDO");
  return centavos;
}
export async function conferirPagamentoAcumuloPorGet(
  esperado: ExpectativaAcumulo,
  paymentId: string,
  consultarPorId: ConsultarAsaas,
): Promise<ObservacaoRemota> {
  // Preflight local deve ter sido consultado em banco pelo backend autorizado.
  exige(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(esperado.loteId),
    "LOTE_INVALIDO");
  exige(esperado.referencia === "guia-acumulo-" + esperado.loteId, "REFERENCIA_INVALIDA");
  exige(/^cus_[A-Za-z0-9_-]{3,120}$/.test(esperado.clienteId), "CLIENTE_INVALIDO");
  exige(Number.isSafeInteger(esperado.valorCentavos) && esperado.valorCentavos >= 500 &&
    esperado.valorCentavos <= 2147483647, "VALOR_INVALIDO");
  exige(/^pay_[A-Za-z0-9_-]{5,120}$/.test(paymentId), "PAGAMENTO_INVALIDO");

  // Apenas GET por ID; quem integrar deve passar o adaptador autenticado Asaas
  // e recuperar a identidade do cliente no banco, nunca de dados do navegador.
  let resultado: unknown;
  try {
    resultado = await consultarPorId(paymentId);
  } catch {
    // Nao devolver corpo remoto, token ou detalhes da falha ao cliente.
    throw new Error("COB06_HOLD_GET_INDISPONIVEL");
  }
  const remoto = objeto(resultado);
  exige(remoto.id === paymentId, "ID_DIVERGENTE");
  exige(remoto.externalReference === esperado.referencia, "REFERENCIA_DIVERGENTE");
  exige(remoto.customer === esperado.clienteId, "CLIENTE_DIVERGENTE");
  exige(remoto.billingType === "PIX", "MODALIDADE_DIVERGENTE");
  exige(centsExatos(remoto.value) === esperado.valorCentavos, "VALOR_DIVERGENTE");
  exige(typeof remoto.status === "string" && estados.has(remoto.status),
    "STATUS_DESCONHECIDO");

  return {
    p_lote: esperado.loteId,
    p_payment: paymentId,
    p_customer: esperado.clienteId,
    p_referencia: esperado.referencia,
    p_valor: esperado.valorCentavos,
    p_status: remoto.status,
  };
}
export async function observarPagamentoAcumuloSomenteGet(
  esperado: ExpectativaAcumulo,
  paymentId: string,
  consultarPorId: ConsultarAsaas,
  registrarNoBanco: RegistrarObservacao,
): Promise<{ observacao: ObservacaoRemota; retorno: unknown }> {
  const observacao = await conferirPagamentoAcumuloPorGet(
    esperado, paymentId, consultarPorId
  );
  const retorno = await registrarNoBanco(observacao);
  const ack = objeto(retorno);
  exige(ack.ok === true &&
    ack.payment_id === observacao.p_payment &&
    ack.lote_id === observacao.p_lote &&
    ack.pode_quitar === false &&
    ack.pode_liberar_motoboy === false,
    "ACK_BANCO_INVALIDO");
  // Nao emite QR e nao altera estado de fatura, remetente ou motoboy.
  return { observacao, retorno };
}
