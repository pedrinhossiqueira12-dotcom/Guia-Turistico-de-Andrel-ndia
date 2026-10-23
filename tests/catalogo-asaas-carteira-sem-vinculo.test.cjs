"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=x=>fs.readFileSync(x,"utf8");
const newMigration=read("supabase/pending-migrations/20261009235000_preservar_carteira_motoboy_sem_vinculo.sql");
const edge=read("supabase/functions/catalogo-asaas-financeiro/index.ts");
const sec=(from,to)=>{const a=edge.indexOf(from);const b=edge.indexOf(to,a+from.length);assert.ok(a>=0&&b>a,from+" / "+to);return edge.slice(a,b);};
const auth=sec("async function roleScope(","async function termsStatus(");
const wallet=sec("async function wallet(","async function solicitarAnaliseResidual(");

test("historico de comissoes e faturas depende do titular do ledger, nao da existencia de vinculo",()=>{
 assert.match(newMigration,/CREATE OR REPLACE FUNCTION public\.catalogo_asaas_saldo_historico/);
 assert.match(newMigration,/CREATE OR REPLACE FUNCTION public\.catalogo_asaas_pendencias_historicas/);
 assert.match(newMigration,/WHERE r\.motoboy_id=p_motoboy/g);
 assert.doesNotMatch(newMigration,/EXISTS\([\s\S]*?FROM public\.catalogo_motoboys/);
 assert.match(newMigration,/NOT EXISTS\([\s\S]*?FROM public\.catalogo_asaas_saque_itens/);
 assert.match(newMigration,/c\.status='paga' AND f\.status='pago'/);
 assert.match(newMigration,/b\.gateway='asaas' AND b\.status='pago'/);
});

test("Edge consulta historico com usuario autenticado e conserva saque normal dependente de vinculo ativo",()=>{
 assert.match(wallet,/db\.from\("catalogo_remuneracoes_v2"\)/);
 assert.match(wallet,/\.select\("id"\)\.eq\("motoboy_id",uid\)\.limit\(1\)/);
 assert.match(wallet,/if\(!allowed\?\.length&&!titularHistorico\)/);
 assert.match(wallet,/const activeCourier=Boolean\(active\?\.length\)/);
 assert.match(wallet,/saque_habilitado:activeCourier/);
 assert.match(edge,/case "consultar_carteira":return await wallet\(user\.id,true\)/);
 assert.match(edge,/const user=await auth\(request\)/);
});

test("ex-motoboy sem vinculo pode aceitar termos apenas se tiver remuneracao registrada",()=>{
 assert.match(auth,/if\(!data\?\.length && allowInactiveMotoboy\)/);
 assert.match(auth,/db\.from\("catalogo_remuneracoes_v2"\)/);
 assert.match(auth,/\.eq\("motoboy_id",uid\)/);
 assert.match(auth,/historicoPermiteLeitura=Boolean\(historico\?\.length\)/);
 assert.match(auth,/check\(Boolean\(data\?\.length\)\|\|historicoPermiteLeitura/);
 assert.match(edge,/await roleScope\(uid,papel,store,papel==="motoboy"\)/);
 assert.match(edge,/requireTerms\(uid,"motoboy","",true\)/);
});

test("RPC de historico e pendencias so backend, sem permitir baixas",()=>{
 for(const fn of ["catalogo_asaas_saldo_historico","catalogo_asaas_pendencias_historicas"]){
  assert.match(newMigration,new RegExp("REVOKE ALL ON FUNCTION public\\."+fn+"\\(uuid\\)"));
  assert.match(newMigration,new RegExp("GRANT EXECUTE ON FUNCTION public\\."+fn+"\\(uuid\\)"));
 }
 assert.match(newMigration,/FROM PUBLIC, anon, authenticated/);
 assert.match(newMigration,/TO service_role/);
 assert.doesNotMatch(newMigration,/UPDATE public\.catalogo_remuneracoes_v2|INSERT INTO public\.catalogo_repasses_v2|\/transfers/);
});

const ui=read("js/motoboy.js");
test("403 em entregas não elimina a carteira do ex-motoboy",()=>{
 const start=ui.indexOf("async function carregarEntregas(");
 const end=ui.indexOf("function renderizarCarteira()",start);
 assert.ok(start>=0&&end>start);
 const deliveries=ui.slice(start,end);
 assert.match(deliveries,/if \(erro\.status === 401\) \{ limparDadosPrivados\(\); fecharConfirmacao\(\); \}/);
 assert.match(deliveries,/else if \(erro\.status === 403\) \{/);
 assert.match(deliveries,/state\.pedidos = \[\]/);
 assert.match(deliveries,/state\.hasMore = false/);
 assert.match(deliveries,/Sua carteira de comissões históricas continua disponível/);
 assert.doesNotMatch(deliveries,/erro\.status === 403 \|\| erro\.status === 401/);
});

test("403 em extrato operacional não limpa o saldo financeiro paralelo",()=>{
 const start=ui.indexOf("async function carregarExtrato(");
 const end=ui.indexOf("function fecharConfirmacao()",start);
 assert.ok(start>=0&&end>start);
 const extract=ui.slice(start,end);
 assert.match(extract,/if \(erro\.status === 401\) limparDadosPrivados\(\)/);
 assert.match(extract,/else if \(erro\.status === 403\) \{/);
 assert.match(extract,/state\.extrato = null/);
 assert.match(extract,/Consulte a carteira financeira para seus créditos históricos/);
 assert.doesNotMatch(extract,/erro\.status === 401 \|\| erro\.status === 403\) limparDadosPrivados/);
});
