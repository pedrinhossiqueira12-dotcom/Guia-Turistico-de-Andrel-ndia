-- Catálogo Digital do Guia Turístico de Andrelândia.
-- A migração é aditiva: não remove registros nem objetos do Storage.
-- Assinaturas só podem ser ativadas por servidor/admin; cobrança Pix real não está configurada.

BEGIN;

CREATE TABLE IF NOT EXISTS public.catalogos (
  comercio_id text PRIMARY KEY REFERENCES public.comercios_publicados(local_id) ON DELETE RESTRICT,
  proprietario_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  modalidades text[] NOT NULL DEFAULT ARRAY['retirada']::text[],
  metodos_pagamento text[] NOT NULL DEFAULT ARRAY['pix']::text[],
  bloqueado boolean NOT NULL DEFAULT false,
  motivo_bloqueio text NULL CHECK (motivo_bloqueio IS NULL OR char_length(motivo_bloqueio) <= 500),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalogos_modalidades_validas CHECK (
    cardinality(modalidades) > 0 AND modalidades <@ ARRAY['entrega','retirada','consumo_local']::text[]
  ),
  CONSTRAINT catalogos_pagamentos_validos CHECK (
    cardinality(metodos_pagamento) > 0 AND metodos_pagamento <@ ARRAY[
      'pix','dinheiro','cartao_credito','cartao_debito','pagamento_entrega','pagamento_local'
    ]::text[]
  )
);

CREATE TABLE IF NOT EXISTS public.catalogo_assinaturas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comercio_id text NOT NULL REFERENCES public.catalogos(comercio_id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','ativa','cancelada','expirada')),
  valor numeric(10,2) NULL CHECK (valor IS NULL OR valor >= 0),
  gateway text NULL,
  cobranca_id text NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  pago_em timestamptz NULL,
  expira_em timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS catalogo_assinaturas_cobranca_unique
  ON public.catalogo_assinaturas (gateway, cobranca_id)
  WHERE cobranca_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS catalogo_assinaturas_ativa_unica
  ON public.catalogo_assinaturas (comercio_id)
  WHERE status = 'ativa';

CREATE UNIQUE INDEX IF NOT EXISTS catalogo_assinaturas_pendente_unica
  ON public.catalogo_assinaturas (comercio_id)
  WHERE status = 'pendente';

CREATE TABLE IF NOT EXISTS public.catalogo_categorias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comercio_id text NOT NULL REFERENCES public.catalogos(comercio_id) ON DELETE RESTRICT,
  nome text NOT NULL CHECK (char_length(trim(nome)) BETWEEN 1 AND 60),
  ordem integer NOT NULL DEFAULT 0,
  ativa boolean NOT NULL DEFAULT true,
  deletado_em timestamptz NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalogo_categorias_comercio_id_unique UNIQUE (comercio_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS catalogo_categorias_nome_ativo_unique
  ON public.catalogo_categorias (comercio_id, lower(trim(nome)))
  WHERE deletado_em IS NULL;

CREATE TABLE IF NOT EXISTS public.catalogo_produtos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comercio_id text NOT NULL REFERENCES public.catalogos(comercio_id) ON DELETE RESTRICT,
  categoria_id uuid NOT NULL,
  nome text NOT NULL CHECK (char_length(trim(nome)) BETWEEN 1 AND 120),
  descricao text NOT NULL DEFAULT '' CHECK (char_length(descricao) <= 600),
  preco numeric(10,2) NOT NULL CHECK (preco >= 0),
  imagem text NULL CHECK (imagem IS NULL OR char_length(imagem) <= 2048),
  disponivel boolean NOT NULL DEFAULT true,
  ordem integer NOT NULL DEFAULT 0,
  deletado_em timestamptz NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalogo_produtos_imagem_do_comercio CHECK (
    imagem IS NULL OR left(imagem, length('catalogos/' || comercio_id || '/')) = 'catalogos/' || comercio_id || '/'
  ),
  CONSTRAINT catalogo_produtos_categoria_mesmo_comercio_fkey
    FOREIGN KEY (comercio_id, categoria_id)
    REFERENCES public.catalogo_categorias (comercio_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS catalogo_categorias_comercio_ordem_idx
  ON public.catalogo_categorias (comercio_id, ordem)
  WHERE deletado_em IS NULL AND ativa;

CREATE INDEX IF NOT EXISTS catalogo_produtos_comercio_categoria_ordem_idx
  ON public.catalogo_produtos (comercio_id, categoria_id, ordem)
  WHERE deletado_em IS NULL;

CREATE INDEX IF NOT EXISTS catalogo_produtos_imagem_idx
  ON public.catalogo_produtos (imagem)
  WHERE imagem IS NOT NULL;

CREATE SCHEMA IF NOT EXISTS catalogo_private;
REVOKE ALL ON SCHEMA catalogo_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA catalogo_private TO anon, authenticated;

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_esta_ativo(p_comercio_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.comercios_publicados cp
    JOIN public.catalogos c ON c.comercio_id = cp.local_id
    JOIN public.catalogo_assinaturas ca ON ca.comercio_id = cp.local_id
    WHERE cp.local_id = p_comercio_id
      AND cp.status = 'ativo'
      AND NOT c.bloqueado
      AND ca.status = 'ativa'
      AND (ca.expira_em IS NULL OR ca.expira_em > pg_catalog.now())
  );
$$;

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_usuario_e_dono(p_comercio_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.catalogos c
    JOIN public.comercios_publicados cp ON cp.local_id = c.comercio_id
    WHERE c.comercio_id = p_comercio_id
      AND c.proprietario_id = (SELECT auth.uid())
      AND cp.status = 'ativo'
  );
$$;

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_usuario_pode_editar(p_comercio_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT catalogo_private.catalogo_usuario_e_dono(p_comercio_id)
     AND catalogo_private.catalogo_esta_ativo(p_comercio_id);
$$;

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_usuario_e_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (SELECT auth.uid()) = '4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid;
$$;

REVOKE ALL ON FUNCTION catalogo_private.catalogo_esta_ativo(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_usuario_e_dono(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_usuario_pode_editar(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_usuario_e_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalogo_private.catalogo_esta_ativo(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION catalogo_private.catalogo_usuario_e_dono(text) TO authenticated;
GRANT EXECUTE ON FUNCTION catalogo_private.catalogo_usuario_pode_editar(text) TO authenticated;
GRANT EXECUTE ON FUNCTION catalogo_private.catalogo_usuario_e_admin() TO authenticated;

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_atualizar_data()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.atualizado_em := pg_catalog.now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS catalogos_atualizado_em ON public.catalogos;
CREATE TRIGGER catalogos_atualizado_em
  BEFORE UPDATE ON public.catalogos
  FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_atualizar_data();

DROP TRIGGER IF EXISTS catalogo_categorias_atualizado_em ON public.catalogo_categorias;
CREATE TRIGGER catalogo_categorias_atualizado_em
  BEFORE UPDATE ON public.catalogo_categorias
  FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_atualizar_data();

DROP TRIGGER IF EXISTS catalogo_produtos_atualizado_em ON public.catalogo_produtos;
CREATE TRIGGER catalogo_produtos_atualizado_em
  BEFORE UPDATE ON public.catalogo_produtos
  FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_atualizar_data();

ALTER TABLE public.catalogos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_assinaturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_produtos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalogos_publico_select_ativo ON public.catalogos;
CREATE POLICY catalogos_publico_select_ativo
  ON public.catalogos FOR SELECT TO anon, authenticated
  USING (catalogo_private.catalogo_esta_ativo(comercio_id));

DROP POLICY IF EXISTS catalogos_dono_select ON public.catalogos;
CREATE POLICY catalogos_dono_select
  ON public.catalogos FOR SELECT TO authenticated
  USING (proprietario_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS catalogos_dono_update_ativo ON public.catalogos;
CREATE POLICY catalogos_dono_update_ativo
  ON public.catalogos FOR UPDATE TO authenticated
  USING (catalogo_private.catalogo_usuario_pode_editar(comercio_id))
  WITH CHECK (catalogo_private.catalogo_usuario_pode_editar(comercio_id));

DROP POLICY IF EXISTS catalogos_admin_all ON public.catalogos;
CREATE POLICY catalogos_admin_all
  ON public.catalogos FOR ALL TO authenticated
  USING (catalogo_private.catalogo_usuario_e_admin())
  WITH CHECK (catalogo_private.catalogo_usuario_e_admin());

DROP POLICY IF EXISTS catalogo_assinaturas_publico_ativas ON public.catalogo_assinaturas;
CREATE POLICY catalogo_assinaturas_publico_ativas
  ON public.catalogo_assinaturas FOR SELECT TO anon, authenticated
  USING (status = 'ativa' AND catalogo_private.catalogo_esta_ativo(comercio_id));

DROP POLICY IF EXISTS catalogo_assinaturas_dono_select ON public.catalogo_assinaturas;
CREATE POLICY catalogo_assinaturas_dono_select
  ON public.catalogo_assinaturas FOR SELECT TO authenticated
  USING (catalogo_private.catalogo_usuario_e_dono(comercio_id));

DROP POLICY IF EXISTS catalogo_assinaturas_admin_all ON public.catalogo_assinaturas;
DROP POLICY IF EXISTS catalogo_assinaturas_admin_select ON public.catalogo_assinaturas;
CREATE POLICY catalogo_assinaturas_admin_select
  ON public.catalogo_assinaturas FOR SELECT TO authenticated
  USING (catalogo_private.catalogo_usuario_e_admin());

DROP POLICY IF EXISTS catalogo_categorias_publico_select ON public.catalogo_categorias;
CREATE POLICY catalogo_categorias_publico_select
  ON public.catalogo_categorias FOR SELECT TO anon, authenticated
  USING (
    ativa AND deletado_em IS NULL
    AND catalogo_private.catalogo_esta_ativo(comercio_id)
  );

DROP POLICY IF EXISTS catalogo_categorias_dono_all ON public.catalogo_categorias;
CREATE POLICY catalogo_categorias_dono_all
  ON public.catalogo_categorias FOR ALL TO authenticated
  USING (catalogo_private.catalogo_usuario_pode_editar(comercio_id))
  WITH CHECK (catalogo_private.catalogo_usuario_pode_editar(comercio_id));

DROP POLICY IF EXISTS catalogo_categorias_admin_all ON public.catalogo_categorias;
CREATE POLICY catalogo_categorias_admin_all
  ON public.catalogo_categorias FOR ALL TO authenticated
  USING (catalogo_private.catalogo_usuario_e_admin())
  WITH CHECK (catalogo_private.catalogo_usuario_e_admin());

DROP POLICY IF EXISTS catalogo_produtos_publico_select ON public.catalogo_produtos;
CREATE POLICY catalogo_produtos_publico_select
  ON public.catalogo_produtos FOR SELECT TO anon, authenticated
  USING (
    disponivel AND deletado_em IS NULL
    AND catalogo_private.catalogo_esta_ativo(comercio_id)
    AND EXISTS (
      SELECT 1 FROM public.catalogo_categorias cc
      WHERE cc.id = catalogo_produtos.categoria_id
        AND cc.comercio_id = catalogo_produtos.comercio_id
        AND cc.ativa AND cc.deletado_em IS NULL
    )
  );

DROP POLICY IF EXISTS catalogo_produtos_dono_all ON public.catalogo_produtos;
CREATE POLICY catalogo_produtos_dono_all
  ON public.catalogo_produtos FOR ALL TO authenticated
  USING (catalogo_private.catalogo_usuario_pode_editar(comercio_id))
  WITH CHECK (catalogo_private.catalogo_usuario_pode_editar(comercio_id));

DROP POLICY IF EXISTS catalogo_produtos_admin_all ON public.catalogo_produtos;
CREATE POLICY catalogo_produtos_admin_all
  ON public.catalogo_produtos FOR ALL TO authenticated
  USING (catalogo_private.catalogo_usuario_e_admin())
  WITH CHECK (catalogo_private.catalogo_usuario_e_admin());

REVOKE ALL ON TABLE public.catalogos FROM anon, authenticated;
GRANT SELECT (comercio_id, modalidades, metodos_pagamento)
  ON public.catalogos TO anon, authenticated;
GRANT UPDATE (modalidades, metodos_pagamento)
  ON public.catalogos TO authenticated;

REVOKE ALL ON TABLE public.catalogo_assinaturas FROM anon, authenticated;
-- Estado/expiração são fornecidos pela Edge Function autenticada; a tabela não é exposta ao Data API.

REVOKE ALL ON TABLE public.catalogo_categorias FROM anon, authenticated;
GRANT SELECT ON TABLE public.catalogo_categorias TO anon, authenticated;
GRANT INSERT, UPDATE ON TABLE public.catalogo_categorias TO authenticated;

REVOKE ALL ON TABLE public.catalogo_produtos FROM anon, authenticated;
GRANT SELECT ON TABLE public.catalogo_produtos TO anon, authenticated;
GRANT INSERT, UPDATE ON TABLE public.catalogo_produtos TO authenticated;

CREATE OR REPLACE VIEW public.catalogo_publicado WITH (security_invoker = true) AS
SELECT
  c.comercio_id,
  c.modalidades,
  c.metodos_pagamento
FROM public.catalogos c
WHERE catalogo_private.catalogo_esta_ativo(c.comercio_id);
GRANT SELECT ON public.catalogo_publicado TO anon, authenticated;

-- Buckets públicos permitem leitura direta por URL, mas escrita exige RLS abaixo.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'catalogos',
  'catalogos',
  true,
  5242880,
  ARRAY['image/webp','image/jpeg','image/png']::text[]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS catalogos_proprietario_upload_ativo ON storage.objects;
CREATE POLICY catalogos_proprietario_upload_ativo
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'catalogos'
    AND lower(storage.extension(name)) IN ('webp','jpg','jpeg','png')
    AND cardinality(storage.foldername(name)) >= 2
    AND EXISTS (
      SELECT 1
      FROM public.catalogos c
      WHERE c.comercio_id = (storage.foldername(name))[1]
        AND (
          catalogo_private.catalogo_usuario_pode_editar(c.comercio_id)
          OR catalogo_private.catalogo_usuario_e_admin()
        )
    )
  );

-- A reconciliação atual é exclusivamente dry-run; ampliar somente a constraint conhecida.
ALTER TABLE public.storage_cleanup_queue
  DROP CONSTRAINT IF EXISTS storage_cleanup_queue_bucket_id_check;
ALTER TABLE public.storage_cleanup_queue
  ADD CONSTRAINT storage_cleanup_queue_bucket_id_check
  CHECK (bucket_id = ANY (ARRAY['cadastros','mural-imagens','catalogos']::text[]));

COMMIT;
