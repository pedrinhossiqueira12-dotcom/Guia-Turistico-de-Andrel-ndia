"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const sql=fs.readFileSync(
 "supabase/pending-migrations/20261010009000_preflight_sessao_mfa_revisor_inerte.sql","utf8");
const mock=fs.readFileSync(
 "supabase/tests/baseline/catalogo-asaas-auth-mfa-ephemeral.sql","utf8");
const fixture=fs.readFileSync(
 "supabase/tests/isolated/catalogo-asaas-preflight-mfa-inerte-postgres.sql","utf8");
const workflow=fs.readFileSync(".github/workflows/database-tests.yml","utf8");

test("preflight MFA so retorna autochecagem, nunca cria direito financeiro",()=>{
 assert.match(sql,/CREATE FUNCTION public\.catalogo_asaas_preflight_sessao_revisor_inerte\(\)/);
 assert.match(sql,/LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''/);
 assert.doesNotMatch(sql,/CREATE FUNCTION public\.catalogo_asaas_preflight_sessao_revisor_inerte\([^)]+\)/);
 for (const field of [
  "'mfa_com_desafio_recente_comprovado',false",
  "'revisor_real_credenciado',false","'apto_a_registrar_parecer',false",
  "'dupla_aprovacao_financeira',false",
  "'pagamento_autorizado',false","'baixa_realizada',false",
  "'liberacao_autorizada',false","'movimenta_dinheiro',false",
  "'status_operacional','HOLD_OBRIGATORIO'"])
  assert.ok(sql.includes(field),field);
 assert.doesNotMatch(sql,/\bUPDATE public\.|\bDELETE FROM public\.|\bINSERT INTO public\./);
});
test("identidade vem do JWT verificado pelo gateway e tabela de sessao, nao payload",()=>{
 for (const fragment of [
  "v_user_id:=auth.uid()", "v_jwt:=auth.jwt()",
  "v_jwt->>'sub' IS DISTINCT FROM v_user_id::text",
  "v_jwt->>'role' IS DISTINCT FROM 'authenticated'",
  "v_jwt->>'aal' IS DISTINCT FROM 'aal2'",
  "s.id=v_session_id","s.user_id=v_user_id","s.aal::text='aal2'",
  "s.factor_id IS NOT NULL",
  "s.not_after IS NULL OR s.not_after>pg_catalog.now()",
  "u.banned_until IS NULL OR u.banned_until<=pg_catalog.now()",
  "v_iat>=v_now-300","v_exp>v_now","r.revisor_id=v_user_id"])
  assert.ok(sql.includes(fragment),fragment);
 assert.doesNotMatch(sql,/raw_user_meta_data|user_metadata/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.catalogo_asaas_preflight_sessao_revisor_inerte\(\)[\s\S]+?FROM PUBLIC,anon,authenticated,service_role/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.catalogo_asaas_preflight_sessao_revisor_inerte\(\)[\s\S]+?TO authenticated/);
 assert.doesNotMatch(sql,/GRANT EXECUTE ON FUNCTION public\.catalogo_asaas_preflight_sessao_revisor_inerte\(\)[\s\S]+?TO service_role/);
});
test("simulador de Auth nao pode aparecer como migration nem rodar em Supabase remoto",()=>{
 assert.match(mock,/current_database\(\)<>'catalogo_asaas_guards_ci'/);
 assert.match(mock,/app\.catalogo_ci_mfa_mock/);
 assert.match(mock,/CREATE TABLE auth\.sessions/);
 assert.match(mock,/CREATE FUNCTION auth\.jwt\(\)/);
 assert.match(workflow,/catalogo-asaas-auth-mfa-ephemeral\.sql/);
 assert.match(workflow,/catalogo-asaas-preflight-mfa-inerte-postgres\.sql/);
 assert.match(workflow,/createdb --template=catalogo_ci catalogo_asaas_guards_ci/);
 assert.match(fixture,/current_database\(\)<>'catalogo_asaas_guards_ci'/);
 assert.match(fixture,/app\.catalogo_ci_mfa_test/);
 assert.match(fixture,/SET LOCAL ROLE authenticated/);
 assert.match(fixture,/ROLLBACK;/);
});
test("teste no PostgreSQL cobre variacoes perigosas do token sem criar autorizacao",()=>{
 for (const phrase of [
 "Sessao sem JWT passou no preflight","Preflight AAL2 nao deveria significar autorizacao",
 "AAL1 aceito","JWT antigo aceito","JWT de outro usuario aceito",
 "Identidade anonima aceitou revisao AAL2","Sessao inexistente aceita",
 "Indicacao de laboratorio virou autoridade","Revogacao nao invalidou elegibilidade"])
 assert.ok(fixture.includes(phrase),phrase);
});
