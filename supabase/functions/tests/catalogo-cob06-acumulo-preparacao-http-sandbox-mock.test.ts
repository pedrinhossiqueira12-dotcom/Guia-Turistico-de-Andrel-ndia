// COB-06: ensaio HTTP da preparacao ON, TODO o Supabase e Auth simulados.
// Sem permissoes de rede no Deno CI e com fetch rejeitando qualquer destino inesperado.
const STAGING = "https://jbttwihctuibchhcyqtl.supabase.co";
const ADMIN = "d896cc0c-31e4-4ef7-8fa4-13d15f02dd2a";
const EMAIL = "pedrinhossiqueira12@gmail.com";
const COMERCIO = "asaas-cob02";
const CORTE = "2027-03-01";
const LOTE = "22222222-3333-4444-8888-aaaaaaaaaaaa";
const REFERENCIA = "guia-acumulo-" + LOTE;
const OPERACAO = "33333333-3333-4333-8333-bbbbbbbbbbbb";
type Handler = (request: Request) => Promise<Response> | Response;
let handler: Handler | null = null;
let identidade = ADMIN;
let email = EMAIL;
let previewValido = true;
let reservaValida = true;
let fonteValida = true;
let referenciaValida = true;
let loteExiste = false;
let chamadasAuth = 0;
let chamadasPreview = 0;
let chamadasReserva = 0;
let chamadasConferencia = 0;
let chamadasReferencia = 0;
let consultasLote = 0;
let chamadasDesconhecidas = 0;
function reset() {
  identidade = ADMIN; email = EMAIL; previewValido = true;
  reservaValida = true; fonteValida = true; referenciaValida = true;
  loteExiste = false;
  chamadasAuth = 0; chamadasPreview = 0; chamadasReserva = 0;
  chamadasConferencia = 0; chamadasReferencia = 0; consultasLote = 0;
  chamadasDesconhecidas = 0;
}
function check(ok: unknown, msg: string): asserts ok {
  if (!ok) throw Error("COB06_PREPARACAO_CI_" + msg);
}
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json" },
  });
}
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input :
    input instanceof URL ? input.href : input.url);
  const method = init?.method || (input instanceof Request ? input.method : "GET");
  if (url.origin !== STAGING) {
    chamadasDesconhecidas++;
    throw Error("REDE_REAL_PROIBIDA_" + url.origin);
  }
  if (url.pathname === "/auth/v1/user") {
    check(method === "GET", "AUTH_NAO_GET");
    chamadasAuth++;
    return json({ id: identidade, email, aud: "authenticated", role: "authenticated",
      app_metadata: {}, user_metadata: {} });
  }
  if (url.pathname === "/rest/v1/catalogo_asaas_acumulo_lotes") {
    check(method === "GET", "LOTE_NAO_GET");
    consultasLote++;
    return json(loteExiste ? {
      id: LOTE, comercio_id: COMERCIO, competencia_corte: CORTE,
      total_centavos: 560, estado: "preparado",
    } : null);
  }
  check(method === "POST", "MUTACAO_INESPERADA");
  const args = JSON.parse(String(init?.body)) as Record<string, unknown>;
  if (url.pathname === "/rest/v1/rpc/catalogo_asaas_previsualizar_acumulo") {
    chamadasPreview++;
    check(args.p_comercio === COMERCIO && args.p_competencia_corte === CORTE,
      "PREFLIGHT_OUTRO_ALVO");
    return json({ ok: true, pronto_para_preparar: previewValido,
      total_centavos: previewValido ? 560 : 280,
      quantidade_faturas: 2, quantidade_abaixo_minimo: 2,
      snapshots_inconsistentes: 0, reserva_criada: false, pix_emitido: false });
  }
  if (url.pathname === "/rest/v1/rpc/catalogo_asaas_reservar_acumulo") {
    chamadasReserva++;
    check(args.p_comercio === COMERCIO && args.p_competencia_corte === CORTE,
      "RESERVA_OUTRO_ALVO");
    loteExiste = true;
    return json({ ok: true, lote_id: LOTE, estado: "preparado",
      total_centavos: reservaValida ? 560 : 570,
      pix_emitido: false, ja_reservado: false });
  }
  if (url.pathname === "/rest/v1/rpc/catalogo_asaas_conferir_conciliacao_acumulo") {
    chamadasConferencia++;
    check(args.p_lote === LOTE, "CONFERENCIA_OUTRO_LOTE");
    return json({ ok: true, integridade_contabil_ok: fonteValida,
      valor_fontes_centavos: fonteValida ? 560 : 400,
      pode_emitir_pix: false, pode_quitar: false,
      pode_liberar_motoboy: false });
  }
  if (url.pathname === "/rest/v1/rpc/catalogo_asaas_reservar_referencia_acumulo") {
    chamadasReferencia++;
    check(args.p_lote === LOTE, "REFERENCIA_OUTRO_LOTE");
    return json({ ok: true, lote_id: LOTE, referencia: REFERENCIA,
      operacao_id: OPERACAO, valor_centavos: 560, estado: "reservado",
      ja_reservada: chamadasReferencia > 1,
      payment_id: referenciaValida ? null : "pay-ficticio-invalido",
      pode_emitir_pix: false });
  }
  chamadasDesconhecidas++;
  throw Error("OPERACAO_FORA_DO_CONTRATO_" + url.pathname);
};

Deno.env.set("SUPABASE_URL", STAGING);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "ci-chave-ficticia-inutil");
Deno.env.set("SUPABASE_SECRET_KEYS", "");
Deno.env.set("ASAAS_ENVIRONMENT", "sandbox");
Deno.env.set("ASAAS_COB06_PREPARACAO_ISOLADA_ENABLED", "true");
Deno.env.set("ASAAS_COB06_PREPARACAO_ADMIN_ENABLED", "true");
Deno.env.set("ASAAS_BILLING_ENABLED", "false");
Deno.env.set("ASAAS_PAYOUTS_ENABLED", "false");
const originalServe = Deno.serve;
try {
  Object.defineProperty(Deno, "serve", {
    configurable: true, writable: true,
    value: (fn: Handler) => {
      handler = fn;
      return { finished: Promise.resolve(), shutdown: () => {} };
    },
  });
  await import("../catalogo-cob06-acumulo-preparacao/index.ts");
} finally {
  Object.defineProperty(Deno, "serve", {
    configurable: true, writable: true, value: originalServe,
  });
}
check(handler, "HANDLER_AUSENTE");
async function call(acao: string, body: Record<string, unknown> = {}) {
  const result = await handler!(new Request(
    STAGING + "/functions/v1/catalogo-cob06-acumulo-preparacao", {
      method: "POST", headers: {
        "content-type": "application/json",
        "authorization": "Bearer jwt-ficticio-sem-validade-real",
      },
      body: JSON.stringify({
        acao, comercio_id: COMERCIO, competencia_corte: CORTE, ...body,
      }),
    }));
  return { status: result.status, data: await result.json() as Record<string, unknown> };
}
function hold(body: Record<string, unknown>) {
  check(body.hold_obrigatorio === true && body.pode_emitir_pix === false &&
    body.pode_quitar === false && body.pode_liberar_motoboy === false,
    "SAIDA_NAO_FICOU_EM_HOLD");
}

Deno.test("COB06 ON ficticio: prepara 2 competencias e referencia inerte sem rede Asaas", async () => {
  reset();
  const r = await call("preparar_acumulo_qa");
  check(r.status === 200 && r.data.success === true &&
    r.data.lote_id === LOTE && r.data.referencia === REFERENCIA &&
    r.data.total_centavos === 560 && r.data.quantidade_faturas === 2,
  "PREPARACAO_NAO_COMPLETA");
  hold(r.data);
  check(chamadasAuth === 1 && chamadasPreview === 1 &&
    chamadasReserva === 1 && chamadasConferencia === 1 &&
    chamadasReferencia === 1 && chamadasDesconhecidas === 0,
  "CALLS_PREPARACAO_INCORRETAS");
});

Deno.test("COB06 ON ficticio: retomada nunca reserva um segundo lote", async () => {
  reset();
  loteExiste = true;
  const r = await call("retomar_acumulo_qa");
  check(r.status === 200 && r.data.success === true &&
    r.data.ja_reservado === true && r.data.referencia === REFERENCIA,
  "RETOMADA_NAO_IDEMPOTENTE");
  hold(r.data);
  check(consultasLote === 1 && chamadasPreview === 0 &&
    chamadasReserva === 0 && chamadasReferencia === 1 &&
    chamadasDesconhecidas === 0, "RETOMADA_GEROU_NOVO_LOTE");
});

Deno.test("COB06 ON ficticio: identidade ou parametros alheios nao tocam livro", async () => {
  reset();
  identidade = "11111111-2222-4333-8444-555555555555";
  const intruso = await call("preparar_acumulo_qa");
  check(intruso.status === 403 && intruso.data.success === false, "INTRUSO_ACEITO");
  hold(intruso.data);
  check(chamadasPreview === 0 && chamadasReserva === 0, "INTRUSO_TOUCOU_LIVRO");
  reset();
  email = "email-diferente@example.invalid";
  const falso = await call("preparar_acumulo_qa");
  check(falso.status === 403, "EMAIL_DIVERGENTE_ACEITO");
  reset();
  const fora = await call("preparar_acumulo_qa", { comercio_id: "comercio-real" });
  check(fora.status === 403, "OUTRA_LOJA_ACEITA");
  const banco = await call("emitir_pix");
  check(banco.status === 403, "ACAO_BANCARIA_ACEITA");
  check(chamadasReserva === 0 && chamadasDesconhecidas === 0,
    "ACAO_RECUSADA_TOUCOU_LIVRO");
});

Deno.test("COB06 ON ficticio: qualquer divergencia conserva HOLD", async () => {
  reset(); previewValido = false;
  const previa = await call("preparar_acumulo_qa");
  check(previa.status === 409 && chamadasReserva === 0, "PREVIEW_DIVERGENTE_ACEITA");
  hold(previa.data);
  reset(); reservaValida = false;
  const reserva = await call("preparar_acumulo_qa");
  check(reserva.status === 409 && chamadasConferencia === 0,
    "RESERVA_DIVERGENTE_ACEITA");
  hold(reserva.data);
  reset(); fonteValida = false;
  const fonte = await call("preparar_acumulo_qa");
  check(fonte.status === 409 && chamadasReferencia === 0,
    "FONTE_DIVERGENTE_ACEITA");
  hold(fonte.data);
  reset(); referenciaValida = false;
  const referencia = await call("preparar_acumulo_qa");
  check(referencia.status === 409, "PAGAMENTO_BANCARIO_ACEITO");
  hold(referencia.data);
  check(chamadasDesconhecidas === 0, "REDE_PROIBIDA_ACIONADA");
});
