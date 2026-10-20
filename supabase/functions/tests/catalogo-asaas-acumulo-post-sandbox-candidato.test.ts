// COB-06: POST agrupado positivo exclusivamente com transporte falso, sem rede.
// O SQL17 e uma fixture CI, nao autoriza emitir cobrancas no Asaas Sandbox real.
import { postarPixAcumuloSandboxCandidatoSomenteCi } from
  "../_shared/catalogo-asaas-acumulo-post-sandbox-candidato.ts";

const LOTE = "22222222-3333-4444-8888-aaaaaaaaaaaa";
const PAGAMENTO = "pay_cob06_post_mock_12345";
const esperado = {
  loteId: LOTE,
  referencia: "guia-acumulo-" + LOTE,
  clienteId: "cus_cob06_mock_12345",
  valorCentavos: 560, // Exemplo de duas competencias: R$ 1,60 + R$ 4,00.
};
const autorizacao = {
  lote_id: LOTE, referencia: esperado.referencia,
  cliente_id: esperado.clienteId, valor_centavos: 560,
  operacao_id: "11111111-3333-4444-8888-bbbbbbbbbbbb",
  nova_tentativa: true, prova_get_externa: true,
  autorizacao_externa: true, pode_emitir_pix: true,
  pode_repetir_post: false, pode_quitar: false, pode_liberar_motoboy: false,
};
const TOKEN = "token-estritamente-ficticio-ci";
const DATA = "2099-12-31";

function assert(ok: unknown, msg: string): asserts ok {
  if (!ok) throw Error("COB06_POST_MOCK: " + msg);
}
async function recusar(op: () => Promise<unknown>, motivo: string) {
  let erro = "";
  try { await op(); } catch (e) { erro = String(e); }
  assert(erro.includes("COB06_HOLD_" + motivo),
    "esperado " + motivo + ", recebido " + erro);
}
function jsonResponse(payload: unknown, lengthDelta = 0): Response {
  const raw = JSON.stringify(payload);
  return new Response(raw, {
    status: 201,
    headers: { "content-type": "application/json",
      "content-length": String(new TextEncoder().encode(raw).length + lengthDelta) },
  });
}
function transporteFalso(opcoes: {
  timeout?: boolean; lengthDelta?: number; status?: string;
  alterar?: Record<string, unknown>; respostaId?: string;
} = {}) {
  let posts = 0, gets = 0, marcos = 0, envioMarcado = false;
  const fetchFalso = (async (raw: string | URL | Request, options?: RequestInit) => {
    const url = new URL(String(raw));
    assert(url.origin === "https://api-sandbox.asaas.com" &&
      (options?.headers as Record<string, string>)?.access_token === TOKEN &&
      options?.redirect === "error", "nenhum acesso a host estranho");
    if (options?.method === "POST") {
      posts++;
      assert(url.pathname === "/v3/payments", "endpoint de emissao exato");
      assert(posts === 1, "POST nunca pode repetir na mesma invocacao");
      const body = JSON.parse(String(options.body)) as Record<string, unknown>;
      assert(body.customer === esperado.clienteId &&
        body.externalReference === esperado.referencia &&
        body.billingType === "PIX" && body.value === 5.6 &&
        body.dueDate === DATA, "body deve vincular identidade e R$ 5,60");
      if (opcoes.timeout) throw Error("timeout simulado antes da resposta");
      return jsonResponse({ id: opcoes.respostaId ?? PAGAMENTO }, opcoes.lengthDelta);
    }
    assert(options?.method === "GET" &&
      url.pathname === "/v3/payments/" + (opcoes.respostaId ?? PAGAMENTO),
      "GET posterior deve consultar pelo ID devolvido no POST");
    gets++;
    return new Response(JSON.stringify({
      id: opcoes.respostaId ?? PAGAMENTO,
      customer: esperado.clienteId,
      externalReference: esperado.referencia,
      billingType: "PIX", value: 5.6, status: opcoes.status ?? "PENDING",
      ...opcoes.alterar,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const marcarInicio = async (loteId: string, operacaoId: string) => {
    marcos++;
    assert(loteId === LOTE && operacaoId === autorizacao.operacao_id,
      "marco deve usar a identidade da mesma autorizacao");
    if (envioMarcado) return {
      ok: false, motivo: "envio_ja_iniciado", marco_persistido: false,
      pode_enviar_post_mock: false, pode_repetir_post: false,
    };
    envioMarcado = true;
    return {
      ok: true, simulacao_ci: true, marco_persistido: true,
      lote_id: LOTE, operacao_id: operacaoId,
      referencia: esperado.referencia, cliente_id: esperado.clienteId,
      valor_centavos: esperado.valorCentavos,
      pode_enviar_post_mock: true, pode_repetir_post: false,
      pode_quitar: false, pode_liberar_motoboy: false,
      reconciliar_por_get: true,
    };
  };
  return { fetchFalso, marcarInicio, contas: () => ({ posts, gets, marcos }) };
}

Deno.test("COB06 POST MOCK: uma tentativa seguida de GET independente, sempre HOLD", async () => {
  const { fetchFalso, marcarInicio, contas } = transporteFalso();
  const r = await postarPixAcumuloSandboxCandidatoSomenteCi(
    esperado, DATA, TOKEN, autorizacao, marcarInicio, fetchFalso);
  assert(r.paymentId === PAGAMENTO &&
    r.observacao.p_lote === LOTE &&
    r.observacao.p_customer === esperado.clienteId &&
    r.observacao.p_valor === 560 && r.observacao.p_status === "PENDING" &&
    r.holdObrigatorio === true && r.podeQuitar === false &&
    r.podeLiberarMotoboy === false &&
    contas().posts === 1 && contas().gets === 1,
    "transportar sem liquidar ou liberar");
});

Deno.test("COB06 POST MOCK: recibo atual SQL13 ou forged falha antes de HTTP", async () => {
  const { fetchFalso, marcarInicio, contas } = transporteFalso();
  for (const falso of [
    null, undefined,
    { ...autorizacao, prova_get_externa: false },
    { ...autorizacao, autorizacao_externa: false },
    { ...autorizacao, pode_emitir_pix: false },
    { ...autorizacao, nova_tentativa: false },
    { ...autorizacao, pode_repetir_post: true },
    { ...autorizacao, pode_quitar: true },
    { ...autorizacao, valor_centavos: 561 },
    { ...autorizacao, cliente_id: "cus_outro" },
  ]) {
    await recusar(() => postarPixAcumuloSandboxCandidatoSomenteCi(
      esperado, DATA, TOKEN, falso, marcarInicio, fetchFalso), "AUTORIZACAO_SQL_AUSENTE");
  }
  assert(contas().posts === 0 && contas().gets === 0,
    "nenhum POST ou GET antes de recibo correto");
});

Deno.test("COB06 POST MOCK: Content-Length curto ou longo bloqueia GET/ACK", async () => {
  for (const lengthDelta of [-1, 1]) {
    const { fetchFalso, marcarInicio, contas } = transporteFalso({ lengthDelta });
    await recusar(() => postarPixAcumuloSandboxCandidatoSomenteCi(
      esperado, DATA, TOKEN, autorizacao, marcarInicio, fetchFalso), "POST_RESPOSTA_INVALIDA");
    assert(contas().posts === 1 && contas().gets === 0,
      "nunca confiar em resposta HTTP parcialmente recebida");
  }
});

Deno.test("COB06 POST MOCK: timeout jamais induz GET artificial ou repeticao de POST", async () => {
  const { fetchFalso, marcarInicio, contas } = transporteFalso({ timeout: true });
  await recusar(() => postarPixAcumuloSandboxCandidatoSomenteCi(
    esperado, DATA, TOKEN, autorizacao, marcarInicio, fetchFalso), "POST_INCONCLUSIVO");
  assert(contas().posts === 1 && contas().gets === 0,
    "cliente nao deve tentar novamente apos timeout");
});

Deno.test("COB06 POST MOCK: GET divergente recusa recibo sem quitação", async () => {
  for (const alterar of [
    { customer: "cus_terceiro_invalido" },
    { externalReference: "guia-acumulo-outro" },
    { value: 5.59 }, { billingType: "BOLETO" },
  ]) {
    const { fetchFalso, marcarInicio, contas } = transporteFalso({ alterar });
    let rejeitou = false;
    try {
      await postarPixAcumuloSandboxCandidatoSomenteCi(
        esperado, DATA, TOKEN, autorizacao, marcarInicio, fetchFalso);
    } catch (e) {
      rejeitou = String(e).includes("COB06_HOLD_");
    }
    assert(rejeitou && contas().posts === 1 && contas().gets === 1,
      "GET divergente nao pode validar emissao");
  }
});

Deno.test("COB06 POST MOCK: sem fetch injetado recusa rede nativa", async () => {
  await recusar(() => postarPixAcumuloSandboxCandidatoSomenteCi(
    esperado, DATA, TOKEN, autorizacao, async () => { throw Error("nao chamar"); }),
    "CI_ONLY_REDE_REAL_BLOQUEADA");
});

Deno.test("COB06 POST MOCK: mesmo recibo nao pode gerar segundo POST apos reinicio", async () => {
  const { fetchFalso, marcarInicio, contas } = transporteFalso();
  await postarPixAcumuloSandboxCandidatoSomenteCi(
    esperado, DATA, TOKEN, autorizacao, marcarInicio, fetchFalso);
  await recusar(() => postarPixAcumuloSandboxCandidatoSomenteCi(
    esperado, DATA, TOKEN, autorizacao, marcarInicio, fetchFalso),
    "MARCO_INICIO_INVALIDO");
  assert(contas().marcos === 2 && contas().posts === 1 && contas().gets === 1,
    "segundo chamado nao pode reutilizar o marco persistido");
});

Deno.test("COB06 POST MOCK: timeout consome marco e impede reenviar", async () => {
  const { fetchFalso, marcarInicio, contas } = transporteFalso({ timeout: true });
  await recusar(() => postarPixAcumuloSandboxCandidatoSomenteCi(
    esperado, DATA, TOKEN, autorizacao, marcarInicio, fetchFalso),
    "POST_INCONCLUSIVO");
  await recusar(() => postarPixAcumuloSandboxCandidatoSomenteCi(
    esperado, DATA, TOKEN, autorizacao, marcarInicio, fetchFalso),
    "MARCO_INICIO_INVALIDO");
  assert(contas().posts === 1 && contas().gets === 0 && contas().marcos === 2,
    "timeout nunca reabre o direito de POST");
});

Deno.test("COB06 POST MOCK: chamadas concorrentes so conseguem um marco", async () => {
  const { fetchFalso, marcarInicio, contas } = transporteFalso();
  const resultados = await Promise.allSettled([
    postarPixAcumuloSandboxCandidatoSomenteCi(
      esperado, DATA, TOKEN, autorizacao, marcarInicio, fetchFalso),
    postarPixAcumuloSandboxCandidatoSomenteCi(
      esperado, DATA, TOKEN, autorizacao, marcarInicio, fetchFalso),
  ]);
  assert(resultados.filter(x => x.status === "fulfilled").length === 1 &&
    resultados.filter(x => x.status === "rejected").length === 1 &&
    contas().posts === 1 && contas().marcos === 2,
    "somente um envio pode atravessar o marco atomico");
});

Deno.test("COB06 POST MOCK: marco ausente, inconclusivo ou adulterado recusa sem HTTP", async () => {
  const { fetchFalso, contas } = transporteFalso();
  await recusar(() => postarPixAcumuloSandboxCandidatoSomenteCi(
    esperado, DATA, TOKEN, autorizacao,
    undefined as unknown as (lote: string, operacao: string) => Promise<unknown>,
    fetchFalso), "MARCO_INICIO_AUSENTE");
  await recusar(() => postarPixAcumuloSandboxCandidatoSomenteCi(
    esperado, DATA, TOKEN, autorizacao,
    async () => { throw Error("timeout de RPC"); }, fetchFalso),
    "MARCO_INICIO_INCONCLUSIVO");
  for (const adulteracao of [
    { marco_persistido: false },
    { pode_enviar_post_mock: false },
    { lote_id: "33333333-3333-4333-8333-333333333333" },
    { operacao_id: "33333333-3333-4333-8333-333333333333" },
    { referencia: "guia-acumulo-outra" },
    { valor_centavos: 999 },
    { pode_quitar: true },
  ]) {
    await recusar(() => postarPixAcumuloSandboxCandidatoSomenteCi(
      esperado, DATA, TOKEN, autorizacao, async () => ({
        ok: true, simulacao_ci: true, marco_persistido: true,
        lote_id: LOTE, operacao_id: autorizacao.operacao_id,
        referencia: esperado.referencia, cliente_id: esperado.clienteId,
        valor_centavos: esperado.valorCentavos, pode_enviar_post_mock: true,
        pode_repetir_post: false, pode_quitar: false,
        pode_liberar_motoboy: false, reconciliar_por_get: true,
        ...adulteracao,
      }), fetchFalso), "MARCO_INICIO_INVALIDO");
  }
  assert(contas().posts === 0 && contas().gets === 0,
    "sem confirmacao de marco nenhum HTTP pode comecar");
});
