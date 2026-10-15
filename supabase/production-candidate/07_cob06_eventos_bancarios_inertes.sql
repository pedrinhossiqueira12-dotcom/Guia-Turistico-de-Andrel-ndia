-- COB-06: diario append-only de estados observados por GET bancario verificado.
-- CANDIDATO somente para clone descartavel. Nao concilia, quita ou faz Pix.
-- A procedencia do GET deve ser demonstrada por backend autenticado; SQL nao
-- consegue autenticar argumentos arbitrarios apresentados como resposta Asaas.
BEGIN;
CREATE TABLE public.catalogo_asaas_acumulo_eventos (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 lote_id uuid NOT NULL REFERENCES public.catalogo_asaas_acumulo_observacoes(lote_id) ON DELETE RESTRICT,
 payment_id text NOT NULL,
 evento_externo text NOT NULL CHECK (length(evento_externo) BETWEEN 8 AND 160),
 estado text NOT NULL CHECK (estado IN (
  'PENDING','OVERDUE','CONFIRMED','RECEIVED','REFUNDED',
  'PARTIALLY_REFUNDED','REFUND_IN_PROGRESS','CHARGEBACK_REQUESTED','DELETED')),
 observado_em timestamptz NOT NULL DEFAULT now(),
 pode_quitar boolean NOT NULL DEFAULT false CHECK (pode_quitar=false),
 pode_estornar boolean NOT NULL DEFAULT false CHECK (pode_estornar=false),
 pode_liberar_motoboy boolean NOT NULL DEFAULT false CHECK (pode_liberar_motoboy=false),
 UNIQUE (evento_externo)
);
CREATE INDEX catalogo_asaas_acumulo_eventos_lote_ordem
 ON public.catalogo_asaas_acumulo_eventos(lote_id,id);
ALTER TABLE public.catalogo_asaas_acumulo_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_asaas_acumulo_eventos FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.catalogo_asaas_acumulo_eventos TO service_role;
CREATE TRIGGER catalogo_asaas_acumulo_eventos_imutaveis
 BEFORE UPDATE OR DELETE ON public.catalogo_asaas_acumulo_eventos
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_acumulo_observacao_imutavel();

CREATE FUNCTION public.catalogo_asaas_registrar_evento_acumulo_inerte(
 p_lote uuid,p_payment text,p_evento text,p_estado text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_obs public.catalogo_asaas_acumulo_observacoes%ROWTYPE;
 v_exist public.catalogo_asaas_acumulo_eventos%ROWTYPE;
 v_preflight jsonb;
BEGIN
 IF p_lote IS NULL OR p_payment IS NULL OR p_evento IS NULL
 OR length(p_evento) NOT BETWEEN 8 AND 160
 OR p_estado IS NULL OR p_estado NOT IN (
  'PENDING','OVERDUE','CONFIRMED','RECEIVED','REFUNDED',
  'PARTIALLY_REFUNDED','REFUND_IN_PROGRESS','CHARGEBACK_REQUESTED','DELETED')
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','argumentos_invalidos'); END IF;
 SELECT * INTO v_obs FROM public.catalogo_asaas_acumulo_observacoes
 WHERE lote_id=p_lote FOR UPDATE;
 IF NOT FOUND OR v_obs.payment_id IS DISTINCT FROM p_payment
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','pagamento_nao_vinculado'); END IF;
 -- Continuar falhando fechado se os componentes financeiros mudarem.
 v_preflight:=public.catalogo_asaas_conferir_conciliacao_acumulo(p_lote);
 IF v_preflight->>'integridade_contabil_ok' IS DISTINCT FROM 'true'
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','origens_nao_conferidas'); END IF;
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
$fn$;
REVOKE ALL ON FUNCTION public.catalogo_asaas_registrar_evento_acumulo_inerte(uuid,text,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_registrar_evento_acumulo_inerte(uuid,text,text,text)
 TO service_role;
COMMIT;
