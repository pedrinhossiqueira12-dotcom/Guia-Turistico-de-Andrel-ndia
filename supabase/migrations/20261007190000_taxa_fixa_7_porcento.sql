-- Política financeira V2: taxa fixa de 7% sobre todas as vendas.
-- Sem entrega: 7% ficam integralmente como comissão da plataforma.
-- Com entrega: 5% ficam como comissão da plataforma + 2% como reserva/remuneração do motoboy.
-- Pedidos V1/legados permanecem preservados.

BEGIN;

ALTER TABLE public.catalogo_fluxo_config
  DROP CONSTRAINT IF EXISTS catalogo_fluxo_config_taxa_sem_entrega_percentual_check;

ALTER TABLE public.catalogo_fluxo_config
  ADD CONSTRAINT catalogo_fluxo_config_taxa_sem_entrega_percentual_check
  CHECK (taxa_sem_entrega_percentual = 7.00);

UPDATE public.catalogo_fluxo_config
   SET taxa_sem_entrega_percentual = 7.00,
       atualizado_em = pg_catalog.now()
 WHERE id = true;

ALTER TABLE public.catalogo_pedidos
  DROP CONSTRAINT IF EXISTS catalogo_pedidos_taxas_v2_check;

ALTER TABLE public.catalogo_pedidos
  ADD CONSTRAINT catalogo_pedidos_taxas_v2_check
  CHECK (
    taxa_plataforma_centavos =
      CASE
        WHEN versao_financeira = 2 AND modalidade = 'entrega' THEN round(subtotal_produtos_centavos * 0.05)::integer
        WHEN versao_financeira = 2 AND modalidade <> 'entrega' THEN round(subtotal_produtos_centavos * 0.07)::integer
        ELSE round(subtotal_produtos_centavos * 0.05)::integer
      END
    AND taxa_motoboy_centavos >= 0
    AND taxa_total_centavos = taxa_plataforma_centavos + taxa_motoboy_centavos
    AND (
      (versao_financeira = 1 AND taxa_motoboy_centavos = 0)
      OR
      (
        versao_financeira = 2
        AND taxa_motoboy_centavos =
          CASE
            WHEN modalidade = 'entrega' THEN round(subtotal_produtos_centavos * 0.02)::integer
            ELSE 0
          END
      )
    )
  );

ALTER TABLE public.catalogo_comissoes_offline
  ADD COLUMN IF NOT EXISTS modalidade text;

UPDATE public.catalogo_comissoes_offline c
   SET modalidade = p.modalidade
  FROM public.catalogo_pedidos p
 WHERE p.id = c.pedido_id
   AND c.modalidade IS DISTINCT FROM p.modalidade;

ALTER TABLE public.catalogo_comissoes_offline
  ALTER COLUMN modalidade SET NOT NULL;

ALTER TABLE public.catalogo_comissoes_offline
  DROP CONSTRAINT IF EXISTS catalogo_comissoes_offline_modalidade_check,
  DROP CONSTRAINT IF EXISTS catalogo_comissoes_offline_v2_snapshot_check;

ALTER TABLE public.catalogo_comissoes_offline
  ADD CONSTRAINT catalogo_comissoes_offline_modalidade_check
  CHECK (modalidade IN ('entrega','retirada','consumo_local'));

ALTER TABLE public.catalogo_comissoes_offline
  ADD CONSTRAINT catalogo_comissoes_offline_v2_snapshot_check CHECK (
    versao_financeira IN (1,2)
    AND taxa_plataforma_centavos =
      CASE
        WHEN versao_financeira = 2 AND modalidade <> 'entrega'
          THEN round(subtotal_produtos_centavos * 0.07)::integer
        ELSE round(subtotal_produtos_centavos * 0.05)::integer
      END
    AND taxa_motoboy_centavos >= 0
    AND valor_total_centavos = taxa_plataforma_centavos + taxa_motoboy_centavos
    AND valor_comissao_centavos = valor_total_centavos
    AND (
      (versao_financeira = 1 AND taxa_motoboy_centavos = 0)
      OR
      (
        versao_financeira = 2
        AND taxa_motoboy_centavos =
          CASE
            WHEN modalidade = 'entrega' THEN round(subtotal_produtos_centavos * 0.02)::integer
            ELSE 0
          END
      )
    )
  );

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_v2_comissao_defaults()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  NEW.taxa_plataforma_centavos := coalesce(NEW.taxa_plataforma_centavos,NEW.valor_comissao_centavos);
  NEW.valor_total_centavos := coalesce(NEW.valor_total_centavos,NEW.valor_comissao_centavos);
  IF NEW.modalidade IS NULL THEN
    SELECT p.modalidade INTO NEW.modalidade
      FROM public.catalogo_pedidos p
     WHERE p.id=NEW.pedido_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS catalogo_comissao_v2_defaults ON public.catalogo_comissoes_offline;
CREATE TRIGGER catalogo_comissao_v2_defaults
BEFORE INSERT ON public.catalogo_comissoes_offline
FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_v2_comissao_defaults();

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
      v_plataforma := round(p_subtotal_centavos * 0.05)::integer;
      v_motoboy := round(p_subtotal_centavos * 0.02)::integer;
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

-- Em V2 sem entrega não existe parcela logística. Portanto, o pedido é
-- considerado financiado somente pela parcela da plataforma.
CREATE OR REPLACE FUNCTION catalogo_private.catalogo_v2_financiado(p_pedido uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(
    SELECT 1
      FROM public.catalogo_pedidos p
     WHERE p.id = p_pedido
       AND p.versao_financeira = 2
       AND NOT p.reembolso_pendente
       AND NOT p.pagamento_revisao_pendente
       AND (
         (
           p.provedor = 'mercadopago'
           AND EXISTS (
             SELECT 1
               FROM public.catalogo_pagamentos_v2 b
              WHERE b.pedido_id = p.id
                AND b.status = 'aprovado'
                AND b.valor_centavos = p.total_centavos
                AND b.taxa_centavos = p.taxa_total_centavos
           )
         )
         OR
         (
           p.provedor = 'offline'
           AND catalogo_private.catalogo_v2_parcela_recebida(p.id,'plataforma')
           AND (
             p.taxa_motoboy_centavos = 0
             OR catalogo_private.catalogo_v2_parcela_recebida(p.id,'logistica')
           )
           AND EXISTS (
             SELECT 1
               FROM public.catalogo_comissoes_offline c
              WHERE c.pedido_id = p.id
                AND c.status = 'paga'
                AND c.versao_financeira = 2
                AND c.valor_total_centavos = p.taxa_total_centavos
                AND c.taxa_motoboy_centavos = p.taxa_motoboy_centavos
           )
         )
       )
  );
$$;

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_v2_registrar_plataforma(
  p_pedido_id uuid,
  p_origem text DEFAULT 'aceite'
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_pedido public.catalogo_pedidos%ROWTYPE;
  v_recebido boolean;
  v_comp date;
BEGIN
  SELECT * INTO v_pedido
    FROM public.catalogo_pedidos
   WHERE id = p_pedido_id
   FOR UPDATE;

  IF NOT FOUND OR v_pedido.versao_financeira <> 2 THEN RETURN false; END IF;
  IF v_pedido.aceito_em IS NULL THEN RETURN false; END IF;

  v_recebido := catalogo_private.catalogo_v2_financiado(v_pedido.id)
    OR (
      v_pedido.provedor = 'offline'
      AND catalogo_private.catalogo_v2_parcela_recebida(v_pedido.id,'plataforma')
    );

  IF v_pedido.taxa_plataforma_centavos > 0 THEN
    INSERT INTO public.catalogo_lancamentos_financeiros_v2(
      pedido_id,tipo,valor_centavos,status,chave_idempotencia,referencia,metadata
    )
    VALUES(
      v_pedido.id,'comissao_plataforma',v_pedido.taxa_plataforma_centavos,
      CASE WHEN v_recebido THEN 'disponivel' ELSE 'retido' END,
      'plataforma:'||v_pedido.id::text,p_origem,
      jsonb_build_object(
        'versao_financeira',2,
        'origem',p_origem,
        'recebimento_plataforma',v_recebido
      )
    )
    ON CONFLICT(chave_idempotencia) DO UPDATE
      SET status = CASE
        WHEN public.catalogo_lancamentos_financeiros_v2.status IN ('retido','pendencia_revisao')
             AND v_recebido
        THEN 'disponivel'
        ELSE public.catalogo_lancamentos_financeiros_v2.status
      END,
      atualizado_em = pg_catalog.now();
  END IF;

  IF v_pedido.provedor = 'offline' THEN
    v_comp := date_trunc(
      'month',
      v_pedido.aceito_em AT TIME ZONE 'America/Sao_Paulo'
    )::date;

    WHILE EXISTS(
      SELECT 1
        FROM public.catalogo_fechamentos_offline f
       WHERE f.comercio_id = v_pedido.comercio_id
         AND f.competencia = v_comp
         AND (
           f.status = 'pago'
           OR EXISTS(
             SELECT 1
               FROM public.catalogo_fatura_cobrancas b
              WHERE b.fechamento_id = f.id
           )
         )
    ) LOOP
      v_comp := (v_comp + interval '1 month')::date;
    END LOOP;

    INSERT INTO public.catalogo_comissoes_offline(
      pedido_id,comercio_id,competencia,subtotal_produtos_centavos,
      taxa_percentual,valor_comissao_centavos,versao_financeira,modalidade,
      taxa_plataforma_centavos,taxa_motoboy_centavos,valor_total_centavos,metadata
    )
    VALUES(
      v_pedido.id,v_pedido.comercio_id,v_comp,v_pedido.subtotal_produtos_centavos,
      7.00,v_pedido.taxa_total_centavos,2,v_pedido.modalidade,
      v_pedido.taxa_plataforma_centavos,v_pedido.taxa_motoboy_centavos,
      v_pedido.taxa_total_centavos,
      jsonb_build_object(
        'origem','aceite',
        'snapshot',true,
        'reserva_logistica',v_pedido.taxa_motoboy_centavos > 0
      )
    )
    ON CONFLICT(pedido_id) DO NOTHING;

    IF v_pedido.taxa_motoboy_centavos > 0 THEN
      INSERT INTO public.catalogo_logistica_offline_v2(
        pedido_id,comercio_id,competencia,valor_centavos
      )
      VALUES(
        v_pedido.id,v_pedido.comercio_id,v_comp,v_pedido.taxa_motoboy_centavos
      )
      ON CONFLICT(pedido_id) DO NOTHING;
    END IF;
  END IF;

  IF v_pedido.taxa_motoboy_centavos > 0 THEN
    INSERT INTO public.catalogo_lancamentos_financeiros_v2(
      pedido_id,tipo,valor_centavos,status,chave_idempotencia,metadata
    )
    VALUES(
      v_pedido.id,'reserva_logistica',v_pedido.taxa_motoboy_centavos,'retido',
      'reserva:'||v_pedido.id::text,
      jsonb_build_object(
        'reserva_nao_receita',true,
        'remuneracao_exige_codigo',true
      )
    )
    ON CONFLICT(chave_idempotencia) DO NOTHING;
  END IF;

  UPDATE public.catalogo_pedidos
     SET comissao_plataforma_registrada = true
   WHERE id = v_pedido.id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.catalogo_fluxo_precificar(text,integer,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_fluxo_precificar(text,integer,text)
  TO service_role;

COMMIT;
