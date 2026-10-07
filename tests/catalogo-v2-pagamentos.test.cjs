const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto, createHmac } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'supabase/functions/_shared/catalogo-pagamentos-v2.ts'), 'utf8');
function loadHelper(crypto = webcrypto) {
  const names = [...source.matchAll(/export (?:async )?function (\w+)/g)].map(m=>m[1]);
  const context = vm.createContext({crypto,TextEncoder,TextDecoder,Uint8Array,Uint32Array,atob,btoa});
  vm.runInContext(stripTypeScriptTypes(source.replace(/export /g,''),{mode:'strip'})+'\nglobalThis.helper={'+names.join(',')+'};',context);
  return context.helper;
}
const helper=loadHelper();
const plain=v=>JSON.parse(JSON.stringify(v));

test('catalogo-v2-pagamentos valores monetários exatos, sem arredondar entrada inválida',()=>{
  for(const [input,cents] of [['0.01',1],['100.00',10000],[100.5,10050],['21474836.47',2147483647]]) assert.equal(helper.amountToCents(input),cents);
  for(const input of ['1.234','NaN',Infinity,-1,'1e3',null])assert.equal(helper.amountToCents(input),null);
  assert.equal(helper.centsToMoney(107), '1.07'); assert.throws(()=>helper.centsToMoney(-1),/centavos inválido/);
});
test('catalogo-v2-pagamentos snapshots v1/5%, v2 entrega7%, retirada/consumo5%',()=>{
  const legacy={versao_financeira:1,taxa_plataforma_centavos:500,taxa_motoboy_centavos:0,taxa_total_centavos:500,ativo:false};
  assert.deepEqual(plain(helper.normalizeFinancialSnapshot(legacy,'retirada',10000)),{...legacy,somente_pix:false});
  assert.equal(helper.normalizeFinancialSnapshot({...legacy,versao_financeira:2,ativo:true,taxa_motoboy_centavos:200,taxa_total_centavos:700},'entrega',10000).taxa_total_centavos,700);
  for(const mode of ['retirada','consumo_local'])assert.equal(helper.normalizeFinancialSnapshot({...legacy,versao_financeira:2,ativo:true},mode,10000).versao_financeira,2);
  assert.throws(()=>helper.normalizeFinancialSnapshot({...legacy,versao_financeira:2},'entrega',10000),/entrega v2/);
  assert.throws(()=>helper.normalizeFinancialSnapshot({...legacy,taxa_motoboy_centavos:200,taxa_total_centavos:700},'retirada',10000),/motoboy inválida/);
});
test('catalogo-v2-pagamentos código6 criptográfico e rejection sampling remove viés módulo',()=>{
  for(let i=0;i<100;i++)assert.match(helper.randomDeliveryCode(),/^[1-9]\d{5}$/);
  let calls=0; const mock={subtle:webcrypto.subtle,getRandomValues(output){output[0]=calls++===0?0xffffffff:0;return output;}};
  assert.equal(loadHelper(mock).randomDeliveryCode(),'100000'); assert.equal(calls,2);
  assert.match(helper.randomHex(32),/^[a-f0-9]{64}$/);
});
test('catalogo-v2-pagamentos UTF8/base64url AAD delivery-code-v2 e status token não cruzam pedidos',async()=>{
  const key='11'.repeat(32),aad='delivery-code-v2:pedido-1',value='Ação São João 123456';
  const cipher=await helper.encryptAesGcm(value,key,aad); assert.match(cipher,/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(await helper.decryptAesGcm(cipher,key,aad),value);
  await assert.rejects(()=>helper.decryptAesGcm(cipher,key,'delivery-code-v2:pedido-2'));
  await assert.rejects(()=>helper.decryptAesGcm(cipher,'22'.repeat(32),aad));
});
test('catalogo-v2-pagamentos token OAuth cifrado sem AAD compatível com callback existente',async()=>{
  const raw=Uint8Array.from(Buffer.from('11'.repeat(32),'hex')),iv=webcrypto.getRandomValues(new Uint8Array(12));
  const key=await webcrypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);
  const cipher=await webcrypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode('seller-token-ação'));
  const encoded=Buffer.from(iv).toString('base64url')+'.'+Buffer.from(cipher).toString('base64url');
  assert.equal(await helper.decryptAesGcm(encoded,'11'.repeat(32)),'seller-token-ação');
});
test('catalogo-v2-pagamentos idempotência UUID incorpora comércio/identidade e é estável',async()=>{
  const a=await helper.uuidFromParts('catalogo-pix','loja-a','uuid','identity-a');
  assert.match(a,/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(a,await helper.uuidFromParts('catalogo-pix','loja-a','uuid','identity-a'));
  assert.notEqual(a,await helper.uuidFromParts('catalogo-pix','loja-b','uuid','identity-a'));
  assert.notEqual(a,await helper.uuidFromParts('catalogo-pix','loja-a','uuid','identity-b'));
});
test('catalogo-v2-pagamentos HMAC segundos/ms, stale, adulteração e segredo ausente',async()=>{
  const secret='webhook-secret',now=1730000000000;
  for(const timestamp of [String(Math.floor(now/1000)),String(now)]) {
    const v1=createHmac('sha256',secret).update(helper.buildWebhookManifest('PAY_123','req-123',timestamp)).digest('hex');
    const args={header:`ts=${timestamp},v1=${v1}`,requestId:'req-123',dataId:'PAY_123',secret,now};
    assert.equal(await helper.verifyWebhookSignature(args),true);
    assert.equal(await helper.verifyWebhookSignature({...args,dataId:'PAY_124'}),false);
    assert.equal(await helper.verifyWebhookSignature({...args,secret:''}),false);
    assert.equal(await helper.verifyWebhookSignature({...args,now:now+600001}),false);
  }
  assert.equal(helper.constantTimeEqual('abcd','abce'),false);assert.equal(helper.constantTimeEqual('abc','abcd'),false);
});
test('catalogo-v2-pagamentos chargeback/totalrefund precedem approved; partialrefund NÃO é estorno integral',()=>{
  assert.equal(helper.translateProviderStatus({status:'approved',status_detail:'charged_back'}),'contestado');
  assert.equal(helper.translateProviderStatus({status:'approved',status_detail:'refunded'}),'estornado');
  assert.equal(helper.translateProviderStatus({status:'approved',status_detail:'partially_refunded'}),'revisao_parcial');
  assert.equal(helper.translateProviderStatus({status:'approved',status_detail:'refund_pending'}),'revisao_parcial');
  assert.equal(helper.translateProviderStatus({status:'refunded',transaction_amount:100,transaction_amount_refunded:25}),'revisao_parcial');
  assert.equal(helper.translateProviderStatus({status:'approved',transaction_amount:100,transaction_amount_refunded:100}),'estornado');
  assert.equal(helper.translateProviderStatus({status:'approved'}),'aprovado');
  assert.equal(helper.translateProviderStatus({status:'pending',status_detail:'waiting_transfer'}),'pendente');
});
test('catalogo-v2-pagamentos fee_details só application_fee, sem prova retorna null, bruto preservado',()=>{
  const p={id:123,external_reference:'guia-pedido',collector_id:456,currency_id:'BRL',transaction_amount:100,status:'approved',fee_details:[{type:'mercadopago_fee',amount:9},{type:'application_fee',amount:7}]};
  assert.equal(helper.extractProviderPayment(p,'payment').feeCentavos,700);
  assert.equal(helper.extractProviderPayment({...p,application_fee:5},'payment').feeCentavos,500);
  assert.equal(helper.extractProviderPayment({...p,fee_details:[{type:'mercadopago_fee',amount:7}]},'payment').feeCentavos,null);
  assert.equal(helper.extractProviderPayment({...p,fee_details:[{type:'application_fee',amount:'bad'}]},'payment').feeCentavos,null);
  const partial=helper.extractProviderPayment({...p,transaction_amount_refunded:25},'payment');assert.equal(partial.state,'revisao_parcial');assert.equal(partial.amountCentavos,10000);
});
test('catalogo-v2-pagamentos fatos exigem ID/ref/collector/currency/valor; IDs são sanitizados',()=>{
  const data={id:'pay_123',external_reference:'guia-pedido',collector_id:456,currency_id:'BRL',transaction_amount:100};
  const check=d=>helper.providerFactsError(helper.extractProviderPayment(d,'payment'),'pay_123','guia-pedido','456',10000);
  assert.equal(check(data),'');
  for(const [field,value] of [['id',null],['external_reference',''],['collector_id',undefined],['collector_id',999],['currency_id',undefined],['transaction_amount',101]])assert.notEqual(check({...data,[field]:value}),'');
  assert.equal(helper.sanitizedProviderId('../../segredo'),'');assert.equal(helper.sanitizedProviderId('pay_123'),'pay_123');
});
