"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
const sql=read("supabase/pending-migrations/20261009235900_preconferencia_identificar_creditos_individuais.sql");
const edge=read("supabase/functions/catalogo-asaas-financeiro/index.ts");
const ui=read("js/admin-encerramentos.js");
const ci=read("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql");

test("SHA-256 nasce apenas de IDs e valores ordenados de todas as remuneracoes elegiveis",()=>{
 assert.match(sql,/pg_catalog\.sha256\(pg_catalog\.convert_to/);
 assert.match(sql,/pg_catalog\.string_agg\(r\.id::text\|\|':'\|\|r\.valor_centavos::text/);
 assert.match(sql,/ORDER BY r\.id/);
 assert.match(sql,/r\.status='disponivel' AND r\.financiamento_comprovado/);
 assert.match(sql,/r\.repasse_id IS NULL AND r\.valor_centavos>0/);
 assert.match(sql,/catalogo_private\.catalogo_v2_financiado\(r\.pedido_id\)/);
 assert.match(sql,/SELECT 1 FROM public\.catalogo_asaas_saque_itens i/);
 assert.doesNotMatch(sql,/\bLIMIT\s+1000\b|\bLIMIT\s+\d+\b/);
});

test("soma e quantidade da lista individual precisam reconciliar com o saldo historico",()=>{
 assert.match(sql,/v_individuais=v_creditos/);
 assert.match(sql,/v_total_individual=v_atual/);
 assert.match(sql,/v_fingerprint IS NOT NULL AND length\(v_fingerprint\)=64/);
 assert.match(sql,/AND v_creditos>0 AND v_composicao_integra/);
 assert.match(sql,/'fingerprint_creditos_sha256',v_fingerprint/);
 assert.match(sql,/'valor_creditos_individuais_centavos',v_total_individual/);
 assert.match(sql,/'creditos_individuais_validos',v_individuais/);
});

test("consulta continua administrativa, somente service_role e nunca autoriza nem paga",()=>{
 assert.match(edge,/async function preconferirExcepcionalAdmin\(/);
 assert.match(edge,/if\(uid!==ADMIN_USER_ID\)/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.catalogo_asaas_preconferir_pagamento_excepcional\(text,uuid\)/);
 assert.match(sql,/FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/TO service_role/);
 assert.match(sql,/'pagamento_autorizado',false/);
 assert.match(sql,/'requer_revalidacao_transacional',true/);
 assert.doesNotMatch(sql,/\b(INSERT INTO|UPDATE public\.|DELETE FROM public\.)\b|POST \/transfers/);
});

test("painel exibe prova informativa e recusa autorizar transferencias",()=>{
 assert.match(ui,/créditos individualmente conferidos/);
 assert.match(ui,/composicao_creditos_integra===true/);
 assert.match(ui,/fingerprint_creditos_sha256/);
 assert.match(ui,/\^\[0-9a-f\]\{64\}\$/);
 assert.match(ui,/c\.pagamento_autorizado!==false/);
 assert.match(ui,/NÃO prova de pagamento/);
});
test("PostgreSQL descarta as fixtures de 1 e 2 creditos e rejeita aprovação",()=>{
 assert.match(ci,/DO \$positive_orphan_balance\$/);
 assert.match(ci,/DO \$orphan_large_balance\$/);
 assert.match(ci,/v_preflight->>'creditos_individuais_validos' IS DISTINCT FROM '1'/);
 assert.match(ci,/v_preflight->>'creditos_individuais_validos' IS DISTINCT FROM '2'/);
 assert.match(ci,/length\(v_preflight->>'fingerprint_creditos_sha256'\)<>64/);
 assert.match(ci,/v_preflight->>'fingerprint_creditos_sha256'[\s\S]*?IS DISTINCT FROM v_again->>'fingerprint_creditos_sha256'/);
 assert.match(ci,/v_preflight->>'pagamento_autorizado' IS DISTINCT FROM 'false'/);
});
