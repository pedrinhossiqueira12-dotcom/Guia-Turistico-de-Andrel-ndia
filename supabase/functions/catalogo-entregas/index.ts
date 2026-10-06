import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const BUNDLE = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";
const LEGACY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
let serviceKey = LEGACY;
try { const parsed = BUNDLE ? JSON.parse(BUNDLE) : null; serviceKey = parsed?.default || parsed?.service_role || LEGACY; } catch { /* Fallback de rotação. */ }
const db = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

class HttpError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "") { super(message); this.status = status; this.code = code || (status === 403 ? "acesso_bloqueado" : ""); }
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS });
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
function text(value: unknown, max: number): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (result.length > max) throw new HttpError("Campo inválido.");
  return result;
}
function uuid(value: unknown, optional = false): string | null {
  if (optional && (value === null || value === undefined || value === "")) return null;
  const result = text(value, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result)) throw new HttpError("Identificador inválido.");
  return result;
}
function offset(value: unknown): number {
  const result = value === undefined ? 0 : Number(value);
  if (!Number.isInteger(result) || result < 0 || result > 10000) throw new HttpError("Página inválida.");
  return result;
}
async function user(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new HttpError("Sessão ausente.", 401);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError("Sessão inválida.", 401);
  return data.user;
}
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    console.error("Restricted delivery RPC failed", { name, code: error.code });
    throw new HttpError("Não foi possível consultar as entregas. Tente novamente.", 500);
  }
  const result = record(data);
  if (result.ok !== true) throw new HttpError(String(result.mensagem || "Acesso não autorizado."), Number(result.http_status) || 403, result.mensagem === "Código de entrega incorreto." ? "codigo_incorreto" : "");
  const { ok, ...payload } = result;
  return payload;
}
async function run(userId: string, body: Record<string, unknown>) {
  const action = text(body.acao, 40);
  // As ações do motoboy nunca encaminham comercio_id para modo de gestão.
  if (action === "listar_entregas") {
    const result = await rpc("catalogo_listar_entregas_restritas", { p_operador_id: userId, p_comercio_id: null, p_offset: offset(body.offset) });
    return json({ success: true, ...result });
  }
  if (action === "confirmar_entrega") {
    const comercioId = text(body.comercio_id, 180);
    const code = text(body.codigo_entrega, 6);
    if (!/^[a-z0-9-]{1,180}$/.test(comercioId)) throw new HttpError("Comércio inválido.");
    if (!/^\d{6}$/.test(code)) throw new HttpError("Informe os seis dígitos do código.");
    if (body.recebimento_confirmado !== true) throw new HttpError("Confirme a entrega e o recebimento do pagamento presencial.");
    const pedidoId = uuid(body.pedido_id);
    // O endpoint motoboy exige vínculo ativo + atribuição mesmo se o operador também for proprietário.
    const { data: membership, error: membershipError } = await db.from("catalogo_motoboys")
      .select("usuario_id").eq("comercio_id", comercioId).eq("usuario_id", userId).eq("ativo", true).maybeSingle();
    if (membershipError) throw new HttpError("Falha ao verificar autorização.", 500);
    if (!membership) throw new HttpError("Acesso de motoboy não autorizado neste comércio.", 403);
    const { data: assigned, error: assignmentError } = await db.from("catalogo_entregas_atribuidas")
      .select("pedido_id").eq("comercio_id", comercioId).eq("pedido_id", pedidoId).eq("motoboy_id", userId).maybeSingle();
    if (assignmentError) throw new HttpError("Falha ao verificar a atribuição.", 500);
    if (!assigned) throw new HttpError("Este pedido não está atribuído à sua conta.", 403);
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
    const codeHash = [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const result = await rpc("catalogo_confirmar_entrega_motoboy", {
      p_operador_id: userId, p_comercio_id: comercioId, p_pedido_id: pedidoId, p_codigo_hash: codeHash,
    });
    return json({ success: true, pedido: result });
  }
  const management = new Set(["listar_motoboys", "autorizar_motoboy", "suspender_motoboy", "atribuir_pedido", "listar_para_atribuicao"]);
  if (!management.has(action)) throw new HttpError("Ação não reconhecida.");
  const comercioId = text(body.comercio_id, 180);
  if (!/^[a-z0-9-]{1,180}$/.test(comercioId)) throw new HttpError("Comércio inválido.");
  if (action === "listar_para_atribuicao") {
    const result = await rpc("catalogo_listar_entregas_restritas", { p_operador_id: userId, p_comercio_id: comercioId, p_offset: offset(body.offset) });
    return json({ success: true, ...result });
  }
  const result = await rpc("catalogo_gerir_motoboys", {
    p_operador_id: userId, p_acao: action, p_comercio_id: comercioId,
    p_pedido_id: action === "atribuir_pedido" ? uuid(body.pedido_id) : null,
    p_motoboy_id: ["atribuir_pedido", "suspender_motoboy"].includes(action) ? uuid(body.motoboy_id, action === "atribuir_pedido") : null,
    p_email: action === "autorizar_motoboy" ? text(body.email, 180).toLowerCase() : null,
    p_nome: action === "autorizar_motoboy" ? text(body.nome, 120) : null,
    p_offset: offset(body.offset),
  });
  return json({ success: true, ...result });
}
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: HEADERS });
  if (request.method !== "POST") return json({ success: false, mensagem: "Use POST." }, 405);
  try { return await run((await user(request)).id, record(await request.json().catch(() => ({})))); }
  catch (error) {
    if (error instanceof HttpError) return json({ success: false, mensagem: error.message, codigo: error.code }, error.status);
    console.error("catalogo-entregas failed", { type: (error as Error).name });
    return json({ success: false, mensagem: "Não foi possível consultar as entregas." }, 500);
  }
});
