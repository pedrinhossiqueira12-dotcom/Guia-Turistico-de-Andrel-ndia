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
  IF p_acao IS NULL OR p_acao NOT IN ('listar','solicitar') THEN
    RETURN jsonb_build_object('ok',false,'http_status',400,'mensagem','Ação inválida.');
  END IF;
  -- Competência de fechamento: inclui créditos de meses já encerrados que
  -- ficaram disponíveis tardiamente, mas nunca os do mês em curso.
  -- Créditos já vinculados a outras solicitações não entram novamente.
  -- O corte do mês respeita America/Sao_Paulo, não o fuso UTC do banco.
  v_mes := (date_trunc('month',pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo') - interval '1 month')::date;
  IF p_acao='solicitar' THEN
    IF NOT EXISTS (SELECT 1 FROM public.catalogo_motoboy_perfis pf
                   WHERE pf.usuario_id=p_operador_id AND pf.chave_pix_enc IS NOT NULL
                     AND pf.chave_pix_tipo IS NOT NULL) THEN
      RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Cadastre sua chave Pix e selecione seu tipo antes de solicitar o saque.');
    END IF;
    -- Serializa duas solicitações simultâneas da mesma conta.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operador_id::text,20261008));
    IF EXISTS (SELECT 1 FROM public.catalogo_solicitacoes_saque_v2
               WHERE motoboy_id=p_operador_id AND mes_referencia=v_mes) THEN
      RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','O saque deste mês já foi solicitado.');
    END IF;
    -- Bloqueia alterações concorrentes nos créditos enquanto compõe a lista.
    PERFORM 1 FROM public.catalogo_remuneracoes_v2 r
      WHERE r.motoboy_id=p_operador_id
        AND r.criado_em<((v_mes+interval '1 month') AT TIME ZONE 'America/Sao_Paulo')
      ORDER BY r.id FOR UPDATE;
    SELECT coalesce(sum(r.valor_centavos),0),count(*) INTO v_total,v_itens
      FROM public.catalogo_remuneracoes_v2 r
      WHERE r.motoboy_id=p_operador_id
        AND r.criado_em<((v_mes+interval '1 month') AT TIME ZONE 'America/Sao_Paulo')
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
      WHERE r.motoboy_id=p_operador_id
        AND r.criado_em<((v_mes+interval '1 month') AT TIME ZONE 'America/Sao_Paulo')
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
      -- A operação atual pode efetuar comprovantes separados para cada
      -- entrega. A solicitação mensal só é paga quando TODOS os seus
      -- créditos têm comprovante de repasse real, sem exigir o mesmo lote.
      UPDATE public.catalogo_solicitacoes_saque_v2 s
         SET status='pago',
             repasse_id=(SELECT CASE WHEN count(DISTINCT r.repasse_id)=1
                            THEN (array_agg(DISTINCT r.repasse_id))[1] ELSE NULL END
                          FROM public.catalogo_solicitacao_saque_itens_v2 i
                          JOIN public.catalogo_remuneracoes_v2 r ON r.id=i.remuneracao_id
                          WHERE i.solicitacao_id=s.id),
             resolvido_em=pg_catalog.now()
       WHERE s.id=v_solicitacao AND s.status IN ('solicitado','em_analise')
         AND NOT EXISTS (
           SELECT 1 FROM public.catalogo_solicitacao_saque_itens_v2 i
           JOIN public.catalogo_remuneracoes_v2 r ON r.id=i.remuneracao_id
           WHERE i.solicitacao_id=s.id
             AND (r.status<>'pago' OR r.repasse_id IS NULL)
         );
    END LOOP;
  END IF;
  -- Estorno ou perda de financiamento após o pedido de saque não pode
  -- resultar em pagamento automático nem em fila marcada como apta.
  IF NEW.status IN ('estornado','retido','pendencia_revisao') AND
     OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.catalogo_solicitacoes_saque_v2 s
       SET status='em_analise', observacao='Crédito bloqueado ou revertido após a solicitação'
     WHERE s.status='solicitado' AND EXISTS (
       SELECT 1 FROM public.catalogo_solicitacao_saque_itens_v2 i
        WHERE i.solicitacao_id=s.id AND i.remuneracao_id=NEW.id
     );
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER catalogo_conciliar_solicitacao_saque_v2
AFTER UPDATE OF status,repasse_id ON public.catalogo_remuneracoes_v2
FOR EACH ROW EXECUTE FUNCTION public.catalogo_conciliar_solicitacao_saque_v2();
REVOKE ALL ON FUNCTION public.catalogo_conciliar_solicitacao_saque_v2() FROM PUBLIC,anon,authenticated;

-- ETAPA 3C: tipo de chave Pix verificado de forma explícita.
-- Chaves já cadastradas continuam cifradas e com tipo NULL até novo cadastro.
ALTER TABLE public.catalogo_motoboy_perfis
  ADD COLUMN chave_pix_tipo text NULL
  CHECK (chave_pix_tipo IS NULL OR
    chave_pix_tipo IN ('EMAIL','PHONE','CPF','CNPJ','PIX_CODE'));
CREATE INDEX catalogo_motoboy_perfis_pix_tipado_idx
  ON public.catalogo_motoboy_perfis(usuario_id) WHERE chave_pix_tipo IS NOT NULL;

-- Bloqueia edição/remoção de chave enquanto há dinheiro reservado, enviado,
-- com resultado incerto ou aguardando análise; não guarda chave em claro.
CREATE FUNCTION public.catalogo_bloquear_pix_pendente_v2()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $pix_guard$
BEGIN
  IF (NEW.chave_pix_enc IS DISTINCT FROM OLD.chave_pix_enc OR
      NEW.chave_pix_tipo IS DISTINCT FROM OLD.chave_pix_tipo) THEN
    IF EXISTS (SELECT 1 FROM public.catalogo_payout_intents_v2 p
       WHERE p.motoboy_id=NEW.usuario_id
         AND p.status IN ('reservado','em_envio','aguardando_confirmacao','em_analise')) THEN
      RAISE EXCEPTION 'Chave Pix bloqueada durante saque pendente. Procure o suporte.';
    END IF;
    IF (NEW.chave_pix_enc IS NULL) IS DISTINCT FROM (NEW.chave_pix_tipo IS NULL) THEN
      RAISE EXCEPTION 'Tipo Pix e chave protegida devem ser salvos juntos.';
    END IF;
  END IF;
  RETURN NEW;
END;
$pix_guard$;
-- A trigger é criada DEPOIS da tabela de intents; ver seção abaixo.
REVOKE ALL ON FUNCTION public.catalogo_bloquear_pix_pendente_v2()
  FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.catalogo_salvar_chave_pix_tipado_v2(
  p_operador_id uuid, p_chave_pix_enc text, p_chave_pix_tipo text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $pix_save$
BEGIN
  IF p_operador_id IS NULL OR
     NOT catalogo_private.catalogo_v2_autorizado(p_operador_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',403,
      'mensagem','Motoboy não autorizado.');
  END IF;
  IF (p_chave_pix_enc IS NULL) IS DISTINCT FROM (p_chave_pix_tipo IS NULL)
     OR (p_chave_pix_enc IS NOT NULL AND (
       p_chave_pix_enc !~ '^pix-v2:[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}
-- Uma única intenção por solicitação; retries devem usar SEMPRE o mesmo ID.
CREATE TABLE public.catalogo_payout_intents_v2 (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  solicitacao_id uuid NOT NULL UNIQUE
    REFERENCES public.catalogo_solicitacoes_saque_v2(id) ON DELETE RESTRICT,
  motoboy_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  valor_centavos bigint NOT NULL CHECK (valor_centavos >= 100),
  moeda text NOT NULL DEFAULT 'BRL' CHECK (moeda = 'BRL'),
  pix_tipo text NOT NULL CHECK (pix_tipo IN ('EMAIL','PHONE','CPF','CNPJ','PIX_CODE')),
  chave_pix_enc_snapshot text NOT NULL
    CHECK (chave_pix_enc_snapshot ~ '^pix-v2:[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$'),
  idempotency_key uuid NOT NULL UNIQUE,
  referencia_externa text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'reservado'
    CHECK (status IN ('reservado','em_envio','aguardando_confirmacao','em_analise','confirmado','cancelado')),
  payout_id text UNIQUE,
  transacao_id text UNIQUE,
  repasse_id uuid UNIQUE REFERENCES public.catalogo_repasses_v2(id) ON DELETE RESTRICT,
  ultima_consulta_em timestamptz,
  confirmado_em timestamptz,
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  reservado_em timestamptz NOT NULL DEFAULT pg_catalog.now(),
  primeira_tentativa_em timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT pg_catalog.now(),
  revisao_motivo text CHECK (revisao_motivo IS NULL OR pg_catalog.char_length(revisao_motivo) <= 500),
  CHECK (
    (payout_id IS NULL AND transacao_id IS NULL)
    OR (payout_id IS NOT NULL AND transacao_id IS NOT NULL)
  )
);
CREATE INDEX catalogo_payout_intents_v2_estado_idx
  ON public.catalogo_payout_intents_v2(status,reservado_em);

-- Registros da confirmação real via provedor não devem falsificar autoria humana.
ALTER TABLE public.catalogo_repasses_v2
  ADD COLUMN origem_registro text NOT NULL DEFAULT 'admin_manual';
ALTER TABLE public.catalogo_repasses_v2 ALTER COLUMN registrado_por DROP NOT NULL;
ALTER TABLE public.catalogo_repasses_v2 ADD CONSTRAINT catalogo_repasses_origem_v2_check
  CHECK ((origem_registro='admin_manual' AND registrado_por IS NOT NULL)
      OR (origem_registro='payout_provedor' AND registrado_por IS NULL));

CREATE TRIGGER catalogo_bloquear_pix_pendente_v2
BEFORE UPDATE OF chave_pix_enc,chave_pix_tipo ON public.catalogo_motoboy_perfis
FOR EACH ROW EXECUTE FUNCTION public.catalogo_bloquear_pix_pendente_v2();

ALTER TABLE public.catalogo_payout_intents_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_payout_intents_v2 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.catalogo_payout_intents_v2 TO service_role;

-- Chamada exclusiva de backend confiável com chave service_role.
-- O chamador deve decifrar/validar a chave Pix e o tipo antes de iniciar o envio.
-- Não utiliza dados financeiros fornecidos pelo navegador.
CREATE FUNCTION public.catalogo_reservar_payout_v2(
  p_solicitacao_id uuid, p_pix_tipo text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $payout_reserva$
DECLARE
  v_s public.catalogo_solicitacoes_saque_v2%ROWTYPE;
  v_perfil public.catalogo_motoboy_perfis%ROWTYPE;
  v_p public.catalogo_payout_intents_v2%ROWTYPE;
  v_valor bigint;
  v_count bigint;
  v_validos bigint;
BEGIN
  IF p_solicitacao_id IS NULL OR p_pix_tipo IS NULL OR
      p_pix_tipo NOT IN ('EMAIL','PHONE','CPF','CNPJ','PIX_CODE') THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',400,'mensagem','Solicitação ou tipo Pix inválido.');
  END IF;
  SELECT * INTO v_s FROM public.catalogo_solicitacoes_saque_v2
    WHERE id=p_solicitacao_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',404,'mensagem','Solicitação não encontrada.');
  END IF;
  -- A mesma reserva e as mesmas referências serão devolvidas em retries.
  SELECT * INTO v_p FROM public.catalogo_payout_intents_v2
    WHERE solicitacao_id=p_solicitacao_id FOR UPDATE;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok',true,'idempotente',true,
      'intent_id',v_p.id,'idempotency_key',v_p.idempotency_key,
      'valor_centavos',v_p.valor_centavos,'estado',v_p.status,
      'reenviar_permitido',false);
  END IF;
  IF v_s.status <> 'solicitado' OR v_s.valor_centavos < 100 THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',409,
      'mensagem','Solicitação indisponível ou abaixo do mínimo Pix de R$ 1,00.');
  END IF;
  SELECT * INTO v_perfil FROM public.catalogo_motoboy_perfis
    WHERE usuario_id=v_s.motoboy_id FOR UPDATE;
  IF NOT FOUND OR v_perfil.chave_pix_enc IS NULL OR
      v_perfil.chave_pix_tipo IS DISTINCT FROM p_pix_tipo OR NOT v_perfil.apto OR
      v_perfil.em_analise THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',409,
      'mensagem','Perfil não apto ou chave Pix indisponível.');
  END IF;
  -- A trava evita o pagamento manual concorrente e congela o lastro.
  PERFORM 1 FROM public.catalogo_remuneracoes_v2 r
    JOIN public.catalogo_solicitacao_saque_itens_v2 i ON i.remuneracao_id=r.id
    WHERE i.solicitacao_id=p_solicitacao_id ORDER BY r.id FOR UPDATE OF r;
  SELECT count(*),coalesce(sum(i.valor_centavos),0),
    count(*) FILTER (WHERE r.motoboy_id=v_s.motoboy_id
      AND r.valor_centavos=i.valor_centavos
      AND r.status='disponivel' AND r.financiamento_comprovado
      AND r.repasse_id IS NULL
      AND catalogo_private.catalogo_v2_financiado(r.pedido_id))
   INTO v_count,v_valor,v_validos
    FROM public.catalogo_solicitacao_saque_itens_v2 i
    JOIN public.catalogo_remuneracoes_v2 r ON r.id=i.remuneracao_id
    WHERE i.solicitacao_id=p_solicitacao_id;
  IF v_count=0 OR v_count<>v_validos OR v_valor<>v_s.valor_centavos THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',409,
      'mensagem','Créditos alterados, pagos ou sem lastro. Saque em revisão.');
  END IF;
  INSERT INTO public.catalogo_payout_intents_v2(
    solicitacao_id,motoboy_id,valor_centavos,pix_tipo,
    chave_pix_enc_snapshot,idempotency_key,referencia_externa
  ) VALUES (
    v_s.id,v_s.motoboy_id,v_s.valor_centavos,p_pix_tipo,
    v_perfil.chave_pix_enc,v_s.id,
    'saque_'||pg_catalog.replace(v_s.id::text,'-','')
  ) RETURNING * INTO v_p;
  RETURN pg_catalog.jsonb_build_object('ok',true,'idempotente',false,
    'intent_id',v_p.id,'idempotency_key',v_p.idempotency_key,
    'valor_centavos',v_p.valor_centavos,'estado',v_p.status,
    'reenviar_permitido',false);
END;
$payout_reserva$;
REVOKE ALL ON FUNCTION public.catalogo_reservar_payout_v2(uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_reservar_payout_v2(uuid,text) TO service_role;

-- A marcação de tentativa DEVE ser transacional e anteceder qualquer POST.
-- Resposta incerta requer conciliação GET pelo mesmo identificador; nunca novo POST automático.
CREATE FUNCTION public.catalogo_marcar_envio_payout_v2(p_intent_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $payout_envio$
DECLARE v_p public.catalogo_payout_intents_v2%ROWTYPE;
BEGIN
  SELECT * INTO v_p FROM public.catalogo_payout_intents_v2
    WHERE id=p_intent_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',404,'mensagem','Intenção inexistente.');
  END IF;
  IF v_p.status <> 'reservado' OR v_p.tentativas<>0 THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',409,
      'mensagem','Tentativa já iniciada. Conciliar com o provedor sem reenviar.');
  END IF;
  UPDATE public.catalogo_payout_intents_v2
    SET status='em_envio',tentativas=1,primeira_tentativa_em=pg_catalog.now(),
      atualizado_em=pg_catalog.now() WHERE id=v_p.id;
  RETURN pg_catalog.jsonb_build_object('ok',true,'estado','em_envio',
    'reenviar_permitido',false,'idempotency_key',v_p.idempotency_key);
END;
$payout_envio$;
REVOKE ALL ON FUNCTION public.catalogo_marcar_envio_payout_v2(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_marcar_envio_payout_v2(uuid) TO service_role;

-- Impede pagamento manual de um crédito que já integra uma transferência
-- automática reservada. Bloqueio vale também para estado indeterminado.
CREATE FUNCTION public.catalogo_bloquear_repasse_reservado_v2()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $payout_guard$
BEGIN
  IF NEW.status='pago' AND OLD.status IS DISTINCT FROM NEW.status
     AND EXISTS (
       SELECT 1 FROM public.catalogo_solicitacao_saque_itens_v2 i
       JOIN public.catalogo_payout_intents_v2 p
         ON p.solicitacao_id=i.solicitacao_id
       WHERE i.remuneracao_id=OLD.id
         AND p.status <> 'cancelado'
         AND NOT (p.status='confirmado' AND NEW.repasse_id=p.repasse_id
                  AND p.repasse_id IS NOT NULL)
     ) THEN
    RAISE EXCEPTION 'Crédito vinculado a payout reservado. Exige conciliação financeira.';
  END IF;
  RETURN NEW;
END;
$payout_guard$;
CREATE TRIGGER catalogo_bloquear_repasse_reservado_v2
BEFORE UPDATE OF status,repasse_id ON public.catalogo_remuneracoes_v2
FOR EACH ROW EXECUTE FUNCTION public.catalogo_bloquear_repasse_reservado_v2();
REVOKE ALL ON FUNCTION public.catalogo_bloquear_repasse_reservado_v2()
  FROM PUBLIC,anon,authenticated;

-- Eventos de estorno/chargeback já podem reter o crédito. A reserva nunca
-- deve ficar silenciosamente apta após perda de lastro.
CREATE FUNCTION public.catalogo_revisar_payout_apos_estorno_v2()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $payout_estorno$
BEGIN
  IF NEW.status IN ('retido','estornado','pendencia_revisao')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.catalogo_payout_intents_v2 p
      SET status='em_analise',revisao_motivo='Crédito retido/estornado após reserva',
        atualizado_em=pg_catalog.now()
      FROM public.catalogo_solicitacao_saque_itens_v2 i
      WHERE i.remuneracao_id=NEW.id AND i.solicitacao_id=p.solicitacao_id
        AND p.status NOT IN ('cancelado','em_analise');
  END IF;
  RETURN NEW;
END;
$payout_estorno$;
CREATE TRIGGER catalogo_revisar_payout_apos_estorno_v2
AFTER UPDATE OF status ON public.catalogo_remuneracoes_v2
FOR EACH ROW EXECUTE FUNCTION public.catalogo_revisar_payout_apos_estorno_v2();
REVOKE ALL ON FUNCTION public.catalogo_revisar_payout_apos_estorno_v2()
  FROM PUBLIC,anon,authenticated;


-- ETAPA 3B — o HTTP 202 guarda IDs, mas NUNCA confirma pagamento.
-- Esta RPC só pode ser chamada pelo backend service_role com resposta do provedor.
CREATE FUNCTION public.catalogo_registrar_criacao_payout_v2(
  p_intent_id uuid, p_payout_id text, p_transacao_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $payout_criacao$
DECLARE v_p public.catalogo_payout_intents_v2%ROWTYPE;
BEGIN
  IF p_intent_id IS NULL OR p_payout_id IS NULL OR
      p_payout_id !~ '^POP[A-Za-z0-9]{8,60}$' OR
      p_transacao_id IS NULL OR p_transacao_id !~ '^TOP[A-Za-z0-9]{8,60}$' THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',400,'mensagem','IDs de provedor inválidos.');
  END IF;
  SELECT * INTO v_p FROM public.catalogo_payout_intents_v2
    WHERE id=p_intent_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',404,'mensagem','Intenção inexistente.');
  END IF;
  IF v_p.payout_id IS NOT NULL AND
      v_p.payout_id=p_payout_id AND v_p.transacao_id=p_transacao_id THEN
    RETURN pg_catalog.jsonb_build_object('ok',true,'idempotente',true,
      'intent_id',v_p.id,'estado',v_p.status,'transferencia_confirmada',
      v_p.status='confirmado');
  END IF;
  IF v_p.status<>'em_envio' OR v_p.tentativas<>1 OR
     v_p.payout_id IS NOT NULL OR v_p.transacao_id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',409,
      'mensagem','Payout não pode ser vinculado a uma tentativa nova.');
  END IF;
  UPDATE public.catalogo_payout_intents_v2
    SET payout_id=p_payout_id,transacao_id=p_transacao_id,
        status='aguardando_confirmacao',atualizado_em=pg_catalog.now()
    WHERE id=v_p.id;
  RETURN pg_catalog.jsonb_build_object('ok',true,'idempotente',false,
    'intent_id',v_p.id,'estado','aguardando_confirmacao',
    'transferencia_confirmada',false);
END;
$payout_criacao$;
REVOKE ALL ON FUNCTION public.catalogo_registrar_criacao_payout_v2(uuid,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_registrar_criacao_payout_v2(uuid,text,text)
  TO service_role;

-- Somente fatos obtidos de GET autenticado do provedor devem chegar aqui.
-- O chamador deve usar consultarTransacaoSandbox + classificarTransacaoPayout,
-- jamais um webhook/JSON fornecido pelo browser. Não expor rota web.
CREATE FUNCTION public.catalogo_conciliar_payout_v2(
  p_intent_id uuid,
  p_payout_id text,
  p_transacao_id text,
  p_referencia_externa text,
  p_referencia_transacao text,
  p_valor_centavos bigint,
  p_status text,
  p_status_detail text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $payout_conciliacao$
DECLARE
  v_p public.catalogo_payout_intents_v2%ROWTYPE;
  v_s public.catalogo_solicitacoes_saque_v2%ROWTYPE;
  v_total bigint;
  v_count bigint;
  v_valid bigint;
  v_updated integer;
  v_repasse_id uuid;
BEGIN
  IF p_intent_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',400,'mensagem','Intenção obrigatória.');
  END IF;
  SELECT * INTO v_p FROM public.catalogo_payout_intents_v2
    WHERE id=p_intent_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',404,'mensagem','Intenção inexistente.');
  END IF;
  IF p_payout_id IS DISTINCT FROM v_p.payout_id OR
     p_transacao_id IS DISTINCT FROM v_p.transacao_id OR
     v_p.payout_id IS NULL OR v_p.transacao_id IS NULL OR
     p_referencia_externa IS DISTINCT FROM v_p.referencia_externa OR
     p_referencia_transacao IS DISTINCT FROM
       ('motoboy_'||pg_catalog.replace(v_p.solicitacao_id::text,'-','')) OR
     p_valor_centavos IS DISTINCT FROM v_p.valor_centavos THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',409,
      'mensagem','Prova divergente: IDs, moeda BRL, referência ou valor não coincidem.');
  END IF;
  IF v_p.status='confirmado' THEN
    RETURN pg_catalog.jsonb_build_object('ok',true,'idempotente',true,
      'estado','confirmado','repasse_id',v_p.repasse_id,
      'transferencia_confirmada',true);
  END IF;
  IF v_p.status NOT IN ('aguardando_confirmacao','em_envio') OR
     v_p.tentativas<>1 THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',409,
      'mensagem','Tentativa em revisão, encerrada ou ainda não enviada.');
  END IF;
  -- Nenhuma baixa enquanto o provedor não atestar sucesso efetivo.
  IF p_status IN ('created','approved','pending','in_process','processing') THEN
    UPDATE public.catalogo_payout_intents_v2 SET
      status='aguardando_confirmacao',ultima_consulta_em=pg_catalog.now(),
      atualizado_em=pg_catalog.now() WHERE id=v_p.id;
    RETURN pg_catalog.jsonb_build_object('ok',true,'estado','aguardando_confirmacao',
      'transferencia_confirmada',false);
  END IF;
  IF p_status IS DISTINCT FROM 'success' OR
     p_status_detail IS DISTINCT FROM 'accredited' THEN
    UPDATE public.catalogo_payout_intents_v2 SET
      status='em_analise',revisao_motivo='Payout não comprovado pelo provedor',
      ultima_consulta_em=pg_catalog.now(),atualizado_em=pg_catalog.now()
    WHERE id=v_p.id;
    RETURN pg_catalog.jsonb_build_object('ok',true,'estado','em_analise',
      'transferencia_confirmada',false);
  END IF;

  SELECT * INTO v_s FROM public.catalogo_solicitacoes_saque_v2
    WHERE id=v_p.solicitacao_id FOR UPDATE;
  IF NOT FOUND OR v_s.status<>'solicitado' OR
    v_s.motoboy_id<>v_p.motoboy_id OR
    v_s.valor_centavos<>v_p.valor_centavos THEN
    UPDATE public.catalogo_payout_intents_v2 SET
      status='em_analise',revisao_motivo='Divergência na solicitação de saque',
      atualizado_em=pg_catalog.now() WHERE id=v_p.id;
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',409,
      'mensagem','Solicitação incompatível: conciliação manual necessária.');
  END IF;

  -- Mesma ordem de bloqueio dos fluxos de pedido: pedido, depois remuneração.
  PERFORM 1 FROM public.catalogo_pedidos o
    JOIN public.catalogo_remuneracoes_v2 r ON r.pedido_id=o.id
    JOIN public.catalogo_solicitacao_saque_itens_v2 i ON i.remuneracao_id=r.id
    WHERE i.solicitacao_id=v_s.id ORDER BY o.id FOR UPDATE OF o;
  PERFORM 1 FROM public.catalogo_remuneracoes_v2 r
    JOIN public.catalogo_solicitacao_saque_itens_v2 i ON i.remuneracao_id=r.id
    WHERE i.solicitacao_id=v_s.id ORDER BY r.id FOR UPDATE OF r;
  SELECT count(*),coalesce(sum(i.valor_centavos),0),
      count(*) FILTER (WHERE r.motoboy_id=v_p.motoboy_id
        AND r.valor_centavos=i.valor_centavos AND r.status='disponivel'
        AND r.financiamento_comprovado AND r.repasse_id IS NULL
        AND catalogo_private.catalogo_v2_financiado(r.pedido_id))
    INTO v_count,v_total,v_valid
    FROM public.catalogo_solicitacao_saque_itens_v2 i
    JOIN public.catalogo_remuneracoes_v2 r ON r.id=i.remuneracao_id
    WHERE i.solicitacao_id=v_s.id;
  IF v_count=0 OR v_valid<>v_count OR v_total<>v_p.valor_centavos THEN
    UPDATE public.catalogo_payout_intents_v2 SET
      status='em_analise',revisao_motivo='Pagamento no provedor confirmado, mas créditos alterados',
      atualizado_em=pg_catalog.now() WHERE id=v_p.id;
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',409,
      'mensagem','Pagamento confirmado, mas lastro divergente: conciliar manualmente.');
  END IF;

  -- Prova do provedor auditável: não atribuir a execução ao administrador.
  INSERT INTO public.catalogo_repasses_v2(
    motoboy_id,valor_centavos,referencia,comprovante,
    registrado_por,origem_registro,metadata
  ) VALUES (
    v_p.motoboy_id,v_p.valor_centavos,
    'mp-payout:'||v_p.transacao_id,
    'Mercado Pago Payouts: confirmação via consulta autenticada '||v_p.transacao_id,
    NULL,'payout_provedor',
    pg_catalog.jsonb_build_object('origem','mp_payouts',
      'payout_id',v_p.payout_id,'transacao_id',v_p.transacao_id,
      'intencao_id',v_p.id,'saque_id',v_s.id,
      'status','success','status_detail','accredited','consulta_verificada_em',pg_catalog.now())
  ) RETURNING id INTO v_repasse_id;

  -- A trava de crédito só permite status pago com intenção confirmada
  -- e o MESMO repasse_id criado dentro desta transação.
  UPDATE public.catalogo_payout_intents_v2 SET
    status='confirmado',repasse_id=v_repasse_id,confirmado_em=pg_catalog.now(),
    ultima_consulta_em=pg_catalog.now(),atualizado_em=pg_catalog.now()
    WHERE id=v_p.id;
  UPDATE public.catalogo_remuneracoes_v2 r
    SET status='pago',repasse_id=v_repasse_id,pago_em=pg_catalog.now()
    WHERE EXISTS (SELECT 1 FROM public.catalogo_solicitacao_saque_itens_v2 i
      WHERE i.remuneracao_id=r.id AND i.solicitacao_id=v_s.id)
    AND r.status='disponivel' AND r.repasse_id IS NULL;
  GET DIAGNOSTICS v_updated=ROW_COUNT;
  IF v_updated<>v_count THEN
    RAISE EXCEPTION 'Payout revertido: alteração concorrente na remuneração';
  END IF;
  UPDATE public.catalogo_lancamentos_financeiros_v2
    SET status='pago',referencia='mp-payout:'||v_p.transacao_id,
      atualizado_em=pg_catalog.now()
    WHERE remuneracao_id IN (SELECT i.remuneracao_id
      FROM public.catalogo_solicitacao_saque_itens_v2 i
      WHERE i.solicitacao_id=v_s.id)
      AND tipo='remuneracao_motoboy';
  IF (SELECT status FROM public.catalogo_solicitacoes_saque_v2
      WHERE id=v_s.id) IS DISTINCT FROM 'pago' THEN
    RAISE EXCEPTION 'Payout revertido: solicitação não foi conciliada integralmente';
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok',true,'estado','confirmado',
    'transferencia_confirmada',true,'idempotente',false,
    'repasse_id',v_repasse_id,'valor_centavos',v_p.valor_centavos);
END;
$payout_conciliacao$;
REVOKE ALL ON FUNCTION public.catalogo_conciliar_payout_v2(
  uuid,text,text,text,text,bigint,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_conciliar_payout_v2(
  uuid,text,text,text,text,bigint,text,text) TO service_role;

COMMIT;

       OR pg_catalog.char_length(p_chave_pix_enc)>1000
       OR p_chave_pix_tipo NOT IN ('EMAIL','PHONE','CPF','CNPJ','PIX_CODE'))) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',400,
      'mensagem','Cadastre chave Pix e tipo compatíveis.');
  END IF;
  INSERT INTO public.catalogo_motoboy_perfis(usuario_id)
    VALUES(p_operador_id) ON CONFLICT(usuario_id) DO NOTHING;
  UPDATE public.catalogo_motoboy_perfis SET
    chave_pix_enc=p_chave_pix_enc,chave_pix_tipo=p_chave_pix_tipo,
    atualizado_em=pg_catalog.now() WHERE usuario_id=p_operador_id;
  RETURN pg_catalog.jsonb_build_object('ok',true,'chave_pix_tipo',p_chave_pix_tipo);
END;
$pix_save$;

-- A versão original da função é mantida nas migrations já aplicadas;
-- sobrescrevemos apenas o retorno do perfil para preservar outros contratos.
CREATE OR REPLACE FUNCTION public.catalogo_motoboy_extrato_v2(
  p_operador_id uuid,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $
DECLARE
  v_perfil public.catalogo_motoboy_perfis%ROWTYPE;
  v_concluidas integer;
  v_pre integer;
  v_pos integer;
  v_ocorrencias integer;
  v_amostra integer;
  v_receber integer;
  v_pago integer;
  v_retido integer;
  v_pendencia integer;
  v_entregas jsonb;
  v_pagamentos jsonb;
  v_indice numeric;
  v_situacao text;
BEGIN
  IF p_operador_id IS NULL OR p_offset IS NULL OR p_offset < 0 OR p_offset > 10000 THEN RETURN jsonb_build_object('ok',false,'http_status',400,'mensagem','Página inválida.'); END IF;
  IF NOT catalogo_private.catalogo_v2_autorizado(p_operador_id) THEN RETURN jsonb_build_object('ok',false,'http_status',403,'mensagem','Perfil de motoboy não autorizado.'); END IF;
  INSERT INTO public.catalogo_motoboy_perfis(usuario_id) VALUES(p_operador_id) ON CONFLICT DO NOTHING;
  SELECT * INTO v_perfil FROM public.catalogo_motoboy_perfis WHERE usuario_id=p_operador_id;
  SELECT count(*)::integer INTO v_concluidas FROM public.catalogo_pedidos p JOIN public.catalogo_entregas_atribuidas a ON a.pedido_id=p.id AND a.motoboy_id=p_operador_id WHERE p.entrega_status='entregue';
  -- Somente responsabilidade comprovada/revisada; pedidos distintos no denominador.
  SELECT count(DISTINCT pedido_id) FILTER (WHERE categoria='desistencia_pre_coleta')::integer,
         count(DISTINCT pedido_id) FILTER (WHERE categoria='desistencia_pos_coleta')::integer,
         count(DISTINCT pedido_id)::integer
    INTO v_pre,v_pos,v_ocorrencias FROM public.catalogo_ocorrencias_v2
    WHERE motoboy_id=p_operador_id AND comprovada AND decisao='ocorrencia_comprovada'
      AND status='resolvida' AND categoria IN ('desistencia_pre_coleta','desistencia_pos_coleta','avaria','atraso');
  SELECT count(DISTINCT pedido_id)::integer INTO v_amostra FROM (
    SELECT p.id pedido_id FROM public.catalogo_pedidos p JOIN public.catalogo_entregas_atribuidas a ON a.pedido_id=p.id
      WHERE a.motoboy_id=p_operador_id AND p.entrega_status='entregue'
    UNION SELECT o.pedido_id FROM public.catalogo_ocorrencias_v2 o WHERE o.motoboy_id=p_operador_id
      AND o.comprovada AND o.decisao='ocorrencia_comprovada' AND o.status='resolvida'
      AND o.categoria IN ('desistencia_pre_coleta','desistencia_pos_coleta','avaria','atraso')
  ) amostra;
  IF v_amostra >= 5 THEN
    v_indice := round((100.0 * greatest(v_amostra-v_ocorrencias,0) / greatest(v_amostra,1))::numeric,2);
    v_situacao := CASE WHEN v_perfil.em_analise THEN 'revisao_preventiva' ELSE 'calculado' END;
  ELSE
    v_indice := NULL;
    v_situacao := 'em_formacao';
  END IF;
  SELECT coalesce(sum(valor_centavos) FILTER (WHERE status='disponivel'),0)::integer,
         coalesce(sum(valor_centavos) FILTER (WHERE status='pago' OR repasse_id IS NOT NULL),0)::integer,
         coalesce(sum(valor_centavos) FILTER (WHERE status IN ('retido','pendencia_revisao') AND repasse_id IS NULL),0)::integer,
         coalesce(sum(valor_centavos) FILTER (WHERE status='pendencia_revisao'),0)::integer
    INTO v_receber,v_pago,v_retido,v_pendencia FROM public.catalogo_remuneracoes_v2 WHERE motoboy_id=p_operador_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('pedido_id',p.id,'comercio_id',p.comercio_id,'valor_centavos',r.valor_centavos,'status',r.status,'criado_em',r.criado_em,'pago_em',r.pago_em,'repasse_id',r.repasse_id) ORDER BY r.criado_em DESC),'[]'::jsonb)
    INTO v_entregas FROM (SELECT * FROM public.catalogo_remuneracoes_v2 WHERE motoboy_id=p_operador_id ORDER BY criado_em DESC,id LIMIT 100 OFFSET p_offset) r JOIN public.catalogo_pedidos p ON p.id=r.pedido_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('tipo',l.tipo,'valor_centavos',l.valor_centavos,'status',l.status,'referencia',l.referencia,'criado_em',l.criado_em) ORDER BY l.criado_em DESC),'[]'::jsonb)
    INTO v_pagamentos FROM (SELECT * FROM public.catalogo_lancamentos_financeiros_v2 WHERE beneficiario_id=p_operador_id ORDER BY criado_em DESC,id LIMIT 100 OFFSET p_offset) l;
  RETURN jsonb_build_object('ok',true,
    'saldo',jsonb_build_object('a_receber_centavos',v_receber,'pago_centavos',v_pago,'retido_centavos',v_retido,'pendencias_centavos',v_pendencia),
    'confiabilidade',jsonb_build_object('indice',v_indice,'situacao',v_situacao,'amostra',v_amostra,'concluidas',v_concluidas,'cancelamentos_pre_coleta',v_pre,'cancelamentos_pos_coleta',v_pos,'ocorrencias',v_ocorrencias),
    'entregas_concluidas',v_entregas,'pagamentos',v_pagamentos,
    'perfil',jsonb_build_object('disponivel',v_perfil.disponivel,'chave_pix_enc',v_perfil.chave_pix_enc,'chave_pix_tipo',v_perfil.chave_pix_tipo));
END;
$;

REVOKE ALL ON FUNCTION public.catalogo_salvar_chave_pix_tipado_v2(uuid,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_salvar_chave_pix_tipado_v2(uuid,text,text)
  TO service_role;

-- ETAPA 3: reserva transacional persistente. Nenhum pagamento é disparado aqui.
-- Uma única intenção por solicitação; retries devem usar SEMPRE o mesmo ID.
CREATE TABLE public.catalogo_payout_intents_v2 (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  solicitacao_id uuid NOT NULL UNIQUE
    REFERENCES public.catalogo_solicitacoes_saque_v2(id) ON DELETE RESTRICT,
  motoboy_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  valor_centavos bigint NOT NULL CHECK (valor_centavos >= 100),
  moeda text NOT NULL DEFAULT 'BRL' CHECK (moeda = 'BRL'),
  pix_tipo text NOT NULL CHECK (pix_tipo IN ('EMAIL','PHONE','CPF','CNPJ','PIX_CODE')),
  chave_pix_enc_snapshot text NOT NULL
    CHECK (chave_pix_enc_snapshot ~ '^pix-v2:[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$'),
  idempotency_key uuid NOT NULL UNIQUE,
  referencia_externa text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'reservado'
    CHECK (status IN ('reservado','em_envio','aguardando_confirmacao','em_analise','confirmado','cancelado')),
  payout_id text UNIQUE,
  transacao_id text UNIQUE,
  repasse_id uuid UNIQUE REFERENCES public.catalogo_repasses_v2(id) ON DELETE RESTRICT,
  ultima_consulta_em timestamptz,
  confirmado_em timestamptz,
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  reservado_em timestamptz NOT NULL DEFAULT pg_catalog.now(),
  primeira_tentativa_em timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT pg_catalog.now(),
  revisao_motivo text CHECK (revisao_motivo IS NULL OR pg_catalog.char_length(revisao_motivo) <= 500),
  CHECK (
    (payout_id IS NULL AND transacao_id IS NULL)
    OR (payout_id IS NOT NULL AND transacao_id IS NOT NULL)
  )
);
CREATE INDEX catalogo_payout_intents_v2_estado_idx
  ON public.catalogo_payout_intents_v2(status,reservado_em);

-- Registros da confirmação real via provedor não devem falsificar autoria humana.
ALTER TABLE public.catalogo_repasses_v2
  ADD COLUMN origem_registro text NOT NULL DEFAULT 'admin_manual';
ALTER TABLE public.catalogo_repasses_v2 ALTER COLUMN registrado_por DROP NOT NULL;
ALTER TABLE public.catalogo_repasses_v2 ADD CONSTRAINT catalogo_repasses_origem_v2_check
  CHECK ((origem_registro='admin_manual' AND registrado_por IS NOT NULL)
      OR (origem_registro='payout_provedor' AND registrado_por IS NULL));

ALTER TABLE public.catalogo_payout_intents_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_payout_intents_v2 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.catalogo_payout_intents_v2 TO service_role;

-- Chamada exclusiva de backend confiável com chave service_role.
-- O chamador deve decifrar/validar a chave Pix e o tipo antes de iniciar o envio.
-- Não utiliza dados financeiros fornecidos pelo navegador.
CREATE FUNCTION public.catalogo_reservar_payout_v2(
  p_solicitacao_id uuid, p_pix_tipo text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $payout_reserva$
DECLARE
  v_s public.catalogo_solicitacoes_saque_v2%ROWTYPE;
  v_perfil public.catalogo_motoboy_perfis%ROWTYPE;
  v_p public.catalogo_payout_intents_v2%ROWTYPE;
  v_valor bigint;
  v_count bigint;
  v_validos bigint;
BEGIN
  IF p_solicitacao_id IS NULL OR p_pix_tipo IS NULL OR
      p_pix_tipo NOT IN ('EMAIL','PHONE','CPF','CNPJ','PIX_CODE') THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',400,'mensagem','Solicitação ou tipo Pix inválido.');
  END IF;
  SELECT * INTO v_s FROM public.catalogo_solicitacoes_saque_v2
    WHERE id=p_solicitacao_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',404,'mensagem','Solicitação não encontrada.');
  END IF;
  -- A mesma reserva e as mesmas referências serão devolvidas em retries.
  SELECT * INTO v_p FROM public.catalogo_payout_intents_v2
    WHERE solicitacao_id=p_solicitacao_id FOR UPDATE;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok',true,'idempotente',true,
      'intent_id',v_p.id,'idempotency_key',v_p.idempotency_key,
      'valor_centavos',v_p.valor_centavos,'estado',v_p.status,
      'reenviar_permitido',false);
  END IF;
  IF v_s.status <> 'solicitado' OR v_s.valor_centavos < 100 THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',409,
      'mensagem','Solicitação indisponível ou abaixo do mínimo Pix de R$ 1,00.');
  END IF;
  SELECT * INTO v_perfil FROM public.catalogo_motoboy_perfis
    WHERE usuario_id=v_s.motoboy_id FOR UPDATE;
  IF NOT FOUND OR v_perfil.chave_pix_enc IS NULL OR NOT v_perfil.apto OR
      v_perfil.em_analise THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',409,
      'mensagem','Perfil não apto ou chave Pix indisponível.');
  END IF;
  -- A trava evita o pagamento manual concorrente e congela o lastro.
  PERFORM 1 FROM public.catalogo_remuneracoes_v2 r
    JOIN public.catalogo_solicitacao_saque_itens_v2 i ON i.remuneracao_id=r.id
    WHERE i.solicitacao_id=p_solicitacao_id ORDER BY r.id FOR UPDATE OF r;
  SELECT count(*),coalesce(sum(i.valor_centavos),0),
    count(*) FILTER (WHERE r.motoboy_id=v_s.motoboy_id
      AND r.valor_centavos=i.valor_centavos
      AND r.status='disponivel' AND r.financiamento_comprovado
      AND r.repasse_id IS NULL
      AND catalogo_private.catalogo_v2_financiado(r.pedido_id))
   INTO v_count,v_valor,v_validos
    FROM public.catalogo_solicitacao_saque_itens_v2 i
    JOIN public.catalogo_remuneracoes_v2 r ON r.id=i.remuneracao_id
    WHERE i.solicitacao_id=p_solicitacao_id;
  IF v_count=0 OR v_count<>v_validos OR v_valor<>v_s.valor_centavos THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',409,
      'mensagem','Créditos alterados, pagos ou sem lastro. Saque em revisão.');
  END IF;
  INSERT INTO public.catalogo_payout_intents_v2(
    solicitacao_id,motoboy_id,valor_centavos,pix_tipo,
    chave_pix_enc_snapshot,idempotency_key,referencia_externa
  ) VALUES (
    v_s.id,v_s.motoboy_id,v_s.valor_centavos,p_pix_tipo,
    v_perfil.chave_pix_enc,v_s.id,
    'saque_'||pg_catalog.replace(v_s.id::text,'-','')
  ) RETURNING * INTO v_p;
  RETURN pg_catalog.jsonb_build_object('ok',true,'idempotente',false,
    'intent_id',v_p.id,'idempotency_key',v_p.idempotency_key,
    'valor_centavos',v_p.valor_centavos,'estado',v_p.status,
    'reenviar_permitido',false);
END;
$payout_reserva$;
REVOKE ALL ON FUNCTION public.catalogo_reservar_payout_v2(uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_reservar_payout_v2(uuid,text) TO service_role;

-- A marcação de tentativa DEVE ser transacional e anteceder qualquer POST.
-- Resposta incerta requer conciliação GET pelo mesmo identificador; nunca novo POST automático.
CREATE FUNCTION public.catalogo_marcar_envio_payout_v2(p_intent_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $payout_envio$
DECLARE v_p public.catalogo_payout_intents_v2%ROWTYPE;
BEGIN
  SELECT * INTO v_p FROM public.catalogo_payout_intents_v2
    WHERE id=p_intent_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',404,'mensagem','Intenção inexistente.');
  END IF;
  IF v_p.status <> 'reservado' OR v_p.tentativas<>0 THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',409,
      'mensagem','Tentativa já iniciada. Conciliar com o provedor sem reenviar.');
  END IF;
  UPDATE public.catalogo_payout_intents_v2
    SET status='em_envio',tentativas=1,primeira_tentativa_em=pg_catalog.now(),
      atualizado_em=pg_catalog.now() WHERE id=v_p.id;
  RETURN pg_catalog.jsonb_build_object('ok',true,'estado','em_envio',
    'reenviar_permitido',false,'idempotency_key',v_p.idempotency_key);
END;
$payout_envio$;
REVOKE ALL ON FUNCTION public.catalogo_marcar_envio_payout_v2(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_marcar_envio_payout_v2(uuid) TO service_role;

-- Impede pagamento manual de um crédito que já integra uma transferência
-- automática reservada. Bloqueio vale também para estado indeterminado.
CREATE FUNCTION public.catalogo_bloquear_repasse_reservado_v2()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $payout_guard$
BEGIN
  IF NEW.status='pago' AND OLD.status IS DISTINCT FROM NEW.status
     AND EXISTS (
       SELECT 1 FROM public.catalogo_solicitacao_saque_itens_v2 i
       JOIN public.catalogo_payout_intents_v2 p
         ON p.solicitacao_id=i.solicitacao_id
       WHERE i.remuneracao_id=OLD.id
         AND p.status <> 'cancelado'
         AND NOT (p.status='confirmado' AND NEW.repasse_id=p.repasse_id
                  AND p.repasse_id IS NOT NULL)
     ) THEN
    RAISE EXCEPTION 'Crédito vinculado a payout reservado. Exige conciliação financeira.';
  END IF;
  RETURN NEW;
END;
$payout_guard$;
CREATE TRIGGER catalogo_bloquear_repasse_reservado_v2
BEFORE UPDATE OF status,repasse_id ON public.catalogo_remuneracoes_v2
FOR EACH ROW EXECUTE FUNCTION public.catalogo_bloquear_repasse_reservado_v2();
REVOKE ALL ON FUNCTION public.catalogo_bloquear_repasse_reservado_v2()
  FROM PUBLIC,anon,authenticated;

-- Eventos de estorno/chargeback já podem reter o crédito. A reserva nunca
-- deve ficar silenciosamente apta após perda de lastro.
CREATE FUNCTION public.catalogo_revisar_payout_apos_estorno_v2()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $payout_estorno$
BEGIN
  IF NEW.status IN ('retido','estornado','pendencia_revisao')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.catalogo_payout_intents_v2 p
      SET status='em_analise',revisao_motivo='Crédito retido/estornado após reserva',
        atualizado_em=pg_catalog.now()
      FROM public.catalogo_solicitacao_saque_itens_v2 i
      WHERE i.remuneracao_id=NEW.id AND i.solicitacao_id=p.solicitacao_id
        AND p.status NOT IN ('cancelado','em_analise');
  END IF;
  RETURN NEW;
END;
$payout_estorno$;
CREATE TRIGGER catalogo_revisar_payout_apos_estorno_v2
AFTER UPDATE OF status ON public.catalogo_remuneracoes_v2
FOR EACH ROW EXECUTE FUNCTION public.catalogo_revisar_payout_apos_estorno_v2();
REVOKE ALL ON FUNCTION public.catalogo_revisar_payout_apos_estorno_v2()
  FROM PUBLIC,anon,authenticated;


-- ETAPA 3B — o HTTP 202 guarda IDs, mas NUNCA confirma pagamento.
-- Esta RPC só pode ser chamada pelo backend service_role com resposta do provedor.
CREATE FUNCTION public.catalogo_registrar_criacao_payout_v2(
  p_intent_id uuid, p_payout_id text, p_transacao_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $payout_criacao$
DECLARE v_p public.catalogo_payout_intents_v2%ROWTYPE;
BEGIN
  IF p_intent_id IS NULL OR p_payout_id IS NULL OR
      p_payout_id !~ '^POP[A-Za-z0-9]{8,60}$' OR
      p_transacao_id IS NULL OR p_transacao_id !~ '^TOP[A-Za-z0-9]{8,60}$' THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',400,'mensagem','IDs de provedor inválidos.');
  END IF;
  SELECT * INTO v_p FROM public.catalogo_payout_intents_v2
    WHERE id=p_intent_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',404,'mensagem','Intenção inexistente.');
  END IF;
  IF v_p.payout_id IS NOT NULL AND
      v_p.payout_id=p_payout_id AND v_p.transacao_id=p_transacao_id THEN
    RETURN pg_catalog.jsonb_build_object('ok',true,'idempotente',true,
      'intent_id',v_p.id,'estado',v_p.status,'transferencia_confirmada',
      v_p.status='confirmado');
  END IF;
  IF v_p.status<>'em_envio' OR v_p.tentativas<>1 OR
     v_p.payout_id IS NOT NULL OR v_p.transacao_id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',409,
      'mensagem','Payout não pode ser vinculado a uma tentativa nova.');
  END IF;
  UPDATE public.catalogo_payout_intents_v2
    SET payout_id=p_payout_id,transacao_id=p_transacao_id,
        status='aguardando_confirmacao',atualizado_em=pg_catalog.now()
    WHERE id=v_p.id;
  RETURN pg_catalog.jsonb_build_object('ok',true,'idempotente',false,
    'intent_id',v_p.id,'estado','aguardando_confirmacao',
    'transferencia_confirmada',false);
END;
$payout_criacao$;
REVOKE ALL ON FUNCTION public.catalogo_registrar_criacao_payout_v2(uuid,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_registrar_criacao_payout_v2(uuid,text,text)
  TO service_role;

-- Somente fatos obtidos de GET autenticado do provedor devem chegar aqui.
-- O chamador deve usar consultarTransacaoSandbox + classificarTransacaoPayout,
-- jamais um webhook/JSON fornecido pelo browser. Não expor rota web.
CREATE FUNCTION public.catalogo_conciliar_payout_v2(
  p_intent_id uuid,
  p_payout_id text,
  p_transacao_id text,
  p_referencia_externa text,
  p_referencia_transacao text,
  p_valor_centavos bigint,
  p_status text,
  p_status_detail text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $payout_conciliacao$
DECLARE
  v_p public.catalogo_payout_intents_v2%ROWTYPE;
  v_s public.catalogo_solicitacoes_saque_v2%ROWTYPE;
  v_total bigint;
  v_count bigint;
  v_valid bigint;
  v_updated integer;
  v_repasse_id uuid;
BEGIN
  IF p_intent_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',400,'mensagem','Intenção obrigatória.');
  END IF;
  SELECT * INTO v_p FROM public.catalogo_payout_intents_v2
    WHERE id=p_intent_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',404,'mensagem','Intenção inexistente.');
  END IF;
  IF p_payout_id IS DISTINCT FROM v_p.payout_id OR
     p_transacao_id IS DISTINCT FROM v_p.transacao_id OR
     v_p.payout_id IS NULL OR v_p.transacao_id IS NULL OR
     p_referencia_externa IS DISTINCT FROM v_p.referencia_externa OR
     p_referencia_transacao IS DISTINCT FROM
       ('motoboy_'||pg_catalog.replace(v_p.solicitacao_id::text,'-','')) OR
     p_valor_centavos IS DISTINCT FROM v_p.valor_centavos THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',409,
      'mensagem','Prova divergente: IDs, moeda BRL, referência ou valor não coincidem.');
  END IF;
  IF v_p.status='confirmado' THEN
    RETURN pg_catalog.jsonb_build_object('ok',true,'idempotente',true,
      'estado','confirmado','repasse_id',v_p.repasse_id,
      'transferencia_confirmada',true);
  END IF;
  IF v_p.status NOT IN ('aguardando_confirmacao','em_envio') OR
     v_p.tentativas<>1 THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',409,
      'mensagem','Tentativa em revisão, encerrada ou ainda não enviada.');
  END IF;
  -- Nenhuma baixa enquanto o provedor não atestar sucesso efetivo.
  IF p_status IN ('created','approved','pending','in_process','processing') THEN
    UPDATE public.catalogo_payout_intents_v2 SET
      status='aguardando_confirmacao',ultima_consulta_em=pg_catalog.now(),
      atualizado_em=pg_catalog.now() WHERE id=v_p.id;
    RETURN pg_catalog.jsonb_build_object('ok',true,'estado','aguardando_confirmacao',
      'transferencia_confirmada',false);
  END IF;
  IF p_status IS DISTINCT FROM 'success' OR
     p_status_detail IS DISTINCT FROM 'accredited' THEN
    UPDATE public.catalogo_payout_intents_v2 SET
      status='em_analise',revisao_motivo='Payout não comprovado pelo provedor',
      ultima_consulta_em=pg_catalog.now(),atualizado_em=pg_catalog.now()
    WHERE id=v_p.id;
    RETURN pg_catalog.jsonb_build_object('ok',true,'estado','em_analise',
      'transferencia_confirmada',false);
  END IF;

  SELECT * INTO v_s FROM public.catalogo_solicitacoes_saque_v2
    WHERE id=v_p.solicitacao_id FOR UPDATE;
  IF NOT FOUND OR v_s.status<>'solicitado' OR
    v_s.motoboy_id<>v_p.motoboy_id OR
    v_s.valor_centavos<>v_p.valor_centavos THEN
    UPDATE public.catalogo_payout_intents_v2 SET
      status='em_analise',revisao_motivo='Divergência na solicitação de saque',
      atualizado_em=pg_catalog.now() WHERE id=v_p.id;
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',409,
      'mensagem','Solicitação incompatível: conciliação manual necessária.');
  END IF;

  -- Mesma ordem de bloqueio dos fluxos de pedido: pedido, depois remuneração.
  PERFORM 1 FROM public.catalogo_pedidos o
    JOIN public.catalogo_remuneracoes_v2 r ON r.pedido_id=o.id
    JOIN public.catalogo_solicitacao_saque_itens_v2 i ON i.remuneracao_id=r.id
    WHERE i.solicitacao_id=v_s.id ORDER BY o.id FOR UPDATE OF o;
  PERFORM 1 FROM public.catalogo_remuneracoes_v2 r
    JOIN public.catalogo_solicitacao_saque_itens_v2 i ON i.remuneracao_id=r.id
    WHERE i.solicitacao_id=v_s.id ORDER BY r.id FOR UPDATE OF r;
  SELECT count(*),coalesce(sum(i.valor_centavos),0),
      count(*) FILTER (WHERE r.motoboy_id=v_p.motoboy_id
        AND r.valor_centavos=i.valor_centavos AND r.status='disponivel'
        AND r.financiamento_comprovado AND r.repasse_id IS NULL
        AND catalogo_private.catalogo_v2_financiado(r.pedido_id))
    INTO v_count,v_total,v_valid
    FROM public.catalogo_solicitacao_saque_itens_v2 i
    JOIN public.catalogo_remuneracoes_v2 r ON r.id=i.remuneracao_id
    WHERE i.solicitacao_id=v_s.id;
  IF v_count=0 OR v_valid<>v_count OR v_total<>v_p.valor_centavos THEN
    UPDATE public.catalogo_payout_intents_v2 SET
      status='em_analise',revisao_motivo='Pagamento no provedor confirmado, mas créditos alterados',
      atualizado_em=pg_catalog.now() WHERE id=v_p.id;
    RETURN pg_catalog.jsonb_build_object('ok',false,'http_status',409,
      'mensagem','Pagamento confirmado, mas lastro divergente: conciliar manualmente.');
  END IF;

  -- Prova do provedor auditável: não atribuir a execução ao administrador.
  INSERT INTO public.catalogo_repasses_v2(
    motoboy_id,valor_centavos,referencia,comprovante,
    registrado_por,origem_registro,metadata
  ) VALUES (
    v_p.motoboy_id,v_p.valor_centavos,
    'mp-payout:'||v_p.transacao_id,
    'Mercado Pago Payouts: confirmação via consulta autenticada '||v_p.transacao_id,
    NULL,'payout_provedor',
    pg_catalog.jsonb_build_object('origem','mp_payouts',
      'payout_id',v_p.payout_id,'transacao_id',v_p.transacao_id,
      'intencao_id',v_p.id,'saque_id',v_s.id,
      'status','success','status_detail','accredited','consulta_verificada_em',pg_catalog.now())
  ) RETURNING id INTO v_repasse_id;

  -- A trava de crédito só permite status pago com intenção confirmada
  -- e o MESMO repasse_id criado dentro desta transação.
  UPDATE public.catalogo_payout_intents_v2 SET
    status='confirmado',repasse_id=v_repasse_id,confirmado_em=pg_catalog.now(),
    ultima_consulta_em=pg_catalog.now(),atualizado_em=pg_catalog.now()
    WHERE id=v_p.id;
  UPDATE public.catalogo_remuneracoes_v2 r
    SET status='pago',repasse_id=v_repasse_id,pago_em=pg_catalog.now()
    WHERE EXISTS (SELECT 1 FROM public.catalogo_solicitacao_saque_itens_v2 i
      WHERE i.remuneracao_id=r.id AND i.solicitacao_id=v_s.id)
    AND r.status='disponivel' AND r.repasse_id IS NULL;
  GET DIAGNOSTICS v_updated=ROW_COUNT;
  IF v_updated<>v_count THEN
    RAISE EXCEPTION 'Payout revertido: alteração concorrente na remuneração';
  END IF;
  UPDATE public.catalogo_lancamentos_financeiros_v2
    SET status='pago',referencia='mp-payout:'||v_p.transacao_id,
      atualizado_em=pg_catalog.now()
    WHERE remuneracao_id IN (SELECT i.remuneracao_id
      FROM public.catalogo_solicitacao_saque_itens_v2 i
      WHERE i.solicitacao_id=v_s.id)
      AND tipo='remuneracao_motoboy';
  IF (SELECT status FROM public.catalogo_solicitacoes_saque_v2
      WHERE id=v_s.id) IS DISTINCT FROM 'pago' THEN
    RAISE EXCEPTION 'Payout revertido: solicitação não foi conciliada integralmente';
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok',true,'estado','confirmado',
    'transferencia_confirmada',true,'idempotente',false,
    'repasse_id',v_repasse_id,'valor_centavos',v_p.valor_centavos);
END;
$payout_conciliacao$;
REVOKE ALL ON FUNCTION public.catalogo_conciliar_payout_v2(
  uuid,text,text,text,text,bigint,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_conciliar_payout_v2(
  uuid,text,text,text,text,bigint,text,text) TO service_role;

COMMIT;
