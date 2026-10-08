-- Corrige divergencias de centavos: taxa total V2 sempre 7% arredondada uma vez.
-- Para entrega, motoboy recebe 2% arredondados; plataforma recebe o restante.
-- Pedidos historicos mantem os snapshots originais, inclusive a regra anterior.
BEGIN;

ALTER TABLE public.catalogo_pedidos DROP CONSTRAINT IF EXISTS catalogo_pedidos_taxas_v2_check;
ALTER TABLE public.catalogo_pedidos ADD CONSTRAINT catalogo_pedidos_taxas_v2_check CHECK (
  taxa_plataforma_centavos >= 0
  AND taxa_motoboy_centavos >= 0
  AND taxa_total_centavos = taxa_plataforma_centavos + taxa_motoboy_centavos
  AND (
    versao_financeira <> 2
    OR (
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
    )
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
