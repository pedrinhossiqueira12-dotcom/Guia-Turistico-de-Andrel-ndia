const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createDb,rpc}=require('./helpers/catalogo-v2-db.cjs');
test('auditoria P3: quitar uma de duas faturas vencidas nao desbloqueia; estorno e terminal',async()=>{
 const db=await createDb();
 try{
  await db.exec(fs.readFileSync('supabase/pending-migrations/20261012163000_cob04_pagamento_somente_componentes_da_fatura.sql','utf8'));
  if(!process.env.COB06_AUDIT_BASELINE)await db.exec(fs.readFileSync('supabase/production-candidate/cob06-auditoria-03-inadimplencia.sql','utf8'));
  for(const [m,id] of [['01','mp-a'],['02','mp-b']]){
   const f=(await db.query(`INSERT INTO catalogo_fechamentos_offline(comercio_id,competencia,total_pedidos,total_comissao_centavos,status,vencimento_em) VALUES('loja-a',$1,1,700,'vencido','2020-01-01') RETURNING id`,['2020-'+m+'-01'])).rows[0].id;
   await rpc(db,'catalogo_registrar_cobranca_fatura',[f,id,700,null,null,null,null,'fixture']);
  }
  const motivo='Comissão de pagamentos presenciais vencida.';
  await db.query(`UPDATE catalogos SET bloqueado=true,motivo_bloqueio=$1 WHERE comercio_id='loja-a'`,[motivo]);
  const settle=(id,status='pago',value=700)=>rpc(db,'catalogo_confirmar_cobranca_fatura',[id,status,id+'-proof',value,'fixture']);
  assert.equal((await settle('mp-a','pago',699)).ok,false,'Pagamento parcial nao quita');
  assert.equal((await settle('mp-a')).ok,true);
  const read=async()=>(await db.query(`SELECT bloqueado,motivo_bloqueio FROM catalogos WHERE comercio_id='loja-a'`)).rows[0];
  assert.equal((await read()).bloqueado,true,'Outra fatura vencida continua bloqueando');
  assert.equal((await settle('mp-b')).catalogo_desbloqueado,true);
  assert.equal((await read()).bloqueado,false);
  await settle('mp-a','estornado');
  assert.equal((await read()).bloqueado,true);
  assert.equal((await settle('mp-a')).ok,false,'Recebimento atrasado nao reativa estorno');
  assert.equal((await db.query(`SELECT status FROM catalogo_fatura_cobrancas WHERE order_id='mp-a'`)).rows[0].status,'estornado');
  for(const m of ['Bloqueio administrativo','Encerramento solicitado pelo proprietário']){
   await db.query(`UPDATE catalogos SET bloqueado=true,motivo_bloqueio=$1 WHERE comercio_id='loja-a'`,[m]);
   await settle('mp-b');
   assert.deepEqual(await read(),{bloqueado:true,motivo_bloqueio:m});
  }
 }finally{await db.close();}
});
