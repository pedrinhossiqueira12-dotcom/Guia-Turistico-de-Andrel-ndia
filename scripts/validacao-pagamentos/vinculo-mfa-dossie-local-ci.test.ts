// #42 - 100% offline. E apenas comparacao do vinculo local de GoTrue e
// versao documental. Nao ha emissao, GET externo, RPC ou Pix.
import {VinculoMfaDossieLocalCI} from "./vinculo-mfa-dossie-local-ci.ts";
const D="10000000-1000-4000-8000-000000000001";
const E="20000000-2000-4000-8000-000000000002";
const U="30000000-3000-4000-8000-000000000003";
const A="40000000-4000-4000-8000-000000000004";
const B="50000000-5000-4000-8000-000000000005";
const SA="60000000-6000-4000-8000-000000000006";
const SB="70000000-7000-4000-8000-000000000007";
const FA="80000000-8000-4000-8000-000000000008";
const FB="90000000-9000-4000-8000-000000000009";
const C1="a0000000-a000-4000-8000-000000000010";
const C2="b0000000-b000-4000-8000-000000000011";
const F="a".repeat(64), H="b".repeat(64);
const snap={decisaoId:D,separacaoId:E,fingerprint:F,dossieHash:H,
 beneficiarioId:U,autoresEvidencia:[] as string[]};
const version={decisaoId:D,separacaoId:E,fingerprint:F,dossieHash:H};
const cred=(revisorId:string,sessaoId:string,fatorId:string)=>({
 ...version,revisorId,sessaoId,fatorId
});
const proof=(r:ReturnType<typeof cred>,challengeId:string)=>({
 ...r,challengeId,aal:"aal2",
 usuarioAuthId:r.revisorId,sessaoAuthId:r.sessaoId,
 factorAuthId:r.fatorId,autenticacaoLocalGoTrueConfirmada:true,
});
function ok(v:unknown,message:string):asserts v{if(!v)throw Error(message);}
function hold(v:Record<string,unknown>){
 for(const key of ["credenciamento_formal_comprovado","dois_revisores_reais_autorizados",
  "aprovacao_financeira","pagamento_autorizado","liberacao_autorizada",
  "baixa_realizada","movimenta_dinheiro","pode_enviar_pix"])
  ok(v[key]===false,"indicador aberto: "+key);
 ok(v.status_operacional==="HOLD_OBRIGATORIO","perdeu HOLD");
 ok(Object.isFrozen(v),"retorno do laboratorio mutavel");
}
function start(time={value:1800000000000},opts= snap){
 const x=new VinculoMfaDossieLocalCI(opts,()=>time.value,"ci-local-descartavel");
 return {x,time};
}
function begin(x:VinculoMfaDossieLocalCI,r:ReturnType<typeof cred>,challenge:string){
 const prep=x.preparar(r);hold(prep);
 ok(prep.ok&&typeof prep.nonce==="string","reserva do desafio local");
 const bind=x.vincularChallenge(prep.nonce,challenge);hold(bind);
 ok(bind.ok,"vinculo do challenge local");
 return prep.nonce;
}
Deno.test("duas identidades associadas a uma UNICA versao documental, jamais pagamentos",()=>{
 const {x}=start();
 const a=cred(A,SA,FA),b=cred(B,SB,FB);
 const na=begin(x,a,C1),nb=begin(x,b,C2);
 const va=x.registrarResultado(na,proof(a,C1)),vb=x.registrarResultado(nb,proof(b,C2));
 hold(va);hold(vb);ok(va.ok&&vb.ok,"ambas as observacoes locais foram associadas");
 const diag=x.diagnosticar(version);hold(diag);
 ok(diag.revisores_distintos_vinculados_na_versao===2
  &&diag.duas_observacoes_locais_vinculadas===true,"duas revisoes independentes");
 const stale=x.diagnosticar({...version,fingerprint:"c".repeat(64)});
 hold(stale);ok(stale.revisores_distintos_vinculados_na_versao===0
  &&stale.duas_observacoes_locais_vinculadas===false,"versao alterada foi aceita");
 const replay=x.registrarResultado(na,proof(a,C1));
 hold(replay);ok(!replay.ok&&replay.motivo==="tentativa_inexistente_ou_replay","replay");
});
Deno.test("troca de fator, sessao, revisor, challenge ou dossie consome a tentativa",()=>{
 const patches=[
  {revisorId:B,usuarioAuthId:B},{sessaoAuthId:SB},
  {factorAuthId:FB},{challengeId:C2},{dossieHash:"c".repeat(64)},
  {fingerprint:"d".repeat(64)},{separacaoId:U},{aal:"aal1"},
  {autenticacaoLocalGoTrueConfirmada:false}
 ];
 for(const patch of patches){
  const {x}=start();const a=cred(A,SA,FA);const nonce=begin(x,a,C1);
  const result=x.registrarResultado(nonce,{...proof(a,C1),...patch});
  hold(result);ok(!result.ok,JSON.stringify(patch)+" nao foi rejeitado");
  const second=x.registrarResultado(nonce,proof(a,C1));
  hold(second);ok(!second.ok,"tentativa com erro reutilizada");
  const diag=x.diagnosticar(version);hold(diag);
  ok(diag.revisores_distintos_vinculados_na_versao===0,"erro contou revisor");
 }
});
Deno.test("titular, autor de evidencias e mesmo revisor nao contam",()=>{
 const {x}=start(undefined,{...snap,autoresEvidencia:[B]});
 for(const c of [cred(U,SA,FA),cred(B,SB,FB)]){
  const p=x.preparar(c);hold(p);ok(!p.ok,"conflito de interesse aceito");
 }
 const a=cred(A,SA,FA);
 const prep=x.preparar(a);hold(prep);ok(prep.ok,"primeiro revisor recusado");
 for(const conflict of [a,{...a,sessaoId:SB}]){
  const other=x.preparar(conflict);hold(other);ok(!other.ok,"revisor duplicado");
 }
});
Deno.test("nonce, challenge duplicado, OTP anterior a challenge e prazo vencido",()=>{
 const {x,time}=start();
 const a=cred(A,SA,FA),b=cred(B,SB,FB);
 const p=x.preparar(a);hold(p);ok(p.ok&&typeof p.nonce==="string","nonce");
 const early=x.registrarResultado(p.nonce,proof(a,C1));
 hold(early);ok(!early.ok,"aceitou MFA antes de challenge");
 const bind=x.vincularChallenge(p.nonce,C1);
 hold(bind);ok(bind.ok,"nao ligou challenge");
 const repeated=x.vincularChallenge(p.nonce,C1);
 hold(repeated);ok(!repeated.ok,"challenge reutilizado");
 const p2=x.preparar(b);hold(p2);ok(p2.ok&&typeof p2.nonce==="string","nonce B");
 const duplicate=x.vincularChallenge(p2.nonce,C1);
 hold(duplicate);ok(!duplicate.ok,"challenge do revisor A associado ao B");
 time.value+=120001;
 const exp=x.registrarResultado(p.nonce,proof(a,C1));
 hold(exp);ok(!exp.ok,"challenge expirado foi aceito");
});
Deno.test("o snapshot e imutavel apos criacao e o browser nao concede MFA",()=>{
 const dynamic={...snap,autoresEvidencia:[] as string[]};
 const {x}=start(undefined,dynamic);
 dynamic.fingerprint="c".repeat(64);
 dynamic.autoresEvidencia.push(A);
 const a=cred(A,SA,FA);
 const nonce=begin(x,a,C1);
 const browserForged={...proof(a,C1),
  autenticacaoLocalGoTrueConfirmada:false,
  pode_enviar_pix:true,aprovacao_financeira:true};
 const unauth=x.registrarResultado(nonce,browserForged);
 hold(unauth);ok(!unauth.ok,"flag forjada habilitou comprovacao local");
 const diagnostic=x.diagnosticar(version);
 hold(diagnostic);ok(!diagnostic.duas_observacoes_locais_vinculadas,"tentativa falsa contou");
});
