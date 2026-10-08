-- Fixture de corrida concorrente com dois motoboys e um pedido V2 ficticio.
-- Exclusivamente catalogo_race_ci, CLONADO de catalogo_ci no CI.
-- NUNCA executar em producao nem reutilizar identificadores reais.
DO $race_guard$
BEGIN
  IF current_database() <> 'catalogo_race_ci'
     OR current_setting('app.marketplace_test_race', true) IS DISTINCT FROM 'enabled'
     OR to_regclass('public.catalogo_pedidos') IS NULL
     OR to_regclass('public.catalogo_entregas_atribuidas') IS NULL
     OR (SELECT count(*) FROM public.catalogo_pedidos) <> 0
     OR (SELECT count(*) FROM public.catalogos WHERE comercio_id = 'comercio-de-exemplo') <> 1
     OR EXISTS (SELECT 1 FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net'))
  THEN
    RAISE EXCEPTION 'Fixture de corrida exige catalogo_race_ci descartavel, vazio e opt-in';
  END IF;
END $race_guard$;

INSERT INTO auth.users(id, email_confirmed_at)
VALUES
 ('00000000-0000-4000-8000-000000000241', now()),
 ('00000000-0000-4000-8000-000000000242', now());

INSERT INTO public.catalogo_motoboys(comercio_id, usuario_id, nome, email, autorizado_por)
VALUES
 ('comercio-de-exemplo', '00000000-0000-4000-8000-000000000241',
  'Motoboy Corrida A', 'corrida-a@example.invalid', '00000000-0000-4000-8000-000000000099'),
 ('comercio-de-exemplo', '00000000-0000-4000-8000-000000000242',
  'Motoboy Corrida B', 'corrida-b@example.invalid', '00000000-0000-4000-8000-000000000099');

INSERT INTO public.catalogo_motoboy_perfis(usuario_id, disponivel, apto, em_analise)
VALUES
 ('00000000-0000-4000-8000-000000000241', true, true, false),
 ('00000000-0000-4000-8000-000000000242', true, true, false);

UPDATE public.catalogo_fluxo_config
SET ativo = true, comercios_piloto = NULL
WHERE id = true;

INSERT INTO public.catalogo_pedidos(
 id, comercio_id, referencia_externa, idempotency_key, modalidade, forma_pagamento,
 subtotal_produtos_centavos, entrega_centavos, total_centavos,
 taxa_plataforma_centavos, taxa_motoboy_centavos, taxa_total_centavos,
 repasse_bruto_comercio_centavos, versao_financeira,
 cliente_nome, cliente_telefone, status_token_hash,
 codigo_entrega_hash, codigo_entrega_expira_em,
 status, status_pagamento
) VALUES (
 '00000000-0000-4000-8000-000000000251', 'comercio-de-exemplo',
 'ci-concorrencia-entrega', '00000000-0000-4000-8000-000000000261',
 'entrega', 'pix', 101, 0, 101, 5, 2, 7, 94, 2,
 'Cliente Concorrencia Ficticio', '00000000000', repeat('f',64),
 repeat('e',64), now() + interval '1 hour', 'pago', 'aprovado'
);

-- Usar as RPCs reais do estabelecimento, sem editar status diretamente.
DO $prepare$
DECLARE v jsonb;
BEGIN
  v := public.catalogo_operar_pedido_v2(
    '00000000-0000-4000-8000-000000000099',
    'comercio-de-exemplo',
    '00000000-0000-4000-8000-000000000251', 'aceitar'
  );
  IF (v->>'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Pedido sintetico nao pode ser aceito pelo comercio: %', v;
  END IF;
  v := public.catalogo_operar_pedido_v2(
    '00000000-0000-4000-8000-000000000099',
    'comercio-de-exemplo',
    '00000000-0000-4000-8000-000000000251', 'pronto'
  );
  IF (v->>'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Pedido sintetico nao chegou a fase ofertado: %', v;
  END IF;

  IF (SELECT entrega_status FROM public.catalogo_pedidos
      WHERE id = '00000000-0000-4000-8000-000000000251') <> 'ofertado'
     OR (SELECT count(*) FROM public.catalogo_entregas_atribuidas) <> 0
     OR (SELECT count(*) FROM public.catalogo_remuneracoes_v2) <> 0 THEN
    RAISE EXCEPTION 'Fixture criou atribuicao ou remuneracao antes da oferta';
  END IF;
END $prepare$;

-- Dois pedidos extras para corrida comprador CANCELAR x comercio ACEITAR.
-- O vencedor e nao deterministico, mas a transicao deve ser serializavel.
INSERT INTO public.catalogo_pedidos(
 id, comercio_id, referencia_externa, idempotency_key, modalidade, forma_pagamento,
 subtotal_produtos_centavos, entrega_centavos, total_centavos,
 taxa_plataforma_centavos, taxa_motoboy_centavos, taxa_total_centavos,
 repasse_bruto_comercio_centavos, versao_financeira,
 cliente_nome, cliente_telefone, status_token_hash,
 codigo_entrega_hash, codigo_entrega_expira_em,
 status, status_pagamento
) VALUES
(
 '00000000-0000-4000-8000-000000000252', 'comercio-de-exemplo',
 'ci-concorrencia-cancel-1', '00000000-0000-4000-8000-000000000262',
 'entrega', 'pix', 101, 0, 101, 5, 2, 7, 94, 2,
 'Cliente Cancelamento Ficticio A', '00000000001', repeat('1',64),
 repeat('a',64), now() + interval '1 hour', 'pago', 'aprovado'
),
(
 '00000000-0000-4000-8000-000000000253', 'comercio-de-exemplo',
 'ci-concorrencia-cancel-2', '00000000-0000-4000-8000-000000000263',
 'entrega', 'pix', 101, 0, 101, 5, 2, 7, 94, 2,
 'Cliente Cancelamento Ficticio B', '00000000002', repeat('2',64),
 repeat('b',64), now() + interval '1 hour', 'pago', 'aprovado'
);

SELECT 'PASS: dois motoboys e tres pedidos V2 sinteticos para corridas concorrentes' AS result;
