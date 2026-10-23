const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {createDb,rpc,IDS}=require('./helpers/catalogo-v2-db.cjs');
test('auditoria P4: arquivo financeiro sem sincronizacao permanece na fila administrativa',async()=>{
 const edge=fs.readFileSync('supabase/functions/catalogo-asaas-financeiro/index.ts','utf8');
 const a=edge.indexOf('async function listarEncerramentosAdmin('),b=edge.indexOf('async function finalizarEncerramentoAdmin(',a);
 const rows=[{comercio_id:'loja-arquivada',situacao:'arquivado',sincronizacao_pendente:true}];
 const q={select(){return q;},neq(_k,v){q.filtered=rows.filter(r=>r.situacao!==v);return q;},order(){return q;},limit:async()=>({data:q.filtered,error:null})};
 const fn=vm.runInNewContext(stripTypeScriptTypes(edge.slice(a,b))+';listarEncerramentosAdmin',{
  ADMIN_USER_ID:'admin',Failure:Error,respond:x=>x,db:{from:()=>q},rpc:async()=>rows,
 });
 const result=await fn('admin');
 assert.equal(result.encerramentos.length,1,'Arquivo nao sincronizado nao pode desaparecer');
 assert.equal(result.encerramentos[0].sincronizacao_pendente,true);
});

test('auditoria P4: journal SQL nasce com arquivamento e somente ACK idempotente retira da fila',async()=>{
 const db=await createDb();
 try{
  await db.exec(`CREATE TABLE comercios_publicados(local_id text PRIMARY KEY,status text,destaque boolean DEFAULT false,deletado_em timestamptz,atualizado_em timestamptz,atualizado_por uuid); INSERT INTO comercios_publicados(local_id,status) VALUES('loja-a','ativo');`);
  for(const p of ['supabase/production-candidate/02_termos_encerramento_sem_saques.sql',
   'supabase/pending-migrations/20261009162000_bloquear_exclusao_debitos_e_finalizar_arquivamento.sql',
   'supabase/production-candidate/cob06-auditoria-04-vitrine.sql'])await db.exec(fs.readFileSync(p,'utf8'));
  await rpc(db,'catalogo_solicitar_encerramento_financeiro',['loja-a',IDS.owner]);
  assert.equal((await rpc(db,'catalogo_finalizar_encerramento_financeiro',['loja-a',IDS.admin])).ok,true);
  const list=()=>rpc(db,'catalogo_listar_encerramentos_admin',[IDS.admin]);
  assert.equal((await list())[0].sincronizacao_pendente,true);
  await rpc(db,'catalogo_finalizar_encerramento_financeiro',['loja-a',IDS.admin]);
  assert.equal((await list()).length,1,'Retry nao perde a pendencia nem desfaz arquivo');
  assert.equal((await rpc(db,'catalogo_confirmar_vitrine_admin',['loja-a',IDS.outsider])).ok,false);
  assert.equal((await rpc(db,'catalogo_confirmar_vitrine_admin',['loja-a',IDS.admin])).ok,true);
  assert.equal((await list()).length,0);
  assert.equal((await rpc(db,'catalogo_confirmar_vitrine_admin',['loja-a',IDS.admin])).ok,true);
  await rpc(db,'catalogo_finalizar_encerramento_financeiro',['loja-a',IDS.admin]);
  assert.equal((await list()).length,0,'Retry nao reabre fila ja confirmada');
  assert.equal((await db.query(`SELECT has_table_privilege('service_role','catalogo_private.catalogo_vitrine_reconciliacoes','INSERT') p`)).rows[0].p,false);
  assert.equal((await db.query(`SELECT has_function_privilege('authenticated','public.catalogo_confirmar_vitrine_admin(text,uuid)','EXECUTE') p`)).rows[0].p,false);
 }finally{await db.close();}
});
