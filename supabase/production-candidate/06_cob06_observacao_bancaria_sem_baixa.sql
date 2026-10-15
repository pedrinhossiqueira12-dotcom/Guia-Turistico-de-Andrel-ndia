-- COB-06/PR39: observacao de pagamento remoto, INERTE e auditavel.
-- Aplicar SOMENTE em catalogo_cob06_ci descartavel apos candidatos 03/04/05.
-- A prova de GET remoto e de identidade deve ser gerada no backend confiavel
-- (modulo _shared), nunca no navegador. Este SQL valida consistencia local;
-- NAO prova sozinho autenticidade bancaria de parametros fornecidos.
-- Nao gera Pix, nao concede baixa, estorno, saque ou remuneracao.
BEGIN;

CREATE TABLE public.catalogo_asaas_acumulo_observacoes (
 lote_id uuid PRIMARY KEY REFERENCES public.catalogo_asaas_acumulo_referencias(lote_id) ON DELETE RESTRICT,
 payment_id text NOT NULL UNIQUE,
 customer_id text NOT NULL,
 referencia text NOT NULL,
 valor_centavos bigint NOT NULL CHECK(valor_centavos>=500 AND valor_centavos<=2147483647),
 status_primeira_observacao text NOT NULL
   CHECK(status_primeira_observacao IN ('PENDING','OVERDUE','CONFIRMED','RECEIVED',
     'REFUNDED','PARTIALLY_REFUNDED','REFUND_IN_PROGRESS','CHARGEBACK_REQUESTED','DELETED')),
 criado_em timestamptz NOT NULL DEFAULT pg_catalog.now(),
 pode_quitar boolean NOT NULL DEFAULT false CHECK(pode_quitar=false),
 pode_liberar_motoboy boolean NOT NULL DEFAULT false CHECK(pode_liberar_motoboy=false)
);
ALTER TABLE public.catalogo_asaas_acumulo_observacoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_asaas_acumulo_observacoes
 FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.catalogo_asaas_acumulo_observacoes TO service_role;

-- A primeira prova permanece imutavel. Mudanca futura de status do Asaas
-- exigira novo registro de evento verificado e reconciliador separado.
CREATE FUNCTION catalogo_private.catalogo_asaas_acumulo_observacao_imutavel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $imutavel$
BEGIN
 RAISE EXCEPTION 'Observacao bancaria de lote imutavel: reconciliar eventos'
 USING ERRCODE='23514';
END;
$imutavel$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_acumulo_observacao_imutavel()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER catalogo_asaas_acumulo_observacao_nao_alterar
 BEFORE UPDATE OR DELETE ON public.catalogo_asaas_acumulo_observacoes
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_acumulo_observacao_imutavel();

CREATE FUNCTION public.catalogo_asaas_registrar_observacao_acumulo(
 p_lote uuid,p_payment text,p_customer text,p_referencia text,
 p_valor bigint,p_status text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $observar$
DECLARE
 v_r public.catalogo_asaas_acumulo_referencias%ROWTYPE;
 v_existente public.catalogo_asaas_acumulo_observacoes%ROWTYPE;
 v_cliente text;
 v_ok jsonb;
BEGIN
 IF p_lote IS NULL
 OR p_payment IS NULL OR p_payment !~ '^pay_[A-Za-z0-9_-]{5,120}$'
 OR p_customer IS NULL OR p_customer !~ '^cus_[A-Za-z0-9_-]{3,120}$'
 OR p_referencia IS NULL
 OR p_valor IS NULL OR p_valor<500 OR p_valor>2147483647
 OR p_status IS NULL OR p_status NOT IN
    ('PENDING','OVERDUE','CONFIRMED','RECEIVED','REFUNDED',
     'PARTIALLY_REFUNDED','REFUND_IN_PROGRESS','CHARGEBACK_REQUESTED','DELETED')
 THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','evidencia_invalida');
 END IF;
 SELECT * INTO v_r FROM public.catalogo_asaas_acumulo_referencias
 WHERE lote_id=p_lote FOR UPDATE;
 IF NOT FOUND THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','referencia_nao_reservada');
 END IF;
 IF v_r.referencia IS DISTINCT FROM p_referencia
 OR v_r.valor_centavos IS DISTINCT FROM p_valor
 OR v_r.estado IS DISTINCT FROM 'reservado'
 OR v_r.payment_id IS NOT NULL OR v_r.pode_emitir_pix IS DISTINCT FROM false
 THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','referencia_ou_valor_divergente');
 END IF;

 SELECT cliente_id INTO v_cliente FROM public.catalogo_asaas_clientes
 WHERE comercio_id=v_r.comercio_id;
 IF v_cliente IS NULL OR v_cliente IS DISTINCT FROM p_customer THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','cliente_divergente');
 END IF;

 v_ok:=public.catalogo_asaas_conferir_conciliacao_acumulo(p_lote);
 IF v_ok->>'integridade_contabil_ok' IS DISTINCT FROM 'true'
 OR (v_ok->>'valor_fontes_centavos')::bigint IS DISTINCT FROM v_r.valor_centavos
 THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','origem_divergente');
 END IF;

 SELECT * INTO v_existente FROM public.catalogo_asaas_acumulo_observacoes
 WHERE lote_id=p_lote FOR UPDATE;
 IF FOUND THEN
   IF v_existente.payment_id IS DISTINCT FROM p_payment
   OR v_existente.customer_id IS DISTINCT FROM p_customer
   OR v_existente.referencia IS DISTINCT FROM p_referencia
   OR v_existente.valor_centavos IS DISTINCT FROM p_valor
   OR v_existente.status_primeira_observacao IS DISTINCT FROM p_status
   THEN
     RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','observacao_existente_divergente');
   END IF;
   RETURN pg_catalog.jsonb_build_object('ok',true,'ja_observado',true,
     'lote_id',p_lote,'payment_id',v_existente.payment_id,
     'status_observado',v_existente.status_primeira_observacao,
     'pode_quitar',false,'pode_liberar_motoboy',false);
 END IF;

 -- UNIQUE(payment_id) impede associar o MESMO pagamento a dois lotes.
 -- Uma colisao concorrente aborta a operacao em vez de fazer UPSERT.
 INSERT INTO public.catalogo_asaas_acumulo_observacoes(
   lote_id,payment_id,customer_id,referencia,valor_centavos,status_primeira_observacao)
 VALUES(p_lote,p_payment,p_customer,p_referencia,p_valor,p_status);

 RETURN pg_catalog.jsonb_build_object('ok',true,'ja_observado',false,
   'lote_id',p_lote,'payment_id',p_payment,'status_observado',p_status,
   'pode_quitar',false,'pode_liberar_motoboy',false);
END;
$observar$;
REVOKE ALL ON FUNCTION public.catalogo_asaas_registrar_observacao_acumulo(uuid,text,text,text,bigint,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_registrar_observacao_acumulo(uuid,text,text,text,bigint,text)
 TO service_role;
COMMIT;
