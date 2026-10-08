// Registros remotos auditados via SUPABASE (SELECT read-only) em 2026-10-08.
// Cada SHA256 é do campo statements[1] efetivamente APLICADO em produção.
// Alterar um destes arquivos implica criar uma NOVA migration; não reescrever
// silenciosamente SQL histórico, mesmo com timestamps locais divergentes.
// Nenhum segredo, URL remota, credencial ou acesso de rede é necessário.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const applied = [
  {
    remoteVersion: '20261007233513',
    localFile: '20261007173000_corrigir_liberacao_motoboy_pos_entrega.sql',
    sha256: 'cafade91683b8d5ec82fffc084f7bef8468897f697431281a7957c5ac7c94562',
  },
  {
    remoteVersion: '20261007233535',
    localFile: '20261007190000_taxa_fixa_7_porcento.sql',
    sha256: '3e5c32977e4319a2b3d32d52f431b4b52333a684489f2487b72c8bb4c61e9e61',
  },
  {
    remoteVersion: '20261007233541',
    localFile: '20261007203000_finalizar_regras_financeiras_e_offline.sql',
    sha256: '6f2e11d2a9cbac0606264d2699e9d95a0c8df8bb7878502ad3a2f2d1709b7b80',
  },
];

for (const { remoteVersion, localFile, sha256 } of applied) {
  test(`migration imutável: ${localFile} corresponde ao SQL remoto ${remoteVersion}`, () => {
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations', localFile));
    const actual = createHash('sha256').update(sql).digest('hex');
    assert.equal(actual, sha256,
      'SQL já aplicado ao Supabase foi alterado. Criar uma nova migration e revisar o histórico.');
  });
}

test('arredondamento pendente é migration distinta, sem reaplicar SQL remoto', () => {
  const pending = path.join(ROOT, 'supabase/migrations/20261007213000_arredondamento_taxa_total_7.sql');
  const sql = fs.readFileSync(pending, 'utf8');
  assert.match(sql, /catalogo_pedidos_check1/);
  assert.match(sql, /round\(subtotal_produtos_centavos::numeric \* 0\.07\)/);
  const sha256 = createHash('sha256').update(sql).digest('hex');
  assert.ok(applied.every(entry => entry.sha256 !== sha256));
  // NÃO autoriza deploy: versão pendente 20261007213000 é anterior ao
  // último remoto 20261007233541, e exige plano explícito de reconciliação.
});
