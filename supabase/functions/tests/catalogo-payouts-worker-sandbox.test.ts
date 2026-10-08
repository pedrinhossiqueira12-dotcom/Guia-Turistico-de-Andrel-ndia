// Tudo offline: nenhuma Edge pública é chamada e nenhum Pix é enviado.
import { encryptCourierPix } from "../_shared/catalogo-entregas-crypto-v2.ts";
import {
  iniciarPayoutSandbox, conciliarPayoutSandbox, type PayoutBancoSnapshot,
  type PayoutBancoPrivado,
} from "../_shared/catalogo-payouts-worker-sandbox-v2.ts";

const INTENT="77777777-7777-4777-8777-777777777777";
const SAQUE="88888888-8888-4888-8888-888888888888";
const RIDER="99999999-9999-4999-8999-999999999999";
const POP="POP01KV681P6SJ38NQHWX3XK162SS";
const TOP="TOP01KV681P6SJ38NQHWX3SF2WM22";
const AES_KEY="3".repeat(64); // TESTE: fixture descartável.
const TOKEN="TEST_KEY_MOCK_NEVER_PRODUCTION";
function assert(value: unknown, description: string): asserts value {
  if (!value) throw new Error(description);
}
async function rejects(fn: () => Promise<unknown>, includes: string) {
  try { await fn(); } catch(e) {
    assert(String(e).includes(includes), "Exceção diferente: "+String(e));
    return;
  }
  throw new Error("Esperava erro: "+includes);
}
function responseJson(body: object,status: number) {
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
}
async function fakeDatabase() {
  const cipher=await encryptCourierPix("rider@example.invalid",AES_KEY,RIDER);
  assert(cipher,"Cifra mock não criada");
  const state:PayoutBancoSnapshot = {
    id:INTENT,solicitacao_id:SAQUE,motoboy_id:RIDER,
    valor_centavos:1234,pix_tipo:"EMAIL",chave_pix_enc_snapshot:cipher,
    idempotency_key:SAQUE,referencia_externa:"saque_"+SAQUE.replaceAll("-",""),
    status:"reservado",payout_id:null,transacao_id:null,
  };
  const calls:string[]=[];
  const database:PayoutBancoPrivado={
    async carregarIntent(id) {
      calls.push("load");
      assert(id===INTENT,"Um intent não pode consultar outro");
      return {...state};
    },
    async rpc(name, args) {
      calls.push(name);
      if (name==="catalogo_marcar_envio_payout_v2") {
        if(state.status!=="reservado") return {data:{ok:false},error:null};
        state.status="em_envio";
        assert(args.p_intent_id===INTENT,"ID alterado");
        return {data:{ok:true},error:null};
      }
      if(name==="catalogo_registrar_criacao_payout_v2") {
        assert(state.status==="em_envio","Criou sem reserva persistida");
        state.status="aguardando_confirmacao";
        state.payout_id=String(args.p_payout_id);
        state.transacao_id=String(args.p_transacao_id);
        return {data:{ok:true},error:null};
      }
      if(name==="catalogo_conciliar_payout_v2") {
        assert(state.payout_id===args.p_payout_id,"IDs inconsistentes");
        assert(state.transacao_id===args.p_transacao_id,"Tx errada");
        assert(state.valor_centavos===args.p_valor_centavos,"Valor alterado");
        const credit= args.p_status==="success" && args.p_status_detail==="accredited";
        if (credit) state.status="confirmado";
        return {data:{ok:true,transferencia_confirmada:credit},error:null};
      }
      throw new Error("RPC não esperada: "+name);
    },
  };
  return {state,calls,database};
}
function resultCreation() {
  return { id:POP,external_reference:"saque_"+SAQUE.replaceAll("-",""),
    transactions:[{id:TOP,external_reference:"motoboy_"+SAQUE.replaceAll("-","")}] };
}
const options = (transport:(url:string,init:RequestInit)=>Promise<Response>) =>
  ({testAccessToken:TOKEN,testApproved:true,transport});

Deno.test("trava antes de POST; primeiro envio 202 nunca liquida salário",async()=>{
  const {state,calls,database}=await fakeDatabase();
  let sent=0;
  const worker=options(async (url,init)=>{
    sent++;
    assert(url==="https://api.mercadopago.com/v1/payouts","URL errada");
    assert(init.method==="POST","Método errado");
    assert(new Headers(init.headers).get("X-test-token")==="true","Não é sandbox");
    assert(new Headers(init.headers).get("X-Idempotency-Key")===SAQUE,"ID transação trocado");
    return responseJson(resultCreation(),202);
  });
  const r=await iniciarPayoutSandbox(INTENT,database,{...worker,chaveCriptografia:AES_KEY});
  assert(r.estado==="aguardando_confirmacao" && state.status==="aguardando_confirmacao","Não aguardou consulta GET");
  assert(sent===1 && calls.indexOf("catalogo_marcar_envio_payout_v2")<
    calls.indexOf("catalogo_registrar_criacao_payout_v2"),"POST sem trava inicial");
  await rejects(()=>iniciarPayoutSandbox(INTENT,database,{...worker,chaveCriptografia:AES_KEY}),
    "já iniciada");
  assert(sent===1,"Segundo clique enviou outro Pix");
});

Deno.test("timeout deixa tentativa marcada e nunca efetua POST duas vezes",async()=>{
  const {state,database}=await fakeDatabase();
  let sent=0;
  const worker=options(async()=>{sent++;throw new Error("rede caiu depois do POST");});
  await rejects(()=>iniciarPayoutSandbox(INTENT,database,{...worker,chaveCriptografia:AES_KEY}),"rede caiu");
  assert(state.status==="em_envio" && sent===1,"Falha apagou marca de tentativa");
  await rejects(()=>iniciarPayoutSandbox(INTENT,database,{...worker,chaveCriptografia:AES_KEY}),
    "já iniciada");
  assert(sent===1,"Retry automático duplicou envio");
});

Deno.test("credencial de cifra incorreta e opt-in ausente bloqueiam antes da RPC",async()=>{
  const {database,calls}=await fakeDatabase();
  const worker=options(async()=>{throw new Error("rede não deve ser acionada");});
  await rejects(()=>iniciarPayoutSandbox(INTENT,database,{
    ...worker,testApproved:false,chaveCriptografia:AES_KEY,
  }),"desabilitado");
  await rejects(()=>iniciarPayoutSandbox(INTENT,database,{
    ...worker,chaveCriptografia:"4".repeat(64),
  }),"OperationError");
  assert(!calls.includes("catalogo_marcar_envio_payout_v2"),
    "Marcou tentativa antes de validar a chave protegida");
});

Deno.test("GET pendente não paga; GET success+accredited com prova confirma",async()=>{
  const {database,state,calls}=await fakeDatabase();
  state.status="aguardando_confirmacao";state.payout_id=POP;state.transacao_id=TOP;
  let returnedStatus="pending";
  const worker=options(async(url,init)=>{
    assert(url.endsWith("/"+POP+"/transactions/"+TOP),"GET por identificador trocado");
    assert(init.method==="GET","Consulta não foi GET");
    return responseJson({
      id:TOP,external_reference:"motoboy_"+SAQUE.replaceAll("-",""),
      status:returnedStatus,status_detail:returnedStatus==="success"?"accredited":"waiting",
      amount:{currency:"BRL",value:12.34},
    },200);
  });
  const a=await conciliarPayoutSandbox(INTENT,database,worker);
  assert(a.classificacao==="em_processamento" && !a.transferenciaConfirmada,
    "Payout pending creditado");
  assert(state.status==="aguardando_confirmacao","Pendente virou pago");
  returnedStatus="success";
  const b=await conciliarPayoutSandbox(INTENT,database,worker);
  assert(b.transferenciaConfirmada && state.status==="confirmado","Sucesso não conferido");
  assert(calls.filter(n=>n==="catalogo_conciliar_payout_v2").length===2,"GET não acionou RPC");
});

Deno.test("GET com valor, moeda, referência ou transação alterada nunca grava baixa",async()=>{
  const {database,state,calls}=await fakeDatabase();
  state.status="aguardando_confirmacao";state.payout_id=POP;state.transacao_id=TOP;
  const facts=[
    {currency:"USD",value:12.34,ref:"motoboy_"+SAQUE.replaceAll("-",""),id:TOP},
    {currency:"BRL",value:12.35,ref:"motoboy_"+SAQUE.replaceAll("-",""),id:TOP},
    {currency:"BRL",value:12.34,ref:"outro_pagamento",id:TOP},
    {currency:"BRL",value:12.34,ref:"motoboy_"+SAQUE.replaceAll("-",""),id:"TOP01KV681P6SJ38NQHWX3OTHER"},
  ];
  for(const fact of facts) {
    const worker=options(async()=>responseJson({
      id:fact.id,external_reference:fact.ref,status:"success",status_detail:"accredited",
      amount:{currency:fact.currency,value:fact.value},
    },200));
    await rejects(()=>conciliarPayoutSandbox(INTENT,database,worker),"divergente");
  }
  assert(!calls.includes("catalogo_conciliar_payout_v2"),"GET falso chegou à baixa SQL");
});
