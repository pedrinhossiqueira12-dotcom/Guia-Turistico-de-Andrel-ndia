// Testes 100% isolados: transport é sempre fake; sem credenciais ou pagamentos reais.
import {
  prepararPayoutSandbox, criarPayoutSandbox, consultarTransacaoSandbox,
  classificarTransacaoPayout, type PayoutTransport,
} from "../_shared/catalogo-payouts-sandbox-v2.ts";

const SAQUE = "15151515-1515-4151-8151-151515151515";
const POP = "POP01KV681P6SJ38NQHWX3XK162SS";
const TOP = "TOP01KV681P6SJ38NQHWX3SF2WM22";
const TOKEN = "TEST_KEY_FAKE_2026_12345";
const TEST = { saqueId: SAQUE, valorCentavos: 1234, pixType: "EMAIL" as const,
  chavePix: "courier@example.invalid" };
function check(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error(detail);
}
async function reject(action: () => unknown | Promise<unknown>, word: string) {
  let thrown = false;
  try { await action(); } catch (error) {
    thrown = true;
    check(String(error).includes(word), "Erro inesperado: " + String(error));
  }
  check(thrown, "Deveria rejeitar: " + word);
}
function fakeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json"}});
}
function createReply(prepared = prepararPayoutSandbox(TEST)) {
  return {
    id: POP, status: "created", external_reference: prepared.externalReference,
    transactions: [{id: TOP, external_reference: prepared.transactionReference}],
  };
}

Deno.test("prepara valores exatos em BRL, ID determinístico e Pix tipado", () => {
  const x = prepararPayoutSandbox(TEST);
  check(x.externalReference === "saque_" + SAQUE.replaceAll("-", ""), "Ref do lote incorreta");
  check(x.idempotencyKey === SAQUE, "ID estável não coincide com saque");
  check(x.body.transactions.length === 1, "Só um beneficiário por requisição");
  check(x.body.transactions[0].amount.value === 12.34, "Centavos perdidos");
  check(x.body.transactions[0].pix.type === "EMAIL", "Tipo Pix trocado");
  check(x.body.transactions[0].pix.chave === TEST.chavePix, "Pix destinatário trocado");
  check(!("config" in x.body), "Não gerar webhook fictício");
  const retry = prepararPayoutSandbox(TEST);
  check(JSON.stringify(x) === JSON.stringify(retry), "Retries mudaram a referência/valor");
  check(prepararPayoutSandbox({...TEST,valorCentavos:101}).body.transactions[0].amount.value === 1.01,
    "Não arredondar dois dígitos duas vezes");
});

Deno.test("falha antes da API se chave, tipo, valor ou ID são inválidos", async () => {
  await reject(() => prepararPayoutSandbox({...TEST,valorCentavos:99}), "mínimo");
  await reject(() => prepararPayoutSandbox({...TEST,valorCentavos:-300}), "mínimo");
  await reject(() => prepararPayoutSandbox({...TEST,valorCentavos:100.5}), "mínimo");
  await reject(() => prepararPayoutSandbox({...TEST,saqueId:"1/../abc"}), "inválido");
  await reject(() => prepararPayoutSandbox({...TEST,pixType:"CPF",chavePix:TEST.chavePix}), "Pix/tipo");
  await reject(() => prepararPayoutSandbox({...TEST,pixType:"PHONE",chavePix:"11999999999"}), "Pix/tipo");
  await reject(() => prepararPayoutSandbox({...TEST,pixType:"PIX_CODE",chavePix:"abc"}), "Pix/tipo");
  const pix = prepararPayoutSandbox({...TEST,pixType:"PIX_CODE",chavePix:SAQUE});
  check(pix.body.transactions[0].pix.chave === SAQUE, "Chave aleatória inválida");
  await reject(() => prepararPayoutSandbox({...TEST,notificationUrl:"http://localhost/webhook"}), "Webhook");
  await reject(() => prepararPayoutSandbox({...TEST,notificationUrl:"https://127.0.0.1/a"}), "Webhook");
  check(prepararPayoutSandbox({...TEST,notificationUrl:"https://example.invalid/webhook"})
    .body.config?.notification_url === "https://example.invalid/webhook", "Webhook HTTPS");
});

Deno.test("nenhum envio sem permissão explícita de teste ou transport", async () => {
  const prepared = prepararPayoutSandbox(TEST);
  let invoked = 0;
  const transport: PayoutTransport = async () => { invoked++; throw new Error("não deveria usar"); };
  await reject(() => criarPayoutSandbox(prepared,{
    testAccessToken:TOKEN,transport,testApproved:false,
  }), "desabilitado");
  await reject(() => criarPayoutSandbox(prepared,{
    testAccessToken:"",transport,testApproved:true,
  }), "TESTE");
  check(invoked === 0, "Tentou rede ao falhar autorização");
});

Deno.test("POST de sandbox usa contrato oficial e 202 significa somente processamento", async () => {
  const prepared = prepararPayoutSandbox(TEST);
  let count = 0;
  const transport: PayoutTransport = async (url,init) => {
    count++;
    check(url === "https://api.mercadopago.com/v1/payouts", "Endpoint incorreto");
    check(init.method === "POST", "Método incorreto");
    const h = new Headers(init.headers);
    check(h.get("X-test-token") === "true", "Faltou modo TESTE");
    check(h.get("X-enforce-signature") === "false", "Não é ambiente sandbox");
    check(h.get("Authorization") === "Bearer " + TOKEN, "Token de teste não passou no backend");
    check(h.get("X-Idempotency-Key") === SAQUE, "Chave de idempotência instável");
    check(!h.has("X-signature"), "Não inventar assinatura de produção");
    const body = JSON.parse(String(init.body));
    check(body.transactions[0].type === "pix" && body.transactions[0].amount.value === 12.34,
      "Transação Pix incorreta");
    return fakeResponse(createReply(prepared),202);
  };
  const r = await criarPayoutSandbox(prepared,{testAccessToken:TOKEN,transport,testApproved:true});
  check(r.payoutId === POP && r.transactionId === TOP && r.situacao === "em_processamento",
    "202 não pode virar 'pago'");
  check(count === 1, "Criou mais de um pagamento");
});

Deno.test("202 sem IDs/referências consistentes NUNCA confirma repasse", async () => {
  const prepared = prepararPayoutSandbox(TEST);
  for(const response of [
    { ...createReply(prepared), external_reference: "OUTRO_PEDIDO" },
    { ...createReply(prepared), transactions: [] },
    { ...createReply(prepared), transactions:[{id:TOP,external_reference:"outro"}] },
    { ...createReply(prepared), id:"../../" },
  ]) {
    await reject(() => criarPayoutSandbox(prepared,{
      testAccessToken:TOKEN, transport: async()=>fakeResponse(response,202), testApproved:true,
    }), /a/.source); // qualquer exceção, não permitir usar resposta parcial
  }
});
Deno.test("HTTP 403, timeout e HTTP 200 na criação não são sucesso", async () => {
  const prepared = prepararPayoutSandbox(TEST);
  for(const status of [200,403,500]) {
    await reject(() => criarPayoutSandbox(prepared,{
      testAccessToken:TOKEN,transport:async()=>fakeResponse(createReply(prepared),status),testApproved:true,
    }), "HTTP");
  }
  await reject(()=>criarPayoutSandbox(prepared,{
    testAccessToken:TOKEN,transport:async()=>{throw new Error("timeout");},testApproved:true,
  }),"timeout");
});

Deno.test("GET do payout busca apenas o recurso esperado com X-test-token", async () => {
  let count=0;
  const transport:PayoutTransport=async(url, init)=>{
    count++;
    check(url === "https://api.mercadopago.com/v1/payouts/"+POP+"/transactions/"+TOP,"Path alterado");
    check(init.method === "GET", "Método alterado");
    check(new Headers(init.headers).get("X-test-token") === "true","Modo teste ausente");
    return fakeResponse({id:TOP,external_reference:prepararPayoutSandbox(TEST).transactionReference,
      status:"success",status_detail:"accredited",amount:{currency:"BRL",value:12.34}},200);
  };
  const result=await consultarTransacaoSandbox({payoutId:POP,transactionId:TOP},{
    testAccessToken:TOKEN,transport,testApproved:true,
  });
  check(result.id===TOP && count===1,"Consulta inválida");
  await reject(()=>consultarTransacaoSandbox({payoutId:"../xx",transactionId:TOP},{
    testAccessToken:TOKEN,transport,testApproved:true,
  }),"inválido");
  check(count===1,"Foi feita chamada para path inválido");
});

Deno.test("só sucesso acreditado e comprovado autoriza classificar como confirmado", () => {
  const expected={transactionId:TOP,externalReference:prepararPayoutSandbox(TEST).transactionReference,valorCentavos:1234};
  const original={id:TOP,external_reference:expected.externalReference,
    status:"success",status_detail:"accredited",amount:{currency:"BRL",value:12.34}};
  check(classificarTransacaoPayout(original,expected)==="confirmado","Pagamento válido");
  check(classificarTransacaoPayout({...original,status:"approved"},expected)==="em_processamento","approved não credita");
  check(classificarTransacaoPayout({...original,status:"pending"},expected)==="em_processamento","pending não credita");
  check(classificarTransacaoPayout({...original,status:"success",status_detail:"in_progress"},expected)==="em_processamento",
    "success/in_progress ainda não foi creditado");
  check(classificarTransacaoPayout({...original,status:"transaction_in_process",status_detail:"pending_bank"},expected)==="em_processamento",
    "banco não respondeu; mantém payout reservado");
  check(classificarTransacaoPayout({...original,status:"transaction_in_process",status_detail:"pending_authorized"},expected)==="em_processamento",
    "aguardando autorização, não pago");
  check(classificarTransacaoPayout({...original,status:"processed",status_detail:"approved"},expected)==="revisar",
    "status processed sem prova accredited exige revisão conservadora");
  check(classificarTransacaoPayout({...original,status:"refunded",status_detail:"refunded"},expected)==="revisar",
    "reembolso não pode gerar segunda transferência");
  check(classificarTransacaoPayout({...original,status:"approved",status_detail:"partially_refunded"},expected)==="revisar",
    "reembolso parcial prevalece sobre status approved");
  check(classificarTransacaoPayout({...original,status:"error"},expected)==="falhou","erro não credita");
  check(classificarTransacaoPayout({...original,external_reference:"outro"},expected)==="revisar","referência errada");
  check(classificarTransacaoPayout({...original,amount:{currency:"BRL",value:12.35}},expected)==="revisar","valor errado");
  check(classificarTransacaoPayout({...original,amount:{currency:"USD",value:12.34}},expected)==="revisar","moeda errada");
  check(classificarTransacaoPayout({...original,status:"unknown"},expected)==="revisar","status desconhecido");
});
