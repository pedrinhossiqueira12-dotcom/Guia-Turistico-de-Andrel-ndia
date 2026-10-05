const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const sql = fs.readFileSync('supabase/migrations/20261005133000_catalogo_marketplace_test_allowlist.sql', 'utf8');
test('allowlist de marketplace é restrita ao comércio de teste e reversível', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.catalogo_marketplace_testes/);
  assert.match(sql, /comercio-de-exemplo/);
  assert.match(sql, /ON CONFLICT \(comercio_id\) DO UPDATE/);
  assert.match(sql, /NOT c\.bloqueado/);
});
test('assinaturas ativas continuam aceitas e a exceção não libera outros comércios', () => {
  assert.match(sql, /ca\.status = 'ativa'/);
  assert.match(sql, /mt\.comercio_id = cp\.local_id AND mt\.ativo/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.catalogo_marketplace_testes FROM PUBLIC, anon, authenticated/);
});
