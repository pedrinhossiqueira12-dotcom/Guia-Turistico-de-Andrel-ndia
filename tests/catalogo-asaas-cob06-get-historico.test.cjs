'use strict';

// Regressao do GET remoto ja executado em STAGING em 19/10/2026.
// Este teste nao consulta banco, nao usa credenciais e nao produz Pix.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const sql = readFileSync(join(__dirname, '..', 'supabase', 'staging-only',
  'cob06_evidencia_get_qa_sem_pix_pendente.sql'), 'utf8');
const edge = readFileSync(join(__dirname, '..', 'supabase', 'functions',
  'catalogo-asaas-cob06-auditoria', 'index.ts'), 'utf8');

test('COB06: STAGING recusa um novo claim para o lote ja consultado', () => {
  const body = sql.match(/CREATE FUNCTION public\.catalogo_asaas_iniciar_get_unico_qa_sem_pix\([\s\S]*?\$iniciar\$([\s\S]*?)\$iniciar\$;/)?.[1];
  assert.ok(body, 'RPC claim nao encontrada');
  assert.match(body, /IF pg_catalog\.current_database\(\)='postgres'\s+AND p_lote='583d761a-ecb9-49be-b484-e43f6183971e'::uuid/);
  assert.match(body, /'motivo','get_historico_sem_prova'/);
  assert.match(body, /'pode_consultar_asaas',false/);
  assert.match(body, /'hold_obrigatorio',true/);
  assert.ok(body.indexOf('get_historico_sem_prova') <
    body.indexOf('pg_advisory_xact_lock'), 'bloqueio historico deve preceder locks e INSERT');
});

test('COB06: instalacao nao fabrica evidencia retroativa da consulta anterior', () => {
  const ddl = sql.split('CREATE FUNCTION public.catalogo_asaas_iniciar_get_unico_qa_sem_pix(')[0];
  assert.doesNotMatch(ddl, /INSERT\s+INTO\s+catalogo_private\.catalogo_asaas_evidencias_get_qa_sem_pix/i);
  assert.doesNotMatch(ddl, /INSERT\s+INTO\s+catalogo_private\.catalogo_asaas_inicios_get_qa_sem_pix/i);
});

test('COB06: Edge isola uma unica requisicao Asaas por chamada', () => {
  assert.match(edge, /const buscarUmaVez: typeof fetch/);
  assert.match(edge, /consultasAsaas >= 1/);
  assert.match(edge, /COB06_HOLD_GET_ADICIONAL_PROIBIDO/);
  assert.match(edge, /ASAAS_TOKEN, buscarUmaVez/);
});
