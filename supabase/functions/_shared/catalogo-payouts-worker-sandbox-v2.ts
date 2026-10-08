/**
 * Etapa 3B: orquestração SERVIDOR + SANDBOX sem rota pública nem cron ativo.
 *
 * O armazenamento deve consultar catalogo_payout_intents_v2 usando APENAS
 * credenciais service_role no servidor; nunca aceitar snapshot do navegador.
 * A integração de produção continua sem autorização e sem assinatura Ed25519.
 * Erro/timeout depois de marcar uma tentativa NÃO autoriza novo POST.
 */
import { decryptCourierPix } from "./catalogo-entregas-crypto-v2.ts";
import {
  prepararPayoutSandbox, criarPayoutSandbox,
  consultarTransacaoSandbox, classificarTransacaoPayout,
  type PayoutTransport, type PayoutPixType,
} from "./catalogo-payouts-sandbox-v2.ts";

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type PayoutBancoSnapshot = {
  id: string;
  solicitacao_id: string;
  motoboy_id: string;
  valor_centavos: number;
  pix_tipo: PayoutPixType;
  chave_pix_enc_snapshot: string;
  idempotency_key: string;
  referencia_externa: string;
  status: string;
  payout_id: string | null;
  transacao_id: string | null;
};
export interface PayoutBancoPrivado {
  /** Obrigatoriamente SELECT da tabela restrita usando service_role. */
  carregarIntent(id: string): Promise<PayoutBancoSnapshot | null>;
  /** Obrigatoriamente RPC em backend service_role, nunca browser. */
  rpc(nome: string, argumentos: Record<string, unknown>):
    Promise<{ data: Record<string, unknown> | null; error: unknown | null }>;
}
export type PayoutSandboxCredenciais = {
  testAccessToken: string;
  testApproved: boolean;
  transport: PayoutTransport;
};
function protegerId(id: string): string {
  if (!ID_RE.test(id)) throw new Error("Identificador de intent inválido.");
  return id.toLowerCase();
}
function checarSnapshot(intentId: string, s: PayoutBancoSnapshot | null): PayoutBancoSnapshot {
  if (!s || protegerId(s.id) !== intentId || !ID_RE.test(s.solicitacao_id) ||
      !ID_RE.test(s.motoboy_id) || s.idempotency_key.toLowerCase() !== s.solicitacao_id.toLowerCase() ||
      s.referencia_externa !== "saque_" + s.solicitacao_id.replaceAll("-", "").toLowerCase() ||
      !Number.isSafeInteger(s.valor_centavos) || s.valor_centavos < 100) {
    throw new Error("Snapshot financeiro inconsistente: não executar transferência.");
  }
  return s;
}
async function chamadaPrivada(
  banco: PayoutBancoPrivado, funcao: string, args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await banco.rpc(funcao, args);
  if (result.error || result.data?.ok !== true) {
    throw new Error("Operação SQL privada falhou: " + funcao +
      ". Não fazer retry do POST e consultar o histórico.");
  }
  return result.data;
}

/**
 * Executa NO MÁXIMO UMA tentativa e deixa a intenção aguardando GET.
 * NÃO marca nenhum crédito como pago. Se POST falhar, a tentativa permanece
 * no banco como em_envio para reconciliação manual/consulta posterior.
 */
export async function iniciarPayoutSandbox(
  intentId: string, banco: PayoutBancoPrivado,
  options: PayoutSandboxCredenciais & { chaveCriptografia: string },
): Promise<{ estado: "aguardando_confirmacao"; payoutId: string; transacaoId: string }> {
  if (options.testApproved !== true) throw new Error("Payouts Sandbox desabilitado.");
  const id = protegerId(intentId);
  const snapshot = checarSnapshot(id, await banco.carregarIntent(id));
  if (snapshot.status !== "reservado" || snapshot.payout_id || snapshot.transacao_id) {
    throw new Error("Intent já iniciada: apenas conciliar, nunca reenviar POST.");
  }
  // Validar a chave encriptada ANTES de alterar a intenção persistente.
  const chave = await decryptCourierPix(
    snapshot.chave_pix_enc_snapshot, options.chaveCriptografia, snapshot.motoboy_id);
  const prepared = prepararPayoutSandbox({
    saqueId: snapshot.solicitacao_id, valorCentavos: snapshot.valor_centavos,
    pixType: snapshot.pix_tipo, chavePix: chave,
  });
  if (prepared.externalReference !== snapshot.referencia_externa ||
      prepared.idempotencyKey !== snapshot.idempotency_key.toLowerCase()) {
    throw new Error("Chave de idempotência divergente: envio bloqueado.");
  }
  await chamadaPrivada(banco, "catalogo_marcar_envio_payout_v2", { p_intent_id: id });
  // A partir deste ponto o POST pode ter ocorrido. Não tentar novamente sozinho!
  const data = await criarPayoutSandbox(prepared, {
    testAccessToken: options.testAccessToken,
    transport: options.transport,
    testApproved: true,
  });
  await chamadaPrivada(banco, "catalogo_registrar_criacao_payout_v2", {
    p_intent_id: id, p_payout_id: data.payoutId, p_transacao_id: data.transactionId,
  });
  return { estado: "aguardando_confirmacao", payoutId: data.payoutId, transacaoId: data.transactionId };
}

/**
 * Consulta GET autenticado do provedor e só então envia FATOS verificados
 * para a RPC transacional. Sem HTTP 202 => pago, sem webhook cego.
 */
export async function conciliarPayoutSandbox(
  intentId: string, banco: PayoutBancoPrivado, options: PayoutSandboxCredenciais,
): Promise<{ classificacao: "confirmado" | "em_processamento" | "falhou";
  transferenciaConfirmada: boolean }> {
  if (options.testApproved !== true) throw new Error("Conciliação Sandbox desabilitada.");
  const id = protegerId(intentId);
  const snapshot = checarSnapshot(id, await banco.carregarIntent(id));
  if (!snapshot.payout_id || !snapshot.transacao_id ||
      !["aguardando_confirmacao", "confirmado"].includes(snapshot.status)) {
    throw new Error("Payout sem IDs válidos ou em estado de revisão.");
  }
  const provider = await consultarTransacaoSandbox({
    payoutId: snapshot.payout_id, transactionId: snapshot.transacao_id,
  }, {
    testAccessToken: options.testAccessToken,
    transport: options.transport,
    testApproved: true,
  });
  const expectedRef = "motoboy_" + snapshot.solicitacao_id.replaceAll("-", "").toLowerCase();
  const classificacao = classificarTransacaoPayout(provider, {
    transactionId: snapshot.transacao_id,
    externalReference: expectedRef,
    valorCentavos: snapshot.valor_centavos,
  });
  if (classificacao === "revisar") {
    throw new Error("Prova do provedor divergente: revisão financeira obrigatória.");
  }
  const data = await chamadaPrivada(banco, "catalogo_conciliar_payout_v2", {
    p_intent_id: snapshot.id,
    p_payout_id: snapshot.payout_id,
    p_transacao_id: snapshot.transacao_id,
    p_referencia_externa: snapshot.referencia_externa,
    p_referencia_transacao: expectedRef,
    p_valor_centavos: snapshot.valor_centavos,
    p_status: provider.status,
    p_status_detail: provider.status_detail,
  });
  const confirmado = data.transferencia_confirmada === true;
  if (confirmado !== (classificacao === "confirmado")) {
    throw new Error("Divergência entre confirmação do provedor e lançamento SQL.");
  }
  return { classificacao, transferenciaConfirmada: confirmado };
}
