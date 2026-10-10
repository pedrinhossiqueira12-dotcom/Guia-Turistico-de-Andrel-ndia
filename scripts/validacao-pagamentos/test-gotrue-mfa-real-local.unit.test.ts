// RFC 6238 + negative inputs. Offline WebCrypto; no GoTrue, no DB, no net.
import {totp} from "./test-gotrue-mfa-real-local.ts";
function eq(a:unknown,b:unknown,m:string){if(a!==b)throw Error(m);}
Deno.test("TOTP HMAC-SHA1 bate vetores publicos RFC 6238 em 6 e 8 digitos",async()=>{
 const key="GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // RFC-only, nao senha local
 for(const [seconds,expected] of [
   [59,"94287082"],[1111111109,"07081804"],[1111111111,"14050471"],
   [1234567890,"89005924"],[2000000000,"69279037"]
 ] as const){
   eq(await totp(key,seconds*1000,8),expected,"RFC TOTP 8 at "+seconds);
   eq(await totp(key,seconds*1000,6),expected.slice(-6),"RFC TOTP 6 at "+seconds);
 }
});
Deno.test("recusa relogio negativo, Base32 invalido e digitos nao permitidos",async()=>{
 for(const [secret,time,digits] of [
   ["abc!def",59000,6],["A",59000,6],
   ["GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",-1,6],
   ["GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",NaN,6],
   ["GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",59000,9],
 ] as const){
   let rejected=false;
   try{await totp(secret,time,digits);}catch{rejected=true;}
   eq(rejected,true,"invalid TOTP input unexpectedly accepted");
 }
});
