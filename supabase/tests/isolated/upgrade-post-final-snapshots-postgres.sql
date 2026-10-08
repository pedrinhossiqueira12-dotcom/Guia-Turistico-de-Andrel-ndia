-- Depois de aplicar 20261007213000 SOMENTE no catalogo_upgrade_ci.
-- Rejeita qualquer mudança silenciosa nos dois snapshots previamente inseridos.
DO $guard$
BEGIN
  IF current_database() <> 'catalogo_upgrade_ci'
     OR current_setting('app.marketplace_test_upgrade', true) IS DISTINCT FROM 'enabled'
     OR to_regclass('public.catalogo_pedidos') IS NULL
     OR EXISTS (SELECT 1 FROM pg_constraint
        WHERE conrelid='public.catalogo_pedidos'::regclass AND conname='catalogo_pedidos_check1')
  THEN
    RAISE EXCEPTION 'Verificacao pos-upgrade exige clone isolado, migration final e opt-in';
  END IF;
END $guard$;

DO $assert$
BEGIN
  IF (SELECT COUNT(*) FROM public.catalogo_pedidos) <> 2
     OR (SELECT COUNT(*) FROM public.catalogo_comissoes_offline) <> 2
     OR NOT EXISTS (SELECT 1 FROM public.catalogo_pedidos
         WHERE versao_financeira=1 AND subtotal_produtos_centavos=101
           AND taxa_plataforma_centavos=5 AND taxa_motoboy_centavos=0
           AND taxa_total_centavos=5 AND repasse_bruto_comercio_centavos=96)
     OR NOT EXISTS (SELECT 1 FROM public.catalogo_pedidos
         WHERE versao_financeira=2 AND subtotal_produtos_centavos=33
           AND taxa_plataforma_centavos=2 AND taxa_motoboy_centavos=1
           AND taxa_total_centavos=3 AND repasse_bruto_comercio_centavos=30)
     OR NOT EXISTS (SELECT 1 FROM public.catalogo_comissoes_offline
         WHERE versao_financeira=1 AND subtotal_produtos_centavos=101
           AND valor_comissao_centavos=5 AND taxa_plataforma_centavos=5
           AND taxa_motoboy_centavos=0 AND valor_total_centavos=5)
     OR NOT EXISTS (SELECT 1 FROM public.catalogo_comissoes_offline
         WHERE versao_financeira=2 AND subtotal_produtos_centavos=33
           AND valor_comissao_centavos=3 AND taxa_plataforma_centavos=2
           AND taxa_motoboy_centavos=1 AND valor_total_centavos=3)
     OR (SELECT round(33::numeric*0.07)::integer) <> 2
  THEN
    RAISE EXCEPTION 'Migração reescreveu ou invalidou snapshots V1/V2 historicos';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.catalogo_pedidos'::regclass
      AND conname='catalogo_pedidos_taxas_v2_check'
      AND pg_get_constraintdef(oid) LIKE '%0.07%'
  ) THEN
    RAISE EXCEPTION 'Nova constraint 7 por cento ausente apos migracao';
  END IF;
END $assert$;

SELECT 'PASS: upgrade preservou integralmente pedidos e comissoes V1/V2 antigos' AS result;
