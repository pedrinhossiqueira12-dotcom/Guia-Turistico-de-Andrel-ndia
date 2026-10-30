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
// A marca de inicio deve ser COMMITADA no banco antes do transporte HTTP.
type MarcarInicioPostCi = (loteId: string, operacaoId: string) => Promise<unknown>;
export type CobrancaCandidata = {
  paymentId: string;
  observacao: ObservacaoRemota;
  holdObrigatorio: true;
  podeQuitar: false;
  podeLiberarMotoboy: false;
};

// Contrato FUTURO, ainda sem emissor SQL real. A reserva SQL05 e o gate
// SQL13 CI-only retornam permissoes falsas: ambos devem ser recusados.
// Somente fixture sintetica em CI pode produzir um recibo positivo hoje.
export type AutorizacaoEmissaoSandbox = {
  lote_id: string;
  referencia: string;
  cliente_id: string;
  valor_centavos: number;
  operacao_id: string;
  nova_tentativa: true;
  prova_get_externa: true;
  autorizacao_externa: true;
  pode_emitir_pix: true;
  pode_repetir_post: false;
  pode_quitar: false;
  pode_liberar_motoboy: false;
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
// Recusa qualquer recibo SQL13 atual (autorizacao_externa=false) e qualquer
// permissao fabricada com identidade/valor divergentes. Esta verificacao nao
// substitui a futura autenticacao/atestado GET no backend e gate transacional.
function validarRecibo(esperado: ExpectativaAcumulo, bruto: unknown): void {
  exige(bruto !== null && typeof bruto === "object" && !Array.isArray(bruto),
    "AUTORIZACAO_SQL_AUSENTE");
  const r = bruto as Record<string, unknown>;
  exige(r.lote_id === esperado.loteId &&
    r.referencia === esperado.referencia &&
    r.cliente_id === esperado.clienteId &&
    r.valor_centavos === esperado.valorCentavos &&
    typeof r.operacao_id === "string" &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(r.operacao_id) &&
    r.nova_tentativa === true &&
    r.prova_get_externa === true &&
    r.autorizacao_externa === true &&
    r.pode_emitir_pix === true &&
    r.pode_repetir_post === false &&
    r.pode_quitar === false &&
    r.pode_liberar_motoboy === false,
    "AUTORIZACAO_SQL_AUSENTE");
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
  // O HTTP pode informar um Content-Length falso ou truncado. Mesmo
  // um JSON sintaticamente valido nao e prova de emissao se os bytes divergem.
  // O resultado fica em HOLD, sem reenvio automatico do POST.
  exige(length === null || total === Number(length), "POST_RESPOSTA_INVALIDA");
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
  recibo: unknown,
  marcarInicioPostCi: MarcarInicioPostCi,
  fetchSeguro: FetchSeguro = fetch,
): Promise<CobrancaCandidata> {
  validarEntrada(esperado, vencimento, tokenServidor);
  // O modulo ainda e CI-ONLY. Proibir o fetch nativo mesmo que o recibo
  // venha a ser positivo: nenhuma Edge pode importar e emitir por acidente.
  exige(fetchSeguro !== fetch, "CI_ONLY_REDE_REAL_BLOQUEADA");
  validarRecibo(esperado, recibo);
  exige(typeof marcarInicioPostCi === "function", "MARCO_INICIO_AUSENTE");
  const operacaoId = (recibo as AutorizacaoEmissaoSandbox).operacao_id;
  let marco: unknown;
  try {
    // Commit duravel e retorno de identidade devem ocorrer ANTES de um POST.
    marco = await marcarInicioPostCi(esperado.loteId, operacaoId);
  } catch {
    throw new Error("COB06_HOLD_MARCO_INICIO_INCONCLUSIVO");
  }
  exige(marco !== null && typeof marco === "object" && !Array.isArray(marco),
    "MARCO_INICIO_INVALIDO");
  const m = marco as Record<string, unknown>;
  exige(m.ok === true && m.simulacao_ci === true && m.marco_persistido === true &&
    m.lote_id === esperado.loteId && m.operacao_id === operacaoId &&
    m.referencia === esperado.referencia &&
    m.cliente_id === esperado.clienteId &&
    m.valor_centavos === esperado.valorCentavos &&
    m.pode_enviar_post_mock === true && m.pode_repetir_post === false &&
    m.pode_quitar === false && m.pode_liberar_motoboy === false &&
    m.reconciliar_por_get === true,
    "MARCO_INICIO_INVALIDO");
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
