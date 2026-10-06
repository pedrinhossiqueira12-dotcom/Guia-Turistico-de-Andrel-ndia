const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const fn = fs.readFileSync('supabase/functions/catalogo-pedido-offline/index.ts', 'utf8');
const sql = fs.readFileSync('supabase/migrations/20261005130000_catalogo_offline_rate_limit.sql', 'utf8');

test('checkout offline exige catálogo publicado e ativo no servidor', () => {
  assert.match(fn, /from\("comercios_publicados"\)/);
  assert.match(fn, /\.eq\("status", "ativo"\)/);
  assert.match(fn, /if \(!published\)/);
});

test('checkout offline exige recebedor Mercado Pago ativo e catálogo publicado', () => {
  assert.match(fn, /catalogo_recebedores/);
  assert.match(fn, /\.eq\("status", "ativo"\)/);
  assert.match(fn, /Conecte a conta Mercado Pago/);
  assert.match(fn, /await assertOfflineCommerceAuthorized\(comercioId\)/);
});

test('preflight CORS aceita o cabeçalho Authorization do cliente Supabase', () => {
  assert.match(fn, /Access-Control-Allow-Headers.*apikey, authorization, content-type, x-client-info/);
});

test('checkout offline usa rate limit persistente por chave com hash', () => {
  assert.match(fn, /catalogo_offline_consumir_limite/);
  assert.match(fn, /cf-connecting-ip/);
  assert.match(fn, /x-forwarded-for/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.catalogo_offline_rate_limits/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /p_limite integer DEFAULT 10/);
});

test('limite responde 429 sem expor dados internos', () => {
  assert.match(fn, /Muitas tentativas/);
  assert.match(fn, /new HttpError\([^,]+, 429\)/);
  assert.doesNotMatch(fn, /console\.log\(.*cliente|console\.log\(.*codigo/);
});
