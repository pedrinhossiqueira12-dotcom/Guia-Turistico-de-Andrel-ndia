// COB-06: integracao HTTP exclusiva de STAGING, desativada por padrao.
// Nunca usar como substituto do whatsapp-bot ou como endpoint de producao.
// O unico alvo de escrita e uma publicacao ficticia sem catalogo financeiro.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const STAGING = "https://jbttwihctuibchhcyqtl.supabase.co";
const ADMIN_UID = "d896cc0c-31e4-4ef7-8fa4-13d15f02dd2a";
const ADMIN_EMAIL = "pedrinhossiqueira12@gmail.com";
const BRANCH = "qa/cob06-isolado";
const QA_ID = "cob06-qa-integracao-ficticia-20261017";
const QA_NAME = "COB06 QA FICTICIO - NAO PUBLICAR";
const REPO = "pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia";
const FILE = "DATA/comercios.json";
const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: HEADERS });
const fail = (status: number, message: string) =>
  reply({ success: false, mensagem: message }, status);

function serviceRole(): string {
  let key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  try {
    const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
    const keys = raw ? JSON.parse(raw) : null;
    key = keys?.default || keys?.service_role || key;
  } catch { /* sem expor credencial */ }
  return key;
}

function decodeBase64(value: string): string {
  const raw = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let result = "";
  for (let i = 0; i < bytes.length; i += 32768) {
    result += String.fromCharCode(...bytes.subarray(i, i + 32768));
  }
  return btoa(result);
}

type RepoState = { sha: string; itens: Record<string, unknown>[]; indice: number };
async function readRepo(token: string): Promise<RepoState> {
  const url = "https://api.github.com/repos/" + REPO + "/contents/" + FILE
    + "?ref=" + encodeURIComponent(BRANCH);
  const resp = await fetch(url, {
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "COB06-Staging-QA",
    },
  });
  if (!resp.ok) throw new Error("github_get");
  const data = await resp.json();
  if (typeof data.sha !== "string" || !/^[a-f0-9]{40}$/.test(data.sha)
      || typeof data.content !== "string" || data.content.length > 2500000) {
    throw new Error("github_format");
  }
  const itens = JSON.parse(decodeBase64(data.content));
  if (!Array.isArray(itens) || itens.length !== 142) throw new Error("github_fixture");
  const matches = itens.map((x, i) => x?.id === QA_ID ? i : -1).filter((x) => x >= 0);
  if (matches.length !== 1 || itens[matches[0]]?.nome !== QA_NAME)
    throw new Error("github_target");
  return { sha: data.sha, itens, indice: matches[0] };
}
async function writeRepo(token: string, state: RepoState): Promise<boolean> {
  const atual = state.itens[state.indice];
  if (atual.status === "deletado" && atual.destaque === false
      && atual.imagem === "" && Array.isArray(atual.imagens)
      && atual.imagens.length === 0) return false;
  state.itens[state.indice] = {
    ...atual, status: "deletado", destaque: false, imagem: "", imagens: [],
  };
  const body = {
    message: "test(cob06): arquivar somente comercio ficticio de integracao QA",
    branch: BRANCH,
    sha: state.sha,
    content: encodeBase64(JSON.stringify(state.itens, null, 2) + "\n"),
  };
  const resp = await fetch("https://api.github.com/repos/" + REPO + "/contents/" + FILE, {
    method: "PUT",
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "COB06-Staging-QA",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(resp.status === 409 ? "github_conflict" : "github_put");
  return true;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: HEADERS });
  if (req.method !== "POST") return fail(405, "Somente POST.");
  if (!new URL(req.url).pathname.endsWith("/catalogo-cob06-encerramento-integracao-qa"))
    return fail(404, "Rota nao encontrada.");
  if (Deno.env.get("SUPABASE_URL") !== STAGING || !serviceRole())
    return fail(503, "Somente no projeto STAGING.");
  const jwt = /^Bearer\s+([^\s]+)$/i.exec(req.headers.get("authorization") || "")?.[1];
  if (!jwt || jwt.length > 8192) return fail(401, "Sessao necessaria.");

  try {
    const db = createClient(STAGING, serviceRole(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await db.auth.getUser(jwt);
    if (authError || !auth?.user) return fail(401, "Sessao invalida.");
    if (auth.user.id !== ADMIN_UID || auth.user.email?.toLowerCase() !== ADMIN_EMAIL)
      return fail(403, "Apenas administrador STAGING.");

    const raw = await req.text();
    if (raw.length > 1024) return fail(413, "Solicitacao muito grande.");
    let body: unknown;
    try { body = JSON.parse(raw); }
    catch { return fail(400, "JSON invalido."); }
    if (!body || typeof body !== "object" || Array.isArray(body)
        || Object.keys(body).length !== 1) return fail(403, "Acao nao autorizada.");
    const acao = (body as { acao?: string }).acao;
    if (!["verificar_config_qa", "verificar_repositorio_qa", "concluir_encerramento_qa"].includes(acao || ""))
      return fail(403, "Acao nao autorizada.");

    const [pub, catalogo] = await Promise.all([
      db.from("comercios_publicados")
        .select("local_id,status,solicitante_id,dados,destaque,deletado_em,atualizado_em,atualizado_por")
        .eq("local_id", QA_ID).maybeSingle(),
      db.from("catalogos").select("comercio_id")
        .eq("comercio_id", QA_ID).maybeSingle(),
    ]);
    if (pub.error || catalogo.error)
      return fail(503, "Leitura QA indisponivel ou schema incompatível.");
    const fixture = Boolean(pub.data
      && pub.data.solicitante_id === ADMIN_UID
      && pub.data.dados?.nome === QA_NAME
      && !catalogo.data
      && ["ativo", "deletado"].includes(pub.data.status));
    const flag = Deno.env.get("COB06_ENCERRAMENTO_HTTP_QA_ENABLED") === "true";
    const branchOk = Deno.env.get("COB06_GITHUB_BRANCH") === BRANCH;
    const token = Deno.env.get("GITHUB_TOKEN") || "";
    if (acao === "verificar_config_qa") return reply({
      success: true, ambiente: "staging", operacao: "somente_leitura",
      administrador_validado: true, alvo_ficticio_preparado: fixture,
      integracao_habilitada: flag, branch_qa_configurada: branchOk,
      token_github_configurado: Boolean(token), github_alterado: false,
      encerramento_executado: false, pix_emitido: false,
    });
    if (!branchOk || !token) return fail(503, "Credenciais de GitHub QA nao configuradas.");
    if (!fixture) return fail(409, "Alvo ficticio nao preparado. HOLD.");

    let repo: RepoState;
    try { repo = await readRepo(token); }
    catch { return fail(503, "Vitrine QA nao verificavel. Nenhuma RPC executada."); }
    if (acao === "verificar_repositorio_qa") return reply({
      success: true, ambiente: "staging", operacao: "somente_leitura",
      alvo_ficticio_preparado: true, registro_github_qa: true,
      status_github_qa: repo.itens[repo.indice].status,
      integracao_habilitada: flag, github_alterado: false,
      encerramento_executado: false, pix_emitido: false,
    });
    if (!flag) return fail(403, "Integracao QA desabilitada. HOLD.");

    const { data: encerrado, error: rpcError } = await db.rpc(
      "catalogo_arquivar_sem_catalogo_admin", { p_comercio: QA_ID, p_admin: ADMIN_UID },
    );
    if (rpcError || encerrado?.ok !== true || encerrado?.situacao !== "arquivado"
        || encerrado?.sem_catalogo !== true)
      return fail(409, "RPC financeira recusou arquivamento. Nenhum GitHub PUT.");

    const confirmado = await db.from("comercios_publicados")
      .select("status").eq("local_id", QA_ID).maybeSingle();
    if (confirmado.error || confirmado.data?.status !== "deletado")
      return reply({ success: false, arquivado: true, pendente_sincronizacao: true,
        mensagem: "Estado financeiro confirmado; publicacao nao confirmada." }, 503);

    let escreveu = false;
    try { escreveu = await writeRepo(token, repo); }
    catch {
      return reply({ success: false, arquivado: true, pendente_sincronizacao: true,
        mensagem: "Arquivamento confirmado; sincronizacao QA deve ser retomada." }, 503);
    }
    return reply({ success: true, ambiente: "staging", arquivado: true,
      github_qa_sincronizado: true, github_put_realizado: escreveu,
      pix_emitido: false, hold_financeiro_mantido: true });
  } catch (error) {
    console.error("COB06 integracao QA", { tipo: error instanceof Error ? error.name : "Error" });
    return fail(503, "Homologacao indisponivel.");
  }
});
