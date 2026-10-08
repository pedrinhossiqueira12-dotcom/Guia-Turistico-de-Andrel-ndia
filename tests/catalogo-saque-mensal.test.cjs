const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const sql = read('supabase/migrations/20261008150000_solicitacao_saque_mensal_motoboy.sql');
const edge = read('supabase/functions/catalogo-entregas/index.ts');
const js = read('js/motoboy.js');
const html = read('pages/motoboy.html');

test('solicitacao de saque é limitada a JWT autenticado e mês encerrado', () => {
  assert.match(edge, /await rpc\("catalogo_motoboy_saque_mensal_v2"/);
  assert.match(edge, /p_operador_id: userId/);
  assert.match(edge, /await user\(request\)/);
  assert.match(sql, /catalogo_v2_autorizado\(p_operador_id\)/);
  assert.match(sql, /date_trunc\('month',pg_catalog\.now\(\)\) - interval '1 month'/);
});
test('servidor impede pedir saques sem lastro ou duplicar crédito', () => {
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /UNIQUE \(motoboy_id,mes_referencia\)/);
  assert.match(sql, /UNIQUE \(remuneracao_id\)/);
  assert.match(sql, /r\.status='disponivel' AND r\.financiamento_comprovado/);
  assert.match(sql, /r\.repasse_id IS NULL AND catalogo_private\.catalogo_v2_financiado/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /ALTER TABLE public\.catalogo_solicitacoes_saque_v2 ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.catalogo_motoboy_saque_mensal_v2/);
});
test('pedido não executa Pix; baixa exige repasse administrativo já comprovado', () => {
  assert.match(sql, /'transferencia_executada',false/);
  assert.match(sql, /NEW\.status='pago' AND NEW\.repasse_id IS NOT NULL/);
  assert.match(sql, /NOT EXISTS \(/);
  assert.match(js, /acao: "solicitar_saque"/);
  assert.match(html, /id="motoboySolicitarSaque"/);
  assert.match(html, /não envia Pix automaticamente/);
  assert.doesNotMatch(sql, /https?:\/\//i);
});
