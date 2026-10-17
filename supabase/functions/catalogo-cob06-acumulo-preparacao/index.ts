// COB-06 / PR #39 — preparação contábil isolada no Supabase STAGING.
// NÃO importa cliente Asaas. NÃO cria Pix, cobrança, baixa, saque ou transferência.
// A Edge financeira existente permanece sem alterações.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const STAGING_URL = "https://jbttwihctuibchhcyqtl.supabase.co";
const ADMIN_UID = "d896cc0c-31e4-4ef7-8fa4-13d15f02dd2a";
const ADMIN_EMAIL = "pedrinhossiqueira12@gmail.com";
const COMERCIO = "asaas-cob02";
const CORTE = "2027-03-01";
const TOTAL_CENTAVOS = 560;
const QUANTIDADE_FATURAS = 2;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const AMBIENTE_SANDBOX = Deno.env.get("ASAAS_ENVIRONMENT") === "sandbox";
const ISOLADA_ON = Deno.env.get("ASAAS_COB06_PREPARACAO_ISOLADA_ENABLED") === "true";
const PREPARACAO_ON = Deno.env.get("ASAAS_COB06_PREPARACAO_ADMIN_ENABLED") === "true";
const BUNDLE = Deno.env.get("SUPABASE_SECRET_KEYS") || "";
let serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
try {
  const bundle = BUNDLE ? JSON.parse(BUNDLE) : null;
  serviceKey = bundle?.default || bundle?.service_role || serviceKey;
} catch { /* não expor segredos */ }

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
class Hold extends Error {
  constructor(message: string, readonly status = 503) { super(message); }
}
function requireThat(ok: unknown, message: string, status = 409): asserts ok {
  if (!ok) throw new Hold(message, status);
}
function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}
function asObject(value: unknown): Record<string, unknown> {
  requireThat(value && typeof value === "object" && !Array.isArray(value),
    "Resposta contábil inválida. HOLD.", 503);
  return value as Record<string, unknown>;
}
function validUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  if (!path.endsWith("/catalogo-cob06-acumulo-preparacao"))
    return respond({ success: false, hold_obrigatorio: true }, 404);
  if (request.method !== "POST") return respond({ success: false, hold_obrigatorio: true }, 405);
  try {
    // Controles independentes: STAGING, Sandbox e duas flags OFF por padrão.
    requireThat(SUPABASE_URL === STAGING_URL && AMBIENTE_SANDBOX &&
      ISOLADA_ON && PREPARACAO_ON, "Preparação COB-06 desabilitada. HOLD.", 503);
    requireThat(Boolean(serviceKey), "Credencial do backend indisponível. HOLD.", 503);
    const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") || "")?.[1];
    requireThat(token && token.length <= 8192, "Sessão necessária.", 401);
    const db = createClient(SUPABASE_URL, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Não aceitar UID do corpo: o token é validado contra o Auth STAGING.
    const { data: auth, error: authError } = await db.auth.getUser(token);
    requireThat(!authError && auth?.user, "Sessão inválida.", 401);
    requireThat(auth.user.id === ADMIN_UID &&
      auth.user.email?.toLowerCase() === ADMIN_EMAIL,
    "Acesso restrito ao administrador STAGING.", 403);

    const len = Number(request.headers.get("content-length") || "0");
    requireThat(Number.isFinite(len) && len <= 4096, "Solicitação muito grande.", 413);
    const raw = await request.text();
    requireThat(raw.length <= 4096, "Solicitação muito grande.", 413);
    let body: Record<string, unknown>;
    try { body = asObject(JSON.parse(raw)); }
    catch { throw new Hold("JSON inválido.", 400); }
    requireThat(body.comercio_id === COMERCIO && body.competencia_corte === CORTE,
      "Comércio ou competência fora do ensaio autorizado.", 403);
    requireThat(body.acao === "preparar_acumulo_qa" ||
      body.acao === "retomar_acumulo_qa", "Ação não autorizada.", 403);

    async function rpc(name: string, params: Record<string, unknown>) {
      const { data, error } = await db.rpc(name, params);
      requireThat(!error, "RPC contábil indisponível. HOLD.", 503);
      const result = asObject(data);
      requireThat(result.ok === true, "Proteção contábil recusou a operação. HOLD.", 409);
      return result;
    }
    let loteId: string;
    let jaReservado = false;
    if (body.acao === "preparar_acumulo_qa") {
      const preview = await rpc("catalogo_asaas_previsualizar_acumulo", {
        p_comercio: COMERCIO, p_competencia_corte: CORTE,
      });
      requireThat(preview.pronto_para_preparar === true &&
        preview.total_centavos === TOTAL_CENTAVOS &&
        preview.quantidade_faturas === QUANTIDADE_FATURAS &&
        preview.quantidade_abaixo_minimo === QUANTIDADE_FATURAS &&
        preview.snapshots_inconsistentes === 0 &&
        preview.reserva_criada === false && preview.pix_emitido === false,
      "Previsualização divergiu das duas faturas fictícias. HOLD.");

      const reservado = await rpc("catalogo_asaas_reservar_acumulo", {
        p_comercio: COMERCIO, p_competencia_corte: CORTE,
      });
      requireThat(validUuid(reservado.lote_id) &&
        reservado.total_centavos === TOTAL_CENTAVOS &&
        reservado.estado === "preparado" && reservado.pix_emitido === false,
      "Reserva contábil divergente. HOLD.");
      loteId = reservado.lote_id as string;
      jaReservado = reservado.ja_reservado === true;
    } else {
      // Retomada explícita após timeout: nunca pré-visualizar nem criar novo lote.
      const { data: lote, error } = await db.from("catalogo_asaas_acumulo_lotes")
        .select("id,comercio_id,competencia_corte,total_centavos,estado")
        .eq("comercio_id", COMERCIO).eq("competencia_corte", CORTE).maybeSingle();
      requireThat(!error && lote && validUuid(lote.id) &&
        lote.comercio_id === COMERCIO && lote.competencia_corte === CORTE &&
        lote.total_centavos === TOTAL_CENTAVOS && lote.estado === "preparado",
      "Lote original não encontrado ou divergente. HOLD.");
      loteId = lote.id;
      jaReservado = true;
    }

    const conferencia = await rpc("catalogo_asaas_conferir_conciliacao_acumulo", {
      p_lote: loteId,
    });
    requireThat(conferencia.integridade_contabil_ok === true &&
      conferencia.valor_fontes_centavos === TOTAL_CENTAVOS &&
      conferencia.pode_emitir_pix === false &&
      conferencia.pode_quitar === false &&
      conferencia.pode_liberar_motoboy === false,
    "Conciliação de fontes divergente. HOLD.");

    // Única escrita subsequente: reserva local de referência imutável.
    // Nunca envia HTTP para o Asaas; nunca gera payment_id.
    const referencia = await rpc("catalogo_asaas_reservar_referencia_acumulo", {
      p_lote: loteId,
    });
    requireThat(referencia.lote_id === loteId &&
      referencia.referencia === "guia-acumulo-" + loteId &&
      referencia.valor_centavos === TOTAL_CENTAVOS &&
      referencia.estado === "reservado" && referencia.payment_id === null &&
      referencia.pode_emitir_pix === false,
    "Referência contábil inerte divergente. HOLD.");

    return respond({
      success: true, lote_id: loteId, comercio_id: COMERCIO,
      competencia_corte: CORTE, total_centavos: TOTAL_CENTAVOS,
      quantidade_faturas: QUANTIDADE_FATURAS, referencia: referencia.referencia,
      ja_reservado: jaReservado, pix_emitido: false, pode_emitir_pix: false,
      pode_quitar: false, pode_liberar_motoboy: false, hold_obrigatorio: true,
    });
  } catch (cause) {
    if (cause instanceof Hold) return respond({
      success: false, mensagem: cause.message, pode_emitir_pix: false,
      pode_quitar: false, pode_liberar_motoboy: false, hold_obrigatorio: true,
    }, cause.status);
    return respond({
      success: false, mensagem: "Preparação inconclusiva. Consultar livro; HOLD.",
      pode_emitir_pix: false, pode_quitar: false,
      pode_liberar_motoboy: false, hold_obrigatorio: true,
    }, 503);
  }
});
