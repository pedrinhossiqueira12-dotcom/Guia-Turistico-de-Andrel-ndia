"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");

const ddl=fs.readFileSync(
 "supabase/tests/isolated/catalogo-asaas-resolucao-idempotencia-race-inerte.sql","utf8");
const runner=fs.readFileSync(
 "scripts/validacao-pagamentos/test-asaas-advisory-concurrency.py","utf8");

test("#43: fixture somente no clone PostgreSQL local, sem grants financeiros",()=>{
 assert.match(ddl,/current_database\(\) IS DISTINCT FROM 'catalogo_asaas_race_ci'/);
 assert.match(ddl,/app\.catalogo_ci_escrow_race_test/);
 assert.match(ddl,/CREATE SCHEMA catalogo_ci_escrow_resolucao_inerte/);
 assert.match(ddl,/ENABLE ROW LEVEL SECURITY/);
 assert.match(ddl,/REVOKE ALL ON SCHEMA catalogo_ci_escrow_resolucao_inerte/);
 assert.match(ddl,/REVOKE ALL ON FUNCTION[\s\S]*?registrar_tentativa\(uuid,uuid,text,text\)/);
 assert.doesNotMatch(ddl,/\bGRANT\s+(?:EXECUTE|INSERT|UPDATE|DELETE)\b/i);
 assert.doesNotMatch(ddl,/\bPOST\b|api-sandbox|api\.asaas|createClient|http_post/);
});
test("#43: UNIQUE por tentativa e por reserva+versao; UPDATE e DELETE proibidos",()=>{
 assert.match(ddl,/tentativa_id uuid PRIMARY KEY/);
 assert.match(ddl,/UNIQUE\(separacao_id,fingerprint_sha256\)/);
 assert.match(ddl,/classificacao IN \('revisao','contestacao'\)/);
 assert.match(ddl,/CREATE TRIGGER no_update_delete[\s\S]*?BEFORE UPDATE OR DELETE/);
 assert.match(ddl,/CREATE FUNCTION catalogo_ci_escrow_resolucao_inerte\.proibir_mutacao/);
 assert.match(ddl,/ERRCODE='23514'/);
});
test("#43: trava compartilhada e versao autoritativa antes da consulta ao livro",()=>{
 const lock=ddl.indexOf("pg_catalog.pg_advisory_xact_lock(");
 const escrowRow=ddl.indexOf("WHERE id=p_separacao FOR UPDATE");
 const lookupAttempt=ddl.indexOf("WHERE tentativa_id=p_tentativa");
 const lookupVersion=ddl.indexOf("WHERE separacao_id=p_separacao AND fingerprint_sha256=p_fingerprint");
 const insert=ddl.indexOf("INSERT INTO catalogo_ci_escrow_resolucao_inerte.tentativas_documentais(");
 assert.ok(lock>=0&&lock<escrowRow&&escrowRow<lookupAttempt&&
  lookupAttempt<lookupVersion&&lookupVersion<insert);
 assert.match(ddl,/v_escrow\.fingerprint_sha256 IS DISTINCT FROM p_fingerprint/);
 assert.match(ddl,/v_escrow\.situacao IS DISTINCT FROM 'congelada'/);
 assert.match(ddl,/v_existente\.classificacao=p_classificacao/);
 assert.match(ddl,/v_motivo:='documento_inerte_registrado'/);
});
test("#43: todas as saidas impedem transferencia, baixa e liberacao",()=>{
 for(const flag of ["'status_operacional','HOLD_OBRIGATORIO'",
  "'movimenta_dinheiro',false","'pagamento_autorizado',false",
  "'liberacao_autorizada',false","'baixa_realizada',false"]) {
  const occurrences=ddl.split(flag).length-1;
  assert.ok(occurrences>=4,"Ausente flag permanente em algum retorno: "+flag);
 }
});
test("#43: dois operadores, replay, dados alterados, rollback e nao-grants exercitados",()=>{
 for(const name of [
  "def scenario_resolucao_documental_idempotente_concorrente()",
  "def assert_resolucao_inerte(",
  "assert_waiting_advisory(second.name)",
  'for flag in ("movimenta_dinheiro", "pagamento_autorizado"',
  'first.send("COMMIT;',
  'first.send("ROLLBACK;',
  "motivo=\"replay_idempotente_documental\"",
  "motivo=\"tentativa_reutilizada_com_outros_dados\"",
  "motivo=\"outra_tentativa_ja_registrada_na_mesma_versao\"",
  'classification="pago_comprovado"',
  "UPDATE catalogo_ci_escrow_resolucao_inerte.tentativas_documentais",
  "DELETE FROM catalogo_ci_escrow_resolucao_inerte.tentativas_documentais",
  "scenario_resolucao_documental_idempotente_concorrente()"
 ])assert.ok(runner.includes(name),"fixture Python sem "+name);
 assert.match(runner,/EXPECTED_DB = "catalogo_asaas_race_ci"/);
 assert.match(runner,/guard_environment\(\)/);
});