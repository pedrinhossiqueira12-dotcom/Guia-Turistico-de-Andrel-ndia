import { montarAuditoriaBaixaAcumuloInerte } from
  "../_shared/catalogo-asaas-acumulo-auditoria-baixa-inerte.ts";

const lote = "22222222-3333-4444-8888-aaaaaaaaaaaa";
const esperado = { loteId: lote, referencia: "guia-acumulo-" + lote,
  clienteId: "cus_cob06_auditoria123", valorCentavos: 500 };
const get = { p_lote: lote, p_payment: "pay_cob06_auditoria123",
  p_customer: esperado.clienteId, p_referencia: esperado.referencia,
  p_valor: 500, p_status: "RECEIVED" };
const apuracao = { ok: true, lote_id: lote, valor_centavos: 500,
  integridade_contabil_ok: true, identidade_local_ok: true,
  exige_revisao: false, classificacao: "recebimento_observado_pendente_de_prova_e_conciliacao",
  prova_bancaria_autonoma: false, pode_emitir_pix: false,
  pode_quitar: false, pode_estornar: false, pode_liberar_motoboy: false };
const projecao = { ok: true, lote_id: lote, valor_centavos: 500,
  quantidade_competencias: 2, pedidos: 2, parcelas: 4,
  plataforma_centavos: 357, logistica_centavos: 143,
  parcelas_sem_credito_seguro: 0, parcelas_ja_liberadas: 0,
  projecao_contabil_consistente: true,
  helper_legado_incompativel_sem_cobranca_individual: true,
  pode_emitir_pix: false, pode_quitar: false, pode_estornar: false,
  pode_liberar_motoboy: false,
  origens: [
    { fechamento_id: "11111111-2222-4333-8444-555555555551",
      competencia: "2040-03-01", total_centavos: 100,
      plataforma_centavos: 71, logistica_centavos: 29,
      pedidos: 1, parcelas: 2, parcelas_sem_credito_seguro: 0,
      parcelas_ja_liberadas: 0 },
    { fechamento_id: "11111111-2222-4333-8444-555555555552",
      competencia: "2040-04-01", total_centavos: 400,
      plataforma_centavos: 286, logistica_centavos: 114,
      pedidos: 1, parcelas: 2, parcelas_sem_credito_seguro: 0,
      parcelas_ja_liberadas: 0 },
  ] };

function exige(condicao: unknown, motivo: string) {
  if (!condicao) throw Error("COB06_TESTE_" + motivo);
}
function deveBloquear(acao: () => unknown, motivo: string) {
  let bloqueou = false;
  try { acao(); } catch (e) {
    bloqueou = String(e).includes("COB06_HOLD_AUDITORIA_BAIXA_");
  }
  exige(bloqueou, motivo);
}

Deno.test("COB06 auditoria: R$1 + R$4 com componentes exatos nao libera saldo", () => {
  const r = montarAuditoriaBaixaAcumuloInerte(esperado, get, apuracao, projecao);
  exige(r.success && r.valor_centavos === 500 &&
    r.plataforma_centavos === 357 && r.logistica_centavos === 143 &&
    r.quantidade_competencias === 2 && r.competencias.length === 2 &&
    r.competencias[0].competencia === "2040-03-01" &&
    r.competencias[1].competencia === "2040-04-01" &&
    r.pode_quitar === false && r.pode_estornar === false &&
    r.pode_liberar_motoboy === false && r.pode_emitir_pix === false &&
    r.hold_obrigatorio === true && r.prova_bancaria_autonoma === false,
    "relatorio deveria permanecer inerte");
});

Deno.test("COB06 auditoria: REFUNDED exige revisao, nunca estorna automaticamente", () => {
  const r = montarAuditoriaBaixaAcumuloInerte(esperado,
    { ...get, p_status: "REFUNDED" },
    { ...apuracao, exige_revisao: true,
      classificacao: "reversao_ou_disputa_irreversivel_sem_analise" },
    { ...projecao, projecao_contabil_consistente: false });
  exige(r.exige_revisao === true &&
    r.projecao_contabil_consistente === false && r.pode_estornar === false,
    "reembolso nao e permissao financeira");
});

Deno.test("COB06 auditoria: identidade, valor e permissao divergentes sao HOLD", () => {
  deveBloquear(() => montarAuditoriaBaixaAcumuloInerte(esperado,
    { ...get, p_customer: "cus_outro_123" }, apuracao, projecao), "cliente estranho");
  deveBloquear(() => montarAuditoriaBaixaAcumuloInerte(esperado,get,
    { ...apuracao, lote_id: "00000000-0000-4000-8000-000000000000" },projecao),
    "lote local estranho");
  deveBloquear(() => montarAuditoriaBaixaAcumuloInerte(esperado,get,
    { ...apuracao, pode_quitar: true },projecao), "RPC positiva");
  deveBloquear(() => montarAuditoriaBaixaAcumuloInerte(esperado,get,
    apuracao,{ ...projecao, prova_bancaria_autonoma: true, pode_estornar: true }),
    "RPC de estorno positiva");
});

Deno.test("COB06 auditoria: duplicidade, mes adulterado e centavos incompletos falham", () => {
  const origens = projecao.origens;
  deveBloquear(() => montarAuditoriaBaixaAcumuloInerte(esperado,get,apuracao,
    { ...projecao, origens: [origens[0], { ...origens[1], competencia: "2040-03-01" }] }),
    "mes repetido");
  deveBloquear(() => montarAuditoriaBaixaAcumuloInerte(esperado,get,apuracao,
    { ...projecao, origens: [origens[0], { ...origens[1], total_centavos: 401 }] }),
    "R$5,01 indevido");
  deveBloquear(() => montarAuditoriaBaixaAcumuloInerte(esperado,get,apuracao,
    { ...projecao, origens: [origens[0]] }), "origem ausente");
  deveBloquear(() => montarAuditoriaBaixaAcumuloInerte(esperado,get,apuracao,
    { ...projecao, origens: [origens[0], { ...origens[1], parcelas_ja_liberadas: 4 }] }),
    "parcelas liberadas acima do total");
});
