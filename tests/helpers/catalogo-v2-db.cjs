const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { PGlite } = require(process.env.PGLITE_TEST_MODULE || '@electric-sql/pglite');
const ROOT = path.resolve(__dirname, '../..');
const V2 = '20261007010434_catalogo_entregas_v2.sql';
const IDS = {
 owner: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', owner2: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 rider: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', rider2: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 outsider: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', admin: '4b9a0233-6b72-4573-aebd-d596c5b15e1b',
 banned: 'ffffffff-ffff-4fff-8fff-ffffffffffff', unverified: '11111111-1111-4111-8111-111111111111',
};
const HASH = createHash('sha256').update('123456').digest('hex');
const BAD_HASH = createHash('sha256').update('654321').digest('hex');
const migration = name => fs.readFileSync(path.join(ROOT, 'supabase/migrations', name), 'utf8');
async function createDb() {
 const db = new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,banned_until timestamptz);
 CREATE TABLE public.catalogos(comercio_id text PRIMARY KEY,proprietario_id uuid,bloqueado boolean DEFAULT false,motivo_bloqueio text);
 INSERT INTO public.catalogos VALUES('loja-a','${IDS.owner}',false,NULL),('loja-b','${IDS.owner2}',false,NULL);`);
 for (const [name, id] of Object.entries(IDS)) {
  await db.query(`INSERT INTO auth.users VALUES($1,$2,CASE WHEN $3 THEN NULL ELSE now() END,CASE WHEN $4 THEN now()+interval '1 day' ELSE NULL END)`, [id, `${name}@fixture.test`, name==='unverified', name==='banned']);
 }
 for (const name of [
  '20261004223000_catalogo_marketplace_pedidos.sql',
  '20261005120000_catalogo_pagamentos_offline.sql',
  '20261005123000_catalogo_pedidos_offline_auditoria.sql',
  '20261005130000_catalogo_offline_rate_limit.sql',
  '20261005150000_catalogo_fechamento_automatico.sql',
  '20261005160000_catalogo_fatura_pix.sql',
  '20261005170000_catalogo_correcao_confirmacao_offline.sql',
  '20261006175809_confirmacao_entrega_painel.sql',
  '20261006184332_catalogo_motoboys_acesso_restrito.sql', V2,
 ]) await db.exec(migration(name));
 for (const [commerce,rider,active] of [['loja-a','rider',true],['loja-b','rider',false],['loja-a','rider2',true],['loja-b','rider2',true],['loja-a','banned',true],['loja-a','unverified',true]]) {
  await db.query(`INSERT INTO catalogo_motoboys(comercio_id,usuario_id,nome,email,ativo,autorizado_por) VALUES($1,$2,$3,$4,$5,$6)`,[commerce,IDS[rider],rider,`${rider}@fixture.test`,active,IDS.owner]);
 }
 return db;
}
async function rpc(db,name,args=[]) {
 const r=await db.query(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS r`,args);
 return r.rows[0].r;
}
async function order(db,opts={}) {
 const id=randomUUID(); const version=opts.version??2; const mode=opts.mode??'entrega'; const sub=opts.subtotal??1000;
 const fee=Math.round(sub*.05), bonus=version===2&&mode==='entrega'?Math.round(sub*.02):0;
 const token=createHash('sha256').update(randomUUID()).digest('hex');
 const provider=opts.provider??'offline';
 await db.query(`INSERT INTO catalogo_pedidos(id,comercio_id,referencia_externa,idempotency_key,provedor,status,status_pagamento,modalidade,forma_pagamento,
 subtotal_produtos_centavos,entrega_centavos,total_centavos,taxa_plataforma_centavos,taxa_motoboy_centavos,taxa_total_centavos,repasse_bruto_comercio_centavos,
 cliente_nome,cliente_telefone,cliente_endereco,observacoes,codigo_entrega_hash,codigo_entrega_expira_em,status_token_hash,versao_financeira)
 VALUES($1::uuid,$2,$1::text,$3,$4,$5,$6,$7,$8,$9,300,$9::integer+300,$10,$11,$10::integer+$11::integer,$9::integer-$10::integer-$11::integer+300,
 'Cliente PRIVADO','32999999999','Rua PRIVADA','Observação PRIVADA',$12,now()+interval '1 day',$13,$14)`,
 [id,opts.commerce??'loja-a',randomUUID(),provider,opts.status??'aguardando_pagamento',opts.paymentStatus??'pendente',mode,provider==='offline'?'dinheiro':'pix',sub,fee,bonus,HASH,token,version]);
 await db.query(`INSERT INTO catalogo_pedido_itens(pedido_id,nome_produto,preco_unitario_centavos,quantidade,total_item_centavos) VALUES($1,'Produto seguro',$2,1,$2)`,[id,sub]);
 return {id,token,total:sub+300,fee,bonus,feeTotal:fee+bonus,commerce:opts.commerce??'loja-a'};
}
const row=async(db,id,table='catalogo_pedidos')=>(await db.query(`SELECT * FROM public.${table} WHERE ${table==='catalogo_pedidos'?'id':'pedido_id'}=$1`,[id])).rows[0];
const act=(db,who,action,id=null,available=null,reason=null,category=null,pix=null)=>rpc(db,'catalogo_motoboy_acao_v2',[who,action,id,available,reason,category,pix]);
const operate=(db,o,action,who=IDS.owner,rider=null)=>rpc(db,'catalogo_operar_pedido_v2',[who,o.commerce,o.id,action,rider,'Motivo fixture']);
const pay=(db,o,status='approved',fee=o.feeTotal,ref='mp:'+o.id)=>rpc(db,'catalogo_aplicar_pagamento_v2',[o.id,status,o.total,fee,ref]);
const confirm=(db,o,who=IDS.rider,hash=HASH)=>rpc(db,'catalogo_confirmar_entrega_motoboy',[who,o.commerce,o.id,hash]);
async function ready(db,o,rider=IDS.rider) {
 await act(db,rider,'disponibilidade',null,true);
 if ((await row(db,o.id)).provedor==='mercadopago') await pay(db,o);
 const a=await operate(db,o,'aceitar',o.commerce==='loja-a'?IDS.owner:IDS.owner2); if(!a.ok) throw new Error(JSON.stringify(a));
 const b=await operate(db,o,'pronto',o.commerce==='loja-a'?IDS.owner:IDS.owner2); if(!b.ok) throw new Error(JSON.stringify(b));
}
async function collect(db,o,rider=IDS.rider) {
 await ready(db,o,rider);
 for(const action of ['aceitar_entrega','coletar','em_entrega']) { const r=await act(db,rider,action,o.id); if(!r.ok) throw new Error(JSON.stringify(r)); }
}
async function invoice(db,commerce,competence,payIt=true) {
 const fid=(await db.query('SELECT catalogo_gerar_fechamento_offline($1,$2::date) id',[commerce,competence])).rows[0].id;
 const f=(await db.query('SELECT * FROM catalogo_fechamentos_offline WHERE id=$1',[fid])).rows[0];
 const reference='fat:'+fid;
 const registered=await rpc(db,'catalogo_registrar_cobranca_fatura',[fid,reference,f.total_comissao_centavos,null,null,null,null,'Fixture sem transferência externa']);
 if(!registered.ok) throw new Error(JSON.stringify(registered));
 if(payIt) { const paid=await rpc(db,'catalogo_confirmar_cobranca_fatura',[reference,'pago','payment:'+fid,f.total_comissao_centavos,'Conciliação fixture']); if(!paid.ok) throw new Error(JSON.stringify(paid)); }
 return {...f,reference};
}
const admin=(db,action,opts={})=>rpc(db,'catalogo_operacao_admin_v2',[Object.hasOwn(opts,'actor')?opts.actor:IDS.admin,action,opts.occ??null,opts.decision??null,opts.reason??null,opts.rider??null,opts.orders??null,opts.ref??null,opts.proof??null]);
module.exports={createDb,rpc,order,row,act,operate,pay,confirm,ready,collect,invoice,admin,migration,V2,IDS,HASH,BAD_HASH};
