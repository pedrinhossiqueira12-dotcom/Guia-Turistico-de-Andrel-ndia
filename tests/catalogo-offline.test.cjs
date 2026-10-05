const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('supabase/migrations/20261005120000_catalogo_pagamentos_offline.sql', 'utf8');
const offlineFunction = fs.readFileSync('supabase/functions/catalogo-pedido-offline/index.ts', 'utf8');
const config = fs.readFileSync('supabase/config.toml', 'utf8');

test('pagamento offline mantém 5% somente sobre produtos e exclui entrega', () => {
  assert.match(migration, /taxa_percentual numeric\(5,2\).*CHECK \(taxa_percentual = 5\.00\)/s);
  assert.match(migration, /valor_comissao_centavos integer NOT NULL CHECK \(valor_comissao_centavos = round\(subtotal_produtos_centavos \* taxa_percentual \/ 100\)\)/);
  assert.match(offlineFunction, /const fee = Math\.round\(subtotal \* 0\.05\)/);
  assert.match(offlineFunction, /const total = subtotal \+ delivery/);
});

test('pedido offline só aceita métodos explícitos no catálogo', () => {
  assert.match(offlineFunction, /const OFFLINE_METHODS = new Set/);
  assert.match(offlineFunction, /catalog\.metodos_pagamento\.includes\(method\)/);
  assert.match(migration, /forma_pagamento IN \('pix', 'dinheiro', 'cartao_credito', 'cartao_debito', 'pagamento_entrega', 'pagamento_local'\)/);
});

test('código de entrega não é persistido em claro e só gera comissão após confirmação', () => {
  assert.match(offlineFunction, /codigo_entrega_hash: codeHash/);
  assert.match(offlineFunction, /cliente_token_hash: clienteTokenHash/);
  assert.match(offlineFunction, /catalogo_confirmar_pedido_offline/);
  assert.match(migration, /status = 'entregue'/);
  assert.match(migration, /INSERT INTO public\.catalogo_comissoes_offline/);
  assert.doesNotMatch(offlineFunction, /catalogo_comissoes_offline.*insert/s);
});

test('confirmação é one-time e o fechamento vencido bloqueia o catálogo', () => {
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /codigo_entrega_tentativas >= 5/);
  assert.match(migration, /codigo_entrega_usado_em IS NOT NULL/);
  assert.match(migration, /catalogo_bloquear_inadimplentes_offline/);
  assert.match(migration, /motivo_bloqueio = 'Comissão de pagamentos presenciais vencida.'/);
});

test('feature flag mantém o endpoint offline desligado por padrão', () => {
  assert.match(offlineFunction, /OFFLINE_CHECKOUT_ENABLED/);
  assert.match(offlineFunction, /pagamento offline ainda não está habilitado/);
  assert.match(config, /\[functions\.catalogo-pedido-offline\]/);
});
