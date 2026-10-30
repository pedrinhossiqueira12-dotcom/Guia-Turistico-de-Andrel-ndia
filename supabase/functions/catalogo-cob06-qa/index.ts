// COB-06 STAGING ONLY: funcao isolada para uma unica retirada ficticia.
// Nunca atende PROD nem altera a funcao catalogo-entregas em uso.
// Exige flag explicita + usuario Auth real + revisao fundamentada; RPC faz
// as verificacoes atomicas de pedido, ocorrencia, pagamento, logistica e fatura.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const STAGING_URL = "https://jbttwihctuibchhcyqtl.supabase.co";
const REVIEWER_UID = "d896cc0c-31e4-4ef7-8fa4-13d15f02dd2a";
const REVIEWER_EMAIL = "pedrinhossiqueira12@gmail.com";
const QA_ORDER = "a4ca7c4e-465f-4342-ae18-5c7eea1dec15";
const QA_MERCHANT = "asaas-cob02";
const URL = Deno.env.get("SUPABASE_URL") ?? "";
const ENABLED = Deno.env.get("COB06_QA_CANCELAMENTO_HABILITADO") === "true";
const LEGACY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUNDLE = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";
let secret = LEGACY;
try {
  const keys = BUNDLE ? JSON.parse(BUNDLE) : null;
  secret = keys?.default || keys?.service_role || LEGACY;
} catch { /* manter fallback ja usado no STAGING */ }

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: HEADERS });

class Reject extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
const object = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? v as Record<string, unknown> : {};
const uuid = (v: unknown): string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
    ? v : "";

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
  if (request.method !== "POST") return reply({ success: false, mensagem: "Use POST." }, 405);
  try {
    // O projeto e a flag sao barreiras independentes, fechadas por padrao.
    if (URL !== STAGING_URL || !ENABLED)
      throw new Reject("Operacao de homologacao desabilitada.", 403);
    if (!secret) throw new Reject("Autenticacao do servidor indisponivel.", 503);
    const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw new Reject("Sessao ausente.", 401);
    const db = createClient(URL, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // getUser(token) consulta o servidor Auth, nao aceita um UID do corpo.
    const { data, error } = await db.auth.getUser(token);
    if (error || !data?.user) throw new Reject("Sessao invalida.", 401);
    const authenticated = data.user;
    if (authenticated.id !== REVIEWER_UID ||
        authenticated.email?.toLowerCase() !== REVIEWER_EMAIL)
      throw new Reject("Revisor nao autorizado.", 403);

    const raw = await request.text();
    if (raw.length > 4000) throw new Reject("Solicitacao muito grande.", 400);
    let body: Record<string, unknown>;
    try { body = object(JSON.parse(raw)); }
    catch { throw new Reject("Corpo JSON invalido.", 400); }

    if (body.acao !== "cancelar_retirada_ficticia_qa" ||
        body.pedido_id !== QA_ORDER || body.comercio_id !== QA_MERCHANT ||
        !uuid(body.ocorrencia_id))
      throw new Reject("Pedido, comercio ou ocorrencia nao autorizados.", 403);

    const motivo = typeof body.motivo === "string" ? body.motivo.trim() : "";
    if (body.decisao !== "cancelamento_legitimo" ||
        body.sem_recebimento_confirmado !== true ||
        body.sem_entrega_confirmada !== true ||
        motivo.length < 15 || motivo.length > 500)
      throw new Reject("Confirme a natureza ficticia e justifique a revisao.", 400);

    const { data: operation, error: rpcError } = await db.rpc(
      "catalogo_cob06_cancelar_retirada_qa_v2",
      {
        p_operador_id: authenticated.id,
        p_ocorrencia_id: body.ocorrencia_id,
        p_decisao: "cancelamento_legitimo",
        p_motivo: motivo,
        p_ficticio_sem_recebimento: true,
      }
    );
    if (rpcError) {
      console.error("cob06 QA rpc error", { code: rpcError.code });
      throw new Reject("Revisao administrativa indisponivel.", 503);
    }
    const outcome = object(operation);
    if (outcome.ok !== true)
      throw new Reject(String(outcome.mensagem || "Operacao recusada pelas protecoes financeiras."),
        typeof outcome.http_status === "number" && outcome.http_status >= 400 &&
        outcome.http_status <= 499 ? outcome.http_status : 409);
    return reply({ ...outcome, success: true, pedido_id: QA_ORDER });
  } catch (cause) {
    if (cause instanceof Reject)
      return reply({ success: false, mensagem: cause.message }, cause.status);
    console.error("cob06 QA unexpected", { type: (cause as Error).name });
    return reply({ success: false, mensagem: "Operacao de homologacao indisponivel." }, 500);
  }
});
