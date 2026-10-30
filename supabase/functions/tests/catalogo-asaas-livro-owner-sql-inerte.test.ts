// #42 — Teste puro do adaptador SQL; nenhuma conexao, rede ou segredo.
import {
  LivroSqlOwnerPrechallengeInerte,
  type ExecutorOwnerSqlSomenteCi,
} from "../_shared/catalogo-asaas-livro-owner-sql-inerte.ts";

function check(v:unknown,m:string):asserts v{if(!v)throw Error(m);}
async function denied(p:Promise<unknown>,desc:string){
 try{await p;}catch{return;}
 throw Error("Falhou aberto: "+desc);
}
const C="11111111-1111-4111-8111-111111111111";
const U="22222222-2222-4222-8222-222222222222";
const S="33333333-3333-4333-8333-333333333333";
const F="44444444-4444-4444-8444-444444444444";
const E="55555555-5555-4555-8555-555555555555";
const N="66666666-6666-4666-8666-666666666666";
const H="77777777-7777-4777-8777-777777777777";
const T="88888888-8888-4888-8888-888888888888";
const ctx={id:C,userId:U,sessionId:S,factorId:F,separationId:E,
  evidenceHash:"a".repeat(64),expiresAt:1800000000000};
const pgRes=(ok=true,motivo="nonce_reservado")=>({
 ok,motivo,nonce:ok?N:null,status_operacional:"HOLD_OBRIGATORIO",
 pagamento_autorizado:false,challenge_go_true_verificado:false,
 desafio_mfa_da_sessao_comprovado:false,pode_registrar_parecer:false,
 dupla_aprovacao_financeira:false,liberacao_autorizada:false,
 baixa_realizada:false,movimenta_dinheiro:false,
});
const dict=[
 "catalogo_asaas_reservar_inicio_compartilhado_inerte",
 "catalogo_asaas_ler_contexto_prechallenge_inerte",
 "catalogo_asaas_registrar_desafio_compartilhado_inerte",
 "catalogo_asaas_ler_tentativa_prechallenge_inerte",
 "catalogo_asaas_consumir_desafio_compartilhado_inerte",
 "catalogo_asaas_reservar_inicio_principal_vinculado_inerte",
];
function make(responder:(id:number,params:readonly string[])=>unknown){
 const calls:Array<{sql:string,params:readonly string[]}>= [];
 const sql:ExecutorOwnerSqlSomenteCi={
  databaseName:"catalogo_asaas_race_ci",
  async queryObject(query,params){
   calls.push({sql:query,params:[...params]});
   check(query.startsWith("SELECT catalogo_private.catalogo_asaas_"),
     "Tentativa de acesso SQL fora de catalogo_private");
   check(!query.includes("'"+N+"'")&&!query.includes("'"+C+"'"),
     "ID fornecido concatenado no SQL, nao em parametro");
   const id=dict.findIndex(f=>query.includes(f+"("));
   check(id>=0,"Funcao SQL nao reconhecida");
   check(/ AS result$/.test(query),"Alias da resposta alterado");
   check((query.match(/::uuid/g)||[]).length===params.length,
     "SQL parametros nao preparados");
   check(query.includes("$1::uuid"),"SQL perdeu bind");
   return [{result:responder(id,params)}];
  }
 };
 return {adapter:new LivroSqlOwnerPrechallengeInerte(sql,"isolated-ci"),calls,sql};
}

Deno.test("cinco operações owner SQL usam prepared statements e mantem flags HOLD",async()=>{
 const {adapter,calls}=make((id,params)=>{
  if(id===0){check(params.length===1&&params[0]===C,"nonce do client");return pgRes();}
  if(id===1){check(params.length===1&&params[0]===C,"contexto SQL alterado");return ctx;}
  if(id===2){check(params.join(",")=== [N,H,T].join(","),"challenge SQL trocado");
   return pgRes(true,"challenge_registrado");}
  if(id===3){check(params[0]===T,"read attempt SQL trocada");
   return {nonce:N,challengeId:H,tentativa:T,contexto:ctx};}
  if(id===4){check(params.join(",")=== [N,H,T].join(","),"consumo SQL trocado");
   return pgRes(true,"tentativa_documental_consumida");}
  throw Error("out of bounds");
 });
 const start=await adapter.reservarInicio(C);
 check(start.ok&&start.nonce===N&&!start.pagamento_autorizado,"reserva nao validada");
 const context=await adapter.lerContexto(C);
 check(context?.factorId===F&&context.evidenceHash==="a".repeat(64),"snapshot SQL incompleto");
 const challenge=await adapter.registrarDesafio(N,H,T);
 check(challenge.ok&&!challenge.dupla_aprovacao_financeira,"challenge unsafe");
 const row=await adapter.lerTentativa(T);
 check(row?.nonce===N&&row.contexto.sessionId===S&&row.tentativa===T,"tentativa nao recuperada");
 const consumed=await adapter.consumirDesafio(N,H,T);
 check(consumed.ok&&!consumed.challenge_go_true_verificado,"consumo se tornou MFA verificado");
 check(calls.length===5,"numero de chamadas inesperadas");
 for(let i=0;i<5;i++)check(calls[i].sql.includes(dict[i]),"ordem SQL trocada");
});

Deno.test("queries negativas retornam null e estados SQL recusados nao viram true",async()=>{
 const {adapter}=make((id)=>{
  if(id===1 || id===3) return null;
  return pgRes(false,"contexto_aal1_invalido");
 });
 const start=await adapter.reservarInicio(C);
 check(start.ok===false&&start.nonce===null,"nonce retornou na recusa");
 check(await adapter.lerContexto(C)===null,"contexto inexistente nao retornou null");
 check(await adapter.lerTentativa(T)===null,"tentativa nao registrada foi revelada");
 const again=await adapter.registrarDesafio(N,H,T);
 check(again.ok===false,"challenge recusado aceito");
});

Deno.test("flags financeiras permissivas ou payload do banco adulterado causam erro",async()=>{
 for(const delta of [
  {pagamento_autorizado:true},{pode_registrar_parecer:true},
  {dupla_aprovacao_financeira:true},{challenge_go_true_verificado:true},
  {status_operacional:"LIBERADO"},{nonce:"not-uuid"},
  {movimenta_dinheiro:true},{motivo:123},
 ]) {
  const {adapter}=make(()=>({...pgRes(),...delta}));
  await denied(adapter.reservarInicio(C),"Resposta SQL "+JSON.stringify(delta));
 }
 for(const bad of [
  {...ctx,userId:"forged"},{...ctx,evidenceHash:"not-sha"},
  {...ctx,expiresAt:NaN},{...ctx,sessionId:null},
 ]) {
  const {adapter}=make(id=>id===1?bad:pgRes());
  await denied(adapter.lerContexto(C),"Snapshot SQL "+JSON.stringify(bad));
 }
 const {adapter}=make(id=>id===3?{nonce:N,challengeId:"foreign",tentativa:T,contexto:ctx}:pgRes());
 await denied(adapter.lerTentativa(T),"challenge foreign");
});

Deno.test("driver de banco nao descartavel ou SQL resultados multiplos falham fechados",async()=>{
 for(const name of ["postgres","catalogo_ci","production"]){
  try{
   new LivroSqlOwnerPrechallengeInerte({
    databaseName:name as ExecutorOwnerSqlSomenteCi["databaseName"],
    async queryObject(){return [{result:pgRes()}];}
   },"isolated-ci");
   throw Error("Driver "+name+" aceito");
  }catch(e){
   check((e as Error).message==="owner_sql_ambiente_nao_descartavel",
    "Driver invalido nao falhou corretamente");
  }
 }
 const called:string[]=[];
 const sql:ExecutorOwnerSqlSomenteCi={
  databaseName:"catalogo_asaas_guards_ci",
  async queryObject(){called.push("query");return [{result:pgRes()},{result:pgRes()}];}
 };
 const adapter=new LivroSqlOwnerPrechallengeInerte(sql,"isolated-ci");
 await denied(adapter.reservarInicio(C),"duplicated SQL rows");
 check(called.length===1,"driver nao rodou exatamente uma vez");
 const bad=make(()=>pgRes());
 await denied(bad.adapter.reservarInicio("bad_uuid; DROP TABLE users;"),"SQL injection input");
 check(bad.calls.length===0,"query sequer deveria receber input nao UUID");
});

Deno.test("reserva com principal usa tres UUID bind e recusa campos arbitrarios",async()=>{
 const {adapter,calls}=make((id,params)=>{
  check(id===5,"funcao de reserva autenticada trocada");
  check(params.length===3 && params.join(",") === [C,U,S].join(","),
   "principal nao foi passado inteiramente em parametros SQL");
  return pgRes();
 });
 const issued=await adapter.reservarInicioVinculado(C,U,S);
 check(issued.ok && issued.nonce===N,"nonce nao retornou");
 check(calls.length===1 && calls[0].sql.includes("$1::uuid,$2::uuid,$3::uuid"),
   "uid ou sessao concatenados na consulta");
 await denied(adapter.reservarInicioVinculado(C,U,"outro"),"sessao forjada sem UUID");
 check(calls.length===1,"sessao forjada chegou ao driver");
});
