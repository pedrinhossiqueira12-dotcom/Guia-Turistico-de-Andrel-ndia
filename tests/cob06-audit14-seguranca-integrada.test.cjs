const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createDb,rpc,IDS}=require('./helpers/catalogo-v2-db.cjs');

// Banco em memoria e identidades ficticias. Nenhuma URL ou conexao externa.
test('audit-14: corte completo preserva legado e nega RPCs privilegiadas aos clientes',async()=>{
 const db=await createDb();
 try{
  await db.exec(`CREATE TABLE comercios_publicados(local_id text PRIMARY KEY,status text,
   destaque boolean DEFAULT false,deletado_em timestamptz,atualizado_em timestamptz,atualizado_por uuid);
   INSERT INTO comercios_publicados(local_id,status) VALUES('loja-a','ativo'),('loja-b','ativo');`);
  const f=(await db.query(`INSERT INTO catalogo_fechamentos_offline
   (comercio_id,competencia,total_pedidos,total_comissao_centavos,status)
   VALUES('loja-a','2024-01-01',1,700,'pago') RETURNING id`)).rows[0].id;
  await db.query(`INSERT INTO catalogo_fatura_cobrancas
   (fechamento_id,comercio_id,competencia,gateway,order_id,status,valor_centavos)
   VALUES($1,'loja-a','2024-01-01','mercadopago','mp-legado-audit14','pago',700)`,[f]);
  const before=(await db.query('SELECT * FROM catalogo_fatura_cobrancas WHERE fechamento_id=$1',[f])).rows[0];
  assert.equal(before.status,'pago');
  assert.equal(before.gateway,'mercadopago');
  const base=require('../scripts/validacao-pagamentos/asaas-cob06-billing-only.lock.json');
  const audit=require('../scripts/validacao-pagamentos/asaas-cob06-auditoria-review.lock.json');
  for(const {path} of [...base.files,...audit.files])await db.exec(fs.readFileSync(path,'utf8'));
  const internals=(await db.query(`SELECT p.oid::regprocedure::text assinatura,
   has_function_privilege('anon',p.oid,'EXECUTE') anon,
   has_function_privilege('authenticated',p.oid,'EXECUTE') autenticado,
   has_function_privilege('service_role',p.oid,'EXECUTE') servidor
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname IN (
    'catalogo_registrar_cobranca_fatura_pre_auditoria','catalogo_confirmar_cobranca_fatura_pre_auditoria',
    'catalogo_finalizar_encerramento_pre_vitrine','catalogo_arquivar_sem_catalogo_pre_vitrine',
    'catalogo_operar_pedido_pre_suspensao','catalogo_confirmar_entrega_pre_suspensao',
    'catalogo_confirmar_motoboy_pre_suspensao')`)).rows;
  assert.equal(internals.length,7,'Todos os sete nomes internos existem sem sobrecarga extra');
  for(const row of internals)assert.deepEqual([row.anon,row.autenticado,row.servidor],[false,false,false],row.assinatura);
  assert.deepEqual((await db.query('SELECT * FROM catalogo_fatura_cobrancas WHERE fechamento_id=$1',[f])).rows[0],before);
  assert.deepEqual((await db.query(`SELECT to_regclass('public.catalogo_asaas_saques') IS NULL saques_ausentes,
   to_regclass('public.catalogo_asaas_acumulo_lotes') IS NULL acumulo_ausente`)).rows[0],
   {saques_ausentes:true,acumulo_ausente:true});
  const calls=[
   `catalogo_reservar_emissao_mp_fatura('${f}',700)`,
   `catalogo_registrar_cobranca_fatura('${f}','intruso',700,NULL,NULL,NULL,NULL,'fixture')`,
   `catalogo_confirmar_cobranca_fatura('mp-legado-audit14','pago','fixture',700,'fixture')`,
   `catalogo_finalizar_encerramento_financeiro('loja-a','${IDS.admin}')`,
   `catalogo_arquivar_sem_catalogo_admin('loja-a','${IDS.admin}')`,
   `catalogo_confirmar_vitrine_admin('loja-a','${IDS.admin}')`,
   `catalogo_listar_encerramentos_admin('${IDS.admin}')`,
   `catalogo_operar_pedido_v2('${IDS.owner}','loja-a','${f}','aceitar',NULL,NULL)`,
   `catalogo_confirmar_entrega_autenticada('${IDS.owner}','loja-a','${f}','fixture',NULL)`,
   `catalogo_confirmar_entrega_motoboy('${IDS.rider}','loja-a','${f}','fixture')`,
  ];
  for(const role of ['anon','authenticated']){
   await db.exec(`SET ROLE ${role}`);
   try{
    for(const call of calls)await assert.rejects(db.query(`SELECT public.${call}`),{code:'42501'},`${role}: ${call.split('(')[0]}`);
    await assert.rejects(db.query('SELECT * FROM catalogo_private.catalogo_vitrine_reconciliacoes'),{code:'42501'});
   }finally{await db.exec('RESET ROLE');}
  }
  // O backend tambem nao pode chamar nomes internos ou escrever o journal.
  await db.exec('SET ROLE service_role');
  try{
   await assert.rejects(db.query(`SELECT public.catalogo_finalizar_encerramento_pre_vitrine('loja-a','${IDS.admin}')`),{code:'42501'});
   await assert.rejects(db.query(`INSERT INTO catalogo_private.catalogo_vitrine_reconciliacoes(comercio_id) VALUES('loja-a')`),{code:'42501'});
   assert.equal((await rpc(db,'catalogo_listar_encerramentos_admin',[IDS.admin])).length,0);
   assert.equal((await rpc(db,'catalogo_finalizar_encerramento_financeiro',['loja-a',IDS.outsider])).ok,false);
   assert.equal((await rpc(db,'catalogo_solicitar_encerramento_financeiro',['loja-b',IDS.owner])).ok,false);
   assert.equal((await rpc(db,'catalogo_solicitar_encerramento_financeiro',['loja-b',IDS.owner2])).ok,true);
   assert.equal((await rpc(db,'catalogo_finalizar_encerramento_financeiro',['loja-b',IDS.admin])).situacao,'arquivado');
   assert.equal((await rpc(db,'catalogo_listar_encerramentos_admin',[IDS.admin]))[0].sincronizacao_pendente,true);
   assert.equal((await rpc(db,'catalogo_confirmar_vitrine_admin',['loja-b',IDS.admin])).ok,true);
   assert.equal((await rpc(db,'catalogo_listar_encerramentos_admin',[IDS.admin])).length,0);
  }finally{await db.exec('RESET ROLE');}
  assert.deepEqual((await db.query('SELECT * FROM catalogo_fatura_cobrancas WHERE fechamento_id=$1',[f])).rows[0],before);
 }finally{await db.close();}
});
