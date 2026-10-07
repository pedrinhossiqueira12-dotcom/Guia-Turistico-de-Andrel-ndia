const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');
const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RIDER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN='4b9a0233-6b72-4573-aebd-d596c5b15e1b';
const KEY='1'.repeat(64); // Somente fixture pública de teste; não é credencial.
function cryptoModule() {
  const context={ crypto:webcrypto,TextEncoder,TextDecoder,atob,btoa };
  const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/_shared/catalogo-entregas-crypto-v2.ts','utf8')).replace(/^export\s+/gm,'');
  vm.runInNewContext(source,context);
  return context;
}
function delivery(actor, result={ok:true}, key=KEY) {
  let handler;const calls=[];const c=cryptoModule();
  const db={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},rpc:async(name,args)=>{calls.push({name,args});return{data:result,error:null};}};
  const context={...c,Request,Response,createClient:()=>db,console:{error(){}},Deno:{env:{get:name=>name==='MP_OAUTH_ENCRYPTION_KEY'?key:''},serve:fn=>{handler=fn;}}};
  vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('supabase/functions/catalogo-entregas/index.ts','utf8').replace(/^import[^;]+;\s*/gm,'')),context);
  return {handler,calls};
}
function req(body) { return new Request('https://example.invalid/functions/v1/catalogo-entregas',{method:'POST',headers:{authorization:'Bearer QA-token','content-type':'application/json'},body:JSON.stringify(body)}); }

test('chave Pix usa AES-GCM, IV aleatório e AAD do próprio entregador',async()=>{
  const c=cryptoModule();const a=await c.encryptCourierPix('fixture@example.invalid',KEY,RIDER);const b=await c.encryptCourierPix('fixture@example.invalid',KEY,RIDER);
  assert.notEqual(a,b);assert.match(a,/^pix-v2:[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);assert.doesNotMatch(a,/fixture@example/);
  assert.equal(await c.decryptCourierPix(a,KEY,RIDER),'fixture@example.invalid');
  await assert.rejects(()=>c.decryptCourierPix(a,KEY,OWNER));
  await assert.rejects(()=>c.decryptCourierPix(a,'2'.repeat(64),RIDER));
  await assert.rejects(()=>c.decryptCourierPix('chave-em-claro',KEY,RIDER));
});
test('chave vazia apaga cadastro; chave inválida ou cifra adulterada não é aceita',async()=>{
  const c=cryptoModule();assert.equal(await c.encryptCourierPix('',KEY,RIDER),null);
  await assert.rejects(()=>c.encryptCourierPix('fixture@example.invalid','',RIDER));
  await assert.rejects(()=>c.encryptCourierPix('x'.repeat(255),KEY,RIDER));
  const ciphertext=await c.encryptCourierPix('fixture@example.invalid',KEY,RIDER);
  await assert.rejects(()=>c.decryptCourierPix(ciphertext.slice(0,-3)+'ZZZ',KEY,RIDER));
});
test('API deriva beneficiário do JWT e nunca entrega a chave em claro ao SQL',async()=>{
  const e=delivery(RIDER);const response=await e.handler(req({acao:'salvar_chave_pix',chave_pix:'fixture@example.invalid',operador_id:ADMIN,motoboy_id:ADMIN}));
  assert.equal(response.status,200);assert.equal(e.calls[0].args.p_operador_id,RIDER);
  assert.match(e.calls[0].args.p_chave_pix,/^pix-v2:/);assert.doesNotMatch(JSON.stringify(e.calls),/fixture@example/);
  assert.equal(await cryptoModule().decryptCourierPix(e.calls[0].args.p_chave_pix,KEY,RIDER),'fixture@example.invalid');
});
test('sem criptografia, salvar Pix falha antes de gravar qualquer dado',async()=>{
  const e=delivery(RIDER,{ok:true},'');assert.equal((await e.handler(req({acao:'salvar_chave_pix',chave_pix:'fixture@example.invalid'}))).status,503);assert.equal(e.calls.length,0);
});
test('extrato só decifra o perfil do usuário e remove ciphertext do retorno',async()=>{
  const cipher=await cryptoModule().encryptCourierPix('fixture@example.invalid',KEY,RIDER);
  const e=delivery(RIDER,{ok:true,perfil:{chave_pix_enc:cipher},saldo:{disponivel_centavos:200}});
  const body=await (await e.handler(req({acao:'consultar_extrato'}))).json();assert.equal(body.perfil.chave_pix,'fixture@example.invalid');assert.doesNotMatch(JSON.stringify(body),/pix-v2:|chave_pix_enc/);
  const other=delivery(OWNER,{ok:true,perfil:{chave_pix_enc:cipher}});const wrong=await(await other.handler(req({acao:'consultar_extrato'}))).json();assert.equal(wrong.perfil.chave_pix,'');assert.equal(wrong.perfil.chave_pix_indisponivel,true);
});
test('operação administrativa exige root antes de decifrar dados e não inventa prova de lastro',async()=>{
  const cipher=await cryptoModule().encryptCourierPix('fixture@example.invalid',KEY,RIDER);
  const result={ok:true,remuneracoes:[{pedido_id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',motoboy_id:RIDER,chave_pix_enc:cipher,pix_ciphertext:cipher,status:'disponivel',financiamento_comprovado:true}]};
  const denied=delivery(RIDER,result);assert.equal((await denied.handler(req({acao:'operacao_admin',admin:true}))).status,403);assert.equal(denied.calls.length,0);
  const e=delivery(ADMIN,result);const body=await(await e.handler(req({acao:'operacao_admin'}))).json();assert.equal(body.admin,true);assert.equal(body.remuneracoes[0].status,'a_receber');assert.equal(body.remuneracoes[0].financiado,true);assert.equal(body.remuneracoes[0].chave_pix,'fixture@example.invalid');assert.doesNotMatch(JSON.stringify(body),/pix-v2:|pix_ciphertext|chave_pix_enc/);
});
test('fatura usa perfil oficial, GET após criação e validação integral antes da baixa',()=>{
  const source=fs.readFileSync('supabase/functions/catalogo-fatura-pix/index.ts','utf8');
  assert.match(source,/MP_USER_PROFILE_API = "https:\/\/api\.mercadolibre\.com"/);
  assert.match(source,/if \(!avaliacao\.valid\) throw new HttpError/);
  assert.match(source,/const created = await mpRequest/);
  assert.match(source,/const order = await mpRequest\(`\/v1\/orders\/\$\{encodeURIComponent\(orderId\)\}`, "GET"\)/);
  assert.match(source,/avaliacao\.state === "aprovado"/);
  assert.match(source,/Vínculo da cobrança ainda pendente; reenvie a notificação/);
  // Este check estático complementa, não substitui, testes reais do SQL e do provedor.
});
