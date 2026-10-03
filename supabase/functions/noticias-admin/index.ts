import { createClient } from "npm:@supabase/supabase-js@2";
import { validateEditorialPayload } from "./editorial-validation.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SECRET_BUNDLE = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ADMIN_USER_ID = "4b9a0233-6b72-4573-aebd-d596c5b15e1b";
const MAX_HERO_ITEMS = 6;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

let serviceKey = "";
try {
  const parsed = SECRET_BUNDLE ? JSON.parse(SECRET_BUNDLE) : null;
  serviceKey = parsed?.default || parsed?.service_role || "";
} catch {
  console.error("Unable to parse Supabase service key bundle.");
}
if (!serviceKey) serviceKey = SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !serviceKey) throw new Error("Required server configuration is missing.");

const admin = createClient(SUPABASE_URL, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type JsonRecord = Record<string, unknown>;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

async function verifyAdmin(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user || data.user.id !== ADMIN_USER_ID) return null;
  return data.user;
}

async function triggerPagesBuild(): Promise<boolean> {
  const raw = Deno.env.get("CLOUDFLARE_PAGES_DEPLOY_HOOK") ?? "";
  if (!raw) return false;
  try {
    const url = new URL(raw);
    const hookPrefix = "/client/v4/pages/webhooks/deploy_hooks/";
    if (
      url.protocol !== "https:" || url.hostname !== "api.cloudflare.com" || url.port || url.username || url.password ||
      url.search || url.hash || !url.pathname.startsWith(hookPrefix) || url.pathname.slice(hookPrefix.length).includes("/") ||
      !url.pathname.slice(hookPrefix.length)
    ) {
      return false;
    }
    const response = await fetch(url, { method: "POST" });
    return response.ok;
  } catch {
    return false;
  }
}

async function listar() {
  const pageSize = 500;
  const all = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin.from("conteudos_editoriais")
      .select("id,slug,tipo,titulo,resumo,corpo,local_evento,inicio_evento,fim_evento,imagem_capa,galeria,texto_cta,url_cta,destaque_hero,ordem_hero,status,publicado_em,criado_em,atualizado_em,deletado_em")
      .order("atualizado_em", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`Falha ao listar conteúdo editorial: ${error.message}`);
    all.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
    if (all.length >= 10000) throw new Error("Limite administrativo de 10.000 publicações atingido; paginação de interface necessária.");
  }
  return all;
}

async function salvar(body: JsonRecord, userId: string) {
  const parsed = validateEditorialPayload(body);
  if (parsed.error || !parsed.value) return json({ success: false, mensagem: parsed.error || "Conteúdo inválido." }, 400);
  const value = parsed.value;
  const id = value.id;
  let previous: { id: string; status: string; publicado_em: string | null } | null = null;

  if (id) {
    const { data, error } = await admin.from("conteudos_editoriais")
      .select("id,status,publicado_em")
      .eq("id", id)
      .is("deletado_em", null)
      .maybeSingle();
    if (error) throw new Error(`Falha ao localizar conteúdo: ${error.message}`);
    if (!data) return json({ success: false, mensagem: "Conteúdo não encontrado ou já excluído." }, 404);
    previous = data;
  }

  if (value.destaque_hero && value.status === "publicado") {
    let query = admin.from("conteudos_editoriais")
      .select("id", { count: "exact", head: true })
      .eq("destaque_hero", true)
      .eq("status", "publicado")
      .is("deletado_em", null);
    if (id) query = query.neq("id", id);
    const { count, error } = await query;
    if (error) throw new Error(`Falha ao conferir destaques: ${error.message}`);
    if ((count ?? 0) >= MAX_HERO_ITEMS) return json({ success: false, mensagem: `O Hero aceita até ${MAX_HERO_ITEMS} destaques ativos.` }, 409);
  }

  const now = new Date().toISOString();
  const record = {
    ...value,
    publicado_em: value.status === "publicado" ? previous?.publicado_em || now : previous?.publicado_em || null,
    ...(!id ? { criado_por: userId } : {}),
    atualizado_por: userId,
    atualizado_em: now,
    deletado_em: null,
  };
  const result = id
    ? await admin.from("conteudos_editoriais").update(record).eq("id", id).select("*").single()
    : await admin.from("conteudos_editoriais").insert(record).select("*").single();
  if (result.error) {
    if (result.error.code === "23505") return json({ success: false, mensagem: "Já existe uma publicação com esse endereço (slug)." }, 409);
    throw new Error(`Falha ao salvar conteúdo: ${result.error.message}`);
  }
  const publicAffected = value.status === "publicado" || previous?.status === "publicado";
  const buildTriggered = publicAffected ? await triggerPagesBuild() : false;
  return json({ success: true, item: result.data, publicAffected, buildTriggered });
}

async function mudarEstado(body: JsonRecord, userId: string, status: "arquivado" | "deletado") {
  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ success: false, mensagem: "Identificador inválido." }, 400);
  const now = new Date().toISOString();
  const { data: previous, error: previousError } = await admin.from("conteudos_editoriais")
    .select("id,status")
    .eq("id", id)
    .is("deletado_em", null)
    .maybeSingle();
  if (previousError) throw new Error(`Falha ao localizar conteúdo: ${previousError.message}`);
  if (!previous) return json({ success: false, mensagem: "Conteúdo não encontrado." }, 404);
  const { data, error } = await admin.from("conteudos_editoriais")
    .update({
      status,
      destaque_hero: false,
      deletado_em: status === "deletado" ? now : null,
      atualizado_por: userId,
      atualizado_em: now,
    })
    .eq("id", id)
    .is("deletado_em", null)
    .select("id,slug,status,deletado_em")
    .maybeSingle();
  if (error) throw new Error(`Falha ao atualizar publicação: ${error.message}`);
  if (!data) return json({ success: false, mensagem: "Conteúdo não encontrado." }, 404);
  const publicAffected = previous.status === "publicado";
  const buildTriggered = publicAffected ? await triggerPagesBuild() : false;
  return json({ success: true, item: data, publicAffected, buildTriggered });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ success: false, mensagem: "Use POST." }, 405);

  const user = await verifyAdmin(request);
  if (!user) return json({ success: false, mensagem: "Acesso restrito ao administrador." }, 403);

  try {
    const body = await request.json().catch(() => ({})) as JsonRecord;
    const action = String(body.acao ?? "");
    if (action === "listar") return json({ success: true, itens: await listar() });
    if (action === "salvar") return await salvar(body, user.id);
    if (action === "arquivar") return await mudarEstado(body, user.id, "arquivado");
    if (action === "excluir") return await mudarEstado(body, user.id, "deletado");
    return json({ success: false, mensagem: "Ação editorial não reconhecida." }, 400);
  } catch (error) {
    console.error("noticias-admin failed:", (error as Error).message);
    return json({ success: false, mensagem: "Não foi possível concluir a operação. Tente novamente mais tarde." }, 500);
  }
});
