import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const URL = Deno.env.get("SUPABASE_URL") ?? "";
const BUNDLE = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";
const LEGACY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ADMIN_USER_ID = "4b9a0233-6b72-4573-aebd-d596c5b15e1b";
const HEADERS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
let key = LEGACY;
try { const parsed = BUNDLE ? JSON.parse(BUNDLE) : null; key = parsed?.default || parsed?.service_role || LEGACY; } catch { /* fallback */ }
const db = createClient(URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
class HttpError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS });
const text = (value: unknown, max: number) => { const v = typeof value === "string" ? value.trim() : ""; if (v.length > max) throw new HttpError("Campo inválido."); return v; };
function month(value: unknown): string {
  let result = text(value, 10);
  if (!result) {
    const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "America/Sao_Paulo" }).formatToParts(new Date());
    result = `${parts.find(p => p.type === "year")?.value}-${parts.find(p => p.type === "month")?.value}`;
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])(?:-01)?$/.test(result)) throw new HttpError("Competência inválida.");
  return `${result.slice(0, 7)}-01`;
}

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
async function listOrders(comercioId: string, isPlatformAdmin = false) {
  // O snapshot da compra permanece igual se o produto for editado ou excluído depois.
  const { data, error } = await db.from("catalogo_pedidos").select("id,referencia_externa,status,status_pagamento,provedor,modalidade,forma_pagamento,subtotal_produtos_centavos,entrega_centavos,total_centavos,taxa_plataforma_centavos,taxa_motoboy_centavos,taxa_total_centavos,versao_financeira,aceito_em,entrega_status,motoboy_preferido_id,modo_distribuicao,coletado_em,em_entrega_em,reembolso_pendente,cliente_nome,cliente_telefone,cliente_endereco,cliente_numero,cliente_bairro,observacoes,criado_em,atualizado_em,concluido_em,itens:catalogo_pedido_itens(id,produto_id,nome_produto,descricao_produto,preco_unitario_centavos,quantidade,total_item_centavos)").eq("comercio_id", comercioId).order("criado_em", { ascending: false }).limit(100);
  if (error) throw new Error("Falha ao listar pedidos.");
  if (!data?.length) return [];
  const { data: assignments, error: assignmentError } = await db.from("catalogo_entregas_atribuidas")
    .select("pedido_id,motoboy_id").in("pedido_id", data.map(row => row.id)).eq("comercio_id", comercioId).limit(100);
  if (assignmentError) throw new Error("Falha ao consultar os responsáveis pelas entregas.");
  const assigned = new Map((assignments || []).map(row => [row.pedido_id, row.motoboy_id]));
  return data.map(row => {
    const visible: Record<string, unknown> = { ...row, itens: Array.isArray(row.itens) ? row.itens : [], motoboy_id: assigned.get(row.id) || null };
    if (!isPlatformAdmin && Number(row.versao_financeira) === 2 && !row.aceito_em) {
      // O comércio vê os valores e o bairro, mas não consegue desviar o contato antes de assumir a comissão.
      for (const field of Object.keys(visible)) if (field.startsWith("cliente_") && field !== "cliente_bairro") visible[field] = null;
      visible.cliente_nome = "Dados disponíveis após o aceite";
      visible.observacoes = null;
      visible.dados_cliente_ocultos = true;
    }
    return visible;
  });
}
async function updateStatus(userId: string, body: Record<string, unknown>) {
  const comercioId = text(body.comercio_id, 180); const pedidoId = text(body.pedido_id, 60); const next = text(body.status, 30); const motivo = text(body.motivo, 500);
  const access = await owner(userId, comercioId); if (access.bloqueado && next !== "cancelado") throw new HttpError("Catálogo bloqueado por inadimplência.", 423);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pedidoId)) throw new HttpError("Pedido inválido.");
  const operations: Record<string, string> = { em_preparo: "aceitar", pronto: "pronto", cancelado: "solicitar_cancelamento" };
  if (!operations[next]) throw new HttpError("Transição inválida.");
  if (next === "cancelado" && !motivo) throw new HttpError("Informe o motivo da solicitação de cancelamento.");
  const { data, error } = await db.rpc("catalogo_operar_pedido_v2", {
    p_operador_id: userId, p_comercio_id: comercioId, p_pedido_id: pedidoId,
    p_acao: operations[next], p_motoboy_id: null, p_motivo: motivo || null,
  });
  if (error) { console.error("Order operation failed", { code: error.code }); throw new Error("Falha ao processar a transição do pedido."); }
  if (!data?.ok) throw new HttpError(String(data?.mensagem || "A operação não foi autorizada."), Number(data?.http_status) || 409);
  return data.pedido || data;
}
async function confirmDelivery(userId: string, body: Record<string, unknown>) {
  const comercioId = text(body.comercio_id, 180);
  const pedidoId = text(body.pedido_id, 60);
  const code = text(body.codigo_entrega, 20);
  const entregador = text(body.entregador, 120);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pedidoId)) {
    throw new HttpError("Pedido inválido.");
  }
  if (!/^\d{6}$/.test(code)) throw new HttpError("Informe o código de seis dígitos.");
  // A propriedade já foi verificada em run e será revalidada na transação SQL.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  const codeHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const { data, error } = await db.rpc("catalogo_confirmar_entrega_autenticada", {
    p_operador_id: userId, p_comercio_id: comercioId, p_pedido_id: pedidoId,
    p_codigo_hash: codeHash, p_entregador: entregador || null,
  });
  if (error) {
    console.error("Authenticated delivery RPC failed", { code: error.code });
    throw new Error("Falha ao confirmar entrega. Verifique a migração de confirmação autenticada.");
  }
  const result = data as Record<string, unknown> | null;
  if (!result?.ok) {
    throw new HttpError(String(result?.mensagem || "Não foi possível concluir o pedido."), Number(result?.http_status) || 409);
  }
  return result;
}

async function statement(userId: string, comercioId: string, competencia: string) {
  await owner(userId, comercioId);
  const date = month(competencia);
  const { data: closing, error } = await db.from("catalogo_fechamentos_offline").select("id,comercio_id,competencia,total_pedidos,total_comissao_centavos,status,vencimento_em,pago_em,referencia_pagamento").eq("comercio_id", comercioId).eq("competencia", date).maybeSingle();
  if (error) throw new Error("Falha ao consultar fechamento.");
  const { data: fees, error: feeError } = await db.from("catalogo_comissoes_offline").select("pedido_id,competencia,subtotal_produtos_centavos,valor_comissao_centavos,status,criado_em").eq("comercio_id", comercioId).eq("competencia", date).order("criado_em", { ascending: false });
  if (feeError) throw new Error("Falha ao consultar comissões.");
  return { fechamento: closing, comissoes: fees || [] };
}
async function run(userId: string, body: Record<string, unknown>) {
  const action = text(body.acao, 40); const comercioId = text(body.comercio_id, 180);
  const access = await owner(userId, comercioId);
  if (action === "listar_pedidos") return json({ success: true, pedidos: await listOrders(comercioId, access.admin) });
  if (action === "atualizar_status") return json({ success: true, pedido: await updateStatus(userId, body) });
  if (action === "confirmar_entrega") return json({ success: true, pedido: await confirmDelivery(userId, body) });
  if (action === "consultar_fechamento") return json({ success: true, ...(await statement(userId, comercioId, month(body.competencia))) });
  if (action === "gerar_fechamento") {
    const competencia = month(body.competencia);
    const { data, error } = await db.rpc("catalogo_gerar_fechamento_offline", { p_comercio_id: comercioId, p_competencia: competencia });
    if (error) throw new Error("Falha ao gerar fechamento.");
    return json({ success: true, fechamento_id: data });
  }
  if (action === "registrar_pagamento") {
    if (!access.admin) throw new HttpError("Somente o administrador pode conferir pagamentos.", 403);
    throw new HttpError("A baixa manual por referência foi desativada. Concilie a cobrança Pix da fatura pelo provedor para liberar saldo com lastro.", 410);
  }
  return json({ success: false, mensagem: "Ação não reconhecida." }, 400);
}
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: HEADERS });
  if (request.method !== "POST") return json({ success: false, mensagem: "Use POST." }, 405);
  try { return await run((await auth(request)).id, (await request.json().catch(() => ({}))) as Record<string, unknown>); }
  catch (error) { if (error instanceof HttpError) return json({ success: false, mensagem: error.message }, error.status); console.error("catalogo-pedidos-offline-admin failed:", (error as Error).message); return json({ success: false, mensagem: "Falha temporária ao consultar pedidos offline." }, 500); }
});
