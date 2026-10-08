-- Apenas em catalogo_upgrade_ci, clonado de catalogo_ci ANTES da migração final.
-- Imita dois snapshots históricos reais na estrutura preexistente, sem PII.
DO $guard$
BEGIN
  IF current_database() <> 'catalogo_upgrade_ci'
     OR current_setting('app.marketplace_test_upgrade', true) IS DISTINCT FROM 'enabled'
     OR to_regclass('public.catalogo_pedidos') IS NULL
     OR (SELECT COUNT(*) FROM public.catalogo_pedidos) <> 0
     OR (SELECT COUNT(*) FROM public.catalogo_comissoes_offline) <> 0
     OR NOT EXISTS (SELECT 1 FROM pg_constraint
         WHERE conrelid='public.catalogo_pedidos'::regclass
           AND conname='catalogo_pedidos_check1')
  THEN
    RAISE EXCEPTION 'Fixture upgrade exige catalogo_upgrade_ci vazio, pre-migration e opt-in';
  END IF;
END $guard$;

INSERT INTO public.catalogo_pedidos (
  id,comercio_id,referencia_externa,idempotency_key,modalidade,forma_pagamento,
  subtotal_produtos_centavos,entrega_centavos,total_centavos,
  taxa_plataforma_centavos,taxa_motoboy_centavos,taxa_total_centavos,
  repasse_bruto_comercio_centavos,versao_financeira,cliente_nome,cliente_telefone
) VALUES
-- V1 conserva 5% histórico sobre subtotal de 101 centavos.
('00000000-0000-4000-8000-000000000571','comercio-de-exemplo',
 'ci-upgrade-v1','00000000-0000-4000-8000-000000000581','entrega','dinheiro',
 101,0,101,5,0,5,96,1,'Fictício V1','00000000001'),
-- V2 antigo soma arredondamentos separados: 5% de 33=2 e 2% de 33=1.
-- Novo arredondamento único daria 7% de 33=2, mas NÃO pode reescrever 3.
('00000000-0000-4000-8000-000000000572','comercio-de-exemplo',
 'ci-upgrade-v2','00000000-0000-4000-8000-000000000582','entrega','dinheiro',
 33,0,33,2,1,3,30,2,'Fictício V2','00000000002');

INSERT INTO public.catalogo_comissoes_offline(
  pedido_id,comercio_id,competencia,subtotal_produtos_centavos,
  valor_comissao_centavos,taxa_plataforma_centavos,taxa_motoboy_centavos,
  valor_total_centavos,versao_financeira,modalidade
) VALUES
('00000000-0000-4000-8000-000000000571','comercio-de-exemplo','2026-10-01',
 101,5,5,0,5,1,'entrega'),
('00000000-0000-4000-8000-000000000572','comercio-de-exemplo','2026-10-01',
 33,3,2,1,3,2,'entrega');

DO $assert_before$
BEGIN
  IF (SELECT COUNT(*) FROM public.catalogo_pedidos) <> 2
     OR (SELECT COUNT(*) FROM public.catalogo_comissoes_offline) <> 2
     OR (SELECT taxa_total_centavos FROM public.catalogo_pedidos WHERE versao_financeira=2) <> 3
     OR (SELECT valor_total_centavos FROM public.catalogo_comissoes_offline WHERE versao_financeira=2) <> 3
  THEN
    RAISE EXCEPTION 'Snapshot historico pre-upgrade nao confere';
  END IF;
END $assert_before$;

SELECT 'PASS: base historica V1 e V2 pre-upgrade com arredondamento antigo' AS result;
