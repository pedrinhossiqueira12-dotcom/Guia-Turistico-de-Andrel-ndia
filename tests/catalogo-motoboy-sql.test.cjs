const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
let PGlite;
try { ({ PGlite } = require(process.env.PGLITE_TEST_MODULE || '@electric-sql/pglite')); } catch { /* Integração opcional. */ }
const OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RIDER='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RIDER2='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const BUYER='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const UNVERIFIED='ffffffff-ffff-4fff-8fff-ffffffffffff';
const HASH=createHash('sha256').update('123456').digest('hex');
const migration=fs.readdirSync('supabase/migrations').find(x=>x.endsWith('_catalogo_motoboys_acesso_restrito.sql'));

test('PostgreSQL: área motoboy com autorização mínima e comissão transacional', {skip:!PGlite}, async t=>{
 const db=new PGlite();
 try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
   CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,banned_until timestamptz);
   INSERT INTO auth.users VALUES
    ('${OWNER}','owner@example.test',now(),null),('${OTHER}','other@example.test',now(),null),
    ('${RIDER}','rider@example.test',now(),null),('${RIDER2}','rider2@example.test',now(),null),
    ('${BUYER}','buyer@example.test',now(),null),('${UNVERIFIED}','unverified@example.test',null,null);
   CREATE TABLE public.catalogos(comercio_id text PRIMARY KEY,proprietario_id uuid,bloqueado boolean DEFAULT false);
   INSERT INTO catalogos VALUES('loja-a','${OWNER}',false),('loja-b','${OTHER}',false);`);
  for (const name of ['20261004223000_catalogo_marketplace_pedidos.sql','20261005120000_catalogo_pagamentos_offline.sql','20261005123000_catalogo_pedidos_offline_auditoria.sql','20261006175809_confirmacao_entrega_painel.sql',migration]) await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
  async function manage(actor,action,commerce='loja-a',orderId=null,rider=null,email=null,name=null){
   return (await db.query('SELECT catalogo_gerir_motoboys($1,$2,$3,$4,$5,$6,$7,0) AS r',[actor,action,commerce,orderId,rider,email,name])).rows[0].r;
  }
  async function order(commerce='loja-a',status='pronto',mode='entrega',provider='offline'){
   const id=randomUUID();
   await db.query(`INSERT INTO catalogo_pedidos(id,comercio_id,referencia_externa,idempotency_key,provedor,status,modalidade,forma_pagamento,
    subtotal_produtos_centavos,entrega_centavos,total_centavos,taxa_plataforma_centavos,repasse_bruto_comercio_centavos,
    cliente_nome,cliente_telefone,cliente_endereco,codigo_entrega_hash,codigo_entrega_expira_em)
    VALUES($1::uuid,$2,$1::text,$3,$4,$5,$6,'dinheiro',1000,200,1200,50,1150,'Cliente','32999999999','Rua de teste',$7,now()+interval '1 day')`,[id,commerce,randomUUID(),provider,status,mode,HASH]);
   return id;
  }
  async function confirm(actor,id,commerce='loja-a',hash=HASH){
   return (await db.query('SELECT catalogo_confirmar_entrega_motoboy($1,$2,$3,$4) AS r',[actor,commerce,id,hash])).rows[0].r;
  }
  async function list(actor,commerce=null){return (await db.query('SELECT catalogo_listar_entregas_restritas($1,$2,0) AS r',[actor,commerce])).rows[0].r;}
  const itemCount=async id=>(await db.query('SELECT count(*)::integer AS n FROM catalogo_comissoes_offline WHERE pedido_id=$1',[id])).rows[0].n;
  await t.test('nenhum cadastro comum ou owner sem vínculo entra como motoboy',async()=>{
   assert.equal((await list(BUYER)).http_status,403);assert.equal((await list(OWNER)).http_status,403);
   assert.equal((await manage(RIDER,'autorizar_motoboy','loja-a',null,null,'rider@example.test','Rider')).http_status,403);
  });
  await t.test('convite exige proprietário e e-mail confirmado, sem alterar ownership',async()=>{
   assert.equal((await manage(OWNER,'autorizar_motoboy','loja-a',null,null,'unverified@example.test','Teste')).http_status,404);
   assert.equal((await manage(OTHER,'autorizar_motoboy','loja-a',null,null,'rider@example.test','Rider')).http_status,403);
   assert.equal((await manage(OWNER,'autorizar_motoboy','loja-a',null,null,'RIDER@example.test','Motoboy 1')).ok,true);
   assert.equal((await manage(OWNER,'autorizar_motoboy','loja-a',null,null,'rider2@example.test','Motoboy 2')).ok,true);
   assert.equal((await db.query("SELECT proprietario_id FROM catalogos WHERE comercio_id='loja-a'")).rows[0].proprietario_id,OWNER);
  });
  await t.test('autorizar motoboy não concede gestão, faturas ou permissão SQL direta',async()=>{
   assert.equal((await manage(RIDER,'listar_motoboys')).http_status,403);
   assert.equal((await list(RIDER,'loja-a')).http_status,403);
   await db.exec('SET ROLE authenticated;');
   await assert.rejects(db.query('SELECT nome FROM catalogo_motoboys LIMIT 1'),/permission denied/);
   await assert.rejects(db.query('SELECT catalogo_listar_entregas_restritas($1,NULL,0)',[RIDER]),/permission denied/);
   await db.exec('RESET ROLE;');
  });
  await t.test('lista revela somente pedidos atribuídos, nunca hash/código/token/fatura',async()=>{
   const own=await order();const unassigned=await order();const other=await order('loja-b');
   assert.equal((await manage(OWNER,'atribuir_pedido','loja-a',own,RIDER)).ok,true);
   const result=await list(RIDER);assert.equal(result.ok,true);
   assert.deepEqual(result.pedidos.map(p=>p.pedido_id),[own]);
   assert.ok(!JSON.stringify(result).includes(unassigned));assert.ok(!JSON.stringify(result).includes(other));
   assert.doesNotMatch(JSON.stringify(result),/codigo_entrega|status_token|cliente_email|taxa_plataforma|comissao|metadata/);
  });
  await t.test('UUID correto e código correto não bastam sem atribuição exata',async()=>{
   const id=await order();assert.equal((await confirm(RIDER,id)).http_status,403);
   await manage(OWNER,'atribuir_pedido','loja-a',id,RIDER);
   assert.equal((await confirm(RIDER2,id)).http_status,403);
   assert.equal((await confirm(RIDER,id,'loja-b')).http_status,403);
   assert.equal((await db.query('SELECT codigo_entrega_tentativas FROM catalogo_pedidos WHERE id=$1',[id])).rows[0].codigo_entrega_tentativas,0);
  });
  await t.test('retirada, Pix e pedidos concluídos não são atribuíveis',async()=>{
   for(const [mode,provider,status,expected] of [['retirada','offline','pronto',404],['entrega','mercadopago','pronto',404],['entrega','offline','cancelado',409]]){
    assert.equal((await manage(OWNER,'atribuir_pedido','loja-a',await order('loja-a',status,mode,provider),RIDER)).http_status,expected);
   }
  });
  await t.test('motoboy espera pedido pronto; owner mantém baixa existente em preparo',async()=>{
   const id=await order('loja-a','em_preparo');await manage(OWNER,'atribuir_pedido','loja-a',id,RIDER);
   assert.equal((await confirm(RIDER,id)).http_status,409);
   assert.equal((await db.query('SELECT catalogo_confirmar_entrega_autenticada($1,$2,$3,$4,NULL) AS r',[OWNER,'loja-a',id,HASH])).rows[0].r.ok,true);
  });
  await t.test('revogação bloqueia sessão antiga e é reversível somente pelo dono',async()=>{
   const id=await order();await manage(OWNER,'atribuir_pedido','loja-a',id,RIDER);
   assert.equal((await manage(OWNER,'suspender_motoboy','loja-a',null,RIDER)).ok,true);
   assert.equal((await list(RIDER)).http_status,403);assert.equal((await confirm(RIDER,id)).http_status,403);
   await manage(OWNER,'autorizar_motoboy','loja-a',null,null,'rider@example.test','Motoboy 1');
   assert.equal((await list(RIDER)).ok,true);
  });
  await t.test('reatribuição invalida o motoboy anterior imediatamente',async()=>{
   const id=await order();await manage(OWNER,'atribuir_pedido','loja-a',id,RIDER);
   await manage(OWNER,'atribuir_pedido','loja-a',id,RIDER2);
   assert.equal((await confirm(RIDER,id)).http_status,403);
   assert.equal((await confirm(RIDER2,id)).ok,true);
  });
  await t.test('código errado não baixa; sucesso audita motoboy e cobra 5% uma vez',async()=>{
   const id=await order();await manage(OWNER,'atribuir_pedido','loja-a',id,RIDER);
   assert.equal((await confirm(RIDER,id,'loja-a','0'.repeat(64))).http_status,403);assert.equal(await itemCount(id),0);
   assert.equal((await confirm(RIDER,id)).ok,true);
   const r=(await db.query('SELECT status,concluido_por FROM catalogo_pedidos WHERE id=$1',[id])).rows[0];assert.equal(r.status,'entregue');assert.equal(r.concluido_por,RIDER);
   const events=(await db.query("SELECT ator_id,ator_tipo FROM catalogo_pedido_eventos WHERE pedido_id=$1 AND para_status='entregue'",[id])).rows;
   assert.deepEqual(events,[{ator_id:RIDER,ator_tipo:'entregador'}]);
   assert.equal((await db.query('SELECT valor_comissao_centavos FROM catalogo_comissoes_offline WHERE pedido_id=$1',[id])).rows[0].valor_comissao_centavos,50);
   assert.equal((await confirm(RIDER,id)).http_status,409);assert.equal(await itemCount(id),1);
  });
  await t.test('wrapper motoboy não herda privilégios de proprietário de uma conta com dupla função',async()=>{
   await manage(OWNER,'autorizar_motoboy','loja-a',null,null,'owner@example.test','Conta dupla');
   const unassigned=await order();assert.equal((await confirm(OWNER,unassigned)).http_status,403);
   const waiting=await order('loja-a','em_preparo');await manage(OWNER,'atribuir_pedido','loja-a',waiting,OWNER);
   assert.equal((await confirm(OWNER,waiting)).http_status,409);
   await db.query("UPDATE catalogo_pedidos SET status='pronto' WHERE id=$1",[waiting]);
   assert.equal((await confirm(OWNER,waiting)).ok,true);
   assert.equal((await db.query("SELECT ator_tipo FROM catalogo_pedido_eventos WHERE pedido_id=$1 AND para_status='entregue'",[waiting])).rows[0].ator_tipo,'entregador');
  });
  await t.test('função interna não pode ser chamada diretamente nem pelo service_role',async()=>{
   const r=(await db.query("SELECT has_function_privilege('service_role','public.catalogo_confirmar_entrega_base(uuid,text,uuid,text,text,boolean)','EXECUTE') AS base,has_function_privilege('anon','public.catalogo_confirmar_entrega_motoboy(uuid,text,uuid,text)','EXECUTE') AS anon,has_function_privilege('service_role','public.catalogo_confirmar_entrega_motoboy(uuid,text,uuid,text)','EXECUTE') AS backend")).rows[0];
   assert.deepEqual(r,{base:false,anon:false,backend:true});
  });
 } finally {await db.close();}
});
