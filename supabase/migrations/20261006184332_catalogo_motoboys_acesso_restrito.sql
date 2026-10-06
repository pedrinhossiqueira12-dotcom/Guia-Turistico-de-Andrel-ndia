-- Contas de motoboy e atribuicao explicita de pedidos; nao libera produtos ou faturas.
BEGIN;
ALTER TABLE public.catalogo_pedidos ADD COLUMN IF NOT EXISTS status_token_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS catalogo_pedidos_status_token_hash_key
  ON public.catalogo_pedidos(status_token_hash) WHERE status_token_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS catalogo_pedidos_id_comercio_key ON public.catalogo_pedidos(id,comercio_id);

CREATE TABLE IF NOT EXISTS public.catalogo_motoboys (
  comercio_id text NOT NULL REFERENCES public.catalogos(comercio_id),
  usuario_id uuid NOT NULL REFERENCES auth.users(id),
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 120),
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 180),
  ativo boolean NOT NULL DEFAULT true,
  autorizado_por uuid NOT NULL REFERENCES auth.users(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(comercio_id,usuario_id)
);
CREATE TABLE IF NOT EXISTS public.catalogo_entregas_atribuidas (
  pedido_id uuid PRIMARY KEY,
  comercio_id text NOT NULL,
  motoboy_id uuid NOT NULL,
  atribuido_por uuid NOT NULL REFERENCES auth.users(id),
  atribuido_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(pedido_id,comercio_id) REFERENCES public.catalogo_pedidos(id,comercio_id),
  FOREIGN KEY(comercio_id,motoboy_id) REFERENCES public.catalogo_motoboys(comercio_id,usuario_id)
);
CREATE INDEX IF NOT EXISTS catalogo_entregas_motoboy_idx ON public.catalogo_entregas_atribuidas(motoboy_id,atribuido_em DESC);
CREATE TABLE IF NOT EXISTS public.catalogo_entregas_gestao_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comercio_id text NOT NULL REFERENCES public.catalogos(comercio_id),
  pedido_id uuid REFERENCES public.catalogo_pedidos(id),
  operador_id uuid NOT NULL REFERENCES auth.users(id),
  acao text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.catalogo_motoboys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_entregas_atribuidas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_entregas_gestao_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_motoboys,public.catalogo_entregas_atribuidas,public.catalogo_entregas_gestao_eventos FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.catalogo_motoboys,public.catalogo_entregas_atribuidas,public.catalogo_entregas_gestao_eventos TO service_role;

CREATE OR REPLACE FUNCTION public.catalogo_gerir_motoboys(
  p_operador_id uuid,p_acao text,p_comercio_id text,
  p_pedido_id uuid DEFAULT NULL,p_motoboy_id uuid DEFAULT NULL,
  p_email text DEFAULT NULL,p_nome text DEFAULT NULL,p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_usuario uuid;
  v_pedido public.catalogo_pedidos%ROWTYPE;
  v_nome text := left(btrim(coalesce(p_nome,'')),120);
  v_email text := lower(btrim(coalesce(p_email,'')));
  v_json jsonb;
  v_mais boolean;
BEGIN
  IF p_operador_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.catalogos c WHERE c.comercio_id=p_comercio_id
    AND (c.proprietario_id=p_operador_id OR p_operador_id='4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid)) THEN
    RETURN jsonb_build_object('ok',false,'http_status',403,'mensagem','Somente o proprietário pode gerenciar entregadores.');
  END IF;
  IF p_offset IS NULL OR p_offset<0 OR p_offset>10000 THEN
    RETURN jsonb_build_object('ok',false,'http_status',400,'mensagem','Página inválida.');
  END IF;
  IF p_acao='listar_motoboys' THEN
    SELECT coalesce(jsonb_agg(x),'[]') INTO v_json FROM (
      SELECT usuario_id,nome,email,ativo FROM public.catalogo_motoboys
       WHERE comercio_id=p_comercio_id ORDER BY nome,usuario_id LIMIT 101 OFFSET p_offset
    ) x;
    v_mais := jsonb_array_length(v_json)>100;
    SELECT coalesce(jsonb_agg(e.value),'[]') INTO v_json FROM jsonb_array_elements(v_json) WITH ORDINALITY e(value,n) WHERE e.n<=100;
    RETURN jsonb_build_object('ok',true,'motoboys',v_json,'has_more',v_mais);
  ELSIF p_acao='autorizar_motoboy' THEN
    IF char_length(v_email)>180 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR v_nome='' THEN
      RETURN jsonb_build_object('ok',false,'http_status',400,'mensagem','Informe nome e e-mail válidos.');
    END IF;
    SELECT u.id INTO v_usuario FROM auth.users u
     WHERE lower(u.email)=v_email AND u.email_confirmed_at IS NOT NULL
       AND (u.banned_until IS NULL OR u.banned_until<=now()) LIMIT 1;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok',false,'http_status',404,'mensagem','Peça ao motoboy para cadastrar e confirmar este e-mail no Guia antes de autorizá-lo.');
    END IF;
    INSERT INTO public.catalogo_motoboys(comercio_id,usuario_id,nome,email,ativo,autorizado_por)
    VALUES(p_comercio_id,v_usuario,v_nome,v_email,true,p_operador_id)
    ON CONFLICT(comercio_id,usuario_id) DO UPDATE SET nome=EXCLUDED.nome,email=EXCLUDED.email,
      ativo=true,autorizado_por=p_operador_id,atualizado_em=now();
    INSERT INTO public.catalogo_entregas_gestao_eventos(comercio_id,operador_id,acao,metadata)
      VALUES(p_comercio_id,p_operador_id,p_acao,jsonb_build_object('motoboy_id',v_usuario));
    RETURN jsonb_build_object('ok',true,'motoboy',jsonb_build_object('usuario_id',v_usuario,'nome',v_nome,'email',v_email,'ativo',true));
  ELSIF p_acao='suspender_motoboy' THEN
    UPDATE public.catalogo_motoboys SET ativo=false,atualizado_em=now()
      WHERE comercio_id=p_comercio_id AND usuario_id=p_motoboy_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'http_status',404,'mensagem','Entregador não encontrado neste comércio.'); END IF;
    INSERT INTO public.catalogo_entregas_gestao_eventos(comercio_id,operador_id,acao,metadata)
      VALUES(p_comercio_id,p_operador_id,p_acao,jsonb_build_object('motoboy_id',p_motoboy_id));
    RETURN jsonb_build_object('ok',true);
  ELSIF p_acao='atribuir_pedido' THEN
    SELECT p.* INTO v_pedido FROM public.catalogo_pedidos p
      WHERE p.id=p_pedido_id AND p.comercio_id=p_comercio_id AND p.provedor='offline' AND p.modalidade='entrega' FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'http_status',404,'mensagem','Pedido de entrega presencial não encontrado.'); END IF;
    IF v_pedido.status NOT IN ('aguardando_pagamento','em_preparo','pronto') OR v_pedido.codigo_entrega_usado_em IS NOT NULL THEN
      RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Este pedido não pode mais ser atribuído.');
    END IF;
    IF p_motoboy_id IS NULL THEN
      DELETE FROM public.catalogo_entregas_atribuidas WHERE pedido_id=p_pedido_id AND comercio_id=p_comercio_id;
    ELSE
      PERFORM 1 FROM public.catalogo_motoboys WHERE comercio_id=p_comercio_id AND usuario_id=p_motoboy_id AND ativo FOR SHARE;
      IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'http_status',403,'mensagem','Autorize este motoboy para o comércio antes de atribuir pedidos.'); END IF;
      INSERT INTO public.catalogo_entregas_atribuidas(pedido_id,comercio_id,motoboy_id,atribuido_por)
        VALUES(p_pedido_id,p_comercio_id,p_motoboy_id,p_operador_id)
        ON CONFLICT(pedido_id) DO UPDATE SET motoboy_id=EXCLUDED.motoboy_id,atribuido_por=p_operador_id,atribuido_em=now();
    END IF;
    INSERT INTO public.catalogo_entregas_gestao_eventos(comercio_id,pedido_id,operador_id,acao,metadata)
      VALUES(p_comercio_id,p_pedido_id,p_operador_id,p_acao,jsonb_build_object('motoboy_id',p_motoboy_id));
    RETURN jsonb_build_object('ok',true);
  END IF;
  RETURN jsonb_build_object('ok',false,'http_status',400,'mensagem','Ação de gestão inválida.');
END; $$;
REVOKE ALL ON FUNCTION public.catalogo_gerir_motoboys(uuid,text,text,uuid,uuid,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_gerir_motoboys(uuid,text,text,uuid,uuid,text,text,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.catalogo_confirmar_entrega_base(
  p_operador_id uuid,
  p_comercio_id text,
  p_pedido_id uuid,
  p_codigo_hash text,
  p_entregador text DEFAULT NULL,
  p_contexto_motoboy boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pedido public.catalogo_pedidos%ROWTYPE;
  v_motoboy boolean := false;
  v_nome_motoboy text;
  v_now timestamptz := pg_catalog.now();
  v_entregador text := pg_catalog.left(coalesce(nullif(pg_catalog.btrim(p_entregador), ''), 'não informado'), 120);
BEGIN
  -- O UUID sempre vem do JWT verificado. Vinculo nao concede acesso ao catalogo.
  IF p_operador_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'http_status', 403, 'mensagem', 'Acesso não autorizado.');
  END IF;
  IF coalesce(p_contexto_motoboy,false) OR NOT EXISTS (SELECT 1 FROM public.catalogos c WHERE c.comercio_id=p_comercio_id
    AND (c.proprietario_id=p_operador_id OR p_operador_id='4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid)) THEN
    v_motoboy := true;
    IF NOT EXISTS (SELECT 1 FROM public.catalogo_motoboys m WHERE m.comercio_id=p_comercio_id AND m.usuario_id=p_operador_id AND m.ativo) THEN
      RETURN jsonb_build_object('ok', false, 'http_status', 403, 'mensagem', 'Acesso não autorizado.');
    END IF;
  END IF;
  IF p_codigo_hash IS NULL OR p_codigo_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'http_status', 400, 'mensagem', 'Código de entrega inválido.');
  END IF;

  SELECT p.* INTO v_pedido
    FROM public.catalogo_pedidos p
   WHERE p.id = p_pedido_id AND p.comercio_id = p_comercio_id AND p.provedor = 'offline'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'http_status', 404, 'mensagem', 'Pedido não encontrado.');
  END IF;
  -- Sempre bloqueia primeiro o pedido, depois a atribuicao/vinculo: mesma ordem da gestao.
  IF v_motoboy THEN
    SELECT m.nome INTO v_nome_motoboy
      FROM public.catalogo_entregas_atribuidas a JOIN public.catalogo_motoboys m
        ON m.comercio_id=a.comercio_id AND m.usuario_id=a.motoboy_id
     WHERE a.pedido_id=v_pedido.id AND a.comercio_id=p_comercio_id
       AND a.motoboy_id=p_operador_id AND m.ativo
     FOR SHARE OF a,m;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'http_status', 403, 'mensagem', 'Este pedido não está atribuído à sua conta.');
    END IF;
    IF v_pedido.modalidade <> 'entrega' OR v_pedido.status <> 'pronto' THEN
      RETURN jsonb_build_object('ok', false, 'http_status', 409, 'mensagem', 'Aguarde o comércio marcar o pedido como pronto para entrega.');
    END IF;
    v_entregador := v_nome_motoboy;
  END IF;
  IF v_pedido.status NOT IN ('aguardando_pagamento', 'em_preparo', 'pronto')
     OR v_pedido.status_pagamento <> 'pendente'
     OR v_pedido.codigo_entrega_usado_em IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'http_status', 409, 'mensagem', 'Este pedido não pode mais ser concluído.');
  END IF;
  IF v_pedido.codigo_entrega_expira_em IS NULL OR v_pedido.codigo_entrega_expira_em <= v_now THEN
    RETURN jsonb_build_object('ok', false, 'http_status', 410, 'mensagem', 'O código de entrega expirou.');
  END IF;
  IF v_pedido.codigo_entrega_tentativas >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'http_status', 429, 'mensagem', 'Limite de tentativas atingido.');
  END IF;

  UPDATE public.catalogo_pedidos
     SET codigo_entrega_tentativas = codigo_entrega_tentativas + 1
   WHERE id = v_pedido.id;
  IF v_pedido.codigo_entrega_hash IS DISTINCT FROM p_codigo_hash THEN
    RETURN jsonb_build_object('ok', false, 'http_status', 403, 'mensagem', 'Código de entrega incorreto.');
  END IF;

  UPDATE public.catalogo_pedidos
     SET status = 'entregue', status_pagamento = 'aprovado', pago_em = v_now,
         concluido_em = v_now, concluido_por = p_operador_id::text,
         codigo_entrega_usado_em = v_now,
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'offline_confirmado', true, 'operador_id', p_operador_id,
           'entregador', v_entregador, 'confirmacao', CASE WHEN v_motoboy THEN 'painel_motoboy' ELSE 'painel_autenticado' END)
   WHERE id = v_pedido.id;

  INSERT INTO public.catalogo_comissoes_offline (
    pedido_id, comercio_id, competencia, subtotal_produtos_centavos, valor_comissao_centavos, metadata
  ) VALUES (
    v_pedido.id, v_pedido.comercio_id,
    date_trunc('month', v_now AT TIME ZONE 'America/Sao_Paulo')::date,
    v_pedido.subtotal_produtos_centavos, round(v_pedido.subtotal_produtos_centavos * 0.05)::integer,
    jsonb_build_object('origem', 'codigo_entrega', 'operador_id', p_operador_id)
  ) ON CONFLICT ON CONSTRAINT catalogo_comissoes_offline_pedido_id_key DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'pedido_id', v_pedido.id,
    'status', 'entregue', 'status_pagamento', 'aprovado', 'comissao_registrada', true);
END;
$$;

REVOKE ALL ON FUNCTION public.catalogo_confirmar_entrega_base(uuid,text,uuid,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.catalogo_confirmar_entrega_autenticada(
  p_operador_id uuid,p_comercio_id text,p_pedido_id uuid,p_codigo_hash text,p_entregador text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT public.catalogo_confirmar_entrega_base(p_operador_id,p_comercio_id,p_pedido_id,p_codigo_hash,p_entregador,false);
$$;
CREATE OR REPLACE FUNCTION public.catalogo_confirmar_entrega_motoboy(
  p_operador_id uuid,p_comercio_id text,p_pedido_id uuid,p_codigo_hash text
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT public.catalogo_confirmar_entrega_base(p_operador_id,p_comercio_id,p_pedido_id,p_codigo_hash,NULL,true);
$$;
REVOKE ALL ON FUNCTION public.catalogo_confirmar_entrega_motoboy(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_confirmar_entrega_motoboy(uuid,text,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.catalogo_confirmar_entrega_autenticada(uuid,text,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_confirmar_entrega_autenticada(uuid,text,uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.catalogo_confirmar_pedido_offline(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION public.catalogo_confirmar_entrega_autenticada(uuid,text,uuid,text,text)
 IS 'Backend somente: proprietário ou motoboy ativo explicitamente atribuído; JWT validado, código único, comissão e auditoria transacionais.';
CREATE OR REPLACE FUNCTION public.catalogo_pedido_status_auditar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_operador_id uuid;
  v_ator_tipo text := 'sistema';
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'entregue' AND NEW.provedor = 'offline'
       AND NEW.metadata->>'confirmacao' IN ('painel_autenticado','painel_motoboy')
       AND NEW.metadata->>'operador_id' ~ '^[0-9a-f-]{36}$'
       AND NEW.concluido_por = NEW.metadata->>'operador_id' THEN
      v_operador_id := (NEW.metadata->>'operador_id')::uuid;
      v_ator_tipo := CASE WHEN NEW.metadata->>'confirmacao'='painel_motoboy' THEN 'entregador' WHEN v_operador_id = '4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid THEN 'admin' ELSE 'comercio' END;
    END IF;
    INSERT INTO public.catalogo_pedido_eventos (pedido_id, comercio_id, de_status, para_status, ator_tipo, ator_id, motivo, metadata)
    VALUES (NEW.id, NEW.comercio_id, OLD.status, NEW.status, v_ator_tipo, v_operador_id, NULL,
      jsonb_build_object('status_pagamento', NEW.status_pagamento, 'confirmacao', NEW.metadata->>'confirmacao'));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.catalogo_pedido_status_auditar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_pedido_status_auditar() TO service_role;

CREATE OR REPLACE FUNCTION public.catalogo_listar_entregas_restritas(
  p_operador_id uuid,p_comercio_id text DEFAULT NULL,p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_pedidos jsonb; v_mais boolean; v_gestao boolean := p_comercio_id IS NOT NULL;
BEGIN
  IF p_operador_id IS NULL OR p_offset IS NULL OR p_offset<0 OR p_offset>10000 THEN
    RETURN jsonb_build_object('ok',false,'http_status',400,'mensagem','Solicitação inválida.');
  END IF;
  IF v_gestao THEN
    IF NOT EXISTS(SELECT 1 FROM public.catalogos c WHERE c.comercio_id=p_comercio_id AND
      (c.proprietario_id=p_operador_id OR p_operador_id='4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid)) THEN
      RETURN jsonb_build_object('ok',false,'http_status',403,'mensagem','Acesso não autorizado.');
    END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM public.catalogo_motoboys m WHERE m.usuario_id=p_operador_id AND m.ativo) THEN
      RETURN jsonb_build_object('ok',false,'http_status',403,'mensagem','Seu acesso como motoboy ainda não foi autorizado por um comércio.');
    END IF;
  END IF;
  SELECT coalesce(jsonb_agg(x),'[]') INTO v_pedidos FROM (
    SELECT p.id AS pedido_id,p.comercio_id,p.comercio_id AS comercio_nome,p.status,p.forma_pagamento,
      p.total_centavos,p.entrega_centavos,p.cliente_nome,p.cliente_telefone,p.cliente_endereco,
      p.cliente_numero,p.cliente_bairro,p.cliente_complemento,p.cliente_referencia,p.cliente_cidade,
      p.observacoes,p.criado_em,a.motoboy_id,
      coalesce((SELECT jsonb_agg(i) FROM (SELECT it.nome_produto,it.quantidade FROM public.catalogo_pedido_itens it
        WHERE it.pedido_id=p.id ORDER BY it.id LIMIT 50) i),'[]') AS itens
     FROM public.catalogo_pedidos p
     LEFT JOIN public.catalogo_entregas_atribuidas a ON a.pedido_id=p.id AND a.comercio_id=p.comercio_id
     LEFT JOIN public.catalogo_motoboys m ON m.comercio_id=a.comercio_id AND m.usuario_id=a.motoboy_id
     WHERE p.provedor='offline' AND p.modalidade='entrega' AND p.status IN ('aguardando_pagamento','em_preparo','pronto')
       AND p.codigo_entrega_usado_em IS NULL
       AND ((v_gestao AND p.comercio_id=p_comercio_id) OR (NOT v_gestao AND a.motoboy_id=p_operador_id AND m.ativo))
     ORDER BY p.criado_em DESC,p.id DESC LIMIT 51 OFFSET p_offset
  ) x;
  v_mais := jsonb_array_length(v_pedidos)>50;
  SELECT coalesce(jsonb_agg(e.value),'[]') INTO v_pedidos FROM jsonb_array_elements(v_pedidos) WITH ORDINALITY e(value,n) WHERE e.n<=50;
  RETURN jsonb_build_object('ok',true,'pedidos',v_pedidos,'has_more',v_mais);
END; $$;
REVOKE ALL ON FUNCTION public.catalogo_listar_entregas_restritas(uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_listar_entregas_restritas(uuid,text,integer) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
