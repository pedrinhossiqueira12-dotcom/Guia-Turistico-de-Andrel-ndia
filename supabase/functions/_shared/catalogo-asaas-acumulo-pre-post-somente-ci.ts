// COB-06 / PR39: coordenador PRE-POST do acumulo, candidato SOMENTE CI.
// Nenhuma Edge importa este modulo. Nenhum ramo chama POST /payments.
// SQL13 e exclusivamente efemero: sua reserva NAO autoriza cobranca bancaria.
// Uma futura habilitacao operacional precisa ser revisada separadamente.
import {
  encontrarIdPagamentoAcumuloSandboxPorReferencia,
  consultarPagamentoAcumuloSandboxGet,
} from "./catalogo-asaas-acumulo-get-sandbox-inerte.ts";
import { conferirPagamentoAcumuloPorGet } from "./catalogo-asaas-acumulo-get-verificado-inerte.ts";
import type {
  ExpectativaAcumulo,
} from "./catalogo-asaas-acumulo-get-verificado-inerte.ts";

type FetchSeguro = typeof fetch;
type ReservarTentativaCi = (loteId: string) => Promise<unknown>;
export type DecisaoPrePostCi = {
  estado: "cobranca_existente_verificada" | "tentativa_ci_reservada" |
    "tentativa_anterior_reconciliar_manualmente";
  loteId: string;
  paymentId: string | null;
  statusBancario: string | null;
  holdObrigatorio: true;
  podeEmitirPix: false;
  podeQuitar: false;
  podeLiberarMotoboy: false;
};

function exige(condicao: boolean, motivo: string): asserts condicao {
  if (!condicao) throw new Error("COB06_HOLD_" + motivo);
}
function validarEsperado(esperado: ExpectativaAcumulo) {
  exige(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(esperado.loteId),
    "LOTE_INVALIDO");
  exige(esperado.referencia === "guia-acumulo-" + esperado.loteId,
    "REFERENCIA_INVALIDA");
  exige(/^cus_[A-Za-z0-9_-]{3,120}$/.test(esperado.clienteId),
    "CLIENTE_INVALIDO");
  exige(Number.isSafeInteger(esperado.valorCentavos) &&
    esperado.valorCentavos >= 500 && esperado.valorCentavos <= 2147483647,
    "VALOR_INVALIDO");
}
function base(estado: DecisaoPrePostCi["estado"], loteId: string):
  DecisaoPrePostCi {
  return {
    estado, loteId, paymentId: null, statusBancario: null,
    holdObrigatorio: true, podeEmitirPix: false, podeQuitar: false,
    podeLiberarMotoboy: false,
  };
}

// Ordem critica: (1) GET externo com identidade exata, (2) claim duravel CI.
// Se GET falha ou a listagem e ambigua, NAO registrar nova intencao.
// Se ja existe pagamento, nao criar claim e nao repetir POST.
// Um GET vazio so permite a reserva CI; falta autorizacao externa para POST.
export async function conciliarAntesDePixAcumuloCandidatoSomenteCi(
  esperado: ExpectativaAcumulo,
  tokenServidor: string,
  reservarTentativaCi: ReservarTentativaCi,
  fetchSeguro: FetchSeguro = fetch,
): Promise<DecisaoPrePostCi> {
  validarEsperado(esperado);
  let encontrado: string | null = null;
  try {
    encontrado = await encontrarIdPagamentoAcumuloSandboxPorReferencia(
      esperado.referencia, tokenServidor, fetchSeguro);
  } catch (e) {
    if (!(e instanceof Error &&
      e.message === "COB06_HOLD_PAGAMENTO_NAO_LOCALIZADO")) {
      // Nenhuma falha HTTP, JSON ou duplicidade pode virar permissao de emissao.
      throw new Error("COB06_HOLD_GET_INCONCLUSIVO");
    }
  }
  if (encontrado !== null) {
    const observacao = await conferirPagamentoAcumuloPorGet(
      esperado, encontrado,
      (id) => consultarPagamentoAcumuloSandboxGet(id, tokenServidor, fetchSeguro),
    );
    return {
      ...base("cobranca_existente_verificada", esperado.loteId),
      paymentId: encontrado, statusBancario: observacao.p_status,
    };
  }

  let bruto: unknown;
  try {
    bruto = await reservarTentativaCi(esperado.loteId);
  } catch {
    throw new Error("COB06_HOLD_GATE_INDISPONIVEL");
  }
  exige(bruto !== null && typeof bruto === "object" && !Array.isArray(bruto),
    "GATE_INVALIDO");
  const gate = bruto as Record<string, unknown>;
  if (gate.ok === false && gate.motivo === "tentativa_ja_iniciada" &&
    gate.nova_tentativa === false && gate.reconciliar_por_get === true &&
    gate.pode_emitir_pix === false) {
    return base("tentativa_anterior_reconciliar_manualmente", esperado.loteId);
  }
  // Recibos inesperados, inclusive uma flag positiva de dinheiro, sao HOLD.
  exige(gate.ok === true && gate.nova_tentativa === true &&
    gate.candidato_post_unico_ci === true &&
    gate.lote_id === esperado.loteId &&
    gate.referencia === esperado.referencia &&
    gate.cliente_id === esperado.clienteId &&
    gate.valor_centavos === esperado.valorCentavos &&
    typeof gate.operacao_id === "string" &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(gate.operacao_id) &&
    gate.reconciliar_por_get === true &&
    gate.prova_get_externa === false &&
    gate.autorizacao_externa === false &&
    gate.pode_emitir_pix === false &&
    gate.pode_quitar === false &&
    gate.pode_liberar_motoboy === false,
    "GATE_INVALIDO");
  return base("tentativa_ci_reservada", esperado.loteId);
}
