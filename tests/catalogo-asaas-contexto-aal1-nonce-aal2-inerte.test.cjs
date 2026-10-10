"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const src=fs.readFileSync("supabase/pending-migrations/20261010017000_contexto_aal1_nonce_aal2_persistente_inerte.sql","utf8");
const pg=fs.readFileSync("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql","utf8");
const sim=fs.readFileSync("supabase/functions/_shared/catalogo-asaas-stepup-documental-ensaio.ts","utf8");

test("DB precontext and one-to-one nonce link are private, immutable and not financial",()=>{
 for(const str of [
  "CREATE TABLE public.catalogo_asaas_contextos_pre_mfa_inertes",
  "CREATE TABLE public.catalogo_asaas_vinculos_pre_mfa_nonce_inertes",
  "UNIQUE(separacao_id,revisor_id,sessao_id)",
  "contexto_id uuid PRIMARY KEY",
  "nonce uuid NOT NULL UNIQUE",
  "ENABLE ROW LEVEL SECURITY",
  "FROM PUBLIC,anon,authenticated,service_role",
  "catalogo_asaas_pre_mfa_append_only_inerte",
  "BEFORE UPDATE OR DELETE",
  "'challenge_go_true_verificado',false",
  "'desafio_mfa_da_sessao_comprovado',false",
  "'pagamento_autorizado',false",
  "'movimenta_dinheiro',false",
  "'status_operacional','HOLD_OBRIGATORIO'"
 ])assert.ok(src.includes(str),"Missing preMFA guard "+str);
 assert.doesNotMatch(src,/\bGRANT\s+(?:SELECT|INSERT|UPDATE|EXECUTE)/i);
 assert.doesNotMatch(src,/(?:/v3/transfers|\bfetch\s*\(|\bOTP\s*=|\bPIX\s*=)/i);
});

test("pre-context guarded by verified own TOTP, reviewer, conflicts, frozen escrow, hashes",()=>{
 for(const str of [
  "catalogo_asaas_checar_fator_totp_aal1_inerte(",
  "v_fator->>'elegivel' IS DISTINCT FROM 'true'",
  "catalogo_asaas_revisores_escrow_revogacoes_ensaio",
  "v_e.situacao IS DISTINCT FROM 'congelada'",
  "v_e.motoboy_id=v_uid",
  "catalogo_asaas_escrow_dossie_eventos",
  "c.proprietario_id=v_uid",
  "catalogo_asaas_verificar_integridade_dossie_escrow",
  "catalogo_asaas_matriz_conciliacao_escrow",
  "composicao_inalterada_e_financiada",
  "NEW.id:=pg_catalog.gen_random_uuid()",
  "NEW.expira_em:=v_agora+interval '2 minutes'"
 ])assert.ok(src.includes(str),"Missing independent eligibility guard "+str);
});

test("post-AAL2 compatibility requires same reviewer/session/factor/escrow/immutable evidence",()=>{
 for(const str of [
  "catalogo_asaas_ler_sessao_fator_auth_inerte(v_c.sessao_id)",
  "v_c.revisor_id=v_n.revisor_id",
  "v_c.sessao_id=v_n.sessao_id",
  "v_c.separacao_id=v_n.separacao_id",
  "v_auth->>'factorId'=v_c.fator_id::text",
  "v_auth->>'aal'='aal2'",
  "v_c.fingerprint_creditos_sha256=v_n.fingerprint_creditos_sha256",
  "v_c.dossie_seq=v_n.dossie_seq",
  "v_c.dossie_hash_sha256=v_n.dossie_hash_sha256",
  "v_c.matriz_hash_sha256=v_n.matriz_hash_sha256",
  "v_n.gerado_em<=v_c.expira_em",
  "v_n.expira_em>pg_catalog.clock_timestamp()",
  "catalogo_asaas_guardar_vinculo_pre_mfa_nonce_inerte",
  "v_result->>'vinculo_documental_compativel' IS DISTINCT FROM 'true'"
 ])assert.ok(src.includes(str),"Missing documentary binding "+str);
});

test("CI covers AAL1 snapshot tampering, AAL2 matching, duplicate mapping and append-only",()=>{
 for(const str of [
  "Contexto AAL1 aceitou fotografia cliente adulterada",
  "Pre-contexto AAL1 duplicado escapou do UNIQUE",
  "AAL2 sem nonce foi confundida com MFA",
  "AAL1/AAL2 documental nao vinculou ou moveu dinheiro",
  "Vinculo AAL1/AAL2 aceitou carimbo externo",
  "Contexto/nonce aceita segundo pareamento",
  "Vinculo documental permitiu UPDATE",
  "Contexto AAL1 permitiu DELETE"
 ])assert.ok(pg.includes(str),"Missing disposable DB test "+str);
 assert.ok(sim.indexOf("this.noncesReservados.add(intencao.nonce)")<
  sim.indexOf('await this.provider.autenticarToken(bearerToken, "inicio")'),
  "In-memory nonce reservation must precede async Auth");
});
