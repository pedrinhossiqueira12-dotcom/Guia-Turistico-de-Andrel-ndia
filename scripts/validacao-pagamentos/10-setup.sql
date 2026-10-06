-- Dados controlados para a suíte funcional: um comércio e dois pedidos offline.
INSERT INTO public.catalogos (comercio_id, nome) VALUES ('comercio-de-exemplo', 'Comércio de exemplo');

INSERT INTO public.catalogo_pedidos (comercio_id, cliente_token_hash, codigo_entrega_hash, codigo_entrega_expira_em, subtotal_produtos_centavos, status, status_pagamento)
VALUES
  ('comercio-de-exemplo', 'hash-token-A', 'hash-codigo-A', now() + interval '48 hours', 10000, 'aguardando_pagamento', 'pendente'),
  ('comercio-de-exemplo', 'hash-token-B', 'hash-codigo-B', now() + interval '48 hours', 20000, 'aguardando_pagamento', 'pendente');