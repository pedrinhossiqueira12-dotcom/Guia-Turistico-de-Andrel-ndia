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
 const snapshot=flow.indexOf("const snapshot = Object.freeze({ ...intencao })");
 const reserve=flow.indexOf("this.noncesReservados.add(snapshot.nonce)");
 const firstAwait=flow.indexOf("await ");
 const guard=flow.indexOf("this.noncesReservados.has(snapshot.nonce)");
 assert.ok(snapshot>0 && snapshot<guard,"operation must be frozen before nonce check");
 assert.ok(reserve>0 && reserve<firstAwait,"nonce reservation after async await");
 assert.ok(guard>0 && guard<reserve,"duplicate detection after nonce reservation");
 assert.match(flow,/reservaCompartilhada\.reservarInicio\(/);
 assert.ok(flow.indexOf("reservaCompartilhada.reservarInicio(")<flow.indexOf("this.provider.autenticarToken("),
   "shared gate must run before external Auth");
 assert.match(suite,/snapshot imutavel impede trocar operacao/);
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


test("challenge_id do Auth deve ser associado ao nonce no gate antes de disponibilizar tentativa",()=>{
 const begin=source.indexOf("async iniciar(intencao:");
 const end=source.indexOf("async confirmar(",begin);
 const flow=source.slice(begin,end);
 const indexChallenge=flow.indexOf("this.provider.criarDesafio(");
 const indexRegister=flow.indexOf("this.reservaCompartilhada.registrarDesafio(");
 const indexAvailable=flow.indexOf('registro.estado = "pendente"');
 assert.ok(indexChallenge>=0 && indexRegister>indexChallenge && indexAvailable>indexRegister,
   "challenge must be bound to immutable snapshot before returning a usable attempt");
 for(const field of ["nonce: snapshot.nonce","challengeId: challenge.id",
    "userId: sessao.userId","sessionId: sessao.sessionId",
    "factorId: snapshot.factorId","separationId: snapshot.separationId",
    "evidenceHash: snapshot.evidenceHash"])
  assert.ok(flow.slice(indexRegister,indexAvailable).includes(field),
    "shared challenge binding missing "+field);
 for(const msg of ["desafio_ja_vinculado_ou_invalido",
     "registro_compartilhado_desafio_indisponivel","desafio_ou_intencao_expirada"])
  assert.ok(flow.slice(indexRegister,indexAvailable).includes(msg),
    "missing fail-closed result "+msg);
 assert.match(suite,/desafio emitido sem persistencia compartilhada/);
 assert.match(suite,/desafio retornado pelo Auth foi vinculado a dois nonces/);
});
