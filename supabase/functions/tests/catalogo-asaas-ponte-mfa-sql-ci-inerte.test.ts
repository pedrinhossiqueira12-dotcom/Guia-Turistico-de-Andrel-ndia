/**
 * #42 — Modelo da ponte NOLOGIN sem servidor, SQL real, dados financeiros,
 * tokens, OTP nem conexao de rede. O CI testara separadamente o SQL Postgres.
 */
import {
  LivroPonteMfaSqlCiInerte,
  type ExecutorPonteMfaCiInerte,
} from "../_shared/catalogo-asaas-ponte-mfa-sql-ci-inerte.ts";
const C="11111111-1111-4111-8111-111111111111";
const U="22222222-2222-4222-8222-222222222222";
const S="33333333-3333-4333-8333-333333333333";
const F="44444444-4444-4444-8444-444444444444";
const E="55555555-5555-4555-8555-555555555555";
const N="66666666-6666-4666-8666-666666666666";
const H="77777777-7777-4777-8777-777777777777";
const T="88888888-8888-4888-8888-888888888888";
const context={id:C,userId:U,sessionId:S,factorId:F,separationId:E,
  evidenceHash:"a".repeat(64),expiresAt:1870000000000};
const good=(reason="nonce_reservado")=>({
  ok:true,motivo:reason,nonce:N,status_operacional:"HOLD_OBRIGATORIO",
  pagamento_autorizado:false,challenge_go_true_verificado:false,
  desafio_mfa_da_sessao_comprovado:false,pode_registrar_parecer:false,
  dupla_aprovacao_financeira:false,liberacao_autorizada:false,
  baixa_realizada:false,movimenta_dinheiro:false,
});
const names=[
 "catalogo_asaas_ponte_reservar_principal_inerte",
 "catalogo_asaas_ponte_ler_contexto_inerte",
 "catalogo_asaas_ponte_registrar_desafio_inerte",
 "catalogo_asaas_ponte_ler_tentativa_inerte",
 "catalogo_asaas_ponte_consumir_desafio_inerte",
] as const;
function check(x:unknown,m:string):asserts x{if(!x)throw Error(m);}
async function denied(fn:()=>unknown|Promise<unknown>,message:string){
  let rejected=false;
  try{await fn();}catch{rejected=true;}
  check(rejected,message);
}
function adapter(responder:(index:number,params:readonly string[])=>unknown){
  const calls:Array<{sql:string;params:readonly string[]}>= [];
  const db:ExecutorPonteMfaCiInerte={
    databaseName:"catalogo_asaas_guards_ci",
    executionRole:"catalogo_mfa_ponte_ci_inerte",
    async queryObject(sql,params){
      calls.push({sql,params:[...params]});
      check(sql.startsWith("SELECT catalogo_mfa_ponte_ci_inerte.catalogo_asaas_ponte_"),
        "SQL escapou do esquema isolado");
      check(!sql.includes("catalogo_private.")&&!sql.includes("public.") &&
        !sql.includes("auth.") && !sql.includes("service_role"),"acesso SQL bruto");
      check(!sql.includes("'"+U+"'")&&!sql.includes("'"+C+"'"),
        "identificadores concatenados no SQL");
      check(sql.endsWith(" AS result"),"alias de retorno nao esperado");
      const i=names.findIndex(n=>sql.includes(n+"("));
      check(i!==-1,"wrapper desconhecido");
      check((sql.match(/::uuid/g)||[]).length===params.length,"contagem SQL bind incorreta");
      for(let n=0;n<params.length;n++)check(sql.includes("$"+(n+1)+"::uuid"),
        "parametro nao preparado");
      return [{result:responder(i,params)}];
    },
  };
  return {book:new LivroPonteMfaSqlCiInerte(db,"isolated-ci"),calls};
}
Deno.test("cinco wrappers SQL isolados aceitam so UUID preparados e nunca abrem dinheiro",async()=>{
  const {book,calls}=adapter((n,p)=>{
    if(n===0){check(p.join(",")===[C,U,S].join(","),"reserva spoofed");return good();}
    if(n===1){check(p[0]===C,"contexto diferente");return context;}
    if(n===2){check(p.join(",")===[N,H,T].join(","),"challenge errado");return good("challenge_registrado");}
    if(n===3){check(p[0]===T,"tentativa errada");return {nonce:N,challengeId:H,tentativa:T,contexto:context};}
    if(n===4){check(p.join(",")===[N,H,T].join(","),"consumo errado");return good("tentativa_consumida");}
    throw Error("wrapper nao esperado");
  });
  const reserve=await book.reservarInicioVinculado(C,U,S);
  check(reserve.ok && reserve.nonce===N && !reserve.pagamento_autorizado,"HOLD reserva");
  check((await book.lerContexto(C))?.sessionId===S,"snapshot do contexto");
  check((await book.registrarDesafio(N,H,T)).status_operacional==="HOLD_OBRIGATORIO",
    "registro fez unlock");
  check((await book.lerTentativa(T))?.contexto.factorId===F,"tentativa SQL");
  const consumption=await book.consumirDesafio(N,H,T);
  check(consumption.ok && !consumption.challenge_go_true_verificado &&
    !consumption.movimenta_dinheiro,"consumo fez Pix");
  check(calls.length===5,"numero inesperado de consultas");
  for(let i=0;i<names.length;i++)check(calls[i].sql.includes(names[i]),
    "ordem SQL incorreta");
});
Deno.test("a perda do grant NOLOGIN retorna NULL: comandos falham fechados",async()=>{
  const {book}=adapter(()=>null);
  await denied(()=>book.reservarInicioVinculado(C,U,S),"reserva NULL foi aceita");
  check(await book.lerContexto(C)===null,"contexto NULL deve recusar");
  await denied(()=>book.registrarDesafio(N,H,T),"challenge NULL foi aceito");
  check(await book.lerTentativa(T)===null,"tentativa NULL deve recusar");
  await denied(()=>book.consumirDesafio(N,H,T),"consumo NULL foi aceito");
});
Deno.test("payloads SQL financeiro falsificados sao recusados para todos os comandos",async()=>{
  for(const delta of [
    {pagamento_autorizado:true},{challenge_go_true_verificado:true},
    {desafio_mfa_da_sessao_comprovado:true},{pode_registrar_parecer:true},
    {dupla_aprovacao_financeira:true},{liberacao_autorizada:true},
    {baixa_realizada:true},{movimenta_dinheiro:true},
    {status_operacional:"LIBERADO"},{nonce:"malformed"},
    {ok:"true"},{motivo:0},
  ]){
    const {book}=adapter(()=>({...good(),...delta}));
    await denied(()=>book.reservarInicioVinculado(C,U,S),
      "reserva com flag financeira autorizada: "+Object.keys(delta).join(","));
    await denied(()=>book.registrarDesafio(N,H,T),"challenge permissivo");
    await denied(()=>book.consumirDesafio(N,H,T),"consumo permissivo");
  }
});
Deno.test("reserva nunca recebe principal alheio em SQL concatenado",async()=>{
  const {book,calls}=adapter(()=>good());
  for(const bad of ["' OR TRUE --", "not-uuid", C+"; DROP TABLE auth.users;"]){
    await denied(()=>book.reservarInicioVinculado(C,U,bad),"sessao sem UUID");
    await denied(()=>book.reservarInicioVinculado(C,bad,S),"principal sem UUID");
  }
  check(calls.length===0,"input nao UUID acessou executor");
  await book.reservarInicioVinculado(C,U,S);
  check(calls.length===1 && calls[0].params.join(",")===[C,U,S].join(","),
    "principal foi misturado");
});
Deno.test("contexto, tentativa, resultado SQL e executor defeituosos sao negados",async()=>{
  for(const malformed of [
    {...context,id:"other"},{...context,expiresAt:NaN},
    {...context,evidenceHash:"x".repeat(64)},{...context,factorId:U.slice(0,-1)},
  ]){
    const {book}=adapter(n=>n===1?malformed:good());
    await denied(()=>book.lerContexto(C),"contexto adulterado");
  }
  const {book:book1}=adapter(n=>n===3?{
    nonce:N,challengeId:"malformed",tentativa:T,contexto:context}:good());
  await denied(()=>book1.lerTentativa(T),"tentativa adulterada");
  for(const result of [[],[{missing:good()}],[{result:good()},{result:good()}]]){
    const broken:ExecutorPonteMfaCiInerte={
      databaseName:"catalogo_asaas_guards_ci",
      executionRole:"catalogo_mfa_ponte_ci_inerte",
      async queryObject(){return result},
    };
    const book=new LivroPonteMfaSqlCiInerte(broken,"isolated-ci");
    await denied(()=>book.consumirDesafio(N,H,T),"linhas SQL indevidas");
  }
});
Deno.test("instancias de staging, production, dono postgres ou service_role sao sempre recusadas",async()=>{
  for(const [databaseName,executionRole] of [
    ["postgres","catalogo_mfa_ponte_ci_inerte"],
    ["catalogo_asaas_race_ci","catalogo_mfa_ponte_ci_inerte"],
    ["catalogo_asaas_guards_ci","postgres"],
    ["catalogo_asaas_guards_ci","service_role"],
    ["catalogo_asaas_guards_ci","authenticated"],
  ]){
    await denied(()=>new LivroPonteMfaSqlCiInerte({
      databaseName:databaseName as ExecutorPonteMfaCiInerte["databaseName"],
      executionRole:executionRole as ExecutorPonteMfaCiInerte["executionRole"],
      async queryObject(){throw Error("nao consultar");}
    },"isolated-ci"),"executor fora da CI aceito");
  }
  const {book}=adapter(()=>good());
  check(!("reservarInicio" in book),"reserva antiga sem principal foi exposta");
});
