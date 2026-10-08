-- Protecao contra execucao acidental fora do banco descartavel de CI.
DO $isolated_guard$
BEGIN
  IF current_database() <> 'catalogo_ci'
     OR session_user <> 'postgres'
     OR EXISTS (
       SELECT 1 FROM information_schema.tables
        WHERE table_schema='public'
          AND table_name IN ('catalogo_pedidos','catalogo_comissoes_offline')
     )
  THEN
    RAISE EXCEPTION 'Fixture financeira exige banco catalogo_ci vazio e usuario postgres';
  END IF;
END $isolated_guard$;

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

DO $fixture$
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
  -- Snapshots legados V1 devem permanecer validos tambem em retirada e consumo local.
  FOREACH v_modalidade IN ARRAY ARRAY['retirada','consumo_local'] LOOP
    v_plataforma := round(101::numeric * 0.05)::integer;
    INSERT INTO public.catalogo_pedidos
      VALUES (101,1,v_modalidade,v_plataforma,0,v_plataforma);
    INSERT INTO public.catalogo_comissoes_offline
      VALUES (101,1,v_modalidade,v_plataforma,0,v_plataforma,v_plataforma);
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
  -- Um subtotal adulterado nao pode preservar taxas calculadas para outro valor.
  BEGIN
    INSERT INTO public.catalogo_pedidos VALUES(20000,2,'entrega',500,200,700);
    RAISE EXCEPTION 'ERRO: subtotal adulterado aceito em pedido';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.catalogo_comissoes_offline VALUES(20000,2,'entrega',500,200,700,700);
    RAISE EXCEPTION 'ERRO: subtotal adulterado aceito em comissao';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- Entregas V2 devem reservar a parcela de 2% ao motoboy.
  BEGIN
    INSERT INTO public.catalogo_pedidos VALUES(10000,2,'entrega',700,0,700);
    RAISE EXCEPTION 'ERRO: entrega V2 sem parcela de motoboy aceita';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.catalogo_comissoes_offline VALUES(10000,2,'entrega',700,0,700,700);
    RAISE EXCEPTION 'ERRO: comissao V2 sem parcela de motoboy aceita';
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
  -- A modalidade nao pode mudar sem recalcular a distribuicao financeira.
  BEGIN
    UPDATE public.catalogo_pedidos
       SET modalidade = 'retirada'
     WHERE ctid = (
       SELECT ctid FROM public.catalogo_pedidos
        WHERE versao_financeira = 2 AND modalidade = 'entrega'
          AND taxa_motoboy_centavos > 0 LIMIT 1
     );
    RAISE EXCEPTION 'ERRO: troca de entrega para retirada aceita sem recalculo';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.catalogo_comissoes_offline
       SET modalidade = 'consumo_local'
     WHERE ctid = (
       SELECT ctid FROM public.catalogo_comissoes_offline
        WHERE versao_financeira = 2 AND modalidade = 'entrega'
          AND taxa_motoboy_centavos > 0 LIMIT 1
     );
    RAISE EXCEPTION 'ERRO: troca de entrega para consumo local aceita sem recalculo';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- A versao financeira nao pode ser trocada mantendo taxas da versao anterior.
  BEGIN
    UPDATE public.catalogo_pedidos
       SET versao_financeira = 2
     WHERE ctid = (
       SELECT ctid FROM public.catalogo_pedidos
        WHERE versao_financeira = 1 AND modalidade = 'entrega'
          AND subtotal_produtos_centavos = 10000
        LIMIT 1
     );
    RAISE EXCEPTION 'ERRO: pedido V1 convertido em V2 sem recalculo';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.catalogo_comissoes_offline
       SET versao_financeira = 2
     WHERE ctid = (
       SELECT ctid FROM public.catalogo_comissoes_offline
        WHERE versao_financeira = 1 AND modalidade = 'entrega'
          AND subtotal_produtos_centavos = 10000
        LIMIT 1
     );
    RAISE EXCEPTION 'ERRO: comissao V1 convertida em V2 sem recalculo';
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
END $fixture$;

DO $verify$
BEGIN
  IF (SELECT count(*) FROM public.catalogo_pedidos) <> 50002 THEN
    RAISE EXCEPTION 'Quantidade inesperada de pedidos sinteticos';
  END IF;
  IF (SELECT count(*) FROM public.catalogo_comissoes_offline) <> 50002 THEN
    RAISE EXCEPTION 'Quantidade inesperada de comissoes sinteticas';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.catalogo_pedidos
     WHERE taxa_total_centavos <> taxa_plataforma_centavos + taxa_motoboy_centavos
  ) OR EXISTS (
    SELECT 1 FROM public.catalogo_comissoes_offline
     WHERE valor_total_centavos <> valor_comissao_centavos
  ) THEN
    RAISE EXCEPTION 'Snapshots sinteticos inconsistentes apos testes negativos';
  END IF;
END $verify$;

SELECT 'PASS: restricoes reais de pedidos e comissoes offline (50002 linhas por tabela)' AS resultado;
