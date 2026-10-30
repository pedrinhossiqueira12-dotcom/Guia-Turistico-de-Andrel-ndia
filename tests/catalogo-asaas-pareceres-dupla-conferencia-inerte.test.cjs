"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const sql=fs.readFileSync(
 "supabase/pending-migrations/20261010007000_pareceres_escrow_dupla_conferencia_inerte.sql","utf8");
const fixture=fs.readFileSync("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql","utf8");

test("pareceres sao apenas opinioes preliminares, nunca aprovacao de dinheiro",()=>{
 assert.match(sql,/resultado IN\([\s\S]*?'manter_hold','solicitar_documentos','apontar_divergencia'/);
 assert.doesNotMatch(sql,/resultado IN\([\s\S]*?'aprovar_pagamento'/);
 for(const name of ["'evidencia_bancaria_externa_suficiente',false",
 "'revisores_credenciados_e_autenticados',false","'dupla_aprovacao_financeira',false",
 "'pagamento_autorizado',false","'liberacao_autorizada',false",
 "'baixa_realizada',false","'movimenta_dinheiro',false",
 "'status_operacional','HOLD_OBRIGATORIO'"])
 assert.ok(sql.includes(name),"Nao pode autorizar: "+name);
 assert.doesNotMatch(sql,/\bPOST\s*\/transfers|UPDATE\s+public\.catalogo_remuneracoes|UPDATE\s+public\.catalogo_asaas_separacoes_excepcionais/);
});
test("escrita proibida ao backend e apenas diagnostico privativo de leitura",()=>{
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/REVOKE ALL ON public\.catalogo_asaas_escrow_pareceres_preliminares[\s\S]*?FROM PUBLIC,anon,authenticated,service_role/);
 assert.match(sql,/GRANT SELECT ON public\.catalogo_asaas_escrow_pareceres_preliminares TO service_role/);
 assert.doesNotMatch(sql,/GRANT (?:INSERT|UPDATE|DELETE) ON public\.catalogo_asaas_escrow_pareceres_preliminares/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.catalogo_asaas_diagnosticar_dupla_conferencia_inerte\(uuid\)[\s\S]*?FROM PUBLIC,anon,authenticated,service_role/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.catalogo_asaas_diagnosticar_dupla_conferencia_inerte\(uuid\)[\s\S]*?TO service_role/);
 assert.match(sql,/BEFORE UPDATE OR DELETE ON public\.catalogo_asaas_escrow_pareceres_preliminares/);
});
test("mesma versao, autor independente, prazo fixado no banco e stale ao mudar provas",()=>{
 assert.match(sql,/NEW\.revisor_id=v_separacao\.motoboy_id/);
 assert.match(sql,/d\.autor_id=NEW\.revisor_id/);
 assert.match(sql,/catalogo_asaas_verificar_integridade_dossie_escrow\(NEW\.separacao_id\)/);
 assert.match(sql,/catalogo_asaas_matriz_conciliacao_escrow\(NEW\.separacao_id\)/);
 assert.match(sql,/NEW\.dossie_hash_sha256:=v_dossie->>'hash_final_registrado_sha256'/);
 assert.match(sql,/NEW\.registrado_em:=pg_catalog\.clock_timestamp\(\)/);
 assert.match(sql,/NEW\.expira_em:=NEW\.registrado_em\+interval '24 hours'/);
 assert.match(sql,/count\(DISTINCT p\.revisor_id\)/);
 assert.match(sql,/p\.dossie_hash_sha256=v_head/);
 assert.match(sql,/p\.matriz_hash_sha256=v_mat_hash/);
 assert.match(sql,/p\.expira_em>now\(\)/);
 assert.match(sql,/UNIQUE\(separacao_id,revisor_id,dossie_hash_sha256,matriz_hash_sha256\)/);
});
test("PostgreSQL real ensaia pareceres duplos, replay, fraude e nova versao",()=>{
 for(const marker of ["Dois pareceres foram confundidos com pagamento",
 "Titular se autoaprovou como revisor","Replay de parecer sem idempotencia foi aceito",
 "Parecer preliminar foi adulterado","Parecer preliminar foi excluido",
 "Evento novo nao invalidou versao antiga",
 "Controle de acesso dos pareceres nao e restritivo"])
 assert.ok(fixture.includes(marker),"Fixture sem "+marker);
 assert.match(fixture,/ROLLBACK;/);
});
