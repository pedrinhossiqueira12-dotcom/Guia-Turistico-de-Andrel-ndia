// Ensaio SEM rede real, JWT verdadeiro, escrita SQL ou credencial Asaas.
// Todo o fetch do Supabase e interceptado antes de carregar a Edge candidata.
const ROOT = "https://jbttwihctuibchhcyqtl.supabase.co";
const LOTE = "583d761a-ecb9-49be-b484-e43f6183971e";
const ADMIN = "4b9a0233-6b72-4573-aebd-d596c5b15e1b";
const INTRUSO = "11111111-2222-4333-8444-555555555555";
const ACAO = "reservar_tentativa_qa_sem_pix_admin";
type Handler = (req: Request) => Response | Promise<Response>;
let handler: Handler | null = null;
let identidade = ADMIN;
let modo: "sucesso" | "duplicada" | "insegura" | "erro" = "sucesso";
let authCalls = 0;
let rpcCalls = 0;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw Error("COB06_GATE_MOCK_" + message);
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}
function reset() { identidade = ADMIN; modo = "sucesso"; authCalls = 0; rpcCalls = 0; }
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input :
    input instanceof URL ? input.href : input.url);
  const method = init?.method || (input instanceof Request ? input.method : "GET");
  assert(url.origin === ROOT, "REDE_NAO_PERMITIDA_" + url.host);
  if (url.pathname === "/auth/v1/user") {
    authCalls++;
    assert(method === "GET", "AUTH_NAO_GET");
    return json({ id: identidade, aud: "authenticated", role: "authenticated",
      app_metadata: {}, user_metadata: {} });
  }
  assert(url.pathname === "/rest/v1/rpc/catalogo_asaas_reservar_tentativa_qa_sem_pix",
    "RPC_ILEGITIMA_" + url.pathname);
  assert(method === "POST", "RPC_NAO_POST");
  const body = await new Request(input, init).json();
  assert(JSON.stringify(body) === JSON.stringify({ p_lote: LOTE }), "PARAMETROS_RPC");
  rpcCalls++;
  if (modo === "erro") return json({ message: "falha SQL ficticia" }, 409);
  if (modo === "duplicada") return json({ ok: false,
    motivo: "tentativa_ja_reservada", nova_tentativa: false,
    ja_reservado: true, pode_emitir_pix: false });
  return json({ ok: true, nova_tentativa: true, ja_reservado: false,
    lote_id: LOTE, reconciliar_manualmente: true, prova_get_externa: false,
    autorizacao_externa: false, post_executado: false,
    pode_emitir_pix: modo === "insegura", pode_quitar: false,
    pode_liberar_motoboy: false });
};
Deno.env.set("SUPABASE_URL", ROOT);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "chave-ficticia-ci");
Deno.env.set("SUPABASE_SECRET_KEYS", "");
Deno.env.set("ASAAS_ENVIRONMENT", "sandbox");
Deno.env.set("ASAAS_COB06_STAGING_ADMIN_UID", ADMIN);
Deno.env.set("ASAAS_COB06_GATE_RESERVA_QA_ENABLED", "true");
Deno.env.set("ASAAS_API_KEY", "");
const originalServe = Deno.serve;
try {
  Object.defineProperty(Deno, "serve", { configurable: true, writable: true,
    value: (fn: Handler) => { handler = fn;
      return { finished: Promise.resolve(), shutdown: () => {} }; } });
  await import("../catalogo-cob06-reserva-qa-sem-pix/index.ts");
} finally {
  Object.defineProperty(Deno, "serve", { configurable: true, writable: true,
    value: originalServe });
}
assert(handler, "HANDLER_AUSENTE");
async function chamar(body: unknown = { acao: ACAO, lote_id: LOTE },
  bearer = "jwt-ficticio", method = "POST") {
  const res = await handler!(new Request(
    ROOT + "/functions/v1/catalogo-cob06-reserva-qa-sem-pix", {
      method, headers: { "Content-Type": "application/json",
        ...(bearer ? { Authorization: "Bearer " + bearer } : {}) },
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}
function emHold(body: Record<string, unknown>) {
  assert(body.pode_emitir_pix === false && body.pode_quitar === false &&
    body.pode_estornar === false && body.pode_liberar_motoboy === false &&
    body.hold_obrigatorio === true, "HOLD_INCOMPLETO");
}

Deno.test("reserva COB-06: operacao unica valida retorna HOLD, sem pagamento", async () => {
  reset();
  const result = await chamar();
  assert(result.status === 200 && result.body.success === true &&
    result.body.estado === "tentativa_reservada_sem_pix" &&
    result.body.nova_tentativa === true &&
    result.body.post_executado === false &&
    result.body.reconciliar_manualmente === true &&
    authCalls === 1 && rpcCalls === 1, "SUCESSO_CONTROLADO");
  emHold(result.body);
});

Deno.test("reserva COB-06: reserva repetida nao cria nova tentativa", async () => {
  reset(); modo = "duplicada";
  const result = await chamar();
  assert(result.status === 409 && result.body.success === false &&
    result.body.estado === "tentativa_ja_reservada" &&
    result.body.nova_tentativa === false && rpcCalls === 1, "REPETICAO");
  emHold(result.body);
});

Deno.test("reserva COB-06: resposta insegura ou falha SQL bloqueia", async () => {
  for (const caso of ["insegura", "erro"] as const) {
    reset(); modo = caso;
    const result = await chamar();
    assert(result.status === 503 && result.body.success === false &&
      result.body.nova_tentativa === false && rpcCalls === 1,
      "FALHA_FECHADA_" + caso);
    emHold(result.body);
  }
});

Deno.test("reserva COB-06: admin STAGING e JWT obrigatorios antes da RPC", async () => {
  reset();
  const semJwt = await chamar(undefined, "");
  assert(semJwt.status === 401 && authCalls === 0 && rpcCalls === 0, "SEM_JWT");
  emHold(semJwt.body);
  reset(); identidade = INTRUSO;
  const intruso = await chamar();
  assert(intruso.status === 403 && Number(authCalls) === 1 && rpcCalls === 0, "INTRUSO");
  emHold(intruso.body);
});

Deno.test("reserva COB-06: acao, lote, payload e metodo exatos", async () => {
  for (const body of [
    { acao: "emitir_pix", lote_id: LOTE },
    { acao: ACAO, lote_id: "11111111-1111-4111-8111-111111111111" },
    { acao: ACAO, lote_id: LOTE, amount: 560 },
    { acao: ACAO, lote_id: LOTE, payment_id: "pay_falso" },
  ]) {
    reset();
    const r = await chamar(body);
    assert(r.status === 403 && rpcCalls === 0, "PARAMETRO_INDEVIDO");
    emHold(r.body);
  }
  reset();
  const get = await chamar(undefined, "jwt-ficticio", "GET");
  assert(get.status === 405 && authCalls === 0 && rpcCalls === 0, "GET_NAO_BLOQUEADO");
  emHold(get.body);
});
