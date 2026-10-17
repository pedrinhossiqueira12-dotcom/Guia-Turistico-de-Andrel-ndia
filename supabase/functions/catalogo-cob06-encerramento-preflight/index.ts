// COB-06: preflight HTTP read-only. STAGING only; no Asaas, WhatsApp or GitHub.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const STAGING = "https://jbttwihctuibchhcyqtl.supabase.co";
const ADMIN_UID = "d896cc0c-31e4-4ef7-8fa4-13d15f02dd2a";
const ADMIN_EMAIL = "pedrinhossiqueira12@gmail.com";
const QA_LOTE = "583d761a-ecb9-49be-b484-e43f6183971e";
const QA_COMERCIO = "asaas-cob02";
const SENTINELA = "__cob06_http_preflight_sem_cadastro_20261017__";
const apiUrl = Deno.env.get("SUPABASE_URL") || "";
const keysRaw = Deno.env.get("SUPABASE_SECRET_KEYS") || "";
let serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
try {
  const keys = keysRaw ? JSON.parse(keysRaw) : null;
  serviceKey = keys?.default || keys?.service_role || serviceKey;
} catch { /* no credential detail in response */ }

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (payload, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: HEADERS });
const refuse = (status, message) => reply({ success: false, mensagem: message }, status);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
  if (request.method !== "POST") return refuse(405, "Apenas POST.");
  if (!new URL(request.url).pathname.endsWith("/catalogo-cob06-encerramento-preflight"))
    return refuse(404, "Rota nao encontrada.");
  if (apiUrl !== STAGING || !serviceKey)
    return refuse(503, "Homologacao indisponivel.");

  const jwt = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get("authorization") || "")?.[1];
  if (!jwt || jwt.length > 8192) return refuse(401, "Sessao necessaria.");

  try {
    const db = createClient(STAGING, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await db.auth.getUser(jwt);
    if (authError || !auth?.user) return refuse(401, "Sessao invalida.");
    if (auth.user.id !== ADMIN_UID || auth.user.email?.toLowerCase() !== ADMIN_EMAIL)
      return refuse(403, "Acesso restrito ao administrador STAGING.");

    const raw = await request.text();
    if (raw.length > 1024) return refuse(413, "Solicitacao muito grande.");
    let body;
    try { body = JSON.parse(raw); }
    catch { return refuse(400, "JSON invalido."); }
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        body.acao !== "verificar_encerramento_http_qa" ||
        Object.keys(body).length !== 1)
      return refuse(403, "Acao de homologacao nao autorizada.");

    // Exclusivamente SELECT: nao chamar RPC administrativa mutante nem sincronizar GitHub.
    const [loteR, publicacaoR, catalogoR, encerramentoR] = await Promise.all([
      db.from("catalogo_asaas_acumulo_lotes")
        .select("id,comercio_id,competencia_corte,total_centavos,estado")
        .eq("id", QA_LOTE).maybeSingle(),
      db.from("comercios_publicados").select("local_id")
        .eq("local_id", SENTINELA).maybeSingle(),
      db.from("catalogos").select("comercio_id")
        .eq("comercio_id", SENTINELA).maybeSingle(),
      db.from("catalogo_encerramentos_comercio").select("comercio_id")
        .eq("comercio_id", SENTINELA).maybeSingle(),
    ]);
    if (loteR.error || publicacaoR.error || catalogoR.error || encerramentoR.error)
      return refuse(503, "Leitura de QA indisponivel. Nenhuma escrita realizada.");
    const lote = loteR.data;
    if (!lote || lote.id !== QA_LOTE || lote.comercio_id !== QA_COMERCIO ||
        lote.competencia_corte !== "2027-03-01" ||
        lote.total_centavos !== 560 || lote.estado !== "preparado" ||
        publicacaoR.data || catalogoR.data || encerramentoR.data)
      return refuse(409, "Estado de QA divergente. HOLD; nenhuma escrita realizada.");

    return reply({
      success: true,
      etapa: "preflight_encerramento_http_qa",
      ambiente: "staging",
      administrador_validado: true,
      lote_id: QA_LOTE,
      estado_lote: "preparado",
      valor_centavos: 560,
      alvo_ficticio_inexistente: true,
      operacao: "somente_leitura",
      github_alterado: false,
      whatsapp_acionado: false,
      pix_emitido: false,
      encerramento_executado: false,
      hold_obrigatorio: true,
    });
  } catch (error) {
    console.error("COB06 preflight HTTP", { type: error?.name || "Error" });
    return refuse(503, "Verificacao QA indisponivel; nenhuma operacao financeira executada.");
  }
});
