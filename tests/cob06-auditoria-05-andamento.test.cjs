const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {createDb,order,operate,rpc,ready,act,confirm,IDS,HASH,BAD_HASH}=require('./helpers/catalogo-v2-db.cjs');
test('auditoria P5: pedido aceito antes da suspensao termina; novo aceite e titular alheio sao recusados',async()=>{
 const db=await createDb();
 try{
  if(!process.env.COB06_AUDIT_BASELINE)await db.exec(fs.readFileSync('supabase/production-candidate/cob06-auditoria-05-andamento.sql','utf8'));
  const o=await order(db,{mode:'retirada'}),novo=await order(db,{mode:'retirada'});
  assert.equal((await operate(db,o,'aceitar')).ok,true);
  await db.exec(`UPDATE catalogos SET bloqueado=true,motivo_bloqueio='Encerramento solicitado pelo proprietário' WHERE comercio_id='loja-a'`);
  const source=fs.readFileSync('supabase/functions/catalogo-pedidos-offline-admin/index.ts','utf8');
  const a=source.indexOf('async function updateStatus('),b=source.indexOf('async function confirmDelivery(',a);
  const fn=vm.runInNewContext(stripTypeScriptTypes(source.slice(a,b))+';updateStatus',{
   text:x=>x,owner:async()=>({bloqueado:true}),requireTermsForNewOrders:async()=>{},
   db:{rpc:async(_name,p)=>({data:await rpc(db,'catalogo_operar_pedido_v2',[p.p_operador_id,p.p_comercio_id,p.p_pedido_id,p.p_acao,p.p_motoboy_id,p.p_motivo]),error:null})},
   HttpError:class extends Error{},console,isCompetenciaBusy:()=>false,
  });
  await fn(IDS.owner,{comercio_id:'loja-a',pedido_id:o.id,status:'pronto',motivo:''});
  await assert.rejects(fn(IDS.owner,{comercio_id:'loja-a',pedido_id:novo.id,status:'em_preparo',motivo:''}));
  assert.equal((await operate(db,novo,'aceitar')).ok,false,'SQL tambem recusa novo aceite');
  await assert.rejects(order(db,{mode:'retirada'}),'Novo pedido fica proibido tambem na tabela');
  await assert.rejects(db.query(`UPDATE catalogo_pedidos SET status='em_preparo',aceito_em=clock_timestamp() WHERE id=$1`,[novo.id]),'Entry point legado nao contorna aceite');
  assert.equal((await operate(db,o,'pronto',IDS.outsider)).ok,false);
  assert.equal((await rpc(db,'catalogo_confirmar_entrega_autenticada',[IDS.owner,'loja-a',o.id,BAD_HASH,'fixture'])).ok,false);
  assert.equal((await rpc(db,'catalogo_confirmar_entrega_autenticada',[IDS.owner,'loja-a',o.id,HASH,'fixture'])).ok,true);
  const p=(await db.query('SELECT status,status_pagamento,codigo_entrega_usado_em FROM catalogo_pedidos WHERE id=$1',[o.id])).rows[0];
  assert.equal(p.status,'entregue');assert.equal(p.status_pagamento,'aprovado');assert.ok(p.codigo_entrega_usado_em);
  assert.equal((await db.query(`SELECT bloqueado FROM catalogos WHERE comercio_id='loja-a'`)).rows[0].bloqueado,true);
 }finally{await db.close();}
});

test('auditoria P5: motoboy conclui entrega anterior sem liberar credito ainda nao financiado',async()=>{
 const db=await createDb();
 try{
  await db.exec(fs.readFileSync('supabase/production-candidate/cob06-auditoria-05-andamento.sql','utf8'));
  const o=await order(db);
  await ready(db,o);
  await db.exec(`UPDATE catalogos SET bloqueado=true,motivo_bloqueio='Encerramento solicitado pelo proprietário' WHERE comercio_id='loja-a'`);
  for(const acao of ['aceitar_entrega','coletar','em_entrega'])assert.equal((await act(db,IDS.rider,acao,o.id)).ok,true);
  assert.equal((await confirm(db,o,IDS.rider2)).ok,false,'Outro entregador nao conclui');
  assert.equal((await confirm(db,o)).ok,true);
  const r=(await db.query('SELECT status,financiamento_comprovado FROM catalogo_remuneracoes_v2 WHERE pedido_id=$1',[o.id])).rows[0];
  assert.equal(r.status,'retido');assert.equal(r.financiamento_comprovado,false);
  assert.equal((await db.query(`SELECT has_function_privilege('service_role','public.catalogo_operar_pedido_pre_suspensao(uuid,text,uuid,text,uuid,text)','EXECUTE') p`)).rows[0].p,false);
 }finally{await db.close();}
});

test('auditoria P5: suspensao historica exige instante comprovado; bloqueio administrativo permanece fechado',async()=>{
 const db=await createDb();
 try{
  const o=await order(db,{mode:'retirada'});
  await operate(db,o,'aceitar');
  await db.exec(`UPDATE catalogos SET bloqueado=true,motivo_bloqueio='Encerramento solicitado pelo proprietário' WHERE comercio_id='loja-a'`);
  await db.exec(fs.readFileSync('supabase/production-candidate/cob06-auditoria-05-andamento.sql','utf8'));
  const allowed=async()=>(await db.query(`SELECT catalogo_private.catalogo_continuacao_permitida('loja-a',$1) a`,[o.id])).rows[0].a;
  assert.equal(await allowed(),false,'Sem data historica nao inventar autorizacao');
  await db.exec(`CREATE TABLE catalogo_encerramentos_comercio(comercio_id text,solicitado_em timestamptz); INSERT INTO catalogo_encerramentos_comercio VALUES('loja-a',clock_timestamp());`);
  assert.equal(await allowed(),true,'Solicitacao historica legitima comprova o marco');
  await db.exec(`UPDATE catalogos SET motivo_bloqueio='Bloqueio administrativo' WHERE comercio_id='loja-a'`);
  assert.equal(await allowed(),false);
 }finally{await db.close();}
});
