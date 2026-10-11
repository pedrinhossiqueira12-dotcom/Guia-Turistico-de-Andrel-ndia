// Exercita os handlers HTTP REAIS das Edge Functions sem abrir sockets.
// Todo fetch e interceptado: nenhum pedido atinge Supabase ou Mercado Pago.
// Todos os IDs, tokens e dados abaixo sao FICTICIOS.
import {
  buildWebhookManifest, encryptAesGcm,
} from "../_shared/catalogo-pagamentos-v2.ts";

const SB_URL = "https://ci-supabase.invalid";
const MP_SECRET = "ci-marketplace-webhook-secret";
const ENC_KEY = "11".repeat(32);
const PAYMENT_ID = "pay-ci-123";
const ORDER_ID = "00000000-0000-4000-8000-000000000801";
const REF = "guia-ci-order-801";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
type Handler = (request: Request) => Response | Promise<Response>;
const handlers = new Map<string, Handler>();

// O servidor real não pode escutar porta alguma durante um teste de CI.
async function capture(label: string, path: string) {
  const oldServe = Deno.serve;
  let count = 0;
  try {
    Object.defineProperty(Deno, "serve", {
      configurable: true,
      writable: true,
      value: (handler: Handler) => {
        count++;
        handlers.set(label, handler);
        return { finished: Promise.resolve(), shutdown: () => {} };
      },
    });
    await import(path);
  } finally {
    Object.defineProperty(Deno, "serve", {
      configurable: true, writable: true, value: oldServe,
    });
  }
  assert(count === 1 && handlers.has(label), `Handler ${label} nao foi capturado`);
}
function post(path: string, body: unknown, headers: Record<string,string> = {}): Request {
  return new Request(SB_URL + path, {
    method: "POST", headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
function result(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json" },
  });
}
function assertions(res: Response, code: number, label: string) {
  assert(res.status === code, `${label}: esperado HTTP ${code}, recebeu ${res.status}`);
}
async function signedHeaders(dataId = PAYMENT_ID): Promise<Record<string, string>> {
  const ts = String(Math.floor(Date.now() / 1000));
  const requestId = "ci-request-123";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(MP_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key,
    new TextEncoder().encode(buildWebhookManifest(dataId, requestId, ts)));
  const v1 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  return { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId };
}

Deno.env.set("SUPABASE_URL", SB_URL);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "ci-not-a-real-service-role-key");
Deno.env.set("SUPABASE_SECRET_KEYS", "");
Deno.env.set("MP_OAUTH_ENCRYPTION_KEY", ENC_KEY);
Deno.env.set("MP_MARKETPLACE_WEBHOOK_SECRET", MP_SECRET);
Deno.env.set("MARKETPLACE_CHECKOUT_ENABLED", "false");
Deno.env.set("OFFLINE_CHECKOUT_ENABLED", "false");
Deno.env.set("FATURA_PIX_ENABLED", "false");
Deno.env.set("MP_PLATFORM_ACCESS_TOKEN", "");
Deno.env.set("MP_PLATFORM_SELLER_ID", "");
Deno.env.set("MP_PLATFORM_WEBHOOK_SECRET", "");

// Fail closed: qualquer fetch fora dos mocks deve falhar, sem abrir rede.
let forbiddenRequests = 0;
type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const nativeFetch = globalThis.fetch;
const denyNetwork: FetchImpl = async () => {
  forbiddenRequests++;
  throw new Error("CI BLOQUEOU acesso a rede real");
};
let currentMockFetch: FetchImpl = denyNetwork;
// Wrapper STAVEL: supabase-js pode capturar fetch quando createClient e chamado.
// Os casos de teste trocam apenas a implementacao, nunca a referencia.
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => currentMockFetch(input, init);

await capture("pix", new URL("../catalogo-pedido-pix/index.ts", import.meta.url).href);
await capture("offline", new URL("../catalogo-pedido-offline/index.ts", import.meta.url).href);
await capture("fatura", new URL("../catalogo-fatura-pix/index.ts", import.meta.url).href);
await capture("webhook", new URL("../mercadopago-marketplace-webhook/index.ts", import.meta.url).href);

// Capta a Edge Asaas original sem credenciais bancarias nem rede.
// Ao desligar a validacao, nenhuma operacao pode ser aprovada no handler.
Deno.env.set("ASAAS_ENVIRONMENT", "sandbox");
Deno.env.set("ASAAS_API_KEY", "ci-asaas-token-ficticio");
Deno.env.set("ASAAS_PAYOUTS_ENABLED", "false");
Deno.env.set("ASAAS_SAQUE_VALIDACAO_ENABLED", "false");
Deno.env.set("ASAAS_SAQUE_VALIDACAO_TOKEN", "ci-validacao-asaas-webhook-token-ficticio-32");
await capture("asaas", new URL("../catalogo-asaas-financeiro/index.ts", import.meta.url).href);

Deno.test("Asaas com validacao desativada recusa por HTTP sem consultar rede", async () => {
  const start = forbiddenRequests;
  const asaas = handlers.get("asaas")!;
  const endpoint = "/functions/v1/catalogo-asaas-financeiro/saque-autorizacao";
  const response = await asaas(post(endpoint, {type:"TRANSFER",transfer:{
    id:"11111111-1111-4111-8111-111111111111",value:5000,operationType:"PIX"
  }}, {"asaas-access-token":"ci-validacao-asaas-webhook-token-ficticio-32"}));
  assertions(response, 200, "Asaas webhook desligado");
  const payload = await response.json();
  assert(payload.status==="REFUSED", "Webhook desativado aprovou saida financeira");
  assert(payload.refuseReason==="Validação de saída indisponível no ambiente.",
    "Webhook desligado devolveu mensagem de aprovacao");
  assertions(await asaas(new Request(SB_URL+endpoint,{method:"GET"})),405,"Asaas GET recusado");
  assert(forbiddenRequests===start, "Webhook Asaas desligado tentou rede");
});

// #41: exercita a Edge REAL com autenticação e histórico Asaas inteiramente
// FICTÍCIOS. Nenhuma rede é permitida fora dos mocks da CI.
Deno.test("varredura bloqueia vinculo bancario local malformado antes de GET Asaas",async()=>{
 const edge=handlers.get("asaas")!;
 const separacaoId="ad800001-1111-4111-8111-111111111111";
 const requestId="ad800002-1111-4111-8111-111111111111";
 const motoboyId="edededed-eded-4ede-8ede-ededededed10";
 const adminUid="4b9a0233-6b72-4573-aebd-d596c5b15e1b";
 const referencia="guia-exc:saida:"+requestId;
 const valido={transferencia_id:"ci-transfer-link-sandbox",referencia_externa:referencia,
  valor_centavos:12000,motoboy_id:motoboyId};
 const casos:{nome:string,vinculo:unknown}[]=[
  {nome:"id de transferencia ausente",vinculo:{...valido,transferencia_id:null}},
  {nome:"id de transferencia vazio",vinculo:{...valido,transferencia_id:""}},
  {nome:"id com espaços externos",vinculo:{...valido,transferencia_id:" ci-transfer "}},
  {nome:"id com quebra de linha",vinculo:{...valido,transferencia_id:"ci-transfer\\nmalformado"}},
  {nome:"id com tamanho excessivo",vinculo:{...valido,transferencia_id:"x".repeat(181)}},
  {nome:"referencia externa ausente",vinculo:{...valido,referencia_externa:null}},
  {nome:"referencia externa vazia",vinculo:{...valido,referencia_externa:""}},
  {nome:"referencia externa com espaços",vinculo:{...valido,referencia_externa:referencia+" "}},
  {nome:"centavos string",vinculo:{...valido,valor_centavos:"12000"}},
  {nome:"centavos zero",vinculo:{...valido,valor_centavos:0}},
  {nome:"centavos negativos",vinculo:{...valido,valor_centavos:-12000}},
  {nome:"centavos fracionarios",vinculo:{...valido,valor_centavos:12000.5}},
  {nome:"centavos inseguros",vinculo:{...valido,valor_centavos:1e20}},
  {nome:"motoboy do vinculo invalido",vinculo:{...valido,motoboy_id:"nao-e-uuid"}},
  {nome:"objeto devolvido como array",vinculo:[valido]},
 ];
 for(const caso of casos){
  let bancoGets=0,saquesGets=0;
  try{
   currentMockFetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
    const raw=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
    const u=new URL(raw);
    assert((init?.method??"GET")==="GET","Auditoria com vinculo invalido tentou escrita");
    if(u.host==="ci-supabase.invalid"&&u.pathname==="/auth/v1/user")
     return result({id:adminUid,aud:"authenticated",role:"authenticated",
      app_metadata:{},user_metadata:{}});
    if(u.host==="ci-supabase.invalid"&&
       u.pathname==="/rest/v1/catalogo_asaas_separacoes_excepcionais")
     return result({id:separacaoId,tipo:"saida",solicitacao_id:requestId,
      motoboy_id:motoboyId,valor_centavos:12000,situacao:"congelada"});
    if(u.host==="ci-supabase.invalid"&&
       u.pathname==="/rest/v1/catalogo_asaas_transferencias_excepcionais_auditoria")
     return result(caso.vinculo);
    if(u.host==="ci-supabase.invalid"&&u.pathname==="/rest/v1/catalogo_asaas_saques"){
     saquesGets++;
     throw Error("Vinculo local invalido acionou saques comuns: "+caso.nome);
    }
    if(u.host==="api-sandbox.asaas.com"&&u.pathname==="/v3/transfers"){
     bancoGets++;
     throw Error("Vinculo local invalido acionou Asaas: "+caso.nome);
    }
    throw Error("Rota inesperada para vinculo local invalido: "+u.pathname);
   };
   const response=await edge(post("/functions/v1/catalogo-asaas-financeiro",{
    acao:"auditar_historico_transferencias_excepcionais_sandbox_admin",
    separacao_id:separacaoId,
   },{authorization:"Bearer ci-admin-test-token"}));
   assertions(response,503,caso.nome);
   const payload=await response.json();
   assert(bancoGets===0&&saquesGets===0,
    "Vinculo local inconsistente permitiu consulta externa: "+caso.nome);
   assert(payload?.success===false&&
    typeof payload.mensagem==="string"&&payload.mensagem.includes("HOLD"),
    "Vinculo invalido nao gerou bloqueio obrigatorio: "+caso.nome);
   assert(!JSON.stringify(payload).includes(motoboyId)&&
    !JSON.stringify(payload).includes("ci-transfer-link-sandbox"),
    "Auditoria vazou identificador financeiro: "+caso.nome);
  }finally{currentMockFetch=denyNetwork;}
 }
});

Deno.test("varredura bloqueia separacao congelada inconsistente antes de consultar banco",async()=>{
 const edge=handlers.get("asaas")!;
 const separacaoId="ad700001-1111-4111-8111-111111111111";
 const requestId="ad700002-1111-4111-8111-111111111111";
 const motoboyId="edededed-eded-4ede-8ede-ededededed10";
 const adminUid="4b9a0233-6b72-4573-aebd-d596c5b15e1b";
 const valida={id:separacaoId,tipo:"saida",solicitacao_id:requestId,
  motoboy_id:motoboyId,valor_centavos:12000,situacao:"congelada"};
 const casos:{nome:string,altera:Record<string,unknown>}[]=[
  {nome:"id local diferente",altera:{id:"ad700003-1111-4111-8111-111111111111"}},
  {nome:"tipo inesperado",altera:{tipo:"outro"}},
  {nome:"solicitacao inexistente",altera:{solicitacao_id:null}},
  {nome:"solicitacao nao UUID",altera:{solicitacao_id:"pedido-sem-uuid"}},
  {nome:"motoboy nao UUID",altera:{motoboy_id:"beneficiario-invalido"}},
  {nome:"valor zerado",altera:{valor_centavos:0}},
  {nome:"valor negativo",altera:{valor_centavos:-1}},
  {nome:"valor fracionario",altera:{valor_centavos:12000.5}},
  {nome:"valor numerico nao seguro",altera:{valor_centavos:1e20}},
  {nome:"valor local tipo string",altera:{valor_centavos:"12000"}},
 ];
 for(const caso of casos){
  let requisicoesBanco=0,requisicoesVinculo=0;
  try{
   currentMockFetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
    const raw=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
    const u=new URL(raw);
    assert((init?.method??"GET")==="GET","Conferencia local tentou escrita");
    if(u.host==="ci-supabase.invalid"&&u.pathname==="/auth/v1/user")
     return result({id:adminUid,aud:"authenticated",role:"authenticated",
      app_metadata:{},user_metadata:{}});
    if(u.host==="ci-supabase.invalid"&&
       u.pathname==="/rest/v1/catalogo_asaas_separacoes_excepcionais")
     return result({...valida,...caso.altera});
    if(u.host==="ci-supabase.invalid"&&
       u.pathname==="/rest/v1/catalogo_asaas_transferencias_excepcionais_auditoria"){
     requisicoesVinculo++;
     throw Error("A auditoria consultou vinculo invalido: "+caso.nome);
    }
    if(u.host==="api-sandbox.asaas.com"&&u.pathname==="/v3/transfers"){
     requisicoesBanco++;
     throw Error("A auditoria consultou banco com escrow invalido: "+caso.nome);
    }
    throw Error("Rota inesperada no ensaio de escrow: "+u.pathname);
   };
   const response=await edge(post("/functions/v1/catalogo-asaas-financeiro",{
    acao:"auditar_historico_transferencias_excepcionais_sandbox_admin",
    separacao_id:separacaoId,
   },{authorization:"Bearer ci-admin-test-token"}));
   assertions(response,503,caso.nome);
   const payload=await response.json();
   assert(requisicoesBanco===0&&requisicoesVinculo===0,
    "Dados locais inconsistentes acionaram busca posterior: "+caso.nome);
   assert(payload?.success===false&&
    typeof payload.mensagem==="string"&&payload.mensagem.includes("HOLD"),
    "Resposta nao exigiu bloqueio diante de reserva invalida: "+caso.nome);
   assert(!JSON.stringify(payload).includes(motoboyId)&&
    !JSON.stringify(payload).includes(requestId),
    "Auditoria expos beneficiario ou solicitacao: "+caso.nome);
  }finally{currentMockFetch=denyNetwork;}
 }
});

Deno.test("varredura rejeita fracoes de centavo sem arredondar o valor bancario",async()=>{
 const edge=handlers.get("asaas")!;
 const separacaoId="ad600001-1111-4111-8111-111111111111";
 const requestId="ad600002-1111-4111-8111-111111111111";
 const motoboyId="edededed-eded-4ede-8ede-ededededed10";
 const adminUid="4b9a0233-6b72-4573-aebd-d596c5b15e1b";
 const referencia="guia-exc:saida:"+requestId;
 const casos=[
  {nome:"centavos exatos",valor:120,divergencias:0},
  {nome:"fracao de centavo arredondada antes",valor:120.004,divergencias:1},
  {nome:"fracao acima do meio centavo",valor:120.006,divergencias:1},
  {nome:"numero de valor absurdamente grande",valor:1e20,divergencias:1},
 ];
 for(const caso of casos){
  let bankGets=0;
  try{
   currentMockFetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
    const raw=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
    const u=new URL(raw);
    assert((init?.method??"GET")==="GET","Auditoria monetaria tentou escrita");
    if(u.host==="ci-supabase.invalid"&&u.pathname==="/auth/v1/user")
     return result({id:adminUid,aud:"authenticated",role:"authenticated",
      app_metadata:{},user_metadata:{}});
    if(u.host==="ci-supabase.invalid"&&
       u.pathname==="/rest/v1/catalogo_asaas_separacoes_excepcionais")
     return result({id:separacaoId,tipo:"saida",solicitacao_id:requestId,
      motoboy_id:motoboyId,valor_centavos:12000,situacao:"congelada"});
    if(u.host==="ci-supabase.invalid"&&
       u.pathname==="/rest/v1/catalogo_asaas_transferencias_excepcionais_auditoria")
     return result(null);
    if(u.host==="ci-supabase.invalid"&&u.pathname==="/rest/v1/catalogo_asaas_saques")
     return result([]);
    if(u.host==="api-sandbox.asaas.com"&&u.pathname==="/v3/transfers"){
     bankGets++;
     return result({limit:100,offset:0,totalCount:1,hasMore:false,
      data:[{id:"ci-valor-observado-nao-expor",externalReference:referencia,
       value:caso.valor,status:"PENDING",pixAddressKey:"CHAVE_FICTICIA_SIGILOSA"}]});
    }
    throw Error("Rota inesperada na conferencia de valor: "+u.pathname);
   };
   const response=await edge(post("/functions/v1/catalogo-asaas-financeiro",{
    acao:"auditar_historico_transferencias_excepcionais_sandbox_admin",
    separacao_id:separacaoId,
   },{authorization:"Bearer ci-admin-test-token"}));
   assertions(response,200,caso.nome);
   const payload=await response.json(), audit=payload.relatorio;
   assert(bankGets===1&&audit?.divergencias_de_valor===caso.divergencias,
    "Valor bancario nao foi validado rigorosamente: "+caso.nome);
   assert(audit?.conflito_identificado===(caso.divergencias>0),
    "Indicador de conflito divergente: "+caso.nome);
   assert(audit?.pagamento_autorizado===false&&
    audit?.liberacao_autorizada===false&&
    audit?.baixa_realizada===false&&
    audit?.ausencia_de_pix_anterior_comprovada===false,
    "Valor invalido concedeu autorizacao financeira: "+caso.nome);
   assert(!JSON.stringify(payload).includes("CHAVE_FICTICIA_SIGILOSA")&&
    !JSON.stringify(payload).includes("ci-valor-observado-nao-expor"),
    "Dados bancarios expostos: "+caso.nome);
  }finally{currentMockFetch=denyNetwork;}
 }
});

Deno.test("varredura rejeita resposta Asaas enorme ou malformada sem expor dados",async()=>{
 const edge=handlers.get("asaas")!;
 const separacaoId="ad500001-1111-4111-8111-111111111111";
 const requestId="ad500002-1111-4111-8111-111111111111";
 const motoboyId="edededed-eded-4ede-8ede-ededededed10";
 const adminUid="4b9a0233-6b72-4573-aebd-d596c5b15e1b";
 const bankSecret="CHAVE_PIX_BANCO_NAO_EXIBIR";
 const scenarios:{label:string;make:()=>Response}[]=[
  {label:"content-length acima do limite",make:()=>new Response(
   JSON.stringify({detail:bankSecret}),{status:200,headers:{
    "content-type":"application/json","content-length":String(2*1024*1024+1),
   }})},
  {label:"resposta sem MIME JSON",make:()=>new Response(bankSecret,
   {status:200,headers:{"content-type":"text/plain"}})},
  {label:"corpo real supera limite",make:()=>new Response(
   new Uint8Array(2*1024*1024+1),{status:200,headers:{"content-type":"application/json"}})},
  {label:"UTF-8 invalido",make:()=>new Response(
   new Uint8Array([0xc3,0x28]),{status:200,headers:{"content-type":"application/json"}})},
  {label:"JSON truncado",make:()=>new Response(
   '{"data":"'+bankSecret+'"',
   {status:200,headers:{"content-type":"application/json"}})},
 ];
 for(const scenario of scenarios){
  let bankGets=0;
  try{
   currentMockFetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
    const raw=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
    const u=new URL(raw);
    assert((init?.method??"GET")==="GET","Leitura bancária tentou escrita: "+scenario.label);
    if(u.host==="ci-supabase.invalid"&&u.pathname==="/auth/v1/user")
     return result({id:adminUid,aud:"authenticated",role:"authenticated",
      app_metadata:{},user_metadata:{}});
    if(u.host==="ci-supabase.invalid"&&
       u.pathname==="/rest/v1/catalogo_asaas_separacoes_excepcionais")
     return result({id:separacaoId,tipo:"saida",solicitacao_id:requestId,
      motoboy_id:motoboyId,valor_centavos:12000,situacao:"congelada"});
    if(u.host==="ci-supabase.invalid"&&
       u.pathname==="/rest/v1/catalogo_asaas_transferencias_excepcionais_auditoria")
     return result(null);
    if(u.host==="api-sandbox.asaas.com"&&u.pathname==="/v3/transfers"){
     bankGets++;
     return scenario.make();
    }
    throw Error("Rota não prevista no teste de resposta Asaas: "+u.pathname);
   };
   const response=await edge(post("/functions/v1/catalogo-asaas-financeiro",{
    acao:"auditar_historico_transferencias_excepcionais_sandbox_admin",
    separacao_id:separacaoId,
   },{authorization:"Bearer ci-admin-test-token"}));
   assertions(response,503,scenario.label);
   const payload=await response.json();
   assert(bankGets===1, "Auditoria nao fez exatamente um GET: "+scenario.label);
   assert(payload.success===false&&
    typeof payload.mensagem==="string"&&payload.mensagem.includes("HOLD"),
    "Resposta bancária inválida não falhou fechada: "+scenario.label);
   assert(!JSON.stringify(payload).includes(bankSecret)&&!JSON.stringify(payload).includes("bankAccount")&&
    !JSON.stringify(payload).includes("pagamento_autorizado"),
    "Resposta inválida vazou detalhes ou simulou autorização: "+scenario.label);
  }finally{currentMockFetch=denyNetwork;}
 }
});

Deno.test("varredura Asaas detecta referencias duplicadas sem transferir ou baixar saldo",async()=>{
 const edge=handlers.get("asaas")!;
 const separacaoId="ab100001-1111-4111-8111-111111111111";
 const requestId="ab100002-1111-4111-8111-111111111111";
 const motoboyId="edededed-eded-4ede-8ede-ededededed10";
 const ref="guia-exc:saida:"+requestId;
 const adminUid="4b9a0233-6b72-4573-aebd-d596c5b15e1b";
 const calls:string[]=[];
 try{
  currentMockFetch=async (input:RequestInfo|URL,init?:RequestInit)=>{
   const raw=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
   const u=new URL(raw);
   const method=init?.method||"GET";
   calls.push(method+" "+u.host+u.pathname);
   assert(method==="GET","Auditoria realizou método com efeito colateral: "+method);
   if(u.host==="ci-supabase.invalid"&&u.pathname==="/auth/v1/user")
    return result({id:adminUid,aud:"authenticated",role:"authenticated",
     app_metadata:{},user_metadata:{}});
   if(u.host==="ci-supabase.invalid"&&
      u.pathname==="/rest/v1/catalogo_asaas_separacoes_excepcionais")
    return result({id:separacaoId,tipo:"saida",solicitacao_id:requestId,
     motoboy_id:motoboyId,valor_centavos:12000,situacao:"congelada"});
   if(u.host==="ci-supabase.invalid"&&
      u.pathname==="/rest/v1/catalogo_asaas_transferencias_excepcionais_auditoria")
    return result({transferencia_id:"ci-transfer-one",referencia_externa:ref,
     valor_centavos:12000,motoboy_id:motoboyId});
   if(u.host==="ci-supabase.invalid"&&
      u.pathname==="/rest/v1/catalogo_asaas_saques")
    return result(u.searchParams.get("transferencia_id")?.startsWith("in.")
      ?[{transferencia_id:"ci-transfer-two"}]:null);
   if(u.host==="api-sandbox.asaas.com"&&u.pathname==="/v3/transfers"){
    assert(u.searchParams.get("limit")==="100"&&u.searchParams.get("offset")==="0",
      "Consulta não usou paginação segura");
    return result({object:"list",offset:0,limit:100,totalCount:2,hasMore:false,
     data:[
      {id:"ci-transfer-one",externalReference:ref,value:120,status:"DONE",
       pixAddressKey:"chave-pix-ficticia-que-nao-pode-ser-exposta"},
      {id:"ci-transfer-two",externalReference:ref,value:130,status:"PENDING",
       bankAccount:{cpfCnpj:"documento-ficticio-nao-expor"}},
     ]});
   }
   throw new Error("Acesso de teste não mapeado: "+method+" "+u.host+u.pathname);
  };
  const request=post("/functions/v1/catalogo-asaas-financeiro",{
   acao:"auditar_historico_transferencias_excepcionais_sandbox_admin",
   separacao_id:separacaoId,
  },{authorization:"Bearer ci-admin-test-token"});
  const response=await edge(request);
  assertions(response,200,"Varredura autenticada da Edge");
  const payload=await response.json();
  const audit=payload.relatorio;
  assert(payload.success===true&&audit?.transferencias_distintas_com_mesma_referencia===2,
   "Nao identificou 2 transferencias da mesma referencia");
  assert(audit?.referencias_com_id_diferente_do_vinculado===1,
   "Nao identificou ID diferente do esperado");
  assert(audit?.id_tambem_usado_em_saque_comum===false &&
   audit?.ids_da_referencia_tambem_em_saques_comuns===1,
   "Nao detectou outro ID do banco reutilizado em saque comum");
  assert(audit?.divergencias_de_valor===1,
   "Nao identificou valor divergente");
  assert(audit?.conflito_identificado===true&&audit?.estados_done_encontrados===1,
   "Nao manteve alerta de duplicidade com DONE");
  assert(audit?.listagem_consultada_ate_o_fim===true,
   "Uma pagina com hasMore=false foi marcada incompleta");
  assert(audit?.pagamento_autorizado===false&&audit?.baixa_realizada===false&&
   audit?.liberacao_autorizada===false&&
   audit?.ausencia_de_pix_anterior_comprovada===false,
   "Varredura criou autorizacao financeira insegura");
  const serialized=JSON.stringify(payload);
  assert(!serialized.includes("chave-pix-ficticia")&&
   !serialized.includes("documento-ficticio"),
   "Dados pessoais do provedor vazaram para o navegador");
  assert(calls.some(x=>x.includes("api-sandbox.asaas.com/v3/transfers")),
   "Nao consultou lista bancaria por GET");
 }finally{currentMockFetch=denyNetwork;}
});

Deno.test("varredura detecta transferência de saque comum sem vínculo excepcional prévio",async()=>{
 const edge=handlers.get("asaas")!;
 const separacaoId="af100001-1111-4111-8111-111111111111";
 const requestId="af100002-1111-4111-8111-111111111111";
 const motoboyId="edededed-eded-4ede-8ede-ededededed10";
 const adminUid="4b9a0233-6b72-4573-aebd-d596c5b15e1b";
 const referencia="guia-exc:saida:"+requestId;
 let payoutReads=0,transferGets=0;
 try{
  currentMockFetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
   const raw=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
   const u=new URL(raw);
   assert((init?.method??"GET")==="GET","Auditoria tentou escrita");
   if(u.host==="ci-supabase.invalid"&&u.pathname==="/auth/v1/user")
    return result({id:adminUid,aud:"authenticated",role:"authenticated",
     app_metadata:{},user_metadata:{}});
   if(u.host==="ci-supabase.invalid"&&
      u.pathname==="/rest/v1/catalogo_asaas_separacoes_excepcionais")
    return result({id:separacaoId,tipo:"saida",solicitacao_id:requestId,
     motoboy_id:motoboyId,valor_centavos:12000,situacao:"congelada"});
   if(u.host==="ci-supabase.invalid"&&
      u.pathname==="/rest/v1/catalogo_asaas_transferencias_excepcionais_auditoria")
    return result(null); // Sem vínculo excepcional, exige auditoria dos IDs do banco.
   if(u.host==="ci-supabase.invalid"&&u.pathname==="/rest/v1/catalogo_asaas_saques"){
    payoutReads++;
    assert(u.searchParams.get("transferencia_id")?.startsWith("in."),
     "Somente leitura batelada por IDs bancários observados");
    return result([{transferencia_id:"ci-saida-ordinaria"}]);
   }
   if(u.host==="api-sandbox.asaas.com"&&u.pathname==="/v3/transfers"){
    transferGets++;
    return result({limit:100,offset:0,totalCount:1,hasMore:false,data:[{
     id:"ci-saida-ordinaria",externalReference:referencia,value:120,status:"DONE",
     bankAccount:{cpfCnpj:"DOCUMENTO_FICTICIO_PROIBIDO_NA_RESPOSTA"},
    }]});
   }
   throw Error("Rota inesperada na auditoria cruzada: "+u.pathname);
  };
  const response=await edge(post("/functions/v1/catalogo-asaas-financeiro",{
   acao:"auditar_historico_transferencias_excepcionais_sandbox_admin",
   separacao_id:separacaoId,
  },{authorization:"Bearer ci-admin-test-token"}));
  assertions(response,200,"Conflito entre referencia excepcional e saque comum");
  const payload=await response.json();
  const audit=payload.relatorio;
  assert(payoutReads===1&&transferGets===1,"Faltou consulta independente ao saque comum");
  assert(audit?.id_tambem_usado_em_saque_comum===false,
   "ID vinculado inexistente foi inventado");
  assert(audit?.ids_da_referencia_tambem_em_saques_comuns===1 &&
   audit?.conflito_identificado===true,
   "Transferência ordinária da mesma referência não foi sinalizada");
  assert(audit?.historico_bancario_independente_comprovado===false &&
   audit?.destinatario_original_confirmado===false &&
   audit?.ausencia_de_pix_anterior_comprovada===false &&
   audit?.pagamento_autorizado===false && audit?.liberacao_autorizada===false &&
   audit?.baixa_realizada===false && audit?.movimenta_dinheiro===false,
   "Auditoria cruzada desbloqueou dinheiro");
  assert(!JSON.stringify(payload).includes("DOCUMENTO_FICTICIO_PROIBIDO_NA_RESPOSTA") &&
   !JSON.stringify(payload).includes("ci-saida-ordinaria"),
   "Auditoria vazou dados do provedor ou ID bancário");
 }finally{currentMockFetch=denyNetwork;}
});

Deno.test("varredura identifica mesmo ID com referencias distintas sem vinculo local",async()=>{
 const edge=handlers.get("asaas")!;
 const separacaoId="ad200001-1111-4111-8111-111111111111";
 const requestId="ad200002-1111-4111-8111-111111111111";
 const motoboyId="edededed-eded-4ede-8ede-ededededed10";
 const adminUid="4b9a0233-6b72-4573-aebd-d596c5b15e1b";
 const referencia="guia-exc:saida:"+requestId;
 let consultasSaques=0;
 try{
  currentMockFetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
   const raw=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
   const u=new URL(raw);
   assert((init?.method??"GET")==="GET","Auditoria cruzada tentou escrita");
   if(u.host==="ci-supabase.invalid"&&u.pathname==="/auth/v1/user")
    return result({id:adminUid,aud:"authenticated",role:"authenticated",
     app_metadata:{},user_metadata:{}});
   if(u.host==="ci-supabase.invalid"&&
      u.pathname==="/rest/v1/catalogo_asaas_separacoes_excepcionais")
    return result({id:separacaoId,tipo:"saida",solicitacao_id:requestId,
     motoboy_id:motoboyId,valor_centavos:12000,situacao:"congelada"});
   if(u.host==="ci-supabase.invalid"&&
      u.pathname==="/rest/v1/catalogo_asaas_transferencias_excepcionais_auditoria")
    return result(null);
   if(u.host==="ci-supabase.invalid"&&u.pathname==="/rest/v1/catalogo_asaas_saques"){
    consultasSaques++;
    assert(u.searchParams.get("transferencia_id")?.startsWith("in."),
     "Consulta de saques comuns deve ser limitada aos IDs observados");
    return result([]);
   }
   if(u.host==="api-sandbox.asaas.com"&&u.pathname==="/v3/transfers")
    return result({limit:100,offset:0,totalCount:2,hasMore:false,data:[
     {id:"ci-id-reutilizado-oculto",externalReference:"referencia-alheia",
      value:120,status:"PENDING"},
     {id:"ci-id-reutilizado-oculto",externalReference:referencia,
      value:120,status:"DONE",bankAccount:{cpfCnpj:"CPF_NAO_EXPOR"}},
    ]});
   throw Error("Rota inesperada no ensaio de referencias: "+u.pathname);
  };
  const response=await edge(post("/functions/v1/catalogo-asaas-financeiro",{
   acao:"auditar_historico_transferencias_excepcionais_sandbox_admin",
   separacao_id:separacaoId,
  },{authorization:"Bearer ci-admin-test-token"}));
  assertions(response,200,"ID compartilhado por duas referencias");
  const payload=await response.json();
  const audit=payload.relatorio;
  assert(consultasSaques===1,"Nao verificou se o ID ja pertence a saque comum");
  assert(audit?.referencias_iguais_encontradas===1 &&
   audit?.ids_da_referencia_com_outra_referencia===1 &&
   audit?.ids_da_referencia_tambem_em_saques_comuns===0 &&
   audit?.ids_repetidos_na_listagem===0 &&
   audit?.conflito_identificado===true,
   "Conflito entre referencias diferentes ficou invisivel");
  assert(audit?.pagamento_autorizado===false &&
   audit?.liberacao_autorizada===false && audit?.baixa_realizada===false &&
   audit?.movimenta_dinheiro===false &&
   audit?.ausencia_de_pix_anterior_comprovada===false,
   "Um ID suspeito abriu caminho de pagamento");
  assert(!JSON.stringify(payload).includes("CPF_NAO_EXPOR") &&
   !JSON.stringify(payload).includes("ci-id-reutilizado-oculto"),
   "ID bancario ou CPF foram devolvidos ao navegador");
 }finally{currentMockFetch=denyNetwork;}
});

Deno.test("varredura de listagem incompleta preserva HOLD em 12 paginas",async()=>{
 const edge=handlers.get("asaas")!;
 const separacaoId="ab100001-1111-4111-8111-111111111111";
 const requestId="ab100002-1111-4111-8111-111111111111";
 const motoboyId="edededed-eded-4ede-8ede-ededededed10";
 const adminUid="4b9a0233-6b72-4573-aebd-d596c5b15e1b";
 let pages=0;
 try{
  currentMockFetch=async (input:RequestInfo|URL,init?:RequestInit)=>{
   const raw=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
   const u=new URL(raw);
   assert((init?.method||"GET")==="GET","Varredura tentou POST");
   if(u.host==="ci-supabase.invalid"&&u.pathname==="/auth/v1/user")
    return result({id:adminUid,aud:"authenticated",role:"authenticated",
     app_metadata:{},user_metadata:{}});
   if(u.host==="ci-supabase.invalid"&&
      u.pathname==="/rest/v1/catalogo_asaas_separacoes_excepcionais")
    return result({id:separacaoId,tipo:"saida",solicitacao_id:requestId,
     motoboy_id:motoboyId,valor_centavos:12000,situacao:"congelada"});
   if(u.host==="ci-supabase.invalid"&&
      u.pathname==="/rest/v1/catalogo_asaas_transferencias_excepcionais_auditoria")
    return result(null);
   if(u.host==="api-sandbox.asaas.com"&&u.pathname==="/v3/transfers"){
    assert(Number(u.searchParams.get("offset"))===pages*100,
     "Deslocamento de paginação Asaas incorreto");
    pages++;
    return result({offset:(pages-1)*100,limit:100,totalCount:1201,hasMore:true,
     data:Array.from({length:100},(_,i)=>({
      id:"ci-irrelevante-"+pages+"-"+i,externalReference:"outra-referencia",
      status:"DONE",value:120
     }))});
   }
   throw new Error("Caminho não esperado no teste: "+u.pathname);
  };
  const response=await edge(post("/functions/v1/catalogo-asaas-financeiro",{
   acao:"auditar_historico_transferencias_excepcionais_sandbox_admin",
   separacao_id:separacaoId
  },{authorization:"Bearer ci-admin-test-token"}));
  assertions(response,200,"Listagem incompleta");
  const audit=(await response.json()).relatorio;
  assert(pages===12&&audit?.pagina_limite===12,
   "Não limitou varredura a 12 páginas");
  assert(audit?.listagem_consultada_ate_o_fim===false&&
   audit?.ausencia_de_pix_anterior_comprovada===false&&
   audit?.pagamento_autorizado===false&&audit?.baixa_realizada===false,
   "Varredura truncada não manteve HOLD");
 }finally{currentMockFetch=denyNetwork;}
});

Deno.test("varredura recusa paginas Asaas parciais, parametros incoerentes e totalCount invalido",async()=>{
 const edge=handlers.get("asaas")!;
 const separacaoId="ac100001-1111-4111-8111-111111111111";
 const requestId="ac100002-1111-4111-8111-111111111111";
 const motoboyId="edededed-eded-4ede-8ede-ededededed10";
 const adminUid="4b9a0233-6b72-4573-aebd-d596c5b15e1b";
 const full=Array.from({length:100},(_,i)=>({
  id:"ci-irrelevante-"+i,externalReference:"outra-referencia",value:100,status:"PENDING"
 }));
 const malformed=[
  {label:"pagina parcial com hasMore=true",page:{limit:100,offset:0,totalCount:500,hasMore:true,data:full.slice(0,40)}},
  {label:"pagina vazia com hasMore=true",page:{limit:100,offset:0,totalCount:500,hasMore:true,data:[]}},
  {label:"limite reduzido pelo provedor",page:{limit:20,offset:0,totalCount:500,hasMore:true,data:full.slice(0,20)}},
  {label:"limite omitido",page:{offset:0,totalCount:2,hasMore:false,data:full.slice(0,2)}},
  {label:"offset divergente",page:{limit:100,offset:50,totalCount:500,hasMore:true,data:full}},
  {label:"offset omitido",page:{limit:100,totalCount:2,hasMore:false,data:full.slice(0,2)}},
  {label:"totalCount nao inteiro",page:{limit:100,offset:0,totalCount:"2",hasMore:false,data:full.slice(0,2)}},
  {label:"totalCount menor que dados",page:{limit:100,offset:0,totalCount:1,hasMore:false,data:full.slice(0,2)}},
  {label:"hasMore falso mas totalCount aponta mais registros",page:{limit:100,offset:0,totalCount:6,hasMore:false,data:full.slice(0,2)}},
  {label:"hasMore verdadeiro apesar de totalCount completo",page:{limit:100,offset:0,totalCount:100,hasMore:true,data:full}},
 ];
 for(const scenario of malformed){
  let bankGets=0;
  try{
   currentMockFetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
    const raw=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
    const u=new URL(raw);
    assert((init?.method??"GET")==="GET","A auditoria tentou mutar estado");
    if(u.host==="ci-supabase.invalid"&&u.pathname==="/auth/v1/user")
     return result({id:adminUid,aud:"authenticated",role:"authenticated",
      app_metadata:{},user_metadata:{}});
    if(u.host==="ci-supabase.invalid"&&
       u.pathname==="/rest/v1/catalogo_asaas_separacoes_excepcionais")
     return result({id:separacaoId,tipo:"saida",solicitacao_id:requestId,
      motoboy_id:motoboyId,valor_centavos:12000,situacao:"congelada"});
    if(u.host==="ci-supabase.invalid"&&
       u.pathname==="/rest/v1/catalogo_asaas_transferencias_excepcionais_auditoria")
     return result(null);
    if(u.host==="api-sandbox.asaas.com"&&u.pathname==="/v3/transfers"){
     bankGets++;
     return result(scenario.page);
    }
    throw Error("Caminho inesperado: "+u.pathname);
   };
   const response=await edge(post("/functions/v1/catalogo-asaas-financeiro",{
    acao:"auditar_historico_transferencias_excepcionais_sandbox_admin",
    separacao_id:separacaoId,
   },{authorization:"Bearer ci-admin-test-token"}));
   assertions(response,503,scenario.label);
   const body=await response.json();
   assert(body.success===false && !JSON.stringify(body).includes("listagem_consultada_ate_o_fim"),
    "Falha de paginacao foi tratada como auditoria concluida: "+scenario.label);
   assert(bankGets===1,"Paginacao ruim consultou paginas adicionais: "+scenario.label);
  }finally{currentMockFetch=denyNetwork;}
 }
});

Deno.test("varredura em duas paginas detecta ID de transferencia repetido e mantém HOLD",async()=>{
 const edge=handlers.get("asaas")!;
 const separacaoId="ad100001-1111-4111-8111-111111111111";
 const requestId="ad100002-1111-4111-8111-111111111111";
 const motoboyId="edededed-eded-4ede-8ede-ededededed10";
 const adminUid="4b9a0233-6b72-4573-aebd-d596c5b15e1b";
 const referencia="guia-exc:saida:"+requestId;
 const repetida={
  id:"ci-banco-repetido",externalReference:referencia,value:120,status:"DONE",
  pixAddressKey:"chave-ficticia-nao-expor",
 };
 const offsets:number[]=[];
 try{
  currentMockFetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
   const raw=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
   const u=new URL(raw);
   assert((init?.method??"GET")==="GET","Varredura executou metodo com escrita");
   if(u.host==="ci-supabase.invalid" && u.pathname==="/auth/v1/user")
    return result({id:adminUid,aud:"authenticated",role:"authenticated",
     app_metadata:{},user_metadata:{}});
   if(u.host==="ci-supabase.invalid" &&
      u.pathname==="/rest/v1/catalogo_asaas_separacoes_excepcionais")
    return result({id:separacaoId,tipo:"saida",solicitacao_id:requestId,
     motoboy_id:motoboyId,valor_centavos:12000,situacao:"congelada"});
   if(u.host==="ci-supabase.invalid" &&
      u.pathname==="/rest/v1/catalogo_asaas_transferencias_excepcionais_auditoria")
    return result({transferencia_id:"ci-banco-repetido",referencia_externa:referencia,
     valor_centavos:12000,motoboy_id:motoboyId});
   if(u.host==="ci-supabase.invalid" &&
      u.pathname==="/rest/v1/catalogo_asaas_saques")
    return result(u.searchParams.get("transferencia_id")?.startsWith("in.")?[]:null);
   if(u.host==="api-sandbox.asaas.com" && u.pathname==="/v3/transfers"){
    assert(u.searchParams.get("limit")==="100","limite foi alterado");
    const offset=Number(u.searchParams.get("offset"));
    offsets.push(offset);
    if(offset===0)return result({
     limit:100,offset:0,totalCount:101,hasMore:true,data:[
      repetida,
      ...Array.from({length:99},(_,i)=>({
       id:"ci-outro-"+i,externalReference:"outra-referencia",
       value:120,status:"PENDING"
      }))
     ]
    });
    if(offset===100)return result({
     limit:100,offset:100,totalCount:101,hasMore:false,data:[repetida]
    });
   }
   throw Error("Rota inesperada no teste de paginacao: "+u.pathname);
  };
  const response=await edge(post("/functions/v1/catalogo-asaas-financeiro",{
   acao:"auditar_historico_transferencias_excepcionais_sandbox_admin",
   separacao_id:separacaoId,
  },{authorization:"Bearer ci-admin-test-token"}));
  assertions(response,200,"Auditoria de duas paginas");
  const payload=await response.json();
  const audit=payload.relatorio;
  assert(offsets.join(",")==="0,100","Pagina 2 nao foi percorrida corretamente");
  assert(audit?.paginas_examinadas===2&&audit?.transferencias_examinadas===101,
   "Auditoria nao contabilizou as duas paginas");
  assert(audit?.ids_repetidos_na_listagem===1&&audit?.conflito_identificado===true,
   "ID repetido em paginas diferentes nao causou conflito");
  assert(audit?.listagem_consultada_ate_o_fim===true&&
   audit?.ausencia_de_pix_anterior_comprovada===false&&
   audit?.pagamento_autorizado===false&&audit?.liberacao_autorizada===false&&
   audit?.baixa_realizada===false&&audit?.movimenta_dinheiro===false,
   "Duplicidade bancária autorizou movimentacao ou atestou ausencia de Pix");
  assert(!JSON.stringify(payload).includes("chave-ficticia-nao-expor"),
   "Auditoria vazou a chave Pix recebida do provedor");
 }finally{currentMockFetch=denyNetwork;}
});

Deno.test("varredura marca IDs ausentes ou malformados mesmo fora da referencia",async()=>{
 const edge=handlers.get("asaas")!;
 const separacaoId="ad400001-1111-4111-8111-111111111111";
 const requestId="ad400002-1111-4111-8111-111111111111";
 const motoboyId="edededed-eded-4ede-8ede-ededededed10";
 const adminUid="4b9a0233-6b72-4573-aebd-d596c5b15e1b";
 let bankGets=0;
 try{
  currentMockFetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
   const raw=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
   const u=new URL(raw);
   assert((init?.method??"GET")==="GET","Auditoria de IDs ausentes tentou escrita");
   if(u.host==="ci-supabase.invalid"&&u.pathname==="/auth/v1/user")
    return result({id:adminUid,aud:"authenticated",role:"authenticated",
     app_metadata:{},user_metadata:{}});
   if(u.host==="ci-supabase.invalid"&&
      u.pathname==="/rest/v1/catalogo_asaas_separacoes_excepcionais")
    return result({id:separacaoId,tipo:"saida",solicitacao_id:requestId,
     motoboy_id:motoboyId,valor_centavos:12000,situacao:"congelada"});
   if(u.host==="ci-supabase.invalid"&&
      u.pathname==="/rest/v1/catalogo_asaas_transferencias_excepcionais_auditoria")
    return result(null);
   if(u.host==="ci-supabase.invalid"&&u.pathname==="/rest/v1/catalogo_asaas_saques")
    throw Error("Nenhum ID da referencia alvo exige consulta de saques");
   if(u.host==="api-sandbox.asaas.com"&&u.pathname==="/v3/transfers"){
    bankGets++;
    return result({limit:100,offset:0,totalCount:3,hasMore:false,data:[
     {externalReference:"ref-nao-relacionada",value:120,status:"DONE",
      pixAddressKey:"CHAVE_PRIVADA_NAO_EXIBIR"},
     {id:" ci-id-com-espacos ",externalReference:"outra-referencia",
      value:120,status:"PENDING"},
     {id:"ci-id-valido",externalReference:"outra-referencia",value:120,
      status:"PENDING"},
    ]});
   }
   throw Error("Rota inesperada no ensaio de IDs malformados: "+u.pathname);
  };
  const response=await edge(post("/functions/v1/catalogo-asaas-financeiro",{
   acao:"auditar_historico_transferencias_excepcionais_sandbox_admin",
   separacao_id:separacaoId,
  },{authorization:"Bearer ci-admin-test-token"}));
  assertions(response,200,"IDs bancarios globais invalidos");
  const payload=await response.json();
  const audit=payload.relatorio;
  assert(bankGets===1&&audit?.listagem_consultada_ate_o_fim===true,
   "Varredura pontual nao concluiu consulta da pagina");
  assert(audit?.referencias_iguais_encontradas===0 &&
   audit?.ids_sem_identificador_globais===2 &&
   audit?.ids_repetidos_globais===0 &&
   audit?.conflito_identificado===true,
   "Registros sem ID bancario fora da referencia nao geraram conflito");
  assert(audit?.ausencia_de_pix_anterior_comprovada===false &&
   audit?.destinatario_original_confirmado===false &&
   audit?.pagamento_autorizado===false &&
   audit?.liberacao_autorizada===false &&
   audit?.baixa_realizada===false&&audit?.movimenta_dinheiro===false,
   "ID invalido desbloqueou valor ou afirmou prova bancaria");
  assert(!JSON.stringify(payload).includes("CHAVE_PRIVADA_NAO_EXIBIR") &&
   !JSON.stringify(payload).includes("ci-id-com-espacos"),
   "Identificador bancario ou chave Pix vazaram ao navegador");
 }finally{currentMockFetch=denyNetwork;}
});

Deno.test("varredura detecta ID repetido fora da referencia mesmo com totalCount estavel",async()=>{
 const edge=handlers.get("asaas")!;
 const separacaoId="ad300001-1111-4111-8111-111111111111";
 const requestId="ad300002-1111-4111-8111-111111111111";
 const motoboyId="edededed-eded-4ede-8ede-ededededed10";
 const adminUid="4b9a0233-6b72-4573-aebd-d596c5b15e1b";
 let paginas=0;
 const duplicada={id:"ci-id-alheio-repetido",externalReference:"ref-sem-relacao",
  value:120,status:"PENDING",pixAddressKey:"PIX_SIGILOSO_TESTE"};
 try{
  currentMockFetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
   const raw=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
   const u=new URL(raw);
   assert((init?.method??"GET")==="GET","Varredura global tentou escrita");
   if(u.host==="ci-supabase.invalid"&&u.pathname==="/auth/v1/user")
    return result({id:adminUid,aud:"authenticated",role:"authenticated",
     app_metadata:{},user_metadata:{}});
   if(u.host==="ci-supabase.invalid"&&
      u.pathname==="/rest/v1/catalogo_asaas_separacoes_excepcionais")
    return result({id:separacaoId,tipo:"saida",solicitacao_id:requestId,
     motoboy_id:motoboyId,valor_centavos:12000,situacao:"congelada"});
   if(u.host==="ci-supabase.invalid"&&
      u.pathname==="/rest/v1/catalogo_asaas_transferencias_excepcionais_auditoria")
    return result(null);
   if(u.host==="ci-supabase.invalid"&&u.pathname==="/rest/v1/catalogo_asaas_saques")
    throw Error("Nenhum ID da referencia alvo exige consulta de saques");
   if(u.host==="api-sandbox.asaas.com"&&u.pathname==="/v3/transfers"){
    paginas++;
    if(u.searchParams.get("offset")==="0")return result({
     limit:100,offset:0,totalCount:101,hasMore:true,
     data:[duplicada,...Array.from({length:99},(_,i)=>({
      id:"ci-id-outro-"+i,externalReference:"ref-sem-relacao",value:120,status:"PENDING"
     }))],
    });
    if(u.searchParams.get("offset")==="100")return result({
     limit:100,offset:100,totalCount:101,hasMore:false,data:[duplicada],
    });
   }
   throw Error("Rota inesperada no ensaio global: "+u.pathname);
  };
  const response=await edge(post("/functions/v1/catalogo-asaas-financeiro",{
   acao:"auditar_historico_transferencias_excepcionais_sandbox_admin",
   separacao_id:separacaoId,
  },{authorization:"Bearer ci-admin-test-token"}));
  assertions(response,200,"ID bancario global repetido");
  const payload=await response.json();
  const audit=payload.relatorio;
  assert(paginas===2&&audit?.listagem_consultada_ate_o_fim===true,
   "Listagem paginada no Sandbox nao foi percorrida");
  assert(audit?.referencias_iguais_encontradas===0 &&
   audit?.ids_repetidos_na_listagem===0 &&
   audit?.ids_repetidos_globais===1 &&
   audit?.conflito_identificado===true,
   "Duplicacao fora da referencia alvo nao sinalizou amostra instavel");
  assert(audit?.ausencia_de_pix_anterior_comprovada===false &&
   audit?.destinatario_original_confirmado===false &&
   audit?.pagamento_autorizado===false &&
   audit?.liberacao_autorizada===false &&
   audit?.baixa_realizada===false && audit?.movimenta_dinheiro===false,
   "Varredura com duplicata global permitiu dinheiro");
  assert(!JSON.stringify(payload).includes("ci-id-alheio-repetido") &&
   !JSON.stringify(payload).includes("PIX_SIGILOSO_TESTE"),
   "Resposta de diagnostico revelou ID/Pix do provedor");
 }finally{currentMockFetch=denyNetwork;}
});

Deno.test("varredura falha fechada se totalCount muda entre duas paginas",async()=>{
 const edge=handlers.get("asaas")!;
 const separacaoId="ae100001-1111-4111-8111-111111111111";
 const requestId="ae100002-1111-4111-8111-111111111111";
 const motoboyId="edededed-eded-4ede-8ede-ededededed10";
 const adminUid="4b9a0233-6b72-4573-aebd-d596c5b15e1b";
 let pages=0;
 const calls:string[]=[];
 try{
  currentMockFetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
   const raw=typeof input==="string"?input:input instanceof URL?input.toString():input.url;
   const u=new URL(raw);
   calls.push((init?.method??"GET")+" "+u.pathname);
   assert((init?.method??"GET")==="GET","Auditoria tentou escrita");
   if(u.host==="ci-supabase.invalid"&&u.pathname==="/auth/v1/user")
    return result({id:adminUid,aud:"authenticated",role:"authenticated",
     app_metadata:{},user_metadata:{}});
   if(u.host==="ci-supabase.invalid"&&
      u.pathname==="/rest/v1/catalogo_asaas_separacoes_excepcionais")
    return result({id:separacaoId,tipo:"saida",solicitacao_id:requestId,
     motoboy_id:motoboyId,valor_centavos:12000,situacao:"congelada"});
   if(u.host==="ci-supabase.invalid"&&
      u.pathname==="/rest/v1/catalogo_asaas_transferencias_excepcionais_auditoria")
    return result(null);
   if(u.host==="api-sandbox.asaas.com"&&u.pathname==="/v3/transfers"){
    const offset=Number(u.searchParams.get("offset"));
    pages++;
    if(offset===0)return result({
     limit:100,offset:0,totalCount:101,hasMore:true,
     data:Array.from({length:100},(_,i)=>({
      id:"ci-first-"+i,externalReference:"outra-referencia",
      value:120,status:"PENDING"
     }))
    });
    if(offset===100)return result({
     limit:100,offset:100,totalCount:102,hasMore:false,
     data:[{id:"ci-second-1",externalReference:"outra-referencia",value:120,status:"DONE"},
      {id:"ci-second-2",externalReference:"outra-referencia",value:120,status:"DONE"}]
    });
   }
   throw Error("Rota inesperada no teste de contagem: "+u.pathname);
  };
  const response=await edge(post("/functions/v1/catalogo-asaas-financeiro",{
   acao:"auditar_historico_transferencias_excepcionais_sandbox_admin",
   separacao_id:separacaoId
  },{authorization:"Bearer ci-admin-test-token"}));
  assertions(response,503,"Mudanca de totalCount invalida auditoria");
  const payload=await response.json();
  assert(payload.success===false&&!JSON.stringify(payload).includes("listagem_consultada_ate_o_fim"),
   "Paginacao variavel foi tratada como consulta conclusiva");
  assert(pages===2,"Nao detectou mudanca na segunda pagina");
  assert(calls.every(c=>c.startsWith("GET ")),"Acesso de escrita durante auditoria");
 }finally{currentMockFetch=denyNetwork;}
});

Deno.test("checkouts desligados recusam criacao HTTP antes de qualquer acesso externo", async () => {
  const start = forbiddenRequests;
  const pix = handlers.get("pix")!;
  assertions(await pix(post("/functions/v1/catalogo-pedido-pix", {})), 503, "Pix desligado");
  assertions(await pix(new Request(SB_URL + "/functions/v1/catalogo-pedido-pix", { method: "GET" })), 405, "Pix GET");
  assertions(await pix(new Request(SB_URL + "/functions/v1/catalogo-pedido-pix", { method: "OPTIONS" })), 200, "Pix CORS");

  const offline = handlers.get("offline")!;
  assertions(await offline(post("/functions/v1/catalogo-pedido-offline", {
    acao: "criar_pedido_offline", comercio_id: "comercio-de-exemplo",
    forma_pagamento: "dinheiro",
  })), 503, "Offline desligado");
  assertions(await offline(post("/functions/v1/catalogo-pedido-offline", {
    acao: "confirmar_entrega",
  })), 410, "Confirmacao de entrega sem auth proibida");
  assertions(await offline(post("/functions/v1/catalogo-pedido-offline", {
    acao: "acao_desconhecida",
  })), 400, "Acao desconhecida");
  assertions(await offline(new Request(SB_URL + "/functions/v1/catalogo-pedido-offline", { method: "GET" })), 405, "Offline GET");
  assert(forbiddenRequests === start, "Checkout desligado fez tentativa de conexao");
});

Deno.test("fatura nao aceita emissao anonima nem webhook sem HMAC", async () => {
  const start = forbiddenRequests;
  const fatura = handlers.get("fatura")!;
  assertions(await fatura(post("/functions/v1/catalogo-fatura-pix", {
    acao: "criar_cobranca", comercio_id: "comercio-de-exemplo",
    competencia: "2026-10",
  })), 401, "Fatura sem autenticação");
  assertions(await fatura(post("/functions/v1/catalogo-fatura-pix/webhook?type=orders_v2&data.id=order-ci-1", {
    type: "orders_v2", data: { id: "order-ci-1" },
  })), 401, "Fatura webhook sem assinatura");
  assertions(await fatura(new Request(SB_URL + "/functions/v1/catalogo-fatura-pix", { method: "GET" })), 405, "Fatura GET");
  assert(forbiddenRequests === start, "Fatura sem HMAC/autenticacao tentou rede");
});

Deno.test("webhook MP exige HMAC correto ANTES da consulta ao pedido", async () => {
  const start = forbiddenRequests;
  const webhook = handlers.get("webhook")!;
  const url = `/functions/v1/mercadopago-marketplace-webhook?type=payment&data.id=${PAYMENT_ID}`;
  assertions(await webhook(post(url, { type: "payment", data: { id: PAYMENT_ID } })), 401, "Webhook sem HMAC");
  assertions(await webhook(post(url, { type: "payment", data: { id: PAYMENT_ID } }, {
    "x-request-id": "fake", "x-signature": "ts=0,v1=" + "0".repeat(64),
  })), 401, "Webhook com HMAC falso");
  const good = await signedHeaders(PAYMENT_ID);
  assertions(await webhook(post(url.replace(PAYMENT_ID, "pay-ci-trocado"),
    { type: "payment", data: { id: "pay-ci-trocado" } }, good)), 401, "HMAC de outro pagamento");
  assertions(await webhook(post(url, { type: "payment", data: { id: "pay-ci-trocado" } }, good)), 401, "Data ID conflitante");
  assertions(await webhook(new Request(SB_URL + "/functions/v1/mercadopago-marketplace-webhook", { method: "GET" })), 405, "Webhook GET");
  assert(forbiddenRequests === start, "Webhook invalido fez tentativa de rede");
});

Deno.test("webhook HMAC valido consulta fatos autenticados e aplica RPC financeira exata", async () => {
  const webhook = handlers.get("webhook")!;
  const providerAccessToken = "ci-mercadopago-token-nao-real";
  const cipher = await encryptAesGcm(providerAccessToken, ENC_KEY);
  const order = {
    id: ORDER_ID, comercio_id: "comercio-de-exemplo",
    referencia_externa: REF, provedor: "mercadopago",
    payment_id: PAYMENT_ID, order_id: null,
    total_centavos: 101, versao_financeira: 2,
    taxa_plataforma_centavos: 5, taxa_motoboy_centavos: 2,
    taxa_total_centavos: 7, status: "aguardando_pagamento",
    status_pagamento: "pendente", metadata: {},
  };
  const receiver = {
    status: "ativo", conta_externa_id: "1234",
    oauth_access_token_enc: cipher,
  };
  const payment = {
    id: PAYMENT_ID, external_reference: REF, collector_id: 1234,
    currency_id: "BRL", transaction_amount: 1.01,
    application_fee: 0.07, status: "approved",
  };
  const url = `/functions/v1/mercadopago-marketplace-webhook?type=payment&data.id=${PAYMENT_ID}`;
  let calls: string[] = [];
  let rpcPayload: Record<string, unknown> | null = null;
  let auditPatch: Record<string, unknown> | null = null;
  let actualPayment = structuredClone(payment);
  try {
    currentMockFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const u = new URL(rawUrl);
      calls.push(`${init?.method || "GET"} ${u.host}${u.pathname}`);
      if (u.host === "ci-supabase.invalid" && u.pathname === "/rest/v1/catalogo_pedidos"
          && u.searchParams.has("payment_id") && (init?.method || "GET") === "GET") return result(order);
      if (u.host === "ci-supabase.invalid" && u.pathname === "/rest/v1/catalogo_pedidos"
          && (init?.method || "GET") === "GET" && u.searchParams.has("id")) return result(order);
      if (u.host === "ci-supabase.invalid" && u.pathname === "/rest/v1/catalogo_pedidos"
          && init?.method === "PATCH") {
        auditPatch = JSON.parse(String(init.body));
        return result({ id: ORDER_ID });
      }
      if (u.host === "ci-supabase.invalid" && u.pathname === "/rest/v1/catalogo_recebedores"
          && (init?.method || "GET") === "GET") return result(receiver);
      if (u.host === "api.mercadopago.com" && u.pathname === `/v1/payments/${PAYMENT_ID}`
          && (init?.method || "GET") === "GET") {
        assert(new Headers(init?.headers).get("Authorization") === `Bearer ${providerAccessToken}`,
          "Consulta do MP sem token OAuth do comercio");
        return result(actualPayment);
      }
      if (u.host === "ci-supabase.invalid" && u.pathname === "/rest/v1/rpc/catalogo_aplicar_pagamento_v2"
          && init?.method === "POST") {
        rpcPayload = JSON.parse(String(init.body));
        const hasFeeProof = rpcPayload?.p_taxa_centavos === 7 && rpcPayload?.p_status === "aprovado";
        return result({
          ok: true, status_pagamento: hasFeeProof ? "aprovado" : "contestado",
          financiamento_comprovado: hasFeeProof,
        });
      }
      throw new Error(`Rede nao autorizada no CI: ${u.host}${u.pathname}`);
    };
    const headers = await signedHeaders();
    const good = await webhook(post(url, { type: "payment", id: "notificacao-999",
      data: { id: PAYMENT_ID }, transaction_amount: 99999, application_fee: 0,
    }, headers));
    assertions(good, 200, "Webhook assinado");
    const response = await good.json();
    assert(response.success === true && response.taxa_centavos === 7, "Resposta perdeu taxa verificada");
    assert(rpcPayload?.p_pedido_id === ORDER_ID, "RPC para pedido errado");
    assert(rpcPayload?.p_valor_centavos === 101, "Webhook usou valor nao autenticado");
    assert(rpcPayload?.p_taxa_centavos === 7, "Webhook usou taxa falsa do corpo");
    assert(rpcPayload?.p_status === "aprovado", "Status provedor nao propagado");
    assert(calls.length === 4, `Sequencia inesperada: ${calls.join(" | ")}`);

    // A resposta autenticada do provedor diverge no valor: rejeitar antes da RPC.
    calls = [];
    rpcPayload = null;
    actualPayment = { ...payment, transaction_amount: 1.00 };
    const mismatch = await webhook(post(url, { type: "payment", data: { id: PAYMENT_ID } }, headers));
    assertions(mismatch, 409, "Webhook valor divergente no MP");
    assert(rpcPayload === null, "Divergencia autenticada chegou a RPC de liberacao");
    assert(calls.length === 3, "Valor divergente executou mutacao");

    // Uma taxa de marketplace incorreta não pode ser aceita: registrar auditoria
    // e enviar à RPC de revisão financeira com taxa não comprovada.
    calls = [];
    rpcPayload = null;
    auditPatch = null;
    actualPayment = { ...payment, application_fee: 0.08 };
    const feeMismatch = await webhook(post(url, {
      type: "payment", data: { id: PAYMENT_ID }, application_fee: 0.07,
    }, headers));
    assertions(feeMismatch, 409, "Taxa autenticada divergente");
    const review = await feeMismatch.json();
    assert(review.revisao_financeira === true && review.taxa_conferida === false,
      "Taxa divergente reportada como financiamento confirmado");
    assert(rpcPayload?.p_status === "revisao_parcial", "Taxa divergente não entrou em revisão");
    assert(rpcPayload?.p_taxa_centavos === null, "Taxa diverge, mas RPC recebeu confirmação da taxa");
    const metadata = auditPatch?.metadata as Record<string, unknown> | undefined;
    const proof = metadata?.provider_fee_review as Record<string, unknown> | undefined;
    assert(proof?.esperado_centavos === 7 && proof?.observado_centavos === 8
      && proof?.motivo === "taxa_divergente", "Fatos de divergência não foram auditados");
    assert(calls.length === 6, `Auditoria financeira incompleta: ${calls.join(" | ")}`);

    // Uma resposta do provedor sem application_fee é informativa, não prova
    // que os 7% foram transferidos. A RPC deve marcar revisão pendente.
    calls = [];
    rpcPayload = null;
    auditPatch = null;
    actualPayment = { ...payment, application_fee: undefined } as typeof payment;
    const missingFee = await webhook(post(url, {
      type: "payment", data: { id: PAYMENT_ID },
    }, headers));
    assertions(missingFee, 200, "Taxa ainda não informada");
    const notFunded = await missingFee.json();
    assert(notFunded.revisao_financeira === true && notFunded.financiamento_comprovado === false,
      "Webhook sem tarifa marcou financiamento comprovado");
    assert(rpcPayload?.p_taxa_centavos === null, "Tarifa ausente foi inventada no RPC");
    assert(auditPatch === null, "Tarifa desconhecida registrada como divergente");
    assert(calls.length === 4, "Tarifa ausente executou operações inesperadas");
  } finally {
    currentMockFetch = denyNetwork;
  }
});
