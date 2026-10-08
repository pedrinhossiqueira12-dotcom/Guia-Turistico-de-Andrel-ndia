import {
  amountToCents, centsToMoney, translateProviderStatus,
  extractProviderPayment, providerFactsError, verifyWebhookSignature,
  buildWebhookManifest, encryptAesGcm, decryptAesGcm, uuidFromParts, randomDeliveryCode,
} from "../_shared/catalogo-pagamentos-v2.ts";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}
async function mustReject(action: () => Promise<unknown>, message: string) {
  let rejected = false;
  try { await action(); } catch { rejected = true; }
  assert(rejected, message);
}

Deno.test("valores monetarios rejeitam precisao indevida e valores invalidos", () => {
  for (const [input, expected] of [["0",0],["0.01",1],["1.2",120],["1234.56",123456]] as const) {
    assert(amountToCents(input) === expected, `Conversao incorreta: ${input}`);
    assert(centsToMoney(expected) === (expected / 100).toFixed(2), `Formato incorreto: ${input}`);
  }
  for (const invalid of ["-1","1.001","1e3","NaN","1,00","",null]) {
    assert(amountToCents(invalid) === null, `Valor invalido aceito: ${invalid}`);
  }
});

Deno.test("estornos e contestacoes nunca viram aprovacao", () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{status:"approved"}, "aprovado"],
    [{status:"pending"}, "pendente"],
    [{status:"approved",transaction_amount:100,transaction_amount_refunded:100}, "estornado"],
    [{status:"approved",transaction_amount:100,transaction_amount_refunded:20}, "revisao_parcial"],
    [{status:"charged_back"}, "contestado"],
    [{status:"refunded"}, "estornado"],
    [{status:"expired"}, "expirado"],
    [{status:"rejected"}, "cancelado"],
    [{status:"refund_pending"}, "revisao_parcial"],
  ];
  for (const [input, expected] of cases) {
    assert(translateProviderStatus(input) === expected, `Estado incorreto: ${JSON.stringify(input)}`);
  }
});

Deno.test("fatos do provedor nao aceitam referencia, cobrador ou valor divergentes", () => {
  const payment = extractProviderPayment({
    id:"mp-123",external_reference:"guia-order-1",collector_id:1234,
    currency_id:"BRL",transaction_amount:100,application_fee:7,status:"approved",
  }, "payment");
  assert(payment.amountCentavos === 10000 && payment.feeCentavos === 700, "Valores incorretos");
  assert(!providerFactsError(payment,"mp-123","guia-order-1","1234",10000), "Pagamento valido recusado");
  assert(Boolean(providerFactsError(payment,"mp-999","guia-order-1","1234",10000)), "ID falso aceito");
  assert(Boolean(providerFactsError(payment,"mp-123","guia-order-2","1234",10000)), "Referencia falsa aceita");
  assert(Boolean(providerFactsError(payment,"mp-123","guia-order-1","9999",10000)), "Cobrador falso aceito");
  assert(Boolean(providerFactsError(payment,"mp-123","guia-order-1","1234",10001)), "Valor divergente aceito");
});

Deno.test("webhook exige HMAC valido, identificadores corretos e timestamp recente", async () => {
  const secret="segredo-local-de-teste", requestId="req-abc", dataId="123456";
  const now=Date.now(), timestamp=String(Math.floor(now/1000));
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const bytes=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(buildWebhookManifest(dataId,requestId,timestamp)));
  const signature=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("");
  const header=`ts=${timestamp},v1=${signature}`;
  const verify=(changes: Record<string,unknown>={})=>verifyWebhookSignature({header,secret,requestId,dataId,now,...changes});
  assert(await verify(), "Assinatura valida recusada");
  assert(!(await verify({requestId:"req-falso"})), "Request ID falso aceito");
  assert(!(await verify({dataId:"999999"})), "ID de pagamento falso aceito");
  assert(!(await verify({secret:"outro-segredo"})), "Segredo falso aceito");
  assert(!(await verify({now:now+600000})), "Assinatura expirada aceita");
  assert(!(await verify({header:"ts=0,v1=abc"})), "Assinatura malformada aceita");
});

Deno.test("criptografia vincula segredo ao pedido e impede reutilizacao", async () => {
  const key="11".repeat(32);
  const cipher=await encryptAesGcm("token-sensivel",key,"pedido:1");
  assert(await decryptAesGcm(cipher,key,"pedido:1")==="token-sensivel", "Falha no roundtrip AES-GCM");
  await mustReject(()=>decryptAesGcm(cipher,key,"pedido:2"),"Ciphertext reutilizado com outro pedido");
  await mustReject(()=>decryptAesGcm(cipher,"22".repeat(32),"pedido:1"),"Chave incorreta aceita");
  const one=await uuidFromParts("pedido","loja","chave");
  const two=await uuidFromParts("pedido","loja","chave");
  const other=await uuidFromParts("pedido","outra-loja","chave");
  assert(one===two && one!==other, "Idempotencia nao deterministica ou nao isolada");
});

Deno.test("codigos de entrega sao validos e variados", () => {
  const codes=new Set<string>();
  for(let i=0;i<1000;i++) {
    const code=randomDeliveryCode();
    assert(/^\\d{6}$/.test(code) && Number(code)>=100000, "Codigo de entrega invalido");
    codes.add(code);
  }
  assert(codes.size>950, "Entropia insuficiente nos codigos");
});
