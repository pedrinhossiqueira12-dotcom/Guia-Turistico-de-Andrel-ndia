import { conciliarAntesDePixAcumuloCandidatoSomenteCi } from "../_shared/catalogo-asaas-acumulo-pre-post-somente-ci.ts";
import { postarPixAcumuloSandboxCandidatoSomenteCi } from "../_shared/catalogo-asaas-acumulo-post-sandbox-candidato.ts";
import { consultarPagamentoAcumuloSandboxGet,
  encontrarIdPagamentoAcumuloSandboxPorReferencia } from "../_shared/catalogo-asaas-acumulo-get-sandbox-inerte.ts";
import { conferirPagamentoAcumuloPorGet } from "../_shared/catalogo-asaas-acumulo-get-verificado-inerte.ts";

const id = "pay_cob06_test123";
const lote = "22222222-3333-4444-8888-aaaaaaaaaaaa";
const esperado = { loteId: lote, referencia: "guia-acumulo-" + lote,
  clienteId: "cus_cob06_test123", valorCentavos: 500 };
const remoto = { id, externalReference: esperado.referencia, customer: esperado.clienteId,
  value: 5, billingType: "PIX", status: "PENDING" };
function assert(ok: unknown, why: string) { if (!ok) throw new Error(why); }
async function hold(fn: () => Promise<unknown>, codigo: string) {
  let error = "";
  try { await fn(); } catch (e) { error = String(e); }
  assert(error.includes("COB06_HOLD_" + codigo), "esperado HOLD " + codigo + ":" + error);
}
Deno.test("COB06 GET Sandbox usa somente endpoint fixo, GET e token do servidor", async () => {
  let requests = 0;
  const mock = (async (url: string | URL | Request, init?: RequestInit) => {
    requests++;
    assert(url === "https://api-sandbox.asaas.com/v3/payments/" + id, "URL fixa");
    assert(init?.method === "GET" && init.redirect === "error", "GET sem redirect");
    assert((init?.headers as Record<string,string> | undefined)?.access_token === "segredo-ci", "token servidor");
    return new Response(JSON.stringify(remoto), { status: 200,
      headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const observacao = await conferirPagamentoAcumuloPorGet(esperado, id,
    (paymentId) => consultarPagamentoAcumuloSandboxGet(paymentId, "segredo-ci", mock));
  assert(requests === 1 && observacao.p_valor === 500, "GET unico e cents exatos");
});
Deno.test("COB06 GET Sandbox falha fechado antes de consultar", async () => {
  let requests = 0;
  const mock = (async () => { requests++; throw Error("nao chamar"); }) as typeof fetch;
  await hold(() => consultarPagamentoAcumuloSandboxGet("pay_!", "segredo-ci", mock), "PAGAMENTO_INVALIDO");
  await hold(() => consultarPagamentoAcumuloSandboxGet(id, "", mock), "CREDENCIAL_INDISPONIVEL");
  assert(requests === 0, "sem rede antes da validacao");
});
Deno.test("COB06 GET Sandbox rejeita erros, MIME, excesso e documento malformado", async () => {
  const casos: Array<[string, Response, string]> = [
    ["HTTP", new Response("erro", { status: 503 }), "GET_INDISPONIVEL"],
    ["HTML", new Response("<html>", { headers: { "content-type": "text/html" } }), "RESPOSTA_INVALIDA"],
    ["grande", new Response("x".repeat(65537), { headers: { "content-type": "application/json" } }), "RESPOSTA_INVALIDA"],
    ["JSON", new Response("{", { headers: { "content-type": "application/json" } }), "RESPOSTA_INVALIDA"],
  ];
  for (const [, response, codigo] of casos) {
    await hold(() => consultarPagamentoAcumuloSandboxGet(id, "segredo-ci",
      (async () => response) as typeof fetch), codigo);
  }
});

Deno.test("COB06 lista Sandbox: referencia interna, GET sem POST e cardinalidade unica", async () => {
  let consultas = 0;
  const mock = (async (raw: string | URL | Request, init?: RequestInit) => {
    consultas++;
    const url = new URL(String(raw));
    assert(url.origin === "https://api-sandbox.asaas.com" &&
      url.pathname === "/v3/payments", "listagem no Sandbox fixo");
    assert(url.searchParams.get("externalReference") === esperado.referencia &&
      url.searchParams.get("limit") === "2" &&
      url.searchParams.get("offset") === "0" &&
      url.searchParams.size === 3, "filtro exato sem ID do navegador");
    assert(init?.method === "GET" && init.redirect === "error" &&
      (init?.headers as Record<string,string> | undefined)?.access_token === "segredo-ci",
      "somente GET autenticado");
    return new Response(JSON.stringify({
      object: "list", hasMore: false, totalCount: 1, offset: 0,
      data: [{ id }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const descoberto = await encontrarIdPagamentoAcumuloSandboxPorReferencia(
    esperado.referencia, "segredo-ci", mock);
  assert(descoberto === id && consultas === 1, "encontrou unico pagamento");
});

Deno.test("COB06 lista Sandbox: pagina, duplicidade, vazio e metadados estranhos sao HOLD", async () => {
  const respostas = [
    [{ object: "list", hasMore: false, totalCount: 0, data: [] }, "PAGAMENTO_NAO_LOCALIZADO"],
    [{ object: "list", hasMore: false, totalCount: 2,
      data: [{ id }, { id: "pay_outro_123456" }] }, "REFERENCIA_NAO_UNICA"],
    [{ object: "list", hasMore: true, totalCount: 2,
      data: [{ id }] }, "REFERENCIA_NAO_UNICA"],
    [{ object: "list", hasMore: false, totalCount: 2,
      data: [{ id }] }, "REFERENCIA_NAO_UNICA"],
    [{ object: "list", hasMore: false, totalCount: 1,
      data: [{ id: "pay_!" }] }, "LISTAGEM_INVALIDA"],
    [{ object: "list", data: [{ id }] }, "LISTAGEM_INVALIDA"],
    [{ object: "payment", hasMore: false, data: [{ id }] }, "LISTAGEM_INVALIDA"],
    [{ object: "list", hasMore: false, totalCount: 1, offset: 1,
      data: [{ id }] }, "LISTAGEM_INVALIDA"],
  ] as const;
  for (const [data, reason] of respostas) {
    await hold(() => encontrarIdPagamentoAcumuloSandboxPorReferencia(
      esperado.referencia, "segredo-ci",
      (async () => new Response(JSON.stringify(data), { status: 200,
        headers: { "content-type": "application/json" } })) as typeof fetch,
    ), reason);
  }
});

Deno.test("COB06 lista Sandbox: entrada errada e falha de rede nunca registram pagamento", async () => {
  let calls = 0;
  const mock = (async () => { calls++; throw Error("sem rede"); }) as typeof fetch;
  await hold(() => encontrarIdPagamentoAcumuloSandboxPorReferencia("guia-acumulo-errado",
    "segredo-ci", mock), "REFERENCIA_INVALIDA");
  await hold(() => encontrarIdPagamentoAcumuloSandboxPorReferencia(esperado.referencia,
    "", mock), "CREDENCIAL_INDISPONIVEL");
  assert(calls === 0, "entrada invalida nao sai para rede");
  await hold(() => encontrarIdPagamentoAcumuloSandboxPorReferencia(esperado.referencia,
    "segredo-ci", mock), "GET_INDISPONIVEL");
  assert(calls === 1, "falha de rede nao tenta POST nem retry automatico");
});


// As provas POST abaixo nunca saem da CI: injecao de fetch ficticio sem rede.
// O modulo candidato nao esta ligado a nenhuma rota e nao recebe autorização SQL.
Deno.test("COB06 POST candidato: corpo de Pix agregado, unica tentativa e GET verificado em HOLD", async () => {
  let posts = 0;
  let gets = 0;
  const mock = (async (raw: string | URL | Request, init?: RequestInit) => {
    const url = String(raw);
    assert((init?.headers as Record<string, string>)?.access_token === "segredo-ficticio-ci",
      "token do servidor obrigatorio");
    assert(init?.redirect === "error" && init?.signal instanceof AbortSignal,
      "sem redirect e com timeout");
    if (url === "https://api-sandbox.asaas.com/v3/payments") {
      posts++;
      assert(init?.method === "POST", "POST unico");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert(Object.keys(body).sort().join(",") ===
        ["billingType", "customer", "description", "dueDate", "externalReference", "value"].sort().join(","),
        "somente campos previstos");
      assert(body.customer === esperado.clienteId && body.billingType === "PIX" &&
        body.value === 5 && body.dueDate === "2099-01-06" &&
        body.externalReference === esperado.referencia,
        "identidade e dinheiro de origem do servidor");
      return new Response(JSON.stringify({ id }), { status: 201,
        headers: { "content-type": "application/json" } });
    }
    assert(url === "https://api-sandbox.asaas.com/v3/payments/" + id &&
      init?.method === "GET", "GET por ID apos POST");
    gets++;
    return new Response(JSON.stringify(remoto), { status: 200,
      headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const r = await postarPixAcumuloSandboxCandidatoSomenteCi(
    esperado, "2099-01-06", "segredo-ficticio-ci", mock);
  assert(posts === 1 && gets === 1 && r.paymentId === id &&
    r.observacao.p_status === "PENDING" && r.holdObrigatorio === true &&
    r.podeQuitar === false && r.podeLiberarMotoboy === false,
    "GET confirmado nunca baixa nem libera saldo");
});

Deno.test("COB06 POST candidato: argumentos invalidos bloqueados antes da rede", async () => {
  let chamadas = 0;
  const mock = (async () => { chamadas++; throw Error("rede nao permitida"); }) as typeof fetch;
  const invalidos = [
    [{ ...esperado, loteId: "nao-uuid" }, "2099-01-06", "segredo-ficticio-ci", "LOTE_INVALIDO"],
    [{ ...esperado, referencia: "outra" }, "2099-01-06", "segredo-ficticio-ci", "REFERENCIA_INVALIDA"],
    [{ ...esperado, clienteId: "cus_!" }, "2099-01-06", "segredo-ficticio-ci", "CLIENTE_INVALIDO"],
    [{ ...esperado, valorCentavos: 499 }, "2099-01-06", "segredo-ficticio-ci", "VALOR_INVALIDO"],
    [esperado, "2025-02-30", "segredo-ficticio-ci", "VENCIMENTO_INVALIDO"],
    [esperado, "2099-01-06", "", "CREDENCIAL_INDISPONIVEL"],
  ] as const;
  for (const [dados, vencimento, token, motivo] of invalidos) {
    await hold(() => postarPixAcumuloSandboxCandidatoSomenteCi(
      dados, vencimento, token, mock), motivo);
  }
  assert(chamadas === 0, "nenhuma tentativa remota com dado invalido");
});

Deno.test("COB06 POST candidato: falhas ambiguas sao HOLD sem retry automatico", async () => {
  for (const modo of ["rede", "503", "html", "id", "grande"] as const) {
    let posts = 0;
    let gets = 0;
    const mock = (async (raw: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts++;
        if (modo === "rede") throw Error("resposta perdida apos envio");
        if (modo === "503") return new Response("indisponivel", { status: 503 });
        if (modo === "html") return new Response("<html>", { status: 201,
          headers: { "content-type": "text/html" } });
        if (modo === "grande") return new Response("x".repeat(65537), {
          status: 201, headers: { "content-type": "application/json" } });
        return new Response(JSON.stringify({ id: "pay_!" }), { status: 201,
          headers: { "content-type": "application/json" } });
      }
      gets++;
      throw Error("GET nao pode ocorrer");
    }) as typeof fetch;
    const erro = modo === "rede" || modo === "503" ? "POST_INCONCLUSIVO"
      : modo === "id" ? "POST_ID_INVALIDO" : "POST_RESPOSTA_INVALIDA";
    await hold(() => postarPixAcumuloSandboxCandidatoSomenteCi(
      esperado, "2099-01-06", "segredo-ficticio-ci", mock), erro);
    assert(posts === 1 && gets === 0, "sem repetir POST apos falha " + modo);
  }
});

Deno.test("COB06 POST candidato: divergencia no GET impede aceitar resposta do POST", async () => {
  let posts = 0;
  let gets = 0;
  const mock = (async (_raw: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts++;
      return new Response(JSON.stringify({ id }), { status: 201,
        headers: { "content-type": "application/json" } });
    }
    gets++;
    return new Response(JSON.stringify({ ...remoto, value: 6 }), { status: 200,
      headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  await hold(() => postarPixAcumuloSandboxCandidatoSomenteCi(
    esperado, "2099-01-06", "segredo-ficticio-ci", mock), "VALOR_DIVERGENTE");
  assert(posts === 1 && gets === 1, "GET divergente sem outra emissao");
});


// Coordenacao do pre-POST: banco e Asaas 100% ficticios, SEM rede real.
const gateCi = {
  ok: true, nova_tentativa: true, candidato_post_unico_ci: true,
  lote_id: lote, referencia: esperado.referencia,
  cliente_id: esperado.clienteId, valor_centavos: 500,
  operacao_id: "77777777-7777-4777-8777-777777777777",
  reconciliar_por_get: true, prova_get_externa: false,
  autorizacao_externa: false, pode_emitir_pix: false,
  pode_quitar: false, pode_liberar_motoboy: false,
};
function listagemFicticia(modo: "vazia" | "unica" | "duplicada" | "malformada") {
  const data = modo === "vazia" ? [] : [{ id }];
  if (modo === "duplicada") data.push({ id: "pay_outro_987654" });
  if (modo === "malformada") return { data, hasMore: false };
  return { object: "list", data, hasMore: false,
    totalCount: data.length, offset: 0 };
}
function asaasSomenteGet(modo: "vazia" | "unica" | "duplicada" | "malformada" |
  "falha" | "divergente", rastreio: string[]) {
  return (async (raw: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(raw));
    rastreio.push((init?.method || "") + " " + url.pathname);
    assert(init?.method === "GET" && init.redirect === "error" &&
      url.origin === "https://api-sandbox.asaas.com" &&
      (init.headers as Record<string, string>).access_token === "segredo-ci",
      "pre-POST somente GET autenticado na API sandbox");
    if (modo === "falha") throw Error("timeout bancario ambiguo");
    if (url.pathname === "/v3/payments") {
      return new Response(JSON.stringify(listagemFicticia(
        modo === "divergente" ? "unica" : modo)), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    assert(url.pathname === "/v3/payments/" + id, "GET por ID esperado");
    return new Response(JSON.stringify(modo === "divergente"
      ? { ...remoto, value: 6 } : remoto), {
        status: 200, headers: { "content-type": "application/json" },
      });
  }) as typeof fetch;
}

Deno.test("COB06 pre-POST: cobranca ja existe, GET confere e nunca reserva ou faz POST", async () => {
  const rede: string[] = [];
  let claims = 0;
  const r = await conciliarAntesDePixAcumuloCandidatoSomenteCi(
    esperado, "segredo-ci", async () => { claims++; return gateCi; },
    asaasSomenteGet("unica", rede));
  assert(r.estado === "cobranca_existente_verificada" &&
    r.paymentId === id && r.statusBancario === "PENDING" &&
    r.holdObrigatorio === true && r.podeEmitirPix === false &&
    r.podeQuitar === false && r.podeLiberarMotoboy === false &&
    claims === 0 && rede.join(",") ===
    "GET /v3/payments,GET /v3/payments/" + id,
    "pagamento existente nunca gera claim nem nova cobranca");
});

Deno.test("COB06 pre-POST: GET vazio permite somente claim CI, nunca POST nem credito", async () => {
  const rede: string[] = [];
  let claims = 0;
  const r = await conciliarAntesDePixAcumuloCandidatoSomenteCi(
    esperado, "segredo-ci", async (idLote) => {
      claims++;
      assert(idLote === lote, "claim apenas do lote do servidor");
      return gateCi;
    }, asaasSomenteGet("vazia", rede));
  assert(r.estado === "tentativa_ci_reservada" && r.paymentId === null &&
    r.holdObrigatorio === true && r.podeEmitirPix === false &&
    r.podeQuitar === false && r.podeLiberarMotoboy === false &&
    claims === 1 && rede.join(",") === "GET /v3/payments",
    "gate CI nao libera emissao externa");
});

Deno.test("COB06 pre-POST: GET vazio com tentativa anterior exige reconciliacao manual", async () => {
  const rede: string[] = [];
  let claims = 0;
  const r = await conciliarAntesDePixAcumuloCandidatoSomenteCi(
    esperado, "segredo-ci", async () => {
      claims++;
      return { ok: false, motivo: "tentativa_ja_iniciada",
        nova_tentativa: false, reconciliar_por_get: true,
        pode_emitir_pix: false };
    }, asaasSomenteGet("vazia", rede));
  assert(r.estado === "tentativa_anterior_reconciliar_manualmente" &&
    claims === 1 && rede.length === 1 &&
    r.podeEmitirPix === false && r.holdObrigatorio === true,
    "replay nunca permite nova cobranca");
});

Deno.test("COB06 pre-POST: rede fora, duplicidade, lista invalida ou valor divergente nao chamam gate", async () => {
  for (const modo of ["falha", "duplicada", "malformada", "divergente"] as const) {
    const rede: string[] = [];
    let claims = 0;
    await hold(() => conciliarAntesDePixAcumuloCandidatoSomenteCi(
      esperado, "segredo-ci", async () => {
        claims++; return gateCi;
      }, asaasSomenteGet(modo, rede)),
      modo === "divergente" ? "VALOR_DIVERGENTE" : "GET_INCONCLUSIVO");
    assert(claims === 0 && rede.every(x => x.startsWith("GET ")),
      "falha bancaria nao pode gerar tentativa " + modo);
  }
});

Deno.test("COB06 pre-POST: claim divergente ou inesperadamente positivo fica em HOLD", async () => {
  for (const variante of [
    { ...gateCi, valor_centavos: 501 },
    { ...gateCi, autorizacao_externa: true },
    { ...gateCi, pode_emitir_pix: true },
    { ...gateCi, referencia: "guia-acumulo-invalido" },
    { ...gateCi, ok: false },
  ]) {
    const rede: string[] = [];
    let claims = 0;
    await hold(() => conciliarAntesDePixAcumuloCandidatoSomenteCi(
      esperado, "segredo-ci", async () => {
        claims++; return variante;
      }, asaasSomenteGet("vazia", rede)), "GATE_INVALIDO");
    assert(claims === 1 && rede.join(",") === "GET /v3/payments",
      "claim adulterado nao pode emitir Pix");
  }
});

Deno.test("COB06 pre-POST: valores invalidos nao consultam provedor ou banco", async () => {
  let chamadas = 0;
  const mock = (async () => { chamadas++; throw Error("rede indevida"); }) as typeof fetch;
  await hold(() => conciliarAntesDePixAcumuloCandidatoSomenteCi(
    { ...esperado, valorCentavos: 499 }, "segredo-ci",
    async () => { chamadas++; return gateCi; }, mock), "VALOR_INVALIDO");
  assert(chamadas === 0, "bloqueio antes da rede");
});
