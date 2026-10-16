-- COB-06/PR39: PONTE DE LEITURA para reconhecer uma quitacao do lote unico.
-- CANDIDATO nao implantavel: somente clone descartavel da CI, apos SQL 03-09.
-- Nao ha RPC que crie quitacao nem GRANT INSERT/UPDATE/DELETE a service_role.
-- A fixture pode simular prova no PostgreSQL como owner, com ROLLBACK.
-- Parametros SQL/eventos sinteticos NAO comprovam recebimento real do Asaas.
BEGIN;

CREATE TABLE public.catalogo_asaas_acumulo_quitacoes_isoladas (
 lote_id uuid PRIMARY KEY REFERENCES public.catalogo_asaas_acumulo_lotes(id) ON DELETE RESTRICT,
 payment_id text NOT NULL UNIQUE,
 evento_recebimento_id bigint NOT NULL UNIQUE
   REFERENCES public.catalogo_asaas_acumulo_eventos(id) ON DELETE RESTRICT,
 valor_centavos bigint NOT NULL CHECK(valor_centavos>=500 AND valor_centavos<=2147483647),
 estado text NOT NULL DEFAULT 'pago'
   CHECK(estado IN ('pago','estornado','contestado')),
 registrado_em timestamptz NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE public.catalogo_asaas_acumulo_quitacoes_isoladas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_asaas_acumulo_quitacoes_isoladas
 FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.catalogo_asaas_acumulo_quitacoes_isoladas TO service_role;

CREATE FUNCTION catalogo_private.catalogo_asaas_acumulo_quitacao_isolada_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $guard$
DECLARE
 v_ref public.catalogo_asaas_acumulo_referencias%ROWTYPE;
 v_obs public.catalogo_asaas_acumulo_observacoes%ROWTYPE;
 v_ev public.catalogo_asaas_acumulo_eventos%ROWTYPE;
 v_check jsonb;
BEGIN
 IF TG_OP='DELETE' THEN
   RAISE EXCEPTION 'Quitacao isolada imutavel: exclusao proibida' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' THEN
   IF ROW(NEW.lote_id,NEW.payment_id,NEW.evento_recebimento_id,
          NEW.valor_centavos,NEW.registrado_em) IS DISTINCT FROM
      ROW(OLD.lote_id,OLD.payment_id,OLD.evento_recebimento_id,
          OLD.valor_centavos,OLD.registrado_em)
      OR OLD.estado IS DISTINCT FROM 'pago'
      OR NEW.estado NOT IN ('estornado','contestado')
   THEN RAISE EXCEPTION 'Quitacao isolada: transicao proibida'
     USING ERRCODE='23514'; END IF;
   IF NEW.estado='estornado' AND NOT EXISTS (
       SELECT 1 FROM public.catalogo_asaas_acumulo_eventos e
        WHERE e.lote_id=OLD.lote_id AND e.payment_id=OLD.payment_id
         AND e.estado='REFUNDED'
     ) THEN RAISE EXCEPTION 'Estorno nao observado' USING ERRCODE='23514'; END IF;
   IF NEW.estado='contestado' AND NOT EXISTS (
       SELECT 1 FROM public.catalogo_asaas_acumulo_eventos e
        WHERE e.lote_id=OLD.lote_id AND e.payment_id=OLD.payment_id
         AND e.estado IN ('PARTIALLY_REFUNDED','REFUND_IN_PROGRESS',
                          'CHARGEBACK_REQUESTED','DELETED')
     ) THEN RAISE EXCEPTION 'Contestacao nao observada' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;

 IF NEW.estado IS DISTINCT FROM 'pago' THEN
   RAISE EXCEPTION 'Quitacao inicial invalida' USING ERRCODE='23514';
 END IF;
 SELECT * INTO v_ref FROM public.catalogo_asaas_acumulo_referencias
 WHERE lote_id=NEW.lote_id FOR UPDATE;
 SELECT * INTO v_obs FROM public.catalogo_asaas_acumulo_observacoes
 WHERE lote_id=NEW.lote_id;
 SELECT * INTO v_ev FROM public.catalogo_asaas_acumulo_eventos
 WHERE id=NEW.evento_recebimento_id;
 v_check:=public.catalogo_asaas_apurar_estados_acumulo_inerte(NEW.lote_id);
 IF v_ref.lote_id IS NULL OR v_obs.lote_id IS NULL OR v_ev.id IS NULL
    OR v_ref.valor_centavos IS DISTINCT FROM NEW.valor_centavos
    OR v_obs.valor_centavos IS DISTINCT FROM NEW.valor_centavos
    OR v_obs.payment_id IS DISTINCT FROM NEW.payment_id
    OR v_ev.lote_id IS DISTINCT FROM NEW.lote_id
    OR v_ev.payment_id IS DISTINCT FROM NEW.payment_id
    OR v_ev.estado NOT IN ('CONFIRMED','RECEIVED')
    OR v_check->>'candidato_a_conferencia_manual' IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'Quitacao nao autorizada: fontes, valor ou estados inconsistentes'
   USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_acumulo_quitacao_isolada_guard()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER catalogo_asaas_acumulo_quitacao_isolada_protegida
 BEFORE INSERT OR UPDATE OR DELETE ON public.catalogo_asaas_acumulo_quitacoes_isoladas
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_acumulo_quitacao_isolada_guard();

-- Contrato legado preservado literalmente como primeiro ramo (cobranca mensal).
-- Segundo ramo APENAS reconhece comprovante isolado do lote com fontes originais
-- imutaveis; sem esse registro, NENHUM credito pode ser liberado pelo acumulo.
CREATE OR REPLACE FUNCTION catalogo_private.catalogo_v2_parcela_recebida(
 p_pedido uuid,p_tipo text
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $recebida$
 SELECT EXISTS(
  SELECT 1 FROM public.catalogo_fatura_componentes_v2 cp
   JOIN public.catalogo_fechamentos_offline f ON f.id=cp.fechamento_id AND f.status='pago'
   JOIN public.catalogo_fatura_cobrancas b ON b.fechamento_id=f.id AND b.status='pago'
   WHERE cp.pedido_id=p_pedido AND cp.tipo=p_tipo
    AND NULLIF(pg_catalog.btrim(b.payment_id),'') IS NOT NULL AND b.pago_em IS NOT NULL
    AND b.valor_centavos=f.total_comissao_centavos
    AND b.valor_centavos=(SELECT pg_catalog.sum(x.valor_centavos)
      FROM public.catalogo_fatura_componentes_v2 x WHERE x.fechamento_id=f.id)
    AND cp.valor_centavos=CASE WHEN p_tipo='logistica'
      THEN (SELECT p.taxa_motoboy_centavos FROM public.catalogo_pedidos p WHERE p.id=p_pedido)
      ELSE (SELECT p.taxa_plataforma_centavos FROM public.catalogo_pedidos p WHERE p.id=p_pedido) END
 ) OR EXISTS (
  SELECT 1 FROM public.catalogo_fatura_componentes_v2 cp
   JOIN public.catalogo_fechamentos_offline f
     ON f.id=cp.fechamento_id AND f.status='pago'
   JOIN public.catalogo_asaas_acumulo_fontes af
     ON af.fechamento_id=f.id AND af.competencia=f.competencia
       AND af.valor_centavos=f.total_comissao_centavos
   JOIN public.catalogo_asaas_acumulo_lotes lote
     ON lote.id=af.lote_id AND lote.comercio_id=f.comercio_id
   JOIN public.catalogo_asaas_acumulo_quitacoes_isoladas q
     ON q.lote_id=lote.id AND q.estado='pago' AND q.valor_centavos=lote.total_centavos
   JOIN public.catalogo_asaas_acumulo_observacoes obs
     ON obs.lote_id=lote.id AND obs.payment_id=q.payment_id
       AND obs.valor_centavos=q.valor_centavos
   JOIN public.catalogo_asaas_acumulo_referencias ref
     ON ref.lote_id=lote.id AND ref.referencia=obs.referencia
       AND f.referencia_pagamento=ref.referencia
   JOIN public.catalogo_asaas_acumulo_eventos e
     ON e.id=q.evento_recebimento_id AND e.lote_id=q.lote_id
       AND e.payment_id=q.payment_id AND e.estado IN ('CONFIRMED','RECEIVED')
   JOIN public.catalogo_comissoes_offline c
     ON c.pedido_id=cp.pedido_id AND c.comercio_id=f.comercio_id
       AND c.competencia=f.competencia AND c.status='paga'
       AND c.referencia_pagamento=ref.referencia
   WHERE cp.pedido_id=p_pedido AND cp.tipo=p_tipo
    AND cp.valor_centavos=CASE WHEN p_tipo='logistica'
      THEN (SELECT p.taxa_motoboy_centavos FROM public.catalogo_pedidos p WHERE p.id=p_pedido)
      ELSE (SELECT p.taxa_plataforma_centavos FROM public.catalogo_pedidos p WHERE p.id=p_pedido) END
    -- Uma quitacao unica financia o LOTE INTEIRO, nunca so um mes.
    -- Mesmo que um fechamento ou comissao fique pendente durante a baixa,
    -- nenhuma parcela de outra competencia se torna recebida prematuramente.
    AND (SELECT pg_catalog.count(*) FROM public.catalogo_asaas_acumulo_fontes af_todas
         WHERE af_todas.lote_id=lote.id)>=2
    AND (SELECT pg_catalog.sum(af_todas.valor_centavos)
         FROM public.catalogo_asaas_acumulo_fontes af_todas
         WHERE af_todas.lote_id=lote.id)=q.valor_centavos
    AND NOT EXISTS (
      SELECT 1 FROM public.catalogo_asaas_acumulo_fontes af_todas
      LEFT JOIN public.catalogo_fechamentos_offline f_todas
        ON f_todas.id=af_todas.fechamento_id
      WHERE af_todas.lote_id=lote.id
        AND (f_todas.id IS NULL
          OR f_todas.status IS DISTINCT FROM 'pago'
          OR f_todas.comercio_id IS DISTINCT FROM lote.comercio_id
          OR f_todas.competencia IS DISTINCT FROM af_todas.competencia
          OR f_todas.total_comissao_centavos IS DISTINCT FROM af_todas.valor_centavos
          OR f_todas.referencia_pagamento IS DISTINCT FROM ref.referencia
          OR (SELECT coalesce(pg_catalog.sum(cp_total.valor_centavos),0)
              FROM public.catalogo_fatura_componentes_v2 cp_total
              WHERE cp_total.fechamento_id=af_todas.fechamento_id)
              IS DISTINCT FROM af_todas.valor_centavos
          OR EXISTS (
              SELECT 1 FROM public.catalogo_fatura_cobrancas b_todas
              WHERE b_todas.fechamento_id=af_todas.fechamento_id)
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.catalogo_asaas_acumulo_fontes af_todas
      JOIN public.catalogo_fatura_componentes_v2 cp_todas
        ON cp_todas.fechamento_id=af_todas.fechamento_id
      LEFT JOIN public.catalogo_comissoes_offline c_todas
        ON c_todas.pedido_id=cp_todas.pedido_id
          AND c_todas.comercio_id=lote.comercio_id
          AND c_todas.competencia=af_todas.competencia
      WHERE af_todas.lote_id=lote.id
        AND (c_todas.pedido_id IS NULL
          OR c_todas.status IS DISTINCT FROM 'paga'
          OR c_todas.referencia_pagamento IS DISTINCT FROM ref.referencia)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.catalogo_asaas_acumulo_eventos rev
      WHERE rev.lote_id=lote.id AND rev.payment_id=q.payment_id
        AND rev.estado IN ('REFUNDED','PARTIALLY_REFUNDED','REFUND_IN_PROGRESS',
          'CHARGEBACK_REQUESTED','DELETED')
    )
 );
$recebida$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_v2_parcela_recebida(uuid,text)
 FROM PUBLIC,anon,authenticated,service_role;

-- Depois de uma quitacao sintetica, o preflight 04 rejeita faturas 'pago'
-- (corretamente para uma NOVA emissao). O diario 07, porem, nao pode impedir
-- a gravacao de um ESTORNO posterior. Aqui distinguimos essas duas fases.
CREATE OR REPLACE FUNCTION public.catalogo_asaas_registrar_evento_acumulo_inerte(
 p_lote uuid,p_payment text,p_evento text,p_estado text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $evento$
DECLARE
 v_obs public.catalogo_asaas_acumulo_observacoes%ROWTYPE;
 v_exist public.catalogo_asaas_acumulo_eventos%ROWTYPE;
 v_quitacao public.catalogo_asaas_acumulo_quitacoes_isoladas%ROWTYPE;
 v_preflight jsonb;
 v_count bigint;
 v_total bigint;
 v_inconsistentes bigint;
BEGIN
 IF p_lote IS NULL OR p_payment IS NULL OR p_evento IS NULL
 OR pg_catalog.length(p_evento) NOT BETWEEN 8 AND 160
 OR p_estado IS NULL OR p_estado NOT IN (
  'PENDING','OVERDUE','CONFIRMED','RECEIVED','REFUNDED',
  'PARTIALLY_REFUNDED','REFUND_IN_PROGRESS','CHARGEBACK_REQUESTED','DELETED')
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','argumentos_invalidos'); END IF;
 SELECT * INTO v_obs FROM public.catalogo_asaas_acumulo_observacoes
 WHERE lote_id=p_lote FOR UPDATE;
 IF NOT FOUND OR v_obs.payment_id IS DISTINCT FROM p_payment
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','pagamento_nao_vinculado'); END IF;

 v_preflight:=public.catalogo_asaas_conferir_conciliacao_acumulo(p_lote);
 IF v_preflight->>'integridade_contabil_ok' IS DISTINCT FROM 'true' THEN
   -- A excecao e restrita a um lote que ja tem comprovante sintetico
   -- imutavel e fontes com saldos/competencias intactos.
   SELECT * INTO v_quitacao FROM public.catalogo_asaas_acumulo_quitacoes_isoladas
   WHERE lote_id=p_lote FOR UPDATE;
   IF NOT FOUND OR v_quitacao.payment_id IS DISTINCT FROM p_payment
   OR v_quitacao.valor_centavos IS DISTINCT FROM v_obs.valor_centavos
   THEN RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','origens_nao_conferidas'); END IF;

   SELECT pg_catalog.count(*),coalesce(pg_catalog.sum(src.valor_centavos),0),
          pg_catalog.count(*) FILTER(WHERE src.invalida)
   INTO v_count,v_total,v_inconsistentes
   FROM (
     SELECT af.valor_centavos,
       (f.id IS NULL OR f.competencia IS DISTINCT FROM af.competencia
        OR f.total_comissao_centavos IS DISTINCT FROM af.valor_centavos
        OR f.status NOT IN ('pago','vencido','bloqueado')
        OR f.comercio_id IS DISTINCT FROM lote.comercio_id
        OR (f.status='pago' AND f.referencia_pagamento IS DISTINCT FROM ref.referencia)
        OR coalesce(comp.qtd,0)=0 OR comp.total IS DISTINCT FROM af.valor_centavos
        OR EXISTS(SELECT 1 FROM public.catalogo_fatura_cobrancas b
                  WHERE b.fechamento_id=af.fechamento_id)
       ) AS invalida
     FROM public.catalogo_asaas_acumulo_fontes af
     JOIN public.catalogo_asaas_acumulo_lotes lote ON lote.id=af.lote_id
     JOIN public.catalogo_asaas_acumulo_referencias ref ON ref.lote_id=lote.id
     LEFT JOIN public.catalogo_fechamentos_offline f ON f.id=af.fechamento_id
     LEFT JOIN LATERAL (
       SELECT pg_catalog.count(*) AS qtd,
         coalesce(pg_catalog.sum(fc.valor_centavos),0) AS total
       FROM public.catalogo_fatura_componentes_v2 fc
       WHERE fc.fechamento_id=af.fechamento_id
     ) comp ON TRUE
     WHERE af.lote_id=p_lote
   ) src;
   IF v_count<2 OR v_total IS DISTINCT FROM v_quitacao.valor_centavos
     OR v_inconsistentes<>0
   THEN RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','origens_nao_conferidas'); END IF;
 END IF;

 SELECT * INTO v_exist FROM public.catalogo_asaas_acumulo_eventos
 WHERE lote_id=p_lote AND evento_externo=p_evento FOR UPDATE;
 IF FOUND THEN
   IF v_exist.payment_id IS DISTINCT FROM p_payment
    OR v_exist.estado IS DISTINCT FROM p_estado
   THEN RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','replay_divergente'); END IF;
   RETURN pg_catalog.jsonb_build_object('ok',true,'ja_observado',true,
    'evento_id',v_exist.id,'pode_quitar',false,'pode_estornar',false,
    'pode_liberar_motoboy',false);
 END IF;
 INSERT INTO public.catalogo_asaas_acumulo_eventos(lote_id,payment_id,evento_externo,estado)
 VALUES(p_lote,p_payment,p_evento,p_estado) RETURNING * INTO v_exist;
 RETURN pg_catalog.jsonb_build_object('ok',true,'ja_observado',false,
  'evento_id',v_exist.id,'pode_quitar',false,'pode_estornar',false,
  'pode_liberar_motoboy',false);
END;
$evento$;
REVOKE ALL ON FUNCTION public.catalogo_asaas_registrar_evento_acumulo_inerte(uuid,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_registrar_evento_acumulo_inerte(uuid,text,text,text)
 TO service_role;

-- NUNCA chamar INSERT neste candidato fora da fixture BEGIN/ROLLBACK.
-- Nao existe RPC publica de quitacao, estorno, criacao Pix ou saque.
COMMIT;
