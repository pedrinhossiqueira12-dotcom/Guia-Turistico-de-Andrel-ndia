"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
const sql=read("supabase/pending-migrations/20261009223000_trava_comum_saque_regular_e_revisao_excepcional.sql");
const isolated=read("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql");
const edge=read("supabase/functions/catalogo-asaas-financeiro/index.ts");
const ui=read("js/motoboy.js");

test("mesma trava por motoboy protege saques e ambas as revisoes",()=>{
 assert.match(sql,/pg_catalog\.pg_advisory_xact_lock/g);
 assert.match(sql,/pg_catalog\.hashtextextended\('asaas-saque:'\|\|NEW\.motoboy_id::text,0\)/g);
 assert.match(sql,/BEFORE INSERT ON public\.catalogo_asaas_saques/);
 assert.match(sql,/BEFORE INSERT ON public\.catalogo_asaas_saldos_residuais/);
 assert.match(sql,/BEFORE INSERT ON public\.catalogo_asaas_regularizacoes_inativos/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION catalogo_private\.catalogo_bloquear_saque_com_revisao_aberta/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION catalogo_private\.catalogo_bloquear_revisao_com_saque_em_aberto/);
});

test("preflight recusa estados históricos conflitantes sem apagá-los",()=>{
 assert.match(sql,/DO \$preflight\$/);
 assert.match(sql,/status IN \('reservado','enviado','revisao'\)/);
 assert.match(sql,/status IN \('pendente','em_analise'\)/);
 assert.match(sql,/Conciliar antes de migrar/);
 assert.doesNotMatch(sql,/INSERT INTO public\.catalogo_asaas_saques|UPDATE public\.catalogo_remuneracoes_v2|\/transfers/);
});

test("falha em aberto retém dinheiro; somente saques bancários encerrados liberam novo pedido",()=>{
 assert.match(sql,/saque\.status IN \('reservado','enviado','revisao'\)/);
 assert.match(sql,/s\.status IN \('reservado','enviado','revisao'\)/);
 assert.match(isolated,/Saque regular criado durante analise residual aberta/);
 assert.match(isolated,/Regularizacao criada durante saque regular reservado/);
 assert.match(isolated,/Analise residual criada durante saque regular reservado/);
 assert.match(isolated,/Saque regular criado durante regularizacao aberta/);
 assert.match(isolated,/v_refused<>4/);
});

test("browser bloqueia pedido de saque enquanto há revisão excepcional aberta",()=>{
 assert.match(edge,/revisao_excepcional_aberta:revisaoExcepcionalAberta/);
 assert.match(edge,/saque_habilitado:activeCourier&&!revisaoExcepcionalAberta&&!evidenciaBancariaPendente&&ENVIRONMENT==="sandbox"/);
 assert.match(ui,/carteira\.revisao_excepcional_aberta===true/);
 assert.match(ui,/saque comum ficará bloqueado até a decisão administrativa/);
 assert.match(ui,/botao\.disabled = !state\.session \|\| state\.withdrawalLoading \|\| !carteira\.saque_habilitado/);
});

test("gatilhos privados não podem ser executados diretamente por clientes",()=>{
 assert.match(sql,/REVOKE ALL ON FUNCTION catalogo_private\.catalogo_bloquear_saque_com_revisao_aberta\(\)/);
 assert.match(sql,/REVOKE ALL ON FUNCTION catalogo_private\.catalogo_bloquear_revisao_com_saque_em_aberto\(\)/);
 assert.match(sql,/FROM PUBLIC,anon,authenticated,service_role/);
});
