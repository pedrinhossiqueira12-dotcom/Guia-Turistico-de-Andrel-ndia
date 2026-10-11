/**
 * #42. Prova TOTP REAL de conta exclusivamente de testes no STAGING.
 * Executar APENAS no terminal particular do operador, nunca CI/Edge/site.
 * Proibidos Pix, Asaas, senhas de producao e uso de service_role.
 */
export const STAGING="https://jbttwihctuibchhcyqtl.supabase.co";
export const TEST_ACCOUNT=/^mfa-teste\+[a-z0-9][a-z0-9._-]{0,45}@[a-z0-9.-]+\.[a-z]{2,}$/i;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BEARER=/^[A-Za-z0-9_.~-]{40,8192}$/;
type Json=Record<string,unknown>;
function check(ok:unknown,message:string):asserts ok{if(!ok)throw Error(message);}
function record(x:unknown):Json{
 check(x!==null&&typeof x==="object"&&!Array.isArray(x),"Auth respondeu objeto invalido");
 return x as Json;
}
export function fixedStagingUrl(path:string,base=STAGING):string{
 const u=new URL(base);
 check(u.origin===STAGING&&u.protocol==="https:"&&u.pathname==="/"
   &&!u.search&&!u.hash&&!u.username&&!u.password&&!u.port,"Nao usar Supabase fora de STAGING");
 check(/^\/(?:user|factors|factors\/[0-9a-f-]{36}\/(?:challenge|verify)|token\?grant_type=password)$/.test(path)
   &&!path.includes(".."),"Rota fora das operacoes Auth permitidas");
 const full=new URL(STAGING+"/auth/v1"+path);
 check(full.origin===STAGING&&full.pathname.startsWith("/auth/v1/"),"Auth fora de STAGING");
 return full.toString();
}
export function inspectSmokeJwt(jwt:string):Json{
 // APENAS exame do smoke test, sem verificar assinatura; nao autoriza pagamentos.
 check(BEARER.test(jwt)&&jwt.split(".").length===3,"JWT Auth fora do contrato");
 const part=jwt.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
 const bytes=Uint8Array.from(atob(part.padEnd(Math.ceil(part.length/4)*4,"=")),c=>c.charCodeAt(0));
 return record(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));
}
export function sameSessionAal2(a:Json,b:Json,user:Json):boolean{
 return a.aal==="aal1"&&b.aal==="aal2"
  &&a.role==="authenticated"&&b.role==="authenticated"
  &&a.is_anonymous===false&&b.is_anonymous===false
  &&typeof a.sub==="string"&&UUID.test(a.sub)
  &&a.sub===b.sub&&user.id===a.sub
  &&typeof a.session_id==="string"&&UUID.test(a.session_id)
  &&a.session_id===b.session_id;
}
/** Apenas check auxiliar do operador: GET /user autenticado deve confirmar
 * exatamente o fator TOTP usado no challenge da conta exclusiva de STAGING.
 * Nao verifica assinatura JWT nem transforma AAL2 em prova financeira.
 */
export function fatorTotpConfirmadoNoUsuarioStaging(
 usuario:Json, userId:string, factorId:string, email:string,
):boolean{
 if(!UUID.test(userId)||!UUID.test(factorId)||!TEST_ACCOUNT.test(email)
   ||usuario.id!==userId||typeof usuario.email!=="string"
   ||usuario.email.trim().toLowerCase()!==email.toLowerCase()
   ||!Array.isArray(usuario.factors))return false;
 const encontrados=(usuario.factors as unknown[]).filter(value=>{
  if(value===null||typeof value!=="object"||Array.isArray(value))return false;
  return (value as Json).id===factorId;
 });
 return encontrados.length===1
  &&(encontrados[0] as Json).factor_type==="totp"
  &&(encontrados[0] as Json).status==="verified";
}

/**
 * Smoke test adicional APENAS: claims de JWT retornado pelo GoTrue
 * devem ter emissor fixo, vigencia e iat posterior ao inicio do verify.
 * Claims aqui NAO sao prova criptografica e NUNCA autorizam financeiro.
 * O backend financeiro precisara verificar assinatura + sessao server-side.
 */
export function claimsAal2FrescasDoStaging(
 antes:Json, depois:Json, inicioVerifyMs:number, agoraMs:number,
):boolean{
 const inteiro=(v:unknown):v is number=>
  typeof v==="number"&&Number.isSafeInteger(v)&&v>=0;
 if(!Number.isFinite(inicioVerifyMs)||!Number.isFinite(agoraMs)
   ||inicioVerifyMs>agoraMs || inicioVerifyMs<0)return false;
 const inicio=Math.floor(inicioVerifyMs/1000), agora=Math.floor(agoraMs/1000);
 const issuer=STAGING+"/auth/v1";
 if(antes.iss!==issuer||depois.iss!==issuer
   ||antes.aud!=="authenticated"||depois.aud!=="authenticated"
   ||!inteiro(antes.iat)||!inteiro(antes.exp)
   ||!inteiro(depois.iat)||!inteiro(depois.exp))return false;
 return antes.iat<=agora+30
  &&antes.exp>inicio&&antes.exp>antes.iat
  &&depois.iat>=antes.iat
  // A mesma verificacao pode ocorrer no segundo da emissao: tolerar
  // ate 30s de diferenca entre relogio GoTrue e terminal do operador.
  &&depois.iat>=inicio-30
  &&depois.iat<=agora+30
  &&depois.exp>agora&&depois.exp>depois.iat;
}

export class StagingMfaManual{
 constructor(private readonly publishable:string,private readonly http:typeof fetch=fetch){
  check(/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(publishable),
   "Use SOMENTE sb_publishable_ do STAGING, nao service_role");
 }
 async call(method:"GET"|"POST",path:string,token?:string,body?:Json):Promise<Json>{
  const url=fixedStagingUrl(path);
  // Nao permitir a antiga leitura GET /auth/v1/factors: GoTrue expõe
  // a lista dos fatores no usuario autenticado GET /auth/v1/user.
  check((method==="GET" && path==="/user") ||
    (method==="POST" && path!=="/user"),"Metodo Auth nao autorizado");
  check(token===undefined||BEARER.test(token),"Bearer local invalido");
  const res=await this.http(url,{
   method,redirect:"error",cache:"no-store",credentials:"omit",
   headers:{"apikey":this.publishable,"Authorization":"Bearer "+(token??this.publishable),
    "Content-Type":"application/json"},
   ...(method==="POST"?{body:JSON.stringify(body??{})}:{}),
   signal:AbortSignal.timeout(12000),
  });
  // GoTrue envia JSON em todas as rotas usadas nesta ferramenta.
  // Rejeitar resposta HTML/texto de proxy mesmo que contenha JSON sintatico.
  check(/^application\/json(?:\s*;|$)/i.test(res.headers.get("content-type")??""),
    "GoTrue respondeu Content-Type inesperado");
  const limit=method==="POST"&&path==="/factors"?1048576:65536;
  const declared=res.headers.get("content-length");
  check(declared===null||(/^\d+$/.test(declared)&&Number(declared)<=limit),
    "Corpo GoTrue excedeu limite");
  const reader=res.body?.getReader();
  check(reader,"Resposta Auth sem corpo");
  const chunks:Uint8Array[]=[];
  let bytes=0;
  try{
   while(true){
    const {done,value}=await reader.read();
    if(done)break;
    bytes+=value.byteLength;
    check(bytes<=limit,"Corpo GoTrue excedeu limite");
    chunks.push(value);
   }
  }catch(e){await reader.cancel().catch(()=>{});throw e;}
  const all=new Uint8Array(bytes);
  let index=0;
  for(const chunk of chunks){all.set(chunk,index);index+=chunk.byteLength;}
  let json:Json;
  try{json=record(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(all)));}
  catch{throw Error("GoTrue respondeu JSON inesperado (HTTP "+res.status+")");}
  // Nao exibir respostas ou erros brutos: podem conter senha, refresh, QR, segredo.
  check(res.ok,"GoTrue recusou a operacao (HTTP "+res.status+")");
  return json;
 }
 async login(email:string,password:string):Promise<string>{
  check(TEST_ACCOUNT.test(email),"Somente conta mfa-teste+... de homologacao");
  check(password.length>=8&&password.length<=1024,"Senha da conta de teste invalida");
  const data=await this.call("POST","/token?grant_type=password",undefined,{email,password});
  check(typeof data.access_token==="string"&&BEARER.test(data.access_token),
    "Login nao retornou token Auth");
  return data.access_token;
 }
 async factors(token:string):Promise<Json[]>{
  // O mfa.listFactors do Supabase Auth deriva de GET /user e user.factors;
  // GET /auth/v1/factors nao e o endpoint de listagem do usuario.
  const data=await this.call("GET","/user",token);
  check(typeof data.id==="string"&&UUID.test(data.id),
    "Usuario Auth invalido ao consultar fatores MFA");
  check(data.factors===undefined || Array.isArray(data.factors),
    "Fatores Auth em formato inesperado");
  return ((data.factors??[]) as unknown[]).map(record)
   .filter(f=>f.factor_type==="totp")
   .map(f=>{
    check(typeof f.id==="string"&&UUID.test(f.id)
      &&(f.status==="verified"||f.status==="unverified"),
      "Fator MFA sem UUID ou status valido");
    return f;
   });
 }
 async enroll(token:string):Promise<{id:string;secret:string}>{
  const data=await this.call("POST","/factors",token,{
   factor_type:"totp",friendly_name:"STAGING Guia Andrelandia - teste"
  });
  check(typeof data.id==="string"&&UUID.test(data.id),"ID de fator TOTP nao e UUID");
  const secret=record(data.totp).secret;
  check(typeof secret==="string"&&/^[A-Z2-7]{16,128}=*$/i.test(secret),
   "Segredo TOTP inesperado");
  return {id:data.id,secret};
 }
 async verifyComCodigoAposDesafio(
  token:string,factor:string,obterCodigo:()=>Promise<string>,
 ):Promise<string>{
  check(UUID.test(factor)&&typeof obterCodigo==="function",
   "Fator ou leitor TOTP invalido");
  // Criar challenge ANTES de pedir o OTP, nunca aceitar ID do browser.
  const ch=await this.call("POST","/factors/"+factor+"/challenge",token,{});
  check(typeof ch.id==="string"&&UUID.test(ch.id),"Challenge sem UUID");
  const code=await obterCodigo();
  check(typeof code==="string"&&/^\d{6}$/.test(code),"Codigo TOTP invalido");
  const result=await this.call("POST","/factors/"+factor+"/verify",token,
   {challenge_id:ch.id,code});
  check(typeof result.access_token==="string"&&BEARER.test(result.access_token),
   "Verify nao retornou JWT AAL2");
  return result.access_token;
 }
 async verify(token:string,factor:string,code:string):Promise<string>{
  // Compatibilidade com testes existentes; valida OTP antes de criar challenge.
  check(UUID.test(factor)&&/^\d{6}$/.test(code),"ID de fator ou OTP invalido");
  return this.verifyComCodigoAposDesafio(token,factor,async()=>code);
 }
}
async function hiddenInput(title:string):Promise<string>{
 check(Deno.stdin.isTerminal()&&Deno.stdout.isTerminal(),
   "Credenciais so podem ser digitadas diretamente num terminal");
 await Deno.stdout.write(new TextEncoder().encode(title));
 const out:number[]=[];
 Deno.stdin.setRaw(true);
 try{
  const buffer=new Uint8Array(1);
  while(true){
   const n=await Deno.stdin.read(buffer);
   if(n===null)throw Error("Entrada cancelada");
   const c=buffer[0];
   if(c===13||c===10)break;
   if(c===3)throw Error("Interrompido");
   if(c===127||c===8){out.pop();continue;}
   if(c<32||c>126)continue;
   check(out.length<1024,"Entrada confidencial excedeu tamanho");
   out.push(c);
  }
 }finally{
  Deno.stdin.setRaw(false);
  await Deno.stdout.write(new TextEncoder().encode("\n"));
 }
 return new TextDecoder().decode(Uint8Array.from(out));
}
export async function main(){
 check(Deno.args.length===1&&Deno.args[0]==="--staging-manual-auth-only",
  "Apenas --staging-manual-auth-only; nunca no CI, Edge ou producao");
 check(Deno.stdin.isTerminal()&&Deno.stdout.isTerminal(),
  "Nao executar por automacao, pipe ou redirecionamento");
 const key=Deno.env.get("STAGING_PUBLISHABLE_KEY")??"";
 const auth=new StagingMfaManual(key);
 console.log("ALVO FIXO: STAGING jbttwihctuibchhcyqtl; SEM Asaas, saque ou Pix.");
 check(prompt("Digite HOMOLOGACAO para continuar:")==="HOMOLOGACAO","Abortado");
 const email=(prompt("Conta exclusiva mfa-teste+... (nao use conta real):")??"").trim().toLowerCase();
 check(TEST_ACCOUNT.test(email),"E-mail nao e de conta exclusiva de testes");
 let password=await hiddenInput("Senha da conta de teste (oculta): ");
 let jwt:string;
 try{jwt=await auth.login(email,password);}finally{password="";}
 const before=inspectSmokeJwt(jwt);
 const user=await auth.call("GET","/user",jwt);
 check(typeof user.email==="string" && user.email.trim().toLowerCase()===email,
  "Conta Auth inicial diverge do usuario de testes informado");
 check(before.aal==="aal1"&&before.role==="authenticated"
  &&before.is_anonymous===false&&before.sub===user.id,
  "Conta STAGING nao iniciou sessao AAL1 valida");
 console.log("Autenticacao AAL1 autenticada no GoTrue STAGING.");
 const factors=await auth.factors(jwt);
 const verified=factors.filter(f=>f.status==="verified");
 const unverified=factors.filter(f=>f.status!=="verified");
 check(verified.length<=1,"Existem multiplos fatores; revisar manualmente");
 let factor:string;
 if(verified.length){
  factor=String(verified[0].id);
  check(UUID.test(factor),"Fator verificado sem UUID");
  console.log("Fator TOTP ja verificado disponivel para novo desafio.");
 }else{
  check(unverified.length===0,
   "Existe fator pendente; revisar manualmente antes de novo enroll");
  const enrollment=await auth.enroll(jwt);
  factor=enrollment.id;
  console.log("O segredo Base32 sera exibido APENAS no seu terminal.");
  console.log("Nao compartilhe a tela, copie para logs ou envie para esta conversa.");
  check(prompt("Digite EXIBIR para registrar no autenticador:")==="EXIBIR",
    "Fator pendente: concluir inscricao no painel/Auth antes de repetir");
  // Exibicao local consciente, nunca em job CI/issue/chat. Nao salvo no disco.
  console.log("Segredo TOTP de HOMOLOGACAO (CONFIDENCIAL): "+enrollment.secret);
 }
 const inicioVerifyMs=Date.now();
 const upgraded=await auth.verifyComCodigoAposDesafio(jwt,factor,
  ()=>hiddenInput("Desafio criado. Codigo TOTP de 6 digitos (oculto): "));
 const after=inspectSmokeJwt(upgraded);
 check(claimsAal2FrescasDoStaging(before,after,inicioVerifyMs,Date.now()),
   "JWT GoTrue pos-verificacao tem emissor, vigencia ou emissao inconsistentes");
 const afterUser=await auth.call("GET","/user",upgraded);
 check(sameSessionAal2(before,after,afterUser),
   "GoTrue AAL2 nao comprovou MESMO usuario e sessao");
 check(fatorTotpConfirmadoNoUsuarioStaging(afterUser,String(before.sub),factor,email),
   "Fator TOTP esperado nao consta como verificado na mesma conta STAGING");
 console.log("PASS: GoTrue STAGING confirmou fator TOTP, AAL1=>AAL2 e MESMA sessao.");
 console.log("FINANCEIRO: HOLD_OBRIGATORIO; nenhum Pix, parecer ou saque autorizado.");
 console.log("Informe somente 'TOTP STAGING PASS' (sem segredos/tokens/OTP).");
}
if(import.meta.main){
 try{await main();}
 catch(e){console.error("MFA STAGING nao concluido: "+
   (e instanceof Error?e.message:"falha desconhecida"));Deno.exit(1);}
}
