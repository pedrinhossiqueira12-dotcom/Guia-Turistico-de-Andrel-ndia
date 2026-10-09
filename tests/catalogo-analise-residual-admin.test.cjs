"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");

const edge=fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts","utf8");
const js=fs.readFileSync("js/admin-encerramentos.js","utf8");
const html=fs.readFileSync("pages/admin-encerramentos.html","utf8");
const sql=fs.readFileSync("supabase/pending-migrations/20261009185000_bloquear_conclusao_saldo_residual_sem_prova.sql","utf8");

const begin=edge.indexOf("async function revisarAnaliseResidual(");
const end=edge.indexOf("async function reconcileTransfer(",begin);
assert.ok(begin>0&&end>begin,"O handler administrativo deve existir");
const handler=edge.slice(begin,end);

test("somente administrador autenticado pode revisar, por identificador válido",()=>{
 assert.match(handler,/uid!==ADMIN_USER_ID/);
 assert.match(handler,/status=403|,403/);
 assert.match(handler,/\[0-9a-f\]\{8\}/);
 assert.match(edge,/case "revisar_analise_residual_admin":return await revisarAnaliseResidual\(user\.id,body\)/);
 assert.match(edge,/const user=await auth\(request\)/);
});

test("revisão usa comparação atômica do estado e impede conclusão paga",()=>{
 assert.match(handler,/destino==="recusada"/);
 assert.match(handler,/destino==="em_analise"&&esperado==="pendente"/);
 assert.match(handler,/\.eq\("id",id\)\.eq\("status",esperado\)/);
 assert.match(handler,/A solicitação mudou de estado/);
 assert.doesNotMatch(handler,/concluida|\/transfers|catalogo_asaas_atualizar_saque|catalogo_asaas_reservar_saque|asaas\(/);
 assert.match(sql,/IF NEW\.status = 'concluida' THEN/);
});

test("recusa exige justificativa, preserva carteira, registra revisor e hora",()=>{
 assert.match(handler,/detalhe\.length<=1000/);
 assert.match(handler,/detalhe\.length>=20/);
 assert.match(handler,/analisado_por:uid,atualizado_em:agora/);
 assert.match(handler,/finalizado_em:destino==="recusada"\?agora:null/);
 assert.match(handler,/O saldo do entregador permanece intacto/);
 assert.doesNotMatch(handler,/\.delete\(|from\("catalogo_remuneracoes_v2"\)|wallet\(/);
});

test("painel nunca oferece marcar pago nem revelar chave Pix",()=>{
 assert.match(html,/id="listaAnalisesResiduais"/);
 assert.match(html,/não envia Pix/);
 assert.match(js,/acao:"listar_analises_residuais_admin"/);
 assert.match(js,/acao:"revisar_analise_residual_admin"/);
 assert.match(js,/status_esperado:String\(item\.status/);
 assert.match(js,/\.textContent=/);
 assert.match(js,/window\.confirm/);
 assert.doesNotMatch(js,/innerHTML\s*=|concluida|\/transfers|PIX_KEY|chave_pix/);
});
