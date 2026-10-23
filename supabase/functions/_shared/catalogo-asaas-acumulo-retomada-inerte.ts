// COB-06: recuperacao de preparacao interrompida de lote JA reservado.
// Reaproveita o lote e a referencia, nunca cria novo agrupamento ou chama Asaas.
// Uma origem paga/emissao individual, referencia divergente ou preflight
// insuficiente produz HOLD sem qualquer liberacao de dinheiro.

type LoteReservado = {
  id: string;
  comercio_id: string;
  competencia_corte: string;
  total_centavos: number | string;
  estado: string;
};
type ExecutarRpc = (loteId: string) => Promise<unknown>;

function exigir(ok: unknown, codigo: string): asserts ok {
  if (!ok) throw new Error("COB06_HOLD_" + codigo);
}
function registro(x: unknown): Record<string, unknown> {
  exigir(x !== null && typeof x === "object" && !Array.isArray(x), "RPC_INVALIDA");
  return x as Record<string, unknown>;
}

export async function retomarPreparacaoAcumuloInerte(
  lote: LoteReservado,
  competenciaCorte: string,
  conferirOrigens: ExecutarRpc,
  reservarReferencia: ExecutarRpc,
) {
  exigir(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(lote.id),
    "LOTE_INVALIDO");
  exigir(lote.comercio_id === "asaas-cob02" &&
    /^\d{4}-(?:0[1-9]|1[0-2])-01$/.test(competenciaCorte) &&
    lote.competencia_corte === competenciaCorte && lote.estado === "preparado",
    "LOTE_NAO_PREPARADO");
  const total = Number(lote.total_centavos);
  exigir(Number.isSafeInteger(total) && total >= 500 && total <= 2147483647,
    "VALOR_INVALIDO");

  const previa = registro(await conferirOrigens(lote.id));
  const origens = previa.origens;
  exigir(previa.ok === true && previa.integridade_contabil_ok === true &&
    previa.comercio_id === "asaas-cob02" && previa.lote_id === lote.id &&
    previa.estado === "preparado" &&
    Number(previa.valor_fontes_centavos) === total &&
    Number(previa.valor_lote_centavos) === total &&
    previa.pode_emitir_pix === false && previa.pode_quitar === false &&
    previa.pode_estornar === false && previa.pode_liberar_motoboy === false &&
    Array.isArray(origens) && origens.length >= 2 &&
    Number(previa.quantidade_fontes) === origens.length,
    "ORIGENS_DIVERGENTES");

  const competencias = new Set<string>();
  let algumaAbaixoDoMinimo = false;
  let soma = 0;
  for (const item of origens) {
    const fonte = registro(item);
    const valor = Number(fonte.valor_centavos);
    exigir(fonte.origem_consistente === true &&
      typeof fonte.competencia === "string" &&
      /^\d{4}-(?:0[1-9]|1[0-2])-01$/.test(fonte.competencia) &&
      Number.isSafeInteger(valor) && valor > 0 && valor <= 2147483647,
      "FONTE_INVALIDA");
    competencias.add(fonte.competencia);
    algumaAbaixoDoMinimo ||= valor < 500;
    soma += valor;
    exigir(Number.isSafeInteger(soma), "SOMA_INVALIDA");
  }
  exigir(competencias.size >= 2 && algumaAbaixoDoMinimo && soma === total,
    "ACUMULO_INVALIDO");

  const ref = registro(await reservarReferencia(lote.id));
  exigir(ref.ok === true && ref.lote_id === lote.id &&
    ref.referencia === "guia-acumulo-" + lote.id &&
    typeof ref.operacao_id === "string" &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(ref.operacao_id) &&
    Number(ref.valor_centavos) === total && ref.estado === "reservado" &&
    ref.payment_id === null && ref.pode_emitir_pix === false &&
    typeof ref.ja_reservada === "boolean",
    "REFERENCIA_DIVERGENTE");
  return {
    success: true, lote_id: lote.id, competencia_corte: competenciaCorte,
    total_centavos: total, quantidade_faturas: origens.length,
    referencia: ref.referencia, referencia_ja_reservada: ref.ja_reservada,
    recuperacao_de_lote_existente: true, pix_emitido: false,
    pode_emitir_pix: false, pode_quitar: false, pode_estornar: false,
    pode_liberar_motoboy: false, hold_obrigatorio: true,
  } as const;
}
