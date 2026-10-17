"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const migration=fs.readFileSync("supabase/pending-migrations/20261010014000_leitor_auth_privado_revogar_preflight_inerte.sql","utf8");
const sql=fs.readFileSync("supabase/tests/isolated/catalogo-asaas-auth-sessao-owner-inerte-postgres.sql","utf8");
const preflight=fs.readFileSync("supabase/tests/isolated/catalogo-asaas-preflight-mfa-inerte-postgres.sql","utf8");
const ci=fs.readFileSync(".github/workflows/database-tests.yml","utf8");

test("alerta SECURITY DEFINER de preflight de ensaio: revoke authenticated e nenhuma API GRANT",()=>{
 assert.match(migration,/REVOKE ALL ON FUNCTION\s+public\.catalogo_asaas_preflight_sessao_revisor_inerte\(\)\s+FROM PUBLIC, anon, authenticated, service_role/);
 assert.match(migration,/CREATE FUNCTION catalogo_private\.catalogo_asaas_ler_sessao_fator_auth_inerte\(/);
 assert.match(migration,/LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''/);
 assert.match(migration,/REVOKE ALL ON FUNCTION\s+catalogo_private\.catalogo_asaas_ler_sessao_fator_auth_inerte\(uuid\)\s+FROM PUBLIC, anon, authenticated, service_role/);
 assert.doesNotMatch(migration,/\bGRANT\b/i);
 assert.doesNotMatch(migration,/\bINSERT INTO\b|\bUPDATE auth\.|\bDELETE FROM auth\./i);
});
test("fonte privada consulta auth.sessions + factor verificado, dono nao bloqueado",()=>{
 for(const invariant of [
  "FROM auth.sessions s",
  "JOIN auth.users u ON u.id=s.user_id",
  "JOIN auth.mfa_factors f ON f.id=s.factor_id",
  "f.user_id=s.user_id",
  "s.aal::text='aal2'",
  "f.factor_type::text='totp'",
  "f.status::text='verified'",
  "s.not_after IS NULL OR s.not_after>pg_catalog.now()",
  "u.banned_until IS NULL OR u.banned_until<=pg_catalog.now()",
  "'id',s.id::text",
  "'userId',s.user_id::text",
  "'factorId',f.id::text",
  "'factorUserId',f.user_id::text",
  "'factorType',f.factor_type::text",
  "'factorStatus',f.status::text"
 ]) assert.ok(migration.includes(invariant),"Missing reader check "+invariant);
});
test("teste CI recusa cliente autenticado, fator trocado e sessao revogada no clone",()=>{
 for(const invariant of [
  "RPC preflight exposto indevidamente a authenticated",
  "authenticated consegue invocar preflight RPC",
  "authenticated consegue ler auth.sessions",
  "Sessao sem MFA verificado passou no leitor",
  "Fator TOTP unverified aceito",
  "Sessao AAL1 permitida",
  "Sessao expirada permitida",
  "Fator pertence a outro usuario",
  "Fator nao TOTP aceito",
  "Usuario bloqueado teve sessao validada",
  "Sessao revogada/ausente passou",
  "ROLLBACK;"
 ]) assert.ok((sql+"\n"+preflight).includes(invariant),"Missing negative test "+invariant);
 assert.match(ci,/psql -X -d catalogo_asaas_guards_ci -v ON_ERROR_STOP=1[^]*catalogo-asaas-auth-sessao-owner-inerte-postgres\.sql/);
 assert.match(sql,/current_database\(\)<>'catalogo_asaas_guards_ci'/);
 assert.doesNotMatch(ci,/catalogo-asaas-auth-sessao-owner-inerte-postgres\.sql[^\n]*catalogo_asaas_race_ci/);
});
