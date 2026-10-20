// COB-06: novo lote QA, somente valores sintéticos e sem rede.
import {
  validarPlanoNovoQa, conferirSnapshotNovoQa, LOTE_HISTORICO_BLOQUEADO,
} from "../_shared/catalogo-cob06-novo-lote-qa-preflight.ts";

const LOTE = "22222222-3333-4444-8888-bbbbbbbbbbbb";
const OPERACAO = "33333333-3333-4333-8333-cccccccccccc";
const COMERCIO = "asaas-cob06-qa-ciclo-independente";
const CORTE = "2027-04-01";
const esperado = { loteId: LOTE, comercioId: COMERCIO,
  competenciaCorte: CORTE, valorCentavos: 560 };
function check(ok: unknown, msg: string): asserts ok {
  if (!ok) throw Error("COB06_NOVO_QA_TEST: " + msg);
}
function falha(fn: () => unknown, code: string) {
  let texto = "";
  try { fn(); } catch (e) { texto = String(e); }
  check(texto.includes("COB06_NOVO_QA_HOLD_" + code), "nao recusou " + code + " / " + texto);
}
function snapshot() {
  return {
    lote: { id: LOTE, comercio_id: COMERCIO,
      competencia_corte: CORTE, total_centavos: 560, estado: "preparado" },
    referencia: { lote_id: LOTE, operacao_id: OPERACAO, comercio_id: COMERCIO,
      referencia: "guia-acumulo-" + LOTE, valor_centavos: 560,
      estado: "reservado", payment_id: null, pode_emitir_pix: false },
    cliente: { cliente_id: "cus_novoqa_12345" },
    conciliacao: { ok: true, integridade_contabil_ok: true,
      valor_fontes_centavos: 560, pode_emitir_pix: false,
      pode_quitar: false, pode_liberar_motoboy: false },
  };
}

Deno.test("COB06 novo QA: plano independente valido nao autoriza GET nem Pix", () => {
  const p = validarPlanoNovoQa({ loteId: LOTE, comercioId: COMERCIO,
    competenciaCorte: CORTE, valorCentavos: "560" });
  check(JSON.stringify(p) === JSON.stringify(esperado), "plano configurado no servidor");
  const r = conferirSnapshotNovoQa(p, snapshot());
  check(r.identidade_local_conferida === true &&
    r.ausencia_get_anterior_comprovada === false &&
    r.nova_consulta_autorizada === false &&
    r.pode_consultar_asaas === false &&
    r.pode_emitir_pix === false && r.pode_quitar === false &&
    r.pode_estornar === false && r.pode_liberar_motoboy === false &&
    r.hold_obrigatorio === true, "permisoes financeiras devem ficar fechadas");
});

Deno.test("COB06 novo QA: recusa definitivamente lote e comercio historicos", () => {
  const campos = { loteId: LOTE_HISTORICO_BLOQUEADO,
    comercioId: COMERCIO, competenciaCorte: CORTE, valorCentavos: "560" };
  falha(() => validarPlanoNovoQa(campos), "LOTE_INVALIDO_OU_HISTORICO");
  falha(() => validarPlanoNovoQa({ ...campos, loteId: LOTE,
    comercioId: "asaas-cob02" }), "COMERCIO_QA_NAO_ISOLADO");
  falha(() => validarPlanoNovoQa({ ...campos, loteId: "" }),
    "LOTE_INVALIDO_OU_HISTORICO");
});

Deno.test("COB06 novo QA: nao inventa valor, competencia nem comercio", () => {
  const base = { loteId: LOTE, comercioId: COMERCIO,
    competenciaCorte: CORTE, valorCentavos: "560" };
  for (const total of ["", "0", "499", "5.60", "2147483648", "-560", "5e2"]) {
    const codigo = /^[1-9]\d{2,9}$/.test(total) ? "VALOR_INVALIDO" :
      "VALOR_NAO_CONFIGURADO";
    falha(() => validarPlanoNovoQa({ ...base, valorCentavos: total }), codigo);
  }
  for (const competenciaCorte of ["", "2027-04-20", "2027-13-01",
    "2027-00-01", "2027-4-01"]) {
    falha(() => validarPlanoNovoQa({ ...base, competenciaCorte }), "COMPETENCIA_INVALIDA");
  }
  falha(() => validarPlanoNovoQa({ ...base, comercioId: "loja-real" }),
    "COMERCIO_QA_NAO_ISOLADO");
});

Deno.test("COB06 novo QA: toda divergencia de livro/cliente/conciliacao e HOLD", () => {
  const casos: Array<[keyof ReturnType<typeof snapshot>, string, unknown, string]> = [
    ["lote", "id", LOTE_HISTORICO_BLOQUEADO, "LOTE_DIVERGENTE"],
    ["lote", "total_centavos", 561, "LOTE_DIVERGENTE"],
    ["lote", "estado", "pago", "LOTE_DIVERGENTE"],
    ["referencia", "operacao_id", null, "REFERENCIA_DIVERGENTE"],
    ["referencia", "referencia", "guia-acumulo-outra", "REFERENCIA_DIVERGENTE"],
    ["referencia", "payment_id", "pay_jaexistente", "REFERENCIA_DIVERGENTE"],
    ["referencia", "pode_emitir_pix", true, "REFERENCIA_DIVERGENTE"],
    ["cliente", "cliente_id", "cliente-falso", "CLIENTE_QA_INVALIDO"],
    ["conciliacao", "ok", false, "FONTES_NAO_CONFERIDAS"],
    ["conciliacao", "valor_fontes_centavos", 559, "FONTES_NAO_CONFERIDAS"],
    ["conciliacao", "pode_quitar", true, "FONTES_NAO_CONFERIDAS"],
    ["conciliacao", "pode_liberar_motoboy", true, "FONTES_NAO_CONFERIDAS"],
  ];
  for (const [secao, campo, valor, motivo] of casos) {
    const r = snapshot();
    (r[secao] as Record<string, unknown>)[campo] = valor;
    falha(() => conferirSnapshotNovoQa(esperado, r), motivo);
  }
});
