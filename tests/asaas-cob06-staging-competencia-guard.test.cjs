// COB-06: contrato estatico da migracao QA STAGING, sem executar SQL remoto.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const original = ler('supabase/production-candidate/14_cob06_competencia_congelada_somente_ci.sql');
const staging = ler('supabase/staging-only/asaas_cob06_competencia_congelada_qa_staging_20261017.sql');
const rollback = ler('supabase/staging-only/asaas_cob06_competencia_congelada_qa_rollback_20261017.sql');

test('staging replica exatamente as tres funcoes/trigger homologados na CI, apenas com nomes e escopo QA', () => {
  const inicio = original.indexOf('CREATE OR REPLACE FUNCTION catalogo_private.catalogo_v2_registrar_plataforma(');
  const fim = original.lastIndexOf('COMMIT;');
  assert.ok(inicio >= 0 && fim > inicio);
  const esperado = original.slice(inicio, fim)
    .replaceAll('catalogo_cob06_realocar_entrega_congelada_ci', 'catalogo_cob06_realocar_entrega_congelada_staging')
    .replaceAll('COB06_CI_ONLY', 'COB06_STAGING_COMPETENCIA')
    .replace('DROP TRIGGER IF EXISTS catalogo_cob06_realocar_entrega_congelada_staging ON public.catalogo_pedidos;\n', '')
    .replace("WHEN (NEW.status='entregue'", "WHEN (NEW.comercio_id='asaas-cob02' AND NEW.status='entregue'")
    .trim();
  const comecoStage = staging.indexOf('CREATE OR REPLACE FUNCTION catalogo_private.catalogo_v2_registrar_plataforma(');
  const fimStage = staging.indexOf('-- Revalidar que DDL nao tocou no livro nem nas faturas ja pagas.');
  assert.ok(comecoStage >= 0 && fimStage > comecoStage);
  assert.equal(staging.slice(comecoStage, fimStage).trim(), esperado);
});

test('a instalacao exige projeto QA inalterado, versoes fixas e pagamento desligado', () => {
  for (const fragmento of [
    "current_database() IS DISTINCT FROM 'postgres'",
    "current_user IS DISTINCT FROM 'postgres'",
    "inet_server_port() IS DISTINCT FROM 5432",
    'b9b06faa4f79e81ae8aae5b13f13d18d',
    '09065a78d062ca1f9234b10ea9b78eae',
    "comercio_id='asaas-cob02' AND competencia='2027-02-01'",
    "status='faturada' AND valor_total_centavos=280",
    "comercio_id='asaas-cob02' AND competencia='2027-03-01'",
    "status='pago') <> 4",
    "WHERE tgname='catalogo_cob06_realocar_entrega_congelada_staging'",
    "WHEN (NEW.comercio_id='asaas-cob02'",
    'pg_try_advisory_xact_lock',
  ]) assert.ok(staging.includes(fragmento), `ausente: ${fragmento}`);
  assert.ok(!/\b(?:http_post|net\.http|asaas\.com|pode_emitir_pix\s*=\s*true|ASAAS_PAYOUTS_ENABLED)\b/i.test(staging));
  assert.ok(!/^COMMIT\s*;/m.test(staging)); // Supabase aplica como uma transacao.
});

test('rollback preserva definicoes anteriores e proibe reversao apos criar marco', () => {
  for (const fragmento of [
    "current_database()<>'postgres'",
    "comercio_id='asaas-cob02' AND competencia='2027-03-01'",
    'DROP TRIGGER catalogo_cob06_realocar_entrega_congelada_staging',
    'DROP FUNCTION catalogo_private.catalogo_cob06_realocar_entrega_congelada_staging',
    'CREATE OR REPLACE FUNCTION catalogo_private.catalogo_v2_registrar_plataforma',
    'CREATE OR REPLACE FUNCTION public.catalogo_gerar_fechamento_offline',
  ]) assert.ok(rollback.includes(fragmento), `ausente: ${fragmento}`);
});
