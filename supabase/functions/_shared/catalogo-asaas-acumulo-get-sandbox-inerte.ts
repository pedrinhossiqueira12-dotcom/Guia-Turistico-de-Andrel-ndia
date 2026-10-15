// COB-06: adaptador GET bancario SOMENTE Sandbox; ainda nao importado pela Edge.
// Nao envia POST, nao aprova baixa, e nunca devolve token/corpo de erro remoto.
const BASE = "https://api-sandbox.asaas.com/v3";
const MAX_BYTES = 65536;
type FetchSeguro = typeof fetch;

export async function consultarPagamentoAcumuloSandboxGet(
  paymentId: string,
  tokenServidor: string,
  fetchSeguro: FetchSeguro = fetch,
): Promise<unknown> {
  if (!/^pay_[A-Za-z0-9_-]{5,120}$/.test(paymentId))
    throw new Error("COB06_HOLD_PAGAMENTO_INVALIDO");
  if (typeof tokenServidor !== "string" || !tokenServidor.trim() ||
    tokenServidor.length > 2048 || /[\r\n]/.test(tokenServidor))
    throw new Error("COB06_HOLD_CREDENCIAL_INDISPONIVEL");
  let response: Response;
  try {
    response = await fetchSeguro(`${BASE}/payments/${paymentId}`, {
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
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES))
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
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)); }
  catch { throw new Error("COB06_HOLD_RESPOSTA_INVALIDA"); }
}
