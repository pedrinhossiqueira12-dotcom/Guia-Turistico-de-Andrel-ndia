"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const sql=fs.readFileSync(
 "supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql","utf8");
const start=sql.indexOf("CREATE FUNCTION pg_temp.catalogo_asaas_previsualizar_resolucao_inerte");
const end=sql.indexOf("$resolucao_preview$;",start);
const preview=sql.slice(start,end);

test("#43: PostgreSQL REAL executa preview em schema temporario, jamais na API",()=>{
 assert.ok(start>=0&&end>start);
 assert.match(preview,/RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=''/);
 assert.match(sql,/^BEGIN;[\s\S]*?CREATE FUNCTION pg_temp\.catalogo_asaas_previsualizar_resolucao_inerte/m);
 assert.match(sql,/\nROLLBACK;\s*$/);
 assert.doesNotMatch(preview,/\bINSERT\s+INTO\b|\bUPDATE\s+public\.|\bDELETE\s+FROM\b|\bPOST\b|pg_sleep|http_/i);
});
test("#43: mutex de saque e row locks ANTES de contar o livro integral",()=>{
 const mutex=preview.indexOf("pg_catalog.pg_advisory_xact_lock(");
 const lockReserva=preview.indexOf("WHERE e.id=p_separacao FOR UPDATE;");
 const scan=preview.indexOf("WITH travados AS MATERIALIZED (");
 const locked=preview.indexOf("FOR UPDATE OF i,r");
 assert.ok(mutex>0&&lockReserva>mutex&&scan>lockReserva&&locked>scan);
 assert.match(preview,/JOIN public\.catalogo_remuneracoes_v2 r ON r\.id=i\.remuneracao_id/);
 assert.match(preview,/WHERE i\.separacao_id=p_separacao/);
 assert.match(preview,/ORDER BY i\.remuneracao_id FOR UPDATE OF i,r/);
 assert.doesNotMatch(preview.replace(/--[^\n]*/g,""),/\bLIMIT\b|\bOFFSET\b/i);
});
test("#43: confere quantidade total, soma, fingerprint e financiamento sem liberar",()=>{
 for(const anchor of [
  "count(*)::bigint", "coalesce(sum(valor_separado::numeric),0)",
  "pg_catalog.string_agg(remuneracao_id::text||':'||valor_atual::text,",
  "v_qtd=v_e.creditos", "v_total=v_e.valor_centavos",
  "v_hash IS NOT DISTINCT FROM v_e.fingerprint_sha256",
  "v_invalidos=0", "financiamento_comprovado IS DISTINCT FROM true",
  "repasse_id IS NOT NULL", "catalogo_private.catalogo_v2_financiado(pedido_id)",
  "'status_operacional','HOLD_OBRIGATORIO'",
  "'beneficiario_original_confirmado',false",
  "'ausencia_de_pix_anterior_comprovada',false",
  "'dupla_autorizacao_real_comprovada',false",
  "'pagamento_autorizado',false","'liberacao_autorizada',false",
  "'baixa_realizada',false","'movimenta_dinheiro',false",
 ])assert.ok(preview.includes(anchor),anchor);
});
test("#43: PostgreSQL disposable ensaia 2 creditos e reversao sem baixas",()=>{
 assert.match(sql,/pg_temp\.catalogo_asaas_previsualizar_resolucao_inerte\(/g);
 assert.match(sql,/v_preview_resolucao->>'composicao_local_consistente' IS DISTINCT FROM 'true'/);
 assert.match(sql,/v_preview_resolucao->>'creditos_lidos_do_livro' IS DISTINCT FROM '2'/);
 assert.match(sql,/v_preview_resolucao->>'total_centavos_no_livro' IS DISTINCT FROM '12000'/);
 assert.match(sql,/v_preview_resolucao->>'creditos_invalidos' IS DISTINCT FROM '1'/);
 assert.match(sql,/v_preview_resolucao->>'classificacao_documental' IS DISTINCT FROM 'contestacao'/);
 assert.match(sql,/v_preview_resolucao->>'pagamento_autorizado' IS DISTINCT FROM 'false'/);
 assert.match(sql,/v_preview_resolucao->>'baixa_realizada' IS DISTINCT FROM 'false'/);
});

test("#43: PostgreSQL descartavel valida 1201 remuneracoes em 2 meses antes de HOLD",()=>{
 assert.match(sql,/DO \$escrow_bulk_1201\$/);
 assert.match(sql,/v_total bigint:=1201\*6000/);
 assert.match(sql,/v_target:=CASE WHEN v_month=1 THEN 601 ELSE 600 END/);
 assert.match(sql,/v_competencia:=make_date\(2097,v_month,1\)/);
 assert.match(sql,/pg_catalog\.generate_series\(1,v_target\)/);
 assert.match(sql,/INSERT INTO public\.catalogo_asaas_separacoes_excepcionais\(/);
 assert.match(sql,/INSERT INTO public\.catalogo_asaas_separacoes_excepcionais_itens\(/);
 assert.match(sql,/SELECT v_separacao,r\.id,r\.valor_centavos/);
 assert.match(sql,/v_contagem<>1201 OR v_soma<>v_total/);
 assert.match(sql,/v_previa->>'creditos_lidos_do_livro' IS DISTINCT FROM '1201'/);
 assert.match(sql,/v_previa->>'status_operacional' IS DISTINCT FROM 'HOLD_OBRIGATORIO'/);
 assert.match(sql,/v_previa->>'pagamento_autorizado' IS DISTINCT FROM 'false'/);
 assert.match(sql,/v_previa->>'movimenta_dinheiro' IS DISTINCT FROM 'false'/);
 assert.match(sql,/PASS #43 PostgreSQL: 1201 remuneracoes reais em 2 competencias, HOLD, zero Pix/);
});

test("#43: CI executa preview sob lock com duas sessoes postgres e commit/rollback",()=>{
 const script=fs.readFileSync(
  "scripts/validacao-pagamentos/test-asaas-advisory-concurrency.py","utf8");
 for(const marker of [
  "def scenario_escrow_preview_concurrent_hold()",
  "ESCROW_PREVIEW_OWNER",
  "CREATE FUNCTION pg_temp.catalogo_asaas_previsualizar_resolucao_inerte(",
  'for resolution in ("COMMIT", "ROLLBACK"):',
  "assert_waiting_advisory(second.name)",
  "HOLD_OBRIGATORIO",
  '"pagamento_autorizado": false',
  '"liberacao_autorizada": false',
  '"baixa_realizada": false',
  "scenario_escrow_preview_concurrent_hold()"
 ])assert.ok(script.includes(marker),marker);
 assert.ok(script.includes("EXPECTED_DB = \"catalogo_asaas_race_ci\""));
 assert.ok(script.includes("if run_sql("));
});

test("#43: falha depois de primeiro item reverte TODA a sombra sem mexer em remuneracao",()=>{
 const begin=sql.indexOf("-- #43: falha forjada APOS inserir header");
 const end=sql.indexOf("SELECT public.catalogo_asaas_preconferir_pagamento_excepcional('saida',v_saida)\n INTO v_posreserva;",begin);
 assert.ok(begin>=0&&end>begin);
 const fixture=sql.slice(begin,end);
 for(const contract of [
  "BEGIN\n  INSERT INTO pg_temp.catalogo_ci_escrow_planos_shadow_inertes(",
  "INSERT INTO pg_temp.catalogo_ci_escrow_planos_itens_shadow_inertes(",
  "ORDER BY i.remuneracao_id LIMIT 1",
  "USING ERRCODE='P4301'",
  "EXCEPTION WHEN SQLSTATE 'P4301' THEN NULL",
  "IF v_shadow_header<>0 OR v_shadow_itens<>0",
  "IF v_shadow_itens<>2 OR v_shadow_soma<>12000",
  "fingerprint_sha256=v_reserva->>'fingerprint_sha256'",
  "EXCEPTION WHEN unique_violation THEN v_shadow_blocks:=v_shadow_blocks+1",
  "IF v_shadow_header<>1 OR v_shadow_itens<>2",
  "Sombra alterou credito real do teste"
 ])assert.ok(fixture.includes(contract),"Contrato ausente: "+contract);
 assert.doesNotMatch(fixture,/UPDATE\s+public\.catalogo_remuneracoes_v2|DELETE\s+FROM\s+public\.catalogo_remuneracoes_v2/i);
 assert.match(sql,/CREATE TEMP TABLE catalogo_ci_escrow_planos_shadow_inertes\(/);
 assert.match(sql,/CREATE TEMP TABLE catalogo_ci_escrow_planos_itens_shadow_inertes\(/);
 assert.match(sql,/PRIMARY KEY\(separacao_id,remuneracao_id\)/);
 assert.match(sql,/ON COMMIT DROP/);
 assert.match(sql,/\nROLLBACK;\s*$/);
});

test("#43: valida cada remuneracao e detecta adulteracao com soma e contagem iguais",()=>{
 const start=sql.indexOf("CREATE FUNCTION pg_temp.catalogo_asaas_validar_itens_sombra_inerte(");
 const end=sql.indexOf("$shadow_compare$;",start);
 assert.ok(start>=0&&end>start);
 const compared=sql.slice(start,end);
 for(const marker of [
  "FULL OUTER JOIN sombra s",
  "ON s.remuneracao_id=e.remuneracao_id",
  "esperado_centavos IS DISTINCT FROM sombra_centavos",
  "esperado_id IS NULL OR sombra_id IS NULL",
  "v_diferentes=0",
  "v_planejados=v_escrow.creditos",
  "v_valor=v_escrow.valor_centavos",
  "v_fingerprint IS NOT DISTINCT FROM v_escrow.fingerprint_sha256",
  "'integridade_sombra_por_credito',coalesce(v_ok,false)",
  "'status_operacional','HOLD_OBRIGATORIO'",
  "'pagamento_autorizado',false",
  "'baixa_realizada',false"
 ])assert.ok(compared.includes(marker),"Ausente: "+marker);
 assert.doesNotMatch(compared,/\bUPDATE\b|\bDELETE\b|\bINSERT\b|http_post|fetch\(/i);
});
test("#43: soma balanceada (+1/-1), item apagado e replay errado sao bloqueados",()=>{
 const start=sql.indexOf("-- Comparacao de cada remuneracao contra o snapshot reservado");
 const end=sql.indexOf("-- Replay de IDENTICA tentativa/versao:",start);
 assert.ok(start>=0&&end>start);
 const f=sql.slice(start,end);
 for(const expected of [
  "CASE\n   WHEN si.remuneracao_id",
  "THEN 1 ELSE -1 END",
  "IF v_shadow_itens<>2 OR v_shadow_soma<>12000",
  "v_shadow_diag->>'itens_divergentes_ou_ausentes' IS DISTINCT FROM '2'",
  "EXCEPTION WHEN SQLSTATE 'P4304' THEN NULL",
  "DELETE FROM pg_temp.catalogo_ci_escrow_planos_itens_shadow_inertes",
  "v_shadow_diag->>'itens_divergentes_ou_ausentes' IS DISTINCT FROM '1'",
  "EXCEPTION WHEN SQLSTATE 'P4305' THEN NULL",
  "Rollback dos ataques deixou plano corrompido",
  "gen_random_uuid()) INTO v_shadow_diag",
  "Tentativa sem identificador valido parecia integra"
 ])assert.ok(f.includes(expected),"Ausente: "+expected);
 assert.match(sql,/\nROLLBACK;\s*$/);
});
