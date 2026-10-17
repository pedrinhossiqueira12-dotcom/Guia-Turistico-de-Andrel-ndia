// COB-06: GET Sandbox 100% mockado -> diario e baixa/estorno SQL REAIS.
// Somente PostgreSQL local descartavel da CI, sem --allow-net nem POST Pix.
import {
  conferirPagamentoAcumuloPorGet,
  observarPagamentoAcumuloSomenteGet,
  type ObservacaoRemota,
} from "../_shared/catalogo-asaas-acumulo-get-verificado-inerte.ts";
import { consultarPagamentoAcumuloSandboxGet } from
  "../_shared/catalogo-asaas-acumulo-get-sandbox-inerte.ts";

function exigir(ok: unknown, motivo: string): asserts ok {
  if (!ok) throw new Error("COB06_LIQUIDACAO_CI: " + motivo);
}

function somenteCiLocal() {
  for (const [nome, valor] of [
    ["PGHOST", "localhost"], ["PGPORT", "5432"],
    ["PGUSER", "postgres"], ["PGPASSWORD", "local-ci-only"],
    ["PGDATABASE", "catalogo_ci"],
  ]) exigir(Deno.env.get(nome) === valor, "ambiente nao local: " + nome);
  for (const nome of ["DATABASE_URL", "PGSERVICE", "PGHOSTADDR", "PGOPTIONS",
    "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ASAAS_API_KEY"]) {
    exigir(!Deno.env.get(nome), "alvo externo/credencial proibido: " + nome);
  }
}

async function psql(consulta: string): Promise<string> {
  const execucao = await new Deno.Command("psql", {
    args: ["-X", "-h", "localhost", "-p", "5432", "-U", "postgres",
      "-d", "catalogo_cob06_ci", "-v", "ON_ERROR_STOP=1", "-Atq", "-c", consulta],
    stdout: "piped", stderr: "piped",
  }).output();
  exigir(execucao.success, "consulta ao banco descartavel falhou: " +
    new TextDecoder().decode(execucao.stderr).slice(0, 500));
  return new TextDecoder().decode(execucao.stdout).trim();
}

async function jsonSql(consulta: string): Promise<Record<string, unknown>> {
  const retorno: unknown = JSON.parse(await psql(consulta));
  exigir(retorno !== null && typeof retorno === "object" && !Array.isArray(retorno),
    "retorno SQL nao e objeto");
  return retorno as Record<string, unknown>;
}

type LoteCi = {
  loteId: string;
  referencia: string;
  clienteId: string;
  valorCentavos: number;
};

function pegarEsperado(dados: Record<string, unknown>): LoteCi {
  const loteId = dados.loteId;
  exigir(typeof loteId === "string" &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(loteId),
    "UUID do livro invalido");
  exigir(dados.referencia === "guia-acumulo-" + loteId &&
    dados.clienteId === "cus_cob06_gate_race_123" &&
    dados.valorCentavos === 500 && dados.fontes === 2,
    "identidade, meses ou R$1+R$4 divergentes");
  return { loteId, referencia: dados.referencia as string,
    clienteId: dados.clienteId as string, valorCentavos: 500 };
}

async function estado(loteId: string): Promise<Record<string, unknown>> {
  // UUID validado antes de interpolacao; nenhuma entrada externa do cliente.
  return await jsonSql(`
    WITH pedidos AS (
      SELECT DISTINCT cp.pedido_id FROM public.catalogo_asaas_acumulo_fontes af
      JOIN public.catalogo_fatura_componentes_v2 cp ON cp.fechamento_id=af.fechamento_id
      WHERE af.lote_id='${loteId}'::uuid
    )
    SELECT json_build_object(
      'lote',(SELECT estado FROM public.catalogo_asaas_acumulo_lotes WHERE id='${loteId}'::uuid),
      'faturasPagas',(SELECT count(*) FROM public.catalogo_fechamentos_offline
        WHERE id IN (SELECT fechamento_id FROM public.catalogo_asaas_acumulo_fontes WHERE lote_id='${loteId}'::uuid)
          AND status='pago'),
      'faturasBloqueadas',(SELECT count(*) FROM public.catalogo_fechamentos_offline
        WHERE id IN (SELECT fechamento_id FROM public.catalogo_asaas_acumulo_fontes WHERE lote_id='${loteId}'::uuid)
          AND status='bloqueado'),
      'comissoesPagas',(SELECT count(*) FROM public.catalogo_comissoes_offline
        WHERE pedido_id IN (SELECT pedido_id FROM pedidos) AND status='paga'),
      'comissoesContestadas',(SELECT count(*) FROM public.catalogo_comissoes_offline
        WHERE pedido_id IN (SELECT pedido_id FROM pedidos) AND status='contestada'),
      'creditosDisponiveis',(SELECT count(*) FROM public.catalogo_lancamentos_financeiros_v2
        WHERE pedido_id IN (SELECT pedido_id FROM pedidos) AND status='disponivel'),
      'creditosRetidos',(SELECT count(*) FROM public.catalogo_lancamentos_financeiros_v2
        WHERE pedido_id IN (SELECT pedido_id FROM pedidos) AND status='retido'),
      'entregasDisponiveis',(SELECT count(*) FROM public.catalogo_remuneracoes_v2
        WHERE pedido_id IN (SELECT pedido_id FROM pedidos)
          AND status='disponivel' AND financiamento_comprovado=true),
      'entregasRetidas',(SELECT count(*) FROM public.catalogo_remuneracoes_v2
        WHERE pedido_id IN (SELECT pedido_id FROM pedidos)
          AND status='retido' AND financiamento_comprovado=false),
      'plataformaCentavos',(SELECT sum(valor_centavos) FROM public.catalogo_lancamentos_financeiros_v2
        WHERE pedido_id IN (SELECT pedido_id FROM pedidos) AND tipo='comissao_plataforma'),
      'motoboyCentavos',(SELECT sum(valor_centavos) FROM public.catalogo_lancamentos_financeiros_v2
        WHERE pedido_id IN (SELECT pedido_id FROM pedidos) AND tipo='remuneracao_motoboy'),
      'observacoes',(SELECT count(*) FROM public.catalogo_asaas_acumulo_observacoes
        WHERE lote_id='${loteId}'::uuid),
      'eventos',(SELECT count(*) FROM public.catalogo_asaas_acumulo_eventos
        WHERE lote_id='${loteId}'::uuid),
      'quitacoes',(SELECT count(*) FROM public.catalogo_asaas_acumulo_quitacoes_isoladas
        WHERE lote_id='${loteId}'::uuid),
      'quitacaoEstado',(SELECT estado FROM public.catalogo_asaas_acumulo_quitacoes_isoladas
        WHERE lote_id='${loteId}'::uuid),
      'emissoes',(SELECT count(*) FROM public.catalogo_asaas_emissoes),
      'faturaHistorica',(SELECT count(*) FROM public.catalogo_fatura_cobrancas
        WHERE order_id='legacy-cob06-ci' AND gateway='mercadopago'
          AND status='pago' AND valor_centavos=700),
      'cobrancasIndividuais',(SELECT count(*) FROM public.catalogo_fatura_cobrancas
        WHERE fechamento_id IN (SELECT fechamento_id FROM public.catalogo_asaas_acumulo_fontes
          WHERE lote_id='${loteId}'::uuid))
    )::text`);
}

function conferirLivro(livro: Record<string, unknown>, fase: "antes" | "pago" | "estornado") {
  exigir(livro.plataformaCentavos === 357 && livro.motoboyCentavos === 143 &&
    livro.emissoes === 0 && livro.faturaHistorica === 1 &&
    livro.cobrancasIndividuais === 0,
  "livro R$3,57/R$1,43, fatura historica ou ausencia de Pix divergentes: " + fase);
  const esperado = {
    antes: ["preparado", 0, 0, 0, 0, 0, 4, 0, 2, 0, null],
    pago: ["pago", 2, 0, 2, 0, 4, 0, 2, 0, 1, "pago"],
    estornado: ["estornado", 0, 2, 0, 2, 0, 4, 0, 2, 1, "estornado"],
  }[fase];
  const observado = [livro.lote, livro.faturasPagas, livro.faturasBloqueadas,
    livro.comissoesPagas, livro.comissoesContestadas, livro.creditosDisponiveis,
    livro.creditosRetidos, livro.entregasDisponiveis, livro.entregasRetidas,
    livro.quitacoes, livro.quitacaoEstado];
  exigir(JSON.stringify(observado) === JSON.stringify(esperado),
    "creditos/fontes nao atomicos na fase " + fase + ": " + JSON.stringify(observado));
}

Deno.test("COB06 E2E isolado: GET RECEIVED, baixa R$1+R$4, GET REFUNDED e retencao", async () => {
  somenteCiLocal();
  exigir(await psql("SELECT current_database()||'|'||inet_server_port()||'|'||current_user") ===
    "catalogo_cob06_ci|5432|postgres", "banco/owner fora da CI");
  const esperado = pegarEsperado(await jsonSql(`
    SELECT json_build_object('loteId',l.id,'referencia',r.referencia,
      'clienteId',c.cliente_id,'valorCentavos',l.total_centavos,
      'fontes',(SELECT count(*) FROM public.catalogo_asaas_acumulo_fontes af
                WHERE af.lote_id=l.id))::text
    FROM public.catalogo_asaas_acumulo_lotes l
    JOIN public.catalogo_asaas_acumulo_referencias r ON r.lote_id=l.id
    JOIN public.catalogo_asaas_clientes c ON c.comercio_id=l.comercio_id
    WHERE l.comercio_id='comercio-de-exemplo'`));
  conferirLivro(await estado(esperado.loteId), "antes");

  const paymentId = "pay_cob06_integracao_baixa_12345";
  let gets = 0;
  let escritas = 0;
  const fetchSimulado = (status: string, alteracao: Record<string, unknown> = {}) =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      gets++;
      exigir(String(url) === "https://api-sandbox.asaas.com/v3/payments/" + paymentId &&
        init?.method === "GET" && init.redirect === "error" &&
        (init.headers as Record<string, string>).access_token === "token-ficticio-ci",
        "somente GET Sandbox autenticado e simulado");
      return new Response(JSON.stringify({
        id: paymentId, externalReference: esperado.referencia,
        customer: esperado.clienteId, value: "5.00", billingType: "PIX", status,
        ...alteracao,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

  const consultar = (status: string, alteracao: Record<string, unknown> = {}) =>
    (id: string) => consultarPagamentoAcumuloSandboxGet(
      id, "token-ficticio-ci", fetchSimulado(status, alteracao));
  const registrarObservacao = async (o: ObservacaoRemota) => {
    escritas++;
    exigir(o.p_lote === esperado.loteId && o.p_payment === paymentId &&
      o.p_customer === esperado.clienteId && o.p_referencia === esperado.referencia &&
      o.p_valor === 500 && o.p_status === "RECEIVED", "observacao nao validada");
    return await jsonSql(`SELECT public.catalogo_asaas_registrar_observacao_acumulo(
      '${o.p_lote}'::uuid,'${o.p_payment}','${o.p_customer}',
      '${o.p_referencia}',${o.p_valor},'${o.p_status}')::text`);
  };

  // Mesmo GET 200, identidade/centavos errados nunca escrevem no PostgreSQL.
  for (const alteracao of [{ value: "5.01" }, { customer: "cus_divergente" },
    { status: "UNKNOWN" }, { billingType: "BOLETO" }]) {
    let retido = false;
    try {
      await observarPagamentoAcumuloSomenteGet(
        esperado, paymentId, consultar("RECEIVED", alteracao), registrarObservacao);
    } catch (erro) { retido = String(erro).includes("COB06_HOLD_"); }
    exigir(retido && escritas === 0, "GET divergente tentou gravar observacao");
  }
  conferirLivro(await estado(esperado.loteId), "antes");

  const primeira = await observarPagamentoAcumuloSomenteGet(
    esperado, paymentId, consultar("RECEIVED"), registrarObservacao);
  const ack = primeira.retorno as Record<string, unknown>;
  exigir(ack.ok === true && ack.ja_observado === false &&
    ack.pode_quitar === false && ack.pode_liberar_motoboy === false &&
    gets === 5 && escritas === 1, "observacao RECEIVED nao e baixa");

  const evento = await jsonSql(`SELECT public.catalogo_asaas_registrar_evento_acumulo_inerte(
    '${esperado.loteId}'::uuid,'${paymentId}','ci-cob06-get-received-001','RECEIVED')::text`);
  exigir(evento.ok === true && evento.ja_observado === false &&
    evento.pode_quitar === false && evento.pode_liberar_motoboy === false &&
    Number.isSafeInteger(evento.evento_id), "evento inerte nao registrado");
  const eventoId = evento.evento_id as number;
  const registrado = await estado(esperado.loteId);
  conferirLivro(registrado, "antes");
  exigir(registrado.observacoes === 1 && registrado.eventos === 1,
    "diario RECEIVED alterou livro financeiro");

  const baixa = await jsonSql(`SELECT catalogo_private.catalogo_asaas_quitar_lote_atomico_ci(
    '${esperado.loteId}'::uuid,${eventoId}::bigint)::text`);
  exigir(baixa.ok === true && baixa.competencias === 2 && baixa.pedidos === 2 &&
    baixa.valor_centavos === 500 && baixa.prova_bancaria_real === false &&
    baixa.transferencias_autorizadas === false, "baixa atomica CI divergente");
  conferirLivro(await estado(esperado.loteId), "pago");
  const replayBaixa = await jsonSql(`SELECT catalogo_private.catalogo_asaas_quitar_lote_atomico_ci(
    '${esperado.loteId}'::uuid,${eventoId}::bigint)::text`);
  exigir(replayBaixa.ok === false && replayBaixa.motivo === "lote_nao_aberto",
    "replay de RECEIVED criou segunda baixa");

  // Nova prova GET por ID para REFUNDED; a observacao inicial e imutavel.
  let refundNegado = false;
  try {
    await conferirPagamentoAcumuloPorGet(esperado, paymentId,
      consultar("REFUNDED", { externalReference: "guia-acumulo-outra" }));
  } catch (erro) { refundNegado = String(erro).includes("COB06_HOLD_"); }
  exigir(refundNegado, "estorno divergente passou no GET");
  conferirLivro(await estado(esperado.loteId), "pago");

  const refund = await conferirPagamentoAcumuloPorGet(
    esperado, paymentId, consultar("REFUNDED"));
  exigir(refund.p_status === "REFUNDED" && refund.p_valor === 500,
    "estorno nao verificado por GET");
  const eventoRefund = await jsonSql(`SELECT public.catalogo_asaas_registrar_evento_acumulo_inerte(
    '${refund.p_lote}'::uuid,'${refund.p_payment}',
    'ci-cob06-get-refunded-001','${refund.p_status}')::text`);
  exigir(eventoRefund.ok === true && eventoRefund.ja_observado === false &&
    eventoRefund.pode_estornar === false && eventoRefund.pode_liberar_motoboy === false &&
    Number.isSafeInteger(eventoRefund.evento_id), "diario estorno nao inerte");
  const suspensao = await jsonSql(`SELECT catalogo_private.catalogo_asaas_suspender_lote_atomico_ci(
    '${esperado.loteId}'::uuid,${eventoRefund.evento_id}::bigint)::text`);
  exigir(suspensao.ok === true && suspensao.estado === "estornado" &&
    suspensao.competencias === 2 && suspensao.pedidos === 2 &&
    suspensao.prova_bancaria_real === false &&
    suspensao.transferencias_compensadas === false,
    "estorno CI deixou credito disponivel ou alegou transferencia");
  conferirLivro(await estado(esperado.loteId), "estornado");

  const replayEvento = await jsonSql(`SELECT public.catalogo_asaas_registrar_evento_acumulo_inerte(
    '${esperado.loteId}'::uuid,'${paymentId}',
    'ci-cob06-get-refunded-001','REFUNDED')::text`);
  const replaySuspensao = await jsonSql(`SELECT catalogo_private.catalogo_asaas_suspender_lote_atomico_ci(
    '${esperado.loteId}'::uuid,${eventoRefund.evento_id}::bigint)::text`);
  exigir(replayEvento.ja_observado === true &&
    replayEvento.evento_id === eventoRefund.evento_id &&
    replaySuspensao.ok === false && replaySuspensao.motivo === "quitacao_nao_ativa",
    "replay de estorno alterou financeiro");
  const atrasado = await jsonSql(`SELECT public.catalogo_asaas_registrar_evento_acumulo_inerte(
    '${esperado.loteId}'::uuid,'${paymentId}',
    'ci-cob06-get-received-atrasado-001','RECEIVED')::text`);
  const apuracao = await jsonSql(`SELECT public.catalogo_asaas_apurar_estados_acumulo_inerte(
    '${esperado.loteId}'::uuid)::text`);
  exigir(atrasado.ok === true && apuracao.candidato_a_conferencia_manual === false &&
    apuracao.exige_revisao === true && apuracao.pode_quitar === false,
    "RECEIVED atrasado reabilitou credito estornado");
  const final = await estado(esperado.loteId);
  conferirLivro(final, "estornado");
  exigir(final.observacoes === 1 && final.eventos === 3 && final.quitacoes === 1,
    "estorno, eventos ou recibo duplicados");
  console.log("COB06_GET_RECEIVED_SQL11_REFUNDED_SQL12_REPLAY_HOLD_CI_OK");
});
