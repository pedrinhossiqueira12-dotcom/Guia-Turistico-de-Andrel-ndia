// COB-06: testes sem rede da nova Edge de preparação, desligada por padrão.
// Verificam que implantar a função não cria lote, referência, Pix ou saque.
type Handler = (req: Request) => Response | Promise<Response>;
let handler: Handler | null = null;
let chamadasDeRede = 0;
globalThis.fetch = async () => {
  chamadasDeRede++;
  throw Error("REDE_BLOQUEADA_NO_TESTE_COB06");
};
Deno.env.set("SUPABASE_URL", "https://jbttwihctuibchhcyqtl.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "chave-ci-ficticia");
Deno.env.set("SUPABASE_SECRET_KEYS", "");
Deno.env.set("ASAAS_ENVIRONMENT", "sandbox");
Deno.env.set("ASAAS_COB06_PREPARACAO_ISOLADA_ENABLED", "false");
Deno.env.set("ASAAS_COB06_PREPARACAO_ADMIN_ENABLED", "false");
Deno.env.set("ASAAS_BILLING_ENABLED", "false");
Deno.env.set("ASAAS_PAYOUTS_ENABLED", "false");

const serveOriginal = Deno.serve;
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
    configurable: true, writable: true, value: serveOriginal,
  });
}
if (!handler) throw Error("Handler de preparacao nao registrado");
function check(condition: unknown, reason: string): asserts condition {
  if (!condition) throw Error(reason);
}
async function call(method: string, action: string, path = "catalogo-cob06-acumulo-preparacao") {
  const req = new Request("https://ci-cob06.invalid/functions/v1/" + path, {
    method, headers: { "content-type": "application/json", "authorization": "Bearer ci-ficticio" },
    ...(method === "POST" ? { body: JSON.stringify({
      acao: action, comercio_id: "asaas-cob02", competencia_corte: "2027-03-01",
    }) } : {}),
  });
  const res = await handler!(req);
  if (method === "OPTIONS") return { status: res.status, json: null };
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}
Deno.test("Edge COB-06 isolada OFF: nem preparar nem retomar consulta banco", async () => {
  chamadasDeRede = 0;
  for (const acao of ["preparar_acumulo_qa", "retomar_acumulo_qa"]) {
    const res = await call("POST", acao);
    check(res.status === 503 && res.json?.success === false, "Acao nao ficou OFF: " + acao);
    check(res.json?.hold_obrigatorio === true && res.json?.pode_emitir_pix === false &&
      res.json?.pode_quitar === false && res.json?.pode_liberar_motoboy === false,
      "HOLD incompleto: " + acao);
  }
  check(chamadasDeRede === 0, "Edge OFF tocou Auth, banco ou Asaas");
});
Deno.test("Edge COB-06 isolada OFF: nenhuma rota financeira é exposta", async () => {
  chamadasDeRede = 0;
  for (const acao of ["emitir_pix", "criar_cobranca", "confirmar_pagamento",
    "solicitar_saque", "transferir", "webhook"]) {
    const res = await call("POST", acao);
    check(res.status === 503 && res.json?.hold_obrigatorio === true,
      "Rota nao ficou indisponivel: " + acao);
  }
  const errado = await call("POST", "preparar_acumulo_qa", "outra-funcao");
  check(errado.status === 404, "Path desconhecido aceito");
  const get = await call("GET", "");
  check(get.status === 405, "GET financeiro aceito");
  const preflight = await call("OPTIONS", "");
  check(preflight.status === 204, "CORS preflight rejeitado");
  check(chamadasDeRede === 0, "Rota nao autorizada acionou rede");
});
