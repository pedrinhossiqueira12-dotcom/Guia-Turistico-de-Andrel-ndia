"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fn = fs.readFileSync("supabase/functions/catalogo-asaas-financeiro/index.ts", "utf8");

function section(start,end) {
  const a=fn.indexOf(start),b=fn.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,"Seção não encontrada: "+start);
  return fn.slice(a,b);
}

const roles=section("async function roleScope(","async function termsStatus(");
const terms=section("async function termsStatus(","async function requestClosure(");
const wallet=section("async function wallet(","async function solicitarAnaliseResidual(");
const residual=section("async function solicitarAnaliseResidual(","async function consultarEncerramento(");
const withdraw=section("async function withdraw(","async function listAdminPayouts(");

test("inativo continua sendo motoboy histórico, mas o filtro ativo é o padrão",()=>{
  assert.match(roles,/allowInactiveMotoboy=false/);
  assert.match(roles,/if\(!allowInactiveMotoboy\)query=query\.eq\("ativo",true\)/);
  assert.match(roles,/\.eq\("usuario_id",uid\)/);
});

test("termos podem ser renovados por motoboy inativo sem reabilitar entregas",()=>{
  assert.match(terms,/papel==="motoboy"/);
  assert.match(terms,/termsStatus\(uid,papel,store,papel==="motoboy"\)/);
  assert.match(fn,/case "consultar_termos":[\s\S]*value\(body\.papel,15\)==="motoboy"/);
});

test("carteira mantém consulta e histórico em perfil inativo, mas não habilita Pix",()=>{
  assert.match(wallet,/Promise\.all\(\[/);
  assert.match(wallet,/\.eq\("usuario_id",uid\)\.limit\(1\)/);
  assert.match(wallet,/const activeCourier=Boolean\(active\?\.length\)/);
  assert.match(wallet,/saque_habilitado:activeCourier&&ENVIRONMENT==="sandbox"/);
  assert.match(wallet,/\.eq\("ativo",true\)\.limit\(1\)/);
});

test("solicitação residual usa exceção limitada; saque regular mantém bloqueio",()=>{
  assert.match(residual,/requireTerms\(uid,"motoboy","",true\)/);
  assert.match(residual,/amount>0&&amount<SAQUE_MINIMO_CENTAVOS/);
  assert.doesNotMatch(residual,/\/transfers|payouts|POST\/transfers/);
  assert.match(withdraw,/requireTerms\(uid,"motoboy",""\)/);
  assert.match(withdraw,/ENVIRONMENT!=="sandbox"/);
  assert.match(withdraw,/catalogo_asaas_reservar_saque/);
});

const historySql=fs.readFileSync("supabase/pending-migrations/20261009190000_saldo_historico_motoboy_inativo.sql","utf8");

test("saldo liberado e pendencias nao dependem de status ativo do motoboy",()=>{
  assert.match(wallet,/catalogo_asaas_saldo_historico/);
  assert.match(wallet,/catalogo_asaas_pendencias_historicas/);
  assert.match(residual,/catalogo_asaas_saldo_historico/);
  assert.match(historySql,/CREATE OR REPLACE FUNCTION public\.catalogo_asaas_saldo_historico/);
  assert.match(historySql,/CREATE OR REPLACE FUNCTION public\.catalogo_asaas_pendencias_historicas/);
  assert.doesNotMatch(historySql.replace(/^--.*$/gm,""),/catalogo_v2_autorizado|\.ativo\s*=/);
  assert.match(historySql,/r\.status='disponivel'/);
  assert.match(historySql,/r\.status='retido'/);
  assert.match(historySql,/b\.gateway='asaas'/);
  assert.match(historySql,/AND NOT EXISTS\(/);
});

test("somente backend pode consultar creditos historicos por UUID",()=>{
  for(const fnName of ["catalogo_asaas_saldo_historico","catalogo_asaas_pendencias_historicas"]){
    assert.match(historySql,new RegExp("REVOKE ALL ON FUNCTION public\\."+fnName+"\\(uuid\\)"));
    assert.match(historySql,new RegExp("GRANT EXECUTE ON FUNCTION public\\."+fnName+"\\(uuid\\)"));
  }
  assert.match(historySql,/FROM PUBLIC, anon, authenticated/);
  assert.match(historySql,/TO service_role/);
  assert.match(historySql,/SECURITY DEFINER SET search_path=''/);
  assert.doesNotMatch(historySql,/UPDATE public\.|DELETE FROM public\.|POST \/transfers/);
});

test("vinculos mistos de varios comercios nao dependem do primeiro status retornado",()=>{
  assert.match(wallet,/const \[\{data:allowed,error:e\},\{data:active,error:activeError\}\]=await Promise\.all/);
  assert.match(wallet,/if\(e\|\|activeError\)throw new Failure/);
  assert.match(wallet,/if\(!allowed\?\.length\)throw new Failure/);
  assert.match(wallet,/const activeCourier=Boolean\(active\?\.length\)/);
  assert.doesNotMatch(wallet,/allowed\[0\]\.ativo/);
});
