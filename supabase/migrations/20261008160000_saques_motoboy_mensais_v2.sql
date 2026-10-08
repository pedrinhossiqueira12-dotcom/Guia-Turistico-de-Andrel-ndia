-- Saques mensais: reserva auditável, Pix do próprio entregador e conciliação.
-- Migration aditiva. NÃO inicia transferência e NÃO marca créditos como pagos.
-- O disparo financeiro exige um provedor Payouts habilitado e confirmação externa.
BEGIN;

CREATE TABLE IF NOT EXISTS public.catalogo_saques_motoboy_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  motoboy_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  estado text NOT NULL DEFAULT 'solicitado'
    CHECK (estado IN ('solicitado','processando','aguardando_confirmacao','pago','falhou','revisao')),
  valor_centavos integer NOT NULL CHECK (valor_centavos >= 100),
  chave_pix_enc text NOT NULL
    CHECK (chave_pix_enc ~ '^pix-v2:[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$'),
  limite_periodo timestamptz NOT NULL,
  referencia text NOT NULL UNIQUE,
  provedor text NOT NULL DEFAULT 'mercadopago_payouts'
    CHECK (provedor='mercadopago_payouts'),
  payout_id text UNIQUE,
  transacao_id text UNIQUE,
  provedor_status text,
  detalhe_status text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  pago_em timestamptz,
  CHECK (pago_em IS NULL OR estado='pago')
);
CREATE TABLE IF NOT EXISTS public.catalogo_saque_creditos_v2 (
  saque_id uuid NOT NULL REFERENCES public.catalogo_saques_motoboy_v2(id) ON DELETE RESTRICT,
  remuneracao_id uuid NOT NULL REFERENCES public.catalogo_remuneracoes_v2(id) ON DELETE RESTRICT,
  valor_centavos integer NOT NULL CHECK(valor_centavos>0),
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (saque_id,remuneracao_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS catalogo_saque_credito_ativo_unico_v2
  ON public.catalogo_saque_creditos_v2(remuneracao_id) WHERE ativo=true;
CREATE INDEX IF NOT EXISTS catalogo_saques_motoboy_status_v2
  ON public.catalogo_saques_motoboy_v2(estado,criado_em,id);
CREATE INDEX IF NOT EXISTS catalogo_saques_motoboy_proprio_v2
  ON public.catalogo_saques_motoboy_v2(motoboy_id,criado_em DESC);

ALTER TABLE public.catalogo_saques_motoboy_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_saque_creditos_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.catalogo_saques_motoboy_v2, public.catalogo_saque_creditos_v2
  FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.catalogo_saques_motoboy_v2,
  public.catalogo_saque_creditos_v2 TO service_role;

-- Um repasse administrativo antigo não pode pagar crédito reservado por um saque.
-- Também impede que um worker confunda pedido enviado ao provedor com crédito pago.
CREATE OR REPLACE FUNCTION catalogo_private.catalogo_bloquear_repasse_com_saque_v2()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.status='pago' AND OLD.status<>'pago'
     AND EXISTS(
       SELECT 1 FROM public.catalogo_saque_creditos_v2 sc
       JOIN public.catalogo_saques_motoboy_v2 s ON s.id=sc.saque_id
       WHERE sc.remuneracao_id=NEW.id AND sc.ativo=true AND s.estado<>'pago'
     )
  THEN
    RAISE EXCEPTION 'Crédito reservado a saque, não permitir segundo repasse';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS catalogo_bloquear_repasse_com_saque_v2
  ON public.catalogo_remuneracoes_v2;
CREATE TRIGGER catalogo_bloquear_repasse_com_saque_v2
BEFORE UPDATE OF status ON public.catalogo_remuneracoes_v2
FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_bloquear_repasse_com_saque_v2();

-- Fechamento mensal usa fuso da cidade. Apenas CRÉDITOS já liberados
-- ANTES do mês atual e financiados pela plataforma podem ser sacados.
-- Identidade sempre verificada na Edge com JWT, não recebida do navegador.
CREATE OR REPLACE FUNCTION public.catalogo_motoboy_solicitar_saque_v2(
  p_operador_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_perfil public.catalogo_motoboy_perfis%ROWTYPE;
  v_limite timestamptz := date_trunc('month', pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
  v_id uuid;
  v_valor bigint := 0;
  v_count integer := 0;
  v_pedido uuid;
BEGIN
  IF p_operador_id IS NULL OR NOT catalogo_private.catalogo_v2_autorizado(p_operador_id) THEN
    RETURN jsonb_build_object('ok',false,'http_status',403,'mensagem','Motoboy não autorizado.');
  END IF;
  -- Bloqueia duas solicitações simultâneas do mesmo motoboy, sem disputa global.
  SELECT * INTO v_perfil FROM public.catalogo_motoboy_perfis
   WHERE usuario_id=p_operador_id FOR UPDATE;
  IF NOT FOUND OR v_perfil.chave_pix_enc IS NULL OR v_perfil.em_analise OR NOT v_perfil.apto THEN
    RETURN jsonb_build_object('ok',false,'http_status',409,
      'mensagem','Cadastre sua chave Pix própria e conclua a revisão de cadastro, se houver.');
  END IF;
  IF EXISTS(SELECT 1 FROM public.catalogo_saques_motoboy_v2
            WHERE motoboy_id=p_operador_id AND estado IN ('solicitado','processando','aguardando_confirmacao','revisao')) THEN
    RETURN jsonb_build_object('ok',false,'http_status',409,
      'mensagem','Já existe uma solicitação de saque em andamento.');
  END IF;

  -- A ordem de locks segue a ordem já usada na operação financeira:
  -- pedidos por UUID, depois remunerações. Sem lock reverso.
  FOR v_pedido IN
    SELECT DISTINCT p.id FROM public.catalogo_pedidos p
    JOIN public.catalogo_remuneracoes_v2 r ON r.pedido_id=p.id
    WHERE r.motoboy_id=p_operador_id AND r.status='disponivel'
      AND r.repasse_id IS NULL AND r.financiamento_comprovado
      AND r.disponibilizado_em IS NOT NULL AND r.disponibilizado_em < v_limite
      AND NOT EXISTS(SELECT 1 FROM public.catalogo_saque_creditos_v2 sc
                     WHERE sc.remuneracao_id=r.id AND sc.ativo)
    ORDER BY p.id
  LOOP
    PERFORM 1 FROM public.catalogo_pedidos WHERE id=v_pedido FOR UPDATE;
  END LOOP;

  SELECT count(*),coalesce(sum(r.valor_centavos),0)
   INTO v_count,v_valor
  FROM public.catalogo_remuneracoes_v2 r
  WHERE r.motoboy_id=p_operador_id AND r.status='disponivel'
    AND r.repasse_id IS NULL AND r.financiamento_comprovado
    AND r.disponibilizado_em IS NOT NULL AND r.disponibilizado_em < v_limite
    AND catalogo_private.catalogo_v2_financiado(r.pedido_id)
    AND NOT EXISTS(SELECT 1 FROM public.catalogo_saque_creditos_v2 sc
                   WHERE sc.remuneracao_id=r.id AND sc.ativo);

  IF v_count=0 OR v_valor<100 THEN
    RETURN jsonb_build_object('ok',false,'http_status',409,
      'mensagem','Saldo liberado de meses fechados insuficiente (mínimo R$ 1,00).');
  END IF;
  IF v_count>1000 OR v_valor>2147483647 THEN
    RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Solicitação excede o limite de processamento.');
  END IF;
  INSERT INTO public.catalogo_saques_motoboy_v2(motoboy_id,valor_centavos,chave_pix_enc,limite_periodo,referencia)
  VALUES(p_operador_id,v_valor,v_perfil.chave_pix_enc,v_limite,'saque_'||gen_random_uuid()::text)
  RETURNING id INTO v_id;
  INSERT INTO public.catalogo_saque_creditos_v2(saque_id,remuneracao_id,valor_centavos)
  SELECT v_id,r.id,r.valor_centavos FROM public.catalogo_remuneracoes_v2 r
  WHERE r.motoboy_id=p_operador_id AND r.status='disponivel'
    AND r.repasse_id IS NULL AND r.financiamento_comprovado
    AND r.disponibilizado_em IS NOT NULL AND r.disponibilizado_em < v_limite
    AND catalogo_private.catalogo_v2_financiado(r.pedido_id)
    AND NOT EXISTS(SELECT 1 FROM public.catalogo_saque_creditos_v2 sc
                   WHERE sc.remuneracao_id=r.id AND sc.ativo)
  ORDER BY r.pedido_id;

  IF (SELECT coalesce(sum(valor_centavos),0) FROM public.catalogo_saque_creditos_v2 WHERE saque_id=v_id)<>v_valor
     OR (SELECT count(*) FROM public.catalogo_saque_creditos_v2 WHERE saque_id=v_id)<>v_count THEN
    RAISE EXCEPTION 'Créditos alterados durante a solicitação; transação abortada';
  END IF;
  RETURN jsonb_build_object('ok',true,'saque_id',v_id,'valor_centavos',v_valor,
    'status','solicitado','transferencia_executada',false,
    'mensagem','Solicitação registrada. Payout pendente de processamento e confirmação bancária.');
END;
$$;

CREATE OR REPLACE FUNCTION public.catalogo_motoboy_listar_saques_v2(
  p_operador_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_limite timestamptz := date_trunc('month',pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
BEGIN
  IF NOT catalogo_private.catalogo_v2_autorizado(p_operador_id) THEN
    RETURN jsonb_build_object('ok',false,'http_status',403,'mensagem','Motoboy não autorizado.');
  END IF;
  RETURN jsonb_build_object('ok',true,
    'saques',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',s.id,'valor_centavos',s.valor_centavos,'estado',s.estado,
      'criado_em',s.criado_em,'pago_em',s.pago_em,
      'detalhe_status',s.detalhe_status) ORDER BY s.criado_em DESC)
      FROM (SELECT * FROM public.catalogo_saques_motoboy_v2
            WHERE motoboy_id=p_operador_id ORDER BY criado_em DESC LIMIT 30) s),'[]'::jsonb),
    'disponivel_para_saque_centavos',
      coalesce((SELECT sum(r.valor_centavos)::bigint FROM public.catalogo_remuneracoes_v2 r
        WHERE r.motoboy_id=p_operador_id AND r.status='disponivel'
          AND r.repasse_id IS NULL AND r.financiamento_comprovado
          AND r.disponibilizado_em IS NOT NULL AND r.disponibilizado_em < v_limite
          AND catalogo_private.catalogo_v2_financiado(r.pedido_id)
          AND NOT EXISTS(SELECT 1 FROM public.catalogo_saque_creditos_v2 sc
                         WHERE sc.remuneracao_id=r.id AND sc.ativo)),0),
    'reservado_centavos',
      coalesce((SELECT sum(sc.valor_centavos)::bigint FROM public.catalogo_saque_creditos_v2 sc
        JOIN public.catalogo_saques_motoboy_v2 s ON s.id=sc.saque_id
        WHERE s.motoboy_id=p_operador_id AND sc.ativo AND s.estado NOT IN ('pago','falhou')),0),
    'minimo_saque_centavos',100,
    'limite_periodo',v_limite,
    'transferencia_automatizada_ativa',false);
END;
$$;

-- No painel administrativo, ocultar a opção de repassar créditos que já
-- foram reservados pelo motoboy. O trigger financeiro também bloqueia a baixa.
CREATE OR REPLACE FUNCTION public.catalogo_saque_creditos_reservados_v2()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $saque_reservados$
  SELECT coalesce(array_agg(sc.remuneracao_id),ARRAY[]::uuid[])
  FROM public.catalogo_saque_creditos_v2 sc
  JOIN public.catalogo_saques_motoboy_v2 s ON s.id=sc.saque_id
  WHERE sc.ativo AND s.estado <> 'pago';
$saque_reservados$;

-- Seleção para conciliação periódica: nunca exige beneficiário ou valor
-- passado por um agendador externo. Prioriza novos pedidos e reconsulta os antigos.
CREATE OR REPLACE FUNCTION public.catalogo_saque_proximo_v2()
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $saque_proximo$
  SELECT coalesce(
    (SELECT jsonb_build_object('ok',true,'saque_id',s.id)
     FROM public.catalogo_saques_motoboy_v2 s
     WHERE s.estado IN ('solicitado','processando','aguardando_confirmacao')
     ORDER BY CASE WHEN s.estado='solicitado' THEN 0 ELSE 1 END,
              s.atualizado_em ASC,s.id LIMIT 1),
    jsonb_build_object('ok',true,'saque_id',null)
  );
$saque_proximo$;

-- RPC para o worker backend. Nunca aceitar status ou IDs vindos do navegador.
-- "preparar": fixa referência e evita segunda transferência simultânea.
-- "registrar": salva IDs do payout SEM marcar como pago.
-- "confirmar": SOMENTE após GET MP transaction = success/accredited e conferir
-- id/valor/beneficiário/referência; as RPCs são bloqueadas a service_role.
CREATE OR REPLACE FUNCTION public.catalogo_saque_worker_v2(
  p_acao text,
  p_saque_id uuid,
  p_payout_id text DEFAULT NULL,
  p_transacao_id text DEFAULT NULL,
  p_status text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_s public.catalogo_saques_motoboy_v2%ROWTYPE;
  v_pedido uuid;
  v_quant integer := 0;
  v_esperado integer := 0;
  v_rep uuid;
BEGIN
  SELECT * INTO v_s FROM public.catalogo_saques_motoboy_v2 WHERE id=p_saque_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'http_status',404,'mensagem','Saque inexistente.'); END IF;
  IF p_acao='consultar' THEN
    RETURN jsonb_build_object('ok',true,'id',v_s.id,'estado',v_s.estado,
       'motoboy_id',v_s.motoboy_id,'valor_centavos',v_s.valor_centavos,
       'chave_pix_enc',v_s.chave_pix_enc,'referencia',v_s.referencia,
       'payout_id',v_s.payout_id,'transacao_id',v_s.transacao_id);
  END IF;
  IF p_acao='preparar' THEN
    IF v_s.estado='solicitado' THEN
      UPDATE public.catalogo_saques_motoboy_v2 SET estado='processando',atualizado_em=now() WHERE id=v_s.id;
    ELSIF v_s.estado NOT IN ('processando','aguardando_confirmacao') THEN
      RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Saque não processável.');
    END IF;
    RETURN jsonb_build_object('ok',true,'id',v_s.id,'referencia',v_s.referencia,'estado','processando');
  END IF;
  IF p_acao='registrar' THEN
    IF v_s.estado NOT IN ('processando','aguardando_confirmacao') OR
       p_payout_id IS NULL OR p_transacao_id IS NULL OR length(p_payout_id)>100 OR length(p_transacao_id)>100 THEN
      RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Comprovante do provedor inválido.');
    END IF;
    IF (v_s.payout_id IS NOT NULL AND v_s.payout_id<>p_payout_id)
       OR (v_s.transacao_id IS NOT NULL AND v_s.transacao_id<>p_transacao_id) THEN
      RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Payout divergente.');
    END IF;
    UPDATE public.catalogo_saques_motoboy_v2
      SET estado='aguardando_confirmacao', payout_id=p_payout_id,
          transacao_id=p_transacao_id, provedor_status=left(coalesce(p_status,''),70), atualizado_em=now()
    WHERE id=v_s.id;
    RETURN jsonb_build_object('ok',true,'estado','aguardando_confirmacao');
  END IF;
  IF p_acao='confirmar' THEN
    IF v_s.estado='pago' THEN RETURN jsonb_build_object('ok',true,'idempotente',true,'transferencia_executada',true); END IF;
    IF v_s.estado<>'aguardando_confirmacao'
       OR v_s.payout_id IS NULL OR v_s.transacao_id IS NULL
       OR p_payout_id IS DISTINCT FROM v_s.payout_id OR p_transacao_id IS DISTINCT FROM v_s.transacao_id
       OR p_status IS DISTINCT FROM 'success/accredited' THEN
      RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Transferência ainda não comprovada.');
    END IF;
    -- Verifica que os créditos reservados continuam financiados e disponíveis.
    FOR v_pedido IN SELECT DISTINCT r.pedido_id FROM public.catalogo_saque_creditos_v2 sc
      JOIN public.catalogo_remuneracoes_v2 r ON r.id=sc.remuneracao_id
      WHERE sc.saque_id=v_s.id AND sc.ativo ORDER BY r.pedido_id
    LOOP
      PERFORM 1 FROM public.catalogo_pedidos WHERE id=v_pedido FOR UPDATE;
    END LOOP;
    PERFORM 1 FROM public.catalogo_remuneracoes_v2 r JOIN public.catalogo_saque_creditos_v2 sc
      ON sc.remuneracao_id=r.id WHERE sc.saque_id=v_s.id AND sc.ativo
      ORDER BY r.pedido_id FOR UPDATE OF r;
    SELECT count(*),coalesce(sum(r.valor_centavos),0) INTO v_quant,v_esperado
    FROM public.catalogo_remuneracoes_v2 r JOIN public.catalogo_saque_creditos_v2 sc ON sc.remuneracao_id=r.id
    WHERE sc.saque_id=v_s.id AND sc.ativo AND r.motoboy_id=v_s.motoboy_id
      AND r.status='disponivel' AND r.repasse_id IS NULL
      AND r.financiamento_comprovado AND catalogo_private.catalogo_v2_financiado(r.pedido_id);
    IF v_quant=0 OR v_esperado<>v_s.valor_centavos THEN
      UPDATE public.catalogo_saques_motoboy_v2 SET estado='revisao',detalhe_status='Crédito externo comprovado, mas financiamento interno mudou',atualizado_em=now() WHERE id=v_s.id;
      RETURN jsonb_build_object('ok',false,'http_status',409,
        'mensagem','Transferência bancária confirmada; conciliação contábil exige revisão.');
    END IF;
    UPDATE public.catalogo_saques_motoboy_v2
       SET estado='pago',provedor_status='success/accredited',pago_em=now(),atualizado_em=now()
     WHERE id=v_s.id;
    INSERT INTO public.catalogo_repasses_v2(motoboy_id,valor_centavos,referencia,comprovante,registrado_por,metadata)
    VALUES(v_s.motoboy_id,v_s.valor_centavos,v_s.referencia,
       'Mercado Pago Payout confirmado por consulta autenticada ao provedor',
       '4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid,
       jsonb_build_object('saque_id',v_s.id,'payout_id',v_s.payout_id,'transacao_id',v_s.transacao_id))
    RETURNING id INTO v_rep;
    UPDATE public.catalogo_remuneracoes_v2 r SET status='pago',repasse_id=v_rep,pago_em=now()
      FROM public.catalogo_saque_creditos_v2 sc
     WHERE sc.saque_id=v_s.id AND sc.ativo AND sc.remuneracao_id=r.id;
    UPDATE public.catalogo_lancamentos_financeiros_v2 l
       SET status='pago',referencia=v_s.referencia,atualizado_em=now()
     FROM public.catalogo_saque_creditos_v2 sc
     WHERE sc.saque_id=v_s.id AND sc.ativo AND l.remuneracao_id=sc.remuneracao_id;
    RETURN jsonb_build_object('ok',true,'saque_id',v_s.id,'repasse_id',v_rep,
      'valor_centavos',v_s.valor_centavos,'transferencia_executada',true);
  END IF;
  IF p_acao='observado' THEN
    IF v_s.estado='aguardando_confirmacao' THEN
      UPDATE public.catalogo_saques_motoboy_v2 SET atualizado_em=now() WHERE id=v_s.id;
    END IF;
    RETURN jsonb_build_object('ok',true,'estado',v_s.estado);
  END IF;
  IF p_acao='falha' THEN
    -- Só liberar reserva se provedor comprovadamente rejeitou sem transferir.
    IF v_s.estado NOT IN ('processando','aguardando_confirmacao') OR p_status IS DISTINCT FROM 'rejected' THEN
      RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Status do provedor inconclusivo.');
    END IF;
    UPDATE public.catalogo_saques_motoboy_v2 SET estado='falhou',provedor_status='rejected',atualizado_em=now() WHERE id=v_s.id;
    UPDATE public.catalogo_saque_creditos_v2 SET ativo=false WHERE saque_id=v_s.id;
    RETURN jsonb_build_object('ok',true,'estado','falhou','transferencia_executada',false);
  END IF;
  RETURN jsonb_build_object('ok',false,'http_status',400,'mensagem','Ação de worker inválida.');
END;
$$;

REVOKE ALL ON FUNCTION
  public.catalogo_motoboy_solicitar_saque_v2(uuid),
  public.catalogo_motoboy_listar_saques_v2(uuid),
  public.catalogo_saque_creditos_reservados_v2(),
  public.catalogo_saque_proximo_v2(),
  public.catalogo_saque_worker_v2(text,uuid,text,text,text)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
  public.catalogo_motoboy_solicitar_saque_v2(uuid),
  public.catalogo_motoboy_listar_saques_v2(uuid),
  public.catalogo_saque_creditos_reservados_v2(),
  public.catalogo_saque_proximo_v2(),
  public.catalogo_saque_worker_v2(text,uuid,text,text,text)
TO service_role;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_bloquear_repasse_com_saque_v2() FROM PUBLIC,anon,authenticated;
COMMIT;
