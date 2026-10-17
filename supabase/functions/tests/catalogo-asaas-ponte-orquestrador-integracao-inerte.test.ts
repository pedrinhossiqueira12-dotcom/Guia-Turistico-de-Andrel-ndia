/**
 * #42 — Ensaio de integração entre a ponte SQL NOLOGIN e o orquestrador MFA.
 *
 * DB, GoTrue e tokens COMPLETAMENTE FICTÍCIOS (não são JWTs reais);
 * sem driver, rede, credenciais, Edge, segredo, Pix ou saque.
 * Testes reais de PostgreSQL e GoTrue local seguem em suites separadas.
 */
import {
  LivroSqlPonteNoLoginInerte,
  type ExecutorPonteMfaNoLoginSomenteCi,
} from "../_shared/catalogo-asaas-livro-ponte-nologin-inerte.ts";
import {
  OrquestradorPrechallengeInerte,
  type ResultadoOrquestradorInerte,
} from "../_shared/catalogo-asaas-mfa-orquestrador-prechallenge-inerte.ts";
import type {
  PortaDeAutenticacaoFalsa, SessaoAferidaEmEnsaio,
} from "../_shared/catalogo-asaas-stepup-documental-ensaio.ts";

const NOW=1_800_000_000_000;
const CTX="11111111-1111-4111-8111-111111111111";
const UID="22222222-2222-4222-8222-222222222222";
const SID="33333333-3333-4333-8333-333333333333";
const FACTOR="44444444-4444-4444-8444-444444444444";
const SEPARATION="55555555-5555-4555-8555-555555555555";
const NONCE="66666666-6666-4666-8666-666666666666";
const CHALLENGE="77777777-7777-4777-8777-777777777777";
const context={
  id:CTX,userId:UID,sessionId:SID,factorId:FACTOR,
  separationId:SEPARATION,evidenceHash:"a".repeat(64),expiresAt:NOW+120_000,
};
const aal1:SessaoAferidaEmEnsaio={
  userId:UID,sessionId:SID,factorId:null,aal:"aal1",
  role:"authenticated",anonymous:false,
};
const aal2:SessaoAferidaEmEnsaio={...aal1,aal:"aal2",factorId:FACTOR};
function assert(v:unknown,m:string):asserts v{if(!v)throw Error(m);}
function sqlHold(ok:boolean,motivo:string,nonce:string|null=null){
  return {
    ok,motivo,nonce,status_operacional:"HOLD_OBRIGATORIO",
    pagamento_autorizado:false,challenge_go_true_verificado:false,
    desafio_mfa_da_sessao_comprovado:false,pode_registrar_parecer:false,
    dupla_aprovacao_financeira:false,liberacao_autorizada:false,
    baixa_realizada:false,movimenta_dinheiro:false,
  };
}
function assertHold(r:ResultadoOrquestradorInerte){
  assert(r.status_operacional==="HOLD_OBRIGATORIO","operational hold removed");
  for(const k of [
    "pagamento_autorizado","movimenta_dinheiro","liberacao_autorizada",
    "parecer_financeiro_autorizado","baixa_realizada","desafio_mfa_real_comprovado",
  ] as const)assert(r[k]===false,"financial flag raised: "+k);
  assert(!("nonce" in r)&&!("challengeId" in r),"private nonce/challenge leaked");
}
function lab(options:{
  membershipLeak?:boolean;
  corruptReserve?:boolean;
  badContext?:boolean;
  sessionAfter?:SessaoAferidaEmEnsaio|null;
  invalidFactor?:boolean;
  throwSqlAt?:number;
}={}){
  let clock=NOW;
  let reserved=false;
  let savedAttempt:string|null=null;
  let recorded=false;
  let consumed=false;
  let authVerifyCount=0;
  let challengeCount=0;
  let sqlCount=0;
  const events:string[]=[];
  const driver:ExecutorPonteMfaNoLoginSomenteCi={
    databaseName:"catalogo_asaas_guards_ci",
    currentRole:"catalogo_mfa_ponte_ci_inerte",
    async queryObject(statement,params){
      events.push("sql");
      sqlCount++;
      assert(statement.startsWith("SELECT CASE WHEN current_database() = 'catalogo_asaas_guards_ci'"),
        "bridge SQL missing database proof");
      assert(statement.includes("current_user = 'catalogo_mfa_ponte_ci_inerte'"),
        "bridge SQL missing real PG role proof");
      assert(statement.includes("session_user = 'postgres'"),
        "bridge SQL missing disposable admin session proof");
      assert(!statement.includes("catalogo_private.")&&!statement.includes("service_role"),
        "bridge bypassed private function/used service role");
      assert((statement.match(/::uuid/g)||[]).length===params.length,
        "bridge failed positional binds");
      if(options.throwSqlAt===sqlCount)throw Error("CI fake database unavailable");
      // Modela SQL WHERE NOT EXISTS que nega qualquer GRANT na role da ponte.
      if(options.membershipLeak)return [{result:null}];
      let value:unknown;
      if(statement.includes("catalogo_asaas_ponte_reservar_principal_inerte(")){
        assert(params.length===3,"missing verified principal binds");
        if(params[0]!==CTX||params[1]!==UID||params[2]!==SID||reserved){
          value=sqlHold(false,"principal_ou_contexto_divergente");
        }else{
          reserved=true;
          value=options.corruptReserve
            ?{...sqlHold(true,"nonce_reservado",NONCE),pagamento_autorizado:true}
            :sqlHold(true,"nonce_reservado",NONCE);
        }
      }else if(statement.includes("catalogo_asaas_ponte_ler_contexto_inerte(")){
        value=reserved&&params[0]===CTX
          ?(options.badContext?{...context,sessionId:"not-a-uuid"}:{...context})
          :null;
      }else if(statement.includes("catalogo_asaas_ponte_registrar_desafio_inerte(")){
        if(reserved&&!recorded&&params[0]===NONCE&&params[1]===CHALLENGE){
          recorded=true;
          savedAttempt=params[2];
          value=sqlHold(true,"challenge_registrado",NONCE);
        }else value=sqlHold(false,"challenge_ou_nonce_divergente");
      }else if(statement.includes("catalogo_asaas_ponte_ler_tentativa_inerte(")){
        value=recorded&&!consumed&&savedAttempt===params[0]
          ?{nonce:NONCE,tentativa:savedAttempt,challengeId:CHALLENGE,contexto:{...context}}
          :null;
      }else if(statement.includes("catalogo_asaas_ponte_consumir_desafio_inerte(")){
        if(!consumed&&recorded&&params[0]===NONCE&&
          params[1]===CHALLENGE&&params[2]===savedAttempt){
          consumed=true;
          value=sqlHold(true,"tentativa_documental_consumida",NONCE);
        }else value=sqlHold(false,"tentativa_ja_consumida");
      }else throw Error("Unexpected query in bridge adapter");
      return [{result:value}];
    },
  };
  const auth:PortaDeAutenticacaoFalsa={
    async autenticarToken(token,fase){
      events.push("auth-"+fase);
      if(token==="aal1-valid"&&fase==="inicio")return {...aal1};
      if(token==="aal2-after-verify"&&fase==="apos_verificacao"){
        return options.sessionAfter===undefined?{...aal2}:options.sessionAfter;
      }
      return null;
    },
    async verificarFatorTotpAal1({userId,sessionId,factorId}){
      events.push("auth-factor");
      return !options.invalidFactor&&userId===UID&&sessionId===SID&&factorId===FACTOR;
    },
    async criarDesafio({bearerToken,factorId}){
      events.push("auth-challenge");
      challengeCount++;
      assert(bearerToken==="aal1-valid"&&factorId===FACTOR,"Auth challenge spoofed");
      return {id:CHALLENGE};
    },
    async verificarDesafio({bearerToken,factorId,challengeId,otp}){
      events.push("auth-verify");
      authVerifyCount++;
      assert(bearerToken==="aal1-valid"&&factorId===FACTOR
        &&challengeId===CHALLENGE&&otp==="123456","OTP not bound to challenge");
      return {accessToken:"aal2-after-verify"};
    },
  };
  function orchestrator(){
    // Two independent adapters share DB state, like separate worker processes.
    const book=new LivroSqlPonteNoLoginInerte(driver,"isolated-ci");
    return new OrquestradorPrechallengeInerte(book,auth,()=>clock,"isolated-ci");
  }
  return {
    orchestrator,events,sessionChange:(ms:number)=>clock+=ms,
    setMembershipLeak:(value:boolean)=>{options.membershipLeak=value;},
    state:()=>({reserved,recorded,consumed,authVerifyCount,challengeCount,sqlCount}),
  };
}
Deno.test("ponte + orquestrador: duas instancias compartilham nonce/attempt; replay e dinheiro negados",async()=>{
  const x=lab();
  const first=x.orchestrator(),second=x.orchestrator();
  const start=await first.iniciar(CTX,"aal1-valid");
  assert(start.ok&&typeof start.tentativa==="string","valid AAL1 did not reserve");
  assertHold(start);
  assert(x.events.indexOf("auth-inicio")<x.events.indexOf("sql"),
    "database touched before Auth preverification");
  const duplicate=await second.iniciar(CTX,"aal1-valid");
  assert(!duplicate.ok&&duplicate.motivo==="reserva_sql_recusada_ou_sem_hold",
    "two instances reserved same context");
  assertHold(duplicate);
  assert(x.state().challengeCount===1,"challenge created for duplicate nonce");
  const verified=await second.confirmar(start.tentativa,"aal1-valid","123456");
  assert(verified.ok&&verified.motivo==="protocolo_auth_conferido_sem_prova_financeira",
    "MFA offline proof did not stay documentary");
  assertHold(verified);
  assert(x.state().consumed&&x.state().authVerifyCount===1,"missing single consume");
  const replay=await first.confirmar(start.tentativa,"aal1-valid","123456");
  assert(!replay.ok,"replayed consumed attempt");
  assertHold(replay);
  assert(x.state().authVerifyCount===1,"OTP replay went to GoTrue");
});
Deno.test("bearer falso e sessao alheia nao queimam nonce no PostgreSQL fake",async()=>{
  const x=lab();
  for(const invalid of ["spoofed","", "aal2-after-verify"]){
    const result=await x.orchestrator().iniciar(CTX,invalid);
    assert(!result.ok,"invalid bearer accepted");
    assertHold(result);
  }
  assert(x.state().sqlCount===0&&!x.state().reserved,"invalid auth touched SQL");
  const legitimate=await x.orchestrator().iniciar(CTX,"aal1-valid");
  assert(legitimate.ok,"real simulated principal was denied after forged bearer");
  assertHold(legitimate);
});
Deno.test("GRANT acidental inibe a ponte ANTES do challenge ou consumo",async()=>{
  const before=lab({membershipLeak:true});
  const denied=await before.orchestrator().iniciar(CTX,"aal1-valid");
  // O adaptador rejeita SQL NULL por EXCEPTION antes que o
  // orquestrador examine flags de HOLD; motivo correto: SQL indisponivel.
  assert(!denied.ok&&denied.motivo==="reserva_sql_indisponivel",
    "NULL bridge response did not fail closed");
  assertHold(denied);
  assert(!before.state().reserved&&before.state().challengeCount===0,
    "privilege leak reached reserve/challenge");
  const after=lab();
  const start=await after.orchestrator().iniciar(CTX,"aal1-valid");
  assert(start.ok&&start.tentativa,"setup failed");
  after.setMembershipLeak(true);
  const consume=await after.orchestrator().confirmar(start.tentativa,"aal1-valid","123456");
  assert(!consume.ok,"privilege leak allowed consumption");
  assertHold(consume);
  assert(!after.state().consumed&&after.state().authVerifyCount===0,
    "privilege leak verified OTP or consumed nonce");
});
Deno.test("snapshot adulterado, flags permissivas e erro SQL falham fechado",async()=>{
  for(const opts of [
    {badContext:true},{corruptReserve:true},{throwSqlAt:1},{throwSqlAt:2},
    {invalidFactor:true},
  ]){
    const x=lab(opts);
    const res=await x.orchestrator().iniciar(CTX,"aal1-valid");
    assert(!res.ok,"unsafe SQL response accepted "+JSON.stringify(opts));
    assertHold(res);
    assert(x.state().challengeCount===0,"challenge created after bad SQL/factor");
  }
});
Deno.test("apos challenge, nao aceita AAL2 de outra sessao ou fator",async()=>{
  for(const principal of [
    {...aal2,sessionId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},
    {...aal2,userId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"},
    {...aal2,factorId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"},
    null,
  ]){
    const x=lab({sessionAfter:principal});
    const start=await x.orchestrator().iniciar(CTX,"aal1-valid");
    assert(start.ok&&start.tentativa,"could not create challenge");
    const confirmed=await x.orchestrator().confirmar(start.tentativa,"aal1-valid","123456");
    assert(!confirmed.ok&&confirmed.motivo==="aal2_nao_prova_mesma_sessao_fator",
      "foreign session accepted as valid AAL2");
    assertHold(confirmed);
  }
});
Deno.test("desafio expirado e OTP invalido nao acionam operacoes financeiras",async()=>{
  const x=lab();
  const start=await x.orchestrator().iniciar(CTX,"aal1-valid");
  assert(start.ok&&start.tentativa,"setup failed");
  const wrong=await x.orchestrator().confirmar(start.tentativa,"aal1-valid","12345");
  assert(!wrong.ok&&wrong.motivo==="formato_otp_invalido","bad OTP format accepted");
  assert(x.state().authVerifyCount===0&&!x.state().consumed,"bad OTP consumed challenge");
  x.sessionChange(121_000);
  const stale=await x.orchestrator().confirmar(start.tentativa,"aal1-valid","123456");
  assert(!stale.ok&&x.state().authVerifyCount===0,"expired OTP verified");
  assertHold(stale);
});
