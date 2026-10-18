// COB-06 / PR39: Edge isolada com flags TRUE SOMENTE neste processo de CI.
// Provedor Asaas, Supabase, sessao e pagamentos sao 100% ficticios.
// NUNCA executar este teste contra banco, JWT ou token de um ambiente real.
// URL STAGING interceptada integralmente pelo fetch fake; NENHUMA rede autorizada.
const ROOT = "https://jbttwihctuibchhcyqtl.supabase.co";
const ASAAS = "https://api-sandbox.asaas.com";
const ADMIN = "4b9a0233-6b72-4573-aebd-d596c5b15e1b";
const INTRUSO = "11111111-2222-4333-8444-555555555555";
const LOTE = "22222222-3333-4444-8888-aaaaaaaaaaaa";
const CLIENTE = "cus_auditoria123";
const PAGAMENTO = "pay_auditoria123";
const REFERENCIA = "guia-acumulo-" + LOTE;
type Handler = (req: Request) => Response | Promise<Response>;
let handler: Handler | null = null;
let identidade = ADMIN;
let anterior = false;
let origemValida = true;
let referenciaValida = true;
let listagem: "unica" | "dupla" | "vazia" | "paginada" = "unica";
let alteracaoRemota: "nenhuma" | "customer" | "referencia" | "valor" |
  "modalidade" | "status" | "id" = "nenhuma";
let statusRemoto = "PENDING";
let corromperAck = false;
let chamadasAuth = 0;
let consultasLocal = 0;
let consultasListagem = 0;
let consultasDetalhe = 0;
let gravacoesObservacao = 0;
function reset() {
  identidade = ADMIN; anterior = false; origemValida = true;
  referenciaValida = true; listagem = "unica"; alteracaoRemota = "nenhuma";
  statusRemoto = "PENDING"; corromperAck = false;
  chamadasAuth = 0; consultasLocal = 0; consultasListagem = 0;
  consultasDetalhe = 0; gravacoesObservacao = 0;
}
function assert(ok: unknown, mensagem: string): asserts ok {
  if (!ok) throw Error("COB06_TESTE_" + mensagem);
}
function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status,
    headers: { "content-type": "application/json" } });
}
// Stub global instalado ANTES do import do cliente npm. Nao restaurar ate acabar
// o processo, porque os Deno.test sao executados DEPOIS da avaliacao do modulo.
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input
    : input instanceof URL ? input.href : input.url);
  const method = init?.method || (input instanceof Request ? input.method : "GET");
  if (url.origin === ASAAS) {
    assert(method === "GET", "ASAAS_NAO_GET");
    assert((init?.headers as Record<string, string>)?.access_token ===
      "token-ficticio-exclusivo-ci", "TOKEN_ASAAS_NAO_FICTICIO");
    assert(init?.redirect === "error", "REDIRECT_ASAAS_HABILITADO");
    if (url.pathname === "/v3/payments") {
      assert(url.searchParams.get("externalReference") === REFERENCIA &&
        url.searchParams.get("limit") === "2" &&
        url.searchParams.get("offset") === "0", "LISTAGEM_NAO_EXATA");
      consultasListagem++;
      const data = listagem === "vazia" ? [] : [{ id: PAGAMENTO }];
      if (listagem === "dupla") data.push({ id: "pay_outro_falso123" });
      return reply({ object: "list", data, hasMore: listagem === "paginada",
        totalCount: data.length + (listagem === "paginada" ? 1 : 0), offset: 0 });
    }
    assert(url.pathname === "/v3/payments/" + PAGAMENTO, "DETALHE_ENDPOINT");
    consultasDetalhe++;
    return reply({
      id: alteracaoRemota === "id" ? "pay_outro_falso123" : PAGAMENTO,
      externalReference: alteracaoRemota === "referencia"
        ? "guia-acumulo-outra-ref" : REFERENCIA,
      customer: alteracaoRemota === "customer" ? "cus_outro_123" : CLIENTE,
      value: alteracaoRemota === "valor" ? 5.01 : 5,
      billingType: alteracaoRemota === "modalidade" ? "CREDIT_CARD" : "PIX",
      status: alteracaoRemota === "status" ? "DESCONHECIDO" : statusRemoto,
    });
  }
  assert(url.origin === ROOT, "REDE_FORA_DA_CI_" + url.host);
  if (url.pathname === "/auth/v1/user") {
    assert(method === "GET", "AUTH_NAO_GET");
    chamadasAuth++;
    return reply({ id: identidade, aud: "authenticated", role: "authenticated",
      app_metadata: {}, user_metadata: {} });
  }
  assert(url.pathname.startsWith("/rest/v1/"), "CAMINHO_SUPABASE_INVALIDO");
  if (url.pathname === "/rest/v1/rpc/catalogo_asaas_conferir_conciliacao_acumulo") {
    assert(method === "POST", "RPC_CONCILIACAO_NAO_POST");
    consultasLocal++;
    return reply({ integridade_contabil_ok: origemValida,
      valor_fontes_centavos: origemValida ? 500 : 400 });
  }
  if (url.pathname === "/rest/v1/rpc/catalogo_asaas_registrar_observacao_acumulo") {
    assert(method === "POST", "RPC_OBSERVACAO_NAO_POST");
    gravacoesObservacao++;
    const args = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert(args.p_lote === LOTE && args.p_payment === PAGAMENTO &&
      args.p_customer === CLIENTE && args.p_referencia === REFERENCIA &&
      args.p_valor === 500 && args.p_status === statusRemoto,
      "PARAMETROS_OBSERVACAO_INVALIDOS");
    anterior = true;
    return reply({ ok: !corromperAck, lote_id: LOTE, payment_id: PAGAMENTO,
      status_observado: statusRemoto, ja_observado: false,
      pode_quitar: corromperAck, pode_liberar_motoboy: false });
  }
  assert(method === "GET", "ESCRITA_DIRETA_PROIBIDA");
  consultasLocal++;
  if (url.pathname === "/rest/v1/catalogo_asaas_acumulo_referencias") {
    return reply({ lote_id: LOTE, comercio_id: "comercio-ficticio",
      referencia: referenciaValida ? REFERENCIA : "referencia-invalida",
      valor_centavos: 500, estado: "reservado",
      payment_id: null, pode_emitir_pix: false });
  }
  if (url.pathname === "/rest/v1/catalogo_asaas_acumulo_observacoes") {
    return reply(anterior ? { lote_id: LOTE, payment_id: PAGAMENTO } : null);
  }
  if (url.pathname === "/rest/v1/catalogo_asaas_clientes") {
    return reply({ cliente_id: CLIENTE });
  }
  throw Error("COB06_TESTE_TABELA_NAO_PREVISTA");
};

Deno.env.set("SUPABASE_URL", ROOT);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "chave-ficticia-ci");
Deno.env.set("SUPABASE_SECRET_KEYS", "");
Deno.env.set("ASAAS_ENVIRONMENT", "sandbox");
Deno.env.set("ASAAS_API_KEY", "token-ficticio-exclusivo-ci");
Deno.env.set("ASAAS_COB06_STAGING_ADMIN_UID", ADMIN);
Deno.env.set("ASAAS_COB06_AUDITORIA_ISOLADA_ENABLED", "true");
Deno.env.set("ASAAS_COB06_GET_ADMIN_READONLY_ENABLED", "true");
Deno.env.set("ASAAS_COB06_OBSERVACAO_ADMIN_ENABLED", "true");
Deno.env.set("ASAAS_BILLING_ENABLED", "false");
Deno.env.set("ASAAS_PAYOUTS_ENABLED", "false");
const serveOriginal = Deno.serve;
try {
  Object.defineProperty(Deno, "serve", { configurable: true, writable: true,
    value: (fn: Handler) => { handler = fn;
      return { finished: Promise.resolve(), shutdown: () => {} }; } });
  await import("../catalogo-asaas-cob06-auditoria/index.ts");
} finally {
  Object.defineProperty(Deno, "serve",
    { configurable: true, writable: true, value: serveOriginal });
}
if (!handler) throw Error("COB06_TESTE_HANDLER_NAO_CAPTURADO");

async function chamar(acao: string, opts: { bearer?: string; lote?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.bearer !== "") headers.authorization = "Bearer " + (opts.bearer || "jwt-ficticio");
  const response = await handler!(new Request(
    ROOT + "/functions/v1/catalogo-asaas-cob06-auditoria", {
      method: "POST", headers,
      body: JSON.stringify({ acao, lote_id: opts.lote || LOTE }),
    }));
  return { http: response.status, body: await response.json() as Record<string, unknown> };
}
const acao = "observar_primeiro_acumulo_sandbox_admin";

Deno.test("COB06 Edge simulada: identidade admin, GET bancario duplo e observacao em HOLD", async () => {
  reset();
  const r = await chamar(acao);
  assert(r.http === 200 && r.body.success === true &&
    r.body.payment_id === PAGAMENTO && r.body.status_bancario_observado === "PENDING" &&
    r.body.hold_obrigatorio === true &&
    r.body.pode_emitir_pix === false && r.body.pode_quitar === false &&
    r.body.pode_estornar === false && r.body.pode_liberar_motoboy === false,
    "OPERACAO_NAO_MANTEVE_HOLD");
  assert(Number(chamadasAuth) === 1 && Number(consultasListagem) === 1 &&
    Number(consultasDetalhe) === 1 && Number(gravacoesObservacao) === 1,
    "CHAMADAS_INESPERADAS");
  const repetido = await chamar(acao);
  assert(repetido.http === 409 && Number(consultasListagem) === 1 &&
    Number(consultasDetalhe) === 1 && Number(gravacoesObservacao) === 1,
    "REPLAY_REPETIU_BANCO_OU_GRAVACAO");
});
Deno.test("COB06 Edge simulada: sessao ausente, intruso e lote adulterado nao acionam GET", async () => {
  reset();
  const semSessao = await chamar(acao, { bearer: "" });
  assert(semSessao.http === 401 && Number(chamadasAuth) === 0 &&
    Number(consultasLocal) === 0 && Number(consultasListagem) === 0, "SEM_SESSAO");
  reset();
  identidade = INTRUSO;
  const intruso = await chamar(acao);
  assert(intruso.http === 403 && Number(chamadasAuth) === 1 &&
    Number(consultasLocal) === 0 && Number(consultasListagem) === 0, "USUARIO_NAO_ADMIN");
  reset();
  const loteInvalido = await chamar(acao, { lote: "nao-e-uuid" });
  assert(loteInvalido.http === 400 && Number(chamadasAuth) === 1 &&
    Number(consultasLocal) === 0 && Number(consultasListagem) === 0, "LOTE_ALTERADO");
});
Deno.test("COB06 Edge simulada: preflight de origem ou referencia falha antes do banco", async () => {
  for (const falha of ["origem", "referencia"]) {
    reset();
    if (falha === "origem") origemValida = false;
    else referenciaValida = false;
    const r = await chamar(acao);
    assert(r.http === 409 && r.body.success === false &&
      Number(consultasListagem) === 0 && Number(consultasDetalhe) === 0 &&
      Number(gravacoesObservacao) === 0, "PRECHECK_" + falha);
  }
});
Deno.test("COB06 Edge simulada: nenhuma identidade, valor ou status remoto divergente registra", async () => {
  for (const diferenca of ["customer", "referencia", "valor", "modalidade",
    "status", "id"] as const) {
    reset();
    alteracaoRemota = diferenca;
    const r = await chamar(acao);
    assert(r.http === 503 && r.body.success === false &&
      r.body.hold_obrigatorio === true && r.body.pode_quitar === false &&
      Number(consultasListagem) === 1 && Number(consultasDetalhe) === 1 &&
      Number(gravacoesObservacao) === 0, "GET_DIVERGENTE_" + diferenca);
  }
});
Deno.test("COB06 Edge simulada: listagem duplicada, vazia ou paginada nao faz GET de ID", async () => {
  for (const modo of ["dupla", "vazia", "paginada"] as const) {
    reset();
    listagem = modo;
    const r = await chamar(acao);
    assert(r.http === 503 && r.body.success === false &&
      Number(consultasListagem) === 1 && Number(consultasDetalhe) === 0 &&
      Number(gravacoesObservacao) === 0, "LISTAGEM_" + modo);
  }
});
Deno.test("COB06 Edge simulada: status recebido ainda nao permite quitação ou motoboy", async () => {
  reset();
  statusRemoto = "RECEIVED";
  const r = await chamar(acao);
  assert(r.http === 200 && r.body.status_bancario_observado === "RECEIVED" &&
    r.body.pode_quitar === false && r.body.pode_estornar === false &&
    r.body.pode_liberar_motoboy === false && Number(gravacoesObservacao) === 1,
    "RECEIVED_NAO_PODE_LIQUIDAR");
});
Deno.test("COB06 Edge simulada: RPC que tenta habilitar quitação causa HOLD", async () => {
  reset();
  corromperAck = true;
  const r = await chamar(acao);
  assert(r.http === 503 && r.body.hold_obrigatorio === true &&
    r.body.pode_quitar === false && r.body.pode_liberar_motoboy === false &&
    Number(gravacoesObservacao) === 1, "ACK_BANCO_INSEGURO");
});
Deno.test("COB06 Edge simulada: mesmo com flags TRUE nenhuma acao de Pix ou saque existe", async () => {
  reset();
  for (const proibida of ["criar_cobranca", "emitir_pix", "transferir_saque",
    "registrar_estado_acumulo_sandbox_admin", "webhook"]) {
    const r = await chamar(proibida);
    assert(r.http === 403 && r.body.hold_obrigatorio === true &&
      r.body.pode_emitir_pix === false && r.body.pode_quitar === false,
      "ACAO_FATURAMENTO_" + proibida);
  }
  assert(Number(chamadasAuth) === 0 && Number(consultasLocal) === 0 &&
    Number(consultasListagem) === 0 && Number(gravacoesObservacao) === 0,
    "ACAO_PROIBIDA_ACIONOU_REDE");
});

const acaoAuditar = "auditar_duplicidade_acumulo_sandbox_admin";

Deno.test("COB06 auditoria somente GET: cobranca existente e status conferidos sem escrita", async () => {
  reset();
  const r = await chamar(acaoAuditar);
  assert(r.http === 200 && r.body.success === true &&
    r.body.lote_id === LOTE &&
    r.body.estado === "cobranca_existente_verificada" &&
    r.body.payment_id === PAGAMENTO && r.body.status_bancario === "PENDING" &&
    r.body.banco_alterado === false && r.body.pix_emitido === false &&
    r.body.hold_obrigatorio === true && r.body.pode_emitir_pix === false &&
    r.body.pode_quitar === false && r.body.pode_estornar === false &&
    r.body.pode_liberar_motoboy === false,
    "AUDITORIA_EXISTENTE_SEM_HOLD");
  assert(chamadasAuth === 1 && consultasListagem === 1 &&
    consultasDetalhe === 1 && gravacoesObservacao === 0,
    "AUDITORIA_EXISTENTE_GRAVOU");
});

Deno.test("COB06 auditoria somente GET: ausencia comprovada nao reserva, emite ou registra", async () => {
  reset();
  listagem = "vazia";
  const r = await chamar(acaoAuditar);
  assert(r.http === 200 && r.body.success === true &&
    r.body.estado === "nenhuma_cobranca_localizada" &&
    r.body.payment_id === null && r.body.status_bancario === null &&
    r.body.hold_obrigatorio === true && r.body.pode_emitir_pix === false &&
    r.body.pode_quitar === false && r.body.pode_liberar_motoboy === false,
    "GET_NEGATIVO_NAO_E_AUTORIZACAO");
  assert(consultasListagem === 1 && consultasDetalhe === 0 &&
    gravacoesObservacao === 0,
    "GET_NEGATIVO_TENTOU_GRAVAR");
});

Deno.test("COB06 auditoria somente GET: duplicidade, paginacao e divergencia nunca autorizam", async () => {
  for (const modo of ["dupla", "paginada"] as const) {
    reset();
    listagem = modo;
    const r = await chamar(acaoAuditar);
    assert(r.http === 503 && r.body.success === false &&
      r.body.hold_obrigatorio === true && r.body.pode_emitir_pix === false &&
      consultasListagem === 1 && consultasDetalhe === 0 &&
      gravacoesObservacao === 0,
      "GET_INCONCLUSIVO_" + modo);
  }
  for (const alteracao of ["customer", "referencia", "valor", "modalidade", "status", "id"] as const) {
    reset();
    alteracaoRemota = alteracao;
    const r = await chamar(acaoAuditar);
    assert(r.http === 503 && r.body.success === false &&
      r.body.hold_obrigatorio === true && r.body.pode_quitar === false &&
      consultasListagem === 1 && consultasDetalhe === 1 &&
      gravacoesObservacao === 0,
      "GET_DIVERGENTE_" + alteracao);
  }
});

Deno.test("COB06 auditoria somente GET: admin e origem do banco obrigatorios", async () => {
  reset();
  const semSessao = await chamar(acaoAuditar, { bearer: "" });
  assert(semSessao.http === 401 && consultasLocal === 0 &&
    consultasListagem === 0 && gravacoesObservacao === 0,
    "AUDITORIA_SEM_SESSAO");
  reset();
  identidade = INTRUSO;
  const intruso = await chamar(acaoAuditar);
  assert(intruso.http === 403 && consultasLocal === 0 &&
    consultasListagem === 0 && gravacoesObservacao === 0,
    "AUDITORIA_INTRUSO");
  reset();
  origemValida = false;
  const divergente = await chamar(acaoAuditar);
  assert(divergente.http === 409 && consultasListagem === 0 &&
    gravacoesObservacao === 0,
    "AUDITORIA_ORIGEM_DIVERGENTE");
  reset();
  referenciaValida = false;
  const referencia = await chamar(acaoAuditar);
  assert(referencia.http === 409 && consultasListagem === 0 &&
    gravacoesObservacao === 0,
    "AUDITORIA_REFERENCIA_DIVERGENTE");
});

Deno.test("COB06 auditoria somente GET: ja observado nao cria segunda gravacao", async () => {
  reset();
  anterior = true;
  const r = await chamar(acaoAuditar);
  assert(r.http === 200 && r.body.hold_obrigatorio === true &&
    r.body.pode_emitir_pix === false &&
    consultasListagem === 1 && consultasDetalhe === 1 &&
    gravacoesObservacao === 0,
    "AUDITORIA_REPETIDA_NAO_GRAVA");
});
