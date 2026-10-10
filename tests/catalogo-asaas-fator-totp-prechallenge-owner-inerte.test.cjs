"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
const migration=read("supabase/pending-migrations/20261010016000_fator_totp_aal1_owner_guard_inerte.sql");
const fixture=read("supabase/tests/isolated/catalogo-asaas-fator-totp-aal1-owner-inerte-postgres.sql");
const simulator=read("supabase/functions/_shared/catalogo-asaas-stepup-documental-ensaio.ts");
const transport=read("supabase/functions/_shared/catalogo-asaas-gotrue-mfa-transporte-inerte.ts");
const testDeno=read("supabase/functions/tests/catalogo-asaas-stepup-documental-ensaio.test.ts");
const workflow=read(".github/workflows/database-tests.yml");

test("SQL so indica fator TOTP elegivel para prechallenge, jamais pagamento",()=>{
 for(const x of [
  "SECURITY INVOKER SET search_path=''",
  "FROM auth.sessions s",
  "JOIN auth.users u ON u.id=s.user_id",
  "JOIN auth.mfa_factors f ON f.id=p_fator_id",
  "f.user_id=s.user_id",
  "s.aal::text='aal1'",
  "s.factor_id IS NULL",
  "f.factor_type::text='totp'",
  "f.status::text='verified'",
  "u.banned_until IS NULL OR u.banned_until<=pg_catalog.now()",
  "'mfa_ja_verificado', false",
  "'desafio_ja_emitido', false",
  "'pagamento_autorizado', false",
  "'status_operacional', 'HOLD_OBRIGATORIO'",
  "FROM PUBLIC, anon, authenticated, service_role",
 ]) assert.ok(migration.includes(x),"SQL owner-only invariant missing "+x);
 assert.doesNotMatch(migration,/\bGRANT\b|\bUPDATE\s+auth\.|\bINSERT\s+INTO\s+auth\.|\bDELETE\s+FROM\s+auth\./i);
});
test("factor ownership deve ser conferido ANTES da emissao do challenge GoTrue",()=>{
 const factor=simulator.indexOf('verificarFatorTotpAal1({');
 const request=simulator.indexOf("this.provider.criarDesafio({");
 assert.ok(factor>0&&request>factor,"challenge precedes verified ownership lookup");
 for(const s of [
  "fator_totp_nao_elegivel",
  "checagem_fator_totp_indisponivel",
  "sessao.aal === \"aal1\"",
  "sessionId: sessao.sessionId",
  "factorId: intencao.factorId",
  "HOLD_OBRIGATORIO"
 ]) assert.ok(simulator.includes(s),"Missing guard "+s);
 assert.ok(transport.includes("verificarFatorTotpAal1NoServidor"),
  "backend factor lookup not required by GoTrue transport");
 assert.match(transport,/typeof cfg\.verificarFatorTotpAal1NoServidor !== "function"/);
 assert.match(testDeno,/preflight do fator bloqueia challenge AAL1/);
});
test("CI prova que authenticated nao le fator e cross-account e revogacao falham",()=>{
 for(const s of [
  "current_database()<>'catalogo_asaas_guards_ci'",
  "authenticated le fator TOTP por funcao privada",
  "Fator de outro usuario passou",
  "TOTP unverified passou",
  "Fator SMS/phone passou",
  "Sessao expirada AAL1 passou",
  "Usuario banido passou",
  "Sessao revogada passou",
  "ROLLBACK;"
 ]) assert.ok(fixture.includes(s),"SQL regression missing "+s);
 assert.ok(workflow.includes("catalogo-asaas-fator-totp-aal1-owner-inerte-postgres.sql"));
});
