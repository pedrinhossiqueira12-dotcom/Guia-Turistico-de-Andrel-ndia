-- Catálogo de entregas v2: snapshot financeiro, transporte, remuneração e operação auditável.
-- A política fica desligada por padrão. Esta migration é aditiva e não executa pagamentos/transferências.
BEGIN;

CREATE SCHEMA IF NOT EXISTS catalogo_private;

-- Os pedidos legados mantêm a versão 1. O snapshot da versão 2 é escolhido na criação do pedido,
-- nunca inferido retroativamente por uma configuração que mudou depois.
ALTER TABLE public.catalogo_pedidos
  ADD COLUMN IF NOT EXISTS versao_financeira smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS taxa_motoboy_centavos integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxa_total_centavos integer,
  ADD COLUMN IF NOT EXISTS aceito_em timestamptz,
  ADD COLUMN IF NOT EXISTS entrega_status text NOT NULL DEFAULT 'nao_atribuido',
  ADD COLUMN IF NOT EXISTS motoboy_preferido_id uuid,
  ADD COLUMN IF NOT EXISTS modo_distribuicao text NOT NULL DEFAULT 'rede',
  ADD COLUMN IF NOT EXISTS coletado_em timestamptz,
  ADD COLUMN IF NOT EXISTS em_entrega_em timestamptz,
  ADD COLUMN IF NOT EXISTS codigo_entrega_enc text,
  ADD COLUMN IF NOT EXISTS reembolso_pendente boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS comissao_plataforma_registrada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pagamento_revisao_pendente boolean NOT NULL DEFAULT false;

UPDATE public.catalogo_pedidos
   SET taxa_motoboy_centavos = coalesce(taxa_motoboy_centavos, 0),
       taxa_total_centavos = coalesce(taxa_total_centavos, taxa_plataforma_centavos),
       versao_financeira = coalesce(versao_financeira, 1),
       entrega_status = coalesce(entrega_status, 'nao_atribuido'),
       modo_distribuicao = coalesce(modo_distribuicao, 'rede'),
       reembolso_pendente = coalesce(reembolso_pendente, false),
       comissao_plataforma_registrada = coalesce(comissao_plataforma_registrada, false),
       pagamento_revisao_pendente = coalesce(pagamento_revisao_pendente, false);
ALTER TABLE public.catalogo_pedidos ALTER COLUMN taxa_total_centavos SET NOT NULL;
ALTER TABLE public.catalogo_pedidos ALTER COLUMN taxa_total_centavos SET DEFAULT 0;

-- A constraint antiga de repasse, que só calculava 5%, não pode impedir o snapshot 5+2.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.catalogo_pedidos'::regclass
       AND pg_get_constraintdef(oid) ILIKE '%repasse_bruto_comercio_centavos%'
  LOOP
    EXECUTE format('ALTER TABLE public.catalogo_pedidos DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.catalogo_pedidos
  DROP CONSTRAINT IF EXISTS catalogo_pedidos_versao_financeira_check,
  DROP CONSTRAINT IF EXISTS catalogo_pedidos_taxas_v2_check,
  DROP CONSTRAINT IF EXISTS catalogo_pedidos_entrega_status_v2_check,
  DROP CONSTRAINT IF EXISTS catalogo_pedidos_modo_distribuicao_v2_check;
ALTER TABLE public.catalogo_pedidos
  ADD CONSTRAINT catalogo_pedidos_versao_financeira_check
    CHECK (versao_financeira IN (1,2)),
  ADD CONSTRAINT catalogo_pedidos_taxas_v2_check
    CHECK (
      taxa_plataforma_centavos = round(subtotal_produtos_centavos * 0.05)::integer
      AND taxa_motoboy_centavos >= 0
      AND taxa_total_centavos = taxa_plataforma_centavos + taxa_motoboy_centavos
      AND ((versao_financeira = 1 AND taxa_motoboy_centavos = 0) OR (versao_financeira = 2 AND taxa_motoboy_centavos = CASE WHEN modalidade='entrega' THEN round(subtotal_produtos_centavos * 0.02)::integer ELSE 0 END))
    ),
  ADD CONSTRAINT catalogo_pedidos_repasse_snapshot_check
    CHECK (
      repasse_bruto_comercio_centavos = subtotal_produtos_centavos - taxa_total_centavos + entrega_centavos
    ),
  ADD CONSTRAINT catalogo_pedidos_entrega_status_v2_check
    CHECK (entrega_status IN ('nao_atribuido','ofertado','reservado','coletado','em_entrega','entregue','cancelamento_solicitado','cancelado')),
  ADD CONSTRAINT catalogo_pedidos_modo_distribuicao_v2_check
    CHECK (modo_distribuicao IN ('rede','direto'));
CREATE INDEX IF NOT EXISTS catalogo_pedidos_entrega_status_v2_idx
  ON public.catalogo_pedidos (entrega_status, status, criado_em DESC);
CREATE INDEX IF NOT EXISTS catalogo_pedidos_motoboy_preferido_v2_idx
  ON public.catalogo_pedidos (motoboy_preferido_id, entrega_status)
  WHERE motoboy_preferido_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.catalogo_fluxo_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  ativo boolean NOT NULL DEFAULT false,
  comercios_piloto text[] DEFAULT NULL,
  somente_pix boolean NOT NULL DEFAULT false,
  taxa_sem_entrega_percentual numeric(5,2) NOT NULL DEFAULT 5.00 CHECK (taxa_sem_entrega_percentual = 5.00),
  monitor_confiabilidade_ativo boolean NOT NULL DEFAULT false,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid NULL
);
ALTER TABLE public.catalogo_fluxo_config ADD COLUMN IF NOT EXISTS comercios_piloto text[] DEFAULT NULL;
INSERT INTO public.catalogo_fluxo_config (id, ativo, somente_pix, taxa_sem_entrega_percentual, monitor_confiabilidade_ativo)
VALUES (true, false, false, 5.00, false)
ON CONFLICT (id) DO NOTHING;

-- Perfil global permite rede multicomércio; a autorização por comércio permanece em catalogo_motoboys.
CREATE TABLE IF NOT EXISTS public.catalogo_motoboy_perfis (
  usuario_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  disponivel boolean NOT NULL DEFAULT false,
  apto boolean NOT NULL DEFAULT true,
  em_analise boolean NOT NULL DEFAULT false,
  chave_pix_enc text NULL,
  ultima_analise_em timestamptz NULL,
  sinalizacao jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.catalogo_motoboy_perfis DROP CONSTRAINT IF EXISTS catalogo_motoboy_perfis_chave_pix_enc_check;
ALTER TABLE public.catalogo_motoboy_perfis ADD CONSTRAINT catalogo_motoboy_perfis_chave_pix_enc_check
 CHECK (chave_pix_enc IS NULL OR (char_length(chave_pix_enc)<=1000 AND chave_pix_enc ~ '^pix-v2:[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$'));
-- A Edge cifra/decifra AES-GCM com AAD courier-pix-v2:<usuario_id>. SQL recebe somente ciphertext.
ALTER TABLE public.catalogo_motoboys
  ADD COLUMN IF NOT EXISTS perfil_atualizado_em timestamptz;
CREATE INDEX IF NOT EXISTS catalogo_motoboy_perfis_disponiveis_idx
  ON public.catalogo_motoboy_perfis (disponivel, apto, em_analise)
  WHERE disponivel AND apto AND NOT em_analise;

CREATE TABLE IF NOT EXISTS public.catalogo_ocorrencias_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL REFERENCES public.catalogo_pedidos(id) ON DELETE RESTRICT,
  comercio_id text NOT NULL REFERENCES public.catalogos(comercio_id) ON DELETE RESTRICT,
  motoboy_id uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  origem text NOT NULL CHECK (origem IN ('comprador','comercio','motoboy','sistema','admin')),
  categoria text NOT NULL CHECK (categoria IN ('desistencia_pre_coleta','desistencia_pos_coleta','cliente_nao_localizado','endereco_incorreto','avaria','atraso','codigo_invalido','cancelamento_comprador','cancelamento_comercio','outro')),
  status text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','em_revisao','resolvida','revertida')),
  decisao text NULL CHECK (decisao IS NULL OR decisao IN ('cancelamento_legitimo','manter','ocorrencia_comprovada')),
  comprovada boolean NOT NULL DEFAULT false,
  motivo text NULL CHECK (motivo IS NULL OR char_length(motivo) <= 1000),
  revisao_motivo text NULL CHECK (revisao_motivo IS NULL OR char_length(revisao_motivo) <= 1000),
  revisado_por uuid NULL REFERENCES auth.users(id),
  revisado_em timestamptz NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (pedido_id, motoboy_id, origem, categoria)
);
ALTER TABLE public.catalogo_ocorrencias_v2 DROP CONSTRAINT IF EXISTS catalogo_ocorrencias_v2_pedido_id_motoboy_id_origem_categoria_key;
ALTER TABLE public.catalogo_ocorrencias_v2 ADD CONSTRAINT catalogo_ocorrencias_v2_pedido_id_motoboy_id_origem_categoria_key
 UNIQUE NULLS NOT DISTINCT (pedido_id,motoboy_id,origem,categoria);
CREATE INDEX IF NOT EXISTS catalogo_ocorrencias_v2_revisao_idx
  ON public.catalogo_ocorrencias_v2 (status, criado_em DESC);
CREATE INDEX IF NOT EXISTS catalogo_ocorrencias_v2_motoboy_idx
  ON public.catalogo_ocorrencias_v2 (motoboy_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS public.catalogo_remuneracoes_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL UNIQUE REFERENCES public.catalogo_pedidos(id) ON DELETE RESTRICT,
  comercio_id text NOT NULL REFERENCES public.catalogos(comercio_id) ON DELETE RESTRICT,
  motoboy_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  valor_centavos integer NOT NULL CHECK (valor_centavos > 0),
  status text NOT NULL DEFAULT 'retido' CHECK (status IN ('retido','disponivel','pago','estornado','pendencia_revisao')),
  financiamento_comprovado boolean NOT NULL DEFAULT false,
  origem text NOT NULL DEFAULT 'codigo_entrega' CHECK (origem IN ('codigo_entrega','ajuste_admin')),
  repasse_id uuid NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  disponibilizado_em timestamptz NULL,
  pago_em timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS catalogo_remuneracoes_v2_motoboy_status_idx
  ON public.catalogo_remuneracoes_v2 (motoboy_id, status, criado_em DESC);
CREATE INDEX IF NOT EXISTS catalogo_remuneracoes_v2_disponiveis_idx
  ON public.catalogo_remuneracoes_v2 (status, motoboy_id)
  WHERE status = 'disponivel';

CREATE TABLE IF NOT EXISTS public.catalogo_lancamentos_financeiros_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid NULL REFERENCES public.catalogo_pedidos(id) ON DELETE RESTRICT,
  remuneracao_id uuid NULL REFERENCES public.catalogo_remuneracoes_v2(id) ON DELETE RESTRICT,
  beneficiario_id uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  tipo text NOT NULL CHECK (tipo IN ('comissao_plataforma','reserva_logistica','remuneracao_motoboy','estorno','pendencia_revisao')),
  valor_centavos integer NOT NULL CHECK (valor_centavos <> 0),
  status text NOT NULL DEFAULT 'retido' CHECK (status IN ('retido','disponivel','pago','estornado','pendencia_revisao')),
  chave_idempotencia text NOT NULL UNIQUE,
  referencia text NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.catalogo_lancamentos_financeiros_v2 DROP CONSTRAINT IF EXISTS catalogo_lancamentos_financeiros_v2_status_check;
ALTER TABLE public.catalogo_lancamentos_financeiros_v2 ADD CONSTRAINT catalogo_lancamentos_financeiros_v2_status_check
 CHECK(status IN ('retido','disponivel','pago','estornado','pendencia_revisao','convertido'));
CREATE INDEX IF NOT EXISTS catalogo_lancamentos_v2_pedido_idx
  ON public.catalogo_lancamentos_financeiros_v2 (pedido_id, tipo);
CREATE INDEX IF NOT EXISTS catalogo_lancamentos_v2_beneficiario_idx
  ON public.catalogo_lancamentos_financeiros_v2 (beneficiario_id, status, criado_em DESC);

CREATE TABLE IF NOT EXISTS public.catalogo_pagamentos_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL UNIQUE REFERENCES public.catalogo_pedidos(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('aprovado','estornado','refunded','charged_back','cancelado','recusado','revisao_parcial')),
  valor_centavos integer NOT NULL CHECK (valor_centavos >= 0),
  taxa_centavos integer NULL CHECK (taxa_centavos IS NULL OR taxa_centavos >= 0),
  referencia text NOT NULL UNIQUE,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.catalogo_pagamentos_v2 DROP CONSTRAINT IF EXISTS catalogo_pagamentos_v2_status_check;
ALTER TABLE public.catalogo_pagamentos_v2 ADD CONSTRAINT catalogo_pagamentos_v2_status_check CHECK(status IN ('aprovado','estornado','refunded','charged_back','cancelado','recusado','revisao_parcial'));
CREATE TABLE IF NOT EXISTS public.catalogo_pagamento_eventos_v2 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pedido_id uuid NOT NULL REFERENCES public.catalogo_pedidos(id),
 status text NOT NULL, valor_centavos integer NOT NULL, taxa_centavos integer, referencia text NOT NULL,
 criado_em timestamptz NOT NULL DEFAULT now(), UNIQUE NULLS NOT DISTINCT(pedido_id,status,taxa_centavos)
);
ALTER TABLE public.catalogo_pagamento_eventos_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_pagamento_eventos_v2 FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.catalogo_pagamento_eventos_v2 TO service_role;
CREATE INDEX IF NOT EXISTS catalogo_pagamentos_v2_status_idx
  ON public.catalogo_pagamentos_v2 (status, recebido_em DESC);

CREATE TABLE IF NOT EXISTS public.catalogo_repasses_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  motoboy_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  valor_centavos integer NOT NULL CHECK (valor_centavos > 0),
  referencia text NOT NULL UNIQUE,
  comprovante text NOT NULL CHECK (char_length(trim(comprovante)) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'registrado' CHECK (status = 'registrado'),
  registrado_por uuid NOT NULL REFERENCES auth.users(id),
  registrado_em timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.catalogo_remuneracoes_v2
  DROP CONSTRAINT IF EXISTS catalogo_remuneracoes_v2_repasse_fk;
ALTER TABLE public.catalogo_remuneracoes_v2
  ADD CONSTRAINT catalogo_remuneracoes_v2_repasse_fk
  FOREIGN KEY (repasse_id) REFERENCES public.catalogo_repasses_v2(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS catalogo_lancamentos_v2_remuneracao_unique
  ON public.catalogo_lancamentos_financeiros_v2 (remuneracao_id, tipo)
  WHERE remuneracao_id IS NOT NULL;

-- Todas as tabelas privadas ficam fechadas para o Data API; RPCs são a única superfície de backend.
ALTER TABLE public.catalogo_fluxo_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_motoboy_perfis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_ocorrencias_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_remuneracoes_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_lancamentos_financeiros_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_pagamentos_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_repasses_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.catalogo_fluxo_config, public.catalogo_motoboy_perfis,
  public.catalogo_ocorrencias_v2, public.catalogo_remuneracoes_v2,
  public.catalogo_lancamentos_financeiros_v2, public.catalogo_pagamentos_v2,
  public.catalogo_repasses_v2 FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.catalogo_fluxo_config, public.catalogo_motoboy_perfis,
  public.catalogo_ocorrencias_v2, public.catalogo_remuneracoes_v2,
  public.catalogo_lancamentos_financeiros_v2, public.catalogo_pagamentos_v2,
  public.catalogo_repasses_v2 TO service_role;

-- Remove a assinatura preliminar para evitar resolução ambígua com DEFAULT.
DROP FUNCTION IF EXISTS public.catalogo_fluxo_precificar(text,integer);
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
  SELECT * INTO v_cfg FROM public.catalogo_fluxo_config WHERE id = true;
  v_plataforma := round(p_subtotal_centavos * 0.05)::integer;
  IF coalesce(v_cfg.ativo,false) AND (v_cfg.comercios_piloto IS NULL OR p_comercio_id=ANY(v_cfg.comercios_piloto)) THEN
    v_versao := 2;
    v_motoboy := CASE WHEN p_modalidade='entrega' THEN round(p_subtotal_centavos * 0.02)::integer ELSE 0 END;
  END IF;
  RETURN jsonb_build_object(
    'ok',true,'versao_financeira',v_versao,
    'taxa_plataforma_centavos',v_plataforma,
    'taxa_motoboy_centavos',v_motoboy,
    'taxa_total_centavos',v_plataforma + v_motoboy,
    'somente_pix',v_versao=2 AND coalesce(v_cfg.somente_pix,false),
    'ativo',v_versao=2);
END;
$$;

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_v2_usuario_apto(p_usuario uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_usuario AND u.email_confirmed_at IS NOT NULL
   AND (u.banned_until IS NULL OR u.banned_until<=pg_catalog.now()));
$$;
CREATE OR REPLACE FUNCTION catalogo_private.catalogo_v2_autorizado(p_usuario uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT catalogo_private.catalogo_v2_usuario_apto(p_usuario) AND EXISTS(
   SELECT 1 FROM public.catalogo_motoboys m WHERE m.usuario_id=p_usuario AND m.ativo);
$$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_v2_usuario_apto(uuid),catalogo_private.catalogo_v2_autorizado(uuid)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.catalogo_operar_pedido_v2(
  p_operador_id uuid,
  p_comercio_id text,
  p_pedido_id uuid,
  p_acao text,
  p_motoboy_id uuid DEFAULT NULL,
  p_motivo text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_pedido public.catalogo_pedidos%ROWTYPE;
  v_admin boolean := p_operador_id = '4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid;
  v_now timestamptz := pg_catalog.now();
BEGIN
  IF p_operador_id IS NULL OR p_comercio_id IS NULL OR p_pedido_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.catalogos c WHERE c.comercio_id=p_comercio_id
                    AND (c.proprietario_id=p_operador_id OR v_admin)) THEN
    RETURN jsonb_build_object('ok',false,'http_status',403,'mensagem','Acesso não autorizado.');
  END IF;
  SELECT * INTO v_pedido FROM public.catalogo_pedidos p
   WHERE p.id=p_pedido_id AND p.comercio_id=p_comercio_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'http_status',404,'mensagem','Pedido não encontrado.'); END IF;
  IF p_acao = 'aceitar' THEN
    IF v_pedido.status NOT IN ('aguardando_pagamento','pago')
       OR (v_pedido.provedor='mercadopago' AND v_pedido.status_pagamento <> 'aprovado')
       OR v_pedido.entrega_status IN ('cancelado','entregue') THEN
      RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','O pedido não pode ser aceito neste estado.');
    END IF;
    UPDATE public.catalogo_pedidos
       SET status='em_preparo', aceito_em=coalesce(aceito_em,v_now),
           entrega_status=CASE WHEN versao_financeira=2 AND modalidade='entrega'
             THEN CASE WHEN entrega_status='cancelado' THEN 'nao_atribuido' ELSE entrega_status END
             ELSE entrega_status END
     WHERE id=v_pedido.id;
    PERFORM catalogo_private.catalogo_v2_registrar_plataforma(v_pedido.id,'aceite');
    RETURN jsonb_build_object('ok',true,'pedido_id',v_pedido.id,'status','em_preparo','aceito_em',v_now);
  ELSIF p_acao = 'pronto' THEN
    IF v_pedido.status <> 'em_preparo' OR v_pedido.aceito_em IS NULL OR v_pedido.entrega_status IN ('cancelado','entregue') THEN
      RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','O pedido ainda não pode ser disponibilizado.');
    END IF;
    UPDATE public.catalogo_pedidos
       SET status='pronto', entrega_status=CASE WHEN versao_financeira=2 AND modalidade='entrega' THEN 'ofertado' ELSE entrega_status END
     WHERE id=v_pedido.id;
    RETURN jsonb_build_object('ok',true,'pedido_id',v_pedido.id,'status','pronto','oferta',v_pedido.modalidade='entrega');
  ELSIF p_acao = 'atribuir' THEN
    IF v_pedido.modalidade <> 'entrega' OR v_pedido.coletado_em IS NOT NULL OR v_pedido.status NOT IN ('aguardando_pagamento','em_preparo','pronto','pago')
       OR v_pedido.entrega_status IN ('coletado','em_entrega','entregue','cancelado') THEN
      RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Não é possível atribuir depois da coleta.');
    END IF;
    IF p_motoboy_id IS NULL THEN
      DELETE FROM public.catalogo_entregas_atribuidas WHERE pedido_id=v_pedido.id;
      UPDATE public.catalogo_pedidos SET motoboy_preferido_id=NULL, modo_distribuicao='rede', entrega_status=CASE WHEN versao_financeira=2 THEN 'ofertado' ELSE entrega_status END WHERE id=v_pedido.id;
    ELSE
      PERFORM 1 FROM public.catalogo_motoboys m JOIN auth.users u ON u.id=m.usuario_id WHERE m.comercio_id=p_comercio_id AND m.usuario_id=p_motoboy_id AND m.ativo AND catalogo_private.catalogo_v2_usuario_apto(u.id) FOR SHARE OF m,u;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok',false,'http_status',403,'mensagem','Autorize este motoboy para o comércio antes de atribuir.');
      END IF;
      IF v_pedido.versao_financeira=1 THEN
        INSERT INTO public.catalogo_entregas_atribuidas(pedido_id,comercio_id,motoboy_id,atribuido_por)
        VALUES(v_pedido.id,p_comercio_id,p_motoboy_id,p_operador_id)
        ON CONFLICT(pedido_id) DO UPDATE SET motoboy_id=excluded.motoboy_id,atribuido_por=excluded.atribuido_por,atribuido_em=v_now;
      ELSE
        DELETE FROM public.catalogo_entregas_atribuidas WHERE pedido_id=v_pedido.id AND motoboy_id<>p_motoboy_id;
      END IF;
      UPDATE public.catalogo_pedidos SET motoboy_preferido_id=p_motoboy_id, modo_distribuicao='direto',entrega_status=CASE WHEN versao_financeira=2 AND status='pronto' AND NOT EXISTS(SELECT 1 FROM public.catalogo_entregas_atribuidas a WHERE a.pedido_id=v_pedido.id) THEN 'ofertado' ELSE entrega_status END WHERE id=v_pedido.id;
    END IF;
    INSERT INTO public.catalogo_entregas_gestao_eventos(comercio_id,pedido_id,operador_id,acao,metadata)
    VALUES(p_comercio_id,v_pedido.id,p_operador_id,p_acao,jsonb_build_object('motoboy_id',p_motoboy_id));
    RETURN jsonb_build_object('ok',true,'pedido_id',v_pedido.id,'motoboy_preferido_id',p_motoboy_id,'oferta',p_motoboy_id IS NULL);
  ELSIF p_acao IN ('solicitar_cancelamento','rejeitar_antes_aceite') THEN
    IF v_pedido.status IN ('entregue','cancelado','estornado','expirado') OR v_pedido.entrega_status IN ('entregue','cancelado') THEN
      RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Pedido encerrado; não pode ser cancelado novamente.');
    END IF;
    IF p_acao='rejeitar_antes_aceite' AND v_pedido.aceito_em IS NOT NULL THEN
      RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Depois do aceite, registre uma ocorrência para revisão.');
    END IF;
    IF v_pedido.aceito_em IS NULL AND v_pedido.status NOT IN ('em_preparo','pronto') THEN
      UPDATE public.catalogo_pedidos
         SET status='cancelado', entrega_status='cancelado', cancelado_em=v_now,
             motivo_cancelamento=left(coalesce(p_motivo,'Cancelado antes do aceite'),500),
             reembolso_pendente=(status_pagamento='aprovado')
       WHERE id=v_pedido.id;
      RETURN jsonb_build_object('ok',true,'pedido_id',v_pedido.id,'status','cancelado','reembolso_pendente',v_pedido.status_pagamento='aprovado');
    END IF;
    INSERT INTO public.catalogo_ocorrencias_v2
      (pedido_id,comercio_id,origem,categoria,motivo)
    VALUES(v_pedido.id,p_comercio_id,'comercio','cancelamento_comercio',left(coalesce(p_motivo,'Cancelamento solicitado após aceite'),1000))
    ON CONFLICT (pedido_id,motoboy_id,origem,categoria) DO UPDATE SET motivo=excluded.motivo;
    -- A ocorrência não apaga a fase física nem libera a atribuição.
    UPDATE public.catalogo_pedidos SET entrega_status=CASE WHEN coletado_em IS NULL THEN 'cancelamento_solicitado' ELSE entrega_status END WHERE id=v_pedido.id;
    RETURN jsonb_build_object('ok',true,'pedido_id',v_pedido.id,'entrega_status','cancelamento_solicitado','ocorrencia',true);
  END IF;
  RETURN jsonb_build_object('ok',false,'http_status',400,'mensagem','Ação de pedido inválida.');
END;
$$;

CREATE OR REPLACE FUNCTION public.catalogo_listar_entregas_v2(
  p_operador_id uuid,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_perfil public.catalogo_motoboy_perfis%ROWTYPE;
  v_rows jsonb;
  v_total integer;
BEGIN
  IF p_operador_id IS NULL OR p_offset IS NULL OR p_offset < 0 OR p_offset > 10000 THEN
    RETURN jsonb_build_object('ok',false,'http_status',400,'mensagem','Página inválida.');
  END IF;
  IF NOT catalogo_private.catalogo_v2_autorizado(p_operador_id) THEN
    RETURN jsonb_build_object('ok',false,'http_status',403,'mensagem','Seu acesso como motoboy ainda não foi autorizado.');
  END IF;
  INSERT INTO public.catalogo_motoboy_perfis(usuario_id) VALUES(p_operador_id) ON CONFLICT DO NOTHING;
  SELECT * INTO v_perfil FROM public.catalogo_motoboy_perfis WHERE usuario_id=p_operador_id;
  SELECT coalesce(jsonb_agg(q.item ORDER BY q.criado_em DESC, q.pedido_id), '[]'::jsonb), count(*)
    INTO v_rows,v_total
  FROM (
    SELECT p.criado_em,p.id pedido_id,
      jsonb_build_object(
        'pedido_id',p.id,'comercio_id',p.comercio_id,'comercio_nome',p.comercio_id,
        'status',p.status,'entrega_status',p.entrega_status,
        'oferta',false,'total_centavos',p.total_centavos,
        'taxa_motoboy_centavos',p.taxa_motoboy_centavos,'criado_em',p.criado_em,
        'forma_pagamento',CASE WHEN a.motoboy_id=p_operador_id THEN p.forma_pagamento ELSE NULL END,
        'status_pagamento',CASE WHEN a.motoboy_id=p_operador_id THEN p.status_pagamento ELSE NULL END,
        'cliente_nome',CASE WHEN a.motoboy_id=p_operador_id THEN p.cliente_nome ELSE NULL END,
        'cliente_telefone',CASE WHEN a.motoboy_id=p_operador_id THEN p.cliente_telefone ELSE NULL END,
        'cliente_endereco',CASE WHEN a.motoboy_id=p_operador_id THEN p.cliente_endereco ELSE NULL END,
        'cliente_numero',CASE WHEN a.motoboy_id=p_operador_id THEN p.cliente_numero ELSE NULL END,
        'cliente_bairro',CASE WHEN a.motoboy_id=p_operador_id THEN p.cliente_bairro ELSE NULL END,
        'cliente_complemento',CASE WHEN a.motoboy_id=p_operador_id THEN p.cliente_complemento ELSE NULL END,
        'cliente_referencia',CASE WHEN a.motoboy_id=p_operador_id THEN p.cliente_referencia ELSE NULL END,
        'observacoes',CASE WHEN a.motoboy_id=p_operador_id THEN p.observacoes ELSE NULL END,
        'itens',CASE WHEN a.motoboy_id=p_operador_id THEN coalesce((SELECT jsonb_agg(jsonb_build_object('nome_produto',i.nome_produto,'quantidade',i.quantidade) ORDER BY i.id) FROM public.catalogo_pedido_itens i WHERE i.pedido_id=p.id),'[]'::jsonb) ELSE '[]'::jsonb END
      ) item
    FROM public.catalogo_pedidos p
    JOIN public.catalogo_entregas_atribuidas a ON a.pedido_id=p.id AND a.motoboy_id=p_operador_id
    JOIN public.catalogo_motoboys m ON m.comercio_id=a.comercio_id AND m.usuario_id=a.motoboy_id AND m.ativo
    WHERE p.modalidade='entrega' AND p.codigo_entrega_usado_em IS NULL
      AND p.entrega_status NOT IN ('cancelado','entregue')
    UNION ALL
    SELECT p.criado_em,p.id pedido_id,
      jsonb_build_object(
        'pedido_id',p.id,'comercio_id',p.comercio_id,'comercio_nome',p.comercio_id,
        'status',p.status,'entrega_status',p.entrega_status,'oferta',true,
        'total_centavos',p.total_centavos,'taxa_motoboy_centavos',p.taxa_motoboy_centavos,'criado_em',p.criado_em
      ) item
    FROM public.catalogo_pedidos p
    JOIN public.catalogo_motoboys m ON m.comercio_id=p.comercio_id AND m.usuario_id=p_operador_id AND m.ativo
    JOIN public.catalogo_motoboy_perfis pf ON pf.usuario_id=p_operador_id AND pf.disponivel AND pf.apto AND NOT pf.em_analise
    WHERE p.versao_financeira=2 AND p.modalidade='entrega' AND p.status='pronto'
      AND p.entrega_status IN ('nao_atribuido','ofertado')
      AND p.codigo_entrega_usado_em IS NULL
      AND (p.modo_distribuicao='rede' OR p.motoboy_preferido_id=p_operador_id)
      AND NOT EXISTS (SELECT 1 FROM public.catalogo_entregas_atribuidas a2 WHERE a2.pedido_id=p.id)
    ORDER BY criado_em DESC,pedido_id LIMIT 51 OFFSET p_offset
  ) q;
  v_total := coalesce(v_total,0);
  RETURN jsonb_build_object('ok',true,'pedidos',CASE WHEN jsonb_array_length(v_rows)>50 THEN (SELECT coalesce(jsonb_agg(e.value ORDER BY e.ordinality),'[]'::jsonb) FROM jsonb_array_elements(v_rows) WITH ORDINALITY e(value,ordinality) WHERE e.ordinality<=50) ELSE v_rows END,'has_more',v_total>50);
END;
$$;

CREATE OR REPLACE FUNCTION public.catalogo_motoboy_acao_v2(
  p_operador_id uuid,
  p_acao text,
  p_pedido_id uuid DEFAULT NULL,
  p_disponivel boolean DEFAULT NULL,
  p_motivo text DEFAULT NULL,
  p_categoria text DEFAULT NULL,
  p_chave_pix text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_pedido public.catalogo_pedidos%ROWTYPE;
  v_perfil public.catalogo_motoboy_perfis%ROWTYPE;
  v_now timestamptz := pg_catalog.now();
  v_categoria text := coalesce(p_categoria,'outro');
BEGIN
  IF NOT catalogo_private.catalogo_v2_autorizado(p_operador_id) THEN RETURN jsonb_build_object('ok',false,'http_status',403,'mensagem','Acesso não autorizado.'); END IF;
  INSERT INTO public.catalogo_motoboy_perfis(usuario_id) VALUES(p_operador_id) ON CONFLICT (usuario_id) DO NOTHING;
  IF p_acao='disponibilidade' THEN
    IF p_disponivel IS NULL THEN RETURN jsonb_build_object('ok',false,'http_status',400,'mensagem','Disponibilidade inválida.'); END IF;
    UPDATE public.catalogo_motoboy_perfis SET disponivel=p_disponivel, atualizado_em=v_now WHERE usuario_id=p_operador_id;
    RETURN jsonb_build_object('ok',true,'disponivel',p_disponivel);
  ELSIF p_acao='salvar_chave_pix' THEN
    IF p_chave_pix IS NOT NULL AND (char_length(p_chave_pix)>1000 OR p_chave_pix !~ '^pix-v2:[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$') THEN
      RETURN jsonb_build_object('ok',false,'http_status',400,'mensagem','Chave Pix inválida.');
    END IF;
    UPDATE public.catalogo_motoboy_perfis SET chave_pix_enc=p_chave_pix, atualizado_em=v_now WHERE usuario_id=p_operador_id;
    RETURN jsonb_build_object('ok',true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.catalogo_motoboys m WHERE m.usuario_id=p_operador_id AND m.ativo) THEN
    RETURN jsonb_build_object('ok',false,'http_status',403,'mensagem','Sua conta não está autorizada por um comércio.');
  END IF;
  IF p_pedido_id IS NULL THEN RETURN jsonb_build_object('ok',false,'http_status',400,'mensagem','Pedido obrigatório.'); END IF;
  SELECT * INTO v_pedido FROM public.catalogo_pedidos p WHERE p.id=p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'http_status',404,'mensagem','Pedido não encontrado.'); END IF;
  -- Pedido primeiro; vínculo EXATO e auth protegidos contra suspensão simultânea.
  PERFORM 1 FROM public.catalogo_motoboys m JOIN auth.users u ON u.id=m.usuario_id
   WHERE m.comercio_id=v_pedido.comercio_id AND m.usuario_id=p_operador_id AND m.ativo
     AND catalogo_private.catalogo_v2_usuario_apto(u.id) FOR SHARE OF m,u;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'http_status',403,'mensagem','Vínculo ativo necessário neste comércio.'); END IF;
  IF v_pedido.modalidade<>'entrega' OR v_pedido.status IN ('entregue','cancelado','estornado','expirado') OR v_pedido.entrega_status IN ('entregue','cancelado') THEN
    RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Pedido encerrado ou não é uma entrega.');
  END IF;
  IF p_acao='aceitar_entrega' THEN
    IF v_pedido.versao_financeira<>2 OR v_pedido.aceito_em IS NULL OR v_pedido.modalidade <> 'entrega' OR v_pedido.status <> 'pronto'
       OR v_pedido.entrega_status NOT IN ('nao_atribuido','ofertado')
       OR (v_pedido.modo_distribuicao='direto' AND v_pedido.motoboy_preferido_id IS DISTINCT FROM p_operador_id) THEN
      RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Esta oferta já não está disponível.');
    END IF;
    SELECT * INTO v_perfil FROM public.catalogo_motoboy_perfis WHERE usuario_id=p_operador_id FOR UPDATE;
    IF NOT FOUND OR NOT v_perfil.disponivel OR NOT v_perfil.apto OR v_perfil.em_analise THEN
      RETURN jsonb_build_object('ok',false,'http_status',403,'mensagem','Sua conta não está disponível para novas ofertas.');
    END IF;
    IF EXISTS (SELECT 1 FROM public.catalogo_entregas_atribuidas a WHERE a.pedido_id=v_pedido.id) THEN
      RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Outro motoboy aceitou primeiro.');
    END IF;
    INSERT INTO public.catalogo_entregas_atribuidas(pedido_id,comercio_id,motoboy_id,atribuido_por)
    VALUES(v_pedido.id,v_pedido.comercio_id,p_operador_id,p_operador_id);
    UPDATE public.catalogo_pedidos SET entrega_status='reservado' WHERE id=v_pedido.id;
    RETURN jsonb_build_object('ok',true,'pedido_id',v_pedido.id,'entrega_status','reservado');
  ELSIF p_acao IN ('coletar','em_entrega','desistir','registrar_ocorrencia') THEN
    PERFORM 1 FROM public.catalogo_entregas_atribuidas a WHERE a.pedido_id=v_pedido.id AND a.comercio_id=v_pedido.comercio_id AND a.motoboy_id=p_operador_id FOR SHARE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok',false,'http_status',403,'mensagem','Este pedido não está atribuído à sua conta.');
    END IF;
    IF p_acao='coletar' THEN
      IF v_pedido.entrega_status <> 'reservado' AND NOT (v_pedido.versao_financeira=1 AND v_pedido.status='pronto' AND v_pedido.entrega_status='nao_atribuido') THEN RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','A coleta não é válida nesta fase.'); END IF;
      UPDATE public.catalogo_pedidos SET entrega_status='coletado', coletado_em=v_now WHERE id=v_pedido.id;
      RETURN jsonb_build_object('ok',true,'pedido_id',v_pedido.id,'entrega_status','coletado');
    ELSIF p_acao='em_entrega' THEN
      IF v_pedido.entrega_status <> 'coletado' THEN RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Registre a coleta antes de sair para entrega.'); END IF;
      UPDATE public.catalogo_pedidos SET entrega_status='em_entrega', em_entrega_em=v_now WHERE id=v_pedido.id;
      RETURN jsonb_build_object('ok',true,'pedido_id',v_pedido.id,'entrega_status','em_entrega');
    ELSIF p_acao='desistir' THEN
      IF v_pedido.coletado_em IS NULL AND v_pedido.entrega_status IN ('reservado','ofertado','nao_atribuido') THEN
        INSERT INTO public.catalogo_ocorrencias_v2(pedido_id,comercio_id,motoboy_id,origem,categoria,motivo)
        VALUES(v_pedido.id,v_pedido.comercio_id,p_operador_id,'motoboy','desistencia_pre_coleta',left(coalesce(p_motivo,'Desistência antes da coleta'),1000))
        ON CONFLICT (pedido_id,motoboy_id,origem,categoria) DO NOTHING;
        DELETE FROM public.catalogo_entregas_atribuidas WHERE pedido_id=v_pedido.id;
        UPDATE public.catalogo_pedidos SET entrega_status='ofertado', modo_distribuicao='rede' WHERE id=v_pedido.id;
        RETURN jsonb_build_object('ok',true,'pedido_id',v_pedido.id,'reofertado',true);
      END IF;
      INSERT INTO public.catalogo_ocorrencias_v2(pedido_id,comercio_id,motoboy_id,origem,categoria,motivo)
      VALUES(v_pedido.id,v_pedido.comercio_id,p_operador_id,'motoboy','desistencia_pos_coleta',left(coalesce(p_motivo,'Ocorrência após a coleta'),1000))
      ON CONFLICT (pedido_id,motoboy_id,origem,categoria) DO NOTHING;
      RETURN jsonb_build_object('ok',true,'pedido_id',v_pedido.id,'reofertado',false,'ocorrencia',true);
    ELSE
      IF v_categoria NOT IN ('cliente_nao_localizado','endereco_incorreto','avaria','atraso','codigo_invalido','outro') THEN
        RETURN jsonb_build_object('ok',false,'http_status',400,'mensagem','Categoria de ocorrência inválida.');
      END IF;
      INSERT INTO public.catalogo_ocorrencias_v2(pedido_id,comercio_id,motoboy_id,origem,categoria,motivo)
      VALUES(v_pedido.id,v_pedido.comercio_id,p_operador_id,'motoboy',v_categoria,left(coalesce(p_motivo,'Ocorrência registrada'),1000))
      ON CONFLICT (pedido_id,motoboy_id,origem,categoria) DO UPDATE SET motivo=excluded.motivo;
      RETURN jsonb_build_object('ok',true,'pedido_id',v_pedido.id,'ocorrencia',true);
    END IF;
  END IF;
  RETURN jsonb_build_object('ok',false,'http_status',400,'mensagem','Ação de motoboy inválida.');
END;
$$;

CREATE OR REPLACE FUNCTION public.catalogo_motoboy_extrato_v2(
  p_operador_id uuid,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
    'perfil',jsonb_build_object('disponivel',v_perfil.disponivel,'chave_pix_enc',v_perfil.chave_pix_enc));
END;
$$;

CREATE OR REPLACE FUNCTION public.catalogo_cancelar_comprador_v2(
  p_pedido_id uuid,
  p_status_token_hash text,
  p_motivo text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_pedido public.catalogo_pedidos%ROWTYPE; v_now timestamptz := pg_catalog.now();
BEGIN
  IF p_pedido_id IS NULL OR p_status_token_hash IS NULL OR p_status_token_hash !~ '^[0-9a-fA-F]{64}$' THEN
    RETURN jsonb_build_object('ok',false,'http_status',403,'mensagem','Não foi possível validar o pedido.');
  END IF;
  SELECT * INTO v_pedido FROM public.catalogo_pedidos WHERE id=p_pedido_id FOR UPDATE;
  IF NOT FOUND OR v_pedido.status_token_hash IS DISTINCT FROM lower(p_status_token_hash) THEN
    RETURN jsonb_build_object('ok',false,'http_status',403,'mensagem','Não foi possível validar o pedido.');
  END IF;
  IF v_pedido.aceito_em IS NOT NULL OR v_pedido.status IN ('em_preparo','pronto','entregue') OR v_pedido.entrega_status IN ('reservado','coletado','em_entrega','entregue','cancelamento_solicitado') THEN
    RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Seu pedido já está sendo preparado pelo estabelecimento e não pode mais ser cancelado normalmente. Se existir um problema com o pedido entre em contato com o estabelecimento via WhatsApp.');
  END IF;
  IF v_pedido.status IN ('cancelado','estornado') THEN RETURN jsonb_build_object('ok',true,'pedido_id',v_pedido.id,'status',v_pedido.status); END IF;
  UPDATE public.catalogo_pedidos
     SET status='cancelado',entrega_status='cancelado',cancelado_em=v_now,
         motivo_cancelamento=left(coalesce(p_motivo,'Cancelado pelo comprador'),500),
         reembolso_pendente=(status_pagamento='aprovado')
   WHERE id=v_pedido.id;
  INSERT INTO public.catalogo_ocorrencias_v2(pedido_id,comercio_id,origem,categoria,motivo)
  VALUES(v_pedido.id,v_pedido.comercio_id,'comprador','cancelamento_comprador',left(coalesce(p_motivo,'Cancelamento solicitado pelo comprador'),1000))
  ON CONFLICT (pedido_id,motoboy_id,origem,categoria) DO NOTHING;
  RETURN jsonb_build_object('ok',true,'pedido_id',v_pedido.id,'status','cancelado','reembolso_pendente',v_pedido.status_pagamento='aprovado');
END;
$$;

-- Implementação anterior preservada com nome explícito; só é usada por pedidos offline v1.
CREATE OR REPLACE FUNCTION public.catalogo_confirmar_entrega_base_legacy(
  p_operador_id uuid,p_comercio_id text,p_pedido_id uuid,p_codigo_hash text,
  p_entregador text DEFAULT NULL,p_contexto_motoboy boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_pedido public.catalogo_pedidos%ROWTYPE; v_motoboy boolean := coalesce(p_contexto_motoboy,false); v_nome text; v_now timestamptz:=pg_catalog.now();
BEGIN
  IF p_operador_id IS NULL OR p_codigo_hash IS NULL OR p_codigo_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok',false,'http_status',400,'mensagem','Código de entrega inválido.'); END IF;
  IF NOT v_motoboy AND NOT EXISTS (SELECT 1 FROM public.catalogos c WHERE c.comercio_id=p_comercio_id AND (c.proprietario_id=p_operador_id OR p_operador_id='4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid)) THEN RETURN jsonb_build_object('ok',false,'http_status',403,'mensagem','Acesso não autorizado.'); END IF;
  SELECT * INTO v_pedido FROM public.catalogo_pedidos WHERE id=p_pedido_id AND comercio_id=p_comercio_id AND provedor='offline' AND versao_financeira=1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'http_status',404,'mensagem','Pedido não encontrado.'); END IF;
  IF v_motoboy THEN
    SELECT m.nome INTO v_nome FROM public.catalogo_entregas_atribuidas a JOIN public.catalogo_motoboys m ON m.comercio_id=a.comercio_id AND m.usuario_id=a.motoboy_id JOIN auth.users u ON u.id=m.usuario_id WHERE a.pedido_id=v_pedido.id AND a.comercio_id=p_comercio_id AND a.motoboy_id=p_operador_id AND m.ativo AND catalogo_private.catalogo_v2_usuario_apto(p_operador_id) FOR SHARE OF a,m,u;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'http_status',403,'mensagem','Este pedido não está atribuído à sua conta.'); END IF;
    IF v_pedido.modalidade <> 'entrega' OR v_pedido.status <> 'pronto' THEN RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Aguarde o comércio marcar o pedido como pronto para entrega.'); END IF;
  END IF;
  IF v_pedido.status NOT IN ('aguardando_pagamento','em_preparo','pronto') OR v_pedido.status_pagamento <> 'pendente' OR v_pedido.codigo_entrega_usado_em IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Este pedido não pode mais ser concluído.'); END IF;
  IF v_pedido.codigo_entrega_expira_em IS NULL OR v_pedido.codigo_entrega_expira_em <= v_now THEN RETURN jsonb_build_object('ok',false,'http_status',410,'mensagem','O código de entrega expirou.'); END IF;
  IF v_pedido.codigo_entrega_tentativas >= 5 THEN RETURN jsonb_build_object('ok',false,'http_status',429,'mensagem','Limite de tentativas atingido.'); END IF;
  UPDATE public.catalogo_pedidos SET codigo_entrega_tentativas=codigo_entrega_tentativas+1 WHERE id=v_pedido.id;
  IF v_pedido.codigo_entrega_hash IS DISTINCT FROM p_codigo_hash THEN RETURN jsonb_build_object('ok',false,'http_status',403,'mensagem','Código de entrega incorreto.'); END IF;
  UPDATE public.catalogo_pedidos SET status='entregue',status_pagamento='aprovado',pago_em=v_now,concluido_em=v_now,concluido_por=CASE WHEN v_motoboy THEN p_operador_id::text ELSE left(coalesce(p_entregador,'não informado'),120) END,codigo_entrega_usado_em=v_now,entrega_status='entregue',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('offline_confirmado',true,'operador_id',p_operador_id,'confirmacao',CASE WHEN v_motoboy THEN 'painel_motoboy' ELSE 'painel_autenticado' END) WHERE id=v_pedido.id;
  INSERT INTO public.catalogo_comissoes_offline(pedido_id,comercio_id,competencia,subtotal_produtos_centavos,valor_comissao_centavos,metadata)
  VALUES(v_pedido.id,v_pedido.comercio_id,date_trunc('month',v_now AT TIME ZONE 'America/Sao_Paulo')::date,v_pedido.subtotal_produtos_centavos,round(v_pedido.subtotal_produtos_centavos*0.05)::integer,jsonb_build_object('origem','codigo_entrega','operador_id',p_operador_id)) ON CONFLICT ON CONSTRAINT catalogo_comissoes_offline_pedido_id_key DO NOTHING;
  RETURN jsonb_build_object('ok',true,'pedido_id',v_pedido.id,'status','entregue','status_pagamento','aprovado','comissao_registrada',true,'remuneracao_registrada',false);
END;
$$;

CREATE OR REPLACE FUNCTION public.catalogo_confirmar_entrega_base(
  p_operador_id uuid,p_comercio_id text,p_pedido_id uuid,p_codigo_hash text,
  p_entregador text DEFAULT NULL,p_contexto_motoboy boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_pedido public.catalogo_pedidos%ROWTYPE; v_now timestamptz:=pg_catalog.now(); v_funded boolean; v_rid uuid; v_remid uuid; v_sem_entrega boolean;
BEGIN
  SELECT * INTO v_pedido FROM public.catalogo_pedidos WHERE id=p_pedido_id AND comercio_id=p_comercio_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'http_status',404,'mensagem','Pedido não encontrado.'); END IF;
  IF v_pedido.versao_financeira=1 AND v_pedido.provedor='offline' THEN RETURN public.catalogo_confirmar_entrega_base_legacy(p_operador_id,p_comercio_id,p_pedido_id,p_codigo_hash,p_entregador,p_contexto_motoboy); END IF;
  v_sem_entrega:=v_pedido.versao_financeira=2 AND v_pedido.modalidade<>'entrega';
  IF v_sem_entrega THEN
    IF p_contexto_motoboy OR p_operador_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.catalogos c WHERE c.comercio_id=p_comercio_id AND (c.proprietario_id=p_operador_id OR p_operador_id='4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid)) THEN RETURN jsonb_build_object('ok',false,'http_status',403,'mensagem','Acesso não autorizado.'); END IF;
  ELSIF NOT coalesce(p_contexto_motoboy,false) OR p_operador_id IS NULL THEN RETURN jsonb_build_object('ok',false,'http_status',403,'mensagem','Somente o responsável ativo pode confirmar esta entrega.'); END IF;
  IF p_codigo_hash IS NULL OR p_codigo_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok',false,'http_status',400,'mensagem','Código inválido.'); END IF;
  IF NOT v_sem_entrega THEN
  SELECT a.motoboy_id INTO v_rid FROM public.catalogo_entregas_atribuidas a JOIN public.catalogo_motoboys m ON m.comercio_id=a.comercio_id AND m.usuario_id=a.motoboy_id AND m.ativo JOIN auth.users u ON u.id=m.usuario_id WHERE a.pedido_id=v_pedido.id AND a.comercio_id=p_comercio_id AND a.motoboy_id=p_operador_id AND catalogo_private.catalogo_v2_usuario_apto(u.id) FOR SHARE OF a,m,u;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'http_status',403,'mensagem','Este pedido não está atribuído à sua conta.'); END IF;
  END IF;
  IF v_pedido.status IN ('cancelado','estornado','expirado','entregue') OR v_pedido.status_pagamento IN ('estornado','contestado','cancelado','recusado') OR v_pedido.codigo_entrega_usado_em IS NOT NULL OR v_pedido.entrega_status IN ('cancelado','entregue') THEN RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Pedido encerrado.'); END IF;
  IF v_sem_entrega AND (v_pedido.aceito_em IS NULL OR v_pedido.status NOT IN ('em_preparo','pronto') OR NOT v_pedido.comissao_plataforma_registrada) THEN RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Aceite prévio obrigatório.'); END IF;
  IF NOT v_sem_entrega AND (v_pedido.modalidade <> 'entrega' OR (v_pedido.versao_financeira=2 AND (v_pedido.aceito_em IS NULL OR v_pedido.entrega_status NOT IN ('coletado','em_entrega'))) OR (v_pedido.versao_financeira=1 AND (v_pedido.status<>'pronto' OR v_pedido.status_pagamento<>'aprovado'))) THEN RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','A coleta e a saída para entrega precisam ser registradas antes da confirmação.'); END IF;
  IF v_pedido.codigo_entrega_hash IS NULL OR v_pedido.codigo_entrega_expira_em IS NULL OR v_pedido.codigo_entrega_expira_em <= v_now THEN RETURN jsonb_build_object('ok',false,'http_status',410,'mensagem','O código de entrega expirou.'); END IF;
  IF v_pedido.codigo_entrega_tentativas >= 5 THEN RETURN jsonb_build_object('ok',false,'http_status',429,'mensagem','Limite de tentativas atingido.'); END IF;
  UPDATE public.catalogo_pedidos SET codigo_entrega_tentativas=codigo_entrega_tentativas+1 WHERE id=v_pedido.id;
  IF v_pedido.codigo_entrega_hash IS DISTINCT FROM p_codigo_hash THEN RETURN jsonb_build_object('ok',false,'http_status',403,'mensagem','Código de entrega incorreto.'); END IF;
  v_funded := catalogo_private.catalogo_v2_financiado(v_pedido.id);
  IF v_pedido.provedor='offline' THEN v_pedido.status_pagamento:='aprovado'; END IF;
  UPDATE public.catalogo_pedidos SET status='entregue',status_pagamento=v_pedido.status_pagamento,pago_em=CASE WHEN provedor='offline' THEN coalesce(pago_em,v_now) ELSE pago_em END,entrega_status='entregue',concluido_em=v_now,concluido_por=p_operador_id::text,codigo_entrega_usado_em=v_now,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('confirmacao',CASE WHEN v_sem_entrega THEN 'painel_autenticado' ELSE 'painel_motoboy' END,'operador_id',p_operador_id) WHERE id=v_pedido.id;
  IF v_pedido.versao_financeira=1 OR v_pedido.taxa_motoboy_centavos=0 THEN RETURN jsonb_build_object('ok',true,'pedido_id',v_pedido.id,'status','entregue','remuneracao_registrada',false); END IF;
  INSERT INTO public.catalogo_remuneracoes_v2(pedido_id,comercio_id,motoboy_id,valor_centavos,status,financiamento_comprovado,disponibilizado_em,metadata)
  VALUES(v_pedido.id,v_pedido.comercio_id,p_operador_id,v_pedido.taxa_motoboy_centavos,CASE WHEN v_funded THEN 'disponivel' ELSE 'retido' END,v_funded,CASE WHEN v_funded THEN v_now ELSE NULL END,jsonb_build_object('codigo_confirmado_em',v_now))
  ON CONFLICT (pedido_id) DO NOTHING;
  SELECT id INTO v_remid FROM public.catalogo_remuneracoes_v2 WHERE pedido_id=v_pedido.id;
  IF v_pedido.provedor='offline' THEN PERFORM catalogo_private.catalogo_v2_cobrar_logistica(v_pedido.id,v_remid,p_operador_id); END IF;
  INSERT INTO public.catalogo_lancamentos_financeiros_v2(pedido_id,remuneracao_id,beneficiario_id,tipo,valor_centavos,status,chave_idempotencia,metadata)
  VALUES(v_pedido.id,v_remid,p_operador_id,'remuneracao_motoboy',v_pedido.taxa_motoboy_centavos,CASE WHEN v_funded THEN 'disponivel' ELSE 'retido' END,'remuneracao:'||v_pedido.id::text,jsonb_build_object('financiamento_comprovado',v_funded))
  ON CONFLICT (chave_idempotencia) DO UPDATE SET status=CASE WHEN public.catalogo_lancamentos_financeiros_v2.status='retido' AND v_funded THEN 'disponivel' ELSE public.catalogo_lancamentos_financeiros_v2.status END;
  UPDATE public.catalogo_lancamentos_financeiros_v2 SET status='convertido',atualizado_em=v_now,metadata=metadata||jsonb_build_object('remuneracao_id',v_remid,'convertido_por_codigo',true) WHERE pedido_id=v_pedido.id AND tipo='reserva_logistica' AND status='retido';
  RETURN jsonb_build_object('ok',true,'pedido_id',v_pedido.id,'status','entregue','status_pagamento',v_pedido.status_pagamento,'remuneracao_registrada',true,'remuneracao_status',CASE WHEN v_funded THEN 'disponivel' ELSE 'retido' END);
END;
$$;

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

CREATE OR REPLACE FUNCTION public.catalogo_aplicar_pagamento_v2(
 p_pedido_id uuid,p_status text,p_valor_centavos integer,p_taxa_centavos integer,p_referencia text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_pedido public.catalogo_pedidos%ROWTYPE; v_old public.catalogo_pagamentos_v2%ROWTYPE;
 v_status text:=lower(trim(coalesce(p_status,''))); v_funded boolean; v_exists boolean; v_idempotente boolean:=false;
BEGIN
 IF p_pedido_id IS NULL OR p_referencia IS NULL OR char_length(trim(p_referencia))=0 OR char_length(p_referencia)>180
  OR p_valor_centavos IS NULL OR p_valor_centavos<0 OR p_taxa_centavos<0 THEN RETURN jsonb_build_object('ok',false,'http_status',400,'mensagem','Referência/valor inválido.'); END IF;
 IF v_status='approved' THEN v_status:='aprovado'; END IF;
 IF v_status='refunded' THEN v_status:='estornado'; END IF;
 IF v_status NOT IN ('aprovado','estornado','charged_back','cancelado','recusado','revisao_parcial') THEN RETURN jsonb_build_object('ok',false,'http_status',400,'mensagem','Estado inválido.'); END IF;
 SELECT * INTO v_pedido FROM public.catalogo_pedidos WHERE id=p_pedido_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'http_status',404,'mensagem','Pedido não encontrado.'); END IF;
 IF v_pedido.provedor<>'mercadopago' THEN RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Recebimento do cliente presencial não é receita recebida pela plataforma.'); END IF;
 SELECT * INTO v_old FROM public.catalogo_pagamentos_v2 WHERE pedido_id=p_pedido_id FOR UPDATE; v_exists:=FOUND;
 IF EXISTS(SELECT 1 FROM public.catalogo_pagamentos_v2 WHERE referencia=p_referencia AND pedido_id<>p_pedido_id) THEN RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Referência pertence a outro pedido.'); END IF;
 IF p_valor_centavos<>v_pedido.total_centavos THEN RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Valor não confere com o pedido.'); END IF;
 IF p_taxa_centavos IS NOT NULL AND p_taxa_centavos<>v_pedido.taxa_total_centavos THEN RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Taxa não confere com o snapshot.'); END IF;
 IF v_exists THEN
  IF v_old.referencia<>p_referencia OR v_old.valor_centavos<>p_valor_centavos OR (v_old.taxa_centavos IS NOT NULL AND p_taxa_centavos IS NOT NULL AND v_old.taxa_centavos<>p_taxa_centavos) THEN
   RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Pagamento já conciliado com fatos diferentes.'); END IF;
  -- Não reaprova refund/chargeback nem troca estado terminal por retry atrasado.
  IF v_old.status IN ('estornado','charged_back') AND v_status NOT IN ('estornado','charged_back') THEN RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Pagamento revertido não pode ser reaberto.'); END IF;
  IF v_old.status='revisao_parcial' AND v_status NOT IN ('revisao_parcial','estornado','charged_back') THEN RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Reembolso parcial requer revisão antes de liberar créditos.'); END IF;
  IF v_old.status='aprovado' AND v_status IN ('cancelado','recusado') THEN RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Aprovação somente é revertida por refund/chargeback.'); END IF;
  v_idempotente:=v_old.status=v_status AND (p_taxa_centavos IS NULL OR v_old.taxa_centavos=p_taxa_centavos);
  IF v_idempotente THEN RETURN jsonb_build_object('ok',true,'idempotente',true,'pedido_id',p_pedido_id,'status_pagamento',v_pedido.status_pagamento); END IF;
  UPDATE public.catalogo_pagamentos_v2 SET status=v_status,taxa_centavos=coalesce(taxa_centavos,p_taxa_centavos),
   metadata=metadata||jsonb_build_object('status_anterior',v_old.status,'atualizado_em',pg_catalog.now(),'taxa_comprovada',coalesce(v_old.taxa_centavos,p_taxa_centavos) IS NOT NULL) WHERE pedido_id=p_pedido_id;
 ELSE
  INSERT INTO public.catalogo_pagamentos_v2(pedido_id,status,valor_centavos,taxa_centavos,referencia,metadata)
  VALUES(p_pedido_id,v_status,p_valor_centavos,p_taxa_centavos,p_referencia,jsonb_build_object('taxa_comprovada',p_taxa_centavos IS NOT NULL));
 END IF;
 INSERT INTO public.catalogo_pagamento_eventos_v2(pedido_id,status,valor_centavos,taxa_centavos,referencia)
 VALUES(p_pedido_id,v_status,p_valor_centavos,coalesce(v_old.taxa_centavos,p_taxa_centavos),p_referencia) ON CONFLICT DO NOTHING;
 IF v_status='revisao_parcial' THEN
  UPDATE public.catalogo_pedidos SET status_pagamento='contestado',pagamento_revisao_pendente=true WHERE id=p_pedido_id;
  UPDATE public.catalogo_remuneracoes_v2 SET status='pendencia_revisao',financiamento_comprovado=false,metadata=metadata||jsonb_build_object('revisao_parcial',true,'status_anterior',status) WHERE pedido_id=p_pedido_id AND status IN ('retido','disponivel','pago');
  UPDATE public.catalogo_lancamentos_financeiros_v2 SET status='pendencia_revisao',atualizado_em=pg_catalog.now(),metadata=metadata||jsonb_build_object('revisao_parcial',true,'status_anterior',status) WHERE pedido_id=p_pedido_id AND tipo IN ('comissao_plataforma','reserva_logistica','remuneracao_motoboy') AND status<>'estornado';
  INSERT INTO public.catalogo_ocorrencias_v2(pedido_id,comercio_id,origem,categoria,motivo) VALUES(p_pedido_id,v_pedido.comercio_id,'sistema','outro','Reembolso parcial informado pelo provedor; revisão financeira sem imputar culpa.') ON CONFLICT(pedido_id,motoboy_id,origem,categoria) DO NOTHING;
  RETURN jsonb_build_object('ok',true,'pedido_id',p_pedido_id,'revisao_parcial',true,'status_pagamento','contestado','transferencia_executada',false);
 END IF;
 IF v_status='aprovado' THEN
  v_funded:=coalesce(v_old.taxa_centavos,p_taxa_centavos)=v_pedido.taxa_total_centavos;
  v_funded:=coalesce(v_funded,false);
  UPDATE public.catalogo_pedidos SET status_pagamento='aprovado',pago_em=coalesce(pago_em,pg_catalog.now()),
    status=CASE WHEN status='aguardando_pagamento' THEN 'pago' ELSE status END,pagamento_revisao_pendente=NOT v_funded,
    reembolso_pendente=reembolso_pendente OR status IN ('cancelado','estornado','expirado') OR entrega_status='cancelado' WHERE id=p_pedido_id;
  -- 5% permanece obrigação do aceite, não do webhook.
  PERFORM catalogo_private.catalogo_v2_registrar_plataforma(p_pedido_id,'pagamento');
  UPDATE public.catalogo_lancamentos_financeiros_v2 SET status=CASE WHEN v_funded AND NOT v_pedido.reembolso_pendente THEN 'disponivel' ELSE 'pendencia_revisao' END,
    atualizado_em=pg_catalog.now(),metadata=metadata||jsonb_build_object('taxa_comprovada',v_funded) WHERE pedido_id=p_pedido_id AND tipo='comissao_plataforma' AND status IN ('retido','pendencia_revisao');
  IF v_funded AND NOT v_pedido.reembolso_pendente AND v_pedido.status NOT IN ('cancelado','estornado','expirado') AND v_pedido.entrega_status<>'cancelado' THEN
   UPDATE public.catalogo_remuneracoes_v2 SET status='disponivel',financiamento_comprovado=true,disponibilizado_em=coalesce(disponibilizado_em,pg_catalog.now()) WHERE pedido_id=p_pedido_id AND status='retido';
   UPDATE public.catalogo_lancamentos_financeiros_v2 SET status='disponivel',atualizado_em=pg_catalog.now() WHERE pedido_id=p_pedido_id AND tipo='remuneracao_motoboy' AND status='retido';
  END IF;
  RETURN jsonb_build_object('ok',true,'pedido_id',p_pedido_id,'status_pagamento','aprovado','financiamento_comprovado',v_funded,'taxa_enriquecida',v_exists AND v_old.taxa_centavos IS NULL AND p_taxa_centavos IS NOT NULL);
 END IF;
 UPDATE public.catalogo_pedidos SET status_pagamento=CASE WHEN v_status='charged_back' THEN 'contestado' WHEN v_status='estornado' THEN 'estornado' WHEN v_status='recusado' THEN 'recusado' ELSE 'cancelado' END,
  reembolso_pendente=(v_status='charged_back'),pagamento_revisao_pendente=(v_status='charged_back') WHERE id=p_pedido_id;
 -- Nunca altera a fase física. Valor pago anterior continua auditado no repasse, sem inventar dinheiro devolvido.
 UPDATE public.catalogo_remuneracoes_v2 SET status=CASE WHEN repasse_id IS NOT NULL THEN 'pendencia_revisao' ELSE 'estornado' END,financiamento_comprovado=false
 WHERE pedido_id=p_pedido_id AND status<>'estornado';
 UPDATE public.catalogo_lancamentos_financeiros_v2 SET status=CASE WHEN status IN ('pago','pendencia_revisao') AND EXISTS(SELECT 1 FROM public.catalogo_remuneracoes_v2 r WHERE r.pedido_id=p_pedido_id AND r.repasse_id IS NOT NULL) THEN 'pendencia_revisao' ELSE 'estornado' END,atualizado_em=pg_catalog.now()
 WHERE pedido_id=p_pedido_id AND tipo IN ('comissao_plataforma','reserva_logistica','remuneracao_motoboy');
 INSERT INTO public.catalogo_lancamentos_financeiros_v2(pedido_id,beneficiario_id,tipo,valor_centavos,status,chave_idempotencia,referencia,metadata)
 SELECT r.pedido_id,r.motoboy_id,'pendencia_revisao',-r.valor_centavos,'pendencia_revisao','estorno-revisao:'||r.pedido_id::text,p_referencia,
 jsonb_build_object('motivo','Crédito já repassado antes da reversão; revisão sem transferência fictícia','repasse_id',r.repasse_id)
 FROM public.catalogo_remuneracoes_v2 r WHERE r.pedido_id=p_pedido_id AND r.repasse_id IS NOT NULL ON CONFLICT(chave_idempotencia) DO NOTHING;
 RETURN jsonb_build_object('ok',true,'pedido_id',p_pedido_id,'status_pagamento',v_status,'transferencia_executada',false);
EXCEPTION WHEN unique_violation THEN
 RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Referência de pagamento já utilizada por outro pedido.');
END;
$$;

CREATE OR REPLACE FUNCTION public.catalogo_operacao_admin_v2(
  p_operador_id uuid,
  p_acao text,
  p_ocorrencia_id uuid DEFAULT NULL,
  p_decisao text DEFAULT NULL,
  p_motivo text DEFAULT NULL,
  p_motoboy_id uuid DEFAULT NULL,
  p_pedido_ids uuid[] DEFAULT NULL,
  p_referencia text DEFAULT NULL,
  p_comprovante text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_occ public.catalogo_ocorrencias_v2%ROWTYPE;
  v_rep public.catalogo_repasses_v2%ROWTYPE;
  v_credito record;
  v_updated integer;
  v_pedido_id uuid;
  v_total integer;
  v_expected integer;
  v_json jsonb;
BEGIN
  IF p_operador_id IS DISTINCT FROM '4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid THEN RETURN jsonb_build_object('ok',false,'http_status',403,'mensagem','Somente o administrador da plataforma pode operar esta fila.'); END IF;
  IF p_acao='listar_operacao' THEN
    SELECT jsonb_build_object(
      'ocorrencias',coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id,'pedido_id',o.pedido_id,'comercio_id',o.comercio_id,'motoboy_id',o.motoboy_id,'origem',o.origem,'categoria',o.categoria,'status',o.status,'comprovada',o.comprovada,'motivo',o.motivo,'criado_em',o.criado_em) ORDER BY o.criado_em DESC) FROM public.catalogo_ocorrencias_v2 o WHERE o.status IN ('aberta','em_revisao')),'[]'::jsonb),
      'remuneracoes',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'pedido_id',r.pedido_id,'motoboy_id',r.motoboy_id,'valor_centavos',r.valor_centavos,'status',r.status,'financiamento_comprovado',r.financiamento_comprovado AND catalogo_private.catalogo_v2_financiado(r.pedido_id),'repasse_id',r.repasse_id,'metadata',r.metadata,'beneficiario_id',r.motoboy_id,'pix_ciphertext',pf.chave_pix_enc,'chave_pix_enc',pf.chave_pix_enc) ORDER BY r.criado_em DESC) FROM public.catalogo_remuneracoes_v2 r LEFT JOIN public.catalogo_motoboy_perfis pf ON pf.usuario_id=r.motoboy_id WHERE r.status IN ('disponivel','pendencia_revisao','retido')),'[]'::jsonb)) INTO v_json;
    RETURN jsonb_build_object('ok',true,'operacao',v_json);
  ELSIF p_acao='resolver_ocorrencia' THEN
    IF p_ocorrencia_id IS NULL OR p_decisao IS NULL OR p_decisao NOT IN ('cancelamento_legitimo','manter','ocorrencia_comprovada') OR char_length(trim(coalesce(p_motivo,''))) < 3 THEN RETURN jsonb_build_object('ok',false,'http_status',400,'mensagem','Revisão fundamentada é obrigatória.'); END IF;
    SELECT * INTO v_occ FROM public.catalogo_ocorrencias_v2 WHERE id=p_ocorrencia_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'http_status',404,'mensagem','Ocorrência não encontrada.'); END IF;
    UPDATE public.catalogo_ocorrencias_v2 SET status='resolvida',decisao=p_decisao,comprovada=(p_decisao='ocorrencia_comprovada'),revisao_motivo=left(p_motivo,1000),revisado_por=p_operador_id,revisado_em=pg_catalog.now() WHERE id=p_ocorrencia_id;
    IF v_occ.motoboy_id IS NOT NULL THEN
      UPDATE public.catalogo_motoboy_perfis SET em_analise=EXISTS(SELECT 1 FROM public.catalogo_ocorrencias_v2 o WHERE o.motoboy_id=v_occ.motoboy_id AND o.comprovada AND o.status='resolvida' AND o.categoria IN ('desistencia_pre_coleta','desistencia_pos_coleta','avaria','atraso')),ultima_analise_em=pg_catalog.now(),atualizado_em=pg_catalog.now() WHERE usuario_id=v_occ.motoboy_id;
    END IF;
    RETURN jsonb_build_object('ok',true,'ocorrencia_id',p_ocorrencia_id,'decisao',p_decisao,'revisada',true);
  ELSIF p_acao='registrar_repasse' THEN
    IF p_motoboy_id IS NULL OR p_pedido_ids IS NULL OR cardinality(p_pedido_ids)=0 OR char_length(trim(coalesce(p_referencia,'')))<2 OR char_length(trim(coalesce(p_comprovante,'')))<1 THEN RETURN jsonb_build_object('ok',false,'http_status',400,'mensagem','Referência, comprovante e créditos são obrigatórios.'); END IF;
    IF cardinality(p_pedido_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_pedido_ids) x) OR char_length(trim(p_referencia))>180 OR char_length(trim(p_comprovante))>500 THEN
      RETURN jsonb_build_object('ok',false,'http_status',400,'mensagem','Créditos duplicados ou prova inválida.'); END IF;
    -- Mesmo lock order de webhook/confirmação: pedidos em UUID crescente, depois créditos.
    FOR v_pedido_id IN SELECT p.id FROM public.catalogo_pedidos p WHERE p.id=ANY(p_pedido_ids) ORDER BY p.id FOR UPDATE LOOP NULL; END LOOP;
    SELECT * INTO v_rep FROM public.catalogo_repasses_v2 WHERE referencia=trim(p_referencia);
    IF FOUND THEN
      IF v_rep.motoboy_id=p_motoboy_id AND v_rep.metadata->'pedido_ids' @> to_jsonb(p_pedido_ids) AND v_rep.metadata->'pedido_ids' <@ to_jsonb(p_pedido_ids) AND v_rep.comprovante=trim(p_comprovante) THEN
        RETURN jsonb_build_object('ok',true,'idempotente',true,'repasse_id',v_rep.id,'valor_centavos',v_rep.valor_centavos,'transferencia_executada',false);
      END IF;
      RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Referência de repasse já utilizada.');
    END IF;
    v_expected:=0; v_total:=0;
    FOR v_credito IN SELECT r.* FROM public.catalogo_remuneracoes_v2 r
      WHERE r.pedido_id=ANY(p_pedido_ids) ORDER BY r.pedido_id FOR UPDATE
    LOOP
      IF v_credito.motoboy_id<>p_motoboy_id OR v_credito.status<>'disponivel' OR NOT v_credito.financiamento_comprovado OR v_credito.repasse_id IS NOT NULL OR NOT catalogo_private.catalogo_v2_financiado(v_credito.pedido_id) THEN
        RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Há créditos retidos ou já repassados.'); END IF;
      v_expected:=v_expected+1; v_total:=v_total+v_credito.valor_centavos;
    END LOOP;
    IF v_expected<>cardinality(p_pedido_ids) THEN RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Há créditos ausentes.'); END IF;
    INSERT INTO public.catalogo_repasses_v2(motoboy_id,valor_centavos,referencia,comprovante,registrado_por,metadata)
    VALUES(p_motoboy_id,v_total,left(trim(p_referencia),180),left(trim(p_comprovante),500),p_operador_id,jsonb_build_object('pedido_ids',p_pedido_ids)) RETURNING * INTO v_rep;
    UPDATE public.catalogo_remuneracoes_v2 SET status='pago',repasse_id=v_rep.id,pago_em=pg_catalog.now() WHERE pedido_id=ANY(p_pedido_ids) AND motoboy_id=p_motoboy_id AND status='disponivel';
    GET DIAGNOSTICS v_updated=ROW_COUNT;
    IF v_updated<>v_expected THEN RAISE EXCEPTION 'Repasse abortado: créditos alterados'; END IF;
    UPDATE public.catalogo_lancamentos_financeiros_v2 SET status='pago',referencia=v_rep.referencia,atualizado_em=pg_catalog.now() WHERE remuneracao_id IN (SELECT id FROM public.catalogo_remuneracoes_v2 WHERE repasse_id=v_rep.id);
    RETURN jsonb_build_object('ok',true,'repasse_id',v_rep.id,'valor_centavos',v_total,'transferencia_executada',false);
  END IF;
  RETURN jsonb_build_object('ok',false,'http_status',400,'mensagem','Ação administrativa inválida.');
EXCEPTION WHEN unique_violation THEN
 RETURN jsonb_build_object('ok',false,'http_status',409,'mensagem','Referência ou crédito já utilizado por outra operação.');
END;
$$;

CREATE OR REPLACE FUNCTION public.catalogo_reavaliar_confiabilidade_v2()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ativo boolean; v_count integer;
BEGIN
  SELECT monitor_confiabilidade_ativo INTO v_ativo FROM public.catalogo_fluxo_config WHERE id=true;
  IF NOT coalesce(v_ativo,false) THEN RETURN jsonb_build_object('ok',true,'ativo',false,'analisados',0,'efeito','somente análise'); END IF;
  UPDATE public.catalogo_motoboy_perfis pf SET ultima_analise_em=pg_catalog.now(),sinalizacao=jsonb_build_object('amostra_entregas',(SELECT count(*) FROM public.catalogo_remuneracoes_v2 r WHERE r.motoboy_id=pf.usuario_id),'ocorrencias_comprovadas',(SELECT count(*) FROM public.catalogo_ocorrencias_v2 o WHERE o.motoboy_id=pf.usuario_id AND o.comprovada=true)),atualizado_em=pg_catalog.now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('ok',true,'ativo',true,'analisados',v_count,'efeito','somente análise revisável; nenhuma entrega, pagamento ou suspensão foi executada');
END;
$$;

-- SECURITY DEFINER não transforma IDs do corpo em identidade: as Edge Functions devem passar o JWT validado.
REVOKE ALL ON FUNCTION public.catalogo_fluxo_precificar(text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_fluxo_precificar(text,integer,text) TO service_role;
REVOKE ALL ON FUNCTION public.catalogo_operar_pedido_v2(uuid,text,uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_operar_pedido_v2(uuid,text,uuid,text,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.catalogo_listar_entregas_v2(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_listar_entregas_v2(uuid,integer) TO service_role;
REVOKE ALL ON FUNCTION public.catalogo_motoboy_acao_v2(uuid,text,uuid,boolean,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_motoboy_acao_v2(uuid,text,uuid,boolean,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.catalogo_motoboy_extrato_v2(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_motoboy_extrato_v2(uuid,integer) TO service_role;
REVOKE ALL ON FUNCTION public.catalogo_cancelar_comprador_v2(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_cancelar_comprador_v2(uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.catalogo_aplicar_pagamento_v2(uuid,text,integer,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_aplicar_pagamento_v2(uuid,text,integer,integer,text) TO service_role;
REVOKE ALL ON FUNCTION public.catalogo_operacao_admin_v2(uuid,text,uuid,text,text,uuid,uuid[],text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_operacao_admin_v2(uuid,text,uuid,text,text,uuid,uuid[],text,text) TO service_role;
REVOKE ALL ON FUNCTION public.catalogo_reavaliar_confiabilidade_v2() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_reavaliar_confiabilidade_v2() TO service_role;
REVOKE ALL ON FUNCTION public.catalogo_confirmar_entrega_base_legacy(uuid,text,uuid,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.catalogo_confirmar_entrega_base(uuid,text,uuid,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.catalogo_confirmar_entrega_autenticada(uuid,text,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_confirmar_entrega_autenticada(uuid,text,uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.catalogo_confirmar_entrega_motoboy(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_confirmar_entrega_motoboy(uuid,text,uuid,text) TO service_role;

-- Fatura presencial: v1 mantém 5%; v2 entrega tem 5% + reserva 2% desde o aceite.
-- A reserva somente vira remuneração após código válido e fica retida até lastro comprovado.
ALTER TABLE public.catalogo_comissoes_offline
  ADD COLUMN IF NOT EXISTS versao_financeira smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS taxa_plataforma_centavos integer,
  ADD COLUMN IF NOT EXISTS taxa_motoboy_centavos integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_total_centavos integer,
  ADD COLUMN IF NOT EXISTS motoboy_id uuid,
  ADD COLUMN IF NOT EXISTS financiamento_logistica_comprovado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS remuneracao_id uuid;
UPDATE public.catalogo_comissoes_offline
   SET versao_financeira=coalesce(versao_financeira,1),
       taxa_plataforma_centavos=coalesce(taxa_plataforma_centavos,valor_comissao_centavos),
       taxa_motoboy_centavos=coalesce(taxa_motoboy_centavos,0),
       valor_total_centavos=coalesce(valor_total_centavos,valor_comissao_centavos),
       financiamento_logistica_comprovado=coalesce(financiamento_logistica_comprovado,false);
ALTER TABLE public.catalogo_comissoes_offline
  ALTER COLUMN taxa_plataforma_centavos SET NOT NULL,
  ALTER COLUMN valor_total_centavos SET NOT NULL;
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
   WHERE conrelid='public.catalogo_comissoes_offline'::regclass
     AND (pg_get_constraintdef(oid) ILIKE '%taxa_percentual%' OR pg_get_constraintdef(oid) ILIKE '%valor_comissao_centavos%')
  LOOP EXECUTE format('ALTER TABLE public.catalogo_comissoes_offline DROP CONSTRAINT %I',c.conname); END LOOP;
END $$;
ALTER TABLE public.catalogo_comissoes_offline
  DROP CONSTRAINT IF EXISTS catalogo_comissoes_offline_v2_snapshot_check;
ALTER TABLE public.catalogo_comissoes_offline
  ADD CONSTRAINT catalogo_comissoes_offline_v2_snapshot_check CHECK (
    versao_financeira IN (1,2)
    AND taxa_plataforma_centavos = round(subtotal_produtos_centavos * 0.05)::integer
    AND taxa_motoboy_centavos >= 0
    AND valor_total_centavos = taxa_plataforma_centavos + taxa_motoboy_centavos
    AND valor_comissao_centavos = valor_total_centavos
    AND (versao_financeira=1 AND taxa_motoboy_centavos=0 OR versao_financeira=2)
  );
CREATE INDEX IF NOT EXISTS catalogo_comissoes_offline_v2_motoboy_idx
  ON public.catalogo_comissoes_offline (motoboy_id,status,competencia)
  WHERE motoboy_id IS NOT NULL;

-- Modelo atualizado pelo integrador: total nominal 7% no aceite, 5% comissão + 2% reserva logística.
-- Reserva não é receita plataforma/remuneração disponível. Somente código válido converte os 2% em crédito.
-- Configuração continua desligada; não há transferência nem cobrança externa automática nesta migration.
CREATE TABLE IF NOT EXISTS public.catalogo_logistica_offline_v2 (
 pedido_id uuid PRIMARY KEY REFERENCES public.catalogo_pedidos(id),
 remuneracao_id uuid UNIQUE REFERENCES public.catalogo_remuneracoes_v2(id),
 comercio_id text NOT NULL REFERENCES public.catalogos(comercio_id),
 competencia date NOT NULL,
 valor_centavos integer NOT NULL CHECK(valor_centavos>0),
 status text NOT NULL DEFAULT 'aberta' CHECK(status IN ('aberta','faturada','paga')),
 criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.catalogo_fatura_componentes_v2 (
 fechamento_id uuid NOT NULL REFERENCES public.catalogo_fechamentos_offline(id),
 pedido_id uuid NOT NULL REFERENCES public.catalogo_pedidos(id),
 tipo text NOT NULL CHECK(tipo IN ('plataforma','logistica')),
 valor_centavos integer NOT NULL CHECK(valor_centavos>=0),
 PRIMARY KEY(fechamento_id,pedido_id,tipo),
 UNIQUE(pedido_id,tipo)
);
ALTER TABLE public.catalogo_logistica_offline_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_fatura_componentes_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_logistica_offline_v2,public.catalogo_fatura_componentes_v2 FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.catalogo_logistica_offline_v2,public.catalogo_fatura_componentes_v2 TO service_role;

-- Legados inseridos pelo wrapper continuam com snapshot 5%, sem depender de DEFAULT numérico inadequado.
CREATE OR REPLACE FUNCTION catalogo_private.catalogo_v2_comissao_defaults()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 NEW.taxa_plataforma_centavos:=coalesce(NEW.taxa_plataforma_centavos,NEW.valor_comissao_centavos);
 NEW.valor_total_centavos:=coalesce(NEW.valor_total_centavos,NEW.valor_comissao_centavos);
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS catalogo_comissao_v2_defaults ON public.catalogo_comissoes_offline;
CREATE TRIGGER catalogo_comissao_v2_defaults BEFORE INSERT ON public.catalogo_comissoes_offline
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_v2_comissao_defaults();

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_v2_parcela_recebida(p_pedido uuid,p_tipo text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.catalogo_fatura_componentes_v2 cp
   JOIN public.catalogo_fechamentos_offline f ON f.id=cp.fechamento_id AND f.status='pago'
   JOIN public.catalogo_fatura_cobrancas b ON b.fechamento_id=f.id AND b.status='pago'
   WHERE cp.pedido_id=p_pedido AND cp.tipo=p_tipo
    AND NULLIF(trim(b.payment_id),'') IS NOT NULL AND b.pago_em IS NOT NULL
    AND b.valor_centavos=f.total_comissao_centavos
    AND b.valor_centavos=(SELECT sum(x.valor_centavos) FROM public.catalogo_fatura_componentes_v2 x WHERE x.fechamento_id=f.id)
    AND cp.valor_centavos=CASE WHEN p_tipo='logistica' THEN (SELECT p.taxa_motoboy_centavos FROM public.catalogo_pedidos p WHERE p.id=p_pedido)
                             ELSE (SELECT p.taxa_plataforma_centavos FROM public.catalogo_pedidos p WHERE p.id=p_pedido) END
 );
$$;
CREATE OR REPLACE FUNCTION catalogo_private.catalogo_v2_financiado(p_pedido uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.catalogo_pedidos p WHERE p.id=p_pedido AND p.versao_financeira=2
  AND NOT p.reembolso_pendente AND NOT p.pagamento_revisao_pendente
  AND ((p.provedor='mercadopago' AND EXISTS(SELECT 1 FROM public.catalogo_pagamentos_v2 b WHERE b.pedido_id=p.id
       AND b.status='aprovado' AND b.valor_centavos=p.total_centavos AND b.taxa_centavos=p.taxa_total_centavos))
    OR (p.provedor='offline' AND catalogo_private.catalogo_v2_parcela_recebida(p.id,'logistica') AND catalogo_private.catalogo_v2_parcela_recebida(p.id,'plataforma') AND EXISTS(SELECT 1 FROM public.catalogo_comissoes_offline c WHERE c.pedido_id=p.id AND c.status='paga' AND c.versao_financeira=2 AND c.valor_total_centavos=p.taxa_total_centavos AND c.taxa_motoboy_centavos=p.taxa_motoboy_centavos))));
$$;

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_v2_registrar_plataforma(p_pedido_id uuid,p_origem text DEFAULT 'aceite')
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_pedido public.catalogo_pedidos%ROWTYPE; v_recebido boolean; v_comp date;
BEGIN
 SELECT * INTO v_pedido FROM public.catalogo_pedidos WHERE id=p_pedido_id FOR UPDATE;
 IF NOT FOUND OR v_pedido.versao_financeira<>2 THEN RETURN false; END IF;
 -- O código não cria comissão retroativa; ela nasce apenas no aceite comercial.
 IF v_pedido.aceito_em IS NULL THEN RETURN false; END IF;
 v_recebido:=catalogo_private.catalogo_v2_financiado(v_pedido.id)
   OR (v_pedido.provedor='offline' AND catalogo_private.catalogo_v2_parcela_recebida(v_pedido.id,'plataforma'));
 IF v_pedido.taxa_plataforma_centavos>0 THEN
 INSERT INTO public.catalogo_lancamentos_financeiros_v2(pedido_id,tipo,valor_centavos,status,chave_idempotencia,referencia,metadata)
 VALUES(v_pedido.id,'comissao_plataforma',v_pedido.taxa_plataforma_centavos,CASE WHEN v_recebido THEN 'disponivel' ELSE 'retido' END,
 'plataforma:'||v_pedido.id::text,p_origem,jsonb_build_object('versao_financeira',2,'origem',p_origem,'recebimento_plataforma',v_recebido))
 ON CONFLICT(chave_idempotencia) DO UPDATE SET status=CASE WHEN public.catalogo_lancamentos_financeiros_v2.status IN ('retido','pendencia_revisao') AND v_recebido THEN 'disponivel' ELSE public.catalogo_lancamentos_financeiros_v2.status END,atualizado_em=pg_catalog.now();
 END IF;
 IF v_pedido.provedor='offline' THEN
 v_comp:=date_trunc('month',v_pedido.aceito_em AT TIME ZONE 'America/Sao_Paulo')::date;
 WHILE EXISTS(SELECT 1 FROM public.catalogo_fechamentos_offline f WHERE f.comercio_id=v_pedido.comercio_id AND f.competencia=v_comp AND (f.status='pago' OR EXISTS(SELECT 1 FROM public.catalogo_fatura_cobrancas b WHERE b.fechamento_id=f.id))) LOOP v_comp:=(v_comp+interval '1 month')::date; END LOOP;
 INSERT INTO public.catalogo_comissoes_offline(pedido_id,comercio_id,competencia,subtotal_produtos_centavos,taxa_percentual,
 valor_comissao_centavos,versao_financeira,taxa_plataforma_centavos,taxa_motoboy_centavos,valor_total_centavos,metadata)
 VALUES(v_pedido.id,v_pedido.comercio_id,v_comp,
 v_pedido.subtotal_produtos_centavos,5.00,v_pedido.taxa_total_centavos,2,v_pedido.taxa_plataforma_centavos,v_pedido.taxa_motoboy_centavos,v_pedido.taxa_total_centavos,
 jsonb_build_object('origem','aceite','snapshot',true,'reserva_logistica',true)) ON CONFLICT(pedido_id) DO NOTHING;
 IF v_pedido.taxa_motoboy_centavos>0 THEN
  INSERT INTO public.catalogo_logistica_offline_v2(pedido_id,comercio_id,competencia,valor_centavos) VALUES(v_pedido.id,v_pedido.comercio_id,v_comp,v_pedido.taxa_motoboy_centavos) ON CONFLICT(pedido_id) DO NOTHING;
 END IF;
 END IF;
 IF v_pedido.taxa_motoboy_centavos>0 THEN
  INSERT INTO public.catalogo_lancamentos_financeiros_v2(pedido_id,tipo,valor_centavos,status,chave_idempotencia,metadata) VALUES(v_pedido.id,'reserva_logistica',v_pedido.taxa_motoboy_centavos,'retido','reserva:'||v_pedido.id::text,jsonb_build_object('reserva_nao_receita',true,'remuneracao_exige_codigo',true)) ON CONFLICT(chave_idempotencia) DO NOTHING;
 END IF;
 UPDATE public.catalogo_pedidos SET comissao_plataforma_registrada=true WHERE id=v_pedido.id;
 RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_v2_cobrar_logistica(p_pedido uuid,p_remuneracao uuid,p_motoboy uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Converte a reserva existente, nunca altera o total histórico nem cobra 2% de novo.
 UPDATE public.catalogo_logistica_offline_v2 SET remuneracao_id=p_remuneracao WHERE pedido_id=p_pedido AND (remuneracao_id IS NULL OR remuneracao_id=p_remuneracao);
 IF NOT FOUND THEN RAISE EXCEPTION 'Reserva de aceite ausente ou beneficiário divergente'; END IF;
 UPDATE public.catalogo_comissoes_offline SET motoboy_id=p_motoboy,remuneracao_id=p_remuneracao WHERE pedido_id=p_pedido;
END;
$$;

CREATE OR REPLACE FUNCTION public.catalogo_gerar_fechamento_offline(p_comercio_id text,p_competencia date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; v_comp date:=date_trunc('month',p_competencia)::date; v_status text; v_total integer; v_count integer;
BEGIN
 -- Serializa a geração por comércio sem expor identidade do comprador.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('catalogo-fatura:'||p_comercio_id,0));
 SELECT id,status INTO v_id,v_status FROM public.catalogo_fechamentos_offline WHERE comercio_id=p_comercio_id AND competencia=v_comp FOR UPDATE;
 IF v_status='pago' OR EXISTS(SELECT 1 FROM public.catalogo_fatura_cobrancas WHERE fechamento_id=v_id) THEN RETURN v_id; END IF;
 SELECT coalesce(sum(valor),0)::integer,count(DISTINCT pedido_id)::integer INTO v_total,v_count FROM (
 SELECT pedido_id,valor_comissao_centavos valor FROM public.catalogo_comissoes_offline WHERE comercio_id=p_comercio_id AND competencia=v_comp AND status NOT IN ('cancelada','contestada')) parcelas;
 IF v_count=0 AND v_id IS NULL THEN RETURN NULL; END IF;
 INSERT INTO public.catalogo_fechamentos_offline(comercio_id,competencia,total_pedidos,total_comissao_centavos,status,vencimento_em)
 VALUES(p_comercio_id,v_comp,v_count,v_total,'faturado',(v_comp+interval '1 month 5 days')::date)
 ON CONFLICT(comercio_id,competencia) DO UPDATE SET total_pedidos=excluded.total_pedidos,total_comissao_centavos=excluded.total_comissao_centavos,
 status=CASE WHEN public.catalogo_fechamentos_offline.status IN ('vencido','bloqueado') THEN public.catalogo_fechamentos_offline.status ELSE 'faturado' END
 RETURNING id INTO v_id;
 DELETE FROM public.catalogo_fatura_componentes_v2 WHERE fechamento_id=v_id;
 INSERT INTO public.catalogo_fatura_componentes_v2(fechamento_id,pedido_id,tipo,valor_centavos)
 SELECT v_id,pedido_id,'plataforma',taxa_plataforma_centavos FROM public.catalogo_comissoes_offline WHERE comercio_id=p_comercio_id AND competencia=v_comp AND status NOT IN ('cancelada','contestada')
 UNION ALL SELECT v_id,pedido_id,'logistica',taxa_motoboy_centavos FROM public.catalogo_comissoes_offline WHERE comercio_id=p_comercio_id AND competencia=v_comp AND status NOT IN ('cancelada','contestada') AND taxa_motoboy_centavos>0;
 UPDATE public.catalogo_comissoes_offline SET status='faturada' WHERE comercio_id=p_comercio_id AND competencia=v_comp AND status='aberta';
 UPDATE public.catalogo_logistica_offline_v2 SET status='faturada' WHERE comercio_id=p_comercio_id AND competencia=v_comp AND status='aberta';
 RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_offline_fatura_v2_liberar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_pedido uuid; v_fin boolean;
BEGIN
 -- Status administrativo isolado/referência arbitrária NÃO é prova. Exige cobrança reconciliada + parcelas seladas.
 FOR v_pedido IN SELECT p.id FROM public.catalogo_pedidos p WHERE p.comercio_id=NEW.comercio_id AND p.versao_financeira=2 AND p.provedor='offline' ORDER BY p.id FOR UPDATE
 LOOP
  v_fin:=catalogo_private.catalogo_v2_financiado(v_pedido);
  UPDATE public.catalogo_logistica_offline_v2 SET status=CASE WHEN v_fin THEN 'paga' ELSE CASE WHEN status='paga' THEN 'faturada' ELSE status END END WHERE pedido_id=v_pedido;
  UPDATE public.catalogo_comissoes_offline SET financiamento_logistica_comprovado=v_fin WHERE pedido_id=v_pedido AND financiamento_logistica_comprovado IS DISTINCT FROM v_fin;
  IF v_fin THEN
    UPDATE public.catalogo_remuneracoes_v2 SET status='disponivel',financiamento_comprovado=true,disponibilizado_em=coalesce(disponibilizado_em,pg_catalog.now()) WHERE pedido_id=v_pedido AND status='retido';
    UPDATE public.catalogo_lancamentos_financeiros_v2 SET status='disponivel',atualizado_em=pg_catalog.now() WHERE pedido_id=v_pedido AND tipo='remuneracao_motoboy' AND status='retido';
  ELSE
    UPDATE public.catalogo_remuneracoes_v2 SET status=CASE WHEN status='pago' THEN 'pendencia_revisao' ELSE 'retido' END,financiamento_comprovado=false WHERE pedido_id=v_pedido AND status IN ('disponivel','pago');
    UPDATE public.catalogo_lancamentos_financeiros_v2 SET status=CASE WHEN status='pago' THEN 'pendencia_revisao' ELSE 'retido' END,atualizado_em=pg_catalog.now() WHERE pedido_id=v_pedido AND tipo='remuneracao_motoboy' AND status IN ('disponivel','pago');
    INSERT INTO public.catalogo_lancamentos_financeiros_v2(pedido_id,beneficiario_id,tipo,valor_centavos,status,chave_idempotencia,metadata)
    SELECT r.pedido_id,r.motoboy_id,'pendencia_revisao',-r.valor_centavos,'pendencia_revisao','estorno-revisao:'||r.pedido_id::text,jsonb_build_object('motivo','Fatura revertida após repasse; dívida para revisão, não transferência') FROM public.catalogo_remuneracoes_v2 r WHERE r.pedido_id=v_pedido AND r.status='pendencia_revisao'
    ON CONFLICT(chave_idempotencia) DO NOTHING;
  END IF;
  UPDATE public.catalogo_lancamentos_financeiros_v2 SET status=CASE WHEN catalogo_private.catalogo_v2_parcela_recebida(v_pedido,'plataforma') THEN 'disponivel' ELSE 'retido' END,atualizado_em=pg_catalog.now() WHERE pedido_id=v_pedido AND tipo='comissao_plataforma' AND status IN ('retido','disponivel');
 END LOOP;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS catalogo_fechamentos_offline_v2_liberar ON public.catalogo_fechamentos_offline;
CREATE TRIGGER catalogo_fechamentos_offline_v2_liberar AFTER UPDATE OF status ON public.catalogo_fechamentos_offline FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_offline_fatura_v2_liberar();
DROP TRIGGER IF EXISTS catalogo_comissoes_offline_v2_liberar ON public.catalogo_comissoes_offline;
CREATE TRIGGER catalogo_comissoes_offline_v2_liberar AFTER UPDATE OF status ON public.catalogo_comissoes_offline FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_offline_fatura_v2_liberar();
DROP TRIGGER IF EXISTS catalogo_cobrancas_offline_v2_liberar ON public.catalogo_fatura_cobrancas;
CREATE TRIGGER catalogo_cobrancas_offline_v2_liberar AFTER UPDATE OF status ON public.catalogo_fatura_cobrancas FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_offline_fatura_v2_liberar();
REVOKE ALL ON FUNCTION catalogo_private.catalogo_v2_comissao_defaults(),catalogo_private.catalogo_v2_parcela_recebida(uuid,text),catalogo_private.catalogo_v2_financiado(uuid),catalogo_private.catalogo_v2_registrar_plataforma(uuid,text),catalogo_private.catalogo_v2_cobrar_logistica(uuid,uuid,uuid),catalogo_private.catalogo_offline_fatura_v2_liberar() FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
