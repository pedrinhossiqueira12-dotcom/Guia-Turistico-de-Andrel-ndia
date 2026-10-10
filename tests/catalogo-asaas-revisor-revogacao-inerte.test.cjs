"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const migration=fs.readFileSync("supabase/pending-migrations/20261010008000_pareceres_escrow_revisores_revogacoes_inertes.sql","utf8");
const fixture=fs.readFileSync("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql","utf8");

test("cadastros experimentais nunca habilitam escrita da API nem pagamentos",()=>{
 for(const tbl of [
  "catalogo_asaas_revisores_escrow_ensaio","catalogo_asaas_revisores_escrow_revogacoes_ensaio"
 ]) {
  assert.match(migration,new RegExp("ALTER TABLE public\\."+tbl+" ENABLE ROW LEVEL SECURITY"));
  assert.match(migration,new RegExp("REVOKE ALL ON public\\."+tbl+"[\\s\\S]+?FROM PUBLIC,anon,authenticated,service_role"));
  assert.match(migration,new RegExp("GRANT SELECT ON public\\."+tbl+" TO service_role"));
  assert.doesNotMatch(migration,new RegExp("GRANT (INSERT|UPDATE|DELETE) ON public\\."+tbl));
 }
 for(const s of ["'mfa_recente_comprovado',false","'revisores_credenciados_e_autenticados',false",
 "'dupla_aprovacao_financeira',false","'pagamento_autorizado',false",
 "'liberacao_autorizada',false","'baixa_realizada',false",
 "'movimenta_dinheiro',false","'status_operacional','HOLD_OBRIGATORIO'"]) assert.ok(migration.includes(s),s);
 assert.doesNotMatch(migration,/\bPOST\s*\/transfers|\bUPDATE\s+public\.catalogo_remuneracoes_v2|\bUPDATE\s+public\.catalogo_asaas_saques/);
});

test("validade gerada pelo servidor, veto a autopatrocinio e registros append-only",()=>{
 assert.match(migration,/CHECK\(indicado_por<>revisor_id\)/);
 assert.match(migration,/NEW\.cadastrado_em:=pg_catalog\.clock_timestamp\(\)/);
 assert.match(migration,/NEW\.valido_ate:=NEW\.cadastrado_em\+interval '7 days'/);
 assert.match(migration,/NEW\.revogado_em:=pg_catalog\.clock_timestamp\(\)/);
 assert.match(migration,/CREATE TRIGGER catalogo_asaas_revisor_ensaio_imutavel[\s\S]*?BEFORE UPDATE OR DELETE/);
 assert.match(migration,/CREATE TRIGGER catalogo_asaas_revogacao_ensaio_imutavel[\s\S]*?BEFORE UPDATE OR DELETE/);
 assert.match(migration,/SELECT r\.valido_ate INTO v_validade[\s\S]*?FOR UPDATE/);
 assert.match(migration,/SELECT 1 FROM public\.catalogo_asaas_revisores_escrow_revogacoes_ensaio/);
 assert.match(migration,/AND c\.proprietario_id=NEW\.revisor_id/);
});

test("revogacao invalida parecer sem destruir prova original",()=>{
 assert.match(migration,/LEFT JOIN public\.catalogo_asaas_revisores_escrow_revogacoes_ensaio x/);
 assert.match(migration,/x\.revisor_id IS NULL/);
 assert.match(migration,/r\.valido_ate>now\(\)/);
 assert.match(migration,/count\(DISTINCT p\.revisor_id\)/);
 assert.match(migration,/'pareceres_com_revisor_revogado',v_revogados/);
 for(const m of ["Revogacao nao derrubou quorum","Revisor revogado conseguiu novo parecer",
  "Pessoa nao indicada escreveu parecer","Timestamp de revogacao foi aceito da requisicao",
  "Revogacao foi alterada","Cadastro de revisor foi apagado",
  "Cadastros de ensaio de revisores estao acessiveis"])
  assert.ok(fixture.includes(m),"Postgres fixture missing: "+m);
 assert.match(fixture,/ROLLBACK;/);
});
