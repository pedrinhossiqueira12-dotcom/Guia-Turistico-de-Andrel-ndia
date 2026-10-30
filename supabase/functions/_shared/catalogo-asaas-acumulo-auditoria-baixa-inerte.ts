// COB-06: projecao administrativa de competencias, SEM efeito contabil.
// O evento local, ainda que RECEIVED, NAO comprova pagamento autonomamente.
import type { ExpectativaAcumulo, ObservacaoRemota } from
  "./catalogo-asaas-acumulo-get-verificado-inerte.ts";

type Registro = Record<string, unknown>;
function exigir(ok: unknown, motivo: string): asserts ok {
  if (!ok) throw new Error("COB06_HOLD_AUDITORIA_BAIXA_" + motivo);
}
function objeto(v: unknown): Registro {
  exigir(v !== null && typeof v === "object" && !Array.isArray(v), "LIVRO_INVALIDO");
  return v as Registro;
}
function inteiro(v: unknown): number {
  exigir(typeof v === "number" && Number.isSafeInteger(v) && v >= 0,
    "CONTAGEM_OU_VALOR_INVALIDO");
  return v;
}

export function montarAuditoriaBaixaAcumuloInerte(
  esperado: ExpectativaAcumulo,
  getVerificado: ObservacaoRemota,
  apuracaoBruta: unknown,
  projecaoBruta: unknown,
) {
  exigir(getVerificado.p_lote === esperado.loteId &&
    getVerificado.p_referencia === esperado.referencia &&
    getVerificado.p_customer === esperado.clienteId &&
    getVerificado.p_valor === esperado.valorCentavos &&
    /^pay_[A-Za-z0-9_-]{5,120}$/.test(getVerificado.p_payment),
    "GET_DIVERGENTE");
  const a = objeto(apuracaoBruta), p = objeto(projecaoBruta);
  exigir(a.ok === true && p.ok === true &&
    a.lote_id === esperado.loteId && p.lote_id === esperado.loteId &&
    inteiro(a.valor_centavos) === esperado.valorCentavos &&
    inteiro(p.valor_centavos) === esperado.valorCentavos,
    "IDENTIDADE_LOCAL");
  for (const campo of ["pode_emitir_pix", "pode_quitar", "pode_estornar",
    "pode_liberar_motoboy"] as const) {
    exigir(a[campo] === false && p[campo] === false, "PERMISSAO_FINANCEIRA");
  }
  exigir(a.prova_bancaria_autonoma === false &&
    p.helper_legado_incompativel_sem_cobranca_individual === true &&
    typeof a.integridade_contabil_ok === "boolean" &&
    typeof a.identidade_local_ok === "boolean" &&
    typeof a.exige_revisao === "boolean" &&
    typeof p.projecao_contabil_consistente === "boolean",
    "PROVAS_INCOMPLETAS");

  const quantidade = inteiro(p.quantidade_competencias);
  const pedidos = inteiro(p.pedidos);
  const parcelas = inteiro(p.parcelas);
  exigir(quantidade >= 2 && Array.isArray(p.origens) &&
    p.origens.length === quantidade && pedidos >= 2 && parcelas >= pedidos,
    "COMPETENCIAS_INCOMPLETAS");
  const competencias = new Set<string>();
  const fechamentos = new Set<string>();
  let soma = 0, somaPlataforma = 0, somaLogistica = 0;
  let somaPedidos = 0, somaParcelas = 0, somaFalhas = 0, somaLiberadas = 0;
  const origens = p.origens.map((bruta: unknown) => {
    const o = objeto(bruta);
    exigir(typeof o.fechamento_id === "string" &&
      /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(o.fechamento_id) &&
      typeof o.competencia === "string" &&
      /^\d{4}-(?:0[1-9]|1[0-2])-01$/.test(o.competencia) &&
      !fechamentos.has(o.fechamento_id) && !competencias.has(o.competencia),
      "FONTE_REPETIDA_OU_INVALIDA");
    fechamentos.add(o.fechamento_id);
    competencias.add(o.competencia);
    const total = inteiro(o.total_centavos);
    const plataforma = inteiro(o.plataforma_centavos);
    const logistica = inteiro(o.logistica_centavos);
    const pedidosOrigem = inteiro(o.pedidos);
    const parcelasOrigem = inteiro(o.parcelas);
    const falhas = inteiro(o.parcelas_sem_credito_seguro);
    const liberadas = inteiro(o.parcelas_ja_liberadas);
    exigir(total > 0 && total === plataforma + logistica &&
      pedidosOrigem > 0 && parcelasOrigem >= pedidosOrigem &&
      falhas <= parcelasOrigem && liberadas <= parcelasOrigem,
      "FONTE_FINANCEIRA_DIVERGENTE");
    soma += total;
    somaPlataforma += plataforma;
    somaLogistica += logistica;
    somaPedidos += pedidosOrigem;
    somaParcelas += parcelasOrigem;
    somaFalhas += falhas;
    somaLiberadas += liberadas;
    return { fechamento_id: o.fechamento_id, competencia: o.competencia,
      total_centavos: total, plataforma_centavos: plataforma,
      logistica_centavos: logistica, pedidos: pedidosOrigem,
      parcelas: parcelasOrigem, parcelas_sem_credito_seguro: falhas,
      parcelas_ja_liberadas: liberadas };
  });
  exigir(soma === esperado.valorCentavos &&
    somaPlataforma === inteiro(p.plataforma_centavos) &&
    somaLogistica === inteiro(p.logistica_centavos) &&
    somaPedidos === pedidos && somaParcelas === parcelas &&
    somaFalhas === inteiro(p.parcelas_sem_credito_seguro) &&
    somaLiberadas === inteiro(p.parcelas_ja_liberadas),
    "TOTAL_MULTICOMPETENCIA_DIVERGENTE");

  return {
    success: true, lote_id: esperado.loteId,
    payment_id: getVerificado.p_payment,
    status_bancario_verificado: getVerificado.p_status,
    valor_centavos: soma, quantidade_competencias: quantidade,
    plataforma_centavos: somaPlataforma, logistica_centavos: somaLogistica,
    competencias: origens,
    integridade_contabil_ok: a.integridade_contabil_ok,
    identidade_local_ok: a.identidade_local_ok,
    projecao_contabil_consistente: p.projecao_contabil_consistente,
    exige_revisao: a.exige_revisao,
    classificacao_local: typeof a.classificacao === "string"
      ? a.classificacao : "nao_classificado",
    prova_bancaria_autonoma: false,
    pode_emitir_pix: false, pode_quitar: false,
    pode_estornar: false, pode_liberar_motoboy: false,
    hold_obrigatorio: true,
  } as const;
}
