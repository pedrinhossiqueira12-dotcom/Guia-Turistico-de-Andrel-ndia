// Worker privado de saque. NENHUMA chamada Pix acontece sem ativação explícita.
// Sempre reconcilia a transação por GET e só dá baixa em success/accredited.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { decryptCourierPix } from "../_shared/catalogo-entregas-crypto-v2.ts";
import { montarLotePix, creditoComprovado, payoutIds } from "../_shared/catalogo-saques-payout.ts";

const URL_BASE = Deno.env.get("SUPABASE_URL") || "";
const KEY_BUNDLE = Deno.env.get("SUPABASE_SECRET_KEYS") || "";
const LEGACY_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
let key = LEGACY_KEY;
try { const b = JSON.parse(KEY_BUNDLE); key = b.default || b.service_role || key; } catch { /* secret legacy */ }
const db = createClient(URL_BASE, key, { auth: { persistSession: false, autoRefreshToken: false } });
const sharedSecret = Deno.env.get("CATALOGO_SAQUE_WORKER_SECRET") || "";
const mode = Deno.env.get("MP_PAYOUTS_MODE") || "test";
const enabled = Deno.env.get("MP_PAYOUTS_ENABLED") === "true";
const token = Deno.env.get("MP_PAYOUTS_ACCESS_TOKEN") || "";
const encryptionKey = Deno.env.get("CATALOGO_DATA_ENCRYPTION_KEY") || Deno.env.get("MP_OAUTH_ENCRYPTION_KEY") || "";
const origin = "https://api.mercadopago.com";
const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const result = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : "";
const id = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9_-]{4,100}$/.test(v) ? v : "";
type RecordValue = Record<string, unknown>;
const object = (v: unknown): RecordValue => v && typeof v === "object" && !Array.isArray(v) ? v as RecordValue : {};
function constantTime(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length || a.length > 256) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function rpc(action: string, requestId: string, payout = "", transaction = "", status = "") {
  const { data, error } = await db.rpc("catalogo_saque_worker_v2", {
    p_acao: action, p_saque_id: requestId,
    p_payout_id: payout || null, p_transacao_id: transaction || null, p_status: status || null,
  });
  if (error || data?.ok !== true) {
    // Nunca exibir ciphertext / private credentials nos erros.
    throw new Error("Estado do saque incompatível com o processamento.");
  }
  return object(data);
}
function base64Pkcs8(input: string): Uint8Array {
  if (!/^[A-Za-z0-9+/=\s]+$/.test(input)) throw new Error("Chave de assinatura inválida.");
  const raw = atob(input.replace(/\s+/g, ""));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
async function sign(body: string): Promise<string> {
  const priv = Deno.env.get("MP_PAYOUTS_ED25519_PKCS8_B64") || "";
  if (!priv) throw new Error("Chave de assinatura não configurada.");
  const signing = await crypto.subtle.importKey(
    "pkcs8", base64Pkcs8(priv) as BufferSource, { name: "Ed25519" }, false, ["sign"]
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("Ed25519", signing, new TextEncoder().encode(body)));
  return btoa(String.fromCharCode(...bytes));
}
function configHeaders(): Record<string, string> {
  return { "accept": "application/json", "content-type": "application/json",
    "authorization": "Bearer " + token, ...(mode === "test" ? { "X-test-token": "true" } : {}) };
}
async function getTransaction(payout: string, transaction: string): Promise<RecordValue> {
  const response = await fetch(
    origin + "/v1/payouts/" + encodeURIComponent(payout) + "/transactions/" + encodeURIComponent(transaction),
    { method: "GET", headers: configHeaders(), signal: AbortSignal.timeout(16000) }
  );
  if (!response.ok) throw new Error("Consulta de payout não confirmada.");
  return object(await response.json());
}
async function createPayout(secureRequest: RecordValue): Promise<{ payoutId: string; transactionId: string }> {
  const pix = await decryptCourierPix(
    String(secureRequest.chave_pix_enc || ""), encryptionKey, String(secureRequest.motoboy_id || "")
  );
  const body = JSON.stringify(montarLotePix({
    referencia: String(secureRequest.referencia),
    valor_centavos: Number(secureRequest.valor_centavos),
    chave_pix: pix,
  }));
  const headers = configHeaders();
  headers["X-Idempotency-Key"] = String(secureRequest.referencia);
  if (mode === "test") {
    headers["X-enforce-signature"] = "false";
  } else {
    headers["X-enforce-signature"] = "true";
    headers["X-signature"] = await sign(body);
  }
  const response = await fetch(origin + "/v1/payouts", {
    method: "POST", headers, body, signal: AbortSignal.timeout(16000)
  });
  // 202 = apenas aceito para PROCESSAMENTO, nunca "pago".
  if (response.status !== 202) throw new Error("O provedor não aceitou a solicitação; requer conciliação.");
  return payoutIds(object(await response.json()));
}
async function execute(requestId: string) {
  const record = await rpc("consultar", requestId);
  if (record.estado === "pago") return { status: "pago", idempotente: true };
  if (!["solicitado","processando","aguardando_confirmacao"].includes(String(record.estado))) {
    throw new Error("Saque não disponível para processamento.");
  }
  let payout = id(record.payout_id), transaction = id(record.transacao_id);
  if (!payout || !transaction) {
    await rpc("preparar", requestId);
    const created = await createPayout(record); // idempotency key persistida no banco
    payout = created.payoutId; transaction = created.transactionId;
    await rpc("registrar", requestId, payout, transaction, "created");
  }
  const tx = await getTransaction(payout, transaction);
  // Anti-fraude: confira ID, referência, valor e estado final.
  if (id(tx.id) !== transaction ||
      tx.external_reference !== record.referencia ||
      object(tx.amount).currency !== "BRL" ||
      Math.round(Number(object(tx.amount).value) * 100) !== Number(record.valor_centavos)) {
    throw new Error("Transação retornada pelo provedor não corresponde ao saque.");
  }
  if (creditoComprovado(tx, {
    referencia: String(record.referencia), valor_centavos: Number(record.valor_centavos)
  })) {
    await rpc("confirmar", requestId, payout, transaction, "success/accredited");
    return { status: "pago", confirmado: true };
  }
  if (tx.status === "rejected" && typeof tx.status_detail === "string") {
    await rpc("falha", requestId, payout, transaction, "rejected");
    return { status: "falhou", confirmado: true };
  }
  // approved / created / pending / success-in_progress / error: NÃO liberar nem pagar.
  return { status: "aguardando_confirmacao", confirmado: false };
}
Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return result({ error: "Método inválido." }, 405);
  const supplied = request.headers.get("x-worker-secret") || "";
  if (!constantTime(supplied, sharedSecret)) return result({ error: "Acesso negado." }, 403);
  if (!enabled || !token || !encryptionKey || !URL_BASE || !key ||
      !["test","production"].includes(mode) ||
      (mode === "production" && Deno.env.get("MP_PAYOUTS_LIVE_ENABLED") !== "true")) {
    return result({ error: "Payouts ainda não habilitados e homologados." }, 503);
  }
  try {
    const body = object(await request.json());
    const requestId = uuid(body.saque_id);
    if (!requestId) return result({ error: "Solicitação inválida." }, 400);
    const output = await execute(requestId);
    return result({ ok: true, ...output });
  } catch (error) {
    console.error("Payout worker requires review", {
      class: error instanceof Error ? error.name : "unknown",
    });
    return result({ ok: false, mensagem: "Transferência não confirmada. Solicitação preservada para conciliação." }, 503);
  }
});
