"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
const sql=read("supabase/pending-migrations/20261009235950_diagnostico_escrow_excepcional_somente_leitura.sql");
const ci=read("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql");
const edge=read("supabase/functions/catalogo-asaas-financeiro/index.ts");
const page=read("pages/admin-encerramentos.html");
const ui=read("js/admin-encerramentos.js");

test("diagnostico contabil privado revalida creditos e a fotografia originalmente congelada",()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.catalogo_asaas_diagnosticar_separacao_excepcional\(/);
 assert.match(sql,/LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''/);
 assert.match(sql,/i\.valor_centavos IS DISTINCT FROM r\.valor_centavos/);
 assert.match(sql,/r\.motoboy_id IS DISTINCT FROM v_e\.motoboy_id/);
 assert.match(sql,/catalogo_private\.catalogo_v2_financiado\(r\.pedido_id\)/);
 assert.match(sql,/EXISTS\([\s\S]*?public\.catalogo_asaas_saque_itens/);
 assert.match(sql,/pg_catalog\.sha256\(pg_catalog\.convert_to/);
 assert.match(sql,/pg_catalog\.string_agg\(r\.id::text\|\|':'\|\|r\.valor_centavos::text/);
 assert.match(sql,/v_itens=v_e\.creditos/);
 assert.match(sql,/v_valor=v_e\.valor_centavos/);
 assert.match(sql,/v_hash IS NOT DISTINCT FROM v_e\.fingerprint_sha256/);
 assert.match(sql,/v_invalidos=0/);
 assert.doesNotMatch(sql,/\bLIMIT\s+1000\b|\bLIMIT\s+\d+\b/);
});

test("DONE tardio e estorno aparecem como riscos; nenhum caminho libera reserva",()=>{
 assert.match(sql,/catalogo_asaas_transferencias_excepcionais_auditoria/);
 assert.match(sql,/catalogo_asaas_observacoes_excepcionais_auditoria/);
 assert.match(sql,/count\(DISTINCT e\.id\)/);
 assert.match(sql,/o\.estado_banco='DONE'/);
 assert.match(sql,/'creditos_financeiramente_invalidos',v_invalidos/);
 assert.match(sql,/'exige_apuracao_bancaria_independente',true/);
 assert.match(sql,/'liberacao_automatica_autorizada',false/);
 assert.match(sql,/'quitacao_automatica_autorizada',false/);
 assert.match(sql,/'pode_reutilizar_creditos',false/);
 assert.match(sql,/'movimenta_dinheiro',false/);
 assert.doesNotMatch(sql,/\b(UPDATE|INSERT INTO|DELETE FROM|TRUNCATE)\s+public\./);
});

test("diagnostico so admite service_role; Edge exige identidade administrativa",()=>{
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.catalogo_asaas_diagnosticar_separacao_excepcional\(uuid\)/);
 assert.match(sql,/FROM PUBLIC,anon,authenticated,service_role/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.catalogo_asaas_diagnosticar_separacao_excepcional\(uuid\)/);
 assert.match(sql,/TO service_role/);
 const start=edge.indexOf("async function diagnosticarSeparacaoCongeladaAdmin(");
 const end=edge.indexOf("// Somente conferencia de valores.",start);
 assert.ok(start>=0&&end>start);
 const handler=edge.slice(start,end);
 assert.match(handler,/uid!==ADMIN_USER_ID/);
 assert.match(handler,/catalogo_asaas_diagnosticar_separacao_excepcional/);
 assert.match(handler,/liberacao_automatica_autorizada===false/);
 assert.match(handler,/quitacao_automatica_autorizada===false/);
 assert.match(handler,/pode_reutilizar_creditos===false/);
 assert.doesNotMatch(handler,/\bas aas\(|POST|INSERT INTO|UPDATE public\./);
 assert.match(edge,/case "diagnosticar_separacao_congelada_admin":return await diagnosticarSeparacaoCongeladaAdmin\(user\.id,body\)/);
 assert.match(edge,/case "listar_separacoes_congeladas_admin":return await listarSeparacoesCongeladasAdmin\(user\.id\)/);
});

test("painel mostra congelamentos mesmo após recusa e nenhum botão que paga",()=>{
 assert.match(page,/id="listaSeparacoesExcepcionais"/);
 assert.match(page,/Créditos congelados para conciliação excepcional/);
 assert.match(ui,/acao:"listar_separacoes_congeladas_admin"/);
 assert.match(ui,/acao:"diagnosticar_separacao_congelada_admin"/);
 assert.match(ui,/Diagnosticar sem desbloquear/);
 assert.match(ui,/Créditos NÃO pagos/);
 assert.match(ui,/liberacao_automatica_autorizada!==false/);
 assert.match(ui,/quitacao_automatica_autorizada!==false/);
 assert.match(ui,/Mostrando apenas as 100 separações mais recentes/);
 assert.doesNotMatch(ui,/\b(acao:"liberar_escrow"|acao:"quitar_escrow"|acao:"pagar_escrow")\b/);
});
test("cenarios PostgreSQL verificam sanidade, DONE tardio, reversao e bloqueio de Pix",()=>{
 assert.match(ci,/DO \$escrow_creditos\$/);
 assert.match(ci,/v_diagnostico->>'composicao_inalterada_e_financiada' IS DISTINCT FROM 'true'/);
 assert.match(ci,/v_diagnostico_banco->>'observacoes_done' IS DISTINCT FROM '1'/);
 assert.match(ci,/v_diagnostico_reversao->>'creditos_financeiramente_invalidos' IS DISTINCT FROM '1'/);
 assert.match(ci,/v_diagnostico_reversao->>'composicao_inalterada_e_financiada' IS DISTINCT FROM 'false'/);
 assert.match(ci,/has_function_privilege\('anon',\s*'public\.catalogo_asaas_diagnosticar_separacao_excepcional\(uuid\)','EXECUTE'\)/);
});
