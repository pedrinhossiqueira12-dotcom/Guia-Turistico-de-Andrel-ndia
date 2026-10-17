// COB-06 / PR #39: candidato de transporte POST Pix do acumulo, SOMENTE PARA CI.
// NAO importar na Edge publicada nem chamar ate existir gate SQL de emissao
// auditado, configuracao explicita do operador e autorizacao de homologacao.
// A reserva 05 e apenas inerte (pode_emitir_pix=false): NAO e autorizacao POST.
// Nenhuma baixa, credito, webhook, estorno, liberacao ou saque neste modulo.
import { consultarPagamentoAcumuloSandboxGet } from "./catalogo-asaas-acumulo-get-sandbox-inerte.ts";
import { conferirPagamentoAcumuloPorGet } from "./catalogo-asaas-acumulo-get-verificado-inerte.ts";
import type {
  ExpectativaAcumulo, ObservacaoRemota,
} from "./catalogo-asaas-acumulo-get-verificado-inerte.ts";

const URL_PAGAMENTOS = "https://api-sandbox.asaas.com/v3/payments";
const MAX_BYTES = 65536;
type FetchSeguro = typeof fetch;
export type CobrancaCandidata = {
  paymentId: string;
  observacao: ObservacaoRemota;
  holdObrigatorio: true;
  podeQuitar: false;
  podeLiberarMotoboy: false;
};

function exige(ok: boolean, motivo: string): asserts ok {
  if (!ok) throw new Error("COB06_HOLD_" + motivo);
}
function dataIsoValida(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(s + "T00:00:00Z");
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}
function validarEntrada(esperado: ExpectativaAcumulo, vencimento: string, token: string) {
  exige(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(esperado.loteId),
    "LOTE_INVALIDO");
  exige(esperado.referencia === "guia-acumulo-" + esperado.loteId,
    "REFERENCIA_INVALIDA");
  exige(/^cus_[A-Za-z0-9_-]{3,120}$/.test(esperado.clienteId),
    "CLIENTE_INVALIDO");
  exige(Number.isSafeInteger(esperado.valorCentavos) &&
    esperado.valorCentavos >= 500 && esperado.valorCentavos <= 2147483647,
    "VALOR_INVALIDO");
  exige(dataIsoValida(vencimento) &&
    vencimento >= new Date().toISOString().slice(0, 10), "VENCIMENTO_INVALIDO");
  exige(typeof token === "string" && token.trim().length > 0 &&
    token.length <= 2048 && !/[\r\n]/.test(token), "CREDENCIAL_INDISPONIVEL");
}
async function respostaLimitada(response: Response): Promise<unknown> {
  exige(response.status === 200 || response.status === 201,
    "POST_INCONCLUSIVO");
  exige(response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ===
    "application/json", "POST_RESPOSTA_INVALIDA");
  const length = response.headers.get("content-length");
  exige(length === null || (/^\d+$/.test(length) &&
    Number.isSafeInteger(Number(length)) && Number(length) <= MAX_BYTES),
    "POST_RESPOSTA_INVALIDA");
  exige(response.body !== null, "POST_RESPOSTA_INVALIDA");
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      exige(total <= MAX_BYTES, "POST_RESPOSTA_INVALIDA");
      chunks.push(value);
    }
  } catch {
    throw new Error("COB06_HOLD_POST_RESPOSTA_INVALIDA");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("COB06_HOLD_POST_RESPOSTA_INVALIDA"); }
}

// UMA tentativa HTTP (sem retry automatico), seguida de GET por ID e
// conferencia independente. O chamador futuro deve antes exigir uma nova
// autorizacao de emissao atomicamente no SQL, nao existente nos candidatos 03-12.
// Em falha ou resposta perdida, a referencia fica para reconciliacao GET/manual:
// nunca chamar novamente este metodo com a mesma reserva.
export async function postarPixAcumuloSandboxCandidatoSomenteCi(
  esperado: ExpectativaAcumulo,
  vencimento: string,
  tokenServidor: string,
  fetchSeguro: FetchSeguro = fetch,
): Promise<CobrancaCandidata> {
  validarEntrada(esperado, vencimento, tokenServidor);
  const corpo = {
    customer: esperado.clienteId,
    billingType: "PIX" as const,
    value: esperado.valorCentavos / 100,
    dueDate: vencimento,
    externalReference: esperado.referencia,
    description: "Guia Andrelandia - fatura acumulada " + esperado.loteId,
  };
  let resposta: Response;
  try {
    resposta = await fetchSeguro(URL_PAGAMENTOS, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: {
        access_token: tokenServidor,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "GuiaAndrelandia-COB06/1.0",
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // O Asaas pode ter recebido o POST: nao ha segunda tentativa automatica.
    throw new Error("COB06_HOLD_POST_INCONCLUSIVO");
  }
  const retorno = await respostaLimitada(resposta);
  exige(retorno !== null && typeof retorno === "object" && !Array.isArray(retorno),
    "POST_RESPOSTA_INVALIDA");
  const paymentId = (retorno as Record<string, unknown>).id;
  exige(typeof paymentId === "string" &&
    /^pay_[A-Za-z0-9_-]{5,120}$/.test(paymentId), "POST_ID_INVALIDO");
  const observacao = await conferirPagamentoAcumuloPorGet(
    esperado, paymentId,
    (id) => consultarPagamentoAcumuloSandboxGet(id, tokenServidor, fetchSeguro),
  );
  return {
    paymentId, observacao, holdObrigatorio: true,
    podeQuitar: false, podeLiberarMotoboy: false,
  };
}
