"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const source=fs.readFileSync("supabase/functions/_shared/catalogo-asaas-stepup-documental-ensaio.ts","utf8");
const suite=fs.readFileSync("supabase/functions/tests/catalogo-asaas-stepup-documental-ensaio.test.ts","utf8");
const workflow=fs.readFileSync(".github/workflows/database-tests.yml","utf8");
test("nonce reservado sincronicamente antes de qualquer await do fluxo iniciar",()=>{
 const begin=source.indexOf("async iniciar(intencao:");
 const end=source.indexOf("async confirmar(",begin);
 assert.ok(begin>=0 && end>begin,"missing lifecycle methods");
 const flow=source.slice(begin,end);
 const reserve=flow.indexOf("this.noncesReservados.add(intencao.nonce)");
 const firstAwait=flow.indexOf("await ");
 const guard=flow.indexOf("this.noncesReservados.has(intencao.nonce)");
 assert.ok(reserve>0 && reserve<firstAwait,"nonce reservation after async await");
 assert.ok(guard>0 && guard<reserve,"duplicate detection after nonce reservation");
 assert.match(flow,/this\.provider\.verificarFatorTotpAal1\(/);
 assert.ok(flow.indexOf("this.provider.verificarFatorTotpAal1(")<flow.indexOf("this.provider.criarDesafio("));
 assert.ok(flow.indexOf("this.agora() >= Math.min")<flow.indexOf("this.provider.criarDesafio("));
});
test("concorrencia Auth e TOTP em gates assincronos coberta no Deno CI",()=>{
 for(const fragment of [
  'race: autenticarToken pendente',
  'race: consulta TOTP suspensa',
  'nonce reservado falha fechado',
  'demora no preflight TOTP expira nonce',
  'intencao_ja_vinculada',
  'duplo desafio'
 ]) assert.ok(suite.includes(fragment),"missing race test "+fragment);
 assert.ok(workflow.includes("catalogo-asaas-stepup-documental-ensaio.test.ts"));
 assert.doesNotMatch(workflow,/deno test[^\n]*--allow-net/);
});
test("resultado positivo de mock nunca libera pagamentos",()=>{
 assert.match(source,/HOLD_OBRIGATORIO/);
 for(const flag of ["pagamento_autorizado","liberacao_autorizada","baixa_realizada"])
  assert.match(source,new RegExp(flag+": false"));
});
