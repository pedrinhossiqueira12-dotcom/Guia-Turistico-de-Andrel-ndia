const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sql = fs.readFileSync('supabase/migrations/20261005150000_catalogo_fechamento_automatico.sql', 'utf8');

test('fechamento automático offline fica desligado por padrão', () => {
  assert.match(sql, /fechamento_offline_ativo boolean NOT NULL DEFAULT false/);
  assert.match(sql, /VALUES \(true, false\)/);
  assert.match(sql, /IF NOT EXISTS \([\s\S]*fechamento_offline_ativo = true/);
});

test('automação só fecha competências com comissão e chama bloqueio existente', () => {
  assert.match(sql, /catalogo_comissoes_offline/);
  assert.match(sql, /status IN \('aberta', 'faturada'\)/);
  assert.match(sql, /catalogo_gerar_fechamento_offline/);
  assert.match(sql, /catalogo_bloquear_inadimplentes_offline/);
});

test('agendamento não cria cobrança externa', () => {
  assert.match(sql, /andrelandia-fechamento-offline-diario/);
  assert.match(sql, /15 3 \* \* \*/);
  assert.doesNotMatch(sql, /mercadopago|http_post|catalogo-pix/i);
});

const ajustes = fs.readFileSync('supabase/migrations/20261005160000_catalogo_fatura_pix.sql', 'utf8');

test('fechamento registra a execução automática em auditoria', () => {
  assert.match(ajustes, /CREATE TABLE IF NOT EXISTS public\.catalogo_automacao_execucoes/);
  assert.match(ajustes, /fechamentos_gerados integer NOT NULL DEFAULT 0/);
  assert.match(ajustes, /bloqueios integer NOT NULL DEFAULT 0/);
  assert.match(ajustes, /erro text/);
  assert.match(ajustes, /REVOKE ALL ON TABLE public\.catalogo_automacao_execucoes FROM PUBLIC, anon, authenticated/);
  assert.match(ajustes, /GRANT ALL ON TABLE public\.catalogo_automacao_execucoes TO service_role/);
  assert.match(ajustes, /RETURNING id INTO v_execucao_id/);
  assert.match(ajustes, /origem, competencia, ativo, metadata/);
});

test('recálculo do fechamento não encolhe o total nem rebaixa estado terminal', () => {
  assert.match(ajustes, /status NOT IN \('cancelada', 'contestada'\)/);
  assert.match(ajustes, /IF v_status_atual = 'pago' THEN/);
  assert.match(ajustes, /WHEN public\.catalogo_fechamentos_offline\.status IN \('vencido', 'bloqueado'\)/);
  assert.match(ajustes, /v_competencia \+ interval '1 month' \+ interval '5 days'/);
});

test('agendamento é defensivo quando pg_cron não está habilitado', () => {
  for (const arquivo of [sql, ajustes]) {
    assert.match(arquivo, /EXCEPTION WHEN OTHERS THEN/);
    assert.match(arquivo, /RAISE NOTICE/);
  }
  assert.match(ajustes, /to_regclass\('cron\.job'\) IS NULL/);
  assert.match(ajustes, /catalogo_processar_fechamentos_offline\(CURRENT_DATE, 'pg_cron'\)/);
});
