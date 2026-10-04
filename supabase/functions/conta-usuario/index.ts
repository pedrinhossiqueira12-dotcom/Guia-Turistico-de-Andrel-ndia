import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const AVATAR_BUCKET = "perfil-fotos";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

async function listAllAvatarPaths(userId: string) {
  const paths: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await admin.storage.from(AVATAR_BUCKET).list(userId, { limit: 100, offset });
    if (error) throw new Error(`Não foi possível listar as fotos de perfil: ${error.message}`);
    for (const object of data ?? []) {
      if (object?.name) paths.push(`${userId}/${object.name}`);
    }
    if (!data || data.length < 100) break;
  }
  return paths;
}

async function excluirConta(userId: string) {
  const paths = await listAllAvatarPaths(userId);
  if (paths.length) {
    const { error } = await admin.storage.from(AVATAR_BUCKET).remove(paths);
    if (error) throw new Error(`Não foi possível remover as fotos de perfil: ${error.message}`);
  }

  // Mantém o histórico administrativo, mas retira o perfil do mural público e suas imagens.
  const { error: muralError } = await admin.from("mural_cadastros")
    .update({ status: "deletado", imagem: "", imagens: [], atualizado_em: new Date().toISOString() })
    .eq("usuario_id", userId);
  if (muralError) throw new Error(`Não foi possível arquivar o perfil público: ${muralError.message}`);

  const { error: authError } = await admin.auth.admin.deleteUser(userId);
  if (authError) throw new Error(`Não foi possível apagar a conta: ${authError.message}`);
  return { sucesso: true };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ sucesso: false, erro: "Método não permitido." }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ sucesso: false, erro: "Configuração segura ausente no servidor." }, 500);

  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json({ sucesso: false, erro: "Sessão ausente." }, 401);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return json({ sucesso: false, erro: "Sessão inválida." }, 401);

  let payload: Record<string, unknown> = {};
  try { payload = await request.json(); } catch { return json({ sucesso: false, erro: "JSON inválido." }, 400); }
  if (payload.acao !== "excluir_conta") return json({ sucesso: false, erro: "Ação não permitida." }, 400);

  try {
    return json(await excluirConta(data.user.id));
  } catch (cause) {
    console.error("account deletion failed", cause);
    return json({ sucesso: false, erro: cause instanceof Error ? cause.message : "Não foi possível apagar a conta." }, 500);
  }
});
