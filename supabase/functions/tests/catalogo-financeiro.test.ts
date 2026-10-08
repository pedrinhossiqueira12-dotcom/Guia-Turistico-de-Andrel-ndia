import { normalizeFinancialSnapshot } from "../_shared/catalogo-pagamentos-v2.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function rejects(action: () => unknown, message: string) {
  try { action(); } catch { return; }
  throw new Error(message);
}

function snapshot(versao: number, subtotal: number, modalidade: string, novo = true) {
  const motoboy = versao === 2 && modalidade === "entrega" ? Math.round(subtotal * 0.02) : 0;
  const plataforma = versao === 1
    ? Math.round(subtotal * 0.05)
    : modalidade === "entrega"
      ? (novo ? Math.round(subtotal * 0.07) - motoboy : Math.round(subtotal * 0.05))
      : Math.round(subtotal * 0.07);
  return { versao_financeira: versao, taxa_plataforma_centavos: plataforma,
    taxa_motoboy_centavos: motoboy, taxa_total_centavos: plataforma + motoboy,
    somente_pix: false, ativo: versao === 2 };
}

Deno.test("V2 entrega: 7% arredondados uma vez para 10000 subtotais", () => {
  for (let subtotal = 1; subtotal <= 10000; subtotal++) {
    const raw = snapshot(2, subtotal, "entrega");
    const result = normalizeFinancialSnapshot(raw, "entrega", subtotal);
    assert(result.taxa_total_centavos === Math.round(subtotal * 0.07), "Total incorreto: " + subtotal);
    assert(result.taxa_motoboy_centavos === Math.round(subtotal * 0.02), "Motoboy incorreto: " + subtotal);
  }
});

Deno.test("V2 historico: aceita snapshots anteriores sem recalcular taxas", () => {
  for (const subtotal of [8, 22, 30, 101, 10000]) {
    const old = snapshot(2, subtotal, "entrega", false);
    const result = normalizeFinancialSnapshot(old, "entrega", subtotal);
    assert(result.taxa_total_centavos === old.taxa_total_centavos, "Snapshot historico alterado");
  }
});

Deno.test("Retirada e consumo local: 7% para plataforma e zero para motoboy", () => {
  for (const modalidade of ["retirada", "consumo_local"]) {
    for (const subtotal of [1, 8, 30, 101, 10000]) {
      const result = normalizeFinancialSnapshot(snapshot(2, subtotal, modalidade), modalidade, subtotal);
      assert(result.taxa_plataforma_centavos === Math.round(subtotal * 0.07), "Plataforma incorreta");
      assert(result.taxa_motoboy_centavos === 0, "Motoboy indevido");
    }
  }
});

Deno.test("V1: preserva regra historica de 5%", () => {
  for (const subtotal of [1, 30, 101, 10000]) {
    const result = normalizeFinancialSnapshot(snapshot(1, subtotal, "entrega"), "entrega", subtotal);
    assert(result.taxa_total_centavos === Math.round(subtotal * 0.05), "V1 alterada");
  }
});

Deno.test("Rejeita snapshots adulterados ou incoerentes", () => {
  const base = snapshot(2, 10000, "entrega");
  rejects(() => normalizeFinancialSnapshot({ ...base, taxa_total_centavos: 701 }, "entrega", 10000), "Total adulterado aceito");
  rejects(() => normalizeFinancialSnapshot({ ...base, taxa_motoboy_centavos: 300 }, "entrega", 10000), "Motoboy adulterado aceito");
  rejects(() => normalizeFinancialSnapshot({ ...base, taxa_plataforma_centavos: -1 }, "entrega", 10000), "Taxa negativa aceita");
  rejects(() => normalizeFinancialSnapshot(snapshot(2, 10000, "entrega"), "retirada", 10000), "Entrega aceita como retirada");
});
