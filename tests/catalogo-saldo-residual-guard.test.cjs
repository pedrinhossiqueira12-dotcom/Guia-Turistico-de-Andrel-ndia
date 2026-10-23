"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const guard = fs.readFileSync(
  "supabase/pending-migrations/20261009185000_bloquear_conclusao_saldo_residual_sem_prova.sql","utf8"
);
const table = fs.readFileSync(
  "supabase/pending-migrations/20261009160000_solicitacoes_saldo_residual_motoboy.sql","utf8"
);
const finance = fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");

test("o fluxo residual nunca envia Pix nem debita saldo", () => {
  assert.match(table, /nao sao repasses|n\u00e3o s\u00e3o repasses/i);
  assert.match(finance, /Solicita\u00e7\u00e3o administrativa de saldo residual: n\u00e3o cria saque nem chama o Asaas/);
  assert.doesNotMatch(guard,/\/transfers|http[s]?:|GRANT EXECUTE TO anon/i);
});

test("solicitacao abaixo de R$ 100 nao pode ser encerrada sem conciliacao", () => {
  assert.match(guard,/IF NEW\.status = 'concluida' THEN/);
  assert.match(guard,/comprovante de pagamento/);
  assert.match(guard,/BEFORE INSERT OR UPDATE ON public\.catalogo_asaas_saldos_residuais/);
  assert.match(guard,/RAISE EXCEPTION[\s\S]*23514/);
});

test("resposta administrativa nao pode alterar titular ou valor original", () => {
  for(const field of ["motoboy_id","saldo_snapshot_centavos","motivo","solicitado_em"])
    assert.match(guard,new RegExp("NEW\\."+field+" IS DISTINCT FROM OLD\\."+field));
  assert.match(guard,/OLD\.status IN \('concluida','recusada'\)/);
  assert.match(guard,/NEW\.status = 'recusada'/);
  assert.match(guard,/btrim\(coalesce\(NEW\.detalhe_revisao,''\)\)/);
  assert.match(guard,/REVOKE ALL ON FUNCTION catalogo_private\.catalogo_guardar_analise_residual/);
});
