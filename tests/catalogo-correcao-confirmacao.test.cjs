const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const correcao = fs.readFileSync('supabase/migrations/20261005170000_catalogo_correcao_confirmacao_offline.sql', 'utf8');
const anterior = fs.readFileSync('supabase/migrations/20261005123000_catalogo_pedidos_offline_auditoria.sql', 'utf8');

const codigo = correcao.split('\n').filter((linha) => !linha.trimStart().startsWith('--')).join('\n');

test('o alvo do conflito deixou de ser ambíguo com o parâmetro de saída pedido_id', () => {
  assert.match(correcao, /ON CONFLICT ON CONSTRAINT catalogo_comissoes_offline_pedido_id_key DO NOTHING/);
  assert.doesNotMatch(codigo, /ON CONFLICT \(pedido_id\)/);
  // A versão anterior continua registrada como histórico do defeito corrigido.
  assert.match(anterior, /ON CONFLICT \(pedido_id\) DO NOTHING/);
});

test('o contrato antigo permanece no histórico e a confirmação pública é encerrada', () => {
  assert.match(correcao, /RETURNS TABLE\(ok boolean, pedido_id uuid, status text, status_pagamento text, mensagem text\)/);
  const edge = fs.readFileSync('supabase/functions/catalogo-pedido-offline/index.ts', 'utf8');
  assert.match(edge, /action === "confirmar_entrega".*410/);
  const admin = fs.readFileSync('supabase/functions/catalogo-pedidos-offline-admin/index.ts', 'utf8');
  assert.match(admin, /catalogo_confirmar_entrega_autenticada/);
});

test('a correção preserva as travas de segurança da confirmação', () => {
  assert.match(correcao, /WHERE p\.cliente_token_hash = p_cliente_token_hash/);
  assert.match(correcao, /FOR UPDATE/);
  assert.match(correcao, /v_pedido\.codigo_entrega_hash IS DISTINCT FROM p_codigo_hash/);
  assert.match(correcao, /v_pedido\.codigo_entrega_expira_em < v_now/);
  assert.match(correcao, /v_pedido\.codigo_entrega_tentativas >= 5/);
  assert.match(correcao, /codigo_entrega_usado_em IS NOT NULL/);
  assert.match(correcao, /SECURITY DEFINER/);
  assert.match(correcao, /SET search_path = ''/);
  assert.match(correcao, /REVOKE ALL ON FUNCTION public\.catalogo_confirmar_pedido_offline\(text, text, text\) FROM PUBLIC, anon, authenticated/);
  assert.match(correcao, /GRANT EXECUTE ON FUNCTION public\.catalogo_confirmar_pedido_offline\(text, text, text\) TO service_role/);
});

test('a correção continua registrando a comissão de 5% sobre os produtos', () => {
  assert.match(correcao, /round\(v_pedido\.subtotal_produtos_centavos \* 0\.05\)::integer/);
  assert.match(correcao, /jsonb_build_object\('origem', 'codigo_entrega'\)/);
});