"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const sql=fs.readFileSync("supabase/pending-migrations/20261010001000_matriz_conciliacao_escrow_somente_leitura.sql","utf8");
const edge=fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");
const ui=fs.readFileSync("js/admin-encerramentos.js","utf8");
const fixture=fs.readFileSync("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql","utf8");

test("matriz de conciliação sempre é somente leitura e recusa liquidação",()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.catalogo_asaas_matriz_conciliacao_escrow/);
 assert.match(sql,/LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''/);
 assert.match(sql,/'destino_pix_original_vinculado_com_prova',false/);
 assert.match(sql,/'destino_pix_confirmado_no_provedor',false/);
 assert.match(sql,/'ausencia_de_pix_anterior_comprovada',false/);
 assert.match(sql,/'evidencia_suficiente_para_liquidar',false/);
 assert.match(sql,/'evidencia_suficiente_para_liberar',false/);
 assert.match(sql,/'pagamento_autorizado',false/);
 assert.match(sql,/'baixa_realizada',false/);
 assert.match(sql,/'movimenta_dinheiro',false/);
 assert.doesNotMatch(sql,/\bUPDATE\s+public\.|\bDELETE\s+FROM\s+public\.|POST\s+\/transfers/);
});
test("confronto analisa apenas evidências ligadas ao ID original da separação",()=>{
 assert.match(sql,/WHERE e\.tipo=v_e\.tipo AND e\.solicitacao_id=v_e\.solicitacao_id/);
 assert.match(sql,/v_referencia:='guia-exc:'\|\|v_e\.tipo/);
 assert.match(sql,/e\.referencia_externa IS DISTINCT FROM v_referencia/);
 assert.match(sql,/e\.valor_centavos IS DISTINCT FROM v_e\.valor_centavos/);
 assert.match(sql,/e\.motoboy_id IS DISTINCT FROM v_e\.motoboy_id/);
 assert.match(sql,/e\.creditos_fingerprint_observado_sha256 IS DISTINCT FROM v_e\.fingerprint_sha256/);
 assert.match(sql,/e\.creditos_observados IS DISTINCT FROM v_e\.creditos/);
 assert.match(sql,/e\.composicao_conferida_na_observacao IS DISTINCT FROM true/);
 assert.match(sql,/WHERE s\.transferencia_id=e\.transferencia_id/);
 assert.doesNotMatch(sql,/LIMIT\s+1000/);
});
test("conta conflitos de estado: DONE, FAILED/CANCELLED, PENDING e estado desconhecido",()=>{
 for(const word of ["DONE","FAILED","CANCELLED","PENDING","IN_BANK_PROCESSING","BLOCKED"])
  assert.ok(sql.includes("'"+word+"'"),"Estado ausente: "+word);
 assert.match(sql,/tem_done AND o\.tem_falha/);
 assert.match(sql,/'transferencias_com_done_e_falha',v_estados_incompativeis/);
 assert.match(sql,/'transferencias_tambem_vinculadas_a_saques_comuns',v_compartilhadas_saque/);
 assert.match(sql,/'contagem_sinais_de_conflito',v_conflitos/);
 assert.match(sql,/ausência de evidência não comprova que não houve Pix/);
});
test("RLS e privilégios RPC não são expostos ao cliente",()=>{
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.catalogo_asaas_matriz_conciliacao_escrow\(uuid\)/);
 assert.match(sql,/FROM PUBLIC,anon,authenticated,service_role/);
 assert.match(sql,/TO service_role/);
 assert.doesNotMatch(sql,/TO authenticated\s*;/);
 const start=edge.indexOf("async function matrizConciliacaoEscrowAdmin(");
 const end=edge.indexOf("async function auditarHistoricoTransferenciasExcepcionaisSandboxAdmin(",start);
 assert.ok(start>=0&&end>start);
 const handler=edge.slice(start,end);
 assert.match(handler,/uid!==ADMIN_USER_ID/);
 assert.match(handler,/catalogo_asaas_matriz_conciliacao_escrow/);
 assert.match(handler,/matriz\.evidencia_suficiente_para_liquidar===false/);
 assert.match(handler,/matriz\.evidencia_suficiente_para_liberar===false/);
 assert.match(handler,/matriz\.baixa_realizada===false/);
 assert.doesNotMatch(handler,/asaas\(|fetch\(|POST \/transfers/);
 assert.match(edge,/case "matriz_conciliacao_escrow_admin":return await matrizConciliacaoEscrowAdmin\(user\.id,body\)/);
});
test("interface mostra HOLD, status e conflito com saque comum sem criar Pix",()=>{
 assert.match(ui,/Conferir evidências bancárias \(somente leitura\)/);
 assert.match(ui,/acao:"matriz_conciliacao_escrow_admin"/);
 assert.match(ui,/HOLD OBRIGATÓRIO/);
 assert.match(ui,/transferencias_tambem_vinculadas_a_saques_comuns/);
 assert.match(ui,/fotografias_creditos_incompletas_ou_divergentes/);
 assert.match(ui,/Nenhum crédito liberado, nenhuma baixa e nenhum Pix criado/);
});
test("regressão PostgreSQL homologou ausência de GET e DONE sem comprovar destinatário",()=>{
 assert.match(fixture,/v_matriz_antes->>'transferencias_observadas' IS DISTINCT FROM '0'/);
 assert.match(fixture,/v_matriz_depois->>'transferencias_com_done' IS DISTINCT FROM '1'/);
 assert.match(fixture,/v_matriz_depois->>'destino_pix_confirmado_no_provedor' IS DISTINCT FROM 'false'/);
 assert.match(fixture,/v_matriz_depois->>'evidencia_suficiente_para_liquidar' IS DISTINCT FROM 'false'/);
 assert.match(fixture,/has_function_privilege\('authenticated','public\.catalogo_asaas_matriz_conciliacao_escrow\(uuid\)','EXECUTE'\)/);
});
