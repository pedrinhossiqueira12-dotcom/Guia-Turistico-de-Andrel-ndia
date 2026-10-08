-- As restricoes reais da migracao sao montadas pelo script de CI.
-- O banco e efemero; estas tabelas NAO sao as tabelas reais de producao.
CREATE TABLE public.catalogo_pedidos (
  subtotal_produtos_centavos integer NOT NULL,
  versao_financeira integer NOT NULL,
  modalidade text NOT NULL,
  taxa_plataforma_centavos integer NOT NULL,
  taxa_motoboy_centavos integer NOT NULL,
  taxa_total_centavos integer NOT NULL
);
CREATE TABLE public.catalogo_comissoes_offline (
  subtotal_produtos_centavos integer NOT NULL,
  versao_financeira integer NOT NULL,
  modalidade text NOT NULL,
  taxa_plataforma_centavos integer NOT NULL,
  taxa_motoboy_centavos integer NOT NULL,
  valor_total_centavos integer NOT NULL,
  valor_comissao_centavos integer NOT NULL
);

-- __CONSTRAINTS_FROM_REAL_MIGRATION__

DO $$
DECLARE
  v_subtotal integer;
  v_modalidade text;
  v_versao integer;
  v_motoboy integer;
  v_plataforma integer;
  v_total integer;
BEGIN
  FOR v_subtotal IN 1..10000 LOOP
    FOREACH v_modalidade IN ARRAY ARRAY['entrega','retirada','consumo_local'] LOOP
      v_versao := 2;
      v_motoboy := CASE WHEN v_modalidade='entrega' THEN round(v_subtotal::numeric * 0.02)::integer ELSE 0 END;
      v_total := round(v_subtotal::numeric * 0.07)::integer;
      v_plataforma := v_total - v_motoboy;
      INSERT INTO public.catalogo_pedidos VALUES(v_subtotal,v_versao,v_modalidade,v_plataforma,v_motoboy,v_total);
      INSERT INTO public.catalogo_comissoes_offline VALUES(v_subtotal,v_versao,v_modalidade,v_plataforma,v_motoboy,v_total,v_total);
    END LOOP;
    -- Mantem snapshots historicos V2 que arredondavam 5% e 2% separadamente.
    v_motoboy := round(v_subtotal::numeric * 0.02)::integer;
    v_plataforma := round(v_subtotal::numeric * 0.05)::integer;
    v_total := v_plataforma + v_motoboy;
    INSERT INTO public.catalogo_pedidos VALUES(v_subtotal,2,'entrega',v_plataforma,v_motoboy,v_total);
    INSERT INTO public.catalogo_comissoes_offline VALUES(v_subtotal,2,'entrega',v_plataforma,v_motoboy,v_total,v_total);
    -- Mantem snapshots V1 de 5% sem parcela de motoboy.
    v_plataforma := round(v_subtotal::numeric * 0.05)::integer;
    INSERT INTO public.catalogo_pedidos VALUES(v_subtotal,1,'entrega',v_plataforma,0,v_plataforma);
    INSERT INTO public.catalogo_comissoes_offline VALUES(v_subtotal,1,'entrega',v_plataforma,0,v_plataforma,v_plataforma);
  END LOOP;
  -- Valores negativos, totais manipulados e comissoes divergentes devem falhar.
  BEGIN
    INSERT INTO public.catalogo_pedidos VALUES(10000,2,'entrega',-1,201,200);
    RAISE EXCEPTION 'ERRO: parcela negativa aceita em pedido';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.catalogo_pedidos VALUES(10000,2,'entrega',500,200,701);
    RAISE EXCEPTION 'ERRO: soma divergente aceita em pedido';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.catalogo_comissoes_offline VALUES(10000,2,'entrega',500,200,700,699);
    RAISE EXCEPTION 'ERRO: comissao divergente do total aceita';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.catalogo_pedidos VALUES(10000,2,'consumo_local',500,200,700);
    RAISE EXCEPTION 'ERRO: consumo local com motoboy aceito';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- CHECKs devem ser aplicados tambem a alteracoes de registros existentes.
  BEGIN
    UPDATE public.catalogo_pedidos
       SET taxa_total_centavos = taxa_total_centavos + 1
     WHERE ctid = (SELECT ctid FROM public.catalogo_pedidos LIMIT 1);
    RAISE EXCEPTION 'ERRO: UPDATE inconsistente de pedido aceito';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.catalogo_comissoes_offline
       SET valor_comissao_centavos = valor_comissao_centavos + 1
     WHERE ctid = (SELECT ctid FROM public.catalogo_comissoes_offline LIMIT 1);
    RAISE EXCEPTION 'ERRO: UPDATE inconsistente de comissao aceito';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- As restricoes precisam rejeitar valores inconsistentes.
  BEGIN
    INSERT INTO public.catalogo_comissoes_offline VALUES(10000,2,'entrega',500,300,800,800);
    RAISE EXCEPTION 'ERRO: comissao adulterada foi aceita';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.catalogo_pedidos VALUES(10000,2,'retirada',500,200,700);
    RAISE EXCEPTION 'ERRO: retirada com motoboy foi aceita';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.catalogo_comissoes_offline VALUES(10000,1,'entrega',700,0,700,700);
    RAISE EXCEPTION 'ERRO: V1 foi alterada para 7 por cento';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

SELECT 'PASS: restricoes reais de pedidos e comissoes offline (50000 linhas por tabela)' AS resultado;
