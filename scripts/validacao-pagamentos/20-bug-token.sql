-- Demonstração do defeito: a confirmação ignora o token do cliente.
-- Cria dois pedidos e tenta confirmar o SEGUNDO usando o token/código dele.
\set ON_ERROR_STOP on

INSERT INTO public.catalogos (comercio_id, nome) VALUES ('comercio-de-exemplo', 'Comércio de exemplo');

INSERT INTO public.catalogo_pedidos (comercio_id, cliente_token_hash, codigo_entrega_hash, codigo_entrega_expira_em, subtotal_produtos_centavos, status, status_pagamento)
VALUES
  ('comercio-de-exemplo', 'hash-token-A', 'hash-codigo-A', now() + interval '48 hours', 10000, 'aguardando_pagamento', 'pendente'),
  ('comercio-de-exemplo', 'hash-token-B', 'hash-codigo-B', now() + interval '48 hours', 20000, 'aguardando_pagamento', 'pendente');

\echo '--- Pedidos antes da confirmação ---'
SELECT left(cliente_token_hash, 14) AS token, status, codigo_entrega_usado_em IS NOT NULL AS confirmado
  FROM public.catalogo_pedidos ORDER BY subtotal_produtos_centavos;

\echo '--- Confirmando o pedido B (token B + código B) ---'
SELECT * FROM public.catalogo_confirmar_pedido_offline('hash-token-B', 'hash-codigo-B', 'Entregador de teste');

\echo '--- Resultado: qual pedido foi realmente concluído? ---'
SELECT left(cliente_token_hash, 14) AS token, status, subtotal_produtos_centavos,
       codigo_entrega_usado_em IS NOT NULL AS confirmado
  FROM public.catalogo_pedidos ORDER BY subtotal_produtos_centavos;

\echo '--- Comissões registradas ---'
SELECT left(p.cliente_token_hash, 14) AS token_do_pedido_comissionado, c.valor_comissao_centavos
  FROM public.catalogo_comissoes_offline c JOIN public.catalogo_pedidos p ON p.id = c.pedido_id;