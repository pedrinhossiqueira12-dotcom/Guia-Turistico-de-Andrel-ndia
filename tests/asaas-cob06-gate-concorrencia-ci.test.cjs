const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
const fixture = read('supabase/tests/isolated/asaas-cob06-gate-concorrencia-fixture-ci.sql');
const script = read('scripts/validacao-pagamentos/asaas-cob06-gate-concorrencia-ci.sh');
const workflow = read('.github/workflows/database-tests.yml');

test('COB-06: fixture de concorrência só executa no clone PostgreSQL descartável', () => {
  assert.match(fixture, /current_database\(\) IS DISTINCT FROM 'catalogo_cob06_ci'/);
  assert.match(fixture, /inet_server_port\(\) IS DISTINCT FROM 5432/);
  assert.match(fixture, /current_user IS DISTINCT FROM 'postgres'/);
  assert.match(fixture, /v_ref->>'pode_emitir_pix' IS DISTINCT FROM 'false'/);
  assert.doesNotMatch(fixture, /\b(?:POST|DELETE|TRUNCATE)\s+\/?payments\b/i);
});

test('COB-06: duas conexões SQL serializadas verificam uma tentativa e replay bloqueado', () => {
  assert.match(script, /test "\$\{PGHOST:-\}" = "localhost"/);
  assert.match(script, /test -z "\$\{DATABASE_URL:-\}"/);
  assert.match(script, /primeiro_pid=\$!/);
  assert.match(script, /segundo_pid=\$!/);
  assert.match(script, /wait_event_type='Lock'/);
  assert.match(script, /catalogo_asaas_autorizar_post_mock_ci/);
  assert.match(script, /COB06_AUTORIZACAO_MOCK_RACE_POSITIVA_UNICA_SEM_POST_OK/);
  assert.match(script, /grep -Fx 'true\|true\|true'/);
  assert.match(script, /grep -Fx 'false\|false\|false'/);
  assert.match(script, /pode_repetir_post=false/);
  assert.match(script, /post_externo_comprovado=false/);
  assert.match(script, /legacy-cob06-ci' AND status='pago' AND valor_centavos=700/);
  assert.doesNotMatch(script, /curl|https?:\/\/|ASAAS_API_KEY/);
});

test('COB-06: CI roda concorrência depois dos rollbacks e backup, antes de destruir clone', () => {
  const inicio = workflow.indexOf('bash scripts/validacao-pagamentos/asaas-cob06-gate-concorrencia-ci.sh');
  const rollback = workflow.indexOf('-f supabase/tests/isolated/asaas-cob06-acumulo-reserva-rollback.sql');
  const restore = workflow.indexOf('dropdb --if-exists --force catalogo_cob06_restore_ci', rollback);
  const fim = workflow.indexOf('dropdb --if-exists --force catalogo_cob06_ci\n          trap - EXIT', inicio);
  assert.ok(rollback > 0 && restore > rollback && inicio > restore && fim > inicio);
});
