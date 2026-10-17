const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');
const BASE = 'https://xdmbkflufsfqziixzpxc.supabase.co';
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const URL_IMAGE = `${BASE}/storage/v1/object/public/cadastros/${OWNER}/foto-banner.jpg`;

function backend(options = {}) {
  let handler;
  const updates = [];
  const config = { comercio_id: 'loja-teste', proprietario_id: options.catalogOwner || OWNER, bloqueado: false, banner_url: options.banner || null };
  const db = {
    auth: { getUser: async token => ({ data: { user: token === 'owner' ? { id: OWNER } : token === 'other' ? { id: OTHER } : null }, error: null }) },
    storage: { from: () => ({ list: async () => ({ data: options.missing ? [] : [{ name: 'foto-banner.jpg', metadata: { mimetype: options.mime || 'image/jpeg', size: options.size ?? 5000 } }], error: options.storageError ? { message: 'indisponível' } : null }) }) },
    from(table) {
      const state = { filters: {}, payload: null };
      const q = { select() { return q; }, eq(key, value) { state.filters[key] = value; return q; }, limit() { return q; }, update(payload) { state.payload = payload; return q; }, insert() { return q; },
        async maybeSingle() {
          if (table === 'comercios_publicados') return { data: { local_id: 'loja-teste', status: 'ativo' }, error: null };
          if (table === 'catalogos') {
            if (state.payload) { updates.push(state.payload); Object.assign(config, state.payload); }
            return { data: config, error: null };
          }
          return { data: null, error: null };
        },
        then(resolve, reject) {
          const data = table === 'catalogo_aceites_operacionais'
            ? (options.accepted === false ? [] : [{documento:'termos'},{documento:'privacidade'}])
            : table === 'cadastros_comercios'
              ? (options.registrationOwner === false || state.filters.usuario_id !== OWNER ? [] : [{ id: 'cadastro', usuario_id: OWNER, nome: 'Loja teste', local_id: 'loja-teste', status: 'aprovado' }])
              : null;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        }
      };
      return q;
    }
  };
  let source = fs.readFileSync('supabase/functions/catalogo-admin/index.ts', 'utf8').replace(/^import[^\n]+\n/, '');
  source = stripTypeScriptTypes(source, { mode: 'transform' });
  vm.runInNewContext(source, { createClient: () => db, Deno: { env: { get: key => ({ SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: 'service' })[key] }, serve: fn => { handler = fn; } }, Response, Request, URL, console });
  return { updates, async call(body, token = 'owner') {
    const response = await handler(new Request(`${BASE}/functions/v1/catalogo-admin`, { method: 'POST', headers: token ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' } : { 'content-type': 'application/json' }, body: JSON.stringify({ comercio_id: 'loja-teste', ...body }) }));
    return { status: response.status, body: await response.json() };
  } };
}

function editor(options = {}) {
  const elements = new Map();
  const element = id => { if (!elements.has(id)) elements.set(id, { hidden: false, disabled: false, dataset: {}, style: {}, value: '', removeAttribute(key) { delete this[key]; } }); return elements.get(id); };
  let fetchCalls = 0;
  const removals = [];
  let context;
  const source = fs.readFileSync('js/local.js', 'utf8');
  const block = source.slice(source.indexOf('function mostrarMensagemBannerCatalogo('), source.indexOf('function editarMeuComercio('));
  const user = { id: OWNER };
  const client = { auth: { getUser: async () => ({ data: { user }, error: null }), getSession: async () => ({ data: { session: { user, access_token: 'jwt' } }, error: null }) }, storage: { from: () => ({ upload: async () => options.upload ? options.upload() : ({ error: null }), remove: async paths => { removals.push(paths); return { error: null }; }, getPublicUrl: () => ({ data: { publicUrl: URL_IMAGE } }) }) } };
  class PreviewURL extends URL { static createObjectURL() { return 'blob:preview'; } static revokeObjectURL() {} }
  context = { SUPABASE_URL: BASE, SUPABASE_ANON_KEY: 'public', STORAGE_BUCKET: 'cadastros', CATALOGO_ADMIN_URL: `${BASE}/functions/v1/catalogo-admin`, localAtual: { id: 'loja-teste' }, bannerCatalogoAtual: null, bannerCatalogoArquivo: null, bannerCatalogoPreviewUrl: '', bannerCatalogoRemovido: false, bannerCatalogoOperacao: 0, bannerCatalogoConsultado: false, bannerCatalogoSalvando: false, obterSupabaseClient: () => client, URL: PreviewURL, document: { getElementById: element }, window: { alert() {} }, crypto: webcrypto, console, fetch: async () => { fetchCalls++; return options.fetch ? options.fetch() : { ok: true, json: async () => ({ success: true, banner_url: URL_IMAGE }) }; } };
  vm.runInNewContext(block, context);
  return { context, element, removals, calls: () => fetchCalls };
}

test('banner exige sessão e cadastro aprovado do proprietário', async () => {
  const app = backend();
  assert.equal((await app.call({ acao: 'salvar_banner', banner_url: URL_IMAGE }, '')).status, 401);
  assert.equal((await app.call({ acao: 'salvar_banner', banner_url: URL_IMAGE }, 'other')).status, 403);
  assert.equal(app.updates.length, 0);
});

test('catálogo associado a outra conta não pode ser editado', async () => {
  const app = backend({ catalogOwner: OTHER });
  assert.equal((await app.call({ acao: 'salvar_banner', banner_url: URL_IMAGE })).status, 403);
  assert.equal(app.updates.length, 0);
});

test('banner não pode ser salvo sem aceite vigente dos termos', async () => {
 const app=backend({accepted:false});
 const result=await app.call({acao:'salvar_banner',banner_url:URL_IMAGE});
 assert.equal(result.status,428);
 assert.equal(app.updates.length,0);
});

test('foto válida persiste somente banner, sem alterar acesso ou comissão', async () => {
  const app = backend();
  const result = await app.call({ acao: 'salvar_banner', banner_url: URL_IMAGE });
  assert.equal(result.status, 200);
  assert.equal(result.body.banner_url, URL_IMAGE);
  assert.deepEqual(JSON.parse(JSON.stringify(app.updates)), [{ banner_url: URL_IMAGE }]);
});

test('foto de outro usuário, fonte externa, SVG, query e traversal são rejeitados', async () => {
  for (const url of [URL_IMAGE.replace(OWNER, OTHER), 'https://malicioso.test/banner.jpg', URL_IMAGE.replace('.jpg', '.svg'), URL_IMAGE + '?download=1', URL_IMAGE.replace('foto-banner.jpg', '%2Ffoto.jpg'), 'javascript:alert(1)']) {
    const app = backend();
    assert.equal((await app.call({ acao: 'salvar_banner', banner_url: url })).status, 400, url);
    assert.equal(app.updates.length, 0);
  }
});

test('arquivo ausente, MIME incompatível ou maior que 4 MiB não é aceito', async () => {
  for (const option of [{ missing: true }, { mime: 'image/svg+xml' }, { size: 4 * 1024 * 1024 + 1 }, { size: 0 }]) {
    const app = backend(option);
    assert.equal((await app.call({ acao: 'salvar_banner', banner_url: URL_IMAGE })).status, 400);
    assert.equal(app.updates.length, 0);
  }
});

test('falha de Storage não salva uma URL sem validar o arquivo', async () => {
  const app = backend({ storageError: true });
  assert.equal((await app.call({ acao: 'salvar_banner', banner_url: URL_IMAGE })).status, 500);
  assert.equal(app.updates.length, 0);
});

test('remoção explícita funciona, mas payload sem banner_url não apaga a imagem', async () => {
  const app = backend({ banner: URL_IMAGE });
  assert.equal((await app.call({ acao: 'salvar_banner' })).status, 400);
  assert.equal((await app.call({ acao: 'salvar_banner', banner_url: null })).status, 200);
  assert.equal(app.updates.length, 1);
  assert.equal(app.updates[0].banner_url, null);
});

test('editor e hero aceitam a URL com pasta de usuário que o upload realmente gera', async () => {
  const ed = editor();
  assert.equal(ed.context.validarUrlBannerCatalogo(URL_IMAGE), URL_IMAGE);
  assert.equal(await ed.context.enviarBannerCatalogo({ type: 'image/jpeg', size: 5000 }, OWNER), URL_IMAGE);
  const source = fs.readFileSync('js/catalogo.js', 'utf8');
  const block = source.slice(source.indexOf('  function validarUrlBannerCatalogo('), source.indexOf('  function salvarCarrinho('));
  const elements = { storeHeroBannerLayer: { hidden: true }, storeHeroBannerImage: { removeAttribute(key) { delete this[key]; } } };
  const publicContext = { SUPABASE_URL: BASE, URL, $: id => elements[id] };
  vm.runInNewContext(block, publicContext);
  publicContext.renderizarHeroBanner(URL_IMAGE);
  assert.equal(elements.storeHeroBannerLayer.hidden, false);
  assert.equal(elements.storeHeroBannerImage.src, URL_IMAGE);
  elements.storeHeroBannerImage.onerror();
  assert.equal(elements.storeHeroBannerLayer.hidden, true);
});

test('consulta atrasada não sobrescreve foto selecionada nem ressuscita preview fechado', async () => {
  let resolveFetch;
  const ed = editor({ fetch: () => new Promise(resolve => { resolveFetch = resolve; }) });
  const loading = ed.context.carregarBannerCatalogo();
  await new Promise(resolve => setImmediate(resolve));
  ed.context.selecionarArquivoBannerCatalogo({ type: 'image/jpeg', size: 1000 });
  resolveFetch({ ok: true, json: async () => ({ success: true, banner_url: URL_IMAGE }) });
  await loading;
  assert.equal(ed.context.bannerCatalogoAtual, null);
  assert.equal(ed.element('imagemPreviewBannerCatalogo').src, 'blob:preview');
});

test('remover banner oculta preview e consulta malsucedida não provoca remoção acidental', async () => {
  const ed = editor();
  ed.context.bannerCatalogoAtual = URL_IMAGE;
  ed.context.renderizarPreviewBannerCatalogo();
  ed.context.removerBannerCatalogo();
  assert.equal(ed.element('previewBannerCatalogo').hidden, true);
  const untouched = editor();
  await untouched.context.salvarBannerCatalogo();
  assert.equal(untouched.calls(), 0);
});

test('migração preserva RLS, vitrine filtrada e permissões de edição', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA catalogo_private;
      CREATE TABLE public.catalogos(comercio_id text PRIMARY KEY,modalidades text[],metodos_pagamento text[]);
      ALTER TABLE public.catalogos ENABLE ROW LEVEL SECURITY;
      CREATE FUNCTION catalogo_private.catalogo_esta_ativo(p text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$SELECT p='ativo'$$;
      GRANT USAGE ON SCHEMA catalogo_private TO anon,authenticated;
      CREATE POLICY leitura ON public.catalogos FOR SELECT USING (catalogo_private.catalogo_esta_ativo(comercio_id));
      GRANT SELECT ON public.catalogos TO anon,authenticated;
      INSERT INTO public.catalogos VALUES ('ativo',ARRAY['entrega'],ARRAY['pix']),('inativo',ARRAY['retirada'],ARRAY['pix']);
      CREATE VIEW public.catalogo_publicado WITH(security_invoker=true) AS SELECT comercio_id,modalidades,metodos_pagamento FROM public.catalogos WHERE catalogo_private.catalogo_esta_ativo(comercio_id);`);
    await db.exec(fs.readFileSync('supabase/migrations/20261007040955_catalogo_banner_personalizavel.sql', 'utf8'));
    await db.exec('SET ROLE anon;');
    const { rows } = await db.query('SELECT comercio_id,banner_url FROM public.catalogo_publicado LIMIT 10;');
    assert.deepEqual(rows, [{ comercio_id: 'ativo', banner_url: null }]);
    await assert.rejects(db.exec("UPDATE public.catalogos SET banner_url='https://x.test/a.jpg' WHERE comercio_id='ativo';"), /permission denied/);
  } finally { await db.close(); }
});


test('upload abandonado antes do POST é descartado apenas com a sessão original', async () => {
  let finishUpload;
  const ed = editor({ upload: () => new Promise(resolve => { finishUpload = resolve; }) });
  ed.context.selecionarArquivoBannerCatalogo({ type: 'image/jpeg', size: 1000 });
  const saving = ed.context.salvarBannerCatalogo();
  await new Promise(resolve => setImmediate(resolve));
  ed.context.removerBannerCatalogo();
  finishUpload({ error: null });
  await saving;
  assert.equal(ed.calls(), 0);
  assert.equal(ed.removals.length, 1);
  assert.equal(ed.removals[0][0], OWNER + '/foto-banner.jpg');
});

test('erro de rede após o POST não remove uma foto possivelmente já persistida', async () => {
  const ed = editor({ fetch: () => { throw new Error('rede interrompida'); } });
  ed.context.selecionarArquivoBannerCatalogo({ type: 'image/jpeg', size: 1000 });
  await ed.context.salvarBannerCatalogo();
  assert.equal(ed.calls(), 1);
  assert.equal(ed.removals.length, 0);
});
