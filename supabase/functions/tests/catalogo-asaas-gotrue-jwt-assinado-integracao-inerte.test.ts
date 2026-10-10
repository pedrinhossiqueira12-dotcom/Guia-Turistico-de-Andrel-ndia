/**
 * #42: integração CRIPTOGRÁFICA real dentro da CI, Auth fake.
 * GoTrue fetch injetado nunca alcança rede, chaves geradas em memória,
 * consulta auth.sessions falsa e nenhuma permissão para Pix.
 */
import { ValidadorJwtSessaoInerte } from "../_shared/catalogo-asaas-jwt-sessao-assinada-ensaio.ts";
import { GoTrueMfaTransporteInerte } from "../_shared/catalogo-asaas-gotrue-mfa-transporte-inerte.ts";
import { SimuladorStepUpDocumental } from "../_shared/catalogo-asaas-stepup-documental-ensaio.ts";
const PROJECT="https://abcdefghijklmnopqrst.supabase.co";
const UID="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SID="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FACTOR="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CHALLENGE="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const NONCE="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ESCROW="ffffffff-ffff-4fff-8fff-ffffffffffff";
const NOW=1810000000000;
function assert(v:unknown,message:string):asserts v{if(!v)throw new Error(message)}
function b64(bytes:Uint8Array):string{
 return btoa(String.fromCharCode(...bytes))
   .replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
}
async function prepareCrypto(revokeAfterVerify=false,corruptJwks=false){
 const keys=await crypto.subtle.generateKey({
   name:"ECDSA",namedCurve:"P-256",
 },true,["sign","verify"]);
 const kid="ci-integration-p256";
 const jwk:JsonWebKey = {
   ...await crypto.subtle.exportKey("jwk",keys.publicKey),
   alg:"ES256",kid,use:"sig",
 } as JsonWebKey;
 const claims=(iat:number)=>({
   iss:PROJECT+"/auth/v1",aud:"authenticated",role:"authenticated",
   sub:UID,session_id:SID,aal:"aal2",is_anonymous:false,
   iat,exp:Math.floor(NOW/1000)+600,
 });
 async function signed(iat:number){
   const header=b64(new TextEncoder().encode(JSON.stringify({alg:"ES256",kid,typ:"JWT"})));
   const payload=b64(new TextEncoder().encode(JSON.stringify(claims(iat))));
   const data=header+"."+payload;
   const sig=new Uint8Array(await crypto.subtle.sign(
     {name:"ECDSA",hash:"SHA-256"},keys.privateKey,new TextEncoder().encode(data)));
   return data+"."+b64(sig);
 }
 const before=await signed(Math.floor(NOW/1000)-30);
 const after=await signed(Math.floor(NOW/1000)-10);
 let revoked=false;
 const audit={jwks:0,lookups:0,getUser:0,challenge:0,verify:0};
 const signedSession = new ValidadorJwtSessaoInerte({
   projectUrl:PROJECT,agoraMs:()=>NOW,maxIdadeTokenSegundos:300,
   provedor:{
     async buscarJwksConfiavel(){
       audit.jwks++;
       return {keys:corruptJwks?[]:[jwk]};
     },
     async consultarSessaoEFator(sessionId:string){
       audit.lookups++;
       assert(sessionId===SID,"unexpected session lookup");
       return revoked?null:{
         id:SID,userId:UID,aal:"aal2" as const,factorId:FACTOR,
         notAfterMs:NOW+180000,factorUserId:UID,
         factorType:"totp",factorStatus:"verified"
       };
     }
   }
 });
 const http:typeof fetch=async(input,init)=>{
   const url=String(input);
   assert(url.startsWith(PROJECT+"/auth/v1/"),"unexpected host");
   assert(init?.redirect==="error","redirect allowed");
   const body=JSON.parse(String(init?.body??"{}"));
   if(url.endsWith("/user")){
     audit.getUser++;
     return Response.json({id:UID});
   }
   if(url.endsWith("/challenge")){
     audit.challenge++;
     return Response.json({id:CHALLENGE});
   }
   if(url.endsWith("/verify")){
     audit.verify++;
     assert(body.challenge_id===CHALLENGE && body.code==="123456","unbound challenge");
     if(revokeAfterVerify)revoked=true;
     return Response.json({access_token:after,refresh_token:"NEVER_RETURN"});
   }
   throw new Error("Unexpected Auth URL");
 };
 const transport=new GoTrueMfaTransporteInerte({
   projectUrl:PROJECT,publishableKey:"sb_publishable_fake_ci_only",
   http,
   verificarAssinaturaJwtESessaoNoServidor:t=>signedSession.verificar(t),
 });
 const simulator=new SimuladorStepUpDocumental(transport,()=>NOW,"isolated-ci");
 const intent={
  nonce:NONCE,userId:UID,sessionId:SID,factorId:FACTOR,
  separationId:ESCROW,purpose:"consulta_documental_ensaio" as const,
  evidenceHash:"b".repeat(64),expiresAt:NOW+300000,consumed:false,
 };
 return {before,after,simulator,intent,audit,signedSession};
}
function hold(result:Record<string,unknown>){
 for(const k of ["desafio_mfa_real_comprovado","pagamento_autorizado",
  "parecer_financeiro_autorizado","liberacao_autorizada","baixa_realizada",
  "movimenta_dinheiro"])assert(result[k]===false,"money unexpectedly allowed: "+k);
 assert(result.status_operacional==="HOLD_OBRIGATORIO","HOLD removed");
}
Deno.test("WebCrypto ES256 real + Auth HTTP fake + sessao PG fake mantem HOLD",async()=>{
 const {before,simulator,intent,audit}=await prepareCrypto();
 const begun=await simulator.iniciar(intent,before);
 assert(begun.ok&&begun.tentativa,"signed begin blocked in mock");
 hold(begun);
 const confirmed=await simulator.confirmar(begun.tentativa,before,"123456");
 assert(confirmed.ok && confirmed.protocolo_mock_validado,"signed verify mock blocked");
 hold(confirmed);
 assert(audit.challenge===1&&audit.verify===1&&audit.getUser===3,"Auth fake flow incomplete");
 assert(audit.jwks===3&&audit.lookups===3,"each bearer not cryptographically verified");
 const replay=await simulator.confirmar(begun.tentativa,before,"123456");
 assert(!replay.ok&&audit.verify===1,"replay reached GoTrue fake");
 hold(replay);
});
Deno.test("revogacao de sessao apos verificar MFA impede qualquer prova de operacao",async()=>{
 const {before,simulator,intent,audit}=await prepareCrypto(true);
 const begun=await simulator.iniciar(intent,before);
 assert(begun.ok&&begun.tentativa,"begin failed");
 const result=await simulator.confirmar(begun.tentativa,before,"123456");
 assert(!result.ok&&result.motivo==="resposta_auth_sem_mesma_sessao_aal2",
  "revoked post-verify session unexpectedly accepted");
 hold(result);
 assert(audit.verify===1&&audit.lookups===3,"revocation not checked");
});
Deno.test("chave publica nao confiavel nega antes de qualquer requisicao Auth",async()=>{
 const {before,simulator,intent,audit}=await prepareCrypto(false,true);
 const begun=await simulator.iniciar(intent,before);
 assert(!begun.ok&&begun.motivo==="sessao_ou_fator_divergente",
  "untrusted JWKS accepted");
 hold(begun);
 assert(audit.getUser===0&&audit.challenge===0&&audit.verify===0&&audit.lookups===0,
  "network or DB consulted on bad signature");
});
