"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");

const sql=fs.readFileSync(
 "supabase/pending-migrations/20261010006000_reserva_regular_nao_reutiliza_id_excepcional.sql","utf8");
const fixture=fs.readFileSync("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql","utf8");

test("ID ja observado em excecao nao pode ser anexado a saque regular",()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION catalogo_private\.catalogo_asaas_impedir_reuso_bancario_em_saque_regular\(\)/);
 assert.match(sql,/BEFORE INSERT OR UPDATE OF transferencia_id ON public\.catalogo_asaas_saques/);
 assert.match(sql,/IF EXISTS\([\s\S]*FROM public\.catalogo_asaas_transferencias_excepcionais_auditoria e/);
 assert.match(sql,/e\.transferencia_id=NEW\.transferencia_id/);
 assert.match(sql,/ID bancario ja consta em evidencia excepcional: manter HOLD/);
 assert.match(sql,/OLD\.transferencia_id IS NOT NULL/);
 assert.match(sql,/NEW\.transferencia_id IS DISTINCT FROM OLD\.transferencia_id/);
 assert.match(sql,/ID bancario associado a saque regular e imutavel/);
});

test("concorrrencia usa mesmo lock de dono e de ID nos dois caminhos",()=>{
 const a=sql.slice(sql.indexOf("catalogo_private.catalogo_asaas_impedir_reuso_bancario_em_saque_regular()"),
   sql.indexOf("REVOKE ALL ON FUNCTION\n catalogo_private.catalogo_asaas_impedir_reuso_bancario_em_saque_regular()"));
 const b=sql.slice(sql.indexOf("catalogo_private.catalogo_asaas_serializar_id_evidencia_tardia()"),
   sql.indexOf("REVOKE ALL ON FUNCTION\n catalogo_private.catalogo_asaas_serializar_id_evidencia_tardia()"));
 for(const snippet of [a,b]){
  const owner=snippet.indexOf("'asaas-saque:'");
  const transfer=snippet.indexOf("'asaas-transfer-claim:'");
  assert.ok(owner>=0&&transfer>owner,"Locks devem respeitar ordem: motoboy -> transferencia");
  assert.match(snippet,/pg_catalog\.pg_advisory_xact_lock/);
 }
});

test("prova tardia continua sendo inserida, jamais suprimida por unicidade cruzada",()=>{
 const late=sql.slice(sql.indexOf("catalogo_private.catalogo_asaas_serializar_id_evidencia_tardia()"),
  sql.indexOf("REVOKE ALL ON FUNCTION\n catalogo_private.catalogo_asaas_serializar_id_evidencia_tardia()"));
 assert.match(late,/RETURN NEW;/);
 assert.doesNotMatch(late,/RAISE EXCEPTION|IF EXISTS/);
 assert.match(sql,/BEFORE INSERT ON public\.catalogo_asaas_transferencias_excepcionais_auditoria/);
 assert.doesNotMatch(sql,/UNIQUE\s*\(transferencia_id/);
 assert.match(sql,/BEFORE UPDATE OR DELETE ON public\.catalogo_asaas_transferencias_excepcionais_auditoria/);
 assert.match(sql,/Evidencia bancaria excepcional e append-only/);
});

test("nao existe Pix ou quitação na migration ou no ensaio do ID compartilhado",()=>{
 assert.doesNotMatch(sql,/\bUPDATE\s+public\.catalogo_remuneracoes|\bINSERT\s+INTO\s+public\.catalogo_repasses|\bPOST\s*\/transfers/);
 for(const marker of [
  "Saque regular reutilizou ID de evidencia excepcional preexistente",
  "ID bancario conflitante foi persistido no saque",
  "ID novo e distinto foi incorretamente recusado",
  "ID bancario de saque alterado apos vinculo original",
  "ID bancario de saque apagado apos vinculo original",
  "Evidencia excepcional alterada apos registro",
  "Evidencia excepcional apagada apos registro",
  "Prova excepcional tardia com mesmo ID bancario foi descartada",
 ])assert.ok(fixture.includes(marker),marker);
 assert.match(fixture,/DO \$bank_id_claim\$/);
 assert.match(fixture,/ROLLBACK;/);
});
