"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path="supabase/pending-migrations/20261010010000_preflight_mfa_desafio_fator_sem_prova_sessao.sql";
const s=fs.readFileSync(path,"utf8");
const fixture=fs.readFileSync("supabase/tests/isolated/catalogo-asaas-preflight-mfa-inerte-postgres.sql","utf8");
const mock=fs.readFileSync("supabase/tests/baseline/catalogo-asaas-auth-mfa-ephemeral.sql","utf8");

test("MFA verificado no fator NAO prova verificacao na sessao do revisor",()=>{
 for(const x of [
  "'desafio_recente_observado_no_fator_sem_vinculo_sessao',v_factor_challenge_observed",
  "'desafio_recente_comprovado_na_sessao_atual',false",
  "'mfa_com_desafio_recente_comprovado',false",
  "'revisor_real_credenciado',false","'apto_a_registrar_parecer',false",
  "'dupla_aprovacao_financeira',false","'pagamento_autorizado',false",
  "'baixa_realizada',false","'liberacao_autorizada',false",
  "'movimenta_dinheiro',false","'status_operacional','HOLD_OBRIGATORIO'"
 ]) assert.ok(s.includes(x),"Ausente sinal fail-closed "+x);
 assert.match(s,/CREATE OR REPLACE FUNCTION public\.catalogo_asaas_preflight_sessao_revisor_inerte\(\)/);
 assert.match(s,/SECURITY DEFINER SET search_path=''/);
 assert.doesNotMatch(s,/\bINSERT INTO public\.|\bUPDATE public\.|\bDELETE FROM public\.|\bPOST\s*\/transfers/);
});
test("consulta limita usuario/fator TOTP e janela do verified_at de Auth",()=>{
 for(const x of [
  "JOIN auth.mfa_factors f ON f.id=ch.factor_id",
  "JOIN auth.sessions s ON s.factor_id=f.id",
  "s.id=v_session_id","s.user_id=v_user_id","f.user_id=v_user_id",
  "f.status::text='verified'","f.factor_type::text='totp'",
  "ch.verified_at IS NOT NULL",
  "ch.verified_at>=pg_catalog.now()-interval '2 minutes'",
  "ch.verified_at<=pg_catalog.now()+interval '30 seconds'",
  "ch.verified_at>=ch.created_at",
  "ch.verified_at<=ch.created_at+interval '10 minutes'"
 ]) assert.ok(s.includes(x),"Faltou predicado "+x);
 assert.match(s,/REVOKE ALL ON FUNCTION public\.catalogo_asaas_preflight_sessao_revisor_inerte\(\)[\s\S]*?FROM PUBLIC,anon,authenticated,service_role/);
 assert.match(s,/GRANT EXECUTE ON FUNCTION public\.catalogo_asaas_preflight_sessao_revisor_inerte\(\)[\s\S]*?TO authenticated/);
});
test("Auth mock nao simula assinatura nem session_id do desafio",()=>{
 assert.match(mock,/CREATE TABLE auth\.mfa_factors/);
 assert.match(mock,/CREATE TABLE auth\.mfa_challenges/);
 assert.match(mock,/verified_at timestamptz/);
 assert.doesNotMatch(mock,/CREATE TABLE auth\.mfa_challenges[^;]*session_id/);
 assert.match(mock,/current_database\(\)<>'catalogo_asaas_guards_ci'/);
});
test("SQL isolated real cobre prova de fator de outra conta, atual e obsoleta",()=>{
 for(const msg of ["Desafio MFA de outro usuario aceito",
 "Challenge verificado no fator autorizou indevidamente",
 "Challenge MFA antigo aceito por JWT renovado",
 "Desafio de outra sessao com mesmo fator virou autorizacao",
 "PASS: verified_at de factor recente e observavel"])
 assert.ok(fixture.includes(msg),msg);
 assert.match(fixture,/SET LOCAL ROLE authenticated/);
 assert.match(fixture,/ROLLBACK;/);
});
