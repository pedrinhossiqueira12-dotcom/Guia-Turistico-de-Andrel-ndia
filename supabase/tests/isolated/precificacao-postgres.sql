-- Banco PostgreSQL efemero do CI: nenhum dado real ou credencial de producao.
CREATE TABLE public.catalogo_fluxo_config (
  id boolean PRIMARY KEY DEFAULT true,
  ativo boolean NOT NULL DEFAULT false,
  comercios_piloto text[],
  somente_pix boolean NOT NULL DEFAULT false
);
INSERT INTO public.catalogo_fluxo_config(id,ativo,comercios_piloto,somente_pix)
VALUES(true,true,NULL,false);

DO $$
DECLARE
  v_subtotal integer;
  v_result jsonb;
  v_total integer;
  v_motoboy integer;
  v_plataforma integer;
BEGIN
  FOR v_subtotal IN 1..10000 LOOP
    v_result := public.catalogo_fluxo_precificar('entrega',v_subtotal,NULL);
    v_total := (v_result->>'taxa_total_centavos')::integer;
    v_motoboy := (v_result->>'taxa_motoboy_centavos')::integer;
    v_plataforma := (v_result->>'taxa_plataforma_centavos')::integer;
    IF v_total <> round(v_subtotal::numeric * 0.07)::integer
       OR v_motoboy <> round(v_subtotal::numeric * 0.02)::integer
       OR v_plataforma + v_motoboy <> v_total
       OR (v_result->>'versao_financeira')::integer <> 2 THEN
      RAISE EXCEPTION 'Divergencia de entrega para % centavos: %',v_subtotal,v_result;
    END IF;
  END LOOP;
  FOREACH v_subtotal IN ARRAY ARRAY[1,8,30,101,10000] LOOP
    v_result := public.catalogo_fluxo_precificar('retirada',v_subtotal,NULL);
    IF (v_result->>'taxa_plataforma_centavos')::integer <> round(v_subtotal::numeric * 0.07)::integer
       OR (v_result->>'taxa_motoboy_centavos')::integer <> 0 THEN
      RAISE EXCEPTION 'Divergencia retirada: %',v_result;
    END IF;
    v_result := public.catalogo_fluxo_precificar('consumo_local',v_subtotal,NULL);
    IF (v_result->>'taxa_plataforma_centavos')::integer <> round(v_subtotal::numeric * 0.07)::integer
       OR (v_result->>'taxa_motoboy_centavos')::integer <> 0 THEN
      RAISE EXCEPTION 'Divergencia consumo local: %',v_result;
    END IF;
  END LOOP;
  IF (public.catalogo_fluxo_precificar('entrega',0,NULL)->>'http_status')::integer <> 400 THEN
    RAISE EXCEPTION 'Subtotal zero aceito';
  END IF;
  UPDATE public.catalogo_fluxo_config SET ativo=false WHERE id=true;
  v_result := public.catalogo_fluxo_precificar('entrega',10000,NULL);
  IF (v_result->>'versao_financeira')::integer <> 1
     OR (v_result->>'taxa_total_centavos')::integer <> 500 THEN
    RAISE EXCEPTION 'Fallback legado incorreto: %',v_result;
  END IF;
END $$;
SELECT 'PASS: 10000 subtotais, modalidades, invalidos e fallback legado' AS resultado;
