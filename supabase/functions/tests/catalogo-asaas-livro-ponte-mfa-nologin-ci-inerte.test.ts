// #42 | Cinco wrappers MFA NOLOGIN: contrato Deno inteiramente OFFLINE.
import {
 LivroSqlPonteMfaCiInerte,
 type ExecutorPonteMfaSomenteCi,
} from "../_shared/catalogo-asaas-livro-ponte-mfa-nologin-ci-inerte.ts";
function assert(v:unknown,m:string):asserts v{if(!v)throw Error(m);}
const C="11111111-1111-4111-8111-111111111111";
const U="22222222-2222-4222-8222-222222222222";
const S="33333333-3333-4333-8333-333333333333";
const F="44444444-4444-4444-8444-444444444444";
const E="55555555-5555-4555-8555-555555555555";
const N="66666666-6666-4666-8666-666666666666";
const H="77777777-7777-4777-8777-777777777777";
const T="88888888-8888-4888-8888-888888888888";
const ctx={id:C,userId:U,sessionId:S,factorId:F,
 separationId:E,evidenceHash:"d".repeat(64),expiresAt:1830000000000};
const status=(ok=true)=>({
 ok,motivo:ok?"documental_registrado":"principal_ou_contexto_divergente",
 nonce:ok?N:null,status_operacional:"HOLD_OBRIGATORIO",
 pagamento_autorizado:false,challenge_go_true_verificado:false,
 desafio_mfa_da_sessao_comprovado:false,pode_registrar_parecer:false,
 dupla_aprovacao_financeira:false,liberacao_autorizada:false,
 baixa_realizada:false,movimenta_dinheiro:false,
});
const dict=[
 "catalogo_asaas_ponte_reservar_principal_inerte",
 "catalogo_asaas_ponte_ler_contexto_inerte",
 "catalogo_asaas_ponte_registrar_desafio_inerte",
 "catalogo_asaas_ponte_ler_tentativa_inerte",
 "catalogo_asaas_ponte_consumir_desafio_inerte",
];
async function rejects(fn:()=>Promise<unknown>,label:string){
 let denied=false;
 try{await fn();}catch{denied=true;}
 assert(denied,"Fail-open: "+label);
}
function make(respond:(index:number,params:readonly string[])=>unknown){
 const calls:Array<{sql:string,params:readonly string[]}>=[];
 const db:ExecutorPonteMfaSomenteCi={
  databaseName:"catalogo_asaas_guards_ci",
  roleName:"catalogo_mfa_ponte_ci_inerte",
  async queryObject(sql,params){
   calls.push({sql,params:[...params]});
   assert(sql.startsWith("SELECT catalogo_mfa_ponte_ci_inerte."),
     "Raw owner or non-bridge SQL invoked");
   assert(!sql.includes("catalogo_private")&&!sql.includes("'"+C+"'"),
     "Raw private schema or concatenated SQL id");
   assert(sql.endsWith(" AS result"),"SQL alias missing");
   assert((sql.match(/::uuid/g)||[]).length===params.length,
     "SQL placeholder count does not match IDs");
   assert(params.every(v=>/^[0-9a-f-]{36}$/i.test(v)),"Unvalidated identifier");
   const i=dict.findIndex(n=>sql.includes(n+"("));
   assert(i>=0,"Unexpected SQL function");
   return [{result:respond(i,params)}];
  }
 };
 return {adapter:new LivroSqlPonteMfaCiInerte(db,"isolated-ci"),calls};
}
Deno.test("cinco wrappers usam apenas SQL preparado, nunca owner direto ou Data API",async()=>{
 const {adapter,calls}=make((i,args)=>{
  if(i===0){assert(args.join(",")===[C,U,S].join(","),"Principal binding");return status();}
  if(i===1){assert(args[0]===C,"Contexto binding");return ctx;}
  if(i===2){assert(args.join(",")===[N,H,T].join(","),"Registrar binding");return status();}
  if(i===3){assert(args[0]===T,"Tentativa binding");return {nonce:N,challengeId:H,tentativa:T,contexto:ctx};}
  if(i===4){assert(args.join(",")===[N,H,T].join(","),"Consumir binding");return status();}
  throw Error("Unknown wrapper");
 });
 assert((await adapter.reservarInicioVinculado(C,U,S)).nonce===N,"Nonce owner not returned");
 assert((await adapter.lerContexto(C))?.evidenceHash==="d".repeat(64),"Contexto missing");
 assert((await adapter.registrarDesafio(N,H,T)).status_operacional==="HOLD_OBRIGATORIO",
  "Challenge granted money");
 assert((await adapter.lerTentativa(T))?.contexto.userId===U,"Private attempt missing");
 assert((await adapter.consumirDesafio(N,H,T)).movimenta_dinheiro===false,
  "Money mutation allowed");
 assert(calls.length===5,"Exactly five calls expected");
 for(let i=0;i<5;i++)assert(calls[i].sql.includes(dict[i]),"Wrapper SQL order mismatch");
 assert(!("reservarInicio" in adapter),"Legacy unbound principal reservation exposed");
});
Deno.test("nega SQL/driver em nome de banco nao descartavel ou role indevida",()=>{
 const base:ExecutorPonteMfaSomenteCi={
  databaseName:"catalogo_asaas_guards_ci",roleName:"catalogo_mfa_ponte_ci_inerte",
  async queryObject(){return [{result:status()}];},
 };
 for(const options of [
  {databaseName:"postgres"},
  {databaseName:"catalogo_asaas_race_ci"},
  {roleName:"postgres"},
  {roleName:"service_role"},
  {roleName:"authenticated"},
 ]){
  let denied=false;
  try{new LivroSqlPonteMfaCiInerte({...base,...options} as ExecutorPonteMfaSomenteCi,"isolated-ci");}
  catch(e){denied=(e as Error).message==="ponte_mfa_sql_ambiente_ou_papel_invalido";}
  assert(denied,"Unexpected SQL executor accepted: "+JSON.stringify(options));
 }
});
Deno.test("sem claims arbitrarias: identidade malformada e SQL injection bloqueados antes de query",async()=>{
 const x=make(()=>status());
 for(const args of [[C,"not-uuid",S],[C,U,"' OR 1=1 --"],["",U,S]]){
  await rejects(()=>x.adapter.reservarInicioVinculado(...args as [string,string,string]),
   "Corrupt AAL1");
 }
 await rejects(()=>x.adapter.lerContexto("not-a-uuid"),"Context id");
 await rejects(()=>x.adapter.lerTentativa("not-a-uuid"),"Attempt id");
 await rejects(()=>x.adapter.registrarDesafio(N,H,"not-a-uuid"),"Challenge id");
 await rejects(()=>x.adapter.consumirDesafio(N,"null",T),"Consume id");
 assert(x.calls.length===0,"Bad args reached prepared executor");
});
Deno.test("qualquer retorno sem HOLD ou permissivo bloqueia financeiro",async()=>{
 for(const delta of [
  {pagamento_autorizado:true},{challenge_go_true_verificado:true},
  {desafio_mfa_da_sessao_comprovado:true},{pode_registrar_parecer:true},
  {dupla_aprovacao_financeira:true},{liberacao_autorizada:true},
  {baixa_realizada:true},{movimenta_dinheiro:true},
  {status_operacional:"LIBERADO"},{ok:"true"},{motivo:""},
  {nonce:"evil"},{nonce:null,ok:true},
 ]){
  const x=make(()=>({...status(),...delta}));
  // nonce:null com ok:true é permitido pelo parser, mas o orquestrador
  // deve negar no passo seguinte porque falta um nonce UUID.
  if(delta.nonce===null && delta.ok===true){
   const v=await x.adapter.reservarInicioVinculado(C,U,S);
   assert(v.nonce===null,"Null nonce unexpectedly accepted as UUID");
  }else {
   await rejects(()=>x.adapter.reservarInicioVinculado(C,U,S),"Unsafe status "+JSON.stringify(delta));
  }
 }
});
Deno.test("role revogada/filtro wrapper -> NULL nao vira aceite ou challenge",async()=>{
 const x=make(i=>(i===1||i===3)?null:null);
 await rejects(()=>x.adapter.reservarInicioVinculado(C,U,S),"Missing reserve");
 await rejects(()=>x.adapter.registrarDesafio(N,H,T),"Missing registration");
 await rejects(()=>x.adapter.consumirDesafio(N,H,T),"Missing consumption");
 assert(await x.adapter.lerContexto(C)===null,"Context NULL not propagated");
 assert(await x.adapter.lerTentativa(T)===null,"Attempt NULL not propagated");
 assert(x.calls.length===5,"Each method should use wrapper exactly once");
});
Deno.test("falha fechada se driver retornar duplicata, objeto cru, contexto/tentativa adulterados",async()=>{
 const db:ExecutorPonteMfaSomenteCi={
  databaseName:"catalogo_asaas_guards_ci",roleName:"catalogo_mfa_ponte_ci_inerte",
  async queryObject(){return [{result:status()},{result:status()}];},
 };
 await rejects(()=>new LivroSqlPonteMfaCiInerte(db,"isolated-ci")
  .reservarInicioVinculado(C,U,S),"Duplicated rows");
 for(const invalid of [
  {...ctx,id:"evil"},{...ctx,userId:"evil"},
  {...ctx,evidenceHash:"evil"},{...ctx,expiresAt:NaN},
 ]){
  await rejects(()=>make(i=>i===1?invalid:status()).adapter.lerContexto(C),
   "Invalid snapshot");
 }
 for(const invalid of [
  {nonce:"evil",challengeId:H,tentativa:T,contexto:ctx},
  {nonce:N,challengeId:H,tentativa:"evil",contexto:ctx},
  {nonce:N,challengeId:H,tentativa:T,contexto:{...ctx,sessionId:"evil"}},
 ]){
  await rejects(()=>make(i=>i===3?invalid:status()).adapter.lerTentativa(T),
   "Invalid attempt");
 }
});
