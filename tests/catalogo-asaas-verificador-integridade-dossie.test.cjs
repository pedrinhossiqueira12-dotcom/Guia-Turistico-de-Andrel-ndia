"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
const sql=read("supabase/pending-migrations/20261009235958_verificar_integridade_dossie_escrow.sql");
const ci=read("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql");
const edge=read("supabase/functions/catalogo-asaas-financeiro/index.ts");
const ui=read("js/admin-encerramentos.js");

test("verificador recalcula SHA-256 de cada evento, ligacao e sequencia sem paginação",()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.catalogo_asaas_verificar_integridade_dossie_escrow/);
 assert.match(sql,/LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''/);
 assert.match(sql,/v_prev text:=repeat\('0',64\)/);
 assert.match(sql,/FOR v_row IN SELECT \* FROM public\.catalogo_asaas_escrow_dossie_eventos/);
 assert.match(sql,/ORDER BY seq,id LOOP/);
 assert.match(sql,/v_row\.seq IS DISTINCT FROM v_seq/);
 assert.match(sql,/v_row\.hash_anterior_sha256 IS DISTINCT FROM v_prev/);
 assert.match(sql,/pg_catalog\.sha256\(pg_catalog\.convert_to/);
 assert.match(sql,/v_row\.evento_sha256 IS DISTINCT FROM v_hash/);
 assert.match(sql,/'integridade_valida',cardinality\(v_issues\)=0/);
 assert.match(sql,/'hash_final_registrado_sha256'/);
 assert.match(sql,/'sem_ancora_externa',true/);
 assert.doesNotMatch(sql,/\bLIMIT\s+1000\b/);
});
test("dossie não aceita UPDATE/DELETE nem append de sequência comprometida",()=>{
 assert.match(sql,/CREATE TRIGGER catalogo_asaas_dossie_append_only/);
 assert.match(sql,/BEFORE UPDATE OR DELETE ON public\.catalogo_asaas_escrow_dossie_eventos/);
 assert.match(sql,/USING ERRCODE='23514'/);
 assert.match(sql,/public\.catalogo_asaas_verificar_integridade_dossie_escrow\(/);
 assert.match(sql,/Integridade do dossie comprometida. Bloqueada nova escrita/);
 assert.match(sql,/hashtextextended\('asaas-saque:'\|\|v_escrow\.motoboy_id::text,0\)/);
 assert.match(sql,/WHERE id=p_separacao FOR UPDATE/);
});
test("verificação não autoriza pagamento nem privilegia público",()=>{
 assert.match(sql,/'pagamento_autorizado',false/);
 assert.match(sql,/'liberacao_autorizada',false/);
 assert.match(sql,/'baixa_realizada',false/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.catalogo_asaas_verificar_integridade_dossie_escrow\(uuid\)/);
 assert.match(sql,/FROM PUBLIC,anon,authenticated,service_role/);
 assert.match(sql,/TO service_role/);
 assert.doesNotMatch(sql,/\bUPDATE public\.catalogo_remuneracoes|POST \/transfers|DELETE FROM public\./);
});
test("painel admin destaca fraude e bloqueia nova anotação, nunca Pix",()=>{
 assert.match(edge,/const integridade=await rpc\("catalogo_asaas_verificar_integridade_dossie_escrow"/);
 assert.match(edge,/integridade\.integridade_valida===true/);
 assert.match(ui,/Dossiê inconsistente: novas ocorrências bloqueadas/);
 assert.match(ui,/gravar\.disabled=dossieComprometido/);
 assert.match(ui,/Cadeia SHA-256 local verificada/);
 assert.match(ui,/não há âncora externa/);
});
test("CI SQL detecta falsificação e recusa nova anotação",()=>{
 assert.match(ci,/Dossie aceitou UPDATE indevido/);
 assert.match(ci,/Dossie aceitou DELETE indevido/);
 assert.match(ci,/Linha falsificada diretamente pelo administrador do banco/);
 assert.match(ci,/v_falsificacao->>'integridade_valida' IS DISTINCT FROM 'false'/);
 assert.match(ci,/Trilha adulterada permitiu novo append/);
 assert.match(ci,/Verificador acusou trilha integra como invalida/);
});
