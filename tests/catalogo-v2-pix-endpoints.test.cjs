const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto, createHmac } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const key = '11'.repeat(32), secret = 'assinatura-local-sem-rede';
const productId = 'a0000000-0000-4000-8000-000000000001';
const secondId = 'a0000000-0000-4000-8000-000000000002';
const requestId = 'b0000000-0000-4000-8000-000000000001';
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const helperSource = read('supabase/functions/_shared/catalogo-pagamentos-v2.ts');
const exported = [...helperSource.matchAll(/export (?:async )?function (\w+)/g)].map(m => m[1]);
function baseContext(extra = {}) { return { crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, Uint32Array, Buffer, atob, btoa, URL, Request, Response, AbortSignal, console: { error() {} }, ...extra }; }
function helper() {
  const context = vm.createContext(baseContext());
  vm.runInContext(stripTypeScriptTypes(helperSource.replace(/export /g, ''), { mode: 'strip' }) + '\nglobalThis.helper={' + exported.join(',') + '};', context);
  return context.helper;
}
const h = helper();

// Colunas vêm do DDL REAL (marketplace, offline, email, OAuth, status-token, v2).
// Os checks financeiros/itens abaixo reproduzem seus invariantes e limites integer.
const schemaFiles = [
  '20261004223000_catalogo_marketplace_pedidos.sql', '20261005010000_catalogo_marketplace_oauth.sql',
  '20261005090000_catalogo_pedidos_email.sql', '20261005120000_catalogo_pagamentos_offline.sql',
  '20261006184332_catalogo_motoboys_acesso_restrito.sql', '20261007010434_catalogo_entregas_v2.sql',
];
const ddl = schemaFiles.map(f => read('supabase/migrations/' + f)).join('\n');
function tableColumns(table) {
  const match = ddl.match(new RegExp('CREATE TABLE IF NOT EXISTS public\\.' + table + ' \\(([\\s\\S]*?)\\n\\);'));
  assert.ok(match, 'DDL tabela ' + table);
  const columns = new Set([...match[1].matchAll(/^  (\w+) (?:uuid|text|integer|numeric|boolean|timestamptz|jsonb)/gm)].map(m => m[1]));
  for (const alter of ddl.matchAll(new RegExp('ALTER TABLE public\\.' + table + '([\\s\\S]*?);', 'g'))) {
    for (const c of alter[1].matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g)) columns.add(c[1]);
  }
  // A migration status-token usa IF NOT EXISTS na tabela também.
  for (const alter of ddl.matchAll(new RegExp('ALTER TABLE (?:IF EXISTS )?public\\.' + table + '([\\s\\S]*?);', 'g'))) {
    for (const c of alter[1].matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g)) columns.add(c[1]);
  }
  return columns;
}
const schemas = {
  catalogo_pedidos: tableColumns('catalogo_pedidos'),
  catalogo_pedido_itens: tableColumns('catalogo_pedido_itens'),
  catalogo_recebedores: tableColumns('catalogo_recebedores'),
  catalogos: new Set(['comercio_id', 'modalidades', 'metodos_pagamento', 'bloqueado']),
  catalogo_publicado: new Set(['comercio_id', 'modalidades', 'metodos_pagamento']),
  catalogo_produtos: new Set(['id', 'comercio_id', 'categoria_id', 'nome', 'descricao', 'preco', 'disponivel', 'deletado_em', 'catalogo_categorias']),
};
const statusValues = ddl.match(/status text NOT NULL DEFAULT 'aguardando_pagamento'\s+CHECK \(status IN \(([^)]+)\)/)[1].match(/'([^']+)'/g).map(x => x.slice(1, -1));
const paymentValues = ddl.match(/status_pagamento text NOT NULL DEFAULT 'pendente'\s+CHECK \(status_pagamento IN \(([^)]+)\)/)[1].match(/'([^']+)'/g).map(x => x.slice(1, -1));
const int = (v, min = 0) => assert.ok(Number.isInteger(v) && v >= min && v <= 2147483647, 'integer válido: ' + v);
function checkRow(table, r) {
  for (const col of Object.keys(r)) assert.ok(schemas[table].has(col), table + ': coluna desconhecida ' + col);
  if (table === 'catalogo_pedidos') {
    assert.ok(statusValues.includes(r.status), 'status físico válido'); assert.ok(paymentValues.includes(r.status_pagamento), 'status financeiro válido');
    assert.ok(['entrega', 'retirada', 'consumo_local'].includes(r.modalidade)); assert.equal(r.provedor, 'mercadopago'); assert.equal(r.forma_pagamento, 'pix');
    for (const col of ['subtotal_produtos_centavos', 'entrega_centavos', 'total_centavos', 'taxa_plataforma_centavos', 'taxa_motoboy_centavos', 'taxa_total_centavos', 'repasse_bruto_comercio_centavos']) int(r[col], col.includes('subtotal') || col === 'total_centavos' ? 1 : 0);
    assert.equal(r.total_centavos, r.subtotal_produtos_centavos + r.entrega_centavos);
    assert.equal(r.taxa_plataforma_centavos, Math.round(r.subtotal_produtos_centavos * .05));
    assert.equal(r.taxa_motoboy_centavos, r.versao_financeira === 2 && r.modalidade === 'entrega' ? Math.round(r.subtotal_produtos_centavos * .02) : 0);
    assert.equal(r.taxa_total_centavos, r.taxa_plataforma_centavos + r.taxa_motoboy_centavos);
    assert.equal(r.repasse_bruto_comercio_centavos, r.subtotal_produtos_centavos - r.taxa_total_centavos + r.entrega_centavos);
    for (const [col, max, min] of [['cliente_nome',140,1],['cliente_telefone',40,3],['cliente_email',180,5],['cliente_endereco',240,0],['cliente_numero',30,0],['cliente_bairro',120,0],['cliente_complemento',160,0],['cliente_referencia',240,0],['cliente_cidade',120,0],['observacoes',1000,0]]) {
      if (r[col] !== null && r[col] !== undefined) assert.ok(r[col].trim().length >= min && r[col].length <= max, 'limite ' + col);
    }
    assert.match(r.id, /^[0-9a-f-]{36}$/); assert.match(r.idempotency_key, /^[0-9a-f-]{36}$/);
    assert.match(r.codigo_entrega_hash, /^[a-f0-9]{64}$/); assert.match(r.status_token_hash, /^[a-f0-9]{64}$/);
  }
  if (table === 'catalogo_pedido_itens') {
    assert.ok(r.nome_produto.trim().length > 0 && r.nome_produto.length <= 120); assert.ok(r.descricao_produto.length <= 600);
    int(r.preco_unitario_centavos); int(r.total_item_centavos); assert.ok(Number.isInteger(r.quantidade) && r.quantidade >= 1 && r.quantidade <= 99);
    assert.equal(r.total_item_centavos, r.preco_unitario_centavos * r.quantidade);
  }
}
class Query {
  constructor(db, table) { this.db=db; this.table=table; this.filters=[]; this.action='select'; }
  select(cols) {
    const flat = cols.replace(/catalogo_categorias!inner\([^)]*\)/g,'catalogo_categorias');
    this.columns=flat;
    for (const col of flat.split(',')) assert.ok(schemas[this.table].has(col), this.table + ': select inválido ' + col);
    return this;
  }
  eq(col,val) { if (!col.includes('.')) assert.ok(schemas[this.table].has(col), 'filtro ' + col); this.filters.push(r => col==='metadata' ? JSON.stringify(r.metadata) === JSON.stringify(typeof val==='string'?JSON.parse(val):val) : this.field(r,col)===val); return this; }
  is(col,val) { this.filters.push(r => (this.field(r,col) ?? null) === val); return this; }
  in(col,vals) { this.filters.push(r => vals.includes(r[col])); return this; }
  field(r,col) { return col.split('.').reduce((a,c)=>a?.[c],r); }
  insert(rows) { this.action='insert'; this.rows=Array.isArray(rows)?rows:[rows]; return this; }
  upsert(rows,opts) { this.action='upsert'; this.rows=Array.isArray(rows)?rows:[rows]; this.opts=opts; return this; }
  update(patch) { this.action='update'; this.patch=patch; return this; }
  single() { this.singleMode=true; return this; }
  maybeSingle() { this.singleMode=true; this.maybe=true; return this; }
  then(resolve,reject) { return Promise.resolve().then(()=>this.run()).then(resolve,reject); }
  async run() {
    const db=this.db, rows=db.tables[this.table];
    let data=[];
    if (this.action==='insert' || this.action==='upsert') {
      if (this.table==='catalogo_pedido_itens' && db.failItems>0) { db.failItems--; return {data:null,error:{code:'XX000',message:'falha itens injetada'}}; }
      const staged=this.rows.map(clone);
      staged.forEach(r=>checkRow(this.table,r)); // ALL-or-nothing, como INSERT bulk PostgREST.
      if (this.table==='catalogo_pedidos' && staged.some(r=>rows.some(old=>old.id===r.id||old.idempotency_key===r.idempotency_key||old.referencia_externa===r.referencia_externa))) return {data:null,error:{code:'23505'}};
      for (const row of staged) {
        const old=rows.find(r=>r.id===row.id);
        if (old && this.action==='upsert' && this.opts.ignoreDuplicates) continue;
        if (old) throw new Error('duplicação inesperada');
        if(this.table==='catalogo_pedido_itens') assert.ok(db.tables.catalogo_pedidos.some(p=>p.id===row.pedido_id),'FK pedido');
        rows.push(row); data.push(row);
      }
    } else {
      data=rows.filter(r=>this.filters.every(f=>f(r)));
      if (this.action==='update') {
        if (this.table==='catalogo_pedidos') { assert.equal(this.patch.status,undefined,'artefatos nunca regravam status'); assert.equal(this.patch.status_pagamento,undefined,'artefatos nunca regravam status financeiro'); }
        if(db.beforeArtifact && this.table==='catalogo_pedidos' && this.patch.payment_id) { const hook=db.beforeArtifact; db.beforeArtifact=null; await hook(data[0]); data=rows.filter(r=>this.filters.every(f=>f(r))); }
        for (const r of data) { const next={...r,...clone(this.patch)}; checkRow(this.table,next); Object.assign(r,next); }
      }
    }
    const result=data.map(r=>this.columns ? Object.fromEntries(this.columns.split(',').map(c=>[c,r[c]])) : clone(r));
    if (this.singleMode && result.length>1) return {data:null,error:{message:'múltiplas linhas'}};
    if(this.singleMode&&!result.length&&!this.maybe) return {data:null,error:{message:'ausente'}};
    return {data:clone(this.singleMode ? (result[0]||null) : result),error:null};
  }
}
async function fixture(options={}) {
  const tokenCipher=await h.encryptAesGcm('seller-token-UTF8-á',key); // mesmo formato callback, sem AAD.
  const db={ tables: { catalogo_pedidos:[],catalogo_pedido_itens:[],catalogos:[],catalogo_publicado:[],catalogo_recebedores:[],catalogo_produtos:[] }, failItems:0, rpcCalls:[], active:true, allowed:true, ...options };
  for (const commerce of ['loja-a','loja-b']) {
    db.tables.catalogos.push({comercio_id:commerce,modalidades:['entrega','retirada','consumo_local'],metodos_pagamento:['pix'],bloqueado:false});
    db.tables.catalogo_publicado.push({comercio_id:commerce,modalidades:['entrega','retirada','consumo_local'],metodos_pagamento:['pix']});
    db.tables.catalogo_recebedores.push({comercio_id:commerce,status:'ativo',conta_externa_id:commerce==='loja-a'?'123':'456',oauth_access_token_enc:tokenCipher});
    for (const id of [productId,secondId]) db.tables.catalogo_produtos.push({id,comercio_id:commerce,categoria_id:productId,nome:'Pão de queijo á',descricao:'Produto íntegro',preco:'100.00',disponivel:true,deletado_em:null,catalogo_categorias:{ativa:true,deletado_em:null}});
  }
  db.from=table=>{ assert.ok(schemas[table],table); return new Query(db,table); };
  db.rpc=async(name,args)=>{
    db.rpcCalls.push({name,args:clone(args)});
    if(name==='catalogo_offline_consumir_limite') { assert.match(args.p_chave_hash,/^[0-9a-f]{64}$/); return {data:db.allowed,error:null}; }
    if(name==='catalogo_fluxo_precificar') {
      assert.ok(args.p_comercio_id,'precificação inclui comércio do piloto');
      const active=db.active&&(!db.pilots||db.pilots.includes(args.p_comercio_id));
      const platform=Math.round(args.p_subtotal_centavos*.05), moto=active&&args.p_modalidade==='entrega'?Math.round(args.p_subtotal_centavos*.02):0;
      return {data:{ok:true,versao_financeira:active?2:1,taxa_plataforma_centavos:platform,taxa_motoboy_centavos:moto,taxa_total_centavos:platform+moto,somente_pix:false,ativo:active},error:null};
    }
    assert.equal(name,'catalogo_aplicar_pagamento_v2');
    const order=db.tables.catalogo_pedidos.find(r=>r.id===args.p_pedido_id); assert.ok(order); assert.equal(args.p_valor_centavos,order.total_centavos);
    assert.ok(['aprovado','estornado','charged_back','cancelado','recusado','revisao_parcial'].includes(args.p_status),'estado RPC real');
    assert.ok(args.p_taxa_centavos===null || args.p_taxa_centavos===order.taxa_total_centavos,'SQL recusa taxa divergente: usar null + auditoria');
    if (db.rpcError) return {data:null,error:{message:'RPC indisponível'}};
    if (args.p_status==='revisao_parcial') { order.status_pagamento='contestado'; order.metadata={...order.metadata,sql_revisao_parcial:true}; return {data:{ok:true,status_pagamento:'contestado',financiamento_comprovado:false},error:null}; }
    if(args.p_status==='aprovado') { order.status_pagamento='aprovado'; if(order.status==='aguardando_pagamento')order.status='pago'; }
    else order.status_pagamento=args.p_status==='charged_back'?'contestado':args.p_status;
    order.metadata={...order.metadata,sql_conciliado:true};
    return {data:{ok:true,status_pagamento:order.status_pagamento,financiamento_comprovado:args.p_status==='aprovado'&&args.p_taxa_centavos===order.taxa_total_centavos},error:null};
  };
  const diagnostics=[];
  const provider={posts:[],gets:[],payments:new Map(),idempotent:new Map(),mutate:null,postHttpStatus:201,getHttpStatus:200,beforePost:null};
  const fetchFake=async(url,opts={})=>{
    assert.match(String(url),/^https:\/\/api\.mercadopago\.com\/v1\/(payments|orders)(\/[^/]+)?$/);
    assert.equal(opts.headers.Authorization,'Bearer seller-token-UTF8-á');
    if(opts.method==='POST') {
      const payload=JSON.parse(opts.body), idem=opts.headers['X-Idempotency-Key']; provider.posts.push({payload,idem});
      const order=db.tables.catalogo_pedidos.find(r=>r.referencia_externa===payload.external_reference); assert.ok(order);
      const saved=db.tables.catalogo_pedido_itens.filter(i=>i.pedido_id===order.id);
      assert.equal(saved.length,order.metadata.items_snapshot.length,'POST apenas com itens completos');
      assert.equal(saved.reduce((sum,i)=>sum+i.total_item_centavos,0),order.subtotal_produtos_centavos);
      if(provider.beforePost) await provider.beforePost(order);
      if(provider.idempotent.has(idem)) assert.deepEqual(payload,provider.idempotent.get(idem).payload,'MESMO payload com mesma chave');
      else {
        const id=String(9000+provider.idempotent.size);
        const p={id,status:'pending',collector_id:order.comercio_id==='loja-a'?123:456,currency_id:'BRL',transaction_amount:payload.transaction_amount,application_fee:payload.application_fee,external_reference:payload.external_reference,point_of_interaction:{transaction_data:{qr_code:'000201-PIX-FAKE-'+id,qr_code_base64:'ZmFrZQ==',ticket_url:'https://example.invalid/pix'}}};
        if(provider.mutate)provider.mutate(p);
        provider.payments.set(id,p); provider.idempotent.set(idem,{id,payload});
      }
      const id=provider.idempotent.get(idem).id;
      return new Response(JSON.stringify({id,...(provider.postResponse||{})}),{status:provider.postHttpStatus});
    }
    const id=decodeURIComponent(String(url).split('/').pop()); provider.gets.push(id);
    return new Response(JSON.stringify(provider.payments.get(id)||{}),{status:provider.getHttpStatus});
  };
  function loadEndpoint(rel) {
    let handler;
    const env={SUPABASE_URL:'https://db.invalid',SUPABASE_SERVICE_ROLE_KEY:'local-service',MP_OAUTH_ENCRYPTION_KEY:key,MP_MARKETPLACE_WEBHOOK_SECRET:options.webhookSecret ?? secret,MARKETPLACE_CHECKOUT_ENABLED:'true'};
    const context=vm.createContext(baseContext({...h,console:{error(...args){ diagnostics.push(args.join(" ")); }},createClient:()=>db,fetch:fetchFake,Deno:{env:{get:n=>env[n]},serve:fn=>{handler=fn;}}}));
    const src=read(rel).replace(/^import[\s\S]*?;\s*$/gm,'');
    vm.runInContext(stripTypeScriptTypes(src,{mode:'strip'}),context,{filename:rel}); assert.equal(typeof handler,'function'); return handler;
  }
  const pix=loadEndpoint('supabase/functions/catalogo-pedido-pix/index.ts');
  const webhook=loadEndpoint('supabase/functions/mercadopago-marketplace-webhook/index.ts');
  const body={comercio_id:'loja-a',request_id:requestId,modalidade:'entrega',forma_pagamento:'pix',entrega_centavos:0,itens:[{id:productId,quantidade:1}],cliente:{nome:'João á',email:'comprador@example.com',telefone:'32999999999',endereco:'Rua São João',numero:'10',bairro:'Centro'}};
  const call=async(b=body)=>{ const response=await pix(new Request('https://local.invalid/pix',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'192.0.2.1'},body:JSON.stringify(b)})); return {status:response.status,body:await response.json()}; };
  const notify=async({id='9000',kind='payment',bodyId='evento-10000',bodyDataId=id,queryId=id,ts=String(Math.floor(Date.now()/1000)),signature=true,extra={}}={})=>{
    const rid='request-MP-123'; const sig=createHmac('sha256',secret).update(h.buildWebhookManifest(id,rid,ts)).digest('hex');
    const response=await webhook(new Request('https://local.invalid/webhook?type='+kind+(queryId===null?'':'&data.id='+queryId),{method:'POST',headers:{'content-type':'application/json','x-request-id':rid,'x-signature':`ts=${ts},v1=${signature?sig:'0'.repeat(64)}`},body:JSON.stringify({id:bodyId,type:kind,data:{id:bodyDataId},...extra})}));
    return {status:response.status,body:await response.json()};
  };
  return {db,provider,pix,webhook,body,call,notify,diagnostics};
}

test('catalogo-v2-pix-endpoints criação entrega: código6/hash/token forte/AAD e fee7% com schema real',async()=>{
  const f=await fixture(); const result=await f.call(); assert.equal(result.status,200,JSON.stringify(result.body));
  const r=f.db.tables.catalogo_pedidos[0]; assert.equal(r.status_pagamento,'pendente'); assert.equal(r.status,'aguardando_pagamento');
  assert.match(result.body.codigo_entrega,/^\d{6}$/); assert.match(result.body.status_token,/^[a-f0-9]{64}$/);
  assert.equal(r.codigo_entrega_hash,await h.sha256Hex(result.body.codigo_entrega)); assert.equal(r.status_token_hash,await h.sha256Hex(result.body.status_token));
  assert.equal(await h.decryptAesGcm(r.codigo_entrega_enc,key,'delivery-code-v2:'+r.id),result.body.codigo_entrega);
  assert.equal(result.body.versao_financeira,2); assert.equal(f.provider.posts[0].payload.application_fee,7); assert.equal(result.body.taxa_motoboy_centavos,200);
  assert.equal(f.db.tables.catalogo_pedido_itens.length,1); assert.ok(result.body.pix_codigo); assert.equal(result.body.metadata,undefined);
});
test('catalogo-v2-pix-endpoints retirada/consumo são v2 com 5%, zero motoboy; desativado mantém v1',async()=>{
  for(const mode of ['retirada','consumo_local']) { const f=await fixture(); f.body.modalidade=mode; const r=await f.call(); assert.equal(r.status,200); assert.equal(r.body.versao_financeira,2); assert.equal(r.body.taxa_motoboy_centavos,0); assert.equal(f.provider.posts[0].payload.application_fee,5); }
  const f=await fixture({active:false}); const r=await f.call(); assert.equal(r.status,200); assert.equal(r.body.versao_financeira,1); assert.equal(f.provider.posts[0].payload.application_fee,5);
});
test('catalogo-v2-pix-endpoints retry recupera mesma prova, preços/snapshot congelados e só um POST',async()=>{
  const f=await fixture(); const a=await f.call(); f.db.active=false; f.db.tables.catalogo_produtos.forEach(p=>p.preco='999.99'); const b=await f.call();
  assert.equal(b.status,200); assert.equal(a.body.pedido_id,b.body.pedido_id); assert.equal(a.body.codigo_entrega,b.body.codigo_entrega); assert.equal(a.body.status_token,b.body.status_token);
  assert.equal(f.provider.posts.length,1); assert.equal(f.provider.idempotent.size,1); assert.equal(f.db.tables.catalogo_pedido_itens.length,1); assert.equal(b.body.total_centavos,10000); assert.equal(b.body.versao_financeira,2);
});
test('catalogo-v2-pix-endpoints falha itens não POST/cancela; recovery concorrente mantém snapshot e pagamento único',async()=>{
  const f=await fixture({failItems:1}); const fail=await f.call(); assert.equal(fail.status,503); assert.equal(f.provider.posts.length,0);
  const order=f.db.tables.catalogo_pedidos[0]; assert.equal(order.status,'aguardando_pagamento'); assert.equal(order.status_pagamento,'pendente'); assert.equal(order.metadata.itens_registro_pendente,true);
  f.db.tables.catalogo_produtos.forEach(p=>p.preco='555.55'); const pool=await Promise.all([f.call(),f.call(),f.call()]);
  assert.ok(pool.every(r=>r.status===200),JSON.stringify(pool)); assert.equal(f.provider.idempotent.size,1); assert.equal(f.db.tables.catalogo_pedido_itens.length,1);
  assert.equal(order.subtotal_produtos_centavos,10000); assert.equal(order.metadata.itens_registro_pendente,false);
});
test('catalogo-v2-pix-endpoints concorrência 23505 nunca paga sem itens completos',async()=>{
  const f=await fixture(); const pool=await Promise.all(Array.from({length:4},()=>f.call())); assert.ok(pool.every(r=>r.status===200),JSON.stringify(pool));
  assert.equal(f.db.tables.catalogo_pedidos.length,1); assert.equal(f.db.tables.catalogo_pedido_itens.length,1); assert.equal(f.provider.idempotent.size,1);
});
test('catalogo-v2-pix-endpoints fingerprint rejeita carrinho/modalidade/endereço alterados no mesmo UUID',async()=>{
  const f=await fixture(); const a=await f.call(); assert.equal(a.status,200);
  for(const modify of [b=>b.itens[0].quantidade=2,b=>b.modalidade='retirada',b=>b.cliente.numero='999']) { const b=clone(f.body); modify(b); const r=await f.call(b); assert.equal(r.status,409); assert.equal(r.body.status_token,undefined); }
  assert.equal(f.provider.posts.length,1);
});
test('catalogo-v2-pix-endpoints mesmo UUID em outro comércio/identidade não recupera segredos anteriores',async()=>{
  const f=await fixture(); const a=await f.call(); const other=clone(f.body); other.comercio_id='loja-b'; const b=await f.call(other);
  const identity=clone(f.body); identity.cliente.email='outro@example.com'; const c=await f.call(identity);
  assert.equal(b.status,200); assert.equal(c.status,200); assert.notEqual(a.body.pedido_id,b.body.pedido_id); assert.notEqual(a.body.status_token,b.body.status_token); assert.notEqual(a.body.status_token,c.body.status_token);
  const wrongPhone=clone(f.body); wrongPhone.cliente.telefone='32888888888'; const d=await f.call(wrongPhone); assert.notEqual(a.body.status_token,d.body.status_token);
  assert.equal(f.db.tables.catalogo_pedidos.length,4);
});
test('catalogo-v2-pix-endpoints rejeita UUID não aleatório, quantidade deduplicada>99, overflow e frete arbitrário',async()=>{
  for(const modify of [b=>b.request_id='-'.repeat(36),b=>b.request_id='b0000000-0000-1000-8000-000000000001',b=>b.itens=[{id:productId,quantidade:60},{id:productId,quantidade:40}],b=>b.entrega_centavos=999999,b=>b.cliente.bairro='',b=>b.cliente.endereco='',b=>b.cliente.numero='']) {
    const f=await fixture(); modify(f.body); const r=await f.call(); assert.equal(r.status,400); assert.equal(f.db.tables.catalogo_pedidos.length,0); assert.equal(f.provider.posts.length,0);
  }
  for(const kind of ['line','subtotal']) { const f=await fixture(); f.db.tables.catalogo_produtos.forEach(p=>p.preco='21474836.47'); if(kind==='line')f.body.itens[0].quantidade=2; else f.body.itens.push({id:secondId,quantidade:1}); const r=await f.call(); assert.equal(r.status,400); assert.equal(f.db.tables.catalogo_pedidos.length,0); }
});
test('catalogo-v2-pix-endpoints deduplicação até99 é válida; soma/integers checados',async()=>{
  const f=await fixture(); f.body.itens=[{id:productId,quantidade:50},{id:productId,quantidade:49}]; const r=await f.call(); assert.equal(r.status,200); assert.equal(f.db.tables.catalogo_pedido_itens[0].quantidade,99); assert.equal(r.body.total_centavos,990000);
});
test('catalogo-v2-pix-endpoints não recria Pix para cancelamento definitivo do comprador',async()=>{
  const f=await fixture({failItems:1}); await f.call(); const order=f.db.tables.catalogo_pedidos[0]; order.status='cancelado'; order.cancelado_em=new Date().toISOString();
  const r=await f.call(); assert.equal(r.status,409); assert.equal(f.provider.posts.length,0); assert.equal(f.db.tables.catalogo_pedido_itens.length,0);
});
test('catalogo-v2-pix-endpoints payment HTTPerro com id exige GET válido; semGET falha; retry usa mesma idempotência/payload',async()=>{
  const f=await fixture(); f.provider.postHttpStatus=400; f.provider.getHttpStatus=500; const fail=await f.call(); assert.equal(fail.status,503); assert.equal(fail.body.success,false);
  f.db.active=false; f.db.tables.catalogo_produtos.forEach(p=>p.preco='888.00'); f.provider.getHttpStatus=200; const retry=await f.call(); assert.equal(retry.status,200); assert.equal(f.provider.idempotent.size,1);
  assert.deepEqual(f.provider.posts[0],f.provider.posts[1]); assert.equal(f.db.tables.catalogo_pedido_itens.length,1);
});
test('catalogo-v2-pix-endpoints pending semQR não declara Pix gerado; retry sóGET recupera',async()=>{
  const f=await fixture(); f.provider.mutate=p=>delete p.point_of_interaction; const r=await f.call(); assert.equal(r.status,503); assert.equal(r.body.success,false);
  assert.equal(f.db.tables.catalogo_pedidos[0].payment_id,'9000'); f.provider.payments.get('9000').point_of_interaction={transaction_data:{qr_code:'RECUPERADO'}};
  const retry=await f.call(); assert.equal(retry.status,200); assert.equal(retry.body.pix_codigo,'RECUPERADO'); assert.equal(f.provider.posts.length,1);
});
test('catalogo-v2-pix-endpoints approved semQR só aprovado porGET/RPC, nunca status browser',async()=>{
  const f=await fixture(); f.body.status='approved'; f.body.collector_id=999; f.provider.mutate=p=>{p.status='approved';delete p.point_of_interaction;}; const r=await f.call();
  assert.equal(r.status,200); assert.equal(r.body.status_pagamento,'aprovado'); assert.equal(r.body.status,'pago'); assert.equal(f.db.rpcCalls.filter(c=>c.name==='catalogo_aplicar_pagamento_v2').length,1);
});
test('catalogo-v2-pix-endpoints valida collector/currency/amount/reference/id deGET na criação',async()=>{
  for(const mutate of [p=>delete p.collector_id,p=>p.collector_id=999,p=>p.currency_id='USD',p=>delete p.currency_id,p=>p.transaction_amount=999,p=>delete p.external_reference,p=>p.id='outro']) {
    const f=await fixture(); f.provider.mutate=mutate; const r=await f.call(); assert.equal(r.status,409); assert.equal(r.body.success,false); assert.equal(f.db.rpcCalls.filter(c=>c.name==='catalogo_aplicar_pagamento_v2').length,0);
  }
});
test('catalogo-v2-pix-endpoints taxa divergente cria revisão; taxa ausente não declara financiamento',async()=>{
  const f=await fixture(); f.provider.mutate=p=>{p.status='approved';p.application_fee=1;}; const r=await f.call(); assert.equal(r.status,409); assert.equal(f.db.rpcCalls.at(-1).args.p_status,'revisao_parcial');
  const g=await fixture(); g.provider.mutate=p=>{p.status='approved';delete p.application_fee;}; const s=await g.call(); assert.equal(s.status,200); assert.equal(s.body.revisao_financeira,true); assert.equal(s.body.taxa_conferida,false); assert.equal(g.db.rpcCalls.at(-1).args.p_taxa_centavos,null);
});
test('catalogo-v2-pix-endpoints webhook antes de artefato/POST final preserva approved e em_preparo, merge de metadados',async()=>{
  const f=await fixture();
  f.db.beforeArtifact=order=>{ order.status='em_preparo';order.status_pagamento='aprovado';order.metadata={...order.metadata,webhook:{aprovado:true},reconciliacao:'preservada'}; };
  const r=await f.call(); assert.equal(r.status,200); assert.equal(r.body.status,'em_preparo'); assert.equal(r.body.status_pagamento,'aprovado');
  const order=f.db.tables.catalogo_pedidos[0]; assert.equal(order.metadata.reconciliacao,'preservada'); assert.equal(order.metadata.webhook.aprovado,true);
});
test('catalogo-v2-pix-endpoints webhook padrão body.id != data.id, HMAC sec/ms e GET autoritativo',async()=>{
  const f=await fixture(); await f.call(); f.provider.payments.get('9000').status='approved';
  for(const ts of [String(Math.floor(Date.now()/1000)),String(Date.now())]) { const r=await f.notify({ts,extra:{status:'canceled',collector_id:999,external_reference:'fraude'}}); assert.equal(r.status,200); assert.equal(r.body.status,'aprovado'); assert.equal(r.body.taxa_conferida,true); }
  assert.equal(f.db.tables.catalogo_pedidos[0].status_pagamento,'aprovado');
});
test('catalogo-v2-pix-endpoints webhook dados divergentes/HMAC inválido/expirado rejeitados antesGET',async()=>{
  const f=await fixture(); await f.call(); const gets=f.provider.gets.length;
  assert.equal((await f.notify({bodyDataId:'9001'})).status,401);
  assert.equal((await f.notify({signature:false})).status,401);
  assert.equal((await f.notify({ts:String(Math.floor(Date.now()/1000)-601)})).status,401);
  assert.equal(f.provider.gets.length,gets);
});
test('catalogo-v2-pix-endpoints pagamento desconhecido assinado retorna503/retry, nãoACK200',async()=>{
  const f=await fixture(); const r=await f.notify(); assert.equal(r.status,503); assert.equal(r.body.retry,true); assert.equal(f.provider.gets.length,0);
  let early;
  f.provider.beforePost=async()=>{early=await f.notify();}; const paid=await f.call(); assert.equal(early.status,503); assert.equal(paid.status,200);
  f.provider.payments.get('9000').status='approved'; const later=await f.notify(); assert.equal(later.status,200); assert.equal(later.body.status_pagamento,'aprovado');
});
test('catalogo-v2-pix-endpoints webhook collector obrigatório/exato, currency/reference/id/amount estritos',async()=>{
  for(const mutate of [p=>delete p.collector_id,p=>p.collector_id=456,p=>p.currency_id='USD',p=>delete p.currency_id,p=>p.transaction_amount=101,p=>p.id='9001',p=>delete p.external_reference,p=>p.external_reference='guia-outro']) {
    const f=await fixture(); await f.call(); mutate(f.provider.payments.get('9000')); const r=await f.notify(); assert.equal(r.status,409); assert.equal(f.db.rpcCalls.filter(c=>c.name==='catalogo_aplicar_pagamento_v2').length,0);
  }
});
test('catalogo-v2-pix-endpoints webhook fee_details application_fee; missingfee retido; feeerror revisão',async()=>{
  const f=await fixture(); await f.call(); const p=f.provider.payments.get('9000'); p.status='approved'; delete p.application_fee; p.fee_details=[{type:'mercadopago_fee',amount:1},{type:'application_fee',amount:7}];
  const r=await f.notify(); assert.equal(r.status,200); assert.equal(r.body.financiamento_comprovado,true); assert.equal(f.db.rpcCalls.at(-1).args.p_taxa_centavos,700);
  delete p.fee_details; const noFee=await f.notify(); assert.equal(noFee.status,200); assert.equal(noFee.body.financiamento_comprovado,false); assert.equal(noFee.body.revisao_financeira,true);
  p.application_fee=6; const wrongFee=await f.notify(); assert.equal(wrongFee.status,409); assert.equal(wrongFee.body.revisao_financeira,true); assert.equal(f.db.rpcCalls.at(-1).args.p_status,'revisao_parcial'); assert.equal(f.db.rpcCalls.at(-1).args.p_valor_centavos,10000);
});
test('catalogo-v2-pix-endpoints refund parcial vai para revisão preservando bruto; total e chargeback precedem approved',async()=>{
  const f=await fixture(); await f.call(); const p=f.provider.payments.get('9000'); p.status='approved'; p.status_detail='partially_refunded'; p.transaction_amount_refunded=25;
  const partial=await f.notify(); assert.equal(partial.status,200); assert.equal(partial.body.status,'revisao_parcial'); assert.equal(f.db.rpcCalls.at(-1).args.p_status,'revisao_parcial'); assert.equal(f.db.rpcCalls.at(-1).args.p_valor_centavos,10000);
  assert.equal(f.db.tables.catalogo_pedidos[0].total_centavos,10000); assert.notEqual(f.db.tables.catalogo_pedidos[0].status_pagamento,'estornado');
  p.status_detail='refunded'; p.transaction_amount_refunded=100; await f.notify(); assert.equal(f.db.rpcCalls.at(-1).args.p_status,'estornado');
  p.status_detail='charged_back'; await f.notify(); assert.equal(f.db.rpcCalls.at(-1).args.p_status,'charged_back');
});
test('catalogo-v2-pix-endpoints Orders legado usa guia-UUID e GET orders, sem fallback de moeda ausente',async()=>{
  const f=await fixture({active:false}); await f.call(); const order=f.db.tables.catalogo_pedidos[0]; order.order_id='ORD_123'; order.payment_id=null;
  f.provider.payments.set('ORD_123',{id:'ORD_123',status:'processed',external_reference:'guia-'+order.id,user_id:123,currency_id:'BRL',total_amount:100,marketplace_fee:5});
  const r=await f.notify({id:'ORD_123',kind:'orders_v2'}); assert.equal(r.status,200); assert.equal(r.body.order_id,'ORD_123'); assert.equal(f.db.rpcCalls.at(-1).args.p_taxa_centavos,500);
  delete f.provider.payments.get('ORD_123').currency_id; f.provider.payments.get('ORD_123').country_code='BR'; assert.equal((await f.notify({id:'ORD_123',kind:'order'})).status,409);
});
test('catalogo-v2-pix-endpoints rate limit e erroRPC são falhas seguras, não aprovação fictícia',async()=>{
  const f=await fixture({allowed:false}); assert.equal((await f.call()).status,429); assert.equal(f.provider.posts.length,0);
  const g=await fixture({rpcError:true}); g.provider.mutate=p=>p.status='approved'; const r=await g.call(); assert.equal(r.status,503); assert.equal(r.body.success,false); assert.equal(g.db.tables.catalogo_pedidos[0].status_pagamento,'pendente');
});
test('catalogo-v2-pix-endpoints mock deriva colunas/checks reais e rejeita coluna/estado desconhecidos',async()=>{
  const f=await fixture(); assert.throws(()=>f.db.from('catalogo_pedidos').select('id,ticket_url'),/select inválido/); await f.call();
  const row=clone(f.db.tables.catalogo_pedidos[0]); row.status_pagamento='fake'; assert.throws(()=>checkRow('catalogo_pedidos',row),/financeiro válido/);
  row.status_pagamento='pendente'; row.campo_falso=true; assert.throws(()=>checkRow('catalogo_pedidos',row),/coluna desconhecida/);
});

test('catalogo-v2-pix-endpoints precificação piloto recebe comércio: somente allowlist vira v2',async()=>{
  const f=await fixture({pilots:['loja-a']}); const a=await f.call(); assert.equal(a.status,200); assert.equal(a.body.versao_financeira,2);
  const b=clone(f.body);b.comercio_id='loja-b';b.modalidade='retirada';const outside=await f.call(b);assert.equal(outside.status,200);assert.equal(outside.body.versao_financeira,1);
  assert.deepEqual(f.db.rpcCalls.filter(c=>c.name==='catalogo_fluxo_precificar').map(c=>c.args.p_comercio_id),['loja-a','loja-b']);
});
test('catalogo-v2-pix-endpoints itens ausentes depois do MP não são apagados/recriados em retry',async()=>{
  const f=await fixture();await f.call();f.db.tables.catalogo_pedido_itens.length=0;const r=await f.call();assert.equal(r.status,503);assert.equal(f.db.tables.catalogo_pedido_itens.length,0);assert.equal(f.provider.posts.length,1);
});
test('catalogo-v2-pix-endpoints prova do comprador exige identidade/hash/AAD original, nunca id/email apenas',async()=>{
  for(const mutate of [r=>r.metadata.buyer_identity_hash='outro',r=>r.status_token_hash='0'.repeat(64),r=>r.codigo_entrega_hash='0'.repeat(64),r=>r.codigo_entrega_enc=r.metadata.status_token_enc]) {
    const f=await fixture();await f.call();mutate(f.db.tables.catalogo_pedidos[0]);const r=await f.call();assert.ok([404,503].includes(r.status));assert.equal(r.body.status_token,undefined);assert.equal(r.body.codigo_entrega,undefined);assert.equal(f.provider.posts.length,1);
  }
});
test('catalogo-v2-pix-endpoints webhook real aprova durante CAS; POST final não regrava em_preparo/aprovado/metadados',async()=>{
  const f=await fixture();let webhookResponse;
  f.db.beforeArtifact=async order=>{
    order.payment_id='9000';f.provider.payments.get('9000').status='approved';
    webhookResponse=await f.notify(); assert.equal(webhookResponse.status,200);
    order.status='em_preparo';order.metadata={...order.metadata,operacao_comercio:'aceito depois da aprovação'};
  };
  const r=await f.call();assert.equal(r.status,200);assert.equal(r.body.status,'em_preparo');assert.equal(r.body.status_pagamento,'aprovado');
  const order=f.db.tables.catalogo_pedidos[0];assert.equal(order.metadata.sql_conciliado,true);assert.equal(order.metadata.operacao_comercio,'aceito depois da aprovação');assert.equal(f.provider.idempotent.size,1);
});
test('catalogo-v2-pix-endpoints erro após criação conserva payload/chave apesar de mudança model API metadata',async()=>{
  const f=await fixture();f.provider.getHttpStatus=500;assert.equal((await f.call()).status,503);
  f.db.tables.catalogo_pedidos[0].metadata.api_model='orders_v2';f.db.active=false;f.provider.getHttpStatus=200;
  const r=await f.call();assert.equal(r.status,200);assert.deepEqual(f.provider.posts[0],f.provider.posts[1]);assert.equal(f.provider.idempotent.size,1);
});
test('catalogo-v2-pix-endpoints revisão por taxa guarda fato divergente; refund/chargeback ainda têm precedência',async()=>{
  const f=await fixture();await f.call();const p=f.provider.payments.get('9000');p.status='approved';p.application_fee=1;
  assert.equal((await f.notify()).status,409);const order=f.db.tables.catalogo_pedidos[0];assert.equal(order.metadata.provider_fee_review.observado_centavos,100);assert.equal(order.metadata.provider_fee_review.esperado_centavos,700);assert.equal(order.status_pagamento,'contestado');assert.equal(f.db.rpcCalls.at(-1).args.p_taxa_centavos,null);
  p.status_detail='charged_back';await f.notify();assert.equal(f.db.rpcCalls.at(-1).args.p_status,'charged_back');
  p.status_detail='refunded';await f.notify();assert.equal(f.db.rpcCalls.at(-1).args.p_status,'estornado');
});
test('catalogo-v2-pix-endpoints legacy orders body.id é recurso somente quando data.id não existe',async()=>{
  const f=await fixture({active:false});await f.call();const order=f.db.tables.catalogo_pedidos[0];order.order_id='ORD123';
  f.provider.payments.set('ORD123',{id:'ORD123',status:'processed',external_reference:'guia-'+order.id,collector_id:123,currency_id:'BRL',total_amount:100,marketplace_fee:5});
  const r=await f.notify({id:'ORD123',kind:'orders',queryId:null,bodyDataId:null,bodyId:'ORD123'});assert.equal(r.status,200);assert.equal(r.body.order_id,'ORD123');
});


test('webhook normaliza apenas espaço externo do segredo copiado, sem dispensar HMAC',async()=>{
  const f=await fixture({webhookSecret:' \r\n'+secret+'\n '});await f.call();f.provider.payments.get('9000').status='approved';
  assert.equal((await f.notify()).status,200);
  const before=f.provider.gets.length;
  assert.equal((await f.notify({signature:false})).status,401);
  assert.equal(f.provider.gets.length,before);
});
test('diagnóstico distingue assinatura divergente de timestamp antigo sem revelar segredo/header',async()=>{
  const f=await fixture();await f.call();const before=f.provider.gets.length;
  assert.equal((await f.notify({signature:false})).status,401);
  let log=JSON.parse(f.diagnostics.at(-1).split('marketplace webhook rejected: ')[1]);
  assert.equal(log.hmac_confere,false);assert.equal(log.formato_valido,true);assert.equal(log.segredo_configurado,true);
  assert.equal((await f.notify({ts:String(Math.floor(Date.now()/1000)-601)})).status,401);
  log=JSON.parse(f.diagnostics.at(-1).split('marketplace webhook rejected: ')[1]);
  assert.equal(log.hmac_confere,true);assert.ok(log.idade_segundos>=600);
  assert.equal(f.provider.gets.length,before);
  const text=f.diagnostics.join('\n');assert.ok(!text.includes(secret));assert.ok(!text.includes('v1='));assert.ok(!text.includes('seller-token'));
});
test('segredo ausente permanece fail-closed e registra somente sua ausência',async()=>{
  const f=await fixture({webhookSecret:''});await f.call();const before=f.provider.gets.length;
  assert.equal((await f.notify()).status,401);
  const log=JSON.parse(f.diagnostics.at(-1).split('marketplace webhook rejected: ')[1]);
  assert.equal(log.segredo_configurado,false);assert.equal(log.hmac_confere,false);
  assert.equal(f.provider.gets.length,before);
});
