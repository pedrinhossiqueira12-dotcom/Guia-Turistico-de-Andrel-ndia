// COB-06 / PR #39: rota administrativa STAGING para UMA reserva de QA.
// Nenhum POST Asaas, Pix, baixa, estorno ou saque.
// A RPC de STAGING grava apenas tentativa irreversivel e conserva HOLD.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const STAGING_URL = "https://jbttwihctuibchhcyqtl.supabase.co";
const QA_LOTE = "583d761a-ecb9-49be-b484-e43f6183971e";
const ACAO = "reservar_tentativa_qa_sem_pix_admin";
const URL_SUPABASE = Deno.env.get("SUPABASE_URL") || "";
const ADMIN_STAGING = Deno.env.get("ASAAS_COB06_STAGING_ADMIN_UID") || "";
const SANDBOX = Deno.env.get("ASAAS_ENVIRONMENT") === "sandbox";
const RESERVA_ATIVA = Deno.env.get("ASAAS_COB06_GATE_RESERVA_QA_ENABLED") === "true";

let chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
try {
  const bundle = Deno.env.get("SUPABASE_SECRET_KEYS") || "";
  const chaves = bundle ? JSON.parse(bundle) : null;
  chaveServico = chaves?.default || chaves?.service_role || chaveServico;
} catch { /* Sem revelar credenciais. */ }

const db = createClient(URL_SUPABASE, chaveServico || "indisponivel", {
  auth: { persistSession: false, autoRefreshToken: false },
});
const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
class Hold extends Error {
  constructor(message: string, readonly status = 503) { super(message); }
}
function responder(dados: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(dados), { status, headers: HEADERS });
}
function hold(message: string, status = 503): never { throw new Hold(message, status); }
function flagsHold() {
  return { pode_emitir_pix: false, pode_quitar: false,
    pode_estornar: false, pode_liberar_motoboy: false, hold_obrigatorio: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: HEADERS });
  try {
    // O gateway seleciona esta funcao pelo slug; o pathname entregue pelo
    // runtime pode vir reescrito. Nao usar a URL interna como autenticacao.
    // Metodo, flag STAGING, JWT administrativo, acao e lote seguem obrigatorios.
    if (req.method !== "POST") return responder({ success: false, ...flagsHold() }, 405);

    if (!RESERVA_ATIVA || !SANDBOX || URL_SUPABASE !== STAGING_URL ||
        !chaveServico || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(ADMIN_STAGING)) {
      return hold("Reserva QA desativada. HOLD.");
    }
    const match = /^Bearer\s+([^\s]+)$/i.exec(req.headers.get("authorization") || "");
    if (!match || match[1].length > 8192) return hold("Sessao necessaria.", 401);
    const { data: identidade, error: erroAuth } = await db.auth.getUser(match[1]);
    if (erroAuth || !identidade.user) return hold("Sessao invalida.", 401);
    if (identidade.user.id !== ADMIN_STAGING) return hold("Acesso restrito.", 403);

    const tamanho = Number(req.headers.get("content-length") || "0");
    if (!Number.isFinite(tamanho) || tamanho > 2048) return hold("Payload grande.", 413);
    const raw = await req.text();
    if (raw.length > 2048) return hold("Payload grande.", 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return hold("JSON invalido.", 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return hold("Payload invalido.", 400);
    const entrada = body as Record<string, unknown>;
    if (Object.keys(entrada).sort().join(",") !== "acao,lote_id" ||
        entrada.acao !== ACAO || entrada.lote_id !== QA_LOTE) {
      return hold("Operacao fora do ensaio. HOLD.", 403);
    }

    // Exatamente uma RPC; identidade, locks e unicidade rechecados no banco.
    const { data, error } = await db.rpc("catalogo_asaas_reservar_tentativa_qa_sem_pix", {
      p_lote: QA_LOTE,
    });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) {
      return hold("Reserva SQL indisponivel. HOLD.");
    }
    if (data.ok === false && data.motivo === "tentativa_ja_reservada" &&
        data.ja_reservado === true) {
      return responder({ success: false, estado: "tentativa_ja_reservada",
        nova_tentativa: false, reconciliar_manualmente: true, ...flagsHold() }, 409);
    }
    if (data.ok !== true || data.nova_tentativa !== true ||
        data.ja_reservado !== false || data.lote_id !== QA_LOTE ||
        data.reconciliar_manualmente !== true ||
        data.prova_get_externa !== false || data.autorizacao_externa !== false ||
        data.post_executado !== false || data.pode_emitir_pix !== false ||
        data.pode_quitar !== false || data.pode_liberar_motoboy !== false) {
      return hold("Resposta SQL inesperada. HOLD.");
    }
    return responder({ success: true, estado: "tentativa_reservada_sem_pix",
      lote_id: QA_LOTE, nova_tentativa: true, post_executado: false,
      reconciliar_manualmente: true, ...flagsHold() });
  } catch (e) {
    if (e instanceof Hold) return responder({ success: false, mensagem: e.message,
      nova_tentativa: false, ...flagsHold() }, e.status);
    return responder({ success: false, mensagem: "Reserva indisponivel. HOLD.",
      nova_tentativa: false, ...flagsHold() }, 503);
  }
});
