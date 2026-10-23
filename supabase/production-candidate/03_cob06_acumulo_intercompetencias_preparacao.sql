-- COB-06: candidato INERTE. Nao usar como migracao produtiva.
-- PRIMEIRO gate: estrutura de vinculos + previsualizacao de saldos.
-- Nao cria pagamentos, nao concede INSERT nem cria RPC de emissao/quitacao.
-- Exige pacote minimo de 9 SQL ANTES desta preparacao.
BEGIN;

CREATE TABLE public.catalogo_asaas_acumulo_lotes (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 comercio_id text NOT NULL REFERENCES public.catalogos(comercio_id) ON DELETE RESTRICT,
 competencia_corte date NOT NULL,
 total_centavos bigint NOT NULL CHECK (total_centavos >= 500),
 estado text NOT NULL DEFAULT 'preparado'
   CHECK (estado IN ('preparado','emitido','pago','estornado','contestado','revisao')),
 criado_em timestamptz NOT NULL DEFAULT pg_catalog.now(),
 UNIQUE (comercio_id, competencia_corte),
 CONSTRAINT catalogo_acumulo_competencia_primeiro_dia
   CHECK (pg_catalog.date_part('day', competencia_corte)=1)
);

-- Uma fatura de origem nunca pode pertencer a dois lotes diferentes.
-- Nao duplicar componentes nem mudar as competencias originais.
CREATE TABLE public.catalogo_asaas_acumulo_fontes (
 fechamento_id uuid PRIMARY KEY
   REFERENCES public.catalogo_fechamentos_offline(id) ON DELETE RESTRICT,
 lote_id uuid NOT NULL
   REFERENCES public.catalogo_asaas_acumulo_lotes(id) ON DELETE RESTRICT,
 competencia date NOT NULL,
 valor_centavos integer NOT NULL CHECK (valor_centavos > 0),
 criado_em timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE INDEX catalogo_asaas_acumulo_fontes_lote_idx
 ON public.catalogo_asaas_acumulo_fontes(lote_id);

ALTER TABLE public.catalogo_asaas_acumulo_lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_asaas_acumulo_fontes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_asaas_acumulo_lotes,
 public.catalogo_asaas_acumulo_fontes FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.catalogo_asaas_acumulo_lotes,
 public.catalogo_asaas_acumulo_fontes TO service_role;

-- Apenas diagnostico de elegibilidade. NENHUMA reserva bancária.
-- Faturas com cobranca/claim existente, quitadas ou ja agrupadas nao entram.
-- A soma de componentes precisa bater exatamente com cada fechamento.
CREATE FUNCTION public.catalogo_asaas_previsualizar_acumulo(
 p_comercio text,p_competencia_corte date
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $preview$
DECLARE
 v_fontes jsonb := '[]'::jsonb;
 v_total bigint := 0;
 v_count bigint := 0;
 v_pequenas bigint := 0;
 v_inconsistentes bigint := 0;
BEGIN
 IF p_comercio IS NULL OR pg_catalog.length(p_comercio)=0
    OR pg_catalog.length(p_comercio)>180
    OR p_competencia_corte IS NULL
    OR pg_catalog.date_part('day', p_competencia_corte)<>1 THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','argumentos_invalidos');
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.catalogos
                 WHERE comercio_id=p_comercio) THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','comercio_inexistente');
 END IF;
 SELECT
   coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('fechamento_id',c.id,
        'competencia',c.competencia,'valor_centavos',c.total_comissao_centavos)
      ORDER BY c.competencia,c.id), '[]'::jsonb),
   pg_catalog.count(*),
   coalesce(pg_catalog.sum(c.total_comissao_centavos),0),
   pg_catalog.count(*) FILTER (WHERE c.total_comissao_centavos<500),
   pg_catalog.count(*) FILTER (WHERE c.componentes_count=0
                         OR c.componentes_soma<>c.total_comissao_centavos)
 INTO v_fontes,v_count,v_total,v_pequenas,v_inconsistentes
 FROM (
   SELECT f.id,f.competencia,f.total_comissao_centavos,
     (SELECT pg_catalog.count(*) FROM public.catalogo_fatura_componentes_v2 fc
       WHERE fc.fechamento_id=f.id) AS componentes_count,
     (SELECT coalesce(pg_catalog.sum(fc.valor_centavos),0)
       FROM public.catalogo_fatura_componentes_v2 fc
       WHERE fc.fechamento_id=f.id) AS componentes_soma
   FROM public.catalogo_fechamentos_offline f
   WHERE f.comercio_id=p_comercio
     AND f.competencia<=p_competencia_corte
     AND f.status IN ('faturado','vencido','bloqueado')
     AND f.total_comissao_centavos>0
     AND NOT EXISTS (SELECT 1 FROM public.catalogo_fatura_cobrancas co
                     WHERE co.fechamento_id=f.id)
     AND NOT EXISTS (SELECT 1 FROM public.catalogo_asaas_emissoes e
                     WHERE e.fechamento_id=f.id)
     AND NOT EXISTS (SELECT 1 FROM public.catalogo_asaas_acumulo_fontes af
                     WHERE af.fechamento_id=f.id)
 ) c;

 RETURN pg_catalog.jsonb_build_object(
   'ok',true,'comercio_id',p_comercio,
   'competencia_corte',p_competencia_corte,
   'total_centavos',v_total,'quantidade_faturas',v_count,
   'quantidade_abaixo_minimo',v_pequenas,
   'snapshots_inconsistentes',v_inconsistentes,
   'pronto_para_preparar',v_total>=500 AND v_count>=2
                           AND v_pequenas>0 AND v_inconsistentes=0,
   'fontes',v_fontes,
   'reserva_criada',false,'pix_emitido',false
 );
END;
$preview$;
REVOKE ALL ON FUNCTION public.catalogo_asaas_previsualizar_acumulo(text,date)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_previsualizar_acumulo(text,date)
 TO service_role;

-- A reserva do agrupamento e somente de LIVRO, nunca bancária.
-- Serializa a mesma loja, bloqueia os fechamentos, verifica snapshots
-- e testa ausencia de qualquer emissão/reserva já existente.
CREATE FUNCTION public.catalogo_asaas_reservar_acumulo(
 p_comercio text,p_competencia_corte date
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $reservar$
DECLARE
 v_lote public.catalogo_asaas_acumulo_lotes%ROWTYPE;
 v_f public.catalogo_fechamentos_offline%ROWTYPE;
 v_ids uuid[] := ARRAY[]::uuid[];
 v_valores integer[] := ARRAY[]::integer[];
 v_competencias date[] := ARRAY[]::date[];
 v_comp_count bigint;
 v_comp_total bigint;
 v_count integer := 0;
 v_menores integer := 0;
 v_total bigint := 0;
 v_i integer;
BEGIN
 IF p_comercio IS NULL OR pg_catalog.length(pg_catalog.btrim(p_comercio))=0
    OR pg_catalog.length(p_comercio)>180
    OR p_competencia_corte IS NULL
    OR pg_catalog.date_part('day',p_competencia_corte)<>1
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','argumentos_invalidos'); END IF;

 PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('catalogo-fatura:'||p_comercio,0));
 PERFORM 1 FROM public.catalogos WHERE comercio_id=p_comercio FOR UPDATE;
 IF NOT FOUND
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','comercio_inexistente'); END IF;

 SELECT * INTO v_lote
 FROM public.catalogo_asaas_acumulo_lotes
 WHERE comercio_id=p_comercio AND competencia_corte=p_competencia_corte
 FOR UPDATE;
 IF FOUND THEN
   RETURN pg_catalog.jsonb_build_object('ok',true,
      'ja_reservado',true,'lote_id',v_lote.id,'total_centavos',v_lote.total_centavos,
      'estado',v_lote.estado,'pix_emitido',false);
 END IF;

 FOR v_f IN
   SELECT f.* FROM public.catalogo_fechamentos_offline f
   WHERE f.comercio_id=p_comercio AND f.competencia<=p_competencia_corte
     AND f.status IN ('faturado','vencido','bloqueado')
     AND f.total_comissao_centavos>0
   ORDER BY f.competencia,f.id FOR UPDATE
 LOOP
   -- Com cobrança ou reserva prévia, essa origem NÃO é reaproveitada.
   IF EXISTS(SELECT 1 FROM public.catalogo_fatura_cobrancas c
             WHERE c.fechamento_id=v_f.id)
      OR EXISTS(SELECT 1 FROM public.catalogo_asaas_emissoes e
                WHERE e.fechamento_id=v_f.id)
      OR EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_fontes a
                WHERE a.fechamento_id=v_f.id)
   THEN CONTINUE; END IF;

   SELECT pg_catalog.count(*),coalesce(pg_catalog.sum(fc.valor_centavos),0)
   INTO v_comp_count,v_comp_total FROM public.catalogo_fatura_componentes_v2 fc
   WHERE fc.fechamento_id=v_f.id;

   -- Sem snapshot completo nao reservar dinheiro de origem indeterminada.
   IF v_comp_count=0 OR v_comp_total IS DISTINCT FROM v_f.total_comissao_centavos
   THEN RETURN pg_catalog.jsonb_build_object('ok',false,
      'motivo','snapshot_inconsistente','competencia',v_f.competencia); END IF;

   v_ids:=pg_catalog.array_append(v_ids,v_f.id);
   v_valores:=pg_catalog.array_append(v_valores,v_f.total_comissao_centavos);
   v_competencias:=pg_catalog.array_append(v_competencias,v_f.competencia);
   v_count:=v_count+1;
   IF v_f.total_comissao_centavos<500 THEN v_menores:=v_menores+1; END IF;
   v_total:=v_total+v_f.total_comissao_centavos;
   IF v_count>120 OR v_total>2147483647
   THEN RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','limite_de_lote'); END IF;
 END LOOP;

 IF v_total<500 OR v_count<2 OR v_menores=0
 THEN RETURN pg_catalog.jsonb_build_object('ok',false,
    'motivo','minimo_ou_fontes_insuficientes',
    'total_centavos',v_total,'quantidade_faturas',v_count); END IF;

 INSERT INTO public.catalogo_asaas_acumulo_lotes
   (comercio_id,competencia_corte,total_centavos)
 VALUES(p_comercio,p_competencia_corte,v_total)
 RETURNING * INTO v_lote;

 FOR v_i IN 1..v_count LOOP
   INSERT INTO public.catalogo_asaas_acumulo_fontes
     (fechamento_id,lote_id,competencia,valor_centavos)
   VALUES(v_ids[v_i],v_lote.id,v_competencias[v_i],v_valores[v_i]);
 END LOOP;

 RETURN pg_catalog.jsonb_build_object('ok',true,'ja_reservado',false,
   'lote_id',v_lote.id,'total_centavos',v_lote.total_centavos,
   'quantidade_faturas',v_count,'estado','preparado',
   'pix_emitido',false);
END;
$reservar$;
REVOKE ALL ON FUNCTION public.catalogo_asaas_reservar_acumulo(text,date)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_reservar_acumulo(text,date)
 TO service_role;

-- Não permitir que o fluxo antigo de uma única competência emita cobrança
-- quando essa origem já foi reservada por um lote: vale para INSERT direto
-- e para o journal existente de emissões, sem reescrever a Edge atual.
CREATE FUNCTION catalogo_private.catalogo_asaas_acumulo_guard_emissao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $guard$
BEGIN
 PERFORM 1 FROM public.catalogo_fechamentos_offline
 WHERE id=NEW.fechamento_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_fontes a
           WHERE a.fechamento_id=NEW.fechamento_id)
 THEN RAISE EXCEPTION 'Fonte reservada em agrupamento: emissao individual negada'
   USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_acumulo_guard_emissao()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER catalogo_asaas_acumulo_sem_emissao_individual
 BEFORE INSERT ON public.catalogo_asaas_emissoes
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_acumulo_guard_emissao();
CREATE TRIGGER catalogo_asaas_acumulo_sem_cobranca_individual
 BEFORE INSERT ON public.catalogo_fatura_cobrancas
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_acumulo_guard_emissao();

-- Evitar que o fechamento ou seus componentes sejam alterados depois
-- de reservado; o conciliador multi-competência precisará ser auditado
-- antes de receber direito de mudar qualquer estado financeiro.
CREATE FUNCTION catalogo_private.catalogo_asaas_acumulo_guard_fechamento()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $guard$
BEGIN
 IF (NEW.total_comissao_centavos IS DISTINCT FROM OLD.total_comissao_centavos
     OR NEW.competencia IS DISTINCT FROM OLD.competencia
     OR NEW.comercio_id IS DISTINCT FROM OLD.comercio_id)
   AND EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_fontes a
              WHERE a.fechamento_id=OLD.id)
 THEN RAISE EXCEPTION 'Fechamento reservado: alteracao de valores negada'
  USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_acumulo_guard_fechamento()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER catalogo_asaas_acumulo_fechamento_imutavel
 BEFORE UPDATE ON public.catalogo_fechamentos_offline
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_acumulo_guard_fechamento();

CREATE FUNCTION catalogo_private.catalogo_asaas_acumulo_guard_componentes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $guard$
DECLARE v_origem uuid; v_destino uuid;
BEGIN
 IF TG_OP='INSERT' THEN
   v_destino:=NEW.fechamento_id;
 ELSIF TG_OP='DELETE' THEN
   v_origem:=OLD.fechamento_id;
 ELSE
   v_origem:=OLD.fechamento_id;
   v_destino:=NEW.fechamento_id;
 END IF;
 -- Coordenar com a reserva, inclusive UPDATE/DELETE de snapshots já lidos.
 PERFORM 1 FROM public.catalogo_fechamentos_offline
 WHERE id=v_origem OR id=v_destino
 ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.catalogo_asaas_acumulo_fontes a
           WHERE a.fechamento_id=v_origem OR a.fechamento_id=v_destino)
 THEN RAISE EXCEPTION 'Componentes de fechamento reservado nao podem mudar'
  USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_acumulo_guard_componentes()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER catalogo_asaas_acumulo_componentes_imutaveis
 BEFORE INSERT OR UPDATE OR DELETE ON public.catalogo_fatura_componentes_v2
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_acumulo_guard_componentes();

-- Ponto final desta entrega: reserva local do livro, sem ligações com API
-- Asaas, webhook, settlement, dinheiro ou credito de motoboy.
COMMIT;
