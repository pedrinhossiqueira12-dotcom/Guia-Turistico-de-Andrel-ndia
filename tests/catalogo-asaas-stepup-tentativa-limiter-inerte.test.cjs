"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const migration=fs.readFileSync("supabase/pending-migrations/20261010013000_tentativa_stepup_unica_limiter_inerte.sql","utf8");
const fixture=fs.readFileSync("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql","utf8");

test("tentativa persistente nao e desafio MFA validado nem autoriza dinheiro",()=>{
 for(const token of [
 "challenge_id uuid PRIMARY KEY",
 "nonce uuid NOT NULL UNIQUE",
 "resultado text NOT NULL CHECK(resultado='tentativa_reservada_sem_verificacao')",
 "'desafio_mfa_da_sessao_comprovado',false",
 "'verificacao_otp_realizada',false",
 "'pode_registrar_parecer',false",
 "'pagamento_autorizado',false",
 "'dupla_aprovacao_financeira',false",
 "'liberacao_autorizada',false",
 "'baixa_realizada',false",
 "'movimenta_dinheiro',false",
 "'status_operacional','HOLD_OBRIGATORIO'"
 ])assert.ok(migration.includes(token),"Missing invariant: "+token);
 assert.doesNotMatch(migration,/\bUPDATE public\.|\bDELETE FROM public\.|\bINSERT INTO public\.catalogo_asaas_saques/);
 assert.doesNotMatch(migration,/p_otp|p_codigo|otp text|auth\.mfa\.verify/);
});

test("tentativa usa advisory lock por pessoa + FOR UPDATE por challenge antes de COUNT",()=>{
 const a=migration.indexOf("pg_advisory_xact_lock");
 const b=migration.indexOf("WHERE challenge_id=p_challenge FOR UPDATE");
 const c=migration.indexOf("SELECT count(*)::integer INTO v_quantidade");
 const d=migration.indexOf("INSERT INTO public.catalogo_asaas_stepup_tentativas_inertes");
 assert.ok(a>0&&b>a&&c>b&&d>c,"lock ordering/count unsafe");
 for(const x of [
  "t.tentativa_em>v_hora-interval '1 hour'",
  "IF v_quantidade>=3 THEN",
  "'limite_tres_por_hora'",
  "WHERE t.challenge_id=p_challenge",
  "'tentativa_ja_registrada'",
  "auth.uid() IS DISTINCT FROM v_ch.revisor_id",
  "auth.jwt()->>'session_id' IS DISTINCT FROM v_ch.sessao_id::text",
  "f.status::text='verified'",
  "v_e.fingerprint_sha256 IS DISTINCT FROM v_i.fingerprint_creditos_sha256",
  "v_doc->>'hash_final_registrado_sha256' IS DISTINCT FROM v_i.dossie_hash_sha256",
  "IS DISTINCT FROM v_i.matriz_hash_sha256",
  "v_fin->>'composicao_inalterada_e_financiada' IS DISTINCT FROM 'true'"
 ]) assert.ok(migration.includes(x),"Missing gate: "+x);
});

test("tabela fica fechada para todas as roles da API e imutavel",()=>{
 assert.match(migration,/ALTER TABLE public\.catalogo_asaas_stepup_tentativas_inertes ENABLE ROW LEVEL SECURITY/);
 assert.match(migration,/REVOKE ALL ON public\.catalogo_asaas_stepup_tentativas_inertes\s+FROM PUBLIC,anon,authenticated,service_role/);
 assert.match(migration,/REVOKE ALL ON FUNCTION\s+catalogo_private\.catalogo_asaas_reservar_tentativa_stepup_inerte\(uuid\)\s+FROM PUBLIC,anon,authenticated,service_role/);
 assert.match(migration,/BEFORE UPDATE OR DELETE ON public\.catalogo_asaas_stepup_tentativas_inertes/);
 assert.doesNotMatch(migration,/\bGRANT (?:SELECT|INSERT|UPDATE|DELETE|EXECUTE)\b/);
});

test("regressao PostgreSQL exercita quota, replay, sessao, revogacao e HOLD",()=>{
 for(const phrase of [
  "Tentativa de stepup trocou sessao",
  "Reserva sem MFA validado confundida com pagamento",
  "Replay de tentativa de challenge foi permitido",
  "Tentativa de MFA ficticia sofreu UPDATE",
  "Tentativa de MFA ficticia sofreu DELETE",
  "Livro de tentativas MFA foi exposto a API",
  "Fator nao verificado aceitou tentativa MFA",
  "Segunda reserva nao continuou em HOLD",
  "Terceira tentativa falsa nao foi aceita",
  "Quarta tentativa ultrapassou teto por revisor",
  "Teto de tentativas deixou entradas extras ou faltantes"
 ])assert.ok(fixture.includes(phrase),"Missing SQL fixture: "+phrase);
 assert.match(fixture,/ROLLBACK;\s*$/);
});

test("dois processos reais exercitam lock do revisor e quota persistente sem dinheiro",()=>{
 const race=fs.readFileSync("scripts/validacao-pagamentos/test-asaas-advisory-concurrency.py","utf8");
 for(const name of [
  "def scenario_stepup_attempts_concurrent_and_quota()",
  "def assert_waiting_stepup_advisory(",
  "Lock:advisory",
  "STEPUP_FIRST_COMMITTED",
  "STEPUP_SECOND_REJECTED",
  "STEPUP_FIRST_ROLLBACK_DONE",
  "STEPUP_SECOND_COMMIT_DONE",
  "limite_tres_por_hora",
  "count(DISTINCT nonce)",
  "scenario_stepup_attempts_concurrent_and_quota()"
 ])assert.ok(race.includes(name),"CI concurrency missing "+name);
 assert.match(race,/EXPECTED_DB = "catalogo_asaas_race_ci"/);
 assert.match(race,/PGPASSWORD": "local-ci-only"/);
 assert.match(race,/SUPABASE_SERVICE_ROLE_KEY/);
});
