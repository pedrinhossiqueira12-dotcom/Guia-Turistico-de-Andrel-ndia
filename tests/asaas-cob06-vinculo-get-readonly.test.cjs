// COB-06 / PR #39: verificacao estrutural, sem acessar rede ou banco.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const raiz = join(__dirname, '..');
const sqlPath = 'supabase/staging-only/cob06_vinculo_readonly_tentativa_get_20261019.sql';
const sql = readFileSync(join(raiz, sqlPath), 'utf8');
const edge = readFileSync(join(raiz,
  'supabase/functions/catalogo-asaas-cob06-auditoria/index.ts'), 'utf8');
const workflow = readFileSync(join(raiz,
  '.github/workflows/database-tests.yml'), 'utf8');
const ensaio = readFileSync(join(raiz,
  'supabase/tests/isolated/asaas-cob06-acumulo-reserva-rollback.sql'), 'utf8');

test('vinculo GET QA e separado da reserva e nao integra migracoes produtivas', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.catalogo_asaas_conferir_vinculo_tentativa_qa_sem_pix/);
  assert.match(sql, /RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''/);
  assert.match(sql, /current_database\(\)='postgres'/);
  assert.match(sql, /COB06_VINCULO_QA_ONLY: recibo STAGING nao comprovado/);
  assert.match(sql, /583d761a-ecb9-49be-b484-e43f6183971e/);
  assert.doesNotMatch(sql, /https:\/\/api-sandbox\.asaas\.com/);
  assert.ok(!readdirSync(join(raiz, 'supabase/pending-migrations'))
    .some(x => x.includes('vinculo_readonly_tentativa_get')));
});

test('RPC read-only acessivel somente por service_role e com bloqueio de emissao', () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.catalogo_asaas_conferir_vinculo_tentativa_qa_sem_pix\(uuid\)[\s\S]+?PUBLIC,anon,authenticated,service_role/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.catalogo_asaas_conferir_vinculo_tentativa_qa_sem_pix\(uuid\)\s+TO service_role/);
  assert.match(sql, /v_t\.operacao_id IS DISTINCT FROM v_r\.operacao_id/);
  assert.match(sql, /v_t\.cliente_id IS DISTINCT FROM v_cliente/);
  assert.match(sql, /v_t\.valor_centavos IS DISTINCT FROM v_r\.valor_centavos/);
  assert.match(sql, /v_r\.payment_id IS NOT NULL/);
  assert.match(sql, /v_t\.post_executado IS DISTINCT FROM false/);
  assert.match(sql, /EXISTS\(SELECT 1 FROM public\.catalogo_asaas_acumulo_observacoes/);
  const funcao = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION'));
  assert.doesNotMatch(funcao, /\b(?:INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM|TRUNCATE)\b/i);
});

test('Edge bloqueia GET externo sem RPC de vinculo QA aprovada', () => {
  const checagem = edge.indexOf('catalogo_asaas_conferir_vinculo_tentativa_qa_sem_pix');
  const auditoria = edge.indexOf('auditarDuplicidadeAcumuloSomenteGet(\n');
  assert.ok(checagem > 0 && auditoria > checagem);
  assert.match(edge, /vinculo\.operacao_id !== ref\.operacao_id/);
  assert.match(edge, /vinculo\.post_executado !== false/);
  assert.match(edge, /reserva_qa_conferida: true/);
  assert.match(edge, /const PERSISTIR_GET_QA = Deno\.env\.get\("ASAAS_COB06_GET_PERSISTENCIA_QA_ENABLED"\) === "true"/);
  assert.match(edge, /if \(PERSISTIR_GET_QA && auditoria\.estado === "nenhuma_cobranca_localizada"\)/);
  assert.match(edge, /evidencia_get_persistida: evidenciaPersistida/);
  assert.match(edge, /ack\.pode_emitir_pix !== false/);
  assert.match(edge, /pix_emitido: false/);
  assert.doesNotMatch(edge, /catalogo_asaas_registrar_observacao_acumulo/);
  assert.doesNotMatch(edge, /catalogo-asaas-acumulo-post-sandbox-candidato/);
});

test('CI executa SQL sob rollback e recusa banco inesperado', () => {
  assert.match(workflow, /-f supabase\/staging-only\/cob06_vinculo_readonly_tentativa_get_20261019\.sql/);
  assert.match(workflow, /cob06-vinculo-outside-ci\.log/);
  assert.match(ensaio, /COB06_VINCULO_QA_SOMENTE_LEITURA_HOLD_OK/);
  assert.match(ensaio, /COB06_VINCULO: observacao bancaria nao bloqueou novo GET/);
});

test('claim GET atomico e irrepetivel precede toda consulta Asaas', () => {
  const getSql = readFileSync(join(raiz,
    'supabase/staging-only/cob06_evidencia_get_qa_sem_pix_pendente.sql'), 'utf8');
  assert.match(getSql, /CREATE TABLE catalogo_private\.catalogo_asaas_inicios_get_qa_sem_pix/);
  assert.match(getSql, /lote_id uuid PRIMARY KEY/);
  assert.match(getSql, /pg_advisory_xact_lock/);
  assert.match(getSql, /'motivo','get_ja_iniciado'/);
  assert.match(getSql, /pode_repetir_get boolean NOT NULL DEFAULT false CHECK\(pode_repetir_get=false\)/);
  assert.match(getSql, /CREATE TRIGGER catalogo_asaas_inicio_get_qa_imutavel/);
  assert.match(getSql, /'motivo','get_sem_marcacao_previa'/);
  assert.match(getSql, /GRANT EXECUTE ON FUNCTION public\.catalogo_asaas_iniciar_get_unico_qa_sem_pix\(uuid\)\s+TO service_role/);
  assert.doesNotMatch(getSql, /https:\/\/api-sandbox\.asaas\.com/);
  const claim = edge.indexOf('catalogo_asaas_iniciar_get_unico_qa_sem_pix');
  const remoto = edge.indexOf('auditarDuplicidadeAcumuloSomenteGet(\n');
  assert.ok(claim > 0 && claim < remoto, 'claim deve vir antes do GET');
  assert.match(edge, /!PERSISTIR_GET_QA \|\| !SANDBOX/);
  assert.match(ensaio, /COB06_GET_UNICO_TRANSACIONAL_ANTES_DA_REDE_CI_OK/);
  assert.match(workflow, /-f supabase\/staging-only\/cob06_evidencia_get_qa_sem_pix_pendente\.sql/);
  assert.ok(!readdirSync(join(raiz, 'supabase/pending-migrations'))
    .some(x => x.includes('inicios_get_qa')));
});
