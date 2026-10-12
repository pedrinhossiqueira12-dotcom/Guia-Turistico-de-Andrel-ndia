"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const sql=fs.readFileSync("scripts/validacao-pagamentos/asaas-cob06-clone-preflight-readonly.sql","utf8");
const runbook=fs.readFileSync("docs/ASAAS_COB06_BACKUP_RESTAURACAO_RETOMADA_SEGURA_20261012.md","utf8");

test("COB-06: preflight de clone só pode consultar metadados, sem comandos Cron ou Vault",()=>{
 const clean=sql.replace(/--[^\n]*/g,"").replace(/'(?:[^']|'')*'/g,"''");
 assert.doesNotMatch(clean,/\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|CALL|DO|PERFORM)\b/i);
 assert.match(sql,/FROM cron\.job/i);
 assert.match(sql,/FROM supabase_migrations\.schema_migrations/i);
 assert.match(sql,/jobid,jobname,active,schedule/i);
 assert.doesNotMatch(clean,/\bcommand\b|\bvault\.secrets\b|\bsecret\b|\btoken\b/i);
 assert.match(sql,/pg_catalog\.pg_extension/i);
});
test("COB-06: restauração não pode acionar crons produtivos ou presumir backup",()=>{
 for(const s of [
  "pg_cron","pg_net","isolamento","ANTES de restaurar dados reais",
  "Backups","NÃO executar clone físico",
  "plano e a existência de um backup recuperável deste projeto NÃO foram confirmados"
 ])assert.ok(runbook.includes(s),s);
 assert.match(runbook,/sem alterar.*produção|Nenhuma alteração realizada no Supabase de produção/i);
});
