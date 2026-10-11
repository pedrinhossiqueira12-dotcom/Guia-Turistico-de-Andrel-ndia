"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const ddl=fs.readFileSync(
 "supabase/tests/isolated/catalogo-asaas-revisores-identidade-race-inerte.sql","utf8");
const runner=fs.readFileSync(
 "scripts/validacao-pagamentos/test-asaas-advisory-concurrency.py","utf8");

test("#42: fixture de revisores autentica apenas dados sintéticos no banco CI",()=>{
 for(const token of [
  "current_database() IS DISTINCT FROM 'catalogo_asaas_race_ci'",
  "current_setting('app.catalogo_ci_revisores_test',true)",
  "session_user IS DISTINCT FROM 'postgres'",
  "CREATE SCHEMA catalogo_ci_revisores_inertes",
  "REVOKE ALL ON SCHEMA catalogo_ci_revisores_inertes",
  "ALTER TABLE catalogo_ci_revisores_inertes.credenciais_ci ENABLE ROW LEVEL SECURITY",
  "ALTER TABLE catalogo_ci_revisores_inertes.sessoes_mock_ci ENABLE ROW LEVEL SECURITY",
  "ALTER TABLE catalogo_ci_revisores_inertes.pareceres_mock_ci ENABLE ROW LEVEL SECURITY",
  "REVOKE ALL ON ALL TABLES IN SCHEMA catalogo_ci_revisores_inertes",
  "REVOKE ALL ON FUNCTION"
 ])assert.ok(ddl.includes(token),token);
 assert.doesNotMatch(ddl,/\bGRANT\b\s+(?:EXECUTE|INSERT|UPDATE|DELETE)\b/i);
 assert.doesNotMatch(ddl,/\b(?:fetch|http_post|net\.http_post|Asaas\.transfer)\s*\(/i);
});
test("#42: junta sessao e revisor com FOREIGN KEY e bloqueia repeticao",()=>{
 for(const part of [
  "UNIQUE(sessao_id,revisor_id)",
  "UNIQUE(separacao_id,revisor_id)",
  "FOREIGN KEY(sessao_id,revisor_id)",
  "REFERENCES catalogo_ci_revisores_inertes.sessoes_mock_ci(sessao_id,revisor_id)",
  "papel IN ('revisor_escrow','leitor')",
  "situacao IN ('habilitado','revogado')",
  "aal_mock IN ('aal1','aal2')",
  "fator_estado_mock IN ('verified','unverified','revoked')"
 ])assert.ok(ddl.includes(part),part);
});
test("#42: o diagnostico exige lock do saque, credito versionado e conflito de interesse",()=>{
 const fn=ddl.slice(ddl.indexOf(
  "CREATE FUNCTION catalogo_ci_revisores_inertes.diagnosticar_elegibilidade_mock("));
 const mutex=fn.indexOf("pg_catalog.pg_advisory_xact_lock(");
 const escrow=fn.indexOf("WHERE id=p_separacao FOR UPDATE");
 const credential=fn.indexOf("WITH candidatos AS MATERIALIZED");
 assert.ok(mutex>=0&&escrow>mutex&&credential>escrow);
 for(const part of [
  "FOR SHARE OF p,c,s",
  "reviewer.revisor_id IS DISTINCT FROM v_titular",
  "reviewer.papel='revisor_escrow'",
  "reviewer.situacao='habilitado'",
  "reviewer.valido_ate>pg_catalog.clock_timestamp()",
  "reviewer.parecer_expira>pg_catalog.clock_timestamp()",
  "reviewer.fingerprint_creditos_sha256=v_escrow.fingerprint_sha256",
  "reviewer.aal_mock='aal2'",
  "reviewer.fator_estado_mock='verified'",
  "reviewer.sessao_expira>pg_catalog.clock_timestamp()",
  "reviewer.revogada_em IS NULL",
  "reviewer.ultimo_desafio_mock_em<=pg_catalog.clock_timestamp()",
  "pg_catalog.clock_timestamp()-interval '5 minutes'",
  "NOT EXISTS (",
  "public.catalogo_asaas_escrow_dossie_eventos d",
  "count(DISTINCT revisor_id) FILTER (WHERE elegivel)",
  "'duas_credenciais_sinteticas_elegiveis',v_distintos>=2",
  "'mfa_real_validado',false",
  "'credenciamento_formal_confirmado',false",
  "'dupla_aprovacao_financeira',false",
  "'status_operacional','HOLD_OBRIGATORIO'",
  "'pagamento_autorizado',false",
  "'liberacao_autorizada',false",
  "'baixa_realizada',false",
  "'movimenta_dinheiro',false"
 ])assert.ok(fn.includes(part),part);
 assert.doesNotMatch(fn,/\b(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+(?:public|catalogo_ci_))\b/i);
 assert.doesNotMatch(fn,/p_dados_cliente\s*(?:->|#>|=)/);
});
test("#42: SQL real da CI testa revogacao, sessao expirada, fator, claims e nao-grants",()=>{
 for(const marker of [
  "def scenario_revisores_credenciais_mock_hold()",
  "scenario_revisores_credenciais_mock_hold()",
  "catalogo-asaas-revisores-identidade-race-inerte.sql",
  "CI_REVIEW_OWNER",
  "CI_REVIEW_A",
  "CI_REVIEW_B",
  "CI_REVIEW_IMPOSTOR",
  "def reviewer_diag_ci(",
  "forged=True",
  "dados do browser",
  "foreign_key_violation",
  "situacao='revogado'",
  "ultimo_desafio_mock_em=now()-interval '10 minutes'",
  "aal_mock='aal1'",
  "fator_estado_mock='revoked'",
  "revogada_em=now()",
  "expira_em=now()-interval '1 minute'",
  "fingerprint_creditos_sha256=repeat('c',64)",
  "unique_violation",
  "has_function_privilege('service_role'",
  "HOLD_OBRIGATORIO"
 ])assert.ok(runner.toLowerCase().includes(marker.toLowerCase()),marker);
 assert.match(runner,/EXPECTED_DB = "catalogo_asaas_race_ci"/);
});
