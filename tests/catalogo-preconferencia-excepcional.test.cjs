"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
const sql=read("supabase/pending-migrations/20261009195000_preconferencia_financeira_excepcional_readonly.sql");
const overlap=read("supabase/pending-migrations/20261009194000_proibir_revisoes_financeiras_simultaneas.sql");
const edge=read("supabase/functions/catalogo-asaas-financeiro/index.ts");
const ui=read("js/admin-encerramentos.js");
const courier=read("js/motoboy.js");
const isolated=read("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql");
const start=edge.indexOf("async function preconferirExcepcionalAdmin(");
const end=edge.indexOf("async function consultarERegistrarTransferenciaExcepcionalSandbox(",start);
assert.ok(start>=0&&end>start,"Handler de pré-conferência existe");
const handler=edge.slice(start,end);

test("pré-conferência é somente leitura, compara saldo atual com snapshot e não autoriza Pix",()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.catalogo_asaas_preconferir_pagamento_excepcional/);
 assert.match(sql,/public\.catalogo_asaas_saldo_historico\(v_motoboy\)/);
 assert.match(sql,/v_atual=v_snapshot/);
 assert.match(sql,/saques_em_aberto/);
 assert.match(sql,/solicitacoes_sobrepostas/);
 assert.match(sql,/'pagamento_autorizado',false/);
 assert.match(sql,/'requer_revalidacao_transacional',true/);
 assert.match(sql,/IN \('reservado','enviado','revisao'\)/);
 assert.doesNotMatch(sql,/(?:UPDATE|DELETE|INSERT)\s+(?:INTO|FROM)?\s*public\./i);
 assert.doesNotMatch(sql,/asaas\.com|\/transfers/);
});

test("nenhum usuario anon ou autenticado pode explorar UUIDs de outros motoboys",()=>{
 assert.match(sql,/SECURITY DEFINER SET search_path=''/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.catalogo_asaas_preconferir_pagamento_excepcional\(text,uuid\)/);
 assert.match(sql,/FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/TO service_role/);
 assert.match(handler,/uid!==ADMIN_USER_ID/);
 assert.match(handler,/tipo==="residual"\|\|tipo==="saida"/);
 assert.match(handler,/catalogo_asaas_preconferir_pagamento_excepcional/);
 assert.match(edge,/case "preconferir_pagamento_excepcional_admin":return await preconferirExcepcionalAdmin\(user\.id,body\)/);
});

test("solicitações de dois tipos são protegidas por lock transacional compartilhado",()=>{
 assert.match(overlap,/pg_catalog\.pg_advisory_xact_lock/);
 assert.match(overlap,/hashtextextended\('revisao-financeira-motoboy:'\|\|NEW\.motoboy_id::text,0\)/);
 assert.match(overlap,/BEFORE INSERT ON public\.catalogo_asaas_saldos_residuais/);
 assert.match(overlap,/BEFORE INSERT ON public\.catalogo_asaas_regularizacoes_inativos/);
 assert.match(overlap,/status IN \('pendente','em_analise'\)/);
 assert.match(isolated,/Revisao de saida simultanea foi aceita/);
 assert.match(isolated,/Analise residual simultanea foi aceita/);
});

test("painel oferece somente conferir valores, não libera pagamento",()=>{
 assert.match(ui,/acao:"preconferir_pagamento_excepcional_admin"/);
 assert.match(ui,/preconferirPagamento\("residual",item\)/);
 assert.match(ui,/preconferirPagamento\("saida",item\)/);
 assert.match(ui,/pagamento_autorizado!==false/);
 assert.match(ui,/requer_revalidacao_transacional!==true/);
 assert.match(ui,/NÃO autoriza Pix/);
 assert.doesNotMatch(handler,/(?:asaas\(|\/transfers|catalogo_asaas_atualizar_saque|catalogo_remuneracoes_v2)/);
 assert.match(isolated,/preconferencia somente leitura, bloqueada para publico/);
});

test("carteira oculta formulario do outro tipo quando pedido concorrente está aberto",()=>{
 assert.match(courier,/residualAberto\|\|saidaAberta\|\|!state\.termosAceitos/);
 assert.match(courier,/saidaAberta\|\|residualAberto\|\|!state\.termosAceitos/);
 assert.match(courier,/!saidaAberta&&saldo>0&&saldo<minimo/);
 assert.match(courier,/!residualAberto&&carteira\.entregador_ativo===false&&saldo>=minimo/);
});

const holdPreflight=read("supabase/pending-migrations/20261009225000_preconferencia_considerar_hold_bancario.sql");

test("a pré-conferência expõe HOLD bancário e nunca libera pagamento com prova parcial",()=>{
 assert.match(holdPreflight,/catalogo_asaas_transferencias_excepcionais_auditoria/);
 assert.match(holdPreflight,/v_evidencias=0/);
 assert.match(holdPreflight,/'evidencias_bancarias_para_conciliar',v_evidencias/);
 assert.match(holdPreflight,/'pagamento_autorizado',false/);
 assert.match(holdPreflight,/'requer_revalidacao_transacional',true/);
 assert.match(ui,/evidencias bancárias ainda sem conciliação/);
 assert.match(isolated,/Preconferencia ignorou evidencia bancaria em HOLD/);
});
