/**
 * #42. Testes sem rede do contrato do operador. Nao conecta no STAGING.
 */
import {
 STAGING,TEST_ACCOUNT,fixedStagingUrl,inspectSmokeJwt,sameSessionAal2,
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
 return b64({alg:"none",typ:"JWT"})+"."
  +b64({aal,sub:user,session_id:sess,role:"authenticated",is_anonymous:false})
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
Deno.test("GoTrue STAGING falso end-to-end: AAL1 => enroll => challenge => AAL2, sem Pix",async()=>{
 const routes:string[]=[];
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
  if(path==="/user")return Response.json({id:UID});
  if(path==="/factors"&&method==="GET")return Response.json({totp:[]});
  if(path==="/factors"&&method==="POST"){
   ok(body.factor_type==="totp","factor type changed");
   return Response.json({id:FACTOR,totp:{secret:"GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"}});
  }
  if(path==="/factors/"+FACTOR+"/challenge")return Response.json({id:CHALLENGE});
  if(path==="/factors/"+FACTOR+"/verify"){
   ok(body.challenge_id===CHALLENGE&&body.code==="123456","OTP challenge binding");
   return Response.json({access_token:jwt("aal2")});
  }
  throw Error("Unexpected Auth request");
 };
 const go=new StagingMfaManual("sb_publishable_ci_fake_limited_key",http);
 const before=await go.login("mfa-teste+qa@example.com","test-only-password");
 ok(inspectSmokeJwt(before).aal==="aal1","AAL1 fake missing");
 const factors=await go.factors(before);
 ok(factors.length===0,"unexpected factors");
 const enroll=await go.enroll(before);
 ok(enroll.id===FACTOR,"wrong factor id");
 const upgraded=await go.verify(before,enroll.id,"123456");
 ok(sameSessionAal2(inspectSmokeJwt(before),inspectSmokeJwt(upgraded),
  await go.call("GET","/user",upgraded)),"session mismatch");
 ok(routes.join("|").includes("POST /factors/"+FACTOR+"/verify"),"no verify");
 ok(routes.every(x=>!/(payment|saque|pix|asaas|rpc|function|admin)/i.test(x)),
  "financial HTTP request");
 await denied(()=>go.login("comercio@real.com","test-only-password"));
 await denied(()=>go.verify(before,FACTOR,"1"));
 await denied(()=>new StagingMfaManual("sb_secret_admin_token",http));
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
