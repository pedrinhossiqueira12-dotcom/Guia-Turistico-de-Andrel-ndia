// #42: assinaturas REALMENTE verificadas via WebCrypto no Deno local;
// chaves, tokens, sessoes e JWKS completamente gerados em memoria na CI.
// Nao usar Supabase real, rede, service role ou usuario existente.
import {
  ValidadorJwtSessaoInerte,
  type AuthSessaoConsultada,
  type ProvedorIdentidadeAssinadaInerte,
} from "../_shared/catalogo-asaas-jwt-sessao-assinada-ensaio.ts";
const PROJECT = "https://abcdefghijklmnopqrst.supabase.co";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FACTOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = 1_810_000_000_000;
const NOW_S = Math.floor(NOW/1000);
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function b64(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
}
function utf(s: string) { return new TextEncoder().encode(s); }
type Algorithm = "ES256" | "RS256";
type Fixture = {
  alg: Algorithm;
  kid: string;
  privateKey: CryptoKey;
  publicJwk: JsonWebKey;
};
async function fixture(alg: Algorithm): Promise<Fixture> {
  const kid="ci-asymmetric-"+alg.toLowerCase();
  const generated=alg==="ES256"
    ? await crypto.subtle.generateKey({
        name:"ECDSA",namedCurve:"P-256"
      },true,["sign","verify"])
    : await crypto.subtle.generateKey({
        name:"RSASSA-PKCS1-v1_5",modulusLength:2048,
        publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"
      },true,["sign","verify"]);
  const publicJwk = {
    ...await crypto.subtle.exportKey("jwk",generated.publicKey),
    kid,alg,use:"sig",
  };
  return {alg,kid,privateKey:generated.privateKey,publicJwk};
}
function baseClaims() {
  return {
    iss:PROJECT+"/auth/v1",
    aud:"authenticated", role:"authenticated",
    sub:USER,session_id:SESSION,aal:"aal2",
    is_anonymous:false,
    iat:NOW_S-10,exp:NOW_S+900,nbf:NOW_S-10,
    user_metadata:{roles:["financial_admin"]},
  };
}
async function tokenSign(
 f: Fixture,
 overrides: Record<string,unknown> = {},
 headerOverrides:Record<string,unknown> = {},
): Promise<string> {
  const header={typ:"JWT",alg:f.alg,kid:f.kid,...headerOverrides};
  const payload={...baseClaims(),...overrides};
  const head=b64(utf(JSON.stringify(header)));
  const claim=b64(utf(JSON.stringify(payload)));
  const input=head+"."+claim;
  const sig=await crypto.subtle.sign(
    f.alg==="ES256" ? {name:"ECDSA",hash:"SHA-256"}
      : {name:"RSASSA-PKCS1-v1_5"},
    f.privateKey,utf(input),
  );
  return input+"."+b64(new Uint8Array(sig));
}
function row(): AuthSessaoConsultada {
 return {
   id:SESSION,userId:USER,aal:"aal2",factorId:FACTOR,
   notAfterMs:NOW+600000,factorUserId:USER,
   factorType:"totp",factorStatus:"verified",
 };
}
function makeVerifier(
 publicKeys:JsonWebKey[],
 read:AuthSessaoConsultada|null = row(),
 options:{jwksError?:boolean; dbError?:boolean; clock?:number} = {},
) {
  const requests = {jwks:0,sessions:0};
  const provider:ProvedorIdentidadeAssinadaInerte = {
    async buscarJwksConfiavel() {
      requests.jwks++;
      if(options.jwksError)throw new Error("JWKS offline");
      return {keys:publicKeys};
    },
    async consultarSessaoEFator(id:string) {
      requests.sessions++;
      assert(id === SESSION,"unsafe session id reached database");
      if(options.dbError)throw new Error("db offline");
      return read;
    }
  };
  const verifier=new ValidadorJwtSessaoInerte({
    projectUrl:PROJECT,agoraMs:()=>options.clock??NOW,
    maxIdadeTokenSegundos:300,provedor:provider,
  });
  return {verifier,requests};
}

Deno.test("ES256: assinatura WebCrypto autentica token e sessao AAL2 local, nao concede Pix",async()=>{
 const f=await fixture("ES256");
 const {verifier,requests}=makeVerifier([f.publicJwk]);
 const claim=await verifier.verificar(await tokenSign(f));
 assert(claim?.userId===USER && claim.sessionId===SESSION && claim.factorId===FACTOR,
  "signed ES256 JWT and session lookup should pass");
 assert(claim?.aal==="aal2" && claim.anonymous===false,"AAL2 session missing");
 assert(requests.jwks===1&&requests.sessions===1,"JWT+DB not checked");
 assert(!("pagamento_autorizado" in claim),"verifier must never authorize money");
});

Deno.test("RS256: assinatura RSA real WebCrypto e fator registrado passam",async()=>{
 const f=await fixture("RS256");
 const {verifier}=makeVerifier([f.publicJwk]);
 const claim=await verifier.verificar(await tokenSign(f));
 assert(claim?.factorId===FACTOR,"RS256 JWT rejected");
});

Deno.test("modificacao de payload e assinatura invalida nao podem consultar sessao",async()=>{
 const f=await fixture("ES256");
 const source=await tokenSign(f);
 const [h,p,s]=source.split(".");
 const corrupted=h+"."+b64(utf(JSON.stringify({...baseClaims(),sub:SESSION})))+"."+s;
 const badSignature=h+"."+p+"."+s.slice(0,-2)+"ZZ";
 const {verifier,requests}=makeVerifier([f.publicJwk]);
 assert(await verifier.verificar(corrupted)===null,"payload forgery accepted");
 assert(await verifier.verificar(badSignature)===null,"signature forgery accepted");
 assert(requests.sessions===0,"DB queried for unverified signature");
});

Deno.test("chaves kid desconhecidas, duplicadas e algoritmo none/HS256 sao negados",async()=>{
 const f=await fixture("ES256");
 const source=await tokenSign(f);
 const {verifier:missing}=makeVerifier([]);
 assert(await missing.verificar(source)===null,"JWKS missing key accepted");
 const {verifier:dupe}=makeVerifier([f.publicJwk,f.publicJwk]);
 assert(await dupe.verificar(source)===null,"ambiguous kid accepted");
 const {verifier}=makeVerifier([f.publicJwk]);
 for(const h of [
  {alg:"none"},{alg:"HS256"},{kid:"unknown"},
  {jku:"https://attacker.example/jwks.json"},
  {jwk:f.publicJwk},{crit:["unknown-critical"]}
 ]) {
  assert(await verifier.verificar(await tokenSign(f,{},h))===null,
   "unsafe JOSE header accepted "+JSON.stringify(h));
 }
});

Deno.test("issuer, audience, role, anon, AAL, user e session errados sao negados",async()=>{
 const f=await fixture("ES256");
 const {verifier,requests}=makeVerifier([f.publicJwk]);
 for(const claims of [
  {iss:"https://attacker.test/auth/v1"},
  {aud:"service_role"}, {aud:["authenticated"]},
  {role:"service_role"}, {aal:"aal1"}, {is_anonymous:true},
  {sub:SESSION}, {session_id:USER},
  {sub:"invalid"}, {session_id:"invalid"}
 ]) {
  assert(await verifier.verificar(await tokenSign(f,claims))===null,
    "unauthorized claims passed "+JSON.stringify(claims));
 }
 // sub/session_id com UUID valido e assinatura valida precisam passar
 // pela consulta Auth para provar divergencia; claims estruturalmente
 // invalidas sao recusadas antes. Sao exatamente esses 2 casos.
 assert(requests.sessions===2,"session mismatches require backend lookup");
});

Deno.test("JWT expirado, iat futuro/antigo e nbf futuro sao recusados",async()=>{
 const f=await fixture("ES256");const {verifier,requests}=makeVerifier([f.publicJwk]);
 for(const claim of [
  {iat:NOW_S-400}, {iat:NOW_S+30},
  {exp:NOW_S-1},{exp:NOW_S},{exp:NOW_S-5,iat:NOW_S-10},
  {nbf:NOW_S+5},{exp:NOW_S-11,iat:NOW_S-10}
 ])assert(await verifier.verificar(await tokenSign(f,claim))===null,
  "invalid lifetime passed: "+JSON.stringify(claim));
 assert(requests.sessions===0,"stale tokens accessed session store");
});

Deno.test("sessao revogada, usuario diferente, factor desativado ou vencido bloqueiam",async()=>{
 const f=await fixture("ES256");const access=await tokenSign(f);
 for(const s of [
  null,{...row(),id:USER},{...row(),userId:SESSION},
  {...row(),factorId:null},{...row(),factorId:USER,factorUserId:SESSION},
  {...row(),aal:"aal1" as const},{...row(),factorStatus:"unverified"},
  {...row(),factorType:"phone"},{...row(),factorUserId:SESSION},
  {...row(),notAfterMs:NOW-1}
 ]) {
   const {verifier}=makeVerifier([f.publicJwk],s);
   assert(await verifier.verificar(access)===null,
    "revoked/mismatch session accepted: "+JSON.stringify(s));
 }
});

Deno.test("JWKS ou banco indisponivel, JWT malformado/oversized: negar sem excecao",async()=>{
 const f=await fixture("ES256");const token=await tokenSign(f);
 for(const options of [{jwksError:true},{dbError:true}]){
  const {verifier}=makeVerifier([f.publicJwk],row(),options);
  assert(await verifier.verificar(token)===null,"network/backend failure did not fail closed");
 }
 const {verifier}=makeVerifier([f.publicJwk]);
 for(const bad of ["","x.y.z","a".repeat(9000),"abc..abc",token+".x",token.replaceAll(".","/")])
  assert(await verifier.verificar(bad)===null,"malformed JWT accepted");
});

Deno.test("rejeita segredo simetrico HS256, projeto suspeito e configuracao negligente",async()=>{
 const f=await fixture("RS256");
 const src=await tokenSign(f);
 const {verifier}=makeVerifier([{kty:"oct",kid:f.kid,alg:"HS256",k:"secreto"} as JsonWebKey]);
 assert(await verifier.verificar(src)===null,"symmetric key accepted");
 const backend=makeVerifier([f.publicJwk]).verifier;
 assert(backend !== null,"fixture broken");
 for(const projectUrl of [
  "http://abcdefghijklmnopqrst.supabase.co",
  "https://abcdefghijklmnopqrst.supabase.co.attacker.example",
  "https://x:y@abcdefghijklmnopqrst.supabase.co",
  "https://abcdefghijklmnopqrst.supabase.co:4443",
  "https://abcdefghijklmnopqrst.supabase.co/other"
 ]) {
  let rejected=false;
  try{new ValidadorJwtSessaoInerte({
    projectUrl,agoraMs:()=>NOW,maxIdadeTokenSegundos:300,
    provedor:{buscarJwksConfiavel:async()=>({keys:[]}),consultarSessaoEFator:async()=>null}
  });}catch{rejected=true}
  assert(rejected,"untrusted JWKS host accepted "+projectUrl);
 }
});

Deno.test("claims user_metadata nunca decidem autoridade, so Auth sessions+factor",async()=>{
 const f=await fixture("ES256");
 const source=await tokenSign(f,{user_metadata:{admin:true,mfa_verified:true}});
 const {verifier}=makeVerifier([f.publicJwk],null);
 assert(await verifier.verificar(source)===null,"user_metadata bypassed revoked session");
});


Deno.test("JWT AAL1 assinado so inicia MFA com sessao Auth AAL1 ativa, sem proof de fator",async()=>{
 const f=await fixture("ES256");
 const before=await tokenSign(f,{aal:"aal1"});
 const after=await tokenSign(f);
 const audits={basic:0,final:0};
 const verifier=new ValidadorJwtSessaoInerte({
  projectUrl:PROJECT,agoraMs:()=>NOW,maxIdadeTokenSegundos:300,
  provedor:{
   buscarJwksConfiavel:async()=>({keys:[f.publicJwk]}),
   consultarSessaoBasica:async id=>{
    audits.basic++;
    assert(id===SESSION,"basic session lookup changed");
    return {id:SESSION,userId:USER,aal:"aal1",notAfterMs:NOW+60000,
      usuarioBloqueado:false};
   },
   consultarSessaoEFator:async id=>{
    audits.final++;
    assert(id===SESSION,"final session lookup changed");
    return row();
   }
  }
 });
 assert(await verifier.verificar(before)===null,"AAL1 became final MFA proof");
 assert(audits.basic===0&&audits.final===0,
  "AAL1 must fail before JWT session reader in final mode");
 const start=await verifier.verificarInicio(before);
 assert(start?.aal==="aal1" && start.factorId===null
   && start.userId===USER&&start.sessionId===SESSION,
   "AAL1 signed session not admitted to challenge phase");
 assert(Number(audits.basic)===1&&Number(audits.final)===0,
   "AAL1 reached privileged AAL2 factor reader");
 const end=await verifier.verificar(after);
 assert(end?.aal==="aal2" && end.factorId===FACTOR&&Number(audits.final)===1,
   "final AAL2 must verify TOTP factor session");
});

Deno.test("fase de inicio AAL1 falha fechada se nao houver reader privado ou se sessao for revogada",async()=>{
 const f=await fixture("ES256");
 const before=await tokenSign(f,{aal:"aal1"});
 const a=makeVerifier([f.publicJwk]);
 assert(await a.verifier.verificarInicio(before)===null,
  "AAL1 admitted without basic session lookup");
 assert(a.requests.sessions===0,"AAL1 queried AAL2 reader");
 const basic={id:SESSION,userId:USER,aal:"aal1" as const,
  notAfterMs:NOW+60000,usuarioBloqueado:false};
 for(const wrong of [
  null,{...basic,id:USER},{...basic,userId:SESSION},
  {...basic,aal:"aal2" as const},{...basic,notAfterMs:NOW-1},
  {...basic,usuarioBloqueado:true}
 ]) {
  const verifier=new ValidadorJwtSessaoInerte({
   projectUrl:PROJECT,agoraMs:()=>NOW,maxIdadeTokenSegundos:300,
   provedor:{
    buscarJwksConfiavel:async()=>({keys:[f.publicJwk]}),
    consultarSessaoBasica:async()=>wrong,
    consultarSessaoEFator:async()=>{throw new Error("AAL2 reader accessed");}
   }
  });
  assert(await verifier.verificarInicio(before)===null,
   "invalid basic session admitted "+JSON.stringify(wrong));
 }
});

Deno.test("fase AAL1 exige assinatura real, nao acessa Auth com token adulterado",async()=>{
 const f=await fixture("ES256");
 const token=await tokenSign(f,{aal:"aal1"});
 const [h,p,sig]=token.split(".");
 let lookups=0;
 const verifier=new ValidadorJwtSessaoInerte({
  projectUrl:PROJECT,agoraMs:()=>NOW,maxIdadeTokenSegundos:300,
  provedor:{
   buscarJwksConfiavel:async()=>({keys:[f.publicJwk]}),
   consultarSessaoBasica:async()=>{lookups++;return null;},
   consultarSessaoEFator:async()=>{lookups++;return null;}
  }
 });
 const fake=h+"."+b64(utf(JSON.stringify({...baseClaims(),aal:"aal1",sub:SESSION})))+"."+sig;
 assert(await verifier.verificarInicio(fake)===null,"forged AAL1 accepted");
 assert(lookups===0,"unverified token reached Auth basic reader");
});
