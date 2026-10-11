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
 assert.match(sql,/FOR v_i IN 1\.\.v_target LOOP/);
 assert.match(sql,/catalogo_asaas_separar_creditos_excepcionais\(\s*'saida',v_saida\)/);
 assert.match(sql,/v_reserva->>'creditos_separados' IS DISTINCT FROM '1201'/);
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
