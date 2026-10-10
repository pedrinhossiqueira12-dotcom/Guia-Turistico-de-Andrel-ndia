"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const migration=fs.readFileSync("supabase/pending-migrations/20261010012000_stepup_desafio_vinculo_persistente_inerte.sql","utf8");
const fixture=fs.readFileSync("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql","utf8");

test("persistencia privada vincula challenge a nonce documental unico e sessao",()=>{
 for(const s of [
  "nonce uuid NOT NULL UNIQUE",
  "challenge_id uuid NOT NULL UNIQUE",
  "REFERENCES public.catalogo_asaas_intencoes_mfa_documentais_ensaio(nonce)",
  "revisor_id uuid NOT NULL","sessao_id uuid NOT NULL","fator_id uuid NOT NULL",
  "dossie_hash_sha256 text NOT NULL","CHECK(estado='desafio_emitido_sem_verificacao')",
  "WHERE nonce=NEW.nonce FOR UPDATE","auth.uid() IS DISTINCT FROM v_i.revisor_id",
  "auth.jwt()->>'session_id' IS DISTINCT FROM v_i.sessao_id::text",
  "s.id=v_i.sessao_id AND s.user_id=v_i.revisor_id",
  "f.id=v_fator AND f.user_id=v_i.revisor_id",
  "f.factor_type::text='totp' AND f.status::text='verified'",
  "v_dossie->>'hash_final_registrado_sha256' IS DISTINCT FROM v_i.dossie_hash_sha256",
  "v_financeiro->>'composicao_inalterada_e_financiada' IS DISTINCT FROM 'true'",
  "NEW.revisor_id:=v_i.revisor_id",
  "NEW.sessao_id:=v_i.sessao_id",
  "NEW.fator_id:=v_fator",
  "NEW.estado:='desafio_emitido_sem_verificacao'",
  "NEW.expira_em:=pg_catalog.least(v_hora+interval '2 minutes',v_i.expira_em)"
 ])assert.ok(migration.includes(s),"Missing invariant "+s);
});
test("sem endpoint, MFA comprovado ou autorizacao financeira",()=>{
 assert.match(migration,/ALTER TABLE public\.catalogo_asaas_stepup_desafios_documentais_ensaio\s+ENABLE ROW LEVEL SECURITY/);
 assert.match(migration,/REVOKE ALL ON public\.catalogo_asaas_stepup_desafios_documentais_ensaio\s+FROM PUBLIC,anon,authenticated,service_role/);
 assert.match(migration,/REVOKE ALL ON FUNCTION catalogo_private\.catalogo_asaas_preparar_stepup_desafio_inerte\(\)\s+FROM PUBLIC,anon,authenticated,service_role/);
 assert.match(migration,/BEFORE UPDATE OR DELETE ON public\.catalogo_asaas_stepup_desafios_documentais_ensaio/);
 assert.doesNotMatch(migration,/\bGRANT\s+(?:INSERT|UPDATE|DELETE|EXECUTE)\s+ON\b/);
 assert.doesNotMatch(migration,/\bUPDATE public\.|\bINSERT INTO public\.|\bDELETE FROM public\.|\bPOST.*transfer/);
 for(const token of ["desafio_emitido_sem_verificacao","NAO chama Supabase Auth","nenhuma prova de MFA real/recente"])assert.ok(migration.includes(token),token);
});
test("CI exercita bloqueios de duplicidade, autofix de contexto, outra sessao, fator revogado e append-only",()=>{
 for(const token of [
  "Persistencia step-up nao corrigiu sessao/revisor/fator/carimbo",
  "Nonce aceitou desafio MFA duplicado",
  "Desafio MFA de ensaio permitiu UPDATE",
  "Desafio MFA de ensaio permitiu DELETE",
  "Persistencia step-up exposta via API",
  "Challenge MFA reutilizado em nonce diferente",
  "Challenge de outra sessao foi aceito",
  "Fator TOTP unverified aceitou desafio",
  "Dois nonces validos nao receberam desafios distintos"
 ])assert.ok(fixture.includes(token),"Missing SQL fixture "+token);
 assert.match(fixture,/ROLLBACK;\s*$/);
});
