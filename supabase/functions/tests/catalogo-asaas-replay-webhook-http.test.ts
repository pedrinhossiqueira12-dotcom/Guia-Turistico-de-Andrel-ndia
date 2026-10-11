/**
 * Regressao HTTP real do handler Asaas, SEM rede, credenciais ou Pix real.
 * Simula uma aprovacao previamente persistida; cada replay deve
 * revalidar banco, valor, status, destino e condicoes financeiras.
 */
const ROOT="https://ci-financeiro.invalid";
const ASAAS="https://api-sandbox.asaas.com";
const TOKEN="ci-exclusivo-validacao-saida-webhook-0123456789";
const SAND_KEY="47996515839"; // Chave ficticia oficial do Asaas Sandbox.
const TRANSFER="11111111-1111-4111-8111-111111111111";
const SAQUE="22222222-2222-4222-8222-222222222222";
const USER="33333333-3333-4333-8333-333333333333";
type Handler=(req:Request)=>Response|Promise<Response>;
let handler:Handler|null=null;
const serveBefore=Deno.serve;
const fetchBefore=globalThis.fetch;
const fields={status:"PENDING",value:100,operationType:"PIX",
 id:TRANSFER,externalReference:SAQUE,pixAddressKey:SAND_KEY};
let remote:Record<string,unknown>|null={...fields};
let failGet=false,eligible=true;
let bankReads=0,cacheReads=0,profileReads=0,writes=0,rpcReads=0;
let fingerprint="";
const result=(x:unknown,status=200)=>Response.json(x,{status});
function assert(v:unknown,m:string):asserts v{if(!v)throw Error(m);}
async function hashPixFake():Promise<string>{
 const raw=new Uint8Array(32).fill(0x11);
 const domain=new TextEncoder().encode("saque-asaas-pix-hmac-v1");
 const mixed=new Uint8Array([...raw,...domain]);
 const derived=new Uint8Array(await crypto.subtle.digest("SHA-256",mixed));
 const key=await crypto.subtle.importKey("raw",derived,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const value="guia-asaas-pix-v1:PHONE:"+SAND_KEY;
 const signature=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value)));
 return [...signature].map(b=>b.toString(16).padStart(2,"0")).join("");
}
function reset(opts:{remote?:Record<string,unknown>|null; failGet?:boolean; eligible?:boolean}={}){
 remote=opts.remote===undefined?{...fields}:opts.remote;
 failGet=opts.failGet??false;eligible=opts.eligible??true;
 bankReads=0;cacheReads=0;profileReads=0;writes=0;rpcReads=0;
}
globalThis.fetch=async (input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
 const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url);
 const method=init?.method??"GET";
 if(url.origin===ASAAS && url.pathname==="/v3/transfers/"+TRANSFER){
  assert(method==="GET","mock proibiu POST de transferencia");
  assert(init?.signal instanceof AbortSignal,"GET sem prazo de cancelamento");
  bankReads++;
  if(failGet)throw new DOMException("Simulacao: GET indisponivel","AbortError");
  return result(remote??{});
 }
 if(url.origin!==ROOT)throw Error("CI bloqueou rede: "+url.host);
 if(url.pathname==="/rest/v1/catalogo_asaas_saques" && method==="GET"){
  return result({id:SAQUE,motoboy_id:USER,transferencia_id:TRANSFER,
   status:"enviado",valor_centavos:10000,
   pix_destino_sha256:fingerprint,
   pix_destino_registrado_em:"2026-10-11T00:00:00Z"});
 }
 if(url.pathname==="/rest/v1/rpc/catalogo_asaas_validar_reserva_saque" && method==="POST"){
  rpcReads++;
  return result({ok:true,elegivel:eligible,quantidade:1,valor_centavos:10000});
 }
 if(url.pathname==="/rest/v1/catalogo_motoboy_perfis" && method==="GET"){
  profileReads++;
  return result({apto:true,em_analise:false});
 }
 if(url.pathname==="/rest/v1/catalogo_motoboys" && method==="GET")return result([{usuario_id:USER}]);
 if(url.pathname==="/rest/v1/catalogo_asaas_validacoes_saque" && method==="GET"){
  cacheReads++;
  return result({decisao:"APPROVED",motivo:"Autorizacao anterior no banco"});
 }
 if(url.pathname==="/rest/v1/catalogo_asaas_validacoes_saque" && method!=="GET"){
  writes++;throw Error("Replay nao deveria inserir aprovacao");
 }
 throw Error("Consulta inesperada bloqueada no mock: "+method+" "+url.pathname);
};
Deno.env.set("SUPABASE_URL",ROOT);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY","ci-nao-e-credencial-real");
Deno.env.set("SUPABASE_SECRET_KEYS","");
Deno.env.set("CATALOGO_DATA_ENCRYPTION_KEY","11".repeat(32));
Deno.env.set("ASAAS_ENVIRONMENT","sandbox");
Deno.env.set("ASAAS_API_KEY","ci-token-asaas-sem-pagamentos");
Deno.env.set("ASAAS_PAYOUTS_ENABLED","true");
Deno.env.set("ASAAS_SAQUE_VALIDACAO_ENABLED","true");
Deno.env.set("ASAAS_SAQUE_VALIDACAO_TOKEN",TOKEN);
fingerprint=await hashPixFake();
try {
 Object.defineProperty(Deno,"serve",{
  configurable:true,writable:true,value:(fn:Handler)=>{
   assert(handler===null,"handler Asaas duplicado");
   handler=fn;
   return {finished:Promise.resolve(),shutdown:()=>{}};
  }
 });
 await import("../catalogo-asaas-financeiro/index.ts");
}finally{
 Object.defineProperty(Deno,"serve",{configurable:true,writable:true,value:serveBefore});
}
assert(handler,"handler de validacao indisponivel");
async function invoke(payload:Record<string,unknown>):Promise<Record<string,unknown>>{
 const h=handler!;
 const response=await h(new Request(ROOT+"/functions/v1/catalogo-asaas-financeiro/saque-autorizacao",{
  method:"POST",headers:{"content-type":"application/json","asaas-access-token":TOKEN},
  body:JSON.stringify({type:"TRANSFER",transfer:payload}),
 }));
 assert(response.status===200,"webhook nao retornou status do contrato: "+response.status);
 const data=await response.json();
 assert(data&&typeof data==="object"&&["APPROVED","REFUSED"].includes(data.status),
  "resposta de saque inesperada");
 return data;
}
Deno.test("replay previamente aprovado exige GET e credito atuais, sem criar novo Pix",async()=>{
 reset();
 const response=await invoke({...fields});
 assert(response.status==="APPROVED","homologacao ficticia positiva nao aprovou");
 assert(bankReads===1&&cacheReads===1&&profileReads===1&&rpcReads===2,
  "cache ignorou alguma verificacao obrigatoria");
 assert(writes===0,"replay gravou autorizacao adicional");
});
Deno.test("replay com chave Pix do provedor divergente retorna REFUSED mesmo com cache APPROVED",async()=>{
 reset({remote:{...fields,pixAddressKey:"chave-ficticia-divergente"}});
 const response=await invoke({...fields});
 assert(response.status==="REFUSED","cache permitiu transferir a outro destino");
 assert(bankReads===1&&cacheReads===1&&writes===0,"replay alterou estado ou nao checou banco");
});
Deno.test("replay com status desconhecido ou terminal nao reutiliza APPROVED",async()=>{
 for(const status of ["DONE","CANCELLED","FAILED","DESCONHECIDO",""]){
  reset({remote:{...fields,status}});
  const response=await invoke({...fields});
  assert(response.status==="REFUSED","cache aceitou status "+status);
  assert(bankReads===1&&writes===0,"status duvidoso criou movimento");
 }
});
Deno.test("replay com valor adulterado ou GET falho nunca reutiliza cache",async()=>{
 reset();
 const bad=await invoke({...fields,value:200});
 assert(bad.status==="REFUSED"&&bankReads===0&&writes===0,"valor divergente aprovado");
 reset({failGet:true});
 const err=await invoke({...fields});
 assert(err.status==="REFUSED"&&bankReads===1&&cacheReads===0&&writes===0,
  "timeout de leitura chegou a aprovacao persistida");
});
Deno.test("replay apos bloqueio financeiro recusa antes do GET, mesmo com APPROVED salvo",async()=>{
 reset({eligible:false});
 const err=await invoke({...fields});
 assert(err.status==="REFUSED"&&bankReads===0&&cacheReads===0&&writes===0,
  "bloqueio financeiro ignorado");
});
// Sem restaurar fetch aqui: este arquivo e executado em worker Deno isolado,
// e toda saida nao reconhecida segue expressamente bloqueada.
void fetchBefore;


Deno.test("webhook nao arredonda fracao de centavo em payload ou GET Asaas",async()=>{
 for(const amount of [100.001,100.004,100.005,99.999,100.000001,1e20]){
  reset();
  const payload=await invoke({...fields,value:amount});
  assert(payload.status==="REFUSED"&&bankReads===0&&cacheReads===1&&writes===0,
   "payload bancario com centavos inexatos foi aprovado: "+amount);
  reset({remote:{...fields,value:amount}});
  const provider=await invoke({...fields});
  assert(provider.status==="REFUSED"&&bankReads===1&&cacheReads===1&&writes===0,
   "GET bancario com centavos inexatos foi aprovado: "+amount);
 }
});


Deno.test("Asaas nao aceita chave Pix alheia com prefixo, sufixo, espaco ou truncamento",async()=>{
 const adulteradas:unknown[]=[
  SAND_KEY+"extra", "falso-"+SAND_KEY, " "+SAND_KEY, SAND_KEY+" ",
  SAND_KEY+".", SAND_KEY+"\n", SAND_KEY+"a".repeat(254),
  47996515839, {}, null,
 ];
 for(const adulterada of adulteradas){
  reset({remote:{...fields,pixAddressKey:adulterada}});
  const response=await invoke({...fields});
  assert(response.status==="REFUSED",
   "chave adulterada pelo banco foi interpretada como valida");
  assert(bankReads===1&&writes===0,"GET adulterado disparou escrita");
 }
});
Deno.test("Asaas exige ambas as chaves Pix consistentes quando aparecem no mesmo GET",async()=>{
 reset({remote:{...fields,bankAccount:{pixAddressKey:SAND_KEY+"extra"}}});
 const response=await invoke({...fields});
 assert(response.status==="REFUSED"&&bankReads===1&&writes===0,
  "chave Pix divergente dentro de bankAccount foi ignorada");
 reset({remote:{...fields}});
 const incoming=await invoke({...fields,pixAddressKey:SAND_KEY+"extra"});
 assert(incoming.status==="REFUSED"&&bankReads===1&&writes===0,
  "chave Pix malformada no webhook foi aceita");
});
Deno.test("Asaas permite normalizacao estrita +55 sem ignorar caracteres espurios",async()=>{
 reset({remote:{...fields,pixAddressKey:"+55"+SAND_KEY}});
 const response=await invoke({...fields});
 assert(response.status==="APPROVED"&&bankReads===1&&writes===0,
  "numero de telefone brasileiro valido foi rejeitado");
});
