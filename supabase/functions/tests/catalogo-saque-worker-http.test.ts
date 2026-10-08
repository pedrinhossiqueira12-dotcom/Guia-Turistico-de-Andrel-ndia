// HTTP real de Payouts em CI, SEM credenciais reais, SEM rede externa e SEM socket.
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const URL_FAKE = "https://ci-supabase.invalid";
const secret = "ci-secret-long-and-not-live";
Deno.env.set("SUPABASE_URL", URL_FAKE);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-test-inutil");
Deno.env.set("CATALOGO_SAQUE_WORKER_SECRET", secret);
Deno.env.set("MP_PAYOUTS_MODE", "test");
Deno.env.set("MP_PAYOUTS_ENABLED", "false");
Deno.env.set("MP_PAYOUTS_ACCESS_TOKEN", "");
Deno.env.set("MP_PAYOUTS_LIVE_ENABLED", "false");
Deno.env.set("CATALOGO_DATA_ENCRYPTION_KEY", "1".repeat(64));

type Handler = (request: Request) => Response | Promise<Response>;
let handler: Handler | undefined;
const oldServe = Deno.serve;
try {
  Object.defineProperty(Deno, "serve", {
    configurable: true, writable: true,
    value: (fn: Handler) => { handler=fn; return {finished:Promise.resolve(),shutdown() {}}; },
  });
  await import("../catalogo-saque-payout/index.ts");
} finally {
  Object.defineProperty(Deno, "serve", { configurable: true, writable: true, value: oldServe });
}
assert(handler, "Falhou capturar o handler real de Payouts");
let network = 0;
const previousFetch = globalThis.fetch;
globalThis.fetch = async () => { network++; throw new Error("Rede real proibida no teste de saque"); };
const request = (headers: Record<string,string>={}) => new Request(URL_FAKE+"/functions/v1/catalogo-saque-payout",
  {method:"POST",headers:{"content-type":"application/json",...headers},
    body:JSON.stringify({saque_id:"00000000-0000-4000-8000-000000000341"})});
try {
  Deno.test("worker payout rejeita acesso sem segredo e nenhum fetch externo",async()=>{
    const res=await handler!(request());
    assert(res.status===403,"Endpoint precisa recusar anonimo");
    assert(network===0,"Worker de saque sem autenticacao tocou rede");
  });
  Deno.test("worker payout nao debita ou credita sem configurar credenciais",async()=>{
    const res=await handler!(request({"x-worker-secret":secret}));
    assert(res.status===503,"Payouts desabilitado precisa rejeitar tentativa");
    const payload=await res.json();
    assert(JSON.stringify(payload).includes("não habilitados"),"Mensagem de habilitação ausente");
    assert(network===0,"Worker desabilitado tentou transacao!");
  });
  Deno.test("worker payout nao aceita metodo GET sem acionar banco",async()=>{
    const res=await handler!(new Request(URL_FAKE+"/functions/v1/catalogo-saque-payout",
      {method:"GET",headers:{"x-worker-secret":secret}}));
    assert(res.status===405,"O endpoint privado deve aceitar somente POST");
    assert(network===0,"Requisicao sem POST tocou rede");
  });
} finally {
  // Restaurar fetch só após captura e declaração dos testes: Deno executa
  // os testes depois do módulo; não restaurar aqui (scope permanece isolado).
  void previousFetch;
}
