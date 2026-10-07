const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const readText = (path) => fs.readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');

const fn = readText('supabase/functions/catalogo-fatura-pix/index.ts');
const utils = readText('supabase/functions/catalogo-fatura-pix/fatura-utils.mjs');
const sql = readText('supabase/migrations/20261005160000_catalogo_fatura_pix.sql');
const config = readText('supabase/config.toml');
const html = readText('pages/catalogo-admin.html');
const adminJs = readText('js/catalogo-admin.js');

test('cobrança da fatura fica desligada até a flag e as credenciais existirem', () => {
  assert.match(fn, /Deno\.env\.get\("FATURA_PIX_ENABLED"\) === "true"/);
  assert.match(fn, /MP_PLATFORM_ACCESS_TOKEN/);
  assert.match(fn, /MP_PLATFORM_SELLER_ID/);
  assert.match(fn, /MP_PLATFORM_WEBHOOK_SECRET/);
  assert.match(fn, /Nenhuma cobrança foi criada/);
  assert.match(sql, /fatura_pix_ativo boolean NOT NULL DEFAULT false/);
});

test('emissão valida recebedor, valor e referência antes de registrar', () => {
  assert.match(fn, /\/users\/me/);
  assert.match(fn, /não pertence à conta recebedora esperada/);
  assert.match(fn, /montarReferenciaFatura/);
  assert.match(utils, /external_reference/);
  assert.match(utils, /amount_mismatch/);
  assert.match(utils, /seller_mismatch/);
});

test('a order é criada com Pix e chave de idempotência, sem repetir cobrança pendente', () => {
  assert.match(fn, /X-Idempotency-Key/);
  assert.match(fn, /chaveIdempotenciaFatura/);
  assert.match(fn, /reutilizada: true/);
  assert.match(fn, /payment_method: \{ id: "pix", type: "bank_transfer" \}/);
  assert.match(fn, /payer: \{ email: payerEmail \}/);
  assert.match(fn, /criarCobranca\(userId, body, user\.email \|\| ""\)/);
  assert.doesNotMatch(fn, /payerEmail\s*=\s*body\./);
});

test('webhook da fatura exige HMAC e reconsulta a order no provedor', () => {
  assert.match(fn, /verifyWebhookSignature/);
  assert.match(fn, /x-signature/);
  assert.match(fn, /Webhook inválido/);
  assert.match(fn, /\/v1\/orders\//);
  assert.match(config, /\[functions\.catalogo-fatura-pix\]\s*\nverify_jwt = false/);
});

test('conciliação é transacional, idempotente e não ativa nada com valor divergente', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.catalogo_fatura_cobrancas/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.catalogo_fatura_eventos/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.catalogo_registrar_cobranca_fatura/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.catalogo_confirmar_cobranca_fatura/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /ja_confirmado/);
  assert.match(sql, /divergente/);
  assert.match(sql, /O valor pago não corresponde à fatura/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.catalogo_confirmar_cobranca_fatura\(text, text, text, integer, text\) FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.catalogo_confirmar_cobranca_fatura\(text, text, text, integer, text\) TO service_role/);
});

test('estorno e contestação revogam a quitação e restabelecem a dívida financeira', () => {
  assert.match(sql, /IF p_estado IN \('estornado', 'contestado'\)/);
  assert.match(sql, /SET status = 'vencido', pago_em = NULL, referencia_pagamento = NULL/);
  assert.match(sql, /SET bloqueado = true, motivo_bloqueio = v_motivo_financeiro/);
  assert.match(sql, /motivo_bloqueio = v_motivo_financeiro/);
  assert.match(sql, /UPDATE public\.catalogo_comissoes_offline\n       SET status = 'paga'/);
});

test('painel do comércio permite gerar e conferir o Pix da fatura', () => {
  assert.match(html, /id="gerarPixFatura"/);
  assert.match(html, /id="consultarPixFatura"/);
  assert.match(html, /id="faturaPixResultado"/);
  assert.match(adminJs, /invoke\("catalogo-fatura-pix"/);
  assert.match(adminJs, /acao: "criar_cobranca"/);
  assert.match(adminJs, /acao: "consultar_cobranca"/);
  assert.match(adminJs, /Pix copia e cola/);
  assert.doesNotMatch(adminJs, /MP_PLATFORM_ACCESS_TOKEN|service_role/i);
});

test('nenhum secret é escrito no frontend ou no manifesto', () => {
  for (const arquivo of [html, adminJs, utils]) {
    assert.doesNotMatch(arquivo, /APP_USR-|Bearer ey|SUPABASE_SERVICE_ROLE_KEY\s*[:=]/);
  }
});
