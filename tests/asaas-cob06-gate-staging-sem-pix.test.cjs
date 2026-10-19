// COB-06: impede que o gate QA sem Pix seja promovido como autorizacao financeira.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const raiz = join(__dirname, '..');
const caminho = 'supabase/staging-only/cob06_gate_tentativa_unica_sem_pix_20261019.sql';
const sql = readFileSync(join(raiz, caminho), 'utf8');
const workflow = readFileSync(join(raiz, '.github/workflows/database-tests.yml'), 'utf8');

test('gate operacional e distinto dos SQL13/17 e preso ao lote QA no STAGING', () => {
  assert.match(sql, /catalogo_asaas_reservar_tentativa_qa_sem_pix/);
  assert.match(sql, /catalogo_asaas_tentativas_qa_sem_pix/);
  assert.match(sql, /583d761a-ecb9-49be-b484-e43f6183971e/);
  assert.match(sql, /asaas-cob02/);
  assert.match(sql, /total_centavos=560/);
  assert.match(sql, /catalogo_cob06_ci/);
  assert.match(sql, /COB06_QA_ONLY: alvo STAGING ficticio nao comprovado/);
  assert.doesNotMatch(sql, /autorizar_post_mock_ci|autorizar_tentativa_emissao_ci/);
  assert.ok(!readdirSync(join(raiz, 'supabase/pending-migrations'))
    .some((x) => x.includes('gate_tentativa_unica_sem_pix')));
});

test('todos os registros persistentes tem restricoes financeiras em falso', () => {
  for (const campo of ['pode_emitir_pix', 'post_executado', 'pode_quitar',
    'pode_liberar_motoboy']) {
    assert.match(sql, new RegExp(campo + String.raw` boolean NOT NULL DEFAULT false CHECK \(${campo}=false\)`));
    assert.match(sql, new RegExp(String.raw`'${campo}',false`));
  }
  assert.doesNotMatch(sql, /(?:fetch\s*\(|POST\s+\/|https:\/\/api-sandbox\.asaas|execute\s+.*transfer)/i);
  assert.match(sql, /BEFORE UPDATE OR DELETE/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
});

test('funcao invocavel apenas pelo servidor; CI exige clone e rollback', () => {
  assert.match(sql, /REVOKE ALL ON catalogo_private\.catalogo_asaas_tentativas_qa_sem_pix[\s\S]+?PUBLIC,anon,authenticated,service_role/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.catalogo_asaas_reservar_tentativa_qa_sem_pix\(uuid\)[\s\S]+?PUBLIC,anon,authenticated,service_role/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.catalogo_asaas_reservar_tentativa_qa_sem_pix\(uuid\)\s+TO service_role/);
  assert.match(workflow, /-f supabase\/staging-only\/cob06_gate_tentativa_unica_sem_pix_20261019\.sql/);
  const ensaio = readFileSync(join(raiz,
    'supabase/tests/isolated/asaas-cob06-acumulo-reserva-rollback.sql'), 'utf8');
  assert.match(ensaio, /COB06_GATE_STAGING_RESERVA_UNICA_SEM_PIX_ROLLBACK_OK/);
});
