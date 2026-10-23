// COB-06: preflight IDENTITARIO, somente leitura, para novo caso QA independente.
// Nao importa transporte Asaas, nao efetua claim, GET, POST, baixa ou saque.
// Nao transforma um snapshot local em autorizacao financeira.
export const LOTE_HISTORICO_BLOQUEADO =
  "583d761a-ecb9-49be-b484-e43f6183971e";

export type PlanoNovoQa = {
  loteId: string;
  comercioId: string;
  competenciaCorte: string;
  valorCentavos: number;
};
type SnapshotNovoQa = {
  lote: Record<string, unknown>;
  referencia: Record<string, unknown>;
  cliente: Record<string, unknown>;
  conciliacao: Record<string, unknown>;
};

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const idCliente = /^cus_[A-Za-z0-9_-]{3,120}$/;

function exigir(ok: boolean, codigo: string): asserts ok {
  if (!ok) throw new Error("COB06_NOVO_QA_HOLD_" + codigo);
}

// Os valores sao configurados EXCLUSIVAMENTE no servidor, nunca no body.
// Proibe reuso do comercio e lote do GET historico de 19/10.
export function validarPlanoNovoQa(campos: {
  loteId?: string; comercioId?: string; competenciaCorte?: string;
  valorCentavos?: string;
}): PlanoNovoQa {
  const loteId = campos.loteId || "";
  const comercioId = campos.comercioId || "";
  const competenciaCorte = campos.competenciaCorte || "";
  const cents = campos.valorCentavos || "";
  exigir(uuid.test(loteId) &&
    loteId.toLowerCase() !== LOTE_HISTORICO_BLOQUEADO &&
    loteId.toLowerCase() !== "00000000-0000-0000-0000-000000000000",
    "LOTE_INVALIDO_OU_HISTORICO");
  exigir(/^asaas-cob06-qa-[a-z0-9-]{3,35}$/.test(comercioId) &&
    comercioId !== "asaas-cob02", "COMERCIO_QA_NAO_ISOLADO");
  exigir(/^20\d{2}-(?:0[1-9]|1[0-2])-01$/.test(competenciaCorte) &&
    !Number.isNaN(Date.parse(competenciaCorte + "T00:00:00Z")),
    "COMPETENCIA_INVALIDA");
  exigir(/^[1-9]\d{2,9}$/.test(cents), "VALOR_NAO_CONFIGURADO");
  const valorCentavos = Number(cents);
  exigir(Number.isSafeInteger(valorCentavos) &&
    valorCentavos >= 500 && valorCentavos <= 2147483647, "VALOR_INVALIDO");
  return { loteId, comercioId, competenciaCorte, valorCentavos };
}

export function conferirSnapshotNovoQa(
  plano: PlanoNovoQa, snapshot: SnapshotNovoQa,
) {
  const { lote: l, referencia: r, cliente: c, conciliacao: a } = snapshot;
  const op = r.operacao_id;
  exigir(
    l.id === plano.loteId &&
    l.comercio_id === plano.comercioId &&
    l.competencia_corte === plano.competenciaCorte &&
    l.total_centavos === plano.valorCentavos &&
    l.estado === "preparado", "LOTE_DIVERGENTE");
  exigir(r.lote_id === plano.loteId &&
    r.comercio_id === plano.comercioId &&
    r.referencia === "guia-acumulo-" + plano.loteId &&
    r.valor_centavos === plano.valorCentavos &&
    r.estado === "reservado" &&
    r.payment_id === null &&
    r.pode_emitir_pix === false &&
    typeof op === "string" && uuid.test(op), "REFERENCIA_DIVERGENTE");
  exigir(typeof c.cliente_id === "string" &&
    idCliente.test(c.cliente_id), "CLIENTE_QA_INVALIDO");
  exigir(a.ok === true && a.integridade_contabil_ok === true &&
    a.valor_fontes_centavos === plano.valorCentavos &&
    a.pode_emitir_pix === false &&
    a.pode_quitar === false &&
    a.pode_liberar_motoboy === false, "FONTES_NAO_CONFERIDAS");

  // Este retorno NAO verifica se houve GET anterior: essa verificacao
  // exigira claim SQL separado, append-only e autorizado expressamente.
  return {
    lote_id: plano.loteId,
    referencia: r.referencia,
    comercio_id: plano.comercioId,
    valor_centavos: plano.valorCentavos,
    identidade_local_conferida: true,
    ausencia_get_anterior_comprovada: false,
    nova_consulta_autorizada: false,
    pode_consultar_asaas: false,
    pode_emitir_pix: false,
    pode_quitar: false,
    pode_estornar: false,
    pode_liberar_motoboy: false,
    hold_obrigatorio: true,
  } as const;
}
