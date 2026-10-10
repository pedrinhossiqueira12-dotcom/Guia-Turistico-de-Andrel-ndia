// #42 — 100% offline, sem rede, sem banco externo, sem segredo ou Pix.
import {
  OrquestradorPrechallengeInerte,
  type ContextoPrivadoPrechallengeInerte,
  type LivroPrivadoPrechallengeInerte,
  type RespostaBancoPrechallengeInerte,
} from "../_shared/catalogo-asaas-mfa-orquestrador-prechallenge-inerte.ts";
import type {
  PortaDeAutenticacaoFalsa, SessaoAferidaEmEnsaio,
} from "../_shared/catalogo-asaas-stepup-documental-ensaio.ts";

const NOW=1800000000000;
const CID="11111111-1111-4111-8111-111111111111";
const UID="22222222-2222-4222-8222-222222222222";
const SID="33333333-3333-4333-8333-333333333333";
const FID="44444444-4444-4444-8444-444444444444";
const SEP="55555555-5555-4555-8555-555555555555";
const base:ContextoPrivadoPrechallengeInerte={
 id:CID,userId:UID,sessionId:SID,factorId:FID,
 separationId:SEP,evidenceHash:"a".repeat(64),expiresAt:NOW+120000,
};
const aal1:SessaoAferidaEmEnsaio={
 userId:UID,sessionId:SID,factorId:null,aal:"aal1",
 role:"authenticated",anonymous:false
};
const aal2:SessaoAferidaEmEnsaio={...aal1,aal:"aal2",factorId:FID};
function assert(v:unknown,m:string):asserts v { if(!v)throw new Error(m); }
type Flags={ok:boolean;nonce?:string|null;motivo:string;unsafe?:boolean};
const sql=(v:Flags):RespostaBancoPrechallengeInerte=>({
 ok:v.ok,motivo:v.motivo,nonce:v.nonce??null,
 status_operacional:"HOLD_OBRIGATORIO",
 pagamento_autorizado:v.unsafe??false,
 challenge_go_true_verificado:false,desafio_mfa_da_sessao_comprovado:false,
 liberacao_autorizada:false,baixa_realizada:false,movimenta_dinheiro:false,
});
function hold(v:Record<string,unknown>){
 for(const name of ["desafio_mfa_real_comprovado","pagamento_autorizado",
  "liberacao_autorizada","parecer_financeiro_autorizado","baixa_realizada",
  "movimenta_dinheiro"])assert(v[name]===false,"Financas indevidamente abertas: "+name);
 assert(v.status_operacional==="HOLD_OBRIGATORIO","HOLD retirado");
}
function lab(opts:{
 context?:ContextoPrivadoPrechallengeInerte;
 before?:SessaoAferidaEmEnsaio|null;
 after?:SessaoAferidaEmEnsaio|null;
 factor?:boolean;failAuth?:boolean;
 failSql?:string; sqlUnsafe?:boolean;
 challengeDuplicate?:boolean;
 verifyThrows?:boolean;
 verifyExpire?:()=>void;
}={}){
 let clock=NOW;
 const calls:string[]=[];
 const contexts=new Map([[CID,opts.context??base]]);
 const reserved=new Map<string,string>();
 const challengeMap=new Map<string,{nonce:string;tentativa:string}>();
 const consumed=new Set<string>();
 const gate:LivroPrivadoPrechallengeInerte={
  async reservarInicio(id){
   calls.push("sql-reserve");
   if(opts.failSql==="reserve")throw Error("db fake offline");
   if(!contexts.has(id) || reserved.has(id))
    return sql({ok:false,motivo:"contexto_invalido_ou_repetido"});
   const nonce=crypto.randomUUID();
   reserved.set(id,nonce);
   return sql({ok:true,motivo:"nonce_reservado",nonce,unsafe:opts.sqlUnsafe});
  },
  async lerContexto(id){
   calls.push("sql-context");
   if(opts.failSql==="read_context")throw Error("db fake offline");
   return contexts.get(id)??null;
  },
  async registrarDesafio(nonce,challengeId,tentativa){
   calls.push("sql-register");
   if(opts.failSql==="register")throw Error("db fake offline");
   if(![...reserved.values()].includes(nonce) ||
      [...challengeMap.values()].some(v=>v.nonce===nonce) ||
      challengeMap.has(challengeId) || opts.challengeDuplicate)
    return sql({ok:false,motivo:"challenge_duplicado"});
   challengeMap.set(challengeId,{nonce,tentativa});
   return sql({ok:true,motivo:"challenge_registrado",nonce,unsafe:opts.sqlUnsafe});
  },
  async lerTentativa(tentativa){
   calls.push("sql-attempt");
   if(opts.failSql==="read_attempt")throw Error("db fake offline");
   for(const [challengeId,v] of challengeMap){
    if(v.tentativa!==tentativa)continue;
    const id=[...reserved].find(([,n])=>n===v.nonce)?.[0];
    if(!id)return null;
    const context=contexts.get(id);
    if(!context)return null;
    return {nonce:v.nonce,tentativa,challengeId,contexto:{...context}};
   }
   return null;
  },
  async consumirDesafio(nonce,challengeId,tentativa){
   calls.push("sql-consume");
   if(opts.failSql==="consume")throw Error("db fake offline");
   const r=challengeMap.get(challengeId);
   if(!r || r.nonce!==nonce || r.tentativa!==tentativa || consumed.has(challengeId))
    return sql({ok:false,motivo:"tentativa_ja_consumida"});
   consumed.add(challengeId);
   return sql({ok:true,motivo:"tentativa_documental_consumida",nonce,
    unsafe:opts.sqlUnsafe});
  },
 };
 const auth:PortaDeAutenticacaoFalsa={
  async autenticarToken(token,phase){
   calls.push("auth-"+(phase??""));
   if(opts.failAuth)throw Error("auth fake offline");
   if(token==="before")return opts.before===undefined?aal1:opts.before;
   if(token==="after")return opts.after===undefined?aal2:opts.after;
   return null;
  },
  async verificarFatorTotpAal1(v){
   calls.push("auth-factor");
   return opts.factor!==false && v.userId===UID && v.sessionId===SID && v.factorId===FID;
  },
  async criarDesafio(){
   calls.push("auth-challenge");
   return {id:crypto.randomUUID()};
  },
  async verificarDesafio(v){
   calls.push("auth-verify");
   opts.verifyExpire?.();
   if(opts.verifyThrows || v.otp!=="123456")throw Error("OTP invalido");
   return {accessToken:"after"};
  },
 };
 function ctor(){
  return new OrquestradorPrechallengeInerte(gate,auth,()=>clock,"isolated-ci");
 }
 return {ctor,calls,gate,contexts,reserved,challengeMap,consumed,advance:(ms:number)=>clock+=ms};
}

Deno.test("duas instancias usam nonce do banco, guardam desafio e nunca repassam ID Auth",async()=>{
 const l=lab();
 const one=l.ctor(),two=l.ctor();
 const initial=await one.iniciar(CID,"before");
 assert(initial.ok && typeof initial.tentativa==="string","nao iniciou tentativa");
 assert(!("nonce" in initial)&&!("challengeId" in initial),"nonce/challenge vazou ao cliente");
 hold(initial);
 assert(l.calls.indexOf("sql-reserve")<l.calls.indexOf("auth-inicio"),"Auth antes da reserva SQL");
 assert(l.calls.indexOf("sql-register")>l.calls.indexOf("auth-challenge"),"registrou challenge antes do Auth");
 const dupe=await two.iniciar(CID,"before");
 assert(!dupe.ok&&dupe.motivo==="reserva_sql_recusada_ou_sem_hold","nonce duplicou");
 assert(l.calls.filter(c=>c==="auth-challenge").length===1,"segundo Auth foi acionado");
 hold(dupe);
 const result=await two.confirmar(initial.tentativa,"before","123456");
 assert(result.ok,"segunda instancia nao recuperou tentativa do SQL");
 assert(result.motivo==="protocolo_auth_conferido_sem_prova_financeira","resultado financeiro nao inerte");
 hold(result);
 assert(l.calls.indexOf("sql-consume")<l.calls.indexOf("auth-verify"),"OTP foi enviado ANTES do consumo SQL");
 assert(l.calls.filter(c=>c==="auth-apos_verificacao").length===1,"JWT depois do MFA nao validado");
 const replay=await one.confirmar(initial.tentativa,"before","123456");
 assert(!replay.ok&&replay.motivo==="consumo_sql_recusado_ou_sem_hold",
  "replay foi aceito por outra instancia");
 assert(l.calls.filter(c=>c==="auth-verify").length===1,
  "OTP chegou ao GoTrue pela segunda vez");
 hold(replay);
});

Deno.test("identidade, sessao, AAL1, propriedade de fator e token sao exigidos",async()=>{
 for(const mismatch of [
  {...aal1,userId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},
  {...aal1,sessionId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"},
  {...aal1,role:"anon" as SessaoAferidaEmEnsaio["role"]},
  {...aal1,anonymous:true},{...aal2},
 ]) {
  const l=lab({before:mismatch}); const v=await l.ctor().iniciar(CID,"before");
  assert(!v.ok&&v.motivo==="sessao_aal1_divergente","auth spoofing accepted");
  assert(!l.calls.includes("auth-challenge"),"issued challenge for invalid session");
  hold(v);
 }
 const l=lab({factor:false});const v=await l.ctor().iniciar(CID,"before");
 assert(!v.ok&&v.motivo==="fator_totp_privado_invalido","wrong factor used");
 assert(!l.calls.includes("auth-challenge"),"created challenge without factor ownership");
 const m=lab();const denied=await m.ctor().iniciar(CID,"foreign-bearer");
 assert(!denied.ok,"foreign bearer accepted");
 const retry=await m.ctor().iniciar(CID,"before");
 assert(!retry.ok,"reservation replay after unauthorized bearer not denied");
 hold(retry);
});

Deno.test("confirmacao rejeita fator AAL2 ou sessao adulterada mesmo depois de OTP correto",async()=>{
 for(const bad of [
  {...aal2,sessionId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},
  {...aal2,factorId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"},
  {...aal1},null,
 ]) {
  const l=lab({after:bad});
  const opened=await l.ctor().iniciar(CID,"before");
  assert(opened.ok && opened.tentativa,"begin failed in fake lab");
  const result=await l.ctor().confirmar(opened.tentativa,"before","123456");
  assert(!result.ok&&result.motivo==="aal2_nao_prova_mesma_sessao_fator",
   "bad post-OTP claims accepted");
  hold(result);
 }
});

Deno.test("falhas de SQL, resposta que libera dinheiro e Auth indisponivel falham fechado",async()=>{
 for(const id of ["reserve","read_context","register","read_attempt","consume"]) {
  const l=lab({failSql:id});const opened=await l.ctor().iniciar(CID,"before");
  if(id==="reserve"||id==="read_context"||id==="register"){
   assert(!opened.ok,"SQL "+id+" fail open");hold(opened);
  }else{
   assert(opened.ok&&opened.tentativa,"setup before "+id+" failed");
   const v=await l.ctor().confirmar(opened.tentativa,"before","123456");
   assert(!v.ok,"SQL "+id+" fail open in verify");hold(v);
   assert(!l.calls.includes("auth-verify"),"OTP exposed after SQL failure");
  }
 }
 const unsafe=lab({sqlUnsafe:true});const failed=await unsafe.ctor().iniciar(CID,"before");
 assert(!failed.ok&&!unsafe.calls.includes("auth-inicio"),"SQL released payment before Auth");
 hold(failed);
 const challenge=lab({challengeDuplicate:true});
 const failedChallenge=await challenge.ctor().iniciar(CID,"before");
 assert(!failedChallenge.ok&&failedChallenge.motivo==="registro_challenge_sql_recusado",
 "duplicate challenge accepted");hold(failedChallenge);
 const authFailure=lab({failAuth:true});
 const f=await authFailure.ctor().iniciar(CID,"before");
 assert(!f.ok&&!authFailure.calls.includes("auth-challenge"),"auth failure minted challenge");
 hold(f);
});

Deno.test("timeout antes e depois de challenge e OTP incorreto nao abre fundos",async()=>{
 const before=lab({context:{...base,expiresAt:NOW-1}});
 const stale=await before.ctor().iniciar(CID,"before");
 assert(!stale.ok&&!before.calls.includes("auth-challenge"),"expired context opened");
 const l=lab({verifyThrows:true});
 const opened=await l.ctor().iniciar(CID,"before");
 assert(opened.ok&&opened.tentativa,"begin fail");
 const wrong=await l.ctor().confirmar(opened.tentativa,"before","12a456");
 assert(!wrong.ok&&wrong.motivo==="formato_otp_invalido"
  && !l.calls.includes("sql-consume"),"bad otp format reached ledger");
 const falseOtp=await l.ctor().confirmar(opened.tentativa,"before","123456");
 assert(!falseOtp.ok&&falseOtp.motivo==="auth_verify_indisponivel_ou_recusado",
 "GoTrue failure accepted");hold(falseOtp);
 const replay=await l.ctor().confirmar(opened.tentativa,"before","123456");
 assert(!replay.ok&&l.calls.filter(x=>x==="auth-verify").length===1,
  "failed OTP was replayable without new context");
 const expired=lab();const p=await expired.ctor().iniciar(CID,"before");
 assert(p.ok&&p.tentativa,"expired setup failed");
 expired.advance(121000);
 const v=await expired.ctor().confirmar(p.tentativa,"before","123456");
 assert(!v.ok&&!expired.calls.includes("auth-verify"),"expired OTP reached GoTrue");
 hold(v);
});

Deno.test("intencao nao aceita nonce, challenge ou JWT alegado pelo cliente",async()=>{
 const l=lab();
 for(const input of ["not_uuid","","...","aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]){
  const v=await l.ctor().iniciar(input,"before");
  assert(!v.ok,"forged context accepted");hold(v);
 }
 assert(l.calls.length===0,"invalid client context touched backend");
});
