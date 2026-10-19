// COB-06: GET bancario SOMENTE Sandbox, usado pela Edge administrativa com flags OFF.
// Nao envia POST, nao aprova baixa, e nunca devolve token/corpo de erro remoto.
const BASE = "https://api-sandbox.asaas.com/v3";
const MAX_BYTES = 65536;
type FetchSeguro = typeof fetch;
// Metadados de UMA listagem GET negativa validada. Apenas para trilha QA;
// nao atesta ausencia futura nem autoriza emissao financeira.
export type EvidenciaGetNegativa = {
  httpStatus: 200;
  totalCount: 0;
  itensCount: 0;
  hasMore: false;
  respostaSha256: string;
};

function validarToken(tokenServidor: string) {
  if (typeof tokenServidor !== "string" || !tokenServidor.trim() ||
    tokenServidor.length > 2048 || /[\r\n]/.test(tokenServidor))
    throw new Error("COB06_HOLD_CREDENCIAL_INDISPONIVEL");
}

async function buscarJsonSandbox(
  url: string,
  tokenServidor: string,
  fetchSeguro: FetchSeguro,
  receberCorpoLimitado?: (corpo: Uint8Array) => void,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchSeguro(url, {
      method: "GET", redirect: "error", cache: "no-store",
      headers: { access_token: tokenServidor, Accept: "application/json",
        "User-Agent": "GuiaAndrelandia-COB06/1.0" },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error("COB06_HOLD_GET_INDISPONIVEL");
  }
  if (!response.ok || response.status !== 200)
    throw new Error("COB06_HOLD_GET_INDISPONIVEL");
  const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (mime !== "application/json")
    throw new Error("COB06_HOLD_RESPOSTA_INVALIDA");
  const length = response.headers.get("content-length");
  if (length !== null &&
    (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) ||
      Number(length) > MAX_BYTES))
    throw new Error("COB06_HOLD_RESPOSTA_INVALIDA");
  if (!response.body) throw new Error("COB06_HOLD_RESPOSTA_INVALIDA");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) throw new Error("COB06_HOLD_RESPOSTA_INVALIDA");
      chunks.push(value);
    }
  } catch {
    throw new Error("COB06_HOLD_RESPOSTA_INVALIDA");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  let valor: unknown;
  try { valor = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)); }
  catch { throw new Error("COB06_HOLD_RESPOSTA_INVALIDA"); }
  // Somente bytes de resposta JSON aceita (limite MAX_BYTES), jamais headers
  // com access_token. O chamador nao usa callback para gravar em banco aqui.
  receberCorpoLimitado?.(buffer);
  return valor;
}

export async function consultarPagamentoAcumuloSandboxGet(
  paymentId: string,
  tokenServidor: string,
  fetchSeguro: FetchSeguro = fetch,
): Promise<unknown> {
  if (!/^pay_[A-Za-z0-9_-]{5,120}$/.test(paymentId))
    throw new Error("COB06_HOLD_PAGAMENTO_INVALIDO");
  validarToken(tokenServidor);
  return buscarJsonSandbox(`${BASE}/payments/${paymentId}`, tokenServidor, fetchSeguro);
}

// Localiza exclusivamente uma cobranca JA EXISTENTE pelo identificador interno.
// O limite 2 identifica duplicidade, e hasMore impede aceitar paginas incompletas.
// O registro financeiro continua em HOLD ate GET completo por ID verificado.
export async function encontrarIdPagamentoAcumuloSandboxPorReferencia(
  referencia: string,
  tokenServidor: string,
  fetchSeguro: FetchSeguro = fetch,
  capturarNegativa?: (dados: EvidenciaGetNegativa) => void,
): Promise<string> {
  if (!/^guia-acumulo-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(referencia))
    throw new Error("COB06_HOLD_REFERENCIA_INVALIDA");
  validarToken(tokenServidor);
  const url = new URL(`${BASE}/payments`);
  url.searchParams.set("externalReference", referencia);
  url.searchParams.set("limit", "2");
  url.searchParams.set("offset", "0");
  const corpoLimitado: { bytes?: Uint8Array } = {};
  const bruto = await buscarJsonSandbox(url.toString(), tokenServidor, fetchSeguro,
    capturarNegativa ? (bytes) => { corpoLimitado.bytes = bytes; } : undefined);
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto))
    throw new Error("COB06_HOLD_LISTAGEM_INVALIDA");
  const lista = bruto as Record<string, unknown>;
  if (lista.object !== "list" || !Array.isArray(lista.data) ||
    typeof lista.hasMore !== "boolean" ||
    // totalCount e obrigatorio para distinguir ausencia real de pagina
    // parcial/truncada. Sem ele, uma lista vazia NAO e prova negativa.
    typeof lista.totalCount !== "number" ||
    !Number.isSafeInteger(lista.totalCount) || lista.totalCount < 0 ||
    (lista.offset !== undefined && lista.offset !== 0))
    throw new Error("COB06_HOLD_LISTAGEM_INVALIDA");
  if (lista.data.length === 0 && lista.hasMore === false &&
    lista.totalCount === 0) {
    if (capturarNegativa) {
      if (!corpoLimitado.bytes)
        throw new Error("COB06_HOLD_GET_INCONCLUSIVO");
      // Buffer proprio (ArrayBuffer, nao SharedArrayBuffer) para WebCrypto.
      const entradaDigest = new Uint8Array(corpoLimitado.bytes.byteLength);
      entradaDigest.set(corpoLimitado.bytes);
      const digest = await crypto.subtle.digest("SHA-256", entradaDigest.buffer);
      const hash = Array.from(new Uint8Array(digest),
        (n) => n.toString(16).padStart(2, "0")).join("");
      capturarNegativa({
        httpStatus: 200, totalCount: 0, itensCount: 0,
        hasMore: false, respostaSha256: hash,
      });
    }
    throw new Error("COB06_HOLD_PAGAMENTO_NAO_LOCALIZADO");
  }
  if (lista.hasMore || lista.data.length !== 1 || lista.totalCount !== 1)
    throw new Error("COB06_HOLD_REFERENCIA_NAO_UNICA");
  const item = lista.data[0] as Record<string, unknown> | null;
  if (!item || typeof item !== "object" || Array.isArray(item) ||
    typeof item.id !== "string" || !/^pay_[A-Za-z0-9_-]{5,120}$/.test(item.id))
    throw new Error("COB06_HOLD_LISTAGEM_INVALIDA");
  return item.id;
}
