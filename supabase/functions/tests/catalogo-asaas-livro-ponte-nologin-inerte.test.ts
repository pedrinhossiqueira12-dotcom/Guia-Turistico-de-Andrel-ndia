// #42: regressao SQL privada. SOMENTE in-memory fake, sem rede, SQL ou segredo.
import {
 LivroSqlPonteNoLoginInerte,
 type ExecutorPonteMfaNoLoginSomenteCi,
} from "../_shared/catalogo-asaas-livro-ponte-nologin-inerte.ts";
function assert(v:unknown,message:string):asserts v{if(!v)throw Error(message);}
async function denied(fn:()=>Promise<unknown>,message:string){
 try{await fn();}catch{return;}
 throw Error("FAIL OPEN: "+message);
}
const ID="11111111-1111-4111-8111-111111111111";
const USER="22222222-2222-4222-8222-222222222222";
const SESSION="33333333-3333-4333-8333-333333333333";
const FACTOR="44444444-4444-4444-8444-444444444444";
const SEP="55555555-5555-4555-8555-555555555555";
const NONCE="66666666-6666-4666-8666-666666666666";
const CHALLENGE="77777777-7777-4777-8777-777777777777";
const ATTEMPT="88888888-8888-4888-8888-888888888888";
const ctx={id:ID,userId:USER,sessionId:SESSION,factorId:FACTOR,
 separationId:SEP,evidenceHash:"b".repeat(64),expiresAt:1800000000000};
function result(ok=true):Record<string,unknown>{
 return {ok,motivo:ok?"nonce_reservado":"recusado",
  nonce:ok?NONCE:null,status_operacional:"HOLD_OBRIGATORIO",
  pagamento_autorizado:false,challenge_go_true_verificado:false,
  desafio_mfa_da_sessao_comprovado:false,pode_registrar_parecer:false,
  dupla_aprovacao_financeira:false,liberacao_autorizada:false,
  baixa_realizada:false,movimenta_dinheiro:false};
}
const funcs=[
 "catalogo_asaas_ponte_reservar_principal_inerte",
 "catalogo_asaas_ponte_ler_contexto_inerte",
 "catalogo_asaas_ponte_registrar_desafio_inerte",
 "catalogo_asaas_ponte_ler_tentativa_inerte",
 "catalogo_asaas_ponte_consumir_desafio_inerte",
] as const;
function mk(answer:(index:number)=>unknown){
 const calls:Array<{query:string,params:readonly string[]}>= [];
 const driver:ExecutorPonteMfaNoLoginSomenteCi={
  databaseName:"catalogo_asaas_guards_ci",
  currentRole:"catalogo_mfa_ponte_ci_inerte",
  async queryObject(query,params){
   calls.push({query,params:[...params]});
   assert(query.startsWith("SELECT CASE WHEN current_database() = 'catalogo_asaas_guards_ci'"),
     "SQL omitiu isolamento do banco");
   assert(query.includes(" AND current_user = 'catalogo_mfa_ponte_ci_inerte'"),
     "SQL omitiu guard do executor da ponte");
   assert(query.includes(" AND session_user = 'postgres' THEN "),
     "SQL omitiu guard da conta local psql de teste");
   assert(query.endsWith(" END AS result"),"consulta SQL fora do formato contratual");
   assert(!query.includes("catalogo_private.")&&!query.includes("pg_catalog.") &&
     !query.includes("public."),"acesso direto ao banco privado proibido");
   assert(!query.includes("SET ROLE")&&!query.includes("INSERT ")
     &&!query.includes("UPDATE ")&&!query.includes("DELETE "),
     "driver nao deve executar role switch ou DML arbitrario");
   assert(!query.includes("'"+ID+"'")&&!query.includes("'"+SESSION+"'"),
     "query SQL concatenou parametros do cliente");
   const id=funcs.findIndex(f=>query.includes(
     "catalogo_mfa_ponte_ci_inerte."+f+"("));
   assert(id>=0,"SQL chamou proc nao permitida");
   assert((query.match(/::uuid/g)||[]).length===params.length,
     "SQL perdeu parametros preparados");
   assert(params.every(v=>/^[0-9a-f-]{36}$/.test(v)),"SQL recebeu dado arbitrario");
   return [{result:answer(id)}];
  }
 };
 return {adapter:new LivroSqlPonteNoLoginInerte(driver,"isolated-ci"),calls,driver};
}
Deno.test("cinco wrappers SQL reais protegidos por guard CI e binds UUID",async()=>{
 const {adapter,calls}=mk(i=>i===1?ctx:i===3?{
  nonce:NONCE,tentativa:ATTEMPT,challengeId:CHALLENGE,contexto:ctx,
 }:result());
 const start=await adapter.reservarInicioVinculado(ID,USER,SESSION);
 assert(start.ok&&start.nonce===NONCE&&!start.pagamento_autorizado,
   "reserva vinculada sem HOLD");
 const saved=await adapter.lerContexto(ID);
 assert(saved?.userId===USER&&saved.sessionId===SESSION,"contexto errado");
 const registered=await adapter.registrarDesafio(NONCE,CHALLENGE,ATTEMPT);
 assert(registered.ok&&!registered.desafio_mfa_da_sessao_comprovado,
   "registrar challenge virou MFA autorizado");
 const attempt=await adapter.lerTentativa(ATTEMPT);
 assert(attempt?.nonce===NONCE&&attempt.contexto.factorId===FACTOR,
   "consulta tentativa nao leu contexto privado");
 const consumed=await adapter.consumirDesafio(NONCE,CHALLENGE,ATTEMPT);
 assert(consumed.ok&&!consumed.movimenta_dinheiro,
   "challenge consumido ganhou dinheiro");
 assert(calls.length===5 && calls.every((x,i)=>x.query.includes(funcs[i])),
   "SQL operacoes omitidas");
 assert(calls[0].params.join(",")===[ID,USER,SESSION].join(","),
   "revisor/sessao alterados no SQL");
 assert(calls[2].params.join(",")===[NONCE,CHALLENGE,ATTEMPT].join(","),
   "challenge ou attempt alterados");
});
Deno.test("sem driver CI, role NOLOGIN, ou banco certo, instancia nem inicia",()=>{
 for(const change of [
  {databaseName:"postgres"},
  {databaseName:"catalogo_asaas_race_ci"},
  {currentRole:"authenticated"},
  {currentRole:"service_role"},
  {currentRole:"postgres"},
 ]){
  let rejected=false;
  try{
   const validDriver=mk(()=>result()).driver;
   const fakeDriver=Object.assign({},validDriver,change) as ExecutorPonteMfaNoLoginSomenteCi;
   new LivroSqlPonteNoLoginInerte(fakeDriver,"isolated-ci");
  }
  catch(e){rejected=(e as Error).message==="ponte_nao_e_conexao_ci_descartavel";}
  assert(rejected,"ambiente ou role incorreta passou pelo guard");
 }
});
Deno.test("resposta NULL de wrapper invalida escritas e leituras ficam indisponiveis",async()=>{
 const {adapter}=mk(()=>null);
 await denied(()=>adapter.reservarInicioVinculado(ID,USER,SESSION),"reserva NULL");
 await denied(()=>adapter.registrarDesafio(NONCE,CHALLENGE,ATTEMPT),"registro NULL");
 await denied(()=>adapter.consumirDesafio(NONCE,CHALLENGE,ATTEMPT),"consumo NULL");
 assert(await adapter.lerContexto(ID)===null,"contexto NULL vaza");
 assert(await adapter.lerTentativa(ATTEMPT)===null,"tentativa NULL vaza");
});
Deno.test("resposta permissiva, autenticacao forjada, SQL invalido e rows extras recusados",async()=>{
 for(const drift of [{pagamento_autorizado:true},{movimenta_dinheiro:true},
  {challenge_go_true_verificado:true},{dupla_aprovacao_financeira:true},
  {liberacao_autorizada:true},{pode_registrar_parecer:true},
  {status_operacional:"LIBERADO"},{nonce:123},{motivo:"x".repeat(200)}]){
  const {adapter}=mk(()=>({...result(),...drift}));
  await denied(()=>adapter.reservarInicioVinculado(ID,USER,SESSION),
   "resposta permissiva "+Object.keys(drift)[0]);
 }
 const bad=mk(()=>result());
 await denied(()=>bad.adapter.reservarInicioVinculado(ID,USER,"abc;DROP TABLE"),
  "sessionId SQL injection");
 assert(bad.calls.length===0,"input fora de UUID chegou no driver");
 const multi:ExecutorPonteMfaNoLoginSomenteCi={
  databaseName:"catalogo_asaas_guards_ci",
  currentRole:"catalogo_mfa_ponte_ci_inerte",
  async queryObject(){return [{result:result()},{result:result()}];}
 };
 await denied(()=>new LivroSqlPonteNoLoginInerte(multi,"isolated-ci")
  .registrarDesafio(NONCE,CHALLENGE,ATTEMPT),"multiples SQL rows");
});

Deno.test("sucesso sem nonce UUID e recusado em todas as operacoes documentais",async()=>{
 for(const broken of [null,undefined,"evil"]){
  const {adapter}=mk(()=>({...result(),nonce:broken}));
  await denied(()=>adapter.reservarInicioVinculado(ID,USER,SESSION),
   "reserva com nonce ausente ou malformado");
  await denied(()=>adapter.registrarDesafio(NONCE,CHALLENGE,ATTEMPT),
   "challenge com nonce ausente ou malformado");
  await denied(()=>adapter.consumirDesafio(NONCE,CHALLENGE,ATTEMPT),
   "consumo com nonce ausente ou malformado");
 }
});
Deno.test("negativa SQL com nonce reutilizavel deve falhar fechada",async()=>{
 const {adapter}=mk(()=>({...result(false),nonce:NONCE}));
 await denied(()=>adapter.reservarInicioVinculado(ID,USER,SESSION),
   "reserva negada revelou nonce");
 await denied(()=>adapter.registrarDesafio(NONCE,CHALLENGE,ATTEMPT),
   "challenge negado revelou nonce");
 await denied(()=>adapter.consumirDesafio(NONCE,CHALLENGE,ATTEMPT),
   "consumo negado revelou nonce");
});
Deno.test("dados de contexto ou tentativa adulterados nao sao expostos pelo adaptador",async()=>{
 for(const invalid of [
  {...ctx,id:"evil"},{...ctx,userId:"evil"},
  {...ctx,sessionId:null},{...ctx,evidenceHash:"0"},
  {...ctx,expiresAt:NaN},{...ctx,factorId:"evil"},
 ]){
  const {adapter}=mk(i=>i===1?invalid:result());
  await denied(()=>adapter.lerContexto(ID),"snapshot invalido");
 }
 for(const invalid of [
  {nonce:"evil",tentativa:ATTEMPT,challengeId:CHALLENGE,contexto:ctx},
  {nonce:NONCE,tentativa:"evil",challengeId:CHALLENGE,contexto:ctx},
  {nonce:NONCE,tentativa:ATTEMPT,challengeId:CHALLENGE,
   contexto:{...ctx,sessionId:"evil"}},
 ]){
  const {adapter}=mk(i=>i===3?invalid:result());
  await denied(()=>adapter.lerTentativa(ATTEMPT),"tentativa adulterada");
 }
});
Deno.test("ponte rejeita UUID malformado nas cinco rotas sem chamar o executor SQL",async()=>{
 const x=mk(()=>result());
 await denied(()=>x.adapter.reservarInicioVinculado(ID,USER,"' OR 1=1 --"),
   "sessao com SQL injection");
 await denied(()=>x.adapter.lerContexto("bad-uuid"),"contexto adulterado");
 await denied(()=>x.adapter.registrarDesafio(NONCE,CHALLENGE,"bad-uuid"),
   "tentativa adulterada");
 await denied(()=>x.adapter.lerTentativa("bad-uuid"),"consulta sem uuid");
 await denied(()=>x.adapter.consumirDesafio(NONCE,"bad-uuid",ATTEMPT),
   "challenge sem uuid");
 assert(x.calls.length===0,"parametro adulterado chegou ao executor");
});

Deno.test("lookup privado bloqueia troca de contexto entre revisores mesmo com UUIDs validos",async()=>{
 const {adapter}=mk(i=>i===1?{...ctx,id:SESSION}:result());
 await denied(()=>adapter.lerContexto(ID),
   "SQL retornou contexto de outro ID sem negar");
});
Deno.test("lookup de tentativa bloqueia replay por ID diferente valido",async()=>{
 const {adapter}=mk(i=>i===3?{
  nonce:NONCE,tentativa:SESSION,challengeId:CHALLENGE,contexto:ctx,
 }:result());
 await denied(()=>adapter.lerTentativa(ATTEMPT),
   "SQL retornou tentativa UUID valida mas de outro revisor");
});
Deno.test("respostas de desafio/consumo aceitas recusam nonce valido de outra operacao",async()=>{
 const {adapter}=mk(()=>({...result(),nonce:SESSION}));
 await denied(()=>adapter.registrarDesafio(NONCE,CHALLENGE,ATTEMPT),
   "desafio aceitou nonce alheio");
 await denied(()=>adapter.consumirDesafio(NONCE,CHALLENGE,ATTEMPT),
   "consumo aceitou nonce alheio");
 // Resultado SQL ok=false sem nonce continua sendo recusa documental.
 const {adapter:rejected}=mk(()=>result(false));
 const response=await rejected.registrarDesafio(NONCE,CHALLENGE,ATTEMPT);
 assert(!response.ok && !response.pagamento_autorizado &&
   response.status_operacional==="HOLD_OBRIGATORIO",
   "erro SQL foi confundido com autorizacao");
});
