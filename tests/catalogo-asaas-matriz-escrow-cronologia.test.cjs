"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const sql=fs.readFileSync("supabase/pending-migrations/20261010002000_conciliacao_escrow_estados_bancarios_fora_de_ordem.sql","utf8");
const ui=fs.readFileSync("js/admin-encerramentos.js","utf8");
const ci=fs.readFileSync("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql","utf8");

test("nova matriz identifica regressao depois de estado final sem assumir banco quitado",()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.catalogo_asaas_matriz_conciliacao_escrow/);
 assert.match(sql,/t\.estado_banco IN \('DONE','FAILED','CANCELLED'\)/);
 assert.match(sql,/o\.estado_banco IN \('PENDING','IN_BANK_PROCESSING','BLOCKED'\)/);
 assert.match(sql,/t\.observado_em<o\.observado_em/);
 assert.match(sql,/tem_retorno_a_processamento/);
 assert.match(sql,/'transferencias_com_retorno_a_processamento',v_regressos_pos_terminal/);
 assert.match(sql,/v_conflitos:=v_sem_observacao\+v_estados_incompativeis\+/);
 assert.match(sql,/v_regressos_pos_terminal\+v_horarios_ambiguos/);
});
test("ordem de observacoes usa timestamp por evento e sinaliza empates ao invés de desempatar arbitrariamente",()=>{
 assert.match(sql,/ALTER COLUMN observado_em SET DEFAULT pg_catalog\.clock_timestamp\(\)/);
 assert.match(sql,/t\.id<>o\.id AND t\.observado_em=o\.observado_em/);
 assert.match(sql,/tem_horario_ambiguo/);
 assert.match(sql,/'transferencias_com_ordem_temporal_ambigua',v_horarios_ambiguos/);
 assert.match(sql,/'ultimo_estado_observado_sem_valor_de_prova',v_estado_ultimo/);
});
test("nenhuma descoberta de historico equivale a pagamento ou destinacao Pix comprovada",()=>{
 for(const key of [
 "'destino_pix_original_vinculado_com_prova',false",
 "'destino_pix_confirmado_no_provedor',false",
 "'ausencia_de_pix_anterior_comprovada',false",
 "'evidencia_suficiente_para_liquidar',false",
 "'evidencia_suficiente_para_liberar',false",
 "'pagamento_autorizado',false",
 "'baixa_realizada',false",
 "'movimenta_dinheiro',false",
 ]) assert.ok(sql.includes(key),"Proteção ausente: "+key);
 assert.doesNotMatch(sql,/\bUPDATE\s+public\.catalogo_remuneracoes|\bPOST\s+\/transfers|\bDELETE\s+FROM/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.catalogo_asaas_matriz_conciliacao_escrow\(uuid\)/);
 assert.match(sql,/TO service_role/);
});
test("painel evidencia regresso e empates, mantendo HOLD",()=>{
 assert.match(ui,/transferencias_com_retorno_a_processamento/);
 assert.match(ui,/transferencias_com_ordem_temporal_ambigua/);
 assert.match(ui,/ultimo_estado_observado_sem_valor_de_prova/);
 assert.match(ui,/HOLD OBRIGATÓRIO/);
 assert.match(ui,/Nenhum crédito liberado, nenhuma baixa e nenhum Pix criado/);
});
test("CI inclui DONE seguido de PENDING e dois registros com horario igual",()=>{
 assert.match(ci,/Retorno a PENDING nao foi auditado/);
 assert.match(ci,/transferencias_com_retorno_a_processamento' IS DISTINCT FROM '1'/);
 assert.match(ci,/ultimo_estado_observado_sem_valor_de_prova' IS DISTINCT FROM 'PENDING'/);
 assert.match(ci,/transferencias_com_ordem_temporal_ambigua' IS DISTINCT FROM '1'/);
 assert.match(ci,/Horario bancario ambiguo nao manteve HOLD/);
});
