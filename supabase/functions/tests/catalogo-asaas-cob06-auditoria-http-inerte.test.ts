// COB-06 / PR39: comportamento HTTP da Edge isolada e DESLIGADA por padrao.
// Tudo acontece no processo de CI: nenhum socket, Supabase real ou Asaas real.
const ORIGIN = "https://ci-cob06.invalid";
type Handler = (req: Request) => Response | Promise<Response>;
let handler: Handler | null = null;
let tentativasDeRede = 0;
globalThis.fetch = async () => {
  tentativasDeRede++;
  throw Error("COB06_TESTE_REDE_EXTERNAMENTE_PROIBIDA");
};

Deno.env.set("SUPABASE_URL", ORIGIN);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "ci-ficticio");
Deno.env.set("SUPABASE_SECRET_KEYS", "");
Deno.env.set("ASAAS_ENVIRONMENT", "sandbox");
Deno.env.set("ASAAS_API_KEY", "token-apenas-ficticio");
Deno.env.set("ASAAS_COB06_STAGING_ADMIN_UID", "");
Deno.env.set("ASAAS_COB06_AUDITORIA_ISOLADA_ENABLED", "false");
Deno.env.set("ASAAS_COB06_GET_ADMIN_READONLY_ENABLED", "false");
Deno.env.set("ASAAS_COB06_OBSERVACAO_ADMIN_ENABLED", "false");
Deno.env.set("ASAAS_BILLING_ENABLED", "false");
Deno.env.set("ASAAS_PAYOUTS_ENABLED", "false");

const serveAnterior = Deno.serve;
try {
  Object.defineProperty(Deno, "serve", {
    configurable: true, writable: true,
    value: (fn: Handler) => {
      handler = fn;
      return { finished: Promise.resolve(), shutdown: () => {} };
    },
  });
  await import("../catalogo-asaas-cob06-auditoria/index.ts");
} finally {
  Object.defineProperty(Deno, "serve", {
    configurable: true, writable: true, value: serveAnterior,
  });
}
if (!handler) throw Error("Edge de auditoria nao registrou handler");
function assert(ok: unknown, motivo: string): asserts ok {
  if (!ok) throw Error(motivo);
}
async function chamar(metodo: string, path = "/functions/v1/catalogo-asaas-cob06-auditoria",
  conteudo?: unknown) {
  const headers = { "content-type": "application/json", authorization: "Bearer teste-ficticio" };
  const req = new Request(ORIGIN + path, {
    method: metodo,
    headers,
    ...(conteudo === undefined ? {} : { body: JSON.stringify(conteudo) }),
  });
  const res = await handler!(req);
  return { status: res.status, dados: await res.json() as Record<string, unknown> };
}
Deno.test("COB06 Edge isolada: health GET e publico, estatico e integralmente HOLD", async () => {
  tentativasDeRede = 0;
  const r = await chamar("GET");
  assert(r.status === 200 && r.dados.success === true &&
    r.dados.modo === "STAGING_HOLD" && r.dados.banco_consultado === false,
    "GET nao e health estatico");
  for (const chave of ["pode_emitir_pix", "pode_quitar", "pode_estornar",
    "pode_liberar_motoboy"]) {
    assert(r.dados[chave] === false, "GET autorizou acao: " + chave);
  }
  assert(r.dados.hold_obrigatorio === true && tentativasDeRede === 0,
    "GET acionou rede ou dispensou HOLD");
});
Deno.test("COB06 Edge isolada: Pix, transferencia, saque e webhook nao possuem rota", async () => {
  tentativasDeRede = 0;
  for (const acao of ["criar_cobranca", "emitir_pix", "transferir_saque",
    "registrar_estado_acumulo_sandbox_admin", "webhook"]) {
    const r = await chamar("POST", undefined, { acao, lote_id: "qualquer" });
    assert(r.status === 403 && r.dados.hold_obrigatorio === true &&
      r.dados.pode_emitir_pix === false && r.dados.pode_quitar === false,
      "acao negada nao manteve HOLD: " + acao);
  }
  const webhook = await chamar("POST", "/functions/v1/catalogo-asaas-cob06-auditoria/webhook",
    { acao: "observar_primeiro_acumulo_sandbox_admin" });
  assert(webhook.status === 404, "webhook nao foi rejeitado");
  assert(tentativasDeRede === 0, "chamou rede para acao proibida");
});
Deno.test("COB06 Edge isolada: rota de observacao inexistente nao consulta o banco", async () => {
  tentativasDeRede = 0;
  const r = await chamar("POST", undefined,
    { acao: "observar_primeiro_acumulo_sandbox_admin",
      lote_id: "22222222-3333-4444-8888-aaaaaaaaaaaa" });
  assert(r.status === 403 && r.dados.hold_obrigatorio === true &&
    r.dados.pode_emitir_pix === false && r.dados.pode_quitar === false &&
    r.dados.pode_estornar === false && r.dados.pode_liberar_motoboy === false,
    "observacao desligada foi executada");
  assert(tentativasDeRede === 0, "observacao inativa consultou rede");
});
Deno.test("COB06 Edge isolada: entrada invalida e caminhos desconhecidos falham fechados", async () => {
  tentativasDeRede = 0;
  const outro = await chamar("GET", "/functions/v1/rota-inexistente");
  assert(outro.status === 404, "rota inexistente respondeu");
  const metodo = await chamar("PUT");
  assert(metodo.status === 405, "metodo nao permitido");
  const grande = await chamar("POST", undefined, { acao: "x".repeat(9000) });
  assert(grande.status === 413 && grande.dados.hold_obrigatorio === true,
    "payload grande aceito");
  assert(tentativasDeRede === 0, "entradas invalidas tocaram a rede");
});

Deno.test("COB06 Edge isolada: consulta de duplicidade inativa nao toca Supabase ou Asaas", async () => {
  tentativasDeRede = 0;
  const r = await chamar("POST", undefined, {
    acao: "auditar_duplicidade_acumulo_sandbox_admin",
    lote_id: "22222222-3333-4444-8888-aaaaaaaaaaaa",
  });
  assert(r.status === 503 && r.dados.success === false &&
    r.dados.hold_obrigatorio === true &&
    r.dados.pode_emitir_pix === false && r.dados.pode_quitar === false &&
    tentativasDeRede === 0, "AUDITORIA_DESLIGADA_ACIONOU_REDE");
});
