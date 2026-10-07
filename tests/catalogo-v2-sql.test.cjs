const test = require('node:test');
const assert = require('node:assert/strict');
const {createDb,rpc,order,row,act,operate,pay,confirm,ready,collect,invoice,admin,migration,V2,IDS,HASH,BAD_HASH} = require('./helpers/catalogo-v2-db.cjs');

// Não há skip: ausência de PGlite é falha de ambiente, não falsa evidência de aprovação.
test('v2 PostgreSQL/PGlite funcional — migrations reais e financeiro sem transferências', async t => {
 const db=await createDb();
 const count=async(sql,args=[])=>(await db.query(sql,args)).rows[0].n;
 const feeRow=o=>row(db,o.id,'catalogo_comissoes_offline');
 const remuneration=o=>row(db,o.id,'catalogo_remuneracoes_v2');
 const competence=async(o,date)=>db.query('UPDATE catalogo_comissoes_offline SET competencia=$2::date WHERE pedido_id=$1',[o.id,date]);
 try {
  await t.test('flags default off; novos pedidos ativos são v2 em todas as modalidades e rounding em componentes',async()=>{
   let cfg=(await db.query('SELECT * FROM catalogo_fluxo_config')).rows[0];
   assert.equal(cfg.ativo,false);assert.equal(cfg.somente_pix,false);assert.equal(cfg.monitor_confiabilidade_ativo,false);
   assert.equal((await rpc(db,'catalogo_fluxo_precificar',['entrega',101])).versao_financeira,1);
   await db.exec('UPDATE catalogo_fluxo_config SET ativo=true');
   for(const mode of ['entrega','retirada','consumo_local']){
    const r=await rpc(db,'catalogo_fluxo_precificar',[mode,101]);assert.equal(r.versao_financeira,2);assert.equal(r.taxa_plataforma_centavos,5);
    assert.equal(r.taxa_motoboy_centavos,mode==='entrega'?2:0);assert.equal(r.taxa_total_centavos,mode==='entrega'?7:5);
   }
   const r=await rpc(db,'catalogo_fluxo_precificar',['entrega',10]);assert.equal(r.taxa_total_centavos,1);
   const separated=await rpc(db,'catalogo_fluxo_precificar',['entrega',30]);assert.equal(separated.taxa_plataforma_centavos,2);assert.equal(separated.taxa_motoboy_centavos,1);assert.equal(separated.taxa_total_centavos,3); // 0,5 -> 1; 0,2 -> 0.
   await db.exec('UPDATE catalogo_fluxo_config SET ativo=false');
  });
  await t.test('piloto por comércio: ativo+lista só v2 na loja incluída; 2 args/default NULL não contornam piloto',async()=>{
   const legacy=await order(db,{version:1});
   await db.exec("UPDATE catalogo_fluxo_config SET ativo=true,comercios_piloto=ARRAY['loja-a']::text[]");
   for(const mode of ['entrega','retirada','consumo_local']){
    assert.equal((await rpc(db,'catalogo_fluxo_precificar',[mode,1000,'loja-a'])).versao_financeira,2);
    assert.equal((await rpc(db,'catalogo_fluxo_precificar',[mode,1000,'loja-b'])).versao_financeira,1);
    assert.equal((await rpc(db,'catalogo_fluxo_precificar',[mode,1000])).versao_financeira,1);
   }
   assert.equal((await row(db,legacy.id)).versao_financeira,1);assert.equal((await row(db,legacy.id)).taxa_total_centavos,50);
   await db.exec('UPDATE catalogo_fluxo_config SET comercios_piloto=ARRAY[]::text[]');
   assert.equal((await rpc(db,'catalogo_fluxo_precificar',['entrega',1000,'loja-a'])).versao_financeira,1);
   await db.exec('UPDATE catalogo_fluxo_config SET comercios_piloto=NULL');
   assert.equal((await rpc(db,'catalogo_fluxo_precificar',['retirada',1000,'loja-b'])).versao_financeira,2);
   await db.exec('UPDATE catalogo_fluxo_config SET ativo=false,somente_pix=true');
   const disabled=await rpc(db,'catalogo_fluxo_precificar',['entrega',1000,'loja-a']);assert.equal(disabled.versao_financeira,1);assert.equal(disabled.somente_pix,false);assert.equal(disabled.ativo,false);
   await db.exec('UPDATE catalogo_fluxo_config SET somente_pix=false');
   const funcs=(await db.query("SELECT oid::regprocedure::text name FROM pg_proc WHERE proname='catalogo_fluxo_precificar'")).rows;
   assert.equal(funcs.length,1);assert.match(funcs[0].name,/text,integer,text/);
  });
  await t.test('listas/extrato inicializam default só em vínculo ativo e recusam ban/não confirmado',async()=>{
   assert.equal((await rpc(db,'catalogo_listar_entregas_v2',[IDS.rider,0])).ok,true);
   assert.equal((await rpc(db,'catalogo_motoboy_extrato_v2',[IDS.rider2,0])).ok,true);
   for(const who of [IDS.outsider,IDS.banned,IDS.unverified,IDS.owner,null]){
    assert.equal((await rpc(db,'catalogo_listar_entregas_v2',[who,0])).ok,false);
    assert.equal((await act(db,who,'disponibilidade',null,true)).http_status,403);
    assert.equal((await act(db,who,'salvar_chave_pix',null,null,null,null,'pix-v2:AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB')).http_status,403);
   }
   assert.equal(await count('SELECT count(*)::int n FROM catalogo_motoboy_perfis WHERE usuario_id=$1',[IDS.outsider]),0);
  });
  await t.test('ciphertext obrigatório e retorno próprio/admin nunca contém chave em claro',async()=>{
   assert.equal((await act(db,IDS.rider,'salvar_chave_pix',null,null,null,null,'email@pix.test')).http_status,400);
   const enc='pix-v2:AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB';
   assert.equal((await act(db,IDS.rider,'salvar_chave_pix',null,null,null,null,enc)).ok,true);
   const ext=await rpc(db,'catalogo_motoboy_extrato_v2',[IDS.rider,0]);assert.equal(ext.perfil.chave_pix_enc,enc);assert.equal(ext.perfil.chave_pix,undefined);
   assert.equal((await act(db,IDS.rider,'salvar_chave_pix',null,null,null,null,null)).ok,true);
   assert.equal((await rpc(db,'catalogo_motoboy_extrato_v2',[IDS.rider,0])).perfil.chave_pix_enc,null);
  });
  await t.test('pronto não pula aceite nem pagamento; identidade/comércio incorretos falham',async()=>{
   const o=await order(db,{provider:'mercadopago'});
   assert.equal((await operate(db,o,'aceitar')).http_status,409);
   assert.equal((await pay(db,o)).ok,true);
   assert.equal((await operate(db,o,'pronto')).http_status,409);
   assert.equal((await operate(db,o,'aceitar',IDS.outsider)).http_status,403);
   assert.equal((await rpc(db,'catalogo_operar_pedido_v2',[IDS.owner,'loja-b',o.id,'aceitar',null,null])).http_status,403);
   assert.equal(await count('SELECT count(*)::int n FROM catalogo_lancamentos_financeiros_v2 WHERE pedido_id=$1',[o.id]),0);
   assert.equal((await operate(db,o,'aceitar')).ok,true);assert.equal((await operate(db,o,'pronto')).ok,true);
  });
  await t.test('2 lojas: vínculo ativo em A/suspenso em B não permite claim/coleta em B',async()=>{
   const o=await order(db,{commerce:'loja-b'});await ready(db,o,IDS.rider2);
   await act(db,IDS.rider,'disponibilidade',null,true);
   assert.equal((await act(db,IDS.rider,'aceitar_entrega',o.id)).http_status,403);
   assert.equal((await act(db,IDS.rider2,'aceitar_entrega',o.id)).ok,true);
   await db.query("UPDATE catalogo_motoboys SET ativo=false WHERE comercio_id='loja-b' AND usuario_id=$1",[IDS.rider2]);
   for(const action of ['coletar','em_entrega','desistir','registrar_ocorrencia']) assert.equal((await act(db,IDS.rider2,action,o.id)).http_status,403);
   assert.equal((await confirm(db,o,IDS.rider2)).http_status,403);
   await db.query("UPDATE catalogo_motoboys SET ativo=true WHERE comercio_id='loja-b' AND usuario_id=$1",[IDS.rider2]);
  });
  await t.test('ban de auth depois do claim impede baixa/coleta mesmo mantendo vínculo de comércio',async()=>{
   const o=await order(db);await ready(db,o);await act(db,IDS.rider,'aceitar_entrega',o.id);
   await db.query("UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=$1",[IDS.rider]);
   assert.equal((await act(db,IDS.rider,'coletar',o.id)).http_status,403);
   assert.equal((await confirm(db,o)).http_status,403);assert.equal((await row(db,o.id)).codigo_entrega_tentativas,0);
   await db.query('UPDATE auth.users SET banned_until=NULL WHERE id=$1',[IDS.rider]);
   assert.equal((await act(db,IDS.rider,'coletar',o.id)).ok,true);
   await db.query("UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=$1",[IDS.rider]);
   assert.equal((await confirm(db,o)).http_status,403);await db.query('UPDATE auth.users SET banned_until=NULL WHERE id=$1',[IDS.rider]);
  });
  await t.test('ofertas sem PII/tokens; indisponível não aceita; dois claims serializados: primeiro vence',async()=>{
   const o=await order(db);await ready(db,o);
   await act(db,IDS.rider2,'disponibilidade',null,false);
   assert.equal((await act(db,IDS.rider2,'aceitar_entrega',o.id)).http_status,403);
   const listing=await rpc(db,'catalogo_listar_entregas_v2',[IDS.rider,0]); const offer=listing.pedidos.find(p=>p.pedido_id===o.id);
   assert.equal(offer.oferta,true);assert.doesNotMatch(JSON.stringify(offer),/PRIVAD|cliente_|observacoes|codigo|hash|token|pix|itens/);
   await act(db,IDS.rider2,'disponibilidade',null,true);
   const results=await Promise.all([act(db,IDS.rider,'aceitar_entrega',o.id),act(db,IDS.rider2,'aceitar_entrega',o.id)]);
   assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results[0].ok,true);assert.equal(results[1].http_status,409);
   assert.equal(await count('SELECT count(*)::int n FROM catalogo_entregas_atribuidas WHERE pedido_id=$1',[o.id]),1);
   const own=(await rpc(db,'catalogo_listar_entregas_v2',[IDS.rider,0])).pedidos.find(p=>p.pedido_id===o.id);
   assert.equal(own.cliente_nome,'Cliente PRIVADO');assert.equal(own.itens[0].nome_produto,'Produto seguro');
   assert.doesNotMatch(JSON.stringify(own),/codigo_entrega|status_token|chave_pix|metadata/);
  });
  await t.test('atribuição só entrega; preferência direta restringe claim, mantém v1 assigned legacy',async()=>{
   for(const mode of ['retirada','consumo_local']) {const o=await order(db,{mode});await operate(db,o,'aceitar');assert.equal((await operate(db,o,'atribuir',IDS.owner,IDS.rider)).http_status,409);}
   const o=await order(db);await ready(db,o);
   assert.equal((await operate(db,o,'atribuir',IDS.owner,IDS.rider2)).ok,true);
   assert.equal((await act(db,IDS.rider,'aceitar_entrega',o.id)).http_status,409);
   assert.equal((await act(db,IDS.rider2,'aceitar_entrega',o.id)).ok,true);
   const v1=await order(db,{version:1,status:'pronto'});
   assert.equal((await operate(db,v1,'atribuir',IDS.owner,IDS.rider)).ok,true);
   assert.equal((await row(db,v1.id,'catalogo_entregas_atribuidas')).motoboy_id,IDS.rider);
   assert.equal((await act(db,IDS.rider,'aceitar_entrega',v1.id)).http_status,409);
   assert.ok((await rpc(db,'catalogo_listar_entregas_v2',[IDS.rider,0])).pedidos.some(p=>p.pedido_id===v1.id));
  });
  await t.test('token de outro pedido não cancela; cancelamento antes/depois do aceite em ambas as ordens',async()=>{
   const a=await order(db),b=await order(db);
   assert.equal((await rpc(db,'catalogo_cancelar_comprador_v2',[a.id,b.token,'Teste'])).http_status,403);
   assert.equal((await rpc(db,'catalogo_cancelar_comprador_v2',[a.id,a.token,'Teste'])).ok,true);
   assert.equal((await operate(db,a,'aceitar')).http_status,409);
   assert.equal((await rpc(db,'catalogo_cancelar_comprador_v2',[a.id,a.token,'Retry'])).ok,true);
   assert.equal(await count('SELECT count(*)::int n FROM catalogo_ocorrencias_v2 WHERE pedido_id=$1',[a.id]),1);
   assert.equal((await operate(db,b,'aceitar')).ok,true);
   assert.equal((await rpc(db,'catalogo_cancelar_comprador_v2',[b.id,b.token,'Teste'])).http_status,409);
  });
  await t.test('pagamento Pix tardio após cancelamento mantém transporte cancelado e sinaliza refund pendente',async()=>{
   const o=await order(db,{provider:'mercadopago'});await rpc(db,'catalogo_cancelar_comprador_v2',[o.id,o.token,'Cancelado fixture']);
   assert.equal((await pay(db,o)).ok,true);const p=await row(db,o.id);
   assert.equal(p.status,'cancelado');assert.equal(p.entrega_status,'cancelado');assert.equal(p.status_pagamento,'aprovado');assert.equal(p.reembolso_pendente,true);
   assert.equal(await remuneration(o),undefined);assert.equal(await count('SELECT count(*)::int n FROM catalogo_lancamentos_financeiros_v2 WHERE pedido_id=$1',[o.id]),0);
  });
  await t.test('valor/ref/taxa conflitantes são recusados sem dupla atribuição financeira',async()=>{
   const a=await order(db,{provider:'mercadopago'}),b=await order(db,{provider:'mercadopago'});
   assert.equal((await rpc(db,'catalogo_aplicar_pagamento_v2',[a.id,'approved',a.total-1,a.feeTotal,'mp:'+a.id])).http_status,409);
   assert.equal((await pay(db,a,'approved',a.feeTotal-1)).http_status,409);
   assert.equal((await pay(db,a)).ok,true);
   assert.equal((await pay(db,a,'approved',a.feeTotal,'other:'+a.id)).http_status,409);
   assert.equal((await pay(db,b,'approved',b.feeTotal,'mp:'+a.id)).http_status,409);
   assert.equal((await row(db,b.id)).status_pagamento,'pendente');
  });
  await t.test('cancelamento pós-aceite NULL motoboy é idempotente e não apaga comissão 5%',async()=>{
   const o=await order(db);await operate(db,o,'aceitar');
   for(let i=0;i<3;i++)assert.equal((await operate(db,o,'solicitar_cancelamento')).ok,true);
   assert.equal(await count('SELECT count(*)::int n FROM catalogo_ocorrencias_v2 WHERE pedido_id=$1',[o.id]),1);
   assert.equal((await feeRow(o)).taxa_plataforma_centavos,50);assert.equal((await feeRow(o)).valor_comissao_centavos,o.feeTotal);
  });
  await t.test('desistência pré-coleta reoferta; pós-coleta mantém atribuição/fase/comissão, não culpa automaticamente',async()=>{
   const o=await order(db);await ready(db,o);await act(db,IDS.rider,'aceitar_entrega',o.id);
   assert.equal((await act(db,IDS.rider,'desistir',o.id)).reofertado,true);
   assert.equal(await row(db,o.id,'catalogo_entregas_atribuidas'),undefined);
   await act(db,IDS.rider,'aceitar_entrega',o.id);await act(db,IDS.rider,'coletar',o.id);
   assert.equal((await act(db,IDS.rider,'desistir',o.id)).reofertado,false);
   assert.equal((await row(db,o.id)).entrega_status,'coletado');assert.equal((await row(db,o.id,'catalogo_entregas_atribuidas')).motoboy_id,IDS.rider);
   assert.equal((await feeRow(o)).taxa_plataforma_centavos,50);assert.equal((await feeRow(o)).valor_comissao_centavos,o.feeTotal);
   assert.equal((await operate(db,o,'solicitar_cancelamento')).ok,true);
   assert.equal((await row(db,o.id)).entrega_status,'coletado');
   const e=await rpc(db,'catalogo_motoboy_extrato_v2',[IDS.rider,0]);assert.equal(e.confiabilidade.ocorrencias,0);assert.equal(e.confiabilidade.indice,null);
  });
  await t.test('owner não cria bônus v2; errado/válido/repetido, financeiro offline não vira recebimento plataforma',async()=>{
   const o=await order(db);await collect(db,o);
   assert.equal((await rpc(db,'catalogo_confirmar_entrega_autenticada',[IDS.owner,o.commerce,o.id,HASH,null])).http_status,403);
   assert.equal((await confirm(db,o,IDS.rider2)).http_status,403);
   assert.equal((await confirm(db,o,IDS.rider,BAD_HASH)).http_status,403);assert.equal((await row(db,o.id)).codigo_entrega_tentativas,1);
   assert.equal((await confirm(db,o)).ok,true);assert.equal((await confirm(db,o)).http_status,409);
   assert.equal((await remuneration(o)).status,'retido');assert.equal((await remuneration(o)).valor_centavos,20);
   assert.equal((await row(db,o.id)).status_pagamento,'aprovado');
   assert.ok((await row(db,o.id)).pago_em);
   assert.equal((await remuneration(o)).financiamento_comprovado,false);
   assert.equal((await pay(db,o)).http_status,409);
   assert.equal((await db.query("SELECT status FROM catalogo_lancamentos_financeiros_v2 WHERE pedido_id=$1 AND tipo='comissao_plataforma'",[o.id])).rows[0].status,'retido');
   const before=await count('SELECT count(*)::int n FROM catalogo_ocorrencias_v2 WHERE pedido_id=$1',[o.id]);
   assert.equal((await operate(db,o,'solicitar_cancelamento')).http_status,409);assert.equal((await act(db,IDS.rider,'desistir',o.id)).http_status,409);
   assert.equal(await count('SELECT count(*)::int n FROM catalogo_ocorrencias_v2 WHERE pedido_id=$1',[o.id]),before);
  });
  await t.test('código exige coleta, expiração e limite cinco; falha SQL reverte consumo/baixa',async()=>{
   const o=await order(db);await ready(db,o);await act(db,IDS.rider,'aceitar_entrega',o.id);
   assert.equal((await confirm(db,o)).http_status,409);await act(db,IDS.rider,'coletar',o.id);
   for(let i=0;i<5;i++)assert.equal((await confirm(db,o,IDS.rider,BAD_HASH)).http_status,403);
   assert.equal((await confirm(db,o)).http_status,429);
   const exp=await order(db);await collect(db,exp);await db.query("UPDATE catalogo_pedidos SET codigo_entrega_expira_em=now()-interval '1 second' WHERE id=$1",[exp.id]);assert.equal((await confirm(db,exp)).http_status,410);
   const fault=await order(db);await collect(db,fault);
   await db.exec(`CREATE FUNCTION teste_v2_falha() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'falha fixture'; END;$$;
    CREATE TRIGGER teste_v2_falha BEFORE INSERT ON catalogo_remuneracoes_v2 FOR EACH ROW EXECUTE FUNCTION teste_v2_falha();`);
   await assert.rejects(confirm(db,fault),/falha fixture/);assert.equal((await row(db,fault.id)).codigo_entrega_tentativas,0);assert.equal((await row(db,fault.id)).entrega_status,'em_entrega');
   await db.exec('DROP TRIGGER teste_v2_falha ON catalogo_remuneracoes_v2; DROP FUNCTION teste_v2_falha();');
  });
  await t.test('v2 retirada/consumo owner exige código e aceite: 5% nasce antes, bônus nunca',async()=>{
   for(const mode of ['retirada','consumo_local']){
    const o=await order(db,{mode});
    const fn=hash=>rpc(db,'catalogo_confirmar_entrega_autenticada',[IDS.owner,o.commerce,o.id,hash,null]);
    assert.equal((await fn(HASH)).http_status,409);await operate(db,o,'aceitar');
    assert.equal((await feeRow(o)).taxa_plataforma_centavos,50);assert.equal((await feeRow(o)).valor_comissao_centavos,o.feeTotal);assert.equal((await fn(BAD_HASH)).http_status,403);
    assert.equal((await fn(HASH)).ok,true);assert.equal((await fn(HASH)).http_status,409);assert.equal(await remuneration(o),undefined);
   }
  });
  await t.test('Pix código depois do pagamento comprovado libera 2, com 5% já no aceite',async()=>{
   const o=await order(db,{provider:'mercadopago'});await collect(db,o);
   assert.equal((await confirm(db,o)).remuneracao_status,'disponivel');
   assert.equal((await remuneration(o)).financiamento_comprovado,true);
   assert.equal(await count("SELECT count(*)::int n FROM catalogo_lancamentos_financeiros_v2 WHERE pedido_id=$1 AND tipo IN ('comissao_plataforma','remuneracao_motoboy')",[o.id]),2);
   assert.equal((await db.query("SELECT sum(valor_centavos)::int total FROM catalogo_lancamentos_financeiros_v2 WHERE pedido_id=$1 AND status<>'convertido'",[o.id])).rows[0].total,70);
  });
  await t.test('Pix taxa NULL retém; código antes da taxa conhecida/retry não retrocede físico ou reatribui dinheiro',async()=>{
   const o=await order(db,{provider:'mercadopago'});
   assert.equal((await pay(db,o,'approved',null)).financiamento_comprovado,false);
   await operate(db,o,'aceitar');await operate(db,o,'pronto');await act(db,IDS.rider,'aceitar_entrega',o.id);await act(db,IDS.rider,'coletar',o.id);
   assert.equal((await confirm(db,o)).remuneracao_status,'retido');
   const enrich=await pay(db,o);assert.equal(enrich.taxa_enriquecida,true);
   assert.equal((await row(db,o.id)).entrega_status,'entregue');assert.equal((await row(db,o.id)).status,'entregue');
   assert.equal((await remuneration(o)).status,'disponivel');assert.equal((await pay(db,o)).idempotente,true);
   assert.equal((await pay(db,o,'approved',null)).idempotente,true);assert.equal((await pay(db,o,'approved',69)).http_status,409);
   assert.equal((await remuneration(o)).motoboy_id,IDS.rider);assert.equal(await count('SELECT count(*)::int n FROM catalogo_remuneracoes_v2 WHERE pedido_id=$1',[o.id]),1);
  });
  await t.test('fatura 7 (5+2) uma vez, paga antes/depois do código; status administrativo sozinho nunca financia',async()=>{
   const o=await order(db);await collect(db,o);await competence(o,'2030-01-01');await confirm(db,o);
   const f=await invoice(db,o.commerce,'2030-01-01',false);assert.equal(f.total_comissao_centavos,70);
   await db.query("UPDATE catalogo_fechamentos_offline SET status='pago',referencia_pagamento='alegacao' WHERE id=$1",[f.id]);
   await db.query("UPDATE catalogo_comissoes_offline SET status='paga' WHERE pedido_id=$1",[o.id]);
   assert.equal((await remuneration(o)).status,'retido');assert.equal((await feeRow(o)).financiamento_logistica_comprovado,false);
   assert.equal((await rpc(db,'catalogo_confirmar_cobranca_fatura',[f.reference,'pago','pay-fixture',70,'Recebido fixture'])).ok,true);
   assert.equal((await remuneration(o)).status,'disponivel');assert.equal((await feeRow(o)).status,'paga');
   await db.query('SELECT catalogo_gerar_fechamento_offline($1,$2::date)',[o.commerce,'2030-01-01']);
   assert.equal((await db.query('SELECT total_comissao_centavos n FROM catalogo_fechamentos_offline WHERE id=$1',[f.id])).rows[0].n,70);
   assert.equal(await count('SELECT count(*)::int n FROM catalogo_logistica_offline_v2 WHERE pedido_id=$1',[o.id]),1);
  });
  await t.test('fatura 7: reconciliação de valor 5/divergente nunca financia 2; somente valor exato',async()=>{
   const o=await order(db);await collect(db,o);await competence(o,'2030-07-01');await confirm(db,o);
   const f=await invoice(db,o.commerce,'2030-07-01',false);
   assert.equal((await rpc(db,'catalogo_confirmar_cobranca_fatura',[f.reference,'pago','pay-wrong',50,'Valor errado fixture'])).ok,false);
   assert.equal((await remuneration(o)).status,'retido');assert.equal((await feeRow(o)).financiamento_logistica_comprovado,false);
   assert.equal((await rpc(db,'catalogo_confirmar_cobranca_fatura',[f.reference,'pago','pay-right',70,'Valor correto fixture'])).ok,true);
   assert.equal((await remuneration(o)).status,'disponivel');
  });
  await t.test('fatura 7 paga antes do código: reserva financiada não é bônus; código posterior libera 2 sem novo débito',async()=>{
   const o=await order(db);await collect(db,o);await competence(o,'2030-02-01');
   const seven=await invoice(db,o.commerce,'2030-02-01');assert.equal(seven.total_comissao_centavos,70);
   assert.equal(await remuneration(o),undefined);assert.equal((await feeRow(o)).financiamento_logistica_comprovado,true);
   assert.equal((await confirm(db,o)).remuneracao_status,'disponivel');
   assert.equal((await remuneration(o)).financiamento_comprovado,true);
   assert.equal((await feeRow(o)).valor_comissao_centavos,70);
   assert.equal((await db.query('SELECT total_comissao_centavos n FROM catalogo_fechamentos_offline WHERE id=$1',[seven.id])).rows[0].n,70);
   assert.equal((await db.query("SELECT status FROM catalogo_lancamentos_financeiros_v2 WHERE pedido_id=$1 AND tipo='reserva_logistica'",[o.id])).rows[0].status,'convertido');
  });
  await t.test('fatura 5 histórica/inconsistente paga antes do código NÃO financia 2 e nunca reescreve total histórico',async()=>{
   const o=await order(db);await collect(db,o);await competence(o,'2030-04-01');
   const fid=(await db.query('SELECT catalogo_gerar_fechamento_offline($1,$2::date) id',[o.commerce,'2030-04-01'])).rows[0].id;
   // Representa fechamento antigo/inconsistente de 5%: não fingir que o adicional foi recebido.
   await db.query("DELETE FROM catalogo_fatura_componentes_v2 WHERE fechamento_id=$1 AND tipo='logistica'",[fid]);
   await db.query('UPDATE catalogo_fechamentos_offline SET total_comissao_centavos=50 WHERE id=$1',[fid]);
   const ref='historico5:'+fid;
   assert.equal((await rpc(db,'catalogo_registrar_cobranca_fatura',[fid,ref,50,null,null,null,null,'Histórico fixture'])).ok,true);
   assert.equal((await rpc(db,'catalogo_confirmar_cobranca_fatura',[ref,'pago','pay5',50,'Fixture'])).ok,true);
   assert.equal((await confirm(db,o)).remuneracao_status,'retido');assert.equal((await remuneration(o)).financiamento_comprovado,false);
   await db.query('SELECT catalogo_gerar_fechamento_offline($1,$2::date)',[o.commerce,'2030-04-01']);
   assert.equal((await db.query('SELECT total_comissao_centavos n FROM catalogo_fechamentos_offline WHERE id=$1',[fid])).rows[0].n,50);
  });
  await t.test('fatura 7 emitida antes do código é selada, código não duplica débito e cobrança pendente retém bônus',async()=>{
   const o=await order(db);await collect(db,o);await competence(o,'2030-05-01');const seven=await invoice(db,o.commerce,'2030-05-01',false);
   assert.equal(seven.total_comissao_centavos,70);await confirm(db,o);assert.equal((await remuneration(o)).status,'retido');
   assert.equal((await rpc(db,'catalogo_confirmar_cobranca_fatura',[seven.reference,'pago','pay7',70,'Fixture'])).ok,true);
   assert.equal((await remuneration(o)).status,'disponivel');assert.equal((await feeRow(o)).valor_comissao_centavos,70);
  });
  await t.test('fatura mensal mista: v1 5 + v2 retirada 5 + v2 entrega 7 = 17, uma vez por pedido/parcela',async()=>{
   const legacy=await order(db,{version:1,status:'pronto'});await operate(db,legacy,'atribuir',IDS.owner,IDS.rider);await confirm(db,legacy);
   const pickup=await order(db,{mode:'retirada'});await operate(db,pickup,'aceitar');
   const delivery=await order(db);await collect(db,delivery);
   for(const o of [legacy,pickup,delivery])await competence(o,'2030-08-01');
   const f=await invoice(db,'loja-a','2030-08-01');assert.equal(f.total_comissao_centavos,170);assert.equal(f.total_pedidos,3);
   assert.equal(await count('SELECT count(*)::int n FROM catalogo_fatura_componentes_v2 WHERE fechamento_id=$1',[f.id]),4);
   assert.equal((await confirm(db,delivery)).remuneracao_status,'disponivel');
   assert.equal(await remuneration(legacy),undefined);assert.equal(await remuneration(pickup),undefined);
   assert.equal((await db.query('SELECT catalogo_gerar_fechamento_offline($1,$2::date) id',['loja-a','2030-08-01'])).rows[0].id,f.id);
   assert.equal((await db.query('SELECT total_comissao_centavos n FROM catalogo_fechamentos_offline WHERE id=$1',[f.id])).rows[0].n,170);
  });
  await t.test('refund/chargeback após approved estorna créditos uma vez; não rebobina entregue nem reaprova',async()=>{
   for(const status of ['refunded','charged_back']){
    const o=await order(db,{provider:'mercadopago'});await collect(db,o);await confirm(db,o);
    assert.equal((await pay(db,o,status)).ok,true);assert.equal((await pay(db,o,status)).idempotente,true);
    assert.equal((await remuneration(o)).status,'estornado');assert.equal((await row(db,o.id)).entrega_status,'entregue');
    assert.equal((await pay(db,o)).http_status,409);assert.equal(await count('SELECT count(*)::int n FROM catalogo_pagamentos_v2 WHERE pedido_id=$1',[o.id]),1);
    assert.equal(await count("SELECT count(*)::int n FROM catalogo_lancamentos_financeiros_v2 WHERE pedido_id=$1 AND status='disponivel'",[o.id]),0);
   }
  });
  await t.test('reembolso parcial congela para revisão, não estorna total nem acusa motoboy',async()=>{
   const o=await order(db,{provider:'mercadopago'});await collect(db,o);await confirm(db,o);
   const before=(await rpc(db,'catalogo_motoboy_extrato_v2',[IDS.rider,0])).confiabilidade.ocorrencias;
   assert.equal((await pay(db,o,'revisao_parcial')).revisao_parcial,true);assert.equal((await pay(db,o,'revisao_parcial')).idempotente,true);
   assert.equal((await remuneration(o)).status,'pendencia_revisao');assert.equal((await row(db,o.id)).entrega_status,'entregue');
   assert.equal((await row(db,o.id)).status_pagamento,'contestado');assert.equal((await pay(db,o)).http_status,409);
   assert.equal(await count("SELECT count(*)::int n FROM catalogo_lancamentos_financeiros_v2 WHERE pedido_id=$1 AND status='estornado'",[o.id]),0);
   assert.equal(await count("SELECT count(*)::int n FROM catalogo_ocorrencias_v2 WHERE pedido_id=$1 AND origem='sistema' AND NOT comprovada",[o.id]),1);
   assert.equal((await rpc(db,'catalogo_motoboy_extrato_v2',[IDS.rider,0])).confiabilidade.ocorrencias,before);
   assert.equal(await count('SELECT count(*)::int n FROM catalogo_pagamento_eventos_v2 WHERE pedido_id=$1',[o.id]),2);
  });
  await t.test('root admin único, repasse auditado manual, duplicação/retry e refund pós-repasse só pendência',async()=>{
   const o=await order(db,{provider:'mercadopago'});await collect(db,o);await confirm(db,o);
   for(const who of [IDS.owner,IDS.outsider,IDS.rider,null])assert.equal((await admin(db,'listar_operacao',{actor:who})).http_status,403);
   const listing=await admin(db,'listar_operacao');const credit=listing.operacao.remuneracoes.find(r=>r.pedido_id===o.id);
   assert.equal(credit.beneficiario_id,IDS.rider);assert.equal(credit.financiamento_comprovado,true);assert.ok(Object.hasOwn(credit,'pix_ciphertext'));assert.ok(Object.hasOwn(credit,'chave_pix_enc'));
   const options={rider:IDS.rider,orders:[o.id],ref:'transfer:'+o.id,proof:'Documento fixture (não transferência real)'};
   assert.equal((await admin(db,'registrar_repasse',{...options,proof:null})).http_status,400);
   assert.equal((await admin(db,'registrar_repasse',{...options,orders:[o.id,o.id]})).http_status,400);
   const first=await admin(db,'registrar_repasse',options);assert.equal(first.ok,true);assert.equal(first.valor_centavos,20);assert.equal(first.transferencia_executada,false);
   assert.equal((await admin(db,'registrar_repasse',options)).idempotente,true);
   assert.equal((await admin(db,'registrar_repasse',{...options,ref:'second:'+o.id})).http_status,409);
   assert.equal((await remuneration(o)).status,'pago');assert.equal((await pay(db,o,'refunded')).ok,true);assert.equal((await pay(db,o,'refunded')).idempotente,true);
   assert.equal((await remuneration(o)).status,'pendencia_revisao');assert.equal((await remuneration(o)).repasse_id,first.repasse_id);
   const paidActual=await count('SELECT coalesce(sum(valor_centavos),0)::int n FROM catalogo_repasses_v2 WHERE motoboy_id=$1',[IDS.rider]);
   assert.equal((await rpc(db,'catalogo_motoboy_extrato_v2',[IDS.rider,0])).saldo.pago_centavos,paidActual);
   assert.equal(await count("SELECT count(*)::int n FROM catalogo_lancamentos_financeiros_v2 WHERE pedido_id=$1 AND tipo='pendencia_revisao'",[o.id]),1);
   assert.equal(await count('SELECT count(*)::int n FROM catalogo_repasses_v2 WHERE id=$1',[first.repasse_id]),1);
  });
  await t.test('dois repasses de mesma lista serializados: só primeiro insere; lock order determinístico em lote',async()=>{
   const a=await order(db,{provider:'mercadopago'}),b=await order(db,{provider:'mercadopago'});for(const o of [a,b]){await collect(db,o);await confirm(db,o);}
   const opts={rider:IDS.rider,orders:[b.id,a.id],proof:'Prova fixture'};
   const [one,two]=await Promise.all([admin(db,'registrar_repasse',{...opts,ref:'batch:'+a.id}),admin(db,'registrar_repasse',{...opts,orders:[a.id,b.id],ref:'batch2:'+a.id})]);
   assert.equal(one.ok,true);assert.equal(one.valor_centavos,40);assert.equal(two.http_status,409);
   assert.equal((await remuneration(a)).repasse_id,(await remuneration(b)).repasse_id);
   const def=(await db.query("SELECT pg_get_functiondef('public.catalogo_operacao_admin_v2(uuid,text,uuid,text,text,uuid,uuid[],text,text)'::regprocedure) def")).rows[0].def;
   assert.match(def,/ORDER BY p.id FOR UPDATE/);assert.match(def,/ORDER BY r.pedido_id FOR UPDATE/);assert.match(def,/v_updated<>v_expected/);
   // Promise.all usa uma conexão PGlite: prova primeiro vence/retry, NÃO concorrência multissessão real.
  });
  await t.test('fatura refund retém financiamento e após repasse abre pendência, sem dinheiro fake',async()=>{
   const o=await order(db);await collect(db,o);await competence(o,'2030-06-01');await confirm(db,o);const f=await invoice(db,o.commerce,'2030-06-01');
   assert.equal((await remuneration(o)).status,'disponivel');const rep=await admin(db,'registrar_repasse',{rider:IDS.rider,orders:[o.id],ref:'offline:'+o.id,proof:'Prova fixture'});assert.equal(rep.ok,true);
   assert.equal((await rpc(db,'catalogo_confirmar_cobranca_fatura',[f.reference,'estornado','payment-fixture',70,'Refund fixture'])).ok,true);
   assert.equal((await remuneration(o)).status,'pendencia_revisao');assert.equal((await feeRow(o)).financiamento_logistica_comprovado,false);
   const displayed=(await admin(db,'listar_operacao')).operacao.remuneracoes.find(r=>r.pedido_id===o.id);
   assert.equal(displayed.status,'pendencia_revisao');assert.equal(displayed.financiamento_comprovado,false);assert.equal(displayed.repasse_id,rep.repasse_id);
   assert.equal((await admin(db,'registrar_repasse',{rider:IDS.rider,orders:[o.id],ref:'again:'+o.id,proof:'Prova fixture'})).http_status,409);
  });
  await t.test('confiabilidade: alegações/causas externas excluídas; tipos comprovados, DISTINCT pedido e revisão reversível',async()=>{
   const o=await order(db);await collect(db,o);
   await act(db,IDS.rider,'registrar_ocorrencia',o.id,null,'Alegação','endereco_incorreto');await act(db,IDS.rider,'registrar_ocorrencia',o.id,null,'Alegação','atraso');await act(db,IDS.rider,'desistir',o.id);
   const occ=(await db.query('SELECT id,categoria FROM catalogo_ocorrencias_v2 WHERE pedido_id=$1',[o.id])).rows;
   const before=(await rpc(db,'catalogo_motoboy_extrato_v2',[IDS.rider,0])).confiabilidade;
   for(const x of occ)assert.equal((await admin(db,'resolver_ocorrencia',{occ:x.id,decision:'ocorrencia_comprovada',reason:'Revisão fixture com evidência'})).ok,true);
   const after=(await rpc(db,'catalogo_motoboy_extrato_v2',[IDS.rider,0])).confiabilidade;
   assert.equal(after.amostra,before.amostra+1);assert.equal(after.ocorrencias,before.ocorrencias+1); // nunca +3
   for(const x of occ)await admin(db,'resolver_ocorrencia',{occ:x.id,decision:'cancelamento_legitimo',reason:'Evidência corrigida, revisão reversível'});
   assert.equal((await rpc(db,'catalogo_motoboy_extrato_v2',[IDS.rider,0])).confiabilidade.ocorrencias,before.ocorrencias);
   assert.equal((await db.query('SELECT em_analise,apto FROM catalogo_motoboy_perfis WHERE usuario_id=$1',[IDS.rider])).rows[0].em_analise,false);
   assert.equal((await rpc(db,'catalogo_reavaliar_confiabilidade_v2')).ativo,false);
  });
  await t.test('legados v1 offline preservam 5 e assigned/coleta opcionais; v1 Pix confirma sem bônus',async()=>{
   const offline=await order(db,{version:1,status:'pronto'});await operate(db,offline,'atribuir',IDS.owner,IDS.rider);
   assert.equal((await confirm(db,offline)).ok,true);assert.equal((await feeRow(offline)).valor_comissao_centavos,50);assert.equal(await remuneration(offline),undefined);
   const optional=await order(db,{version:1,status:'pronto'});await operate(db,optional,'atribuir',IDS.owner,IDS.rider);assert.equal((await act(db,IDS.rider,'coletar',optional.id)).ok,true);assert.equal((await confirm(db,optional)).ok,true);
   const pix=await order(db,{version:1,status:'pronto',paymentStatus:'aprovado',provider:'mercadopago'});await operate(db,pix,'atribuir',IDS.owner,IDS.rider);
   assert.equal((await confirm(db,pix)).ok,true);assert.equal((await row(db,pix.id)).status_pagamento,'aprovado');assert.equal(await remuneration(pix),undefined);assert.equal(await feeRow(pix),undefined);
  });
  await t.test('microvalores: nenhuma inserção de ledger zero, nenhum bônus fictício',async()=>{
   const o=await order(db,{subtotal:1});await collect(db,o);assert.equal((await confirm(db,o)).ok,true);
   assert.equal(await count('SELECT count(*)::int n FROM catalogo_lancamentos_financeiros_v2 WHERE pedido_id=$1',[o.id]),0);assert.equal(await remuneration(o),undefined);
  });
  await t.test('RLS/revogações: identidade admin forjada por authenticated não executa RPC; tabelas privadas fechadas',async()=>{
   await db.exec('SET ROLE authenticated');
   try {
    await assert.rejects(rpc(db,'catalogo_operacao_admin_v2',[IDS.admin,'listar_operacao',null,null,null,null,null,null,null]),/permission denied/);
    await assert.rejects(act(db,IDS.rider,'disponibilidade',null,true),/permission denied/);
    for(const table of ['catalogo_motoboy_perfis','catalogo_remuneracoes_v2','catalogo_lancamentos_financeiros_v2','catalogo_pagamentos_v2','catalogo_repasses_v2','catalogo_pagamento_eventos_v2','catalogo_logistica_offline_v2','catalogo_fatura_componentes_v2'])await assert.rejects(db.query(`SELECT * FROM ${table}`),/permission denied/);
   }finally{await db.exec('RESET ROLE');}
  });
  await t.test('paginação de lista/extrato não retorna NULL nem perde aggregate na segunda página',async()=>{
   const list=await rpc(db,'catalogo_listar_entregas_v2',[IDS.rider,10000]);assert.deepEqual(list.pedidos,[]);assert.equal(list.has_more,false);
   const ext=await rpc(db,'catalogo_motoboy_extrato_v2',[IDS.rider,10000]);assert.deepEqual(ext.entregas_concluidas,[]);assert.deepEqual(ext.pagamentos,[]);
  });
  await t.test('DDL reexecução efetivamente idempotente: dados e quantidade/checks não mudam',async()=>{
   const rowsBefore=await count('SELECT count(*)::int n FROM catalogo_pedidos');
   const constraints=async()=>(await db.query("SELECT conrelid::regclass::text tabela,conname,pg_get_constraintdef(oid) def FROM pg_constraint WHERE conrelid IN ('catalogo_pedidos'::regclass,'catalogo_comissoes_offline'::regclass,'catalogo_motoboy_perfis'::regclass,'catalogo_ocorrencias_v2'::regclass) ORDER BY 1,2")).rows;
   const before=await constraints();await db.exec(migration(V2));await db.exec(migration(V2));
   assert.equal(await count('SELECT count(*)::int n FROM catalogo_pedidos'),rowsBefore);assert.deepEqual(await constraints(),before);
  });
 } finally {await db.close();}
});
