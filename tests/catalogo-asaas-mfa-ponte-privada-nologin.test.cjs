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
