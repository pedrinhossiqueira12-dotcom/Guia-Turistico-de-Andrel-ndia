-- Notícias/Eventos e auditoria de pagamentos do Catálogo.
-- Aditivo: sem alteração de tabelas/RLS existentes, sem remoção de objetos e sem cobrança real.
BEGIN;

CREATE TABLE IF NOT EXISTS public.conteudos_editoriais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  tipo text NOT NULL CHECK (tipo IN ('noticia','evento')),
  titulo text NOT NULL CHECK (char_length(btrim(titulo)) BETWEEN 1 AND 140),
  resumo text NOT NULL DEFAULT '' CHECK (char_length(resumo) <= 400),
  corpo text NOT NULL DEFAULT '' CHECK (char_length(corpo) <= 30000),
  local_evento text NULL CHECK (local_evento IS NULL OR char_length(local_evento) <= 240),
  inicio_evento timestamptz NULL,
  fim_evento timestamptz NULL,
  imagem_capa text NULL CHECK (imagem_capa IS NULL OR char_length(imagem_capa) <= 2048),
  galeria jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(galeria) = 'array'),
  texto_cta text NULL CHECK (texto_cta IS NULL OR char_length(texto_cta) <= 60),
  url_cta text NULL CHECK (url_cta IS NULL OR char_length(url_cta) <= 2048),
  destaque_hero boolean NOT NULL DEFAULT false,
  ordem_hero integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho','publicado','arquivado','deletado')),
  publicado_em timestamptz NULL,
  criado_por uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  atualizado_por uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  deletado_em timestamptz NULL,
  CONSTRAINT conteudos_editoriais_datas_evento_check
    CHECK (tipo <> 'evento' OR fim_evento IS NULL OR inicio_evento IS NULL OR fim_evento >= inicio_evento)
);

CREATE INDEX IF NOT EXISTS conteudos_editoriais_publicados_idx
  ON public.conteudos_editoriais (tipo, publicado_em DESC)
  WHERE status = 'publicado' AND deletado_em IS NULL;
CREATE INDEX IF NOT EXISTS conteudos_editoriais_hero_idx
  ON public.conteudos_editoriais (ordem_hero, publicado_em DESC)
  WHERE destaque_hero AND status = 'publicado' AND deletado_em IS NULL;

ALTER TABLE public.conteudos_editoriais ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.conteudos_editoriais FROM anon, authenticated;
GRANT SELECT ON TABLE public.conteudos_editoriais TO anon, authenticated;
DROP POLICY IF EXISTS conteudos_editoriais_leitura_publicada ON public.conteudos_editoriais;
CREATE POLICY conteudos_editoriais_leitura_publicada
  ON public.conteudos_editoriais FOR SELECT TO anon, authenticated
  USING (
    status = 'publicado'
    AND publicado_em IS NOT NULL
    AND publicado_em <= now()
    AND deletado_em IS NULL
  );
-- Escrita somente pela Edge Function autenticada, usando service_role no servidor.

CREATE TABLE IF NOT EXISTS public.catalogo_pagamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assinatura_id uuid NOT NULL REFERENCES public.catalogo_assinaturas(id) ON DELETE RESTRICT,
  comercio_id text NOT NULL REFERENCES public.catalogos(comercio_id) ON DELETE RESTRICT,
  gateway text NOT NULL DEFAULT 'mercadopago' CHECK (gateway = 'mercadopago'),
  plano text NOT NULL CHECK (plano IN ('mensal','anual')),
  valor numeric(10,2) NOT NULL
    CHECK ((plano = 'mensal' AND valor = 59.90) OR (plano = 'anual' AND valor = 599.90)),
  moeda text NOT NULL DEFAULT 'BRL' CHECK (moeda = 'BRL'),
  referencia_externa text NOT NULL UNIQUE,
  chave_idempotencia uuid NOT NULL UNIQUE,
  order_id text UNIQUE,
  payment_id text UNIQUE,
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','aprovado','recusado','cancelado','expirado','estornado','contestado')),
  status_provedor text NULL,
  detalhe_status_provedor text NULL,
  expira_em timestamptz NULL,
  pago_em timestamptz NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS catalogo_pagamentos_comercio_criado_idx
  ON public.catalogo_pagamentos (comercio_id, criado_em DESC);
ALTER TABLE public.catalogo_pagamentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.catalogo_pagamentos FROM anon, authenticated;
-- Sem política/grant direto a anon/authenticated; acesso exclusivamente service_role.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'noticias-eventos',
  'noticias-eventos',
  true,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp']::text[]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS noticias_eventos_admin_upload ON storage.objects;
CREATE POLICY noticias_eventos_admin_upload
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'noticias-eventos'
    AND lower(storage.extension(name)) IN ('jpg','jpeg','png','webp')
    AND cardinality(storage.foldername(name)) >= 2
    AND (storage.foldername(name))[1] = 'publicacoes'
    AND (SELECT auth.uid()) = '4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid
  );
-- Sem policy de UPDATE/DELETE. Bucket público apenas para leitura por URL; sem purge físico.

COMMIT;
