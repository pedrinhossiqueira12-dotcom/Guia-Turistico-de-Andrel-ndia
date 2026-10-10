"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const sql=fs.readFileSync("supabase/pending-migrations/20261010011000_intencao_documental_nonce_sessao_hard_hold.sql","utf8");
const fixture=fs.readFileSync("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql","utf8");

test("nonce de laboratorio liga sessao, revisor, separacao, credito e hashes",()=>{
 for(const n of [
  "nonce uuid PRIMARY KEY",
  "sessao_id uuid NOT NULL",
  "fingerprint_creditos_sha256 text NOT NULL",
  "dossie_hash_sha256 text NOT NULL",
  "matriz_hash_sha256 text NOT NULL",
  "finalidade='consulta_documental_ensaio'",
  "v_sid:=(auth.jwt()->>'session_id')::uuid",
  "v_uid:=auth.uid()",
  "v_nonce:=pg_catalog.gen_random_uuid()",
  "v_hora+interval '5 minutes'",
  "v_e.motoboy_id=v_uid",
  "d.autor_id=v_uid",
  "c.proprietario_id=v_uid"
 ]) assert.ok(sql.includes(n),"Missing binding: "+n);
 assert.match(sql,/CREATE FUNCTION catalogo_private\.catalogo_asaas_iniciar_intencao_mfa_documental_ensaio/);
 assert.match(sql,/CREATE FUNCTION catalogo_private\.catalogo_asaas_observar_nonce_documental_ensaio/);
});
test("uma consulta unica nao vira pagamento, mesmo com MFA AAL2",()=>{
 for(const n of [
  "'desafio_mfa_da_sessao_comprovado',false",
  "'pode_registrar_parecer',false",
  "'pagamento_autorizado',false",
  "'liberacao_autorizada',false",
  "'baixa_realizada',false",
  "'status_operacional','HOLD_OBRIGATORIO'"
 ]) assert.ok(sql.includes(n),"Missing invariant: "+n);
 assert.doesNotMatch(sql,/\bUPDATE public\.catalogo_remuneracoes_v2|\bUPDATE public\.catalogo_asaas_saques|\/transfers|GRANT EXECUTE .*TO authenticated/);
});
test("duas tabelas sao privadas, com auditoria append-only e sem RPC para backend",()=>{
 for(const table of ["catalogo_asaas_intencoes_mfa_documentais_ensaio","catalogo_asaas_usos_nonce_documentais_ensaio"]){
  assert.match(sql,new RegExp("ALTER TABLE public\\."+table+" ENABLE ROW LEVEL SECURITY"));
  assert.match(sql,new RegExp("REVOKE ALL ON public\\."+table+"[\\s\\S]+?FROM PUBLIC,anon,authenticated,service_role"));
  assert.match(sql,new RegExp("BEFORE UPDATE OR DELETE ON public\\."+table));
  assert.doesNotMatch(sql,new RegExp("GRANT (SELECT|INSERT|UPDATE|DELETE) ON public\\."+table));
 }
 for(const fn of ["catalogo_asaas_iniciar_intencao_mfa_documental_ensaio","catalogo_asaas_observar_nonce_documental_ensaio"]){
  assert.match(sql,new RegExp("REVOKE ALL ON FUNCTION[\\s\\n]+catalogo_private\\."+fn+"\\(uuid\\)[\\s\\S]*?FROM PUBLIC,anon,authenticated,service_role"));
 }
 assert.match(sql,/nonce uuid PRIMARY KEY\s+REFERENCES public\.catalogo_asaas_intencoes_mfa_documentais_ensaio/);
 assert.match(sql,/WHERE nonce=p_nonce FOR UPDATE/);
 assert.match(sql,/WHERE nonce=p_nonce[\s\S]*?'nonce_ja_observado'/);
 assert.match(sql,/v_i\.expira_em<=pg_catalog\.clock_timestamp\(\)/);
 assert.match(sql,/v_i\.sessao_id::text IS DISTINCT FROM auth\.jwt\(\)->>'session_id'/);
 assert.match(sql,/v_financeiro->>'composicao_inalterada_e_financiada' IS DISTINCT FROM 'true'/);
 assert.match(sql,/v_hash IS DISTINCT FROM v_i\.matriz_hash_sha256/);
});
test("PostgreSQL CI cobre replay, uso cruzado, expiracao, prova nova, adulteracao e ausencia de MFA recente",()=>{
 for(const msg of [
  "Nonce de intencao aceitou ausencia de JWT real",
  "Nonce do banco nao vinculou identidade/sessao/versao",
  "Nonce da sessao A funcionou na sessao B",
  "Replay de nonce nao foi recusado",
  "Nonce expirado foi aceito",
  "Nonce permitiu evidencias alteradas",
  "Intencao permitiu adulteracao de sessao",
  "Uso de nonce foi removido",
  "Funcoes ou tabelas de nonce abertas ao backend",
  "Observacao de nonce liberou ou falhou"
 ]) assert.ok(fixture.includes(msg),"Missing SQL CI assertion "+msg);
 assert.match(fixture,/ROLLBACK;\s*$/);
});
