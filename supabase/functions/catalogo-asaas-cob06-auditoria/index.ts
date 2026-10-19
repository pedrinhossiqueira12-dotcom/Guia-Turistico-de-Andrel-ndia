// COB-06 / PR #39: funcao ISOLADA de auditoria Sandbox do acumulo.
// Nenhum caminho POST para /payments ou /transfers, nem RPC de baixa/estorno/saque.
// Desligada por padrao e sem alterar a Edge financeira existente.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import {
  auditarDuplicidadeAcumuloSomenteGet,
} from "../_shared/catalogo-asaas-acumulo-auditoria-duplicidade-inerte.ts";

// Ensaio remoto limitado ao unico lote sintetico COB-06 previamente preparado.
// Retirar estes limites somente em uma etapa de rollout revisada, nunca via body.
const STAGING_URL = "https://jbttwihctuibchhcyqtl.supabase.co";
const QA_LOTE = "583d761a-ecb9-49be-b484-e43f6183971e";
const QA_COMERCIO = "asaas-cob02";
const QA_CORTE = "2027-03-01";
const QA_TOTAL_CENTAVOS = 560;
const URL_SUPABASE = Deno.env.get("SUPABASE_URL") || "";
const CHAVES_BUNDLE = Deno.env.get("SUPABASE_SECRET_KEYS") || "";
let CHAVE_SERVICO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
try {
  const obj = CHAVES_BUNDLE ? JSON.parse(CHAVES_BUNDLE) : null;
  CHAVE_SERVICO = obj?.default || obj?.service_role || CHAVE_SERVICO;
} catch { /* sem expor valores em erros */ }
const db = createClient(URL_SUPABASE, CHAVE_SERVICO, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const ASAAS_TOKEN = Deno.env.get("ASAAS_API_KEY") || "";
const ADMIN_STAGING = Deno.env.get("ASAAS_COB06_STAGING_ADMIN_UID") || "";
const SANDBOX = Deno.env.get("ASAAS_ENVIRONMENT") === "sandbox";
const ATIVO = Deno.env.get("ASAAS_COB06_AUDITORIA_ISOLADA_ENABLED") === "true";
const GET_ATIVO = Deno.env.get("ASAAS_COB06_GET_ADMIN_READONLY_ENABLED") === "true";
// Flag NOVA, OFF por padrao. Ainda exige permissao explicita de instalacao
// SQL, deploy e teste no STAGING. Nenhuma Edge publicada usa esta versao.
const PERSISTIR_GET_QA = Deno.env.get("ASAAS_COB06_GET_PERSISTENCIA_QA_ENABLED") === "true";
const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
class Hold extends Error {
  constructor(message: string, readonly code = 503) { super(message); }
}
function resposta(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}
function recusar(message: string, status = 503): never {
  throw new Hold(message, status);
}
function texto(v: unknown): string {
  return typeof v === "string" ? v : "";
}
async function rpc(name: string, params: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, params);
  if (error || data === null || typeof data !== "object" || Array.isArray(data)) {
    return recusar("Conferencia SQL indisponivel. HOLD.");
  }
  return data as Record<string, unknown>;
}
async function exigirAdmin(req: Request) {
  // Nao reutilizar o UID da producao. A identidade STAGING deve ser configurada
  // e auditada em etapa separada; ate la esta rota permanece inacessivel.
  if (!ADMIN_STAGING || !/^[0-9a-f-]{36}$/i.test(ADMIN_STAGING)) {
    return recusar("Administrador STAGING nao configurado. HOLD.", 503);
  }
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") || "");
  if (!match || match[1].length > 8192) return recusar("Sessao necessaria.", 401);
  const { data, error } = await db.auth.getUser(match[1]);
  if (error || !data?.user) return recusar("Sessao invalida.", 401);
  if (data.user.id !== ADMIN_STAGING) return recusar("Acesso restrito.", 403);
}
async function conferirLoteNoBanco(lote: string) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(lote)) {
    return recusar("Lote invalido.", 400);
  }
  if (lote !== QA_LOTE) return recusar("Lote fora do ensaio COB-06. HOLD.", 403);
  const [l, r] = await Promise.all([
    db.from("catalogo_asaas_acumulo_lotes")
      .select("id,comercio_id,competencia_corte,total_centavos,estado")
      .eq("id", lote).maybeSingle(),
    db.from("catalogo_asaas_acumulo_referencias")
      .select("lote_id,operacao_id,comercio_id,referencia,valor_centavos,estado,payment_id,pode_emitir_pix")
      .eq("lote_id", lote).maybeSingle(),
  ]);
  if (l.error || r.error || !l.data || !r.data)
    return recusar("Lote ou referencia ausente. HOLD.");
  const loteQa = l.data;
  if (loteQa.id !== QA_LOTE || loteQa.comercio_id !== QA_COMERCIO ||
      loteQa.competencia_corte !== QA_CORTE ||
      Number(loteQa.total_centavos) !== QA_TOTAL_CENTAVOS ||
      loteQa.estado !== "preparado") {
    return recusar("Lote QA divergente. HOLD.", 409);
  }
  const ref = r.data;
  const cents = Number(ref.valor_centavos);
  if (ref.lote_id !== lote || ref.comercio_id !== QA_COMERCIO ||
      ref.referencia !== "guia-acumulo-" + lote ||
      ref.estado !== "reservado" || ref.payment_id !== null ||
      ref.pode_emitir_pix !== false ||
      !Number.isSafeInteger(cents) || cents !== QA_TOTAL_CENTAVOS) {
    return recusar("Referencia inconsistente. HOLD.", 409);
  }
  const cliente = await db.from("catalogo_asaas_clientes")
    .select("cliente_id").eq("comercio_id", ref.comercio_id).maybeSingle();
  if (cliente.error || !cliente.data) return recusar("Cliente ausente. HOLD.", 409);
  const origem = await rpc("catalogo_asaas_conferir_conciliacao_acumulo", { p_lote: lote });
  if (origem.integridade_contabil_ok !== true ||
      Number(origem.valor_fontes_centavos) !== cents ||
      origem.pode_emitir_pix !== false ||
      origem.pode_quitar !== false ||
      origem.pode_liberar_motoboy !== false) {
    return recusar("Fontes nao conferidas. HOLD.", 409);
  }
  // Um GET ao banco remoto so e permitido quando ha UMA tentativa QA
  // imutavel previamente reservada e ligada a este mesmo lote/cliente/valor.
  // RPC de SOMENTE LEITURA, com EXECUTE apenas para service_role. A ausencia
  // da RPC no STAGING publicado ate sua aprovacao deve resultar em HOLD.
  const vinculo = await rpc("catalogo_asaas_conferir_vinculo_tentativa_qa_sem_pix",
    { p_lote: lote });
  if (vinculo.ok !== true || vinculo.lote_id !== lote ||
      vinculo.operacao_id !== ref.operacao_id ||
      vinculo.comercio_id !== QA_COMERCIO ||
      vinculo.referencia !== ref.referencia ||
      vinculo.cliente_id !== cliente.data.cliente_id ||
      Number(vinculo.valor_centavos) !== cents ||
      typeof vinculo.reservada_em !== "string" || !vinculo.reservada_em ||
      vinculo.post_executado !== false ||
      vinculo.pode_emitir_pix !== false ||
      vinculo.pode_quitar !== false ||
      vinculo.pode_liberar_motoboy !== false ||
      vinculo.hold_obrigatorio !== true) {
    return recusar("Tentativa QA nao vinculada ao lote. HOLD.", 409);
  }
  return {
    loteId: lote, operacaoId: ref.operacao_id as string,
    referencia: ref.referencia,
    clienteId: cliente.data.cliente_id as string, valorCentavos: cents,
  };
}

async function auditarDuplicidadeComTrilhaQA(lote: string) {
  // A identidade financeira vem SOMENTE do banco, nao do corpo do request.
  const esperado = await conferirLoteNoBanco(lote);
  // Transacao atomica ANTES de qualquer GET externo. A marca e definitiva
  // mesmo em timeout, resposta ambigua ou falha na persistencia posterior.
  // Uma segunda instancia/solicitacao nao recebe nova permissao de consulta.
  const inicio = await rpc("catalogo_asaas_iniciar_get_unico_qa_sem_pix",
    { p_lote: lote });
  if (inicio.ok !== true || inicio.lote_id !== lote ||
      inicio.operacao_id !== esperado.operacaoId ||
      inicio.referencia !== esperado.referencia ||
      inicio.nova_consulta !== true ||
      inicio.pode_consultar_asaas !== true ||
      inicio.pode_repetir_get !== false ||
      inicio.pode_emitir_pix !== false || inicio.pode_quitar !== false ||
      inicio.pode_estornar !== false ||
      inicio.pode_liberar_motoboy !== false ||
      inicio.hold_obrigatorio !== true) {
    return recusar("GET ja iniciado ou marcacao nao confirmada. HOLD.", 409);
  }
  const auditoria = await auditarDuplicidadeAcumuloSomenteGet(
    esperado, ASAAS_TOKEN,
  );
  let evidenciaPersistida = false;
  let evidenciaNova = false;
  // So persiste metadados de UM GET negativo conclusivo. O digest e
  // calculado a partir dos mesmos bytes limitados da resposta autenticada,
  // sem segunda chamada ao Asaas e sem aceitar campos do navegador.
  // Uma resposta positiva, ambigua, parcial ou indisponivel nao e gravada.
  if (PERSISTIR_GET_QA && auditoria.estado === "nenhuma_cobranca_localizada") {
    const prova = auditoria.evidenciaGetNegativa;
    if (!prova || prova.httpStatus !== 200 || prova.totalCount !== 0 ||
        prova.itensCount !== 0 || prova.hasMore !== false ||
        !/^[0-9a-f]{64}$/.test(prova.respostaSha256)) {
      return recusar("Metadados GET inconclusivos. HOLD.");
    }
    const ack = await rpc("catalogo_asaas_registrar_get_negativo_qa_sem_pix", {
      p_lote: lote,
      p_http_status: prova.httpStatus,
      p_total_count: prova.totalCount,
      p_itens_count: prova.itensCount,
      p_has_more: prova.hasMore,
      p_resposta_sha256: prova.respostaSha256,
    });
    // SQL so registra a trilha local; nunca constitui gate para POST.
    if (ack.ok !== true || ack.lote_id !== lote ||
        ack.evidencia_get_persistida !== true ||
        (ack.nova_evidencia !== true && ack.nova_evidencia !== false) ||
        ack.prova_get_externa !== false || ack.pode_emitir_pix !== false ||
        ack.pode_quitar !== false || ack.pode_estornar !== false ||
        ack.pode_liberar_motoboy !== false || ack.hold_obrigatorio !== true) {
      return recusar("Persistencia de auditoria nao confirmada. HOLD.");
    }
    evidenciaPersistida = true;
    evidenciaNova = ack.nova_evidencia === true;
  }
  return resposta({
    success: true, lote_id: lote, estado: auditoria.estado,
    payment_id: auditoria.paymentId,
    status_bancario: auditoria.statusBancario,
    reserva_qa_conferida: true,
    evidencia_get_persistida: evidenciaPersistida,
    banco_alterado: evidenciaNova, pix_emitido: false,
    pode_emitir_pix: false, pode_quitar: false, pode_estornar: false,
    pode_liberar_motoboy: false, hold_obrigatorio: true,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: HEADERS });
  try {
    const path = new URL(req.url).pathname.replace(/\/$/, "");
    if (!path.endsWith("/catalogo-asaas-cob06-auditoria")) {
      return resposta({ success: false, hold_obrigatorio: true }, 404);
    }
    // GET publico nao consulta tokens, banco ou informacoes financeiras.
    if (req.method === "GET") {
      return resposta({
        success: true, modo: "STAGING_HOLD", banco_consultado: false,
        pode_emitir_pix: false, pode_quitar: false, pode_estornar: false,
        pode_liberar_motoboy: false, hold_obrigatorio: true,
      });
    }
    if (req.method !== "POST") return resposta({ success: false }, 405);
    const length = Number(req.headers.get("content-length") || "0");
    if (!Number.isFinite(length) || length > 8192) return recusar("Payload grande.", 413);
    const raw = await req.text();
    if (raw.length > 8192) return recusar("Payload grande.", 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return recusar("JSON invalido.", 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return recusar("Payload invalido.", 400);
    }
    const entrada = body as Record<string, unknown>;
    const somenteLeitura = entrada.acao ===
      "auditar_duplicidade_acumulo_sandbox_admin";
    if (!somenteLeitura) {
      return recusar("Acao financeira indisponivel nesta funcao.", 403);
    }
    // GET bancario exige TAMBEM marcacao SQL previa permanente (sem retry).
    // Nao existe caminho GET quando a persistencia estiver OFF.
    if (URL_SUPABASE !== STAGING_URL || !ATIVO || !GET_ATIVO ||
        !PERSISTIR_GET_QA || !SANDBOX || !ASAAS_TOKEN) {
      return recusar("Auditoria inativa. HOLD.");
    }
    await exigirAdmin(req);
    return await auditarDuplicidadeComTrilhaQA(texto(entrada.lote_id));
  } catch (e) {
    if (e instanceof Hold) return resposta({
      success: false, mensagem: e.message,
      pode_emitir_pix: false, pode_quitar: false,
      pode_estornar: false, pode_liberar_motoboy: false,
      hold_obrigatorio: true,
    }, e.code);
    // Nao registrar credenciais, corpos da API ou dados de clientes.
    return resposta({
      success: false, mensagem: "Auditoria indisponivel. HOLD.",
      pode_emitir_pix: false, pode_quitar: false,
      pode_estornar: false, pode_liberar_motoboy: false,
      hold_obrigatorio: true,
    }, 503);
  }
});
