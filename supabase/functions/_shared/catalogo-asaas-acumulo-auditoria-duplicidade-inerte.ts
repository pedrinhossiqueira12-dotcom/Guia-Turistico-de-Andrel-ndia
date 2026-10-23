// COB-06: consulta pontual de duplicidade no Asaas Sandbox, SEM escrita.
// Nem um GET negativo (mesmo completo) autoriza POST, saque ou quitacao.
import {
  encontrarIdPagamentoAcumuloSandboxPorReferencia,
  consultarPagamentoAcumuloSandboxGet,
} from "./catalogo-asaas-acumulo-get-sandbox-inerte.ts";
import { conferirPagamentoAcumuloPorGet } from "./catalogo-asaas-acumulo-get-verificado-inerte.ts";
import type { ExpectativaAcumulo } from "./catalogo-asaas-acumulo-get-verificado-inerte.ts";
import type { EvidenciaGetNegativa } from "./catalogo-asaas-acumulo-get-sandbox-inerte.ts";

type FetchSeguro = typeof fetch;
export type AuditoriaDuplicidadeAcumulo = {
  estado: "nenhuma_cobranca_localizada" | "cobranca_existente_verificada";
  paymentId: string | null;
  statusBancario: string | null;
  evidenciaGetNegativa: EvidenciaGetNegativa | null;
  holdObrigatorio: true;
  podeEmitirPix: false;
  podeQuitar: false;
  podeLiberarMotoboy: false;
};

export async function auditarDuplicidadeAcumuloSomenteGet(
  esperado: ExpectativaAcumulo,
  tokenServidor: string,
  fetchSeguro: FetchSeguro = fetch,
): Promise<AuditoriaDuplicidadeAcumulo> {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(esperado.loteId) ||
    esperado.referencia !== "guia-acumulo-" + esperado.loteId ||
    !/^cus_[A-Za-z0-9_-]{3,120}$/.test(esperado.clienteId) ||
    !Number.isSafeInteger(esperado.valorCentavos) ||
    esperado.valorCentavos < 500 || esperado.valorCentavos > 2147483647)
    throw new Error("COB06_HOLD_IDENTIDADE_INVALIDA");

  let paymentId: string;
  let negativa: EvidenciaGetNegativa | null = null;
  try {
    paymentId = await encontrarIdPagamentoAcumuloSandboxPorReferencia(
      esperado.referencia, tokenServidor, fetchSeguro,
      (dados) => { negativa = dados; });
  } catch (erro) {
    if (erro instanceof Error && erro.message === "COB06_HOLD_PAGAMENTO_NAO_LOCALIZADO")
      return {
        estado: "nenhuma_cobranca_localizada", paymentId: null, statusBancario: null,
        evidenciaGetNegativa: negativa,
        holdObrigatorio: true, podeEmitirPix: false, podeQuitar: false,
        podeLiberarMotoboy: false,
      };
    throw new Error("COB06_HOLD_GET_INCONCLUSIVO");
  }

  let observacao;
  try {
    observacao = await conferirPagamentoAcumuloPorGet(esperado, paymentId,
      (id) => consultarPagamentoAcumuloSandboxGet(id, tokenServidor, fetchSeguro));
  } catch {
    throw new Error("COB06_HOLD_GET_INCONCLUSIVO");
  }
  return {
    estado: "cobranca_existente_verificada", paymentId,
    statusBancario: observacao.p_status, evidenciaGetNegativa: null,
    holdObrigatorio: true, podeEmitirPix: false, podeQuitar: false,
    podeLiberarMotoboy: false,
  };
}
