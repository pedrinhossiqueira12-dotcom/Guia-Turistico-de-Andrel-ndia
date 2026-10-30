const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createDb,rpc}=require('./helpers/catalogo-v2-db.cjs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
test('auditoria P2: MP nao substitui cobranca Asaas; reserva e compartilhada e duravel',async()=>{
 const db=await createDb();
 try{
  await db.exec(fs.readFileSync('supabase/production-candidate/01_asaas_cobrancas_inbox_sem_saques.sql','utf8'));
  if(!process.env.COB06_AUDIT_BASELINE)await db.exec(fs.readFileSync('supabase/production-candidate/cob06-auditoria-02-emissao.sql','utf8'));
  const f=(await db.query(`INSERT INTO catalogo_fechamentos_offline(comercio_id,competencia,total_pedidos,total_comissao_centavos,status) VALUES('loja-a','2026-01-01',1,700,'faturado') RETURNING id`)).rows[0].id;
  await db.query('INSERT INTO catalogo_asaas_emissoes(fechamento_id) VALUES($1)',[f]);
  assert.equal((await rpc(db,'catalogo_asaas_registrar_fatura',[f,'pay_asaas_unico',700,null,null,null,null])).ok,true);
  const before=(await db.query('SELECT * FROM catalogo_fatura_cobrancas WHERE fechamento_id=$1',[f])).rows[0];
  const registered=await rpc(db,'catalogo_registrar_cobranca_fatura',[f,'mp_order_intrusa',700,null,null,null,null,'fixture']);
  assert.equal(registered.ok,false,'RPC legada nao pode sobrescrever ID de Asaas');
  assert.deepEqual((await db.query('SELECT * FROM catalogo_fatura_cobrancas WHERE fechamento_id=$1',[f])).rows[0],before);
  const f2=(await db.query(`INSERT INTO catalogo_fechamentos_offline(comercio_id,competencia,total_pedidos,total_comissao_centavos,status) VALUES('loja-a','2026-02-01',1,700,'faturado') RETURNING id`)).rows[0].id;
  const reserve=()=>rpc(db,'catalogo_reservar_emissao_mp_fatura',[f2,700]);
  assert.equal((await reserve()).nova,true);
  assert.equal((await reserve()).nova,false,'Timeout nao concede outra tentativa POST');
  await assert.rejects(db.query('INSERT INTO catalogo_asaas_emissoes(fechamento_id) VALUES($1)',[f2]));
  await assert.rejects(rpc(db,'catalogo_asaas_registrar_fatura',[f2,'pay_invasor',700,null,null,null,null]));
  await assert.rejects(db.query('UPDATE catalogo_fechamentos_offline SET total_comissao_centavos=701 WHERE id=$1',[f2]));
  await assert.rejects(db.query(`UPDATE catalogo_asaas_emissoes SET gateway='asaas' WHERE fechamento_id=$1`,[f2]));
  assert.equal((await db.query(`SELECT has_function_privilege('anon','public.catalogo_reservar_emissao_mp_fatura(uuid,integer)','EXECUTE') p`)).rows[0].p,false);
  assert.equal((await db.query(`SELECT has_function_privilege('service_role','public.catalogo_registrar_cobranca_fatura_pre_auditoria(uuid,text,integer,text,text,text,timestamptz,text)','EXECUTE') p`)).rows[0].p,false);
 }finally{await db.close();}
});

test('auditoria P2: duas emissoes HTTP simuladas MP fazem um POST apos reserva SQL real',async()=>{
 const db=await createDb();
 try{
  for(const file of ['01_asaas_cobrancas_inbox_sem_saques.sql','cob06-auditoria-02-emissao.sql'])
   await db.exec(fs.readFileSync('supabase/production-candidate/'+file,'utf8'));
  const f=(await db.query(`INSERT INTO catalogo_fechamentos_offline(comercio_id,competencia,total_pedidos,total_comissao_centavos,status) VALUES('loja-a','2026-03-01',1,700,'faturado') RETURNING *`)).rows[0];
  const source=fs.readFileSync('supabase/functions/catalogo-fatura-pix/index.ts','utf8');
  const a=source.indexOf('async function criarCobranca('),b=source.indexOf('async function conciliar(',a);
  let posts=0;
  const context={requireEnabled(){},text:x=>x,owner:async()=>({}),isCompetencia:()=>true,
   configuracoes:async()=>({fatura_pix_ativo:true}),carregarFatura:async()=>({fechamento:f,cobranca:null}),
   podeEmitirCobranca:()=>({ok:true,valorCentavos:700}),montarReferenciaFatura:()=> 'fatura-fixture',
   assertSeller:async()=> 'seller',chaveIdempotenciaFatura:()=> 'idempotente',centsToAmountString:()=> '7.00',
   admin:{rpc:async(name,p)=>({data:await rpc(db,name,name==='catalogo_reservar_emissao_mp_fatura'?
    [p.p_fechamento,p.p_valor]:[p.p_fechamento_id,p.p_order_id,p.p_valor_centavos,p.p_qr_code,p.p_qr_code_base64,p.p_ticket_url,p.p_expira_em,p.p_detalhe]),error:null})},
   mpRequest:async(_path,method)=>{if(method==='POST')posts++;return {id:'mp-fixture'};},
   assessFaturaOrder:()=>({valid:true,status:'pending'}),extractPixDetails:()=>({code:'pix-fixture'}),
   conciliar:async()=>({status:'pendente'}),json:x=>x,console,
   HttpError:class extends Error{constructor(msg,status){super(msg);this.status=status;}}
  };
  const fn=vm.runInNewContext(stripTypeScriptTypes(source.slice(a,b))+';criarCobranca',context);
  const results=await Promise.allSettled([fn('owner',{comercio_id:'loja-a',competencia:'2026-03'},'owner@fixture.test'),fn('owner',{comercio_id:'loja-a',competencia:'2026-03'},'owner@fixture.test')]);
  assert.equal(posts,1);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await db.query('SELECT gateway,order_id FROM catalogo_fatura_cobrancas WHERE fechamento_id=$1',[f.id])).rows[0].gateway,'mercadopago');
 }finally{await db.close();}
});
