"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const ddl=fs.readFileSync(
 "supabase/tests/isolated/catalogo-asaas-journal-intencao-prepost-race-inerte.sql","utf8");
const race=fs.readFileSync(
 "scripts/validacao-pagamentos/test-asaas-advisory-concurrency.py","utf8");

test("#43: journal PRE-POST permitido SOMENTE no clone PostgreSQL descartavel",()=>{
 for(const required of [
  "current_database()<>'catalogo_asaas_race_ci'",
  "current_setting('app.catalogo_ci_intencao_test',true)<>'enabled'",
  "CREATE SCHEMA catalogo_ci_intencao_pix_inerte",
  "ENABLE ROW LEVEL SECURITY",
  "REVOKE ALL ON SCHEMA catalogo_ci_intencao_pix_inerte",
  "REVOKE ALL ON catalogo_ci_intencao_pix_inerte.intencoes",
  "REVOKE ALL ON catalogo_ci_intencao_pix_inerte.marcos_inicio",
  "REVOKE ALL ON FUNCTION",
 ])assert.ok(ddl.includes(required),required);
 assert.doesNotMatch(ddl,/\bGRANT\s+(?:EXECUTE|INSERT|UPDATE|DELETE)\b/i);
 assert.doesNotMatch(ddl,/https?:\/\/|api\.asaas|fetch\(|http_post\(|\bnet\.http_/i);
});
test("#43: intencao e inicio sao APPEND-ONLY com unicidade e sem dinheiro",()=>{
 for(const required of [
  "tentativa_id uuid PRIMARY KEY",
  "separacao_id uuid NOT NULL UNIQUE",
  "marco_id uuid NOT NULL UNIQUE",
  "CREATE TRIGGER impedir_edicao_intencao BEFORE UPDATE OR DELETE",
  "CREATE TRIGGER impedir_edicao_marco BEFORE UPDATE OR DELETE",
  "ERRCODE='23514'",
  "CREATE FUNCTION catalogo_ci_intencao_pix_inerte.preparar(",
  "CREATE FUNCTION catalogo_ci_intencao_pix_inerte.marcar_inicio(",
 ])assert.ok(ddl.includes(required),required);
 assert.doesNotMatch(ddl,/\bUPDATE\s+public\.catalogo_remuneracoes_v2\b|\bDELETE\s+FROM\s+public\.catalogo_remuneracoes_v2\b/i);
});
test("#43: trava o mesmo titular e escrow antes de ler replay ou registrar marco",()=>{
 const prepareStart=ddl.indexOf("CREATE FUNCTION catalogo_ci_intencao_pix_inerte.preparar(");
 const markStart=ddl.indexOf("CREATE FUNCTION catalogo_ci_intencao_pix_inerte.marcar_inicio(");
 const preparer=ddl.slice(prepareStart,markStart);
 const marker=ddl.slice(markStart);
 for(const [part,table] of [[preparer,"intencoes"],[marker,"marcos_inicio"]]){
  const advisory=part.indexOf("pg_catalog.pg_advisory_xact_lock(");
  const reserve=part.indexOf("FOR UPDATE");
  const lookup=part.indexOf("SELECT * INTO",reserve+1);
  const insert=part.indexOf("INSERT INTO catalogo_ci_intencao_pix_inerte."+table);
  assert.ok(advisory>=0&&reserve>advisory&&insert>reserve,table);
  assert.match(part,/situacao IS DISTINCT FROM 'congelada'/);
  assert.match(part,/'pode_enviar_post',false/);
  assert.match(part,/'pode_reenviar_post',false/);
  assert.match(part,/'pagamento_autorizado',false/);
  assert.match(part,/'liberacao_autorizada',false/);
  assert.match(part,/'baixa_realizada',false/);
  assert.match(part,/'movimenta_dinheiro',false/);
 }
});
test("#43: testes PostgreSQL de 2 sessoes simulam journal COMMIT, rollback e replay",()=>{
 for(const required of [
  "def scenario_intencao_prepost_duravel_concorrente()",
  "scenario_intencao_prepost_duravel_concorrente()",
  "catalogo-asaas-journal-intencao-prepost-race-inerte.sql",
  "def intent_prepare(",
  "def intent_mark(",
  "def assert_intent_hold(",
  "assert_waiting_advisory(second.name)",
  "INTENT_FIRST_COMMITTED",
  "INTENT_MARK_REPLAY",
  "INTENT_B_FIRST_ROLLED_BACK",
  "intencao_ausente",
  "inicio_documental_gravado",
  "marco_ja_existente_sem_novo_envio",
  "tentativa_ja_tem_marco_diferente",
  "id_ou_separacao_ja_utilizado",
  "UPDATE catalogo_ci_intencao_pix_inerte.intencoes",
  "DELETE FROM catalogo_ci_intencao_pix_inerte.marcos_inicio",
  "journal PRE-POST imutavel",
 ])assert.ok(race.includes(required),required);
 assert.match(race,/EXPECTED_DB = "catalogo_asaas_race_ci"/);
 assert.match(race,/scenario_intencao_prepost_duravel_concorrente\(\)/);
});


test("#41/#42/#43: porta conjunta consulta diagnósticos reais mas nunca autoriza saldo",()=>{
 const start=ddl.indexOf("CREATE FUNCTION catalogo_ci_intencao_pix_inerte.diagnosticar_portas_hold(");
 assert.ok(start>=0,"A fixture precisa ter o diagnóstico de três frentes");
 const gate=ddl.slice(start);
 const mutex=gate.indexOf("pg_catalog.pg_advisory_xact_lock(");
 const locked=gate.indexOf("FOR UPDATE");
 const journal=gate.indexOf("catalogo_ci_intencao_pix_inerte.intencoes i");
 const matrix=gate.indexOf("public.catalogo_asaas_matriz_conciliacao_escrow(");
 const reviewers=gate.indexOf("public.catalogo_asaas_diagnosticar_dupla_conferencia_inerte(");
 assert.ok(mutex>0&&locked>mutex&&journal>locked&&matrix>journal&&reviewers>matrix);
 for(const marker of [
  "p_sinais_cliente jsonb DEFAULT '{}'::jsonb",
  "'journal_intencoes_validas_no_ci',v_contagem",
  "'journal_marcos_de_inicio_no_ci',v_marcos",
  "'duas_conferencias_documentais_observadas',v_revisoes_documentais",
  "'evidencia_independente_bancaria_suficiente',v_banco_ok",
  "'revisores_mfa_credenciados_confirmados',false",
  "'dupla_aprovacao_financeira_confirmada',false",
  "'transacao_de_baixa_habilitada',false",
  "'status_operacional','HOLD_OBRIGATORIO'",
  "'pode_enviar_post',false",
  "'pode_reenviar_post',false",
  "'pagamento_autorizado',false",
  "'liberacao_autorizada',false",
  "'baixa_realizada',false",
  "'movimenta_dinheiro',false"
 ])assert.ok(gate.includes(marker),"Missing joint gate contract: "+marker);
 assert.doesNotMatch(gate,/\b(?:INSERT INTO|UPDATE|DELETE FROM)\b/i);
 assert.match(gate,/REVOKE ALL ON FUNCTION[\s\S]*?diagnosticar_portas_hold\(uuid,jsonb\)/);
 assert.doesNotMatch(gate,/p_sinais_cliente\s*(?:->|#>|=)|\bGRANT EXECUTE\b/i);
});

test("#41/#42/#43: duas sessoes verificam HOLD com intencao, marco e sinais forjados",()=>{
 for(const required of [
  "def diagnosticar_portas_hold_ci(",
  "catalogo_ci_intencao_pix_inerte.diagnosticar_portas_hold(",
  "porta_antes = diagnosticar_portas_hold_ci(INTENT_ESCROW_A)",
  "porta_intencao = diagnosticar_portas_hold_ci(INTENT_ESCROW_A)",
  "porta_marcada = diagnosticar_portas_hold_ci(INTENT_ESCROW_A)",
  "porta_falsificada = diagnosticar_portas_hold_ci(INTENT_ESCROW_A, forged=True)",
  "porta_falsificada != porta_marcada",
  "porta_outro_titular = diagnosticar_portas_hold_ci(INTENT_ESCROW_B, forged=True)",
  "porta_ausente = diagnosticar_portas_hold_ci(",
  "'pode_reenviar_post'",
  '"dupla_aprovacao_financeira":true',
  "NUNCA_EXIBIR_PIX",
  "NUNCA_EXIBIR_CPF"
 ])assert.ok(race.includes(required),"missing 3-way gate test: "+required);
});
