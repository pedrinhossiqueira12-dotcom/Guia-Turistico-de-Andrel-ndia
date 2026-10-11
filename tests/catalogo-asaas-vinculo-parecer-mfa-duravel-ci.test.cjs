"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const sql=fs.readFileSync(
 "supabase/tests/isolated/catalogo-asaas-vinculo-parecer-mfa-duravel-ci.sql","utf8");
const runner=fs.readFileSync(
 "scripts/validacao-pagamentos/test-asaas-advisory-concurrency.py","utf8");

test("#42: SQL de vinculo persistente aceita APENAS CI isolada e nunca o app",()=>{
 for(const marker of [
  "current_database() IS DISTINCT FROM 'catalogo_asaas_race_ci'",
  "current_setting('app.catalogo_ci_vinculo_test',true)",
  "session_user IS DISTINCT FROM 'postgres'",
  "CREATE SCHEMA catalogo_ci_vinculo_mfa_inerte",
  "REVOKE ALL ON SCHEMA catalogo_ci_vinculo_mfa_inerte",
  "ALTER TABLE catalogo_ci_vinculo_mfa_inerte.intencoes_ci ENABLE ROW LEVEL SECURITY",
  "ALTER TABLE catalogo_ci_vinculo_mfa_inerte.observacoes_ci ENABLE ROW LEVEL SECURITY",
  "REVOKE ALL ON ALL TABLES IN SCHEMA catalogo_ci_vinculo_mfa_inerte"
 ])assert.ok(sql.includes(marker),marker);
 assert.doesNotMatch(sql,/\bGRANT\s+(?:EXECUTE|INSERT|UPDATE|DELETE)\b/i);
 assert.doesNotMatch(sql,/https?:\/\/|fetch\(|http_post\(|\/transfers|\/payments/i);
});
test("#42: uma intenção por revisor/escrow e desafio único; append-only",()=>{
 for(const marker of [
  "CREATE TABLE catalogo_ci_vinculo_mfa_inerte.dossies_ci",
  "CREATE TABLE catalogo_ci_vinculo_mfa_inerte.intencoes_ci",
  "CREATE TABLE catalogo_ci_vinculo_mfa_inerte.observacoes_ci",
  "UNIQUE(separacao_id,revisor_id)",
  "UNIQUE(id,revisor_id,sessao_id,fator_id)",
  "challenge_id uuid NOT NULL UNIQUE",
  "FOREIGN KEY(intencao_id,revisor_id,sessao_id,fator_id)",
  "CREATE TRIGGER intencao_ci_imutavel BEFORE UPDATE OR DELETE",
  "CREATE TRIGGER observacao_ci_imutavel BEFORE UPDATE OR DELETE",
  "CREATE FUNCTION catalogo_ci_vinculo_mfa_inerte.reservar_ci(",
  "CREATE FUNCTION catalogo_ci_vinculo_mfa_inerte.observar_ci(",
  "CREATE FUNCTION catalogo_ci_vinculo_mfa_inerte.diagnosticar_ci("
 ])assert.ok(sql.includes(marker),marker);
});
test("#42: verifica sessão mock, titular, versão e bloqueios antes das escritas",()=>{
 const reserva=sql.slice(sql.indexOf(
  "CREATE FUNCTION catalogo_ci_vinculo_mfa_inerte.reservar_ci("),
  sql.indexOf("CREATE FUNCTION catalogo_ci_vinculo_mfa_inerte.observar_ci("));
 const obs=sql.slice(sql.indexOf(
  "CREATE FUNCTION catalogo_ci_vinculo_mfa_inerte.observar_ci("),
  sql.indexOf("CREATE FUNCTION catalogo_ci_vinculo_mfa_inerte.diagnosticar_ci("));
 for(const f of [reserva,obs]){
  const advisory=f.indexOf("pg_catalog.pg_advisory_xact_lock(");
  const alter=f.indexOf("INSERT INTO catalogo_ci_vinculo_mfa_inerte");
  assert.ok(advisory>=0&&alter>advisory);
  for(const word of [
   "WHERE id=p_separacao FOR UPDATE",
   "FOR SHARE",
   "'status_operacional','HOLD_OBRIGATORIO'",
   "'mfa_real_validado',false",
   "'pode_pagar',false",
   "'pode_liberar',false",
   "'movimenta_dinheiro',false"
  ])if(word!=="WHERE id=p_separacao FOR UPDATE"||f===reserva)
   assert.ok(f.includes(word),"Missing "+word);
 }
 for(const x of ["v_doc.versao","v_doc.hash_sha256",
  "v_escrow.fingerprint_sha256","p_revisor=v_owner",
  "v_cred.situacao IS DISTINCT FROM 'habilitado'",
  "v_sess.aal_mock IS DISTINCT FROM 'aal2'",
  "v_sess.fator_estado_mock IS DISTINCT FROM 'verified'",
  "v_sess.revogada_em IS NOT NULL"
 ])assert.ok(reserva.includes(x),x);
 for(const x of ["v_binding.revisor_id IS DISTINCT FROM p_revisor",
  "v_binding.sessao_id IS DISTINCT FROM p_sessao",
  "v_binding.fator_id IS DISTINCT FROM p_fator",
  "v_doc.versao IS DISTINCT FROM v_binding.dossie_versao",
  "v_doc.hash_sha256 IS DISTINCT FROM v_binding.dossie_hash_sha256",
  "v_binding.criada_em<=pg_catalog.clock_timestamp()-interval '2 minutes'",
  "'replay_ou_challenge_usado'"
 ])assert.ok(obs.includes(x),x);
 assert.doesNotMatch(reserva+obs,/\b(?:UPDATE|DELETE)\s+(?:public\.)?catalogo_asaas_/i);
});
test("#42: 2 sessões reais conferem replay, revogação, mudança de versão e zero Pix",()=>{
 for(const marker of [
  "def scenario_vinculo_pareceres_duravel_versao_concorrente()",
  "scenario_vinculo_pareceres_duravel_versao_concorrente()",
  "catalogo-asaas-vinculo-parecer-mfa-duravel-ci.sql",
  "ci_vinculo_prepare_first",
  "ci_vinculo_prepare_second",
  "ci_vinculo_observe_first",
  "ci_vinculo_observe_second",
  "ci_vinculo_observe_rollback_first",
  "ci_vinculo_observe_rollback_second",
  "CI_OBSERVE_B_ROLLED_BACK",
  "CI_OBSERVE_B_COMMITTED",
  "assert_waiting_advisory(second.name)",
  "vinculo_ja_reservado",
  "replay_ou_challenge_usado",
  "SET situacao='revogado'",
  "SET versao=2,hash_sha256=repeat('e',64)",
  "DELETE FROM catalogo_ci_vinculo_mfa_inerte.observacoes_ci",
  "has_function_privilege('service_role'",
  "journal documental CI persistente"
 ])assert.ok(runner.includes(marker),marker);
});
