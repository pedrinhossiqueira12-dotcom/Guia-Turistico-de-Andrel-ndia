"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
const sql=read("supabase/pending-migrations/20261009233500_revalidar_aprovacao_saque_bloqueios_excepcionais.sql");
const edge=read("supabase/functions/catalogo-asaas-financeiro/index.ts");
const ci=read("supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql");
const start=edge.indexOf("async function authorizeWithdrawal(");
const end=edge.indexOf("async function webhook(",start);
assert.ok(start>=0&&end>start);
const handler=edge.slice(start,end);

test("replays de autorização consultam estado financeiro antes de reutilizar APPROVED",()=>{
 const newCheck=handler.indexOf("const {data:revalidacao,error:revalidacaoError}=await db.rpc(");
 const stored=handler.indexOf('db.from("catalogo_asaas_validacoes_saque")');
 assert.ok(newCheck>=0 && stored>newCheck,"Consulta à RPC deve anteceder APPROVED em cache");
 assert.match(handler,/catalogo_asaas_validar_reserva_saque/);
 assert.match(handler,/if\(revalidacaoError \|\| revalidacao\?\.ok!==true\)/);
 assert.match(handler,/if\(revalidacao\.elegivel!==true\)/);
 assert.match(handler,/approveResponse\("REFUSED","Reserva suspensa ou créditos não elegíveis/);
 assert.match(handler,/if\(existing\)return approveResponse\(existing\.decisao==="APPROVED"/);
});

test("RPC bloqueia revisão aberta e evidência bancária mesmo com remunerações financiadas",()=>{
 assert.match(sql,/catalogo_asaas_saldos_residuais r/);
 assert.match(sql,/catalogo_asaas_regularizacoes_inativos s/);
 assert.match(sql,/catalogo_asaas_transferencias_excepcionais_auditoria e/);
 assert.match(sql,/v_saque\.status='enviado' AND NOT v_bloqueio AND v_perfil_apto/);
 assert.match(sql,/perfil\.apto AND NOT perfil\.em_analise/);
 assert.match(sql,/m\.usuario_id=v_saque\.motoboy_id AND m\.ativo/);
 assert.match(sql,/'perfil_atualmente_apto',v_perfil_apto/);
 assert.match(sql,/'bloqueio_excepcional',v_bloqueio/);
 assert.match(sql,/v_elegiveis AND v_total=v_saque\.valor_centavos/);
 assert.doesNotMatch(sql,/INSERT INTO|UPDATE public\.catalogo_remuneracoes_v2|POST \/transfers/);
});

test("RPC privada e regressão transacional cobrem evidência tardia",()=>{
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.catalogo_asaas_validar_reserva_saque\(uuid\)/);
 assert.match(sql,/FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/TO service_role/);
 assert.match(ci,/Replay de autorizacao poderia ignorar HOLD posterior/);
 assert.match(ci,/v_after->>'bloqueio_excepcional' IS DISTINCT FROM 'true'/);
 assert.match(ci,/Revalidacao de saque exposta a usuarios comuns/);
});
