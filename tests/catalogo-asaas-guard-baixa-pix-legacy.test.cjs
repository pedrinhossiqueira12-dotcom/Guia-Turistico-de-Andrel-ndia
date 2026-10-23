"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const sql=fs.readFileSync(
 "supabase/pending-migrations/20261010005000_impedir_baixa_saque_sem_compromisso_pix.sql","utf8");
const edge=fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");
const fixture=fs.readFileSync("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql","utf8");

test("baixa da reserva exige compromisso Pix anterior mesmo no banco",()=>{
 assert.match(sql,/BEFORE UPDATE OF status ON public\.catalogo_asaas_saques/);
 assert.match(sql,/OLD\.status IS DISTINCT FROM 'concluido'/);
 assert.match(sql,/NEW\.status='concluido'/);
 assert.match(sql,/OLD\.pix_destino_sha256 IS NULL/);
 assert.match(sql,/OLD\.pix_destino_registrado_em IS NULL/);
 assert.match(sql,/NEW\.pix_destino_sha256 IS DISTINCT FROM OLD\.pix_destino_sha256/);
 assert.match(sql,/NEW\.pix_destino_registrado_em IS DISTINCT FROM OLD\.pix_destino_registrado_em/);
 assert.match(sql,/ERRCODE='23514'/);
 assert.doesNotMatch(sql,/\bUPDATE\s+public\.catalogo_remuneracoes|\bINSERT\s+INTO\s+public\.catalogo_repasses|\bPOST\s*\/transfers/);
});

test("Edge exige carimbo de HMAC antes do POST, baixa ou autorizacao via Webhook",()=>{
 assert.match(edge,/\.select\("id,pix_destino_registrado_em"\)\.maybeSingle\(\)/);
 assert.match(edge,/Date\.parse\(snapshot\.pix_destino_registrado_em\)/);
 assert.match(edge,/Date\.parse\(carimbo\)/);
 assert.match(edge,/Date\.parse\(saque\.pix_destino_registrado_em\)/);
 assert.match(edge,/select\("id,motoboy_id,status,valor_centavos,transferencia_id,pix_destino_sha256,pix_destino_registrado_em"\)/);
});

test("ensaio descartavel bloqueia baixa de revisao legada sem HMAC",()=>{
 assert.match(fixture,/Saque legado em revisao conseguiu baixa sem HMAC prospectivo/);
 assert.match(fixture,/Bloqueios de HMAC esperados 9/);
 assert.match(fixture,/BEGIN;/);
 assert.match(fixture,/ROLLBACK;/);
});
