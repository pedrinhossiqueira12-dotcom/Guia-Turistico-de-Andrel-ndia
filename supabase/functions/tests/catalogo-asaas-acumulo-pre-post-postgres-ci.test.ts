// COB-06: integra o GET simulado ao gate SQL13 REAL em PostgreSQL descartavel.
// Executar somente depois da fixture e do teste de concorrencia do gate CI.
// Deno sem --allow-net: nenhum GET/POST pode sair para o Asaas.
import { conciliarAntesDePixAcumuloCandidatoSomenteCi } from
  "../_shared/catalogo-asaas-acumulo-pre-post-somente-ci.ts";
import { postarPixAcumuloSandboxCandidatoSomenteCi } from
  "../_shared/catalogo-asaas-acumulo-post-sandbox-candidato.ts";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error("COB06_INTEGRACAO_CI: " + message);
}
type LivroCi = {
  loteId: string;
  referencia: string;
  clienteId: string;
  valorCentavos: number;
  operacaoId: string;
};

function apenasCiLocal() {
  for (const [chave, esperado] of [
    ["PGHOST", "localhost"], ["PGPORT", "5432"],
    ["PGUSER", "postgres"], ["PGDATABASE", "catalogo_ci"],
    ["PGPASSWORD", "local-ci-only"],
  ]) assert(Deno.env.get(chave) === esperado, "ambiente local divergente: " + chave);
  for (const chave of ["DATABASE_URL", "PGSERVICE", "PGHOSTADDR", "PGOPTIONS",
    "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ASAAS_API_KEY"]) {
    assert(!Deno.env.get(chave), "credencial ou alvo externo proibido: " + chave);
  }
}

async function sqlSomenteCi(consulta: string): Promise<string> {
  const resultado = await new Deno.Command("psql", {
    args: ["-X", "-h", "localhost", "-p", "5432", "-U", "postgres",
      "-d", "catalogo_cob06_ci", "-v", "ON_ERROR_STOP=1", "-Atq", "-c", consulta],
    stdout: "piped", stderr: "piped",
  }).output();
  assert(resultado.success, "falha PostgreSQL descartavel (sem continuar)");
  return new TextDecoder().decode(resultado.stdout).trim();
}

Deno.test("COB06 integracao real: GET mock + gate PostgreSQL persistido nunca libera POST", async () => {
  apenasCiLocal();
  assert(await sqlSomenteCi("SELECT current_database()||'|'||inet_server_port()") ===
    "catalogo_cob06_ci|5432", "banco CI nao confirmado");

  const bruto = await sqlSomenteCi(`
    SELECT json_build_object(
      'loteId',r.lote_id,'referencia',r.referencia,
      'clienteId',t.cliente_id,'valorCentavos',r.valor_centavos,
      'operacaoId',r.operacao_id)::text
    FROM public.catalogo_asaas_acumulo_referencias r
    JOIN public.catalogo_asaas_acumulo_tentativas_emissao_ci t
      ON t.lote_id=r.lote_id
    WHERE r.comercio_id='comercio-de-exemplo'`);
  const livro = JSON.parse(bruto) as LivroCi;
  assert(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(livro.loteId) &&
    livro.referencia === "guia-acumulo-" + livro.loteId &&
    livro.clienteId === "cus_cob06_gate_race_123" &&
    livro.valorCentavos === 500,
    "fixture real nao corresponde a R$1 + R$4");

  const pagamentoId = "pay_cob06_integracao_12345";
  let gets = 0;
  let consultasGate = 0;
  const fetchFalso = (modo: "existente" | "vazio" | "duplicado" | "erro") =>
    (async (raw: string | URL | Request, init?: RequestInit) => {
      gets++;
      const url = new URL(String(raw));
      assert(url.origin === "https://api-sandbox.asaas.com" &&
        init?.method === "GET" && init.redirect === "error" &&
        (init.headers as Record<string, string>).access_token === "token-ficticio-ci",
        "somente GET Sandbox simulado");
      if (modo === "erro") throw new Error("rede sem resposta");
      if (url.pathname === "/v3/payments") {
        assert(url.searchParams.get("externalReference") === livro.referencia,
          "referencia deve vir do livro real");
        const data = modo === "vazio" ? [] : [{ id: pagamentoId }];
        if (modo === "duplicado") data.push({ id: "pay_segundo_invalido_123" });
        return new Response(JSON.stringify({ object: "list", data,
          totalCount: data.length, hasMore: false, offset: 0 }), {
          headers: { "content-type": "application/json" }, status: 200,
        });
      }
      assert(url.pathname === "/v3/payments/" + pagamentoId,
        "ID bancario precisa ser encontrado por referencia");
      return new Response(JSON.stringify({ id: pagamentoId,
        externalReference: livro.referencia, customer: livro.clienteId,
        value: 5, billingType: "PIX", status: "PENDING" }), {
        headers: { "content-type": "application/json" }, status: 200,
      });
    }) as typeof fetch;

  const gateSql = async (loteId: string) => {
    consultasGate++;
    assert(loteId === livro.loteId, "tentativa de lote estranho");
    return JSON.parse(await sqlSomenteCi(
      `SELECT catalogo_private.catalogo_asaas_autorizar_tentativa_emissao_ci('${loteId}'::uuid)::text`));
  };

  // Usa o recibo do gate SQL13 REAL contra o transporte candidato.
  // A primeira tentativa ja foi persistida pela prova de concorrencia,
  // logo o banco so pode devolver replay/GET manual, jamais autorizar POST.
  const reciboReal = await gateSql(livro.loteId);
  assert(reciboReal.ok === false && reciboReal.nova_tentativa === false &&
    reciboReal.pode_emitir_pix === false,
    "SQL13 real nao deve conceder permissao de emissao");
  let chamadasPost = 0;
  const mockSemRede = (async () => {
    chamadasPost++;
    throw Error("nao fazer chamada HTTP");
  }) as typeof fetch;
  let erroAutorizacao = "";
  try {
    await postarPixAcumuloSandboxCandidatoSomenteCi(
      livro, "2099-01-06", "token-ficticio-ci", reciboReal, mockSemRede);
  } catch (erro) {
    erroAutorizacao = String(erro);
  }
  assert(erroAutorizacao.includes("COB06_HOLD_AUTORIZACAO_SQL_AUSENTE") &&
    chamadasPost === 0,
    "recibo REAL do banco bloqueia transporte POST antes da rede");
  consultasGate = 0;

  const existente = await conciliarAntesDePixAcumuloCandidatoSomenteCi(
    livro, "token-ficticio-ci", gateSql, fetchFalso("existente"));
  assert(existente.estado === "cobranca_existente_verificada" &&
    existente.paymentId === pagamentoId && Number(consultasGate) === 0 && Number(gets) === 2 &&
    existente.podeEmitirPix === false, "cobranca preexistente nunca reserva nova tentativa");

  gets = 0;
  const repeticao = await conciliarAntesDePixAcumuloCandidatoSomenteCi(
    livro, "token-ficticio-ci", gateSql, fetchFalso("vazio"));
  assert(repeticao.estado === "tentativa_anterior_reconciliar_manualmente" &&
    Number(consultasGate) === 1 && Number(gets) === 1 && repeticao.podeEmitirPix === false &&
    repeticao.podeQuitar === false && repeticao.podeLiberarMotoboy === false &&
    repeticao.holdObrigatorio === true,
    "GET vazio + tentativa persistida exige revisao manual, jamais POST");

  for (const modo of ["duplicado", "erro"] as const) {
    let falhou = false;
    try {
      await conciliarAntesDePixAcumuloCandidatoSomenteCi(
        livro, "token-ficticio-ci", gateSql, fetchFalso(modo));
    } catch (erro) {
      falhou = String(erro).includes("COB06_HOLD_GET_INCONCLUSIVO");
    }
    assert(falhou && Number(consultasGate) === 1,
      "falha ou duplicidade no GET nao pode tocar gate SQL");
  }

  assert(await sqlSomenteCi(`
    SELECT count(*)||'|'||bool_and(operacao_id='${livro.operacaoId}'::uuid)||
      '|'||bool_and(NOT pode_repetir_post AND NOT post_externo_comprovado)
    FROM public.catalogo_asaas_acumulo_tentativas_emissao_ci`) === "1|true|true",
    "gate persistente deve continuar unico e fechado");
  assert(await sqlSomenteCi(`
    SELECT (SELECT count(*) FROM public.catalogo_asaas_emissoes)||'|'||
      (SELECT count(*) FROM public.catalogo_fatura_cobrancas
       WHERE order_id='legacy-cob06-ci' AND status='pago' AND valor_centavos=700)`) ===
    "0|1", "sem emissao real, preservando cobranca historica paga");
  console.log("COB06_GET_GATE_SQL_REAL_SEM_POST_SEM_CREDITO_OK");
});
