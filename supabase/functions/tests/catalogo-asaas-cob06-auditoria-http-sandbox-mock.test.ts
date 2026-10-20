// COB-06 / PR39: Edge isolada com flags TRUE SOMENTE neste processo de CI.
// Provedor Asaas, Supabase, sessao e pagamentos sao 100% ficticios.
// NUNCA executar este teste contra banco, JWT ou token de um ambiente real.
// URL STAGING interceptada integralmente pelo fetch fake; NENHUMA rede autorizada.
const ROOT = "https://jbttwihctuibchhcyqtl.supabase.co";
const ASAAS = "https://api-sandbox.asaas.com";
const ADMIN = "4b9a0233-6b72-4573-aebd-d596c5b15e1b";
const INTRUSO = "11111111-2222-4333-8444-555555555555";
const LOTE = "583d761a-ecb9-49be-b484-e43f6183971e";
const OUTRO_LOTE = "22222222-3333-4444-8888-aaaaaaaaaaaa";
const CLIENTE = "cus_auditoria123";
const PAGAMENTO = "pay_auditoria123";
const REFERENCIA = "guia-acumulo-" + LOTE;
const OPERACAO = "522f6153-4651-484b-a374-edbb4e1a90f3";
type Handler = (req: Request) => Response | Promise<Response>;
let handler: Handler | null = null;
let identidade = ADMIN;
let origemValida = true;
let referenciaValida = true;
let listagem: "unica" | "dupla" | "vazia" | "paginada" = "unica";
let alteracaoRemota: "nenhuma" | "customer" | "referencia" | "valor" |
  "modalidade" | "status" | "id" = "nenhuma";
let statusRemoto = "PENDING";
let permissaoContabilInsegura = false;
let loteIncorreto: "nenhum" | "comercio" | "corte" | "valor" | "estado" = "nenhum";
let vinculoInvalido: "nenhum" | "sem_reserva" | "operacao" | "cliente" |
  "referencia" | "valor" | "post" | "hold" | "rpc_indisponivel" = "nenhum";
let chamadasAuth = 0;
let consultasLocal = 0;
let consultasListagem = 0;
let consultasDetalhe = 0;
let gravacoesObservacao = 0;
let gravacoesEvidenciaGet = 0;
let iniciosGet = 0;
let inicioJaGravado = false;
let consultaEstadoQa: "historico" | "com_prova" | "inconsistente" | "rpc_ausente" = "historico";
let consultasEstadoQa = 0;
let falhaInicio: "nenhuma" | "rpc_ausente" | "recusa" | "lote" | "permissao" = "nenhuma";
let corpoDaUltimaListagem = "";
let falhaPersistencia: "nenhuma" | "rpc_ausente" | "recusa" |
  "permissao" | "lote_divergente" | "replay" = "nenhuma";
function reset() {
  identidade = ADMIN; origemValida = true;
  referenciaValida = true; listagem = "unica"; alteracaoRemota = "nenhuma";
  statusRemoto = "PENDING"; permissaoContabilInsegura = false; loteIncorreto = "nenhum";
  vinculoInvalido = "nenhum";
  chamadasAuth = 0; consultasLocal = 0; consultasListagem = 0;
  consultasDetalhe = 0; gravacoesObservacao = 0;
  gravacoesEvidenciaGet = 0; falhaPersistencia = "nenhuma";
  iniciosGet = 0; inicioJaGravado = false; falhaInicio = "nenhuma";
  consultaEstadoQa = "historico"; consultasEstadoQa = 0;
  corpoDaUltimaListagem = "";
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
    assert(iniciosGet >= 1 && inicioJaGravado, "ASAAS_GET_ANTES_DA_MARCACAO");
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
      const bruto = { object: "list", data, hasMore: listagem === "paginada",
        totalCount: data.length + (listagem === "paginada" ? 1 : 0), offset: 0 };
      corpoDaUltimaListagem = JSON.stringify(bruto);
      return new Response(corpoDaUltimaListagem, { status: 200,
        headers: { "content-type": "application/json" } });
    }
    assert(url.pathname === "/v3/payments/" + PAGAMENTO, "DETALHE_ENDPOINT");
    consultasDetalhe++;
    return reply({
      id: alteracaoRemota === "id" ? "pay_outro_falso123" : PAGAMENTO,
      externalReference: alteracaoRemota === "referencia"
        ? "guia-acumulo-outra-ref" : REFERENCIA,
      customer: alteracaoRemota === "customer" ? "cus_outro_123" : CLIENTE,
      value: alteracaoRemota === "valor" ? 5.61 : 5.6,
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
      valor_fontes_centavos: origemValida ? 560 : 400,
      pode_emitir_pix: permissaoContabilInsegura,
      pode_quitar: false, pode_liberar_motoboy: false });
  }
  if (url.pathname === "/rest/v1/rpc/catalogo_asaas_conferir_vinculo_tentativa_qa_sem_pix") {
    assert(method === "POST", "RPC_VINCULO_NAO_POST_HTTP_INTERNO");
    consultasLocal++;
    if (vinculoInvalido === "rpc_indisponivel") {
      return reply({ code: "PGRST202", message: "mock: RPC nao instalada" }, 404);
    }
    return reply({ ok: vinculoInvalido !== "sem_reserva", lote_id: LOTE,
      operacao_id: vinculoInvalido === "operacao" ? OUTRO_LOTE : OPERACAO,
      comercio_id: "asaas-cob02",
      referencia: vinculoInvalido === "referencia" ? "outra-referencia" : REFERENCIA,
      cliente_id: vinculoInvalido === "cliente" ? "cus_outro_123" : CLIENTE,
      valor_centavos: vinculoInvalido === "valor" ? 561 : 560,
      reservada_em: "2026-10-19T17:38:01.446324+00:00",
      post_executado: vinculoInvalido === "post", pode_emitir_pix: false,
      pode_quitar: false, pode_liberar_motoboy: false,
      hold_obrigatorio: vinculoInvalido !== "hold" });
  }
  if (url.pathname === "/rest/v1/rpc/catalogo_asaas_consultar_estado_get_qa_sem_pix") {
    assert(method === "POST", "ESTADO_QA_RPC_NAO_POST_INTERNO");
    const payload = JSON.parse(String(init?.body || "")) as Record<string, unknown>;
    assert(payload.p_lote === LOTE, "ESTADO_QA_OUTRO_LOTE");
    consultasEstadoQa++;
    if (consultaEstadoQa === "rpc_ausente")
      return reply({ code: "PGRST202", message: "RPC ausente no mock" }, 404);
    const historico = consultaEstadoQa === "historico";
    const comProva = consultaEstadoQa === "com_prova";
    return reply({
      ok: true, lote_id: LOTE,
      estado: historico ? "get_historico_sem_prova" :
        comProva ? "evidencia_local_registrada" : "sem_get_registrado",
      get_iniciado: comProva, evidencia_get_persistida: comProva,
      get_historico_sem_prova: historico,
      prova_get_externa: false, pode_consultar_asaas: false,
      pode_repetir_get: false, post_executado: false,
      pode_emitir_pix: consultaEstadoQa === "inconsistente",
      pode_quitar: false, pode_estornar: false,
      pode_liberar_motoboy: false, hold_obrigatorio: true,
    });
  }
  if (url.pathname === "/rest/v1/rpc/catalogo_asaas_iniciar_get_unico_qa_sem_pix") {
    assert(method === "POST", "INICIO_GET_RPC_NAO_POST_INTERNO");
    const payload = JSON.parse(String(init?.body || "")) as Record<string, unknown>;
    assert(payload.p_lote === LOTE, "MARCACAO_PARA_LOTE_INCORRETO");
    iniciosGet++;
    if (falhaInicio === "rpc_ausente") {
      return reply({ code: "PGRST202", message: "RPC mock ausente" }, 404);
    }
    if (inicioJaGravado || falhaInicio === "recusa") {
      return reply({ ok: false, lote_id: LOTE, motivo: "get_ja_iniciado",
        nova_consulta: false, pode_consultar_asaas: false,
        pode_emitir_pix: false, hold_obrigatorio: true });
    }
    inicioJaGravado = true;
    return reply({
      ok: true, lote_id: falhaInicio === "lote" ? OUTRO_LOTE : LOTE,
      operacao_id: OPERACAO, referencia: REFERENCIA,
      nova_consulta: true, pode_consultar_asaas: true,
      pode_repetir_get: false,
      pode_emitir_pix: falhaInicio === "permissao",
      pode_quitar: false, pode_estornar: false, pode_liberar_motoboy: false,
      hold_obrigatorio: true,
    });
  }
  if (url.pathname === "/rest/v1/rpc/catalogo_asaas_registrar_get_negativo_qa_sem_pix") {
    gravacoesEvidenciaGet++;
    assert(method === "POST", "EVIDENCIA_GET_RPC_NAO_POST_INTERNO");
    const payload = JSON.parse(String(init?.body || "")) as Record<string, unknown>;
    assert(payload.p_lote === LOTE && payload.p_http_status === 200 &&
      payload.p_total_count === 0 && payload.p_itens_count === 0 &&
      payload.p_has_more === false &&
      typeof payload.p_resposta_sha256 === "string" &&
      /^[0-9a-f]{64}$/.test(payload.p_resposta_sha256), "METADADOS_NAO_VINDOS_DO_GET");
    const textoBytes = new TextEncoder().encode(corpoDaUltimaListagem);
    const entradaDigest = new Uint8Array(textoBytes.byteLength);
    entradaDigest.set(textoBytes);
    const digest = await crypto.subtle.digest("SHA-256", entradaDigest.buffer);
    const esperadoSha = Array.from(new Uint8Array(digest),
      (n) => n.toString(16).padStart(2, "0")).join("");
    assert(payload.p_resposta_sha256 === esperadoSha,
      "HASH_NAO_CORRESPONDE_AOS_BYTES_GET");
    if (falhaPersistencia === "rpc_ausente") {
      return reply({ code: "PGRST202", message: "RPC ausente no mock" }, 404);
    }
    return reply({
      ok: falhaPersistencia !== "recusa",
      lote_id: falhaPersistencia === "lote_divergente" ? OUTRO_LOTE : LOTE,
      nova_evidencia: falhaPersistencia !== "replay",
      evidencia_get_persistida: true,
      prova_get_externa: false,
      pode_emitir_pix: falhaPersistencia === "permissao",
      pode_quitar: false, pode_estornar: false, pode_liberar_motoboy: false,
      hold_obrigatorio: true,
    });
  }
  if (url.pathname === "/rest/v1/rpc/catalogo_asaas_registrar_observacao_acumulo") {
    gravacoesObservacao++;
    throw Error("COB06_TESTE_GRAVACAO_PROIBIDA");
  }
  assert(method === "GET", "ESCRITA_DIRETA_PROIBIDA");
  consultasLocal++;
  if (url.pathname === "/rest/v1/catalogo_asaas_acumulo_lotes") {
    return reply({
      id: LOTE,
      comercio_id: loteIncorreto === "comercio" ? "outro-comercio" : "asaas-cob02",
      competencia_corte: loteIncorreto === "corte" ? "2027-04-01" : "2027-03-01",
      total_centavos: loteIncorreto === "valor" ? 600 : 560,
      estado: loteIncorreto === "estado" ? "cancelado" : "preparado",
    });
  }
  if (url.pathname === "/rest/v1/catalogo_asaas_acumulo_referencias") {
    return reply({ lote_id: LOTE, operacao_id: OPERACAO, comercio_id: "asaas-cob02",
      referencia: referenciaValida ? REFERENCIA : "referencia-invalida",
      valor_centavos: 560, estado: "reservado",
      payment_id: null, pode_emitir_pix: false });
  }
  if (url.pathname === "/rest/v1/catalogo_asaas_acumulo_observacoes") {
    throw Error("COB06_TESTE_LEITURA_OBSERVACAO_DESNECESSARIA");
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
// SOMENTE CI com Supabase e Asaas interceptados. No STAGING continua OFF.
Deno.env.set("ASAAS_COB06_GET_PERSISTENCIA_QA_ENABLED", "true");
// Intencionalmente true em CI: nao pode criar rota de observacao.
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

Deno.test("COB06 GET-only: observacao administrativa e proibida ate com flags ativas", async () => {
  reset();
  const r = await chamar(acao);
  assert(r.http === 403 && r.body.success === false &&
    r.body.hold_obrigatorio === true && r.body.pode_emitir_pix === false &&
    r.body.pode_quitar === false && r.body.pode_estornar === false &&
    r.body.pode_liberar_motoboy === false, "OBSERVACAO_NAO_PROIBIDA");
  assert(chamadasAuth === 0 && consultasLocal === 0 &&
    consultasListagem === 0 && consultasDetalhe === 0 &&
    gravacoesObservacao === 0, "OBSERVACAO_ACIONOU_REDE");
});

Deno.test("COB06 GET-only: nenhum comando financeiro, webhook ou escrita tem rota", async () => {
  reset();
  for (const proibida of ["criar_cobranca", "emitir_pix", "transferir_saque",
    "registrar_estado_acumulo_sandbox_admin", "webhook"]) {
    const r = await chamar(proibida);
    assert(r.http === 403 && r.body.hold_obrigatorio === true &&
      r.body.pode_emitir_pix === false && r.body.pode_quitar === false,
      "ACAO_FINANCEIRA_" + proibida);
  }
  assert(chamadasAuth === 0 && consultasLocal === 0 &&
    consultasListagem === 0 && gravacoesObservacao === 0,
    "COMANDO_FINANCEIRO_ACIONOU_REDE");
});


const acaoEstado = "consultar_estado_get_qa_sem_pix_admin";

Deno.test("COB06 estado QA: historico sem comprovante, sem Asaas e sem repeticao", async () => {
  reset();
  const r = await chamar(acaoEstado);
  assert(r.http === 200 && r.body.success === true &&
    r.body.estado === "get_historico_sem_prova" &&
    r.body.get_historico_sem_prova === true &&
    r.body.get_iniciado === false && r.body.evidencia_get_persistida === false &&
    r.body.asaas_consultado === false && r.body.banco_consultado === true &&
    r.body.pode_consultar_asaas === false &&
    r.body.pode_repetir_get === false && r.body.pode_emitir_pix === false &&
    r.body.pode_quitar === false && r.body.pode_estornar === false &&
    r.body.pode_liberar_motoboy === false && r.body.hold_obrigatorio === true,
    "GET_HISTORICO_NAO_PODE_SER_REFEITO");
  assert(consultasEstadoQa === 1 && chamadasAuth === 1 &&
    iniciosGet === 0 && consultasListagem === 0 && consultasDetalhe === 0 &&
    gravacoesEvidenciaGet === 0 && gravacoesObservacao === 0,
    "ESTADO_QA_EXECUTOU_OPERACAO_BANCARIA");
});

Deno.test("COB06 estado QA: evidencia local registrada nao habilita POST", async () => {
  reset();
  consultaEstadoQa = "com_prova";
  const r = await chamar(acaoEstado);
  assert(r.http === 200 && r.body.estado === "evidencia_local_registrada" &&
    r.body.evidencia_get_persistida === true && r.body.get_iniciado === true &&
    r.body.pode_emitir_pix === false && r.body.pode_quitar === false &&
    r.body.pode_repetir_get === false && r.body.asaas_consultado === false,
    "EVIDENCIA_LOCAL_LIBEROU_COBRANCA");
  assert(iniciosGet === 0 && consultasListagem === 0 &&
    gravacoesEvidenciaGet === 0, "CONSULTA_DE_ESTADO_REFEZ_GET");
});

Deno.test("COB06 estado QA: sessao alheia e falhas nao alcancam banco ou Asaas", async () => {
  reset(); identidade = INTRUSO;
  const negado = await chamar(acaoEstado);
  assert(negado.http === 403 && consultasEstadoQa === 0 &&
    iniciosGet === 0 && consultasListagem === 0,
    "STATUS_ADM_ACESSIVEL_A_INTRUSO");
  reset(); consultaEstadoQa = "rpc_ausente";
  const ausente = await chamar(acaoEstado);
  assert(ausente.http === 503 && consultasEstadoQa === 1 &&
    consultasListagem === 0 && gravacoesEvidenciaGet === 0 &&
    ausente.body.hold_obrigatorio === true, "RPC_AUSENTE_NAO_FALHOU_FECHADO");
  reset(); consultaEstadoQa = "inconsistente";
  const inconsistente = await chamar(acaoEstado);
  assert(inconsistente.http === 409 &&
    inconsistente.body.pode_emitir_pix === false &&
    consultasListagem === 0, "RESPOSTA_SQL_INSEGURA_ACEITA");
});

const acaoAuditar = "auditar_duplicidade_acumulo_sandbox_admin";

Deno.test("COB06: POST acima de 8 KiB nao le payload inteiro nem consulta backend", async () => {
  for (const header of [null, "9500", "100"]) {
    reset();
    const headers: Record<string, string> = {
      authorization: "Bearer jwt-ficticio",
      "content-type": "application/json",
    };
    if (header !== null) headers["content-length"] = header;
    const req = new Request(ROOT + "/functions/v1/catalogo-asaas-cob06-auditoria", {
      method: "POST", headers,
      body: JSON.stringify({
        acao: acaoAuditar, lote_id: LOTE, preenchimento: "x".repeat(9000),
      }),
    });
    const res = await handler!(req);
    const body = await res.json() as Record<string, unknown>;
    assert(res.status === 413 && body.hold_obrigatorio === true &&
      body.pode_emitir_pix === false && body.pode_quitar === false &&
      chamadasAuth === 0 && consultasLocal === 0 && iniciosGet === 0 &&
      consultasListagem === 0 && consultasDetalhe === 0 &&
      gravacoesEvidenciaGet === 0, "POST_GRANDE_ANTES_DA_AUTORIZACAO_" + header);
  }
});

Deno.test("COB06: Content-Length curto divergente recusa antes do banco", async () => {
  reset();
  const req = new Request(ROOT + "/functions/v1/catalogo-asaas-cob06-auditoria", {
    method: "POST", headers: {
      "content-type": "application/json", "content-length": "5",
      authorization: "Bearer jwt-ficticio",
    },
    body: JSON.stringify({ acao: acaoAuditar, lote_id: LOTE }),
  });
  const res = await handler!(req);
  assert(res.status === 400 && chamadasAuth === 0 && consultasLocal === 0 &&
    iniciosGet === 0 && consultasListagem === 0,
    "CONTENT_LENGTH_DIVERGENTE_ACIONOU_OPERACAO");
});

Deno.test("COB06 GET unico: cobranca encontrada nao dispara segundo GET", async () => {
  reset();
  const r = await chamar(acaoAuditar);
  assert(r.http === 503 && r.body.success === false &&
    r.body.hold_obrigatorio === true && r.body.pode_emitir_pix === false &&
    r.body.pode_quitar === false && r.body.pode_estornar === false &&
    r.body.pode_liberar_motoboy === false,
    "COBRANCA_EXISTENTE_NAO_FALHOU_FECHADO");
  assert(chamadasAuth === 1 && iniciosGet === 1 &&
    consultasListagem === 1 && consultasDetalhe === 0 &&
    gravacoesObservacao === 0 && gravacoesEvidenciaGet === 0,
    "SEGUNDO_GET_ESCAPOU_DA_EDGE");
});

Deno.test("COB06 GET negativo: persiste apenas digest da resposta e conserva HOLD", async () => {
  reset();
  listagem = "vazia";
  const r = await chamar(acaoAuditar);
  assert(r.http === 200 && r.body.success === true &&
    r.body.estado === "nenhuma_cobranca_localizada" &&
    r.body.payment_id === null && r.body.status_bancario === null &&
    r.body.evidencia_get_persistida === true && r.body.banco_alterado === true &&
    r.body.hold_obrigatorio === true && r.body.pode_emitir_pix === false &&
    r.body.pode_quitar === false && r.body.pode_estornar === false &&
    r.body.pode_liberar_motoboy === false && r.body.pix_emitido === false,
    "GET_NEGATIVO_NAO_E_AUTORIZACAO");
  assert(iniciosGet === 1 && consultasListagem === 1 && consultasDetalhe === 0 &&
    gravacoesEvidenciaGet === 1 && gravacoesObservacao === 0,
    "GET_NEGATIVO_NAO_PERSISTIU_UMA_TRILHA");
});

Deno.test("COB06 GET negativo: erro ou recibo divergente da RPC impedem sucesso", async () => {
  for (const modo of ["rpc_ausente", "recusa", "permissao", "lote_divergente"] as const) {
    reset();
    listagem = "vazia";
    falhaPersistencia = modo;
    const r = await chamar(acaoAuditar);
    assert(r.http === 503 && r.body.success === false &&
      r.body.hold_obrigatorio === true && r.body.pode_emitir_pix === false &&
      r.body.pode_quitar === false && r.body.pode_estornar === false &&
      r.body.pode_liberar_motoboy === false &&
      consultasListagem === 1 && consultasDetalhe === 0 &&
      gravacoesEvidenciaGet === 1 && gravacoesObservacao === 0,
      "FALHA_RPC_NAO_BLOQUEOU_" + modo);
  }
});

Deno.test("COB06 GET negativo: ack repetido nao finge escrita ou autoriza Pix", async () => {
  reset();
  listagem = "vazia";
  falhaPersistencia = "replay";
  const r = await chamar(acaoAuditar);
  assert(r.http === 200 && r.body.success === true &&
    r.body.evidencia_get_persistida === true && r.body.banco_alterado === false &&
    r.body.pode_emitir_pix === false && r.body.pode_quitar === false &&
    r.body.pix_emitido === false && gravacoesEvidenciaGet === 1 &&
    consultasListagem === 1 && consultasDetalhe === 0,
    "ACK_REPETIDO_NAO_E_HOLD");
});

Deno.test("COB06 auditoria somente GET: duplicidade e paginacao nunca autorizam", async () => {
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

Deno.test("COB06 GET: sem vinculo exato da tentativa QA nao consulta o Asaas", async () => {
  for (const falha of ["sem_reserva", "operacao", "cliente", "referencia",
    "valor", "post", "hold"] as const) {
    reset();
    vinculoInvalido = falha;
    const r = await chamar(acaoAuditar);
    assert(r.http === 409 && r.body.success === false &&
      r.body.hold_obrigatorio === true && r.body.pode_emitir_pix === false &&
      r.body.pode_quitar === false && r.body.pode_liberar_motoboy === false &&
      consultasListagem === 0 && consultasDetalhe === 0 &&
      gravacoesObservacao === 0, "VINCULO_INVALIDO_CONSULTOU_BANCO_" + falha);
  }
  reset();
  vinculoInvalido = "rpc_indisponivel";
  const indisponivel = await chamar(acaoAuditar);
  assert(indisponivel.http === 503 && indisponivel.body.hold_obrigatorio === true &&
    consultasListagem === 0 && consultasDetalhe === 0 &&
    gravacoesObservacao === 0, "RPC_AUSENTE_NAO_BLOQUEOU_GET");
});

Deno.test("COB06 GET: segunda requisicao e bloqueada ANTES do Asaas", async () => {
  reset();
  const primeiro = await chamar(acaoAuditar);
  const segundo = await chamar(acaoAuditar);
  assert(primeiro.http === 503 && segundo.http === 409 &&
    primeiro.body.hold_obrigatorio === true &&
    segundo.body.hold_obrigatorio === true &&
    iniciosGet === 2 && consultasListagem === 1 && consultasDetalhe === 0 &&
    gravacoesObservacao === 0 && gravacoesEvidenciaGet === 0,
    "GET_REPETIDO_ESCAPOU_DO_CLAIM");
});

Deno.test("COB06 GET: duas Edges concorrentes compartilham UM inicio atomico", async () => {
  reset();
  const [a, b] = await Promise.all([
    chamar(acaoAuditar), chamar(acaoAuditar),
  ]);
  assert([a.http, b.http].sort().join(",") === "409,503" &&
    iniciosGet === 2 && consultasListagem === 1 && consultasDetalhe === 0 &&
    gravacoesObservacao === 0, "GET_CONCORRENTE_DUPLICADO");
});

Deno.test("COB06 GET: claim ausente, negado ou inseguro proibe consulta remota", async () => {
  for (const modo of ["rpc_ausente", "recusa", "lote", "permissao"] as const) {
    reset();
    falhaInicio = modo;
    const r = await chamar(acaoAuditar);
    assert((modo === "rpc_ausente" ? r.http === 503 : r.http === 409) &&
      r.body.success === false && r.body.hold_obrigatorio === true &&
      iniciosGet === 1 && consultasListagem === 0 && consultasDetalhe === 0 &&
      gravacoesEvidenciaGet === 0 && gravacoesObservacao === 0,
      "GET_SEM_CLAIM_" + modo);
  }
});

Deno.test("COB06 GET-only: contrato fonte proibe observar, gravar e faturar", async () => {
  const fonte = await Deno.readTextFile(
    new URL("../catalogo-asaas-cob06-auditoria/index.ts", import.meta.url),
  );
  for (const trecho of ["observar_primeiro_acumulo_sandbox_admin",
    "catalogo_asaas_registrar_observacao_acumulo",
    ".insert(", ".update(", ".upsert(", ".delete(",
    "criar_cobranca", "transferir_saque"]) {
    assert(!fonte.includes(trecho), "FONTE_NAO_READONLY_" + trecho);
  }
  assert(fonte.includes("auditar_duplicidade_acumulo_sandbox_admin") &&
    fonte.includes("URL_SUPABASE !== STAGING_URL") &&
    fonte.includes("!GET_ATIVO"), "GATES_DO_GET_NAO_PRESENTES");
});

Deno.test("COB06 QA: so o lote de R$5,60 pode ser auditado", async () => {
  for (const a of [acaoAuditar]) {
    reset();
    const r = await chamar(a, { lote: OUTRO_LOTE });
    assert(r.http === 403 && r.body.success === false &&
      r.body.pode_emitir_pix === false &&
      chamadasAuth === 1 && consultasLocal === 0 &&
      consultasListagem === 0 && gravacoesObservacao === 0,
      "LOTE_FORA_DA_QA_" + a);
  }
});

Deno.test("COB06 QA: comercio, corte, valor e estado devem corresponder ao lote original", async () => {
  for (const alteracao of ["comercio", "corte", "valor", "estado"] as const) {
    reset();
    loteIncorreto = alteracao;
    const r = await chamar(acaoAuditar);
    assert(r.http === 409 && r.body.success === false &&
      r.body.hold_obrigatorio === true &&
      consultasListagem === 0 && gravacoesObservacao === 0,
      "LOTE_INCONSISTENTE_" + alteracao);
  }
});

Deno.test("COB06 QA: flag contabil inesperadamente positiva impede ate GET remoto", async () => {
  for (const a of [acaoAuditar]) {
    reset();
    permissaoContabilInsegura = true;
    const r = await chamar(a);
    assert(r.http === 409 && r.body.success === false &&
      r.body.pode_emitir_pix === false &&
      consultasListagem === 0 && consultasDetalhe === 0 &&
      gravacoesObservacao === 0, "GATE_CONTABIL_INSEGURO_" + a);
  }
});
