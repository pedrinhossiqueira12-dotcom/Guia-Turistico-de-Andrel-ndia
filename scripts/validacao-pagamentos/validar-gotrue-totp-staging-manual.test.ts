/**
 * #42. Testes sem rede do contrato do operador. Nao conecta no STAGING.
 */
import {
 STAGING,TEST_ACCOUNT,fixedStagingUrl,inspectSmokeJwt,sameSessionAal2,
 fatorTotpConfirmadoNoUsuarioStaging,claimsAal2FrescasDoStaging,
 StagingMfaManual,
} from "./validar-gotrue-totp-staging-manual.ts";
const UID="aaaa1111-1111-4111-8111-111111111111";
const SID="bbbb2222-2222-4222-8222-222222222222";
const FACTOR="cccc3333-3333-4333-8333-333333333333";
const CHALLENGE="dddd4444-4444-4444-8444-444444444444";
function ok(cond:unknown,message:string){if(!cond)throw Error(message);}
function jwt(aal:"aal1"|"aal2",sess=SID,user=UID):string{
 const b64=(v:unknown)=>btoa(JSON.stringify(v)).replace(/\+/g,"-")
  .replace(/\//g,"_").replace(/=/g,"");
 const iat=Math.floor(Date.now()/1000);
 return b64({alg:"none",typ:"JWT"})+"."
  +b64({aal,sub:user,session_id:sess,role:"authenticated",is_anonymous:false,
   iss:STAGING+"/auth/v1",aud:"authenticated",iat,exp:iat+3600})
  +".fake-signature-only-for-offline-unit-test";
}
async function denied(fn:()=>unknown|Promise<unknown>):Promise<void>{
 let failed=false;
 try{await fn();}catch{failed=true;}
 ok(failed,"Entrada proibida foi aceita");
}
Deno.test("host fixo e somente cinco endpoints de autenticacao permitidos",async()=>{
 ok(fixedStagingUrl("/factors")===STAGING+"/auth/v1/factors","staging origin");
 ok(fixedStagingUrl("/token?grant_type=password").includes("/auth/v1/token"),
  "token route");
 for(const route of ["/rest/v1/rpc", "/functions/v1/catalogo-asaas-financeiro",
  "/factors/../../../admin","//user","/settings","/factors/"+FACTOR+"/delete"]){
  await denied(()=>fixedStagingUrl(route));
 }
 for(const host of ["https://xdmbkflufsfqziixzpxc.supabase.co",
  "http://jbttwihctuibchhcyqtl.supabase.co",
  "https://jbttwihctuibchhcyqtl.supabase.co.evil.org",
  "https://jbttwihctuibchhcyqtl.supabase.co:8443",
  "https://other@jbttwihctuibchhcyqtl.supabase.co"]){
  await denied(()=>fixedStagingUrl("/user",host));
 }
 ok(TEST_ACCOUNT.test("mfa-teste+andrelandia@example.com"),"valid test email");
 ok(!TEST_ACCOUNT.test("contato@empresa.com"),"production email must be denied");
});
Deno.test("AAL2 exige mesmo sub, session_id e usuario validado por Auth",()=>{
 const a=inspectSmokeJwt(jwt("aal1"));
 const b=inspectSmokeJwt(jwt("aal2"));
 ok(sameSessionAal2(a,b,{id:UID}),"valid step-up");
 ok(!sameSessionAal2(a,inspectSmokeJwt(jwt("aal2",crypto.randomUUID())),{id:UID}),
   "session substitution");
 ok(!sameSessionAal2(a,inspectSmokeJwt(jwt("aal2",SID,crypto.randomUUID())),{id:UID}),
   "user substitution");
 ok(!sameSessionAal2(a,b,{id:crypto.randomUUID()}),"GET /user mismatch");
 ok(!sameSessionAal2(a,{...b,role:"service_role"},{id:UID}),"elevated role");
 ok(!sameSessionAal2(a,{...b,aal:"aal1"},{id:UID}),"not stepup");
 ok(!sameSessionAal2({...a,is_anonymous:true},b,{id:UID}),"anonymous");
});
Deno.test("claims AAL2 antigas, expiradas ou de outro projeto nao validam smoke",()=>{
 const nowSec=2_000_000_000;
 const now=nowSec*1000;
 const validBase={iss:STAGING+"/auth/v1",aud:"authenticated",
  iat:nowSec-20,exp:nowSec+3600};
 const validAfter={...validBase,iat:nowSec-1};
 const good=()=>claimsAal2FrescasDoStaging(validBase,validAfter,now-10000,now);
 ok(good(),"new AAL2 from same GoTrue should be accepted for smoke");
 const failed=[
  [{...validBase,iss:"https://fake.supabase.co/auth/v1"},validAfter],
  [validBase,{...validAfter,iss:"https://fake.supabase.co/auth/v1"}],
  [validBase,{...validAfter,aud:"anon"}],
  [validBase,{...validAfter,iat:nowSec-400}],
  [validBase,{...validAfter,iat:nowSec+50}],
  [validBase,{...validAfter,exp:nowSec}],
  [validBase,{...validAfter,exp:nowSec-1}],
  [{...validBase,exp:nowSec-100},validAfter],
  [{...validBase,iat:nowSec+100},validAfter],
  [validBase,{...validAfter,iat:"fake"}],
  [validBase,{...validAfter,exp:null}],
 ];
 for(const [a,b] of failed){
  ok(!claimsAal2FrescasDoStaging(a,b,now-10000,now),
   "stale/broken AAL2 claims were accepted");
 }
 ok(!claimsAal2FrescasDoStaging(validBase,validAfter,now+5000,now),
   "future operation start accepted");
 ok(!claimsAal2FrescasDoStaging(validBase,validAfter,Number.NaN,now),
   "invalid terminal clock accepted");
});

Deno.test("fator TOTP escolhido precisa estar verificado na conta STAGING original",()=>{
 const email="mfa-teste+qa@example.com";
 const factor={id:FACTOR,factor_type:"totp",status:"verified"};
 const user={id:UID,email,factors:[factor]};
 ok(fatorTotpConfirmadoNoUsuarioStaging(user,UID,FACTOR,email),
   "fator verificado da mesma conta deveria passar");
 const foreignFactor={...factor,id:crypto.randomUUID()};
 const refused=[
  {...user,id:crypto.randomUUID()},
  {...user,email:"outro@example.com"},
  {...user,email:"mfa-teste+outro@example.com"},
  {...user,factors:[]},
  {...user,factors:undefined},
  {...user,factors:"forjado"},
  {...user,factors:[{...factor,status:"unverified"}]},
  {...user,factors:[{...factor,factor_type:"phone"}]},
  {...user,factors:[foreignFactor]},
  {...user,factors:[factor,factor]},
  {...user,factors:[null, {...factor,status:"unverified"}]},
 ];
 for(const candidato of refused){
  ok(!fatorTotpConfirmadoNoUsuarioStaging(candidato,UID,FACTOR,email),
   "GET /user inconsistente foi aceito: "+JSON.stringify(candidato));
 }
 ok(!fatorTotpConfirmadoNoUsuarioStaging(user,UID,FACTOR,"contato@real.com"),
   "conta nao dedicada foi aceita");
 ok(!fatorTotpConfirmadoNoUsuarioStaging(user,UID,crypto.randomUUID(),email),
   "factorId alheio foi aceito");
});

Deno.test("GoTrue STAGING falso end-to-end: AAL1 => enroll => challenge => AAL2, sem Pix",async()=>{
 const routes:string[]=[];
 let factorVerified=false;
 const http:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));
  ok(url.origin===STAGING && url.pathname.startsWith("/auth/v1/"),
    "test leaked request to external host");
  const method=init?.method??"GET";
  const path=url.pathname.replace("/auth/v1","")+url.search;
  routes.push(String(method)+" "+path);
  const body=init?.body?JSON.parse(String(init.body)):{};
  if(path==="/token?grant_type=password"){
   ok(body.email==="mfa-teste+qa@example.com"&&body.password==="test-only-password",
     "login payload mismatch");
   return Response.json({access_token:jwt("aal1")});
  }
  if(path==="/user")return Response.json({id:UID,email:"mfa-teste+qa@example.com",
   factors:factorVerified?[{id:FACTOR,factor_type:"totp",status:"verified"}]:[]});
  if(path==="/factors"&&method==="POST"){
   ok(body.factor_type==="totp","factor type changed");
   return Response.json({id:FACTOR,totp:{secret:"GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"}});
  }
  if(path==="/factors/"+FACTOR+"/challenge")return Response.json({id:CHALLENGE});
  if(path==="/factors/"+FACTOR+"/verify"){
   ok(body.challenge_id===CHALLENGE&&body.code==="123456","OTP challenge binding");
   factorVerified=true;
   return Response.json({access_token:jwt("aal2")});
  }
  throw Error("Unexpected Auth request");
 };
 const go=new StagingMfaManual("sb_publishable_ci_fake_limited_key",http);
 const before=await go.login("mfa-teste+qa@example.com","test-only-password");
 ok(inspectSmokeJwt(before).aal==="aal1","AAL1 fake missing");
 const factors=await go.factors(before);
 ok(factors.length===0,"unexpected factors");
 ok(!routes.some(x=>x==="GET /factors"),"unsupported GoTrue listFactors path requested");
 await denied(()=>go.call("GET","/factors",before));
 const enroll=await go.enroll(before);
 ok(enroll.id===FACTOR,"wrong factor id");
 const started=Date.now();
 const upgraded=await go.verify(before,enroll.id,"123456");
 ok(claimsAal2FrescasDoStaging(inspectSmokeJwt(before),inspectSmokeJwt(upgraded),
  started,Date.now()),"new JWT was not tied to verification window");
 const depois=await go.call("GET","/user",upgraded);
 ok(sameSessionAal2(inspectSmokeJwt(before),inspectSmokeJwt(upgraded),
  depois),"session mismatch");
 ok(fatorTotpConfirmadoNoUsuarioStaging(depois,UID,FACTOR,"mfa-teste+qa@example.com"),
  "fator verificado nao vinculado ao usuario original");
 ok(routes.join("|").includes("POST /factors/"+FACTOR+"/verify"),"no verify");
 ok(routes.every(x=>!/(payment|saque|pix|asaas|rpc|function|admin)/i.test(x)),
  "financial HTTP request");
 await denied(()=>go.login("comercio@real.com","test-only-password"));
 await denied(()=>go.verify(before,FACTOR,"1"));
 await denied(()=>new StagingMfaManual("sb_secret_admin_token",http));
});
Deno.test("manual pede OTP depois do challenge e usa apenas o ID emitido pelo Auth",async()=>{
 const events:string[]=[];
 const http:typeof fetch=async(input,init)=>{
  const endpoint=new URL(String(input)).pathname;
  if(endpoint==="/auth/v1/factors/"+FACTOR+"/challenge"){
   events.push("challenge");
   return Response.json({id:CHALLENGE});
  }
  if(endpoint==="/auth/v1/factors/"+FACTOR+"/verify"){
   events.push("verify");
   const body=JSON.parse(String(init?.body));
   ok(body.challenge_id===CHALLENGE && body.code==="123456",
    "verify was not bound to server challenge and typed OTP");
   return Response.json({access_token:jwt("aal2")});
  }
  throw Error("unexpected Auth request");
 };
 const auth=new StagingMfaManual("sb_publishable_ci_fake_limited_key",http);
 const jwt2=await auth.verifyComCodigoAposDesafio(jwt("aal1"),FACTOR,async()=>{
  events.push("prompt");
  ok(events.join(",")==="challenge,prompt","OTP requested before challenge");
  return "123456";
 });
 ok(inspectSmokeJwt(jwt2).aal==="aal2","no upgraded Auth token");
 ok(events.join(",")==="challenge,prompt,verify","challenge order was not enforced");
});
Deno.test("nao solicita OTP se desafio falha; nao verifica codigo invalido ou recusado",async()=>{
 let prompts=0,verifies=0;
 const key="sb_publishable_ci_fake_limited_key";
 const refused=new StagingMfaManual(key,async()=>Response.json({error:"blocked"},{status:403}));
 await denied(()=>refused.verifyComCodigoAposDesafio(jwt("aal1"),FACTOR,async()=>{
  prompts++;return "123456";
 }));
 ok(prompts===0,"prompt ran despite challenge refusal");
 const http:typeof fetch=async(input)=>{
  if(String(input).endsWith("/challenge"))return Response.json({id:CHALLENGE});
  if(String(input).endsWith("/verify")){verifies++;return Response.json({access_token:jwt("aal2")});}
  throw Error("unexpected Auth request");
 };
 const auth=new StagingMfaManual(key,http);
 await denied(()=>auth.verifyComCodigoAposDesafio(jwt("aal1"),FACTOR,async()=>{
  prompts++; return "short";
 }));
 ok(prompts===1 && verifies===0,"invalid OTP was sent for verification");
 await denied(()=>auth.verifyComCodigoAposDesafio(jwt("aal1"),FACTOR,async()=>{
  prompts++; throw Error("operador cancelou digitacao");
 }));
 ok(prompts===2 && verifies===0,"cancelled OTP was sent to GoTrue");
});
Deno.test("Auth nao aceita Content-Type texto nem HTML em respostas JSON",async()=>{
 const key="sb_publishable_ci_fake_limited_key";
 for(const contentType of ["text/plain","text/html","application/problem+json"]){
  const http:typeof fetch=async()=>new Response(JSON.stringify({id:UID,factors:[]}),{
   headers:{"content-type":contentType},
  });
  const auth=new StagingMfaManual(key,http);
  await denied(()=>auth.factors(jwt("aal1")));
 }
});

Deno.test("GoTrue resposta exagerada e erros HTTP nunca chegam ao contrato",async()=>{
 const key="sb_publishable_ci_fake_limited_key";
 const huge:typeof fetch=async()=>Response.json({totp:"x".repeat(70000)});
 const auth=new StagingMfaManual(key,huge);
 await denied(()=>auth.factors(jwt("aal1")));
 const reject:typeof fetch=async()=>Response.json({access_token:"sensitive-value"},
  {status:401});
 const auth2=new StagingMfaManual(key,reject);
 await denied(()=>auth2.login("mfa-teste+qa@example.com","test-only-password"));
});

Deno.test("factors usa /user e trata TOTP verificado, pendente e tipo alheio separadamente",async()=>{
 const payload={id:UID,factors:[
  {id:FACTOR,factor_type:"totp",status:"verified"},
  {id:crypto.randomUUID(),factor_type:"phone",status:"verified"},
  {id:crypto.randomUUID(),factor_type:"totp",status:"unverified"},
 ]};
 let requests=0;
 const transport:typeof fetch=async(input,init)=>{
  requests++;
  ok(String(input)===STAGING+"/auth/v1/user","factors must only use /user");
  ok(init?.method==="GET","GET user expected");
  return Response.json(payload);
 };
 const auth=new StagingMfaManual("sb_publishable_ci_fake_limited_key",transport);
 const factors=await auth.factors(jwt("aal1"));
 ok(factors.length===2,"must retain both verified and unverified TOTP");
 ok(factors[0].id===FACTOR && factors[0].status==="verified",
   "verified factor not returned");
 ok(factors[1].status==="unverified","pending factor ignored");
 ok(requests===1,"unnecessary network calls");
});
Deno.test("factors ausente em user usa [] e formato injetado ou id ausente falha fechado",async()=>{
 const key="sb_publishable_ci_fake_limited_key";
 const noFactors=new StagingMfaManual(key,async()=>Response.json({id:UID}));
 ok((await noFactors.factors(jwt("aal1"))).length===0,
   "optional user.factors should default empty");
 for(const reply of [
  {id:UID,factors:"forged"},
  {id:UID,factors:[{id:FACTOR,factor_type:"totp",status:"unknown"}]},
  {id:UID,factors:[{id:"not-uuid",factor_type:"totp",status:"verified"}]},
  {id:"bad-user",factors:[]},
 ]){
  const auth=new StagingMfaManual(key,async()=>Response.json(reply));
  await denied(()=>auth.factors(jwt("aal1")));
 }
});
