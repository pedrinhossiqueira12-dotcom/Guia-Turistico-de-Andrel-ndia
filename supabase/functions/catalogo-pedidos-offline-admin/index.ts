import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL") ?? "";
const BUNDLE = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";
const LEGACY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ADMIN_USER_ID = "4b9a0233-6b72-4573-aebd-d596c5b15e1b";
const HEADERS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
let key = LEGACY;
try { const parsed = BUNDLE ? JSON.parse(BUNDLE) : null; key = parsed?.default || parsed?.service_role || LEGACY; } catch { /* fallback */ }
const db = createClient(URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
class HttpError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS });
const text = (value: unknown, max: number) => { const v = typeof value === "string" ? value.trim() : ""; if (v.length > max) throw new HttpError("Campo inválido."); return v; };

async function auth(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new HttpError("Sessão ausente.", 401);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError("Sessão inválida.", 401);
  return data.user;
}
async function owner(userId: string, comercioId: string) {
  if (!/^[a-z0-9-]{1,180}$/.test(comercioId)) throw new HttpError("Comércio inválido.");
  if (userId === ADMIN_USER_ID) return { admin: true };
  const { data, error } = await db.from("catalogos").select("comercio_id,proprietario_id,bloqueado").eq("comercio_id", comercioId).maybeSingle();
  if (error) throw new Error("Falha ao verificar propriedade.");
  if (!data || data.proprietario_id !== userId) throw new HttpError("Acesso não autorizado.", 403);
  return { admin: false, bloqueado: data.bloqueado };
}
const transitions: Record<string, string[]> = {
  aguardando_pagamento: ["em_preparo", "cancelado"],
  em_preparo: ["pronto", "cancelado"],
  pronto: ["cancelado"],
};
async function listOrders(comercioId: string) {
  const { data, error } = await db.from("catalogo_pedidos").select("id,referencia_externa,status,status_pagamento,modalidade,forma_pagamento,subtotal_produtos_centavos,entrega_centavos,total_centavos,taxa_plataforma_centavos,cliente_nome,cliente_telefone,cliente_endereco,cliente_numero,cliente_bairro,observacoes,criado_em,atualizado_em,concluido_em").eq("comercio_id", comercioId).eq("provedor", "offline").order("criado_em", { ascending: false }).limit(100);
  if (error) throw new Error("Falha ao listar pedidos.");
  return data || [];
}
async function updateStatus(userId: string, body: Record<string, unknown>) {
  const comercioId = text(body.comercio_id, 180); const pedidoId = text(body.pedido_id, 60); const next = text(body.status, 30); const motivo = text(body.motivo, 500);
  const access = await owner(userId, comercioId); if (access.bloqueado && next !== "cancelado") throw new HttpError("Catálogo bloqueado por inadimplência.", 423);
  if (!transitions[next] && !Object.keys(transitions).some((from) => transitions[from].includes(next))) throw new HttpError("Transição inválida.");
  const { data: current, error: readError } = await db.from("catalogo_pedidos").select("id,status,status_pagamento").eq("id", pedidoId).eq("comercio_id", comercioId).eq("provedor", "offline").maybeSingle();
  if (readError || !current) throw new HttpError("Pedido não encontrado.", 404);
  if (!transitions[current.status]?.includes(next)) throw new HttpError("Esta transição não é permitida.", 409);
  const { data, error } = await db.from("catalogo_pedidos").update({ status: next, cancelado_em: next === "cancelado" ? new Date().toISOString() : null, motivo_cancelamento: next === "cancelado" ? motivo || "Cancelado pelo comércio." : null }).eq("id", pedidoId).eq("status", current.status).select("id,status,status_pagamento,atualizado_em").maybeSingle();
  if (error || !data) throw new HttpError("O pedido foi alterado por outra sessão; atualize a lista.", 409);
  return data;
}
async function statement(userId: string, comercioId: string, competencia: string) {
  await owner(userId, comercioId);
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(competencia)) throw new HttpError("Competência inválida.");
  const date = `${competencia.slice(0, 7)}-01`;
  const { data: closing, error } = await db.from("catalogo_fechamentos_offline").select("id,comercio_id,competencia,total_pedidos,total_comissao_centavos,status,vencimento_em,pago_em,referencia_pagamento").eq("comercio_id", comercioId).eq("competencia", date).maybeSingle();
  if (error) throw new Error("Falha ao consultar fechamento.");
  const { data: fees, error: feeError } = await db.from("catalogo_comissoes_offline").select("pedido_id,competencia,subtotal_produtos_centavos,valor_comissao_centavos,status,criado_em").eq("comercio_id", comercioId).eq("competencia", date).order("criado_em", { ascending: false });
  if (feeError) throw new Error("Falha ao consultar comissões.");
  return { fechamento: closing, comissoes: fees || [] };
}
async function run(userId: string, body: Record<string, unknown>) {
  const action = text(body.acao, 40); const comercioId = text(body.comercio_id, 180);
  const access = await owner(userId, comercioId);
  if (action === "listar_pedidos") return json({ success: true, pedidos: await listOrders(comercioId) });
  if (action === "atualizar_status") return json({ success: true, pedido: await updateStatus(userId, body) });
  if (action === "consultar_fechamento") return json({ success: true, ...(await statement(userId, comercioId, text(body.competencia, 10) || new Date().toISOString().slice(0, 7))) });
  if (action === "gerar_fechamento") {
    const competencia = text(body.competencia, 10) || new Date().toISOString().slice(0, 7);
    const { data, error } = await db.rpc("catalogo_gerar_fechamento_offline", { p_comercio_id: comercioId, p_competencia: `${competencia.slice(0, 7)}-01` });
    if (error) throw new Error("Falha ao gerar fechamento.");
    return json({ success: true, fechamento_id: data });
  }
  if (action === "registrar_pagamento") {
    if (!access.admin) throw new HttpError("Somente o administrador pode conferir pagamentos.", 403);
    const referencia = text(body.referencia_pagamento, 120); if (!referencia) throw new HttpError("Informe a referência do pagamento.");
    const competencia = `${text(body.competencia, 10).slice(0, 7)}-01`;
    const { data, error } = await db.from("catalogo_fechamentos_offline").update({ status: "pago", pago_em: new Date().toISOString(), referencia_pagamento: referencia }).eq("comercio_id", comercioId).eq("competencia", competencia).select("id,status,pago_em,referencia_pagamento").maybeSingle();
    if (error || !data) throw new HttpError("Fechamento não encontrado.", 404);
    await db.from("catalogo_comissoes_offline").update({ status: "paga", pago_em: new Date().toISOString(), referencia_pagamento: referencia }).eq("comercio_id", comercioId).eq("competencia", competencia).in("status", ["faturada", "bloqueado"]);
    await db.from("catalogos").update({ bloqueado: false, motivo_bloqueio: null }).eq("comercio_id", comercioId).eq("bloqueado", true);
    return json({ success: true, fechamento: data });
  }
  return json({ success: false, mensagem: "Ação não reconhecida." }, 400);
}
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: HEADERS });
  if (request.method !== "POST") return json({ success: false, mensagem: "Use POST." }, 405);
  try { return await run((await auth(request)).id, (await request.json().catch(() => ({}))) as Record<string, unknown>); }
  catch (error) { if (error instanceof HttpError) return json({ success: false, mensagem: error.message }, error.status); console.error("catalogo-pedidos-offline-admin failed:", (error as Error).message); return json({ success: false, mensagem: "Falha temporária ao consultar pedidos offline." }, 500); }
});
