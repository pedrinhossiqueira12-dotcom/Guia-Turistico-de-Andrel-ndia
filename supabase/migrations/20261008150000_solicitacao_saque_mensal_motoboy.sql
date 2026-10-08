-- Solicitação de repasse de remuneração já financiada, pelo próprio motoboy.
-- NÃO executa Pix ou reconhece pagamentos não comprovados.
BEGIN;
CREATE TABLE public.catalogo_solicitacoes_saque_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  motoboy_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  mes_referencia date NOT NULL,
  valor_centavos bigint NOT NULL CHECK (valor_centavos > 0),
  status text NOT NULL DEFAULT 'solicitado' CHECK (status IN ('solicitado','em_analise','pago','recusado','cancelado')),
  solicitado_em timestamptz NOT NULL DEFAULT now(),
  resolvido_em timestamptz,
  repasse_id uuid REFERENCES public.catalogo_repasses_v2(id) ON DELETE RESTRICT,
  observacao text,
  UNIQUE (motoboy_id,mes_referencia)
);
CREATE TABLE public.catalogo_solicitacao_saque_itens_v2 (
  solicitacao_id uuid NOT NULL REFERENCES public.catalogo_solicitacoes_saque_v2(id) ON DELETE RESTRICT,
  remuneracao_id uuid NOT NULL REFERENCES public.catalogo_remuneracoes_v2(id) ON DELETE RESTRICT,
  valor_centavos integer NOT NULL CHECK (valor_centavos > 0),
  PRIMARY KEY (solicitacao_id,remuneracao_id),
  UNIQUE (remuneracao_id)
);
CREATE INDEX catalogo_solicitacoes_saque_v2_fila_idx ON public.catalogo_solicitacoes_saque_v2(status,solicitado_em);
ALTER TABLE public.catalogo_solicitacoes_saque_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_solicitacao_saque_itens_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_solicitacoes_saque_v2, public.catalogo_solicitacao_saque_itens_v2 FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.catalogo_solicitacoes_saque_v2, public.catalogo_solicitacao_saque_itens_v2 TO service_role;

-- A RPC só é chamada via Edge autenticada que determina a identidade pelo JWT.
-- A elegibilidade vem sempre dos créditos efetivamente financiados no servidor.
CREATE FUNCTION public.catalogo_motoboy_saque_mensal_v2(p_operador_id uuid, p_acao text DEFAULT 'listar')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_mes date;
DECLARE v_total bigint;
DECLARE v_itens integer;
DECLARE v_request uuid;
DECLARE v_historico jsonb;
BEGIN
  IF p_operador_id IS NULL OR NOT catalogo_private.catalogo_v2_autorizado(p_operador_id) THEN
    RETURN jsonb_build_object('ok',false,'http_status',403,'mensagem','Motoboy não autorizado.');
  END IF;
  IF p_acao NOT IN ('listar','solicitar') THEN
    RETURN jsonb_build_object('ok',false,'http_status',400,'mensagem','Ação inválida.');
  END IF;
  -- Somente mês calendário anterior; o mês em curso jamais é sacável.
  v_mes := (date_trunc('month',pg_catalog.now()) - interval '1 month')::date;
  IF p_acao='solicitar' THEN
    IF NOT EXISTS (SELECT 1 FROM public.catalogo_motoboy_perfis pf
                   WHERE pf.usuario_id=p_operador_id AND pf.chave_pix_enc IS NOT NULL) THEN
      RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Cadastre sua chave Pix antes de solicitar o saque.');
    END IF;
    -- Serializa duas solicitações simultâneas da mesma conta.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operador_id::text,20261008));
    IF EXISTS (SELECT 1 FROM public.catalogo_solicitacoes_saque_v2
               WHERE motoboy_id=p_operador_id AND mes_referencia=v_mes) THEN
      RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','O saque deste mês já foi solicitado.');
    END IF;
    -- Bloqueia alterações concorrentes nos créditos enquanto compõe a lista.
    PERFORM 1 FROM public.catalogo_remuneracoes_v2 r
      WHERE r.motoboy_id=p_operador_id AND r.criado_em>=v_mes
        AND r.criado_em<v_mes+interval '1 month'
      ORDER BY r.id FOR UPDATE;
    SELECT coalesce(sum(r.valor_centavos),0),count(*) INTO v_total,v_itens
      FROM public.catalogo_remuneracoes_v2 r
      WHERE r.motoboy_id=p_operador_id AND r.criado_em>=v_mes
        AND r.criado_em<v_mes+interval '1 month'
        AND r.status='disponivel' AND r.financiamento_comprovado
        AND r.repasse_id IS NULL AND catalogo_private.catalogo_v2_financiado(r.pedido_id)
        AND NOT EXISTS (SELECT 1 FROM public.catalogo_solicitacao_saque_itens_v2 i WHERE i.remuneracao_id=r.id);
    IF v_itens=0 OR v_total<=0 THEN
      RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Sem créditos liberados e financiados para o mês anterior.');
    END IF;
    INSERT INTO public.catalogo_solicitacoes_saque_v2(motoboy_id,mes_referencia,valor_centavos)
      VALUES(p_operador_id,v_mes,v_total) RETURNING id INTO v_request;
    INSERT INTO public.catalogo_solicitacao_saque_itens_v2(solicitacao_id,remuneracao_id,valor_centavos)
      SELECT v_request,r.id,r.valor_centavos FROM public.catalogo_remuneracoes_v2 r
      WHERE r.motoboy_id=p_operador_id AND r.criado_em>=v_mes
        AND r.criado_em<v_mes+interval '1 month'
        AND r.status='disponivel' AND r.financiamento_comprovado
        AND r.repasse_id IS NULL AND catalogo_private.catalogo_v2_financiado(r.pedido_id)
        AND NOT EXISTS (SELECT 1 FROM public.catalogo_solicitacao_saque_itens_v2 i WHERE i.remuneracao_id=r.id);
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'mes_referencia',s.mes_referencia,
    'valor_centavos',s.valor_centavos,'status',s.status,'solicitado_em',s.solicitado_em)
    ORDER BY s.solicitado_em DESC),'[]'::jsonb) INTO v_historico
    FROM (SELECT * FROM public.catalogo_solicitacoes_saque_v2
      WHERE motoboy_id=p_operador_id ORDER BY solicitado_em DESC LIMIT 24) s;
  RETURN jsonb_build_object('ok',true,'mes_elegivel',v_mes,'solicitacao_id',v_request,
    'valor_solicitado_centavos',v_total,'solicitacoes',v_historico,'transferencia_executada',false);
END;
$$;
REVOKE ALL ON FUNCTION public.catalogo_motoboy_saque_mensal_v2(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_motoboy_saque_mensal_v2(uuid,text) TO service_role;
-- O repasse administrativo existente é o ÚNICO ponto que comprova um pagamento.
-- A solicitação acompanha o status sem jamais executar transferência.
CREATE FUNCTION public.catalogo_conciliar_solicitacao_saque_v2()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_solicitacao uuid;
BEGIN
  IF NEW.status='pago' AND NEW.repasse_id IS NOT NULL
     AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.repasse_id IS DISTINCT FROM NEW.repasse_id) THEN
    FOR v_solicitacao IN SELECT DISTINCT i.solicitacao_id
      FROM public.catalogo_solicitacao_saque_itens_v2 i
      WHERE i.remuneracao_id=NEW.id LOOP
      -- Todos os créditos da solicitação devem estar pagos e apontar ao
      -- MESMO repasse real; do contrário há pendência para revisão manual.
      UPDATE public.catalogo_solicitacoes_saque_v2 s
         SET status='pago', repasse_id=NEW.repasse_id, resolvido_em=pg_catalog.now()
       WHERE s.id=v_solicitacao AND s.status IN ('solicitado','em_analise')
         AND NOT EXISTS (
           SELECT 1 FROM public.catalogo_solicitacao_saque_itens_v2 i
           JOIN public.catalogo_remuneracoes_v2 r ON r.id=i.remuneracao_id
           WHERE i.solicitacao_id=s.id AND
             (r.status<>'pago' OR r.repasse_id IS DISTINCT FROM NEW.repasse_id)
         );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER catalogo_conciliar_solicitacao_saque_v2
AFTER UPDATE OF status,repasse_id ON public.catalogo_remuneracoes_v2
FOR EACH ROW EXECUTE FUNCTION public.catalogo_conciliar_solicitacao_saque_v2();
REVOKE ALL ON FUNCTION public.catalogo_conciliar_solicitacao_saque_v2() FROM PUBLIC,anon,authenticated;
COMMIT;
