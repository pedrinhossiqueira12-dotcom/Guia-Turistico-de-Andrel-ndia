-- Corrige divergencias de centavos: taxa total V2 sempre 7% arredondada uma vez.
-- Para entrega, motoboy recebe 2% arredondados; plataforma recebe o restante.
-- Pedidos historicos mantem os snapshots originais, inclusive a regra anterior.
BEGIN;

-- A tabela original do marketplace preservou um CHECK sem nome explícito:
--   catalogo_pedidos_check1: plataforma = round(subtotal * 0.05)
-- Ele conflita com retiradas/consumo local V2 (7%) e também com entregas
-- cujo arredondamento único de 7% deixa a plataforma 1 centavo diferente
-- do cálculo isolado de 5%. Não basta substituir catalogo_pedidos_taxas_v2_check.
--
-- Remover SOMENTE se a definição for comprovadamente a restrição legada de 5%.
-- Na ausência dela (ambiente reconstituído), não há nada a remover; se o nome
-- foi reutilizado para outra regra, falhar sem alterar os dados.
DO $legacy_5_percent_constraint$
DECLARE v_definition text;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(oid)
    INTO v_definition
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.catalogo_pedidos'::pg_catalog.regclass
     AND conname = 'catalogo_pedidos_check1'
     AND contype = 'c';

  IF FOUND THEN
    IF v_definition NOT LIKE '%taxa_plataforma_centavos%'
       OR v_definition NOT LIKE '%subtotal_produtos_centavos%'
       OR v_definition NOT LIKE '%0.05%'
       OR v_definition LIKE '%versao_financeira%'
       OR v_definition LIKE '% AND %'
    THEN
      RAISE EXCEPTION 'catalogo_pedidos_check1 nao corresponde ao CHECK legado de 5%%. Revisar antes de prosseguir: %', v_definition;
    END IF;
    ALTER TABLE public.catalogo_pedidos
      DROP CONSTRAINT catalogo_pedidos_check1;
  END IF;
END;
$legacy_5_percent_constraint$;

-- A nova constraint mantém 5% para V1, aceita snapshots V2 históricos
-- e aplica 7% da plataforma em V2 sem entrega.
ALTER TABLE public.catalogo_pedidos DROP CONSTRAINT IF EXISTS catalogo_pedidos_taxas_v2_check;
ALTER TABLE public.catalogo_pedidos ADD CONSTRAINT catalogo_pedidos_taxas_v2_check CHECK (
  taxa_plataforma_centavos >= 0
  AND taxa_motoboy_centavos >= 0
  AND taxa_total_centavos = taxa_plataforma_centavos + taxa_motoboy_centavos
  AND (
    (versao_financeira = 1 AND taxa_motoboy_centavos = 0
     AND taxa_plataforma_centavos = round(subtotal_produtos_centavos::numeric * 0.05)::integer)
    OR (versao_financeira = 2 AND (
      (modalidade <> 'entrega' AND taxa_motoboy_centavos = 0
       AND taxa_plataforma_centavos = round(subtotal_produtos_centavos::numeric * 0.07)::integer)
      OR
      (modalidade = 'entrega'
       AND taxa_motoboy_centavos = round(subtotal_produtos_centavos::numeric * 0.02)::integer
       AND (
         (taxa_plataforma_centavos = round(subtotal_produtos_centavos::numeric * 0.05)::integer)
         OR
         (taxa_plataforma_centavos =
           round(subtotal_produtos_centavos::numeric * 0.07)::integer - taxa_motoboy_centavos)
       ))
    ))
  )
);

-- A comissao offline guarda o mesmo snapshot do pedido; sem esta alteracao,
-- o aceite de uma entrega com arredondamento novo falha no CHECK antigo de 5%.
ALTER TABLE public.catalogo_comissoes_offline
  DROP CONSTRAINT IF EXISTS catalogo_comissoes_offline_v2_snapshot_check;

ALTER TABLE public.catalogo_comissoes_offline
  ADD CONSTRAINT catalogo_comissoes_offline_v2_snapshot_check CHECK (
    versao_financeira IN (1,2)
    AND taxa_plataforma_centavos >= 0
    AND taxa_motoboy_centavos >= 0
    AND valor_total_centavos = taxa_plataforma_centavos + taxa_motoboy_centavos
    AND valor_comissao_centavos = valor_total_centavos
    AND (
      (versao_financeira = 1 AND taxa_motoboy_centavos = 0
       AND taxa_plataforma_centavos = round(subtotal_produtos_centavos::numeric * 0.05)::integer)
      OR
      (versao_financeira = 2 AND (
        (modalidade <> 'entrega' AND taxa_motoboy_centavos = 0
         AND taxa_plataforma_centavos = round(subtotal_produtos_centavos::numeric * 0.07)::integer)
        OR
        (modalidade = 'entrega'
         AND taxa_motoboy_centavos = round(subtotal_produtos_centavos::numeric * 0.02)::integer
         AND (
           taxa_plataforma_centavos = round(subtotal_produtos_centavos::numeric * 0.05)::integer
           OR taxa_plataforma_centavos =
             round(subtotal_produtos_centavos::numeric * 0.07)::integer - taxa_motoboy_centavos
         ))
      ))
    )
  );

CREATE OR REPLACE FUNCTION public.catalogo_fluxo_precificar(
  p_modalidade text,
  p_subtotal_centavos integer,
  p_comercio_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_cfg public.catalogo_fluxo_config%ROWTYPE;
  v_versao smallint := 1;
  v_plataforma integer;
  v_motoboy integer := 0;
BEGIN
  IF p_modalidade IS NULL OR p_modalidade NOT IN ('entrega','retirada','consumo_local')
     OR p_subtotal_centavos IS NULL OR p_subtotal_centavos <= 0 THEN
    RETURN jsonb_build_object('ok',false,'http_status',400,'mensagem','Modalidade ou subtotal inválido.');
  END IF;

  SELECT * INTO v_cfg
    FROM public.catalogo_fluxo_config
   WHERE id = true;

  IF coalesce(v_cfg.ativo,false)
     AND (v_cfg.comercios_piloto IS NULL OR p_comercio_id = ANY(v_cfg.comercios_piloto)) THEN
    v_versao := 2;

    IF p_modalidade = 'entrega' THEN
      v_motoboy := round(p_subtotal_centavos::numeric * 0.02)::integer;
      v_plataforma := round(p_subtotal_centavos::numeric * 0.07)::integer - v_motoboy;
    ELSE
      v_plataforma := round(p_subtotal_centavos * 0.07)::integer;
      v_motoboy := 0;
    END IF;
  ELSE
    v_plataforma := round(p_subtotal_centavos * 0.05)::integer;
  END IF;

  RETURN jsonb_build_object(
    'ok',true,
    'versao_financeira',v_versao,
    'taxa_plataforma_centavos',v_plataforma,
    'taxa_motoboy_centavos',v_motoboy,
    'taxa_total_centavos',v_plataforma + v_motoboy,
    'somente_pix',v_versao=2 AND coalesce(v_cfg.somente_pix,false),
    'ativo',v_versao=2
  );
END;
$$;


REVOKE ALL ON FUNCTION public.catalogo_fluxo_precificar(text,integer,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_fluxo_precificar(text,integer,text)
  TO service_role;
COMMIT;
