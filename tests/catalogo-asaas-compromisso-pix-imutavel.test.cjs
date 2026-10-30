"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const sql=fs.readFileSync(
 "supabase/pending-migrations/20261010004000_proteger_compromisso_pix_saque_antes_post.sql","utf8");
const edge=fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");
const fixture=fs.readFileSync("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql","utf8");

test("HMAC e horario de prova sao criados uma unica vez, antes da associacao externa",()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION catalogo_private\.catalogo_asaas_guardar_compromisso_pix_original\(\)/);
 assert.match(sql,/BEFORE INSERT OR UPDATE ON public\.catalogo_asaas_saques/);
 assert.match(sql,/IF TG_OP='INSERT' THEN/);
 assert.match(sql,/NEW\.pix_destino_sha256 IS NOT NULL/);
 assert.match(sql,/OLD\.pix_destino_sha256 IS NOT NULL/);
 assert.match(sql,/OLD\.pix_destino_registrado_em IS NOT NULL/);
 assert.match(sql,/OLD\.status IS DISTINCT FROM 'reservado'/);
 assert.match(sql,/OLD\.transferencia_id IS NOT NULL/);
 assert.match(sql,/NEW\.transferencia_id IS NOT NULL/);
 assert.match(sql,/NEW\.pix_destino_registrado_em:=pg_catalog\.clock_timestamp\(\)/);
 assert.match(sql,/Saque sem HMAC original imutavel nao pode ser enviado nem vinculado ao banco/);
 assert.match(sql,/Timestamp do compromisso Pix e imutavel/);
});

test("leitura do diagnostico e restrita a service_role e nao valida quitação",()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.catalogo_asaas_diagnosticar_compromisso_pix_saque/);
 assert.match(sql,/SECURITY DEFINER SET search_path=''/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.catalogo_asaas_diagnosticar_compromisso_pix_saque\(uuid\)/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.catalogo_asaas_diagnosticar_compromisso_pix_saque\(uuid\)[\s\S]*?TO service_role/);
 for(const marker of [
  "'prova_bancaria_independente',false",
  "'titularidade_original_comprovada',false",
  "'confirmacao_de_liquidacao',false",
  "'pagamento_autorizado',false",
  "'baixa_autorizada',false",
  "'creditos_liberados',false",
 ])assert.ok(sql.includes(marker),"Proibição ausente: "+marker);
 assert.doesNotMatch(sql,/\bPOST\s*\/transfers|\bUPDATE\s+public\.catalogo_remuneracoes|\bUPDATE\s+public\.catalogo_asaas_saques/);
 assert.doesNotMatch(sql,/pix_destino_sha256',v_s\.pix_destino_sha256/);
});

test("Edge grava HMAC antes de qualquer POST e o banco bloqueia troca",()=>{
 const start=edge.indexOf("async function withdraw(");
 const end=edge.indexOf("const ADMIN_USER_ID =",start);
 const body=edge.slice(start,end);
 assert.ok(start>=0&&end>start);
 assert.match(body,/const destinationHash=await pixFingerprint/);
 assert.match(body,/\.update\(\{pix_destino_sha256:destinationHash\}\)/);
 assert.match(body,/\.is\("pix_destino_sha256",null\)/);
 assert.match(body,/await asaas\("\/transfers","POST"/);
 assert.ok(body.indexOf("pix_destino_sha256:destinationHash")<
  body.indexOf('await asaas("/transfers","POST"'));
});

test("Edge impede POST e baixa quando carimbo prospectivo esta ausente",()=>{
 const start=edge.indexOf("async function withdraw(");
 const end=edge.indexOf("const ADMIN_USER_ID =",start);
 const withdraw=edge.slice(start,end);
 assert.match(withdraw,/select\("id,pix_destino_registrado_em"\)/);
 assert.match(withdraw,/typeof snapshot\.pix_destino_registrado_em!=="string"/);
 assert.match(withdraw,/Date\.parse\(snapshot\.pix_destino_registrado_em\)/);
 assert.ok(withdraw.indexOf("Date.parse(snapshot.pix_destino_registrado_em)")<
  withdraw.indexOf('await asaas("/transfers","POST"'));
 const proof=edge.slice(edge.indexOf("async function destinoPixConfirmadoParaBaixa("),
  edge.indexOf("async function equalSecret("));
 assert.match(proof,/saque\.pix_destino_registrado_em/);
 assert.match(proof,/Date\.parse\(carimbo\)/);
 const webhook=edge.slice(edge.indexOf("async function authorizeWithdrawal("),
  edge.indexOf("async function ",edge.indexOf("async function authorizeWithdrawal(")+20));
 assert.match(webhook,/pix_destino_registrado_em/);
 assert.match(webhook,/Date\.parse\(saque\.pix_destino_registrado_em\)/);
 assert.match(webhook,/return approveResponse\("REFUSED"/);
});
test("PostgreSQL rollback cobre primeiro HMAC, repeticao, tentativa de adulteracao e legado",()=>{
 for(const marker of [
  "HMAC Pix inicial sem timestamp local",
  "Repetir HMAC igual modificou timestamp original",
  "HMAC de destino Pix trocado indevidamente",
  "HMAC original apagado indevidamente",
  "Timestamp do HMAC alterado indevidamente",
  "Novo saque aceitou HMAC retroativo no INSERT",
  "Destino Pix alterado depois de associar transferencia",
  "Saque sem HMAC foi marcado enviado",
  "Saque sem HMAC vinculou ID bancario",
  "HMAC criado no mesmo ato do envio burlou limite anterior ao POST",
  "Diagnostico de prova Pix criou liberacao ou revelou HMAC",
 ])assert.ok(fixture.includes(marker),marker);
 assert.match(fixture,/END \$pix_compromisso_original\$;/);
 assert.match(fixture,/ROLLBACK;/);
});
