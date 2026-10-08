import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { encryptCourierPix, decryptCourierPix } from "../_shared/catalogo-entregas-crypto-v2.ts";
import { validarChavePixTipadaV2, ehTipoChavePixV2 } from "../_shared/catalogo-pix-chave-v2.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const BUNDLE = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";
const LEGACY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DATA_KEY = Deno.env.get("CATALOGO_DATA_ENCRYPTION_KEY") || Deno.env.get("MP_OAUTH_ENCRYPTION_KEY") || "";
const ADMIN_USER_ID = "4b9a0233-6b72-4573-aebd-d596c5b15e1b";
const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
let serviceKey = LEGACY;
try { const parsed = BUNDLE ? JSON.parse(BUNDLE) : null; serviceKey = parsed?.default || parsed?.service_role || LEGACY; } catch { /* Rotação. */ }
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
function commerce(value: unknown): string {
  const id = text(value, 180);
  if (!/^[a-z0-9-]{1,180}$/.test(id)) throw new HttpError("Comércio inválido.");
  return id;
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
    console.error("Delivery transaction failed", { name, code: error.code });
    throw new HttpError("Não foi possível processar a operação de entrega. Tente novamente.", 500);
  }
  const result = record(data);
  if (result.ok !== true) throw new HttpError(String(result.mensagem || "Acesso não autorizado."), Number(result.http_status) || 403, result.mensagem === "Código de entrega incorreto." ? "codigo_incorreto" : "");
  const { ok, ...payload } = result;
  return payload;
}
async function personalStatement(payload: Record<string, unknown>, userId: string) {
  const profile = record(payload.perfil);
  const cipher = String(profile.chave_pix_enc || "");
  const { chave_pix_enc: _cipher, chave_pix: _legacy, ...publicProfile } = profile;
  let key = "";
  let unavailable = false;
  if (cipher) {
    try { key = await decryptCourierPix(cipher, DATA_KEY, userId); }
    catch { unavailable = true; }
  }
  return { ...payload, perfil: { ...publicProfile, chave_pix: key, chave_pix_indisponivel: unavailable } };
}
async function administrativeStatement(payload: Record<string, unknown>) {
  const credits = Array.isArray(payload.remuneracoes) ? payload.remuneracoes : [];
  const normalized = await Promise.all(credits.map(async (value) => {
    const item = record(value);
    const { chave_pix_enc: cipher, pix_ciphertext: _alias, ...safe } = item;
    let key = "";
    if (typeof cipher === "string" && cipher) {
      try { key = await decryptCourierPix(cipher, DATA_KEY, String(item.motoboy_id || item.beneficiario_id || "")); }
      catch { /* A prova de crédito continua visível, mas nunca se expõe ciphertext ou chave em claro indevida. */ }
    }
    return { ...safe, status: item.status === "disponivel" ? "a_receber" : item.status,
      financiado: item.financiamento_comprovado === true, chave_pix: key,
      pedido_ids: item.pedido_id ? [item.pedido_id] : item.pedido_ids,
      provas: Array.isArray(item.provas) ? item.provas : (item.financiamento_comprovado === true ? ["Financiamento comprovado registrado pelo backend"] : []) };
  }));
  return { ...payload, remuneracoes: normalized, admin: true };
}
async function confirmDelivery(userId: string, body: Record<string, unknown>) {
  const comercioId = commerce(body.comercio_id);
  const code = text(body.codigo_entrega, 6);
  if (!/^\d{6}$/.test(code)) throw new HttpError("Informe os seis dígitos do código.");
  if (body.recebimento_confirmado !== true) throw new HttpError("Confirme a entrega e, nos pedidos presenciais, o recebimento do pagamento.");
  const pedidoId = uuid(body.pedido_id);
  // As duas provas são revalidadas dentro da mesma transação SQL que consome o código.
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
  return await rpc("catalogo_confirmar_entrega_motoboy", {
    p_operador_id: userId, p_comercio_id: comercioId, p_pedido_id: pedidoId, p_codigo_hash: codeHash,
  });
}
async function run(userId: string, body: Record<string, unknown>) {
  const action = text(body.acao, 40);
  // Identidade e escopo vêm do JWT. Nunca encaminhar comercio_id para ampliar uma lista do motoboy.
  if (action === "listar_entregas") {
    return json({ success: true, ...(await rpc("catalogo_listar_entregas_v2", { p_operador_id: userId, p_offset: offset(body.offset) })) });
  }
  if (action === "consultar_extrato") {
    const statement = await rpc("catalogo_motoboy_extrato_v2", { p_operador_id: userId, p_offset: offset(body.offset) });
    return json({ success: true, ...(await personalStatement(statement, userId)) });
  }
  if (action === "consultar_saques" || action === "solicitar_saque") {
    const data = await rpc("catalogo_motoboy_saque_mensal_v2", {
      p_operador_id: userId, p_acao: action === "solicitar_saque" ? "solicitar" : "listar",
    });
    return json({ success: true, ...data });
  }
  if (action === "salvar_chave_pix") {
    const chave = text(body.chave_pix, 120);
    const tipo = chave ? text(body.chave_pix_tipo, 16) : "";
    if ((chave && (!ehTipoChavePixV2(tipo) || !validarChavePixTipadaV2(tipo, chave))) ||
        (!chave && text(body.chave_pix_tipo, 16))) {
      throw new HttpError("Selecione o tipo correto e informe uma chave Pix válida.");
    }
    let cifrada: string | null;
    try { cifrada = await encryptCourierPix(chave, DATA_KEY, userId); }
    catch { throw new HttpError("Não foi possível proteger sua chave Pix.", 503); }
    const updated = await rpc("catalogo_salvar_chave_pix_tipado_v2", {
      p_operador_id: userId, p_chave_pix_enc: cifrada, p_chave_pix_tipo: tipo || null,
    });
    return json({ success: true, ...updated, perfil: {
      chave_pix: chave, chave_pix_tipo: tipo || null,
    } });
  }
  if (action === "confirmar_entrega") return json({ success: true, pedido: await confirmDelivery(userId, body) });

  const deliveryActions: Record<string, string> = {
    definir_disponibilidade: "disponibilidade", aceitar_entrega: "aceitar_entrega",
    coletar: "coletar", em_entrega: "em_entrega", desistir_entrega: "desistir",
    registrar_ocorrencia: "registrar_ocorrencia",
  };
  if (deliveryActions[action]) {
    const personal = action === "definir_disponibilidade";
    if (action === "definir_disponibilidade" && typeof body.disponivel !== "boolean") throw new HttpError("Informe sua disponibilidade.");
    const reason = text(body.motivo, 500);
    if (["desistir_entrega", "registrar_ocorrencia"].includes(action) && !reason) throw new HttpError("Informe o motivo da ocorrência.");
    return json({ success: true, ...(await rpc("catalogo_motoboy_acao_v2", {
      p_operador_id: userId, p_acao: deliveryActions[action],
      p_pedido_id: personal ? null : uuid(body.pedido_id),
      p_disponivel: action === "definir_disponibilidade" ? body.disponivel : null,
      p_motivo: reason || null, p_categoria: text(body.categoria, 60) || null,
      p_chave_pix: null,
    })) });
  }

  const adminActions: Record<string, string> = {
    operacao_admin: "listar_operacao", resolver_ocorrencia: "resolver_ocorrencia", registrar_repasse: "registrar_repasse",
  };
  if (adminActions[action]) {
    if (userId !== ADMIN_USER_ID) throw new HttpError("Somente a administração da plataforma pode executar esta operação.", 403);
    let orderIds: (string | null)[] | null = null;
    if (action === "registrar_repasse") {
      if (body.transferencia_confirmada !== true) throw new HttpError("Registre somente uma transferência já realizada e conferida no banco.");
      if (!Array.isArray(body.pedido_ids) || !body.pedido_ids.length || body.pedido_ids.length > 100) throw new HttpError("Selecione de um a cem créditos disponíveis.");
      orderIds = [...new Set(body.pedido_ids.map((value) => uuid(value)))];
      if (!text(body.referencia, 120) || !text(body.comprovante, 500)) throw new HttpError("Informe a referência e a comprovação do repasse.");
    }
    const operation = await rpc("catalogo_operacao_admin_v2", {
      p_operador_id: userId, p_acao: adminActions[action],
      p_ocorrencia_id: action === "resolver_ocorrencia" ? uuid(body.ocorrencia_id) : null,
      p_decisao: text(body.decisao, 60) || null, p_motivo: text(body.motivo, 1000) || null,
      p_motoboy_id: action === "registrar_repasse" ? uuid(body.motoboy_id) : null,
      p_pedido_ids: orderIds, p_referencia: text(body.referencia, 120) || null,
      p_comprovante: text(body.comprovante, 500) || null,
    });
    if (action === "operacao_admin") {
      const { data: requests, error: queueError } = await db.from("catalogo_solicitacoes_saque_v2")
        .select("id,motoboy_id,mes_referencia,valor_centavos,status,solicitado_em,repasse_id")
        .in("status", ["solicitado", "em_analise"])
        .order("solicitado_em", { ascending: true }).limit(100);
      if (queueError) throw new HttpError("Não foi possível consultar a fila de saques.", 500);
      return json({ success: true, ...(await administrativeStatement(operation)),
        solicitacoes_saque: requests || [], admin: true });
    }
    return json({ success: true, ...operation, admin: true });
  }

  const management = new Set(["listar_motoboys", "autorizar_motoboy", "suspender_motoboy", "atribuir_pedido", "listar_para_atribuicao"]);
  if (!management.has(action)) throw new HttpError("Ação não reconhecida.");
  const comercioId = commerce(body.comercio_id);
  if (action === "atribuir_pedido") {
    return json({ success: true, ...(await rpc("catalogo_operar_pedido_v2", {
      p_operador_id: userId, p_comercio_id: comercioId, p_pedido_id: uuid(body.pedido_id),
      p_acao: "atribuir", p_motoboy_id: uuid(body.motoboy_id, true), p_motivo: null,
    })) });
  }
  if (action === "listar_para_atribuicao") {
    const result = await rpc("catalogo_listar_entregas_restritas", { p_operador_id: userId, p_comercio_id: comercioId, p_offset: offset(body.offset) });
    // A gestão de atribuições não precisa de contato pessoal. Evita atalhos ao aceite financeiro.
    const pedidos = Array.isArray(result.pedidos) ? result.pedidos.map((value) => {
      const visible = { ...record(value) };
      for (const field of Object.keys(visible)) if (field.startsWith("cliente_") && field !== "cliente_bairro") delete visible[field];
      delete visible.observacoes;
      return visible;
    }) : [];
    return json({ success: true, ...result, pedidos });
  }
  const result = await rpc("catalogo_gerir_motoboys", {
    p_operador_id: userId, p_acao: action, p_comercio_id: comercioId, p_pedido_id: null,
    p_motoboy_id: action === "suspender_motoboy" ? uuid(body.motoboy_id) : null,
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
    return json({ success: false, mensagem: "Não foi possível processar a operação de entrega." }, 500);
  }
});
