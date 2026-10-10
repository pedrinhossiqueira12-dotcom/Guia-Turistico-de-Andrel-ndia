// #42 — JWKS de projeto pinado: zero rede, sem segredo, testes offline.
// O HTTP e explicitamente injetado e gera um Response local.
import { ResolvedorJwksPinadoInerte } from "../_shared/catalogo-asaas-jwks-fixo-cache-inerte.ts";
import { ValidadorJwtSessaoInerte } from "../_shared/catalogo-asaas-jwt-sessao-assinada-ensaio.ts";
const REF="abcdefghijklmnopqrst",PROJECT="https://"+REF+".supabase.co";
const SESSION="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FACTOR="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW=1810000000000;
type PublicKey = JsonWebKey & {kid?:string};
function ok(v:unknown,m:string):asserts v{if(!v)throw new Error(m)}
async function keypair(kid="ci-pinned-es256"){
 const kp=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
 const publicKey={...await crypto.subtle.exportKey("jwk",kp.publicKey),kid,
   use:"sig",alg:"ES256"} as PublicKey;
 return {publicKey,privateKey:kp.privateKey};
}
const bytes=(s:string)=>new TextEncoder().encode(s);
function b64(b:Uint8Array){
 return btoa(String.fromCharCode(...b)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
}
async function jwt(privateKey:CryptoKey,kid:string){
 const header=b64(bytes(JSON.stringify({alg:"ES256",typ:"JWT",kid})));
 const payload=b64(bytes(JSON.stringify({
  iss:PROJECT+"/auth/v1",aud:"authenticated",role:"authenticated",
  aal:"aal2",is_anonymous:false,sub:USER,session_id:SESSION,
  iat:Math.floor(NOW/1000)-20,exp:Math.floor(NOW/1000)+600
 })));
 const signed=header+"."+payload;
 const sig=await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},privateKey,bytes(signed));
 return signed+"."+b64(new Uint8Array(sig));
}
function fake(options:{
  keys?:PublicKey[], fail?:boolean, onCall?:()=>void,
  oversized?:boolean, wrongContentType?:boolean, code?:number,
  payload?:unknown
 }={}){
 const calls:{url:string,init:RequestInit}[]=[];
 const http:typeof fetch=async(url,init)=>{
  calls.push({url:String(url),init:init??{}});
  options.onCall?.();
  if(options.fail)throw new Error("offline fetch failed");
  const payload=options.payload??{keys:options.keys??[]};
  return new Response(options.oversized?"x".repeat(32769):JSON.stringify(payload),{
    status:options.code??200,headers:{"content-type":options.wrongContentType?"text/html":"application/json"}
  });
 };
 return {http,calls};
}
function instance(http:typeof fetch, clock:()=>number=()=>NOW, ttlSegundos=30){
 const lookup={count:0};
 const p=new ResolvedorJwksPinadoInerte({
  projectUrl:PROJECT,projectRef:REF,buscarHttp:http,ttlSegundos,
  agoraMs:clock,
  async consultarSessaoEFator(id){
    lookup.count++;
    ok(id===SESSION,"bad signed session ID");
    return {id:SESSION,userId:USER,aal:"aal2",factorId:FACTOR,
      factorType:"totp",factorStatus:"verified",
      factorUserId:USER,notAfterMs:NOW+900000};
  },
 });
 return {p,lookup};
}
Deno.test("JWKS pinado: HTTPS, path fixo, sem redirect/cookies e cache novo",async()=>{
 const kp=await keypair(),{http,calls}=fake({keys:[kp.publicKey]});
 const {p}=instance(http);
 const a=await p.buscarJwksConfiavel(),b=await p.buscarJwksConfiavel();
 ok(a.keys.length===1 && b.keys.length===1 && calls.length===1,"cache missed");
 ok(calls[0].url===PROJECT+"/auth/v1/.well-known/jwks.json","remote URL altered");
 ok(calls[0].init.redirect==="error" && calls[0].init.credentials==="omit"
   && calls[0].init.cache==="no-store","unsafe fetch policy");
});

Deno.test("JWT real aceita ES256 so com chave de origem pinada e sessao ativa",async()=>{
 const kp=await keypair(),fetcher=fake({keys:[kp.publicKey]});
 const {p,lookup}=instance(fetcher.http);
 const verifier=new ValidadorJwtSessaoInerte({
   projectUrl:PROJECT,maxIdadeTokenSegundos:300,agoraMs:()=>NOW,provedor:p});
 const result=await verifier.verificar(await jwt(kp.privateKey,kp.publicKey.kid!));
 ok(result?.userId===USER && result.sessionId===SESSION,"JWT signed rejected");
 ok(lookup.count===1,"Auth session never confirmed");
 ok(fetcher.calls.length===1,"duplicate JWKS request");
});

Deno.test("TTL expira sem stale: chave antiga revogada falha apos rotacao de JWKS",async()=>{
 const old=await keypair("old-ci"),newer=await keypair("new-ci");
 let clock=NOW,current=[old.publicKey],networkOk=true;
 const {http,calls}=fake({onCall:()=>{}});
 const fromNetwork:typeof fetch=async(url,init)=>{
  if(!networkOk)throw new Error("JWKS offline");
  return Response.json({keys:current});
 };
 const {p}=instance(fromNetwork,()=>clock,5);
 const verifier=new ValidadorJwtSessaoInerte({
  projectUrl:PROJECT,agoraMs:()=>clock,maxIdadeTokenSegundos:300,provedor:p
 });
 const oldJwt=await jwt(old.privateKey,"old-ci");
 const newJwt=await jwt(newer.privateKey,"new-ci");
 ok(await verifier.verificar(oldJwt)!==null,"initial key rejected");
 clock+=5010;current=[newer.publicKey];
 ok(await verifier.verificar(oldJwt)===null,"revoked old key still trusted");
 ok(await verifier.verificar(newJwt)!==null,"rotated new key rejected");
 clock+=5010;networkOk=false;
 ok(await verifier.verificar(newJwt)===null,"stale JWKS served during outage");
 ok(calls.length===0,"unused test fetch unexpectedly hit");
});

Deno.test("duas consultas simultaneas aguardam uma unica busca de JWKS",async()=>{
 const kp=await keypair();let calls=0;let release!:()=>void;
 const gate=new Promise<void>(r=>release=r);
 const http:typeof fetch=async()=>{
  calls++;
  await gate;
  return Response.json({keys:[kp.publicKey]});
 };
 const {p}=instance(http);
 const a=p.buscarJwksConfiavel(),b=p.buscarJwksConfiavel();
 ok(calls===1,"JWKS double fetch before first await");
 release();
 const [x,y]=await Promise.all([a,b]);
 ok(x.keys.length===1&&y.keys.length===1&&calls===1,"JWKS fetch duplicated");
});

Deno.test("nenhum dominio ou URL diferente de projectRef pinado",async()=>{
 const {http}=fake();
 for(const url of [
  "http://"+REF+".supabase.co",
  "https://"+REF+".supabase.co.attacker.example",
  "https://u:p@"+REF+".supabase.co",
  "https://"+REF+".supabase.co:4443",
  "https://"+REF+".supabase.co/auth/v1",
  "https://otherotherotherother.supabase.co"
 ]) {
  let blocked=false;
  try{new ResolvedorJwksPinadoInerte({
   projectRef:REF,projectUrl:url,buscarHttp:http,agoraMs:()=>NOW,
   ttlSegundos:30,consultarSessaoEFator:async()=>null
  })}catch{blocked=true}
  ok(blocked,"SSRF-like origin accepted: "+url);
 }
});

Deno.test("chaves privadas/simetricas, kid duplicado ou ausente nunca sao confiadas",async()=>{
 const k=await keypair();
 for(const keys of [
  [],[k.publicKey,k.publicKey],
  [{...k.publicKey,d:"secret"}],[{...k.publicKey,k:"secret"}],
  [{...k.publicKey,kid:undefined}],
  [{...k.publicKey,alg:"HS256"}],
  [{...k.publicKey,key_ops:["sign"]}],
  [{...k.publicKey,use:"enc"}],
  [{...k.publicKey,x:"invalid!"}],
 ]) {
  const {p}=instance(fake({keys:keys as PublicKey[]}).http);
  let rejected=false;
  try{await p.buscarJwksConfiavel()}catch{rejected=true}
  ok(rejected,"unsafe JWKS trusted: "+JSON.stringify(keys).slice(0,140));
 }
});

Deno.test("resposta HTTP invalida, nao-JSON, tamanho excessivo, timeout, sem stale",async()=>{
 const kp=await keypair();
 for(const opts of [
  {fail:true},{code:503},{wrongContentType:true},{oversized:true},
  {payload:{keys:[kp.publicKey],extra:true}}, // formato segue permitido
  {payload:"invalid"}
 ]) {
  if ("payload" in opts && typeof opts.payload==="object")continue;
  const {p}=instance(fake({...opts,keys:[kp.publicKey]}).http);
  let rejected=false;
  try{await p.buscarJwksConfiavel()}catch{rejected=true}
  ok(rejected,"untrusted HTTP accepted");
 }
});

Deno.test("cache devolve copia imutavel semanticamente para impedir alteracao do chamador",async()=>{
 const kp=await keypair(),{http}=fake({keys:[kp.publicKey]});
 const {p}=instance(http);
 const a=await p.buscarJwksConfiavel();
 a.keys[0].alg="HS256";
 const b=await p.buscarJwksConfiavel();
 ok(b.keys[0].alg==="ES256","client mutated cached signing algorithm");
});

Deno.test("relogio retrocedendo nao pode estender vida de JWKS em cache",async()=>{
 const kp=await keypair();
 let now=NOW;const {http}=fake({keys:[kp.publicKey]});
 const {p}=instance(http,()=>now,30);
 ok((await p.buscarJwksConfiavel()).keys.length===1,"cache first issue failed");
 now-=1000;
 let failed=false;
 try{await p.buscarJwksConfiavel()}catch{failed=true}
 ok(failed,"JWKS cache accepted clock rollback");
});

Deno.test("key_ops e arrays da copia do cliente nao adulteram cache privado",async()=>{
 const kp=await keypair();
 const key={...kp.publicKey,key_ops:["verify"]} as PublicKey;
 const {p}=instance(fake({keys:[key]}).http);
 const original=await p.buscarJwksConfiavel();
 original.keys[0].key_ops?.push("sign");
 const another=await p.buscarJwksConfiavel();
 ok(JSON.stringify(another.keys[0].key_ops)==='["verify"]',
  "client changed nested JWKS cache arrays");
});
