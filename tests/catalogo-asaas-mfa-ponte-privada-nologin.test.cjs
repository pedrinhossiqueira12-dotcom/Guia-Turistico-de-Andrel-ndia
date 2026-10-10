"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const sql=fs.readFileSync("supabase/pending-migrations/20261010021000_ponte_mfa_role_nologin_inerte.sql","utf8");
const pg=fs.readFileSync("supabase/tests/isolated/catalogo-asaas-ponte-nologin-mfa-inerte-postgres.sql","utf8");
const wf=fs.readFileSync(".github/workflows/database-tests.yml","utf8");
const ROLE="catalogo_mfa_ponte_ci_inerte";
const names=[
 "reservar_principal","ler_contexto","registrar_desafio","ler_tentativa",
 "consumir_desafio"
];

test("ponte nao cria login, chaves, secrets nem API financeira",()=>{
 assert.match(sql,/CREATE ROLE catalogo_mfa_ponte_ci_inerte NOLOGIN NOINHERIT NOSUPERUSER\s+NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);
 assert.match(sql,/CREATE SCHEMA catalogo_mfa_ponte_ci_inerte AUTHORIZATION postgres/);
 assert.match(sql,/GRANT USAGE ON SCHEMA catalogo_mfa_ponte_ci_inerte TO catalogo_mfa_ponte_ci_inerte/);
 assert.doesNotMatch(sql,/GRANT USAGE ON SCHEMA catalogo_private/i);
 assert.doesNotMatch(sql,/\bCREATE ROLE\s+\w+\s+LOGIN\b/i);
 assert.doesNotMatch(sql,/PASSWORD\s+'|PASSWORD\s+"/i);
 assert.doesNotMatch(sql,/\bGRANT SELECT\b|\bGRANT INSERT\b|\bGRANT UPDATE\b|\bGRANT DELETE\b/i);
 assert.doesNotMatch(sql,/POST \/transfers|api\.asaas|webhook|pix key|jwt_secret/i);
 assert.doesNotMatch(sql,/GRANT .* TO (?:anon|authenticated|service_role|authenticator)/i);
});

test("somente cinco wrappers security definer com search_path pinado",()=>{
 const defined=[...sql.matchAll(/CREATE FUNCTION catalogo_mfa_ponte_ci_inerte\.(\w+)\(/g)].map(m=>m[1]);
 assert.equal(defined.length,5);
 assert.deepEqual(defined.sort(),names.map(n=>"catalogo_asaas_ponte_"+n+"_inerte").sort());
 assert.equal((sql.match(/SECURITY DEFINER SET search_path=''/g)||[]).length,5);
 assert.equal((sql.match(/REVOKE ALL ON FUNCTION/g)||[]).length,5);
 assert.equal((sql.match(/GRANT EXECUTE ON FUNCTION/g)||[]).length,5);
 assert.equal((sql.match(/FROM PUBLIC,anon,authenticated,service_role;/g)||[]).length,6);
 for(const n of defined){
   assert.ok(sql.includes("GRANT EXECUTE ON FUNCTION catalogo_mfa_ponte_ci_inerte."+n+"("));
   assert.ok(sql.includes("REVOKE ALL ON FUNCTION catalogo_mfa_ponte_ci_inerte."+n+"("));
 }
});

test("regressoes executam role sem login em banco CI, negam funcao interna e tabelas",()=>{
 assert.match(wf,/catalogo-asaas-ponte-nologin-mfa-inerte-postgres\.sql/);
 assert.match(pg,/current_database\(\)<>'catalogo_asaas_guards_ci'/);
 assert.match(pg,/SET LOCAL ROLE catalogo_mfa_ponte_ci_inerte/);
 assert.match(pg,/catalogo_mfa_ponte_ci_inerte\.catalogo_asaas_ponte_reservar_principal_inerte/);
 assert.match(pg,/catalogo_private\.catalogo_asaas_reservar_inicio_principal_vinculado_inerte/);
 assert.match(pg,/EXCEPTION WHEN insufficient_privilege THEN NULL/);
 assert.match(pg,/has_function_privilege\('catalogo_mfa_ponte_ci_inerte'/);
 assert.match(pg,/has_table_privilege\('catalogo_mfa_ponte_ci_inerte'/);
 assert.match(pg,/movimenta_dinheiro' IS DISTINCT FROM 'false'/);
 assert.match(pg,/ROLLBACK;/);
});

test("migration privileged bridge refuses staging, prod, wrong database and opt-in missing",()=>{
 assert.match(sql,/current_database\(\) IS DISTINCT FROM 'catalogo_asaas_guards_ci'/);
 assert.match(sql,/current_setting\('app\.catalogo_ci_mfa_bridge',true\) IS DISTINCT FROM 'enabled'/);
 assert.match(sql,/session_user IS DISTINCT FROM 'postgres'/);
 assert.match(sql,/CI_ONLY_MFA_BRIDGE: recusa instalacao fora de clone efemero e opt-in/);
 const guard=sql.indexOf("DO $ci_only_bridge$");
 const createRole=sql.indexOf("CREATE ROLE "+ROLE);
 assert.ok(guard>0 && createRole>guard,"role created before environmental guard");
 assert.match(wf,/asaas-bridge-without-opt-in\.log/);
 assert.match(wf,/asaas-bridge-wrong-db\.log/);
 assert.match(wf,/psql -X -d catalogo_ci -v ON_ERROR_STOP=1/);
 assert.match(wf,/grep -F 'CI_ONLY_MFA_BRIDGE' \/tmp\/asaas-bridge-without-opt-in\.log/);
 assert.match(wf,/grep -F 'CI_ONLY_MFA_BRIDGE' \/tmp\/asaas-bridge-wrong-db\.log/);
 assert.match(wf,/SET app\.catalogo_ci_mfa_bridge='enabled'/);
 assert.match(wf,/case "\$migration" in/);
 assert.match(wf,/\$bridge_sql"\)/);
});

test("nenhuma cadeia indireta pode expor a ponte a papeis Data API",()=>{
 assert.match(sql,/pg_catalog\.pg_has_role\(parent\.oid,bridge\.oid,'MEMBER'\)/);
 assert.equal((sql.match(/pg_catalog\.pg_has_role\(exposed\.oid,bridge\.oid,'MEMBER'\)/g)||[]).length,5,
   "cinco wrappers devem recusar grants indiretos mesmo feitos apos a instalacao");
 assert.equal((sql.match(/WHERE NOT EXISTS \(/g)||[]).length,5,
   "cada wrapper deve negar execucao apos grant de cadeia");
 assert.match(pg,/CREATE ROLE catalogo_ci_mfa_pivot_inerte NOLOGIN NOINHERIT/);
 assert.match(pg,/GRANT catalogo_mfa_ponte_ci_inerte TO catalogo_ci_mfa_pivot_inerte/);
 assert.match(pg,/GRANT catalogo_ci_mfa_pivot_inerte TO authenticated/);
 assert.match(pg,/pg_catalog\.pg_has_role\(\s*'authenticated','catalogo_mfa_ponte_ci_inerte','SET'\)/);
 assert.match(pg,/ROLLBACK TO SAVEPOINT ponte_mfa_transitive_membership_probe/);
 for(const name of names) assert.match(pg,new RegExp("Ponte (?:executou|leu|registrou|consumiu) [^\\n]+apos membership indireta"));
});
