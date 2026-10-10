// #42: transport HTTP falsificado em memoria. CI executa com --deny-net.
import { GoTrueMfaTransporteInerte } from "../_shared/catalogo-asaas-gotrue-mfa-transporte-inerte.ts";
import { SimuladorStepUpDocumental, type SessaoAferidaEmEnsaio } from "../_shared/catalogo-asaas-stepup-documental-ensaio.ts";

const PROJECT = "https://abcdefghijklmnopqrst.supabase.co";
const KEY = "sb_publishable_fake_ci_no_secrets";
const UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_SID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FACTOR = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CHALLENGE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const NONCE = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const ESCROW = "12121212-1212-4212-8212-121212121212";
const BEFORE = "before-token";
const AFTER = "after-token";
const NOW = 1810000000000;

function assert(v: unknown, message: string): asserts v {
  if (!v) throw new Error(message);
}
function principal(token: string): SessaoAferidaEmEnsaio | null {
  if (token !== BEFORE && token !== AFTER) return null;
  return {
    userId: UID, sessionId: SID, role: "authenticated",
    factorId: token === AFTER ? FACTOR : null, aal: token === AFTER ? "aal2" : "aal1",
    anonymous: false,
  };
}
function fakeServer(opts: {
  differentUser?: boolean;
  mismatchSession?: boolean;
  rejectVerify?: boolean;
  malformedChallenge?: boolean;
  noAccessToken?: boolean;
  rejectUser?: boolean;
  wrongContentType?: boolean;
} = {}) {
  const calls: {url: string; init: RequestInit}[] = [];
  const http: typeof fetch = async (input, init) => {
    const url = String(input);
    const req = init ?? {};
    calls.push({url,init:req});
    assert(url.startsWith(PROJECT + "/auth/v1/"),"outbound host mismatch");
    assert(req.redirect === "error","redirect permitted");
    assert(req.credentials === "omit","credential leakage");
    const body = JSON.parse(String(req.body ?? "{}"));
    const ct = opts.wrongContentType ? "text/plain" : "application/json";
    let status = 200;
    let response: Record<string, unknown> = {};
    if (url.endsWith("/user")) {
      response = {id: opts.differentUser ? ESCROW : UID};
      if (opts.rejectUser) status = 401;
    } else if (url.endsWith("/challenge")) {
      response = {id: opts.malformedChallenge ? "invalid" : CHALLENGE};
    } else if (url.endsWith("/verify")) {
      assert(body.challenge_id === CHALLENGE,"Client replaced challenge ID");
      assert(body.code === "123456","OTP switched");
      response = opts.noAccessToken
        ? {refresh_token:"SHOULD_NEVER_LEAK"}
        : {access_token:AFTER,refresh_token:"SHOULD_NEVER_LEAK"};
      if (opts.rejectVerify) status=403;
    } else throw new Error("unknown GoTrue route");
    return new Response(JSON.stringify(response),{
      status,headers:{"content-type":ct},
    });
  };
  return {http,calls};
}
function adapter(
  opts: Parameters<typeof fakeServer>[0]={},
  override: ((token:string)=>Promise<SessaoAferidaEmEnsaio|null>) | null = null,
) {
  const {http,calls}=fakeServer(opts);
  const sdk = new GoTrueMfaTransporteInerte({
    projectUrl: PROJECT,publishableKey:KEY,http,
    verificarAssinaturaJwtESessaoNoServidor: override ?? (async (token)=>principal(token)),
    verificarFatorTotpAal1NoServidor: async ({userId,sessionId,factorId})=>
      userId===UID && sessionId===SID && factorId===FACTOR,
  });
  return {sdk,calls};
}
function makeIntent() {
  return {
    nonce: NONCE, userId: UID, sessionId: SID, factorId: FACTOR,
    separationId: ESCROW, evidenceHash: "a".repeat(64),
    purpose: "consulta_documental_ensaio" as const,
    expiresAt: NOW+300000, consumed:false,
  };
}
function assertHold(res: Record<string, unknown>) {
  for (const flag of ["desafio_mfa_real_comprovado","parecer_financeiro_autorizado",
    "pagamento_autorizado","liberacao_autorizada","baixa_realizada","movimenta_dinheiro"]) {
    assert(res[flag] === false, "Unexpected FINANCIAL permission "+flag);
  }
  assert(res.status_operacional === "HOLD_OBRIGATORIO","HOLD removed");
}

Deno.test("GoTrue REST: challenge, verify e revalidacao do novo access token SEM movimentar dinheiro",async()=>{
 const {sdk,calls}=adapter();
 const protocol = new SimuladorStepUpDocumental(sdk,()=>NOW,"isolated-ci");
 const created=await protocol.iniciar(makeIntent(),BEFORE);
 assert(created.ok && created.tentativa,"no challenge ID returned to mock protocol");
 assertHold(created);
 const verified=await protocol.confirmar(created.tentativa!,BEFORE,"123456");
 assert(verified.ok && verified.protocolo_mock_validado,"not verified by FAKE test server");
 assertHold(verified);
 assert(calls.filter(c=>c.url.endsWith("/user")).length === 3,"missing server authenticated getUser");
 assert(calls.some(c=>c.url.endsWith("/factors/"+FACTOR+"/challenge")),"wrong challenge endpoint");
 assert(calls.some(c=>c.url.endsWith("/factors/"+FACTOR+"/verify")),"wrong verify endpoint");
 const v=calls.find(c=>c.url.endsWith("/verify"))!;
 assert(JSON.parse(String(v.init.body)).challenge_id===CHALLENGE,"challenge not bound server-side");
 assert(v.init.headers && (v.init.headers as Record<string,string>).apikey===KEY,"publishable key missing");
 assert((v.init.headers as Record<string,string>).Authorization==="Bearer "+BEFORE,"wrong user's token");
 assert(!JSON.stringify(verified).includes("SHOULD_NEVER_LEAK"),"refresh token leaked");
 const retry=await protocol.confirmar(created.tentativa!,BEFORE,"123456");
 assert(!retry.ok,"replay of MFA allowed");assertHold(retry);
});

Deno.test("servidor que nao valida assinatura/sessao nao pode iniciar HTTP challenge",async()=>{
 const {sdk,calls}=adapter({},async()=>null);
 const out=await new SimuladorStepUpDocumental(sdk,()=>NOW,"isolated-ci").iniciar(makeIntent(),BEFORE);
 assert(!out.ok && calls.length===0,"unauthenticated token reached GoTrue");
 assertHold(out);
});

Deno.test("mudanca de sessao depois do verify impede associar challenge a operacao",async()=>{
 const {sdk}=adapter({},async token=>token===AFTER
   ? {...principal(AFTER)!,sessionId:OTHER_SID} : principal(token));
 const flow=new SimuladorStepUpDocumental(sdk,()=>NOW,"isolated-ci");
 const opened=await flow.iniciar(makeIntent(),BEFORE);
 const result=await flow.confirmar(opened.tentativa!,BEFORE,"123456");
 assert(!result.ok && result.motivo==="resposta_auth_sem_mesma_sessao_aal2","session mixup passed");
 assertHold(result);
});

Deno.test("GET /user deve concordar com uid retornado pelo verificador de sessao",async()=>{
 const {sdk,calls}=adapter({differentUser:true});
 const out=await new SimuladorStepUpDocumental(sdk,()=>NOW,"isolated-ci").iniciar(makeIntent(),BEFORE);
 assert(!out.ok&&calls.length===1,"GoTrue user mismatch permitted challenge");
 assertHold(out);
});

Deno.test("dominios e publishable key inseguros sao recusados antes de qualquer request",()=>{
 const {http}=fakeServer();
 for(const host of [
  "http://abcdefghijklmnopqrst.supabase.co",
  "https://abcdefghijklmnopqrst.supabase.co.attacker.com",
  "https://u:p@abcdefghijklmnopqrst.supabase.co",
  "https://abcdefghijklmnopqrst.supabase.co:8443",
  "https://abcdefghijklmnopqrst.supabase.co/not-auth",
 ]) {
   let failed=false;
   try {new GoTrueMfaTransporteInerte({projectUrl:host,publishableKey:KEY,http,
      verificarAssinaturaJwtESessaoNoServidor:async t=>principal(t)})}
   catch{failed=true}
   assert(failed,"host invalid passed "+host);
 }
 let failed=false;
 try{new GoTrueMfaTransporteInerte({projectUrl:PROJECT,publishableKey:"service_role_key",http,
   verificarAssinaturaJwtESessaoNoServidor:async t=>principal(t)})}catch{failed=true}
 assert(failed,"service-role style key accepted");
});

Deno.test("erro do Auth, JSON nao confiavel e challenge malformado encerram sem autorizacao",async()=>{
 for(const opts of [
  {rejectUser:true},{wrongContentType:true},{malformedChallenge:true},
  {rejectVerify:true},{noAccessToken:true},
 ]) {
   const {sdk}=adapter(opts);
   const flow=new SimuladorStepUpDocumental(sdk,()=>NOW,"isolated-ci");
   const opened=await flow.iniciar(makeIntent(),BEFORE);
   const result=opened.ok ? await flow.confirmar(opened.tentativa!,BEFORE,"123456") : opened;
   assert(!result.ok,"failed GoTrue response accepted "+JSON.stringify(opts));assertHold(result);
 }
});

Deno.test("nunca enviar OTP malformado, bearer com quebra de linha nem factor ID invalido",async()=>{
 const {sdk,calls}=adapter();
 let bad=false;try{await sdk.criarDesafio({bearerToken:BEFORE,factorId:"invalid-factor"})}catch{bad=true}
 assert(bad && calls.length===0,"bad factor sent request");
 bad=false;try{await sdk.criarDesafio({bearerToken:"before\nBearer evil",factorId:FACTOR})}catch{bad=true}
 assert(bad && calls.length===0,"header CRLF accepted");
 bad=false;try{await sdk.verificarDesafio({bearerToken:BEFORE,factorId:FACTOR,
   challengeId:CHALLENGE,otp:"12a456"})}catch{bad=true}
 assert(bad && calls.length===0,"bad OTP sent to auth");
});
