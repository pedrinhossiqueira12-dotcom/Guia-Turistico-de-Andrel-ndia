const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
let PGlite;
try { ({ PGlite } = require(process.env.PGLITE_TEST_MODULE || '@electric-sql/pglite')); } catch { /* Dependência opcional para integração SQL. */ }
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BUYER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN = '4b9a0233-6b72-4573-aebd-d596c5b15e1b';
const HASH = createHash('sha256').update('123456').digest('hex');

test('integração SQL da confirmação autenticada (PGlite/PostgreSQL)', { skip: !PGlite }, async t => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public.catalogos(comercio_id text PRIMARY KEY, proprietario_id uuid, bloqueado boolean DEFAULT false);
      INSERT INTO public.catalogos VALUES ('loja-a','${OWNER}',false),('loja-b','${BUYER}',false);`);
    // Tabelas e constraints reais do projeto, sem reconstruir os cálculos nos testes.
    await db.exec(fs.readFileSync('supabase/migrations/20261004223000_catalogo_marketplace_pedidos.sql', 'utf8'));
    await db.exec(fs.readFileSync('supabase/migrations/20261005120000_catalogo_pagamentos_offline.sql', 'utf8'));
    await db.exec(fs.readFileSync('supabase/migrations/20261005123000_catalogo_pedidos_offline_auditoria.sql', 'utf8'));
    await db.exec(fs.readFileSync('supabase/migrations/20261006175809_confirmacao_entrega_painel.sql', 'utf8'));
    async function order(status = 'pronto', provider = 'offline') {
      const id = randomUUID();
      await db.query(`INSERT INTO public.catalogo_pedidos
        (id,comercio_id,referencia_externa,idempotency_key,provedor,status,modalidade,forma_pagamento,
         subtotal_produtos_centavos,entrega_centavos,total_centavos,taxa_plataforma_centavos,
         repasse_bruto_comercio_centavos,cliente_nome,cliente_telefone,codigo_entrega_hash,codigo_entrega_expira_em)
        VALUES ($1::uuid,'loja-a',$1::text,$2,$3,$4,'entrega','dinheiro',1000,300,1300,50,1250,'Cliente','32999999999',$5,now()+interval '1 day')`,
        [id, randomUUID(), provider, status, HASH]);
      return id;
    }
    async function confirm(id, actor = OWNER, commerce = 'loja-a', hash = HASH) {
      const result = await db.query('SELECT public.catalogo_confirmar_entrega_autenticada($1,$2,$3,$4,$5) AS r', [actor,commerce,id,hash,'Entregador']);
      return result.rows[0].r;
    }
    async function row(id) { return (await db.query('SELECT * FROM public.catalogo_pedidos WHERE id=$1', [id])).rows[0]; }
    await t.test('comprador e comércio incorreto não podem confirmar nem gastar tentativas', async () => {
      const id = await order();
      assert.equal((await confirm(id,BUYER)).http_status,403);
      assert.equal((await confirm(id,OWNER,'loja-b')).http_status,403);
      assert.equal((await confirm(id,ADMIN,'loja-b')).http_status,404);
      assert.equal((await row(id)).codigo_entrega_tentativas,0);
    });
    await t.test('hash ausente é rejeitado sem aceitar códigos nulos', async () => {
      const id = await order();
      assert.equal((await confirm(id,OWNER,'loja-a',null)).http_status,400);
      assert.equal((await row(id)).codigo_entrega_tentativas,0);
    });
    await t.test('código incorreto acumula tentativa mas não baixa nem registra comissão', async () => {
      const id = await order();
      assert.equal((await confirm(id,OWNER,'loja-a','0'.repeat(64))).http_status,403);
      assert.equal((await row(id)).status,'pronto');
      assert.equal((await row(id)).codigo_entrega_tentativas,1);
      assert.equal((await db.query('SELECT count(*)::integer AS n FROM catalogo_comissoes_offline WHERE pedido_id=$1',[id])).rows[0].n,0);
    });
    await t.test('cinco tentativas bloqueiam até um código correto subsequente', async () => {
      const id = await order();
      for (let i=0;i<5;i++) assert.equal((await confirm(id,OWNER,'loja-a','0'.repeat(64))).http_status,403);
      assert.equal((await confirm(id)).http_status,429);
      assert.equal((await row(id)).codigo_entrega_tentativas,5);
    });
    await t.test('expiração e cancelamento não aceitam código correto', async () => {
      const expired = await order();
      await db.query(`UPDATE catalogo_pedidos SET codigo_entrega_expira_em=now()-interval '1 second' WHERE id=$1`,[expired]);
      assert.equal((await confirm(expired)).http_status,410);
      assert.equal((await confirm(await order('cancelado'))).http_status,409);
    });
    await t.test('pedido Pix não pode ser baixado pelo fluxo presencial', async () => {
      assert.equal((await confirm(await order('pronto','mercadopago'))).http_status,404);
    });
    await t.test('sucesso em todas etapas ativas registra operador real e 5% somente dos produtos', async () => {
      for (const status of ['aguardando_pagamento','em_preparo','pronto']) {
        const id=await order(status);
        assert.equal((await confirm(id)).ok,true);
        const r=await row(id); assert.equal(r.status,'entregue'); assert.equal(r.status_pagamento,'aprovado');
        assert.equal(r.concluido_por,OWNER); assert.equal(r.metadata.operador_id,OWNER);
        const events=(await db.query("SELECT ator_id,ator_tipo FROM catalogo_pedido_eventos WHERE pedido_id=$1 AND para_status='entregue'",[id])).rows;
        assert.deepEqual(events,[{ator_id:OWNER,ator_tipo:'comercio'}]);
        const fee=(await db.query('SELECT * FROM catalogo_comissoes_offline WHERE pedido_id=$1',[id])).rows[0];
        assert.equal(fee.valor_comissao_centavos,50); // entrega de 300 centavos não aumenta comissão
        assert.equal((await confirm(id)).http_status,409);
        assert.equal((await db.query('SELECT count(*)::integer AS n FROM catalogo_comissoes_offline WHERE pedido_id=$1',[id])).rows[0].n,1);
      }
    });
    await t.test('erro ao gravar comissão desfaz também baixa e consumo do código', async () => {
      const id=await order();
      await db.exec(`CREATE FUNCTION teste_falha_comissao() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falha simulada'; END $$;
        CREATE TRIGGER teste_falha BEFORE INSERT ON catalogo_comissoes_offline FOR EACH ROW EXECUTE FUNCTION teste_falha_comissao();`);
      await assert.rejects(confirm(id),/falha simulada/);
      const r=await row(id); assert.equal(r.status,'pronto'); assert.equal(r.codigo_entrega_tentativas,0); assert.equal(r.codigo_entrega_usado_em,null);
      assert.equal((await db.query('SELECT count(*)::integer AS n FROM catalogo_pedido_eventos WHERE pedido_id=$1',[id])).rows[0].n,0);
      await db.exec('DROP TRIGGER teste_falha ON catalogo_comissoes_offline;');
    });
    await t.test('RPC antiga é revogada inclusive para service_role; novas não são públicas', async () => {
      const r=await db.query(`SELECT
        has_function_privilege('service_role','public.catalogo_confirmar_pedido_offline(text,text,text)','EXECUTE') AS old,
        has_function_privilege('anon','public.catalogo_confirmar_entrega_autenticada(uuid,text,uuid,text,text)','EXECUTE') AS anon,
        has_function_privilege('authenticated','public.catalogo_confirmar_entrega_autenticada(uuid,text,uuid,text,text)','EXECUTE') AS buyer,
        has_function_privilege('service_role','public.catalogo_confirmar_entrega_autenticada(uuid,text,uuid,text,text)','EXECUTE') AS backend`);
      assert.deepEqual(r.rows[0],{old:false,anon:false,buyer:false,backend:true});
    });
    await t.test('migração pode ser reexecutada sem apagar dados', async () => {
      const n=(await db.query('SELECT count(*)::integer AS n FROM catalogo_pedidos')).rows[0].n;
      await db.exec(fs.readFileSync('supabase/migrations/20261006175809_confirmacao_entrega_painel.sql','utf8'));
      assert.equal((await db.query('SELECT count(*)::integer AS n FROM catalogo_pedidos')).rows[0].n,n);
    });
  } finally { await db.close(); }
});

test('roteiro funcional de pagamentos também usa e valida a RPC autenticada', { skip: !PGlite }, async () => {
  const db = new PGlite();
  try {
    // gen_random_uuid é nativo; o roteiro não usa outras funções de pgcrypto.
    await db.exec(fs.readFileSync('scripts/validacao-pagamentos/00-bootstrap.sql','utf8').replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''));
    for (const name of [
      '20261005120000_catalogo_pagamentos_offline.sql',
      '20261005123000_catalogo_pedidos_offline_auditoria.sql',
      '20261005150000_catalogo_fechamento_automatico.sql',
      '20261005160000_catalogo_fatura_pix.sql',
      '20261005170000_catalogo_correcao_confirmacao_offline.sql',
      '20261006175809_confirmacao_entrega_painel.sql',
    ]) await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
    await db.exec(fs.readFileSync('scripts/validacao-pagamentos/10-setup.sql','utf8'));
    await db.exec(fs.readFileSync('scripts/validacao-pagamentos/30-funcional.sql','utf8').split('\n').filter(line=>!line.startsWith('\\')).join('\n'));
  } finally { await db.close(); }
});
