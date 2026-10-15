// COB-06: handler HTTP real com PostgREST e Asaas inteiramente ficticios.
// Nenhuma rede externa, dinheiro, credencial real ou socket e permitido.
const ROOT = "https://ci-cob06.invalid";
const ASAAS = "https://api-sandbox.asaas.com";
const ADMIN = "4b9a0233-6b72-4573-aebd-d596c5b15e1b";
const OUTRO = "11111111-2222-4333-8444-555555555555";
const LOTE = "22222222-3333-4444-8888-aaaaaaaaaaaa";
const PAYMENT = "pay_cob06_http123";
const CUSTOMER = "cus_cob06_http123";
const REF = "guia-acumulo-" + LOTE;
type Handler = (req: Request) => Response | Promise<Response>;
let handler: Handler | null = null;
let usuario = ADMIN;
let status = "PENDING";
let falhaPreflight = false;
let falhaRegistro = false;
let getsBanco = 0;
let getsAsaas = 0;
let escritas = 0;
let chaveAnterior = "";
let eventoAnterior = 0;
let proximoEvento = 20;
const responder = (data: unknown, code = 200) => new Response(JSON.stringify(data), {
  status: code, headers: { "content-type": "application/json" },
});
function assert(ok: unknown, msg: string): asserts ok { if (!ok) throw Error(msg); }
function reiniciar() {
  usuario = ADMIN; status = "PENDING"; falhaPreflight = false; falhaRegistro = false;
  getsBanco = 0; getsAsaas = 0; escritas = 0;
  chaveAnterior = ""; eventoAnterior = 0; proximoEvento = 20;
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = init?.method || "GET";
  if (url.origin === ASAAS) {
    assert(method === "GET" && url.pathname === "/v3/payments/" + PAYMENT,
      "GET bancario saiu do endpoint fixo");
    assert((init?.headers as Record<string,string>)?.access_token === "ci-token-ficticio",
      "GET sem token de servidor");
    getsAsaas++;
    return responder({ id: PAYMENT, customer: CUSTOMER, externalReference: REF,
      value: 5, billingType: "PIX", status });
  }
  assert(url.origin === ROOT, "rede externa bloqueada: " + url.host);
  if (url.pathname === "/auth/v1/user")
    return responder({ id: usuario, aud: "authenticated", role: "authenticated",
      app_metadata: {}, user_metadata: {} });
  if (url.pathname.startsWith("/rest/v1/catalogo_asaas_acumulo_referencias") && method === "GET") {
    getsBanco++;
    return responder({ lote_id: LOTE, comercio_id: "comercio-ci", referencia: REF,
      valor_centavos: 500, payment_id: null, pode_emitir_pix: false });
  }
  if (url.pathname.startsWith("/rest/v1/catalogo_asaas_acumulo_observacoes") && method === "GET") {
    getsBanco++;
    return responder({ lote_id: LOTE, payment_id: PAYMENT, customer_id: CUSTOMER,
      referencia: REF, valor_centavos: 500, pode_quitar: false,
      pode_liberar_motoboy: false });
  }
  if (url.pathname.startsWith("/rest/v1/catalogo_asaas_clientes") && method === "GET") {
    getsBanco++;
    return responder({ cliente_id: CUSTOMER });
  }
  if (url.pathname === "/rest/v1/rpc/catalogo_asaas_conferir_conciliacao_acumulo" && method === "POST") {
    getsBanco++;
    return responder({ integridade_contabil_ok: !falhaPreflight, valor_fontes_centavos: 500 });
  }
  if (url.pathname === "/rest/v1/rpc/catalogo_asaas_registrar_evento_acumulo_inerte" && method === "POST") {
    escritas++;
    const args = JSON.parse(String(init?.body)) as Record<string,unknown>;
    assert(args.p_lote === LOTE && args.p_payment === PAYMENT && args.p_estado === status,
      "RPC recebeu evento nao verificado");
    const chave = args.p_evento;
    assert(typeof chave === "string" && /^get-[0-9a-f]{64}$/.test(chave),
      "chave idempotente invalida");
    if (falhaRegistro) return responder({ ok: true, evento_id: 44,
      pode_quitar: true, pode_estornar: false, pode_liberar_motoboy: false });
    const repetido = chaveAnterior === chave;
    if (!repetido) { chaveAnterior = chave; eventoAnterior = proximoEvento++; }
    return responder({ ok: true, evento_id: eventoAnterior, ja_observado: repetido,
      pode_quitar: false, pode_estornar: false, pode_liberar_motoboy: false });
  }
  throw Error("rota/metodo fora do contrato: " + method + " " + url.pathname);
};
Deno.env.set("SUPABASE_URL", ROOT);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "ci-ficticio");
Deno.env.set("SUPABASE_SECRET_KEYS", "");
Deno.env.set("ASAAS_ENVIRONMENT", "sandbox");
Deno.env.set("ASAAS_API_KEY", "ci-token-ficticio");
Deno.env.set("ASAAS_COB06_GET_ADMIN_READONLY_ENABLED", "true");
Deno.env.set("ASAAS_COB06_OBSERVACAO_ADMIN_ENABLED", "true");
Deno.env.set("ASAAS_BILLING_ENABLED", "false");
Deno.env.set("ASAAS_PAYOUTS_ENABLED", "false");
const serveAnterior = Deno.serve;
try {
  Object.defineProperty(Deno, "serve", { configurable: true, writable: true,
    value: (fn: Handler) => { handler = fn; return { finished: Promise.resolve(), shutdown: () => {} }; } });
  await import("../catalogo-asaas-financeiro/index.ts");
} finally {
  Object.defineProperty(Deno, "serve", { configurable: true, writable: true, value: serveAnterior });
}
assert(handler, "handler HTTP nao capturado");
async function chamar(acao: string, lote_id = LOTE) {
  const response = await handler!(new Request(ROOT + "/functions/v1/catalogo-asaas-financeiro", {
    method: "POST", headers: { "authorization": "Bearer token-ci", "content-type": "application/json" },
    body: JSON.stringify({ acao, lote_id }),
  }));
  return { http: response.status, body: await response.json() as Record<string,unknown> };
}
Deno.test("COB06 HTTP: GET e registro idempotente preservam HOLD e nao emitem Pix", async () => {
  reiniciar();
  const primeira = await chamar("registrar_estado_acumulo_sandbox_admin");
  assert(primeira.http === 200 && primeira.body.success === true && primeira.body.hold_obrigatorio === true,
    "primeiro GET deveria registrar HOLD");
  const registro1 = primeira.body.registro as Record<string,unknown>;
  assert(registro1?.ja_observado === false && registro1?.evento_id === 20,
    "primeiro evento incorreto");
  const segunda = await chamar("registrar_estado_acumulo_sandbox_admin");
  const registro2 = segunda.body.registro as Record<string,unknown>;
  assert(segunda.http === 200 && registro2?.ja_observado === true && registro2?.evento_id === 20,
    "repeticao criou evento duplicado");
  status = "RECEIVED";
  const terceira = await chamar("registrar_estado_acumulo_sandbox_admin");
  const registro3 = terceira.body.registro as Record<string,unknown>;
  assert(terceira.http === 200 && registro3?.evento_id === 21 && registro3?.ja_observado === false,
    "mudanca de status nao foi registrada como nova observacao");
  for (const resposta of [primeira,segunda,terceira]) {
    assert(resposta.body.pode_emitir_pix === false && resposta.body.pode_quitar === false &&
      resposta.body.pode_estornar === false && resposta.body.pode_liberar_motoboy === false,
      "handler liberou valor durante observacao");
  }
  assert(getsBanco === 12 && getsAsaas === 3 && escritas === 3,
    "fluxo de consulta/registro inesperado");
});
Deno.test("COB06 HTTP: leitura nao grava, nao-admin e lote invalido nao consultam banco", async () => {
  reiniciar();
  const leitura = await chamar("conferir_acumulo_sandbox_admin");
  assert(leitura.http === 200 && leitura.body.registro === null && escritas === 0,
    "modo readonly gravou evento");
  reiniciar(); usuario = OUTRO;
  const negado = await chamar("registrar_estado_acumulo_sandbox_admin");
  assert(negado.http === 403 && getsBanco === 0 && getsAsaas === 0 && escritas === 0,
    "usuario comum conseguiu consultar dados bancarios");
  reiniciar();
  const invalido = await chamar("registrar_estado_acumulo_sandbox_admin", "nao-uuid");
  assert(invalido.http === 400 && getsBanco === 0 && getsAsaas === 0 && escritas === 0,
    "lote adulterado acessou banco");
});
Deno.test("COB06 HTTP: preflight inconsistente e RPC liberando quitação falham fechados", async () => {
  reiniciar(); falhaPreflight = true;
  const bloqueado = await chamar("registrar_estado_acumulo_sandbox_admin");
  assert(bloqueado.http === 409 && getsAsaas === 0 && escritas === 0,
    "preflight falho chegou ao provedor");
  reiniciar(); falhaRegistro = true;
  const inconsistente = await chamar("registrar_estado_acumulo_sandbox_admin");
  assert(inconsistente.http === 503 && Number(getsAsaas) === 1 && Number(escritas) === 1,
    "RPC com quitação habilitada foi aceita");
});
// Cada arquivo de teste roda em worker isolado; nenhuma chamada de rede real ocorreu.
void originalFetch;
