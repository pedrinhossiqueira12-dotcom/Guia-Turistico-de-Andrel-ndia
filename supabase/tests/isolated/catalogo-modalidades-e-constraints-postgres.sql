-- Regressão na TABELA REAL após todas as migrations, inclusive arredondamento.
-- Detecta o CHECK anônimo legada de 5% que bloqueava retirada V2 e
-- a plataforma de entrega V2 quando difere 1 centavo do 5% separado.
-- Somente catalogo_ci DESCARTAVEL, com BEGIN/ROLLBACK do CI.
DO $guard$
BEGIN
  IF current_database() <> 'catalogo_ci'
     OR current_setting('app.marketplace_test_modalities', true) IS DISTINCT FROM 'enabled'
     OR to_regclass('public.catalogo_pedidos') IS NULL
     OR (SELECT count(*) FROM public.catalogo_pedidos) <> 0 THEN
    RAISE EXCEPTION 'Cenario de constraints exige catalogo_ci isolado, vazio e opt-in';
  END IF;
END $guard$;

DO $schema$
BEGIN
  IF EXISTS(
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.catalogo_pedidos'::regclass
      AND conname='catalogo_pedidos_check1'
  ) THEN
    RAISE EXCEPTION 'CHECK oculto de 5 porcento ainda bloqueia V2';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.catalogo_pedidos'::regclass
      AND conname='catalogo_pedidos_taxas_v2_check'
      AND contype='c'
  ) THEN
    RAISE EXCEPTION 'Constraint atual que preserva V1 e V2 ausente';
  END IF;
END $schema$;

INSERT INTO public.catalogo_pedidos(
 id,comercio_id,referencia_externa,idempotency_key,modalidade,forma_pagamento,
 subtotal_produtos_centavos,entrega_centavos,total_centavos,
 taxa_plataforma_centavos,taxa_motoboy_centavos,taxa_total_centavos,
 repasse_bruto_comercio_centavos,versao_financeira,
 cliente_nome,cliente_telefone
) VALUES
-- Snapshot V1 LEGADO: 5% plataforma, nenhum motoboy.
('00000000-0000-4000-8000-000000000451','comercio-de-exemplo',
 'ci-modal-v1','00000000-0000-4000-8000-000000000461','entrega','pix',
 101,0,101,5,0,5,96,1,'Cliente legado fictício','00000000001'),
-- Snapshot V2 ENTREGA: 7% uma vez sobre 33 centavos = 2 centavos;
-- motoboy 2% = 1 centavo, plataforma = 1. O 5% SEPARADO daria 2,
-- motivo pelo qual o CHECK antigo também bloqueava este pedido.
('00000000-0000-4000-8000-000000000452','comercio-de-exemplo',
 'ci-modal-v2-entrega','00000000-0000-4000-8000-000000000462','entrega','pix',
 33,0,33,1,1,2,31,2,'Cliente entrega fictício','00000000002'),
-- Retirada V2: 7% integralmente plataforma e 0% motoboy.
('00000000-0000-4000-8000-000000000453','comercio-de-exemplo',
 'ci-modal-v2-retirada','00000000-0000-4000-8000-000000000463','retirada','pix',
 101,0,101,7,0,7,94,2,'Cliente retirada fictício','00000000003'),
-- Consumo local V2 segue a mesma regra de retirada.
('00000000-0000-4000-8000-000000000454','comercio-de-exemplo',
 'ci-modal-v2-local','00000000-0000-4000-8000-000000000464','consumo_local','pix',
 101,0,101,7,0,7,94,2,'Cliente local fictício','00000000004');

DO $check$
DECLARE denied boolean;
BEGIN
  IF (SELECT count(*) FROM public.catalogo_pedidos) <> 4
     OR (SELECT count(*) FROM public.catalogo_pedidos
          WHERE taxa_total_centavos=taxa_plataforma_centavos+taxa_motoboy_centavos) <> 4
     OR (SELECT count(*) FROM public.catalogo_pedidos
          WHERE versao_financeira=2 AND modalidade<>'entrega'
            AND taxa_plataforma_centavos=7 AND taxa_motoboy_centavos=0) <> 2
     OR (SELECT count(*) FROM public.catalogo_pedidos
          WHERE versao_financeira=1 AND taxa_plataforma_centavos=5) <> 1 THEN
    RAISE EXCEPTION 'Falha de consistencia nas modalidades V1/V2';
  END IF;

  -- Tentar cobrar só 5% num pedido V2 de retirada deve falhar.
  denied := false;
  BEGIN
    INSERT INTO public.catalogo_pedidos(
     id,comercio_id,referencia_externa,idempotency_key,modalidade,forma_pagamento,
     subtotal_produtos_centavos,entrega_centavos,total_centavos,
     taxa_plataforma_centavos,taxa_motoboy_centavos,taxa_total_centavos,
     repasse_bruto_comercio_centavos,versao_financeira,cliente_nome,cliente_telefone
    ) VALUES (
     '00000000-0000-4000-8000-000000000455','comercio-de-exemplo',
     'ci-modal-invalido','00000000-0000-4000-8000-000000000465','retirada','pix',
     101,0,101,5,0,5,96,2,'Cliente inválido','00000000005'
    );
  EXCEPTION WHEN check_violation THEN
    denied := true;
  END;
  IF NOT denied OR (SELECT count(*) FROM public.catalogo_pedidos) <> 4 THEN
    RAISE EXCEPTION 'Snapshot V2 de retirada com 5 porcento foi aceito';
  END IF;

  -- Um pedido V1 com 7% plataforma deve ser rejeitado: histórico preservado.
  denied := false;
  BEGIN
    INSERT INTO public.catalogo_pedidos(
     id,comercio_id,referencia_externa,idempotency_key,modalidade,forma_pagamento,
     subtotal_produtos_centavos,entrega_centavos,total_centavos,
     taxa_plataforma_centavos,taxa_motoboy_centavos,taxa_total_centavos,
     repasse_bruto_comercio_centavos,versao_financeira,cliente_nome,cliente_telefone
    ) VALUES (
     '00000000-0000-4000-8000-000000000456','comercio-de-exemplo',
     'ci-v1-invalido','00000000-0000-4000-8000-000000000466','entrega','pix',
     101,0,101,7,0,7,94,1,'Cliente V1 inválido','00000000006'
    );
  EXCEPTION WHEN check_violation THEN
    denied := true;
  END;
  IF NOT denied OR (SELECT count(*) FROM public.catalogo_pedidos) <> 4 THEN
    RAISE EXCEPTION 'Snapshot V1 de 7 porcento foi aceito';
  END IF;
END $check$;

SELECT 'PASS: V1 5%, V2 entrega 7% arredondado uma vez, retirada e local 7%; invalidez rejeitada' AS result;
