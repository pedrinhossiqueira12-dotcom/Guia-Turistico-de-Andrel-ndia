const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createDb,order}=require('./helpers/catalogo-v2-db.cjs');
test('auditoria P1: entrega tardia fora de snapshot pago continua devida, sem reabrir fatura',async()=>{
 const db=await createDb();
 try{
  const old=fs.readFileSync('supabase/pending-migrations/20261009162000_bloquear_exclusao_debitos_e_finalizar_arquivamento.sql','utf8');
  await db.exec(old.slice(old.indexOf('CREATE OR REPLACE FUNCTION'),old.indexOf('-- Corrige a análise')));
  if(!process.env.COB06_AUDIT_BASELINE)await db.exec(fs.readFileSync('supabase/production-candidate/cob06-auditoria-01-pendencias.sql','utf8'));
  const paid=await order(db,{version:1,status:'entregue',paymentStatus:'aprovado'});
  const late=await order(db,{version:1,status:'entregue',paymentStatus:'aprovado',subtotal:14000});
  for(const [o,status] of [[paid,'paga'],[late,'aberta']])await db.query(`INSERT INTO catalogo_comissoes_offline(pedido_id,comercio_id,competencia,subtotal_produtos_centavos,valor_comissao_centavos,status) VALUES($1,'loja-a','2026-01-01',$2,$3,$4)`,[o.id,o.total-300,o.fee,status]);
  const f=(await db.query(`INSERT INTO catalogo_fechamentos_offline(comercio_id,competencia,total_pedidos,total_comissao_centavos,status,pago_em,referencia_pagamento) VALUES('loja-a','2026-01-01',1,50,'pago','2026-02-01','mp-historico') RETURNING *`)).rows[0];
  await db.query(`INSERT INTO catalogo_fatura_componentes_v2 VALUES($1,$2,'plataforma',50)`,[f.id,paid.id]);
  const read=async()=>(await db.query(`SELECT catalogo_private.catalogo_pendencias_encerramento('loja-a') p`)).rows[0].p;
  assert.equal((await read()).divida_centavos,700);
  assert.equal((await read()).pedidos_em_andamento,0,'Pedido tardio ja concluido nao pode ocultar divida');
  await db.query(`INSERT INTO catalogo_fatura_componentes_v2 VALUES($1,$2,'plataforma',200)`,[f.id,late.id]);
  assert.equal((await read()).divida_centavos,500,'Cobertura parcial nao apaga saldo fora do snapshot');
  assert.deepEqual((await db.query('SELECT * FROM catalogo_fechamentos_offline WHERE id=$1',[f.id])).rows[0],f);
  await db.query(`UPDATE catalogo_comissoes_offline SET status='cancelada' WHERE pedido_id=$1`,[late.id]);
  assert.equal((await read()).divida_centavos,0);
 }finally{await db.close();}
});
