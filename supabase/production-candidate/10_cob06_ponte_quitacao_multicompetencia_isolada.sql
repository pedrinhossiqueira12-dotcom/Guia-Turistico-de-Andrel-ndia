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
         AND e.estado IN ('REFUNDED','PARTIALLY_REFUNDED','REFUND_IN_PROGRESS','DELETED')
     ) THEN RAISE EXCEPTION 'Estorno nao observado' USING ERRCODE='23514'; END IF;
   IF NEW.estado='contestado' AND NOT EXISTS (
       SELECT 1 FROM public.catalogo_asaas_acumulo_eventos e
        WHERE e.lote_id=OLD.lote_id AND e.payment_id=OLD.payment_id
         AND e.estado='CHARGEBACK_REQUESTED'
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

-- NUNCA chamar INSERT neste candidato fora da fixture BEGIN/ROLLBACK.
-- Nao existe RPC publica de quitacao, estorno, criacao Pix ou saque.
COMMIT;
