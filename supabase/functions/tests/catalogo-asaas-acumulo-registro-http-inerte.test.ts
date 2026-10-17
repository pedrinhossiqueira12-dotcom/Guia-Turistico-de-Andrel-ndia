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
let falhaRegistroPorOrigem = false;
let quitacaoPosterior = false;
let quitacaoIncorreta = false;
let estadoQuitacao = "pago";
let getsBanco = 0;
let getsAsaas = 0;
let getsListaAsaas = 0;
let temObservacao = true;
let listaDuplicada = false;
let listaVazia = false;
let listaPaginada = false;
let respostaRemotaOutraRef = false;
let escritas = 0;
let chaveAnterior = "";
let eventoAnterior = 0;
let proximoEvento = 20;
let projecaoDivergente = false;
let permissaoInesperada = false;
const responder = (data: unknown, code = 200) => new Response(JSON.stringify(data), {
  status: code, headers: { "content-type": "application/json" },
});
function assert(ok: unknown, msg: string): asserts ok { if (!ok) throw Error(msg); }
function reiniciar() {
  usuario = ADMIN; status = "PENDING"; falhaPreflight = false; falhaRegistro = false;
  falhaRegistroPorOrigem = false; quitacaoPosterior = false; quitacaoIncorreta = false;
  estadoQuitacao = "pago";
  getsBanco = 0; getsAsaas = 0; getsListaAsaas = 0; escritas = 0;
  temObservacao = true; listaDuplicada = false; listaVazia = false;
  listaPaginada = false; respostaRemotaOutraRef = false;
  chaveAnterior = ""; eventoAnterior = 0; proximoEvento = 20;
  projecaoDivergente = false; permissaoInesperada = false;
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = init?.method || "GET";
  if (url.origin === ASAAS) {
    if (url.pathname === "/v3/payments") {
      assert(method === "GET" &&
        url.searchParams.get("externalReference") === REF &&
        url.searchParams.get("limit") === "2" &&
        url.searchParams.get("offset") === "0",
        "listagem usou parametros errados");
      assert((init?.headers as Record<string,string>)?.access_token === "ci-token-ficticio",
        "listagem sem token de servidor");
      getsListaAsaas++;
      const data = listaVazia ? [] : [{ id: PAYMENT }];
      if (listaDuplicada) data.push({ id: "pay_segundo_123456" });
      return responder({ object: "list", hasMore: listaPaginada,
        totalCount: data.length + (listaPaginada ? 1 : 0), offset: 0, data });
    }
    assert(method === "GET" && url.pathname === "/v3/payments/" + PAYMENT,
      "GET bancario saiu do endpoint fixo");
    assert((init?.headers as Record<string,string>)?.access_token === "ci-token-ficticio",
      "GET sem token de servidor");
    getsAsaas++;
    return responder({ id: PAYMENT, customer: CUSTOMER,
      externalReference: respostaRemotaOutraRef ? "referencia-invalida" : REF,
      value: 5, billingType: "PIX", status });
  }
  assert(url.origin === ROOT, "rede externa bloqueada: " + url.host);
  if (url.pathname === "/auth/v1/user")
    return responder({ id: usuario, aud: "authenticated", role: "authenticated",
      app_metadata: {}, user_metadata: {} });
  if (url.pathname.startsWith("/rest/v1/catalogo_asaas_acumulo_referencias") && method === "GET") {
    getsBanco++;
    return responder({ lote_id: LOTE, comercio_id: "asaas-cob02", referencia: REF,
      valor_centavos: 500, estado: "reservado", payment_id: null, pode_emitir_pix: false });
  }
  if (url.pathname.startsWith("/rest/v1/catalogo_asaas_acumulo_observacoes") && method === "GET") {
    getsBanco++;
    return responder(temObservacao ? { lote_id: LOTE, payment_id: PAYMENT, customer_id: CUSTOMER,
      referencia: REF, valor_centavos: 500, pode_quitar: false,
      pode_liberar_motoboy: false } : null);
  }
  if (url.pathname.startsWith("/rest/v1/catalogo_asaas_acumulo_quitacoes_isoladas") && method === "GET") {
    getsBanco++;
    return responder(quitacaoPosterior
      ? { lote_id: LOTE, payment_id: quitacaoIncorreta ? "pay_outro_comprovante" : PAYMENT,
        valor_centavos: 500, estado: estadoQuitacao }
      : null);
  }
  if (url.pathname.startsWith("/rest/v1/catalogo_asaas_acumulo_lotes") && method === "GET") {
    getsBanco++;
    return responder({ id: LOTE, comercio_id: "asaas-cob02",
      total_centavos: 500, estado: estadoQuitacao });
  }
  if (url.pathname.startsWith("/rest/v1/catalogo_asaas_clientes") && method === "GET") {
    getsBanco++;
    return responder({ cliente_id: CUSTOMER });
  }
  if (url.pathname === "/rest/v1/rpc/catalogo_asaas_conferir_conciliacao_acumulo" && method === "POST") {
    getsBanco++;
    return responder({ integridade_contabil_ok: !falhaPreflight, valor_fontes_centavos: 500 });
  }
  if (url.pathname === "/rest/v1/rpc/catalogo_asaas_apurar_estados_acumulo_inerte" && method === "POST") {
    getsBanco++;
    return responder({ ok: true, lote_id: LOTE, valor_centavos: 500,
      integridade_contabil_ok: !falhaPreflight, identidade_local_ok: true,
      exige_revisao: status === "REFUNDED",
      classificacao: status === "REFUNDED" ? "reversao_ou_disputa_irreversivel_sem_analise"
        : "recebimento_observado_pendente_de_prova_e_conciliacao",
      prova_bancaria_autonoma: false,
      pode_emitir_pix: false, pode_quitar: permissaoInesperada,
      pode_estornar: false, pode_liberar_motoboy: false });
  }
  if (url.pathname === "/rest/v1/rpc/catalogo_asaas_projetar_baixa_acumulo_inerte" && method === "POST") {
    getsBanco++;
    return responder({ ok: true, lote_id: LOTE, valor_centavos: 500,
      plataforma_centavos: 357, logistica_centavos: 143,
      quantidade_competencias: 2, pedidos: 2, parcelas: 4,
      parcelas_sem_credito_seguro: 0, parcelas_ja_liberadas: 0,
      projecao_contabil_consistente: !falhaPreflight,
      helper_legado_incompativel_sem_cobranca_individual: true,
      origens: [
        { fechamento_id: "11111111-2222-4333-8444-555555555551",
          competencia: "2040-03-01", total_centavos: 100,
          plataforma_centavos: 71, logistica_centavos: 29,
          pedidos: 1, parcelas: 2, parcelas_sem_credito_seguro: 0,
          parcelas_ja_liberadas: 0 },
        { fechamento_id: "11111111-2222-4333-8444-555555555552",
          competencia: "2040-04-01", total_centavos: projecaoDivergente ? 401 : 400,
          plataforma_centavos: 286, logistica_centavos: 114,
          pedidos: 1, parcelas: 2, parcelas_sem_credito_seguro: 0,
          parcelas_ja_liberadas: 0 },
      ], pode_emitir_pix: false, pode_quitar: false,
      pode_estornar: false, pode_liberar_motoboy: false });
  }
  if (url.pathname === "/rest/v1/rpc/catalogo_asaas_registrar_observacao_acumulo" && method === "POST") {
    escritas++;
    const args = JSON.parse(String(init?.body)) as Record<string,unknown>;
    assert(args.p_lote === LOTE && args.p_payment === PAYMENT &&
      args.p_customer === CUSTOMER && args.p_referencia === REF &&
      args.p_valor === 500 && args.p_status === status,
      "primeira observacao nao corresponde ao GET verificado");
    temObservacao = true;
    return responder({ ok: true, lote_id: LOTE, payment_id: PAYMENT,
      status_observado: status, ja_observado: false,
      pode_quitar: false, pode_liberar_motoboy: false });
  }
  if (url.pathname === "/rest/v1/rpc/catalogo_asaas_registrar_evento_acumulo_inerte" && method === "POST") {
    escritas++;
    const args = JSON.parse(String(init?.body)) as Record<string,unknown>;
    assert(args.p_lote === LOTE && args.p_payment === PAYMENT && args.p_estado === status,
      "RPC recebeu evento nao verificado");
    const chave = args.p_evento;
    assert(typeof chave === "string" && /^get-[0-9a-f]{64}$/.test(chave),
      "chave idempotente invalida");
    if (falhaRegistroPorOrigem)
      return responder({ ok: false, motivo: "origens_nao_conferidas",
        pode_quitar: false, pode_estornar: false, pode_liberar_motoboy: false });
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
Deno.env.set("ASAAS_COB06_BAIXA_AUDITORIA_ADMIN_ENABLED", "true");
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
Deno.test("COB06 HTTP: primeira observacao encontra ID no Asaas sem entrada bancaria do navegador", async () => {
  reiniciar();
  temObservacao = false;
  const resposta = await chamar("observar_primeiro_acumulo_sandbox_admin");
  assert(resposta.http === 200 && resposta.body.success === true &&
    resposta.body.payment_id === PAYMENT &&
    resposta.body.status_bancario_observado === "PENDING" &&
    resposta.body.hold_obrigatorio === true &&
    resposta.body.pode_emitir_pix === false &&
    resposta.body.pode_quitar === false &&
    resposta.body.pode_estornar === false &&
    resposta.body.pode_liberar_motoboy === false &&
    (resposta.body.registro as Record<string,unknown>)?.ja_observado === false &&
    getsListaAsaas === 1 && getsAsaas === 1 && escritas === 1,
    "primeira observacao nao conferiu identidade ou liberou dinheiro");
  const repetida = await chamar("observar_primeiro_acumulo_sandbox_admin");
  assert(repetida.http === 409 && getsListaAsaas === 1 &&
    getsAsaas === 1 && escritas === 1,
    "nova tentativa duplicou GET ou observacao ja existente");
});

Deno.test("COB06 HTTP: dupla referencia ou pagina omitida bloqueia primeira observacao", async () => {
  for (const tipo of ["duplicada", "paginada", "vazia", "outra-referencia"]) {
    reiniciar();
    temObservacao = false;
    listaDuplicada = tipo === "duplicada";
    listaPaginada = tipo === "paginada";
    listaVazia = tipo === "vazia";
    respostaRemotaOutraRef = tipo === "outra-referencia";
    const resposta = await chamar("observar_primeiro_acumulo_sandbox_admin");
    assert(resposta.http === 503 && resposta.body.success === false &&
      getsListaAsaas === 1 && escritas === 0 &&
      (tipo === "outra-referencia" ? getsAsaas === 1 : getsAsaas === 0),
      "nao recusou primeira observacao suspeita: " + tipo);
  }
  reiniciar();
  temObservacao = false; falhaPreflight = true;
  const inconsistente = await chamar("observar_primeiro_acumulo_sandbox_admin");
  assert(inconsistente.http === 409 &&
    getsListaAsaas === 0 && getsAsaas === 0 && escritas === 0,
    "preflight inconsistente realizou GET externo");
  reiniciar();
  usuario = OUTRO; temObservacao = false;
  const naoAdmin = await chamar("observar_primeiro_acumulo_sandbox_admin");
  assert(naoAdmin.http === 403 && getsBanco === 0 &&
    getsListaAsaas === 0 && escritas === 0,
    "nao-admin acessou prova bancaria");
});

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
Deno.test("COB06 HTTP: estorno APOS quitacao usa recibo vinculado e nunca libera dinheiro", async () => {
  reiniciar();
  falhaPreflight = true;
  quitacaoPosterior = true;
  status = "REFUNDED";
  const primeiro = await chamar("registrar_estado_acumulo_sandbox_admin");
  const registrado = primeiro.body.registro as Record<string,unknown>;
  assert(primeiro.http === 200 && primeiro.body.success === true &&
    primeiro.body.integridade_contabil_ok === false &&
    primeiro.body.recibo_local_pos_quitacao === true &&
    registrado?.ja_observado === false && registrado?.evento_id === 20,
    "estorno posterior nao foi observado sem falsa aprovacao de preflight");
  assert(getsAsaas === 1 && escritas === 1 && getsBanco === 6,
    "nao conferiu recibo e GET antes do evento");
  const repetido = await chamar("registrar_estado_acumulo_sandbox_admin");
  assert(repetido.http === 200 &&
    (repetido.body.registro as Record<string,unknown>)?.ja_observado === true &&
    (repetido.body.registro as Record<string,unknown>)?.evento_id === 20,
    "repeticao de estorno duplicou evento");
  for (const resposta of [primeiro,repetido]) {
    assert(resposta.body.hold_obrigatorio === true &&
      resposta.body.pode_emitir_pix === false &&
      resposta.body.pode_quitar === false &&
      resposta.body.pode_estornar === false &&
      resposta.body.pode_liberar_motoboy === false,
      "estorno posterior abriu rota de dinheiro");
  }
  estadoQuitacao = "estornado";
  status = "RECEIVED";
  const tardio = await chamar("conferir_acumulo_sandbox_admin");
  assert(tardio.http === 200 && tardio.body.hold_obrigatorio === true &&
    tardio.body.integridade_contabil_ok === false &&
    tardio.body.recibo_local_pos_quitacao === true &&
    tardio.body.registro === null && Number(escritas) === 2,
    "RECEIVED tardio reativou saldo ou gerou escrita no modo leitura");
});
Deno.test("COB06 HTTP: estados intermediarios de disputa sao observados em HOLD", async () => {
  for (const adverso of ["CHARGEBACK_DISPUTE", "AWAITING_CHARGEBACK_REVERSAL"]) {
    reiniciar();
    falhaPreflight = true;
    quitacaoPosterior = true;
    status = adverso;
    const resposta = await chamar("registrar_estado_acumulo_sandbox_admin");
    const registro = resposta.body.registro as Record<string,unknown>;
    assert(resposta.http === 200 &&
      resposta.body.status_bancario_observado === adverso &&
      resposta.body.integridade_contabil_ok === false &&
      resposta.body.recibo_local_pos_quitacao === true &&
      resposta.body.pode_emitir_pix === false &&
      resposta.body.pode_quitar === false &&
      resposta.body.pode_estornar === false &&
      resposta.body.pode_liberar_motoboy === false &&
      resposta.body.hold_obrigatorio === true &&
      registro?.evento_id === 20 &&
      getsAsaas === 1 && escritas === 1,
      "estado intermediario da disputa nao permaneceu em HOLD: " + adverso);
  }
});
Deno.test("COB06 HTTP: recibo falso ou ausencia de recibo nao atravessa preflight", async () => {
  reiniciar();
  falhaPreflight = true;
  const semRecibo = await chamar("registrar_estado_acumulo_sandbox_admin");
  assert(semRecibo.http === 409 && getsAsaas === 0 && escritas === 0,
    "preflight falho sem recibo chegou ao banco Asaas");
  reiniciar();
  falhaPreflight = true; quitacaoPosterior = true; quitacaoIncorreta = true;
  const trocado = await chamar("registrar_estado_acumulo_sandbox_admin");
  assert(trocado.http === 409 && getsAsaas === 0 && escritas === 0,
    "recibo vinculado a outro pagamento foi aceito");
  reiniciar();
  falhaPreflight = true; quitacaoPosterior = true; estadoQuitacao = "preparado";
  const naoPago = await chamar("registrar_estado_acumulo_sandbox_admin");
  assert(naoPago.http === 409 && getsAsaas === 0 && escritas === 0,
    "lote ainda aberto burlou preflight via recibo");
});
Deno.test("COB06 HTTP: apos quitacao, diario SQL recusa origem alterada sem baixa", async () => {
  reiniciar();
  falhaPreflight = true; quitacaoPosterior = true;
  falhaRegistroPorOrigem = true; status = "REFUNDED";
  const falhou = await chamar("registrar_estado_acumulo_sandbox_admin");
  assert(falhou.http >= 400 && falhou.body.success !== true &&
    getsAsaas === 1 && escritas === 1,
    "origem inconsistente foi aceita no diario posquitacao");
});

Deno.test("COB06 auditoria baixa HTTP: R$1 + R$4 e 4 parcelas somente GET/HOLD", async () => {
  reiniciar(); status = "RECEIVED";
  const r = await chamar("auditar_baixa_multicompetencia_sandbox_admin");
  const competencias = r.body.competencias as Array<Record<string, unknown>>;
  assert(r.http === 200 && r.body.success === true &&
    r.body.valor_centavos === 500 && r.body.quantidade_competencias === 2 &&
    r.body.plataforma_centavos === 357 && r.body.logistica_centavos === 143 &&
    r.body.status_bancario_verificado === "RECEIVED" &&
    competencias?.length === 2 && competencias[0].competencia === "2040-03-01" &&
    competencias[0].total_centavos === 100 &&
    competencias[1].competencia === "2040-04-01" &&
    competencias[1].total_centavos === 400 &&
    r.body.prova_bancaria_autonoma === false && r.body.hold_obrigatorio === true &&
    r.body.pode_quitar === false && r.body.pode_estornar === false &&
    r.body.pode_liberar_motoboy === false && r.body.pode_emitir_pix === false &&
    getsAsaas === 1 && getsListaAsaas === 0 && escritas === 0,
    "auditoria nao reconciliou competencias ou liberou dinheiro");
});

Deno.test("COB06 auditoria baixa HTTP: estorno remoto nao altera livros", async () => {
  reiniciar(); status = "REFUNDED";
  const r = await chamar("auditar_baixa_multicompetencia_sandbox_admin");
  assert(r.http === 200 && r.body.status_bancario_verificado === "REFUNDED" &&
    r.body.exige_revisao === true && r.body.pode_estornar === false &&
    r.body.pode_quitar === false && r.body.hold_obrigatorio === true &&
    escritas === 0, "GET de estorno liberou mutacao contábil");
});

Deno.test("COB06 auditoria baixa HTTP: divergencia, permissao ou intruso falham fechados", async () => {
  reiniciar(); projecaoDivergente = true;
  const total = await chamar("auditar_baixa_multicompetencia_sandbox_admin");
  assert(total.http === 409 && total.body.success === false &&
    getsAsaas === 1 && escritas === 0, "origens divergentes aceitas");
  reiniciar(); permissaoInesperada = true;
  const permissao = await chamar("auditar_baixa_multicompetencia_sandbox_admin");
  assert(permissao.http === 409 && escritas === 0,
    "RPC com permissao de pagamento aceita");
  reiniciar(); temObservacao = false;
  const semObservacao = await chamar("auditar_baixa_multicompetencia_sandbox_admin");
  assert(semObservacao.http === 409 && Number(getsAsaas) === 0 && Number(escritas) === 0,
    "GET realizado sem pagamento associado ao lote");
  reiniciar(); usuario = OUTRO;
  const intruso = await chamar("auditar_baixa_multicompetencia_sandbox_admin");
  assert(intruso.http === 403 && getsAsaas === 0 && getsBanco === 0 && escritas === 0,
    "nao-admin acessou livro ou provedor");
});

// Cada arquivo de teste roda em worker isolado; nenhuma chamada de rede real ocorreu.
void originalFetch;
