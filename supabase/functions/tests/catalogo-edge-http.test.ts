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
    return result(null);
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
    return result({offset:(pages-1)*100,hasMore:true,
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
