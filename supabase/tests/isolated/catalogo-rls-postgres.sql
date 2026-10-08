-- Cenários de autorização do catálogo em PostgreSQL DESCARTÁVEL.
-- Dados 100% sintéticos. NUNCA executar no banco de produção.
-- Requer migrações iniciais e stubs de Auth/Storage já carregados no CI.
DO $guard$
BEGIN
  IF current_database() <> 'catalogo_ci'
     OR current_setting('app.marketplace_test_scenario', true) IS DISTINCT FROM 'enabled'
     OR to_regclass('public.catalogos') IS NULL
     OR to_regclass('auth.users') IS NULL
     OR to_regclass('storage.objects') IS NULL
  THEN
    RAISE EXCEPTION 'Teste RLS do catálogo permitido somente no catalogo_ci isolado com opt-in';
  END IF;
END $guard$;

-- A instalação real do Supabase já concede USAGE nesses schemas a cada papel.
-- Aqui simulamos apenas as concessões necessárias para os stubs descartáveis.
GRANT USAGE ON SCHEMA auth, storage TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
GRANT INSERT ON TABLE storage.objects TO authenticated;

-- Comércio e perfis de teste: apenas slugs existentes na migração de demonstração.
INSERT INTO auth.users(id) VALUES
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003');

INSERT INTO public.catalogos(comercio_id, proprietario_id, modalidades, metodos_pagamento)
VALUES
  ('vagao-lanches', '00000000-0000-4000-8000-000000000001', ARRAY['retirada'], ARRAY['pix']),
  ('mega-lanches', '00000000-0000-4000-8000-000000000002', ARRAY['entrega'], ARRAY['dinheiro']);

INSERT INTO public.catalogo_assinaturas(comercio_id, status, expira_em)
VALUES
  ('vagao-lanches', 'ativa', now() + interval '30 days'),
  ('mega-lanches', 'ativa', now() + interval '30 days');

INSERT INTO public.catalogo_categorias(id, comercio_id, nome)
VALUES
  ('00000000-0000-4000-8000-000000000011', 'vagao-lanches', 'Lanches'),
  ('00000000-0000-4000-8000-000000000012', 'mega-lanches', 'Pizzas');

INSERT INTO public.catalogo_produtos(id, comercio_id, categoria_id, nome, preco)
VALUES
  ('00000000-0000-4000-8000-000000000021', 'vagao-lanches',
   '00000000-0000-4000-8000-000000000011', 'Lanche visível', 19.90),
  ('00000000-0000-4000-8000-000000000022', 'mega-lanches',
   '00000000-0000-4000-8000-000000000012', 'Pizza visível', 29.90);

SET ROLE anon;
DO $check_anon$
BEGIN
  IF (SELECT count(*) FROM public.catalogo_publicado) <> 2
     OR (SELECT count(*) FROM public.catalogo_produtos) <> 2
  THEN
    RAISE EXCEPTION 'Visitantes devem ver apenas os dois catálogos e produtos ativos';
  END IF;
  IF has_table_privilege('anon', 'public.catalogo_assinaturas', 'SELECT')
     OR has_table_privilege('anon', 'public.catalogo_produtos', 'INSERT')
  THEN
    RAISE EXCEPTION 'Visitante não pode ler assinaturas ou inserir produtos';
  END IF;
END $check_anon$;
RESET ROLE;

-- Primeiro dono pode modificar o próprio catálogo e adicionar categoria.
SET request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
UPDATE public.catalogos SET modalidades = ARRAY['entrega','retirada']::text[]
  WHERE comercio_id = 'vagao-lanches';
INSERT INTO public.catalogo_categorias(comercio_id, nome)
VALUES ('vagao-lanches', 'Bebidas do proprietário');

-- O upload válido é permitido SOMENTE ao proprietário com assinatura ativa.
INSERT INTO storage.objects(bucket_id, name)
VALUES ('catalogos', 'vagao-lanches/produtos/lanche.webp');
INSERT INTO public.catalogo_produtos(comercio_id, categoria_id, nome, preco)
VALUES ('vagao-lanches', '00000000-0000-4000-8000-000000000011', 'Suco do proprietário', 6.50);

DO $check_owner$
DECLARE denied boolean := false;
        affected integer := -1;
BEGIN
  IF (SELECT count(*) FROM public.catalogos WHERE comercio_id = 'vagao-lanches') <> 1
     OR (SELECT count(*) FROM public.catalogo_categorias
         WHERE comercio_id = 'vagao-lanches' AND nome = 'Bebidas do proprietário') <> 1
  THEN
    RAISE EXCEPTION 'Proprietário não consegue editar o próprio catálogo ativo';
  END IF;

  BEGIN
    INSERT INTO public.catalogo_categorias(comercio_id, nome)
      VALUES ('mega-lanches', 'Categoria não autorizada');
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'Proprietário editou o catálogo de outro comércio';
  END IF;

  UPDATE public.catalogos SET modalidades = ARRAY['retirada']::text[]
    WHERE comercio_id = 'mega-lanches';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'Proprietário atualizou as modalidades de outro comércio';
  END IF;

  denied := false;
  BEGIN
    INSERT INTO public.catalogo_produtos(comercio_id, categoria_id, nome, preco)
      VALUES ('mega-lanches', '00000000-0000-4000-8000-000000000012',
              'Produto invasor', 1.00);
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'Proprietário inseriu produto no catálogo alheio';
  END IF;

  denied := false;
  BEGIN
    INSERT INTO storage.objects(bucket_id, name)
      VALUES ('catalogos', 'mega-lanches/produtos/alheio.webp');
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'Proprietário conseguiu enviar imagem para o catálogo alheio';
  END IF;

  denied := false;
  BEGIN
    INSERT INTO storage.objects(bucket_id, name)
      VALUES ('catalogos', 'vagao-lanches/produtos/arquivo.exe');
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'Upload aceitou extensão não permitida';
  END IF;

  denied := false;
  BEGIN
    UPDATE public.catalogos SET bloqueado = true WHERE comercio_id = 'vagao-lanches';
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'Proprietário conseguiu alterar a trava administrativa';
  END IF;
END $check_owner$;
RESET ROLE;

-- Uma categoria inativa não pode deixar seus produtos na vitrine.
UPDATE public.catalogo_categorias SET ativa = false
WHERE id = '00000000-0000-4000-8000-000000000011';
SET ROLE anon;
DO $hidden_category$
BEGIN
  IF (SELECT count(*) FROM public.catalogo_produtos) <> 1 THEN
    RAISE EXCEPTION 'Produtos de categoria inativa ficaram visíveis';
  END IF;
END $hidden_category$;
RESET ROLE;
UPDATE public.catalogo_categorias SET ativa = true
WHERE id = '00000000-0000-4000-8000-000000000011';

-- Produto indisponível nunca deve ser exposto no catálogo público.
UPDATE public.catalogo_produtos SET disponivel = false
WHERE id = '00000000-0000-4000-8000-000000000021';
SET ROLE anon;
DO $hidden_product$
BEGIN
  IF (SELECT count(*) FROM public.catalogo_produtos) <> 2 THEN
    RAISE EXCEPTION 'Produto indisponível ficou visível';
  END IF;
END $hidden_product$;
RESET ROLE;
UPDATE public.catalogo_produtos SET disponivel = true
WHERE id = '00000000-0000-4000-8000-000000000021';

-- Usuário autenticado sem vínculos não pode criar categorias em outro comércio.
SET request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
SET ROLE authenticated;
DO $check_stranger$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.catalogo_categorias(comercio_id, nome)
      VALUES ('vagao-lanches', 'Categoria invasora');
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'Terceiro inseriu categoria no catálogo alheio';
  END IF;

  denied := false;
  BEGIN
    INSERT INTO storage.objects(bucket_id, name)
      VALUES ('catalogos', 'vagao-lanches/produtos/invasor.webp');
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'Terceiro conseguiu enviar imagem para catálogo alheio';
  END IF;
END $check_stranger$;
RESET ROLE;

-- Suspensão administrativa deve ocultar catálogo e impedir novas edições do dono.
UPDATE public.catalogos SET bloqueado = true WHERE comercio_id = 'vagao-lanches';
SET ROLE anon;
DO $check_blocked_public$
BEGIN
  IF (SELECT count(*) FROM public.catalogo_publicado) <> 1
     OR (SELECT count(*) FROM public.catalogo_produtos) <> 1
  THEN
    RAISE EXCEPTION 'Catálogo bloqueado permaneceu visível ao público';
  END IF;
END $check_blocked_public$;
RESET ROLE;

SET request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
DO $check_blocked_owner$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.catalogo_categorias(comercio_id, nome)
      VALUES ('vagao-lanches', 'Edição durante suspensão');
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'Proprietário conseguiu editar catálogo bloqueado';
  END IF;

  denied := false;
  BEGIN
    INSERT INTO storage.objects(bucket_id, name)
      VALUES ('catalogos', 'vagao-lanches/produtos/bloqueado.webp');
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'Proprietário enviou imagem com catálogo bloqueado';
  END IF;
END $check_blocked_owner$;
RESET ROLE;

-- Assinatura vencida também deve remover o catálogo da vitrine.
UPDATE public.catalogos SET bloqueado = false WHERE comercio_id = 'vagao-lanches';
UPDATE public.catalogo_assinaturas
SET expira_em = now() - interval '1 day'
WHERE comercio_id = 'vagao-lanches';
SET ROLE anon;
DO $check_expired$
BEGIN
  IF (SELECT count(*) FROM public.catalogo_publicado) <> 1
     OR (SELECT count(*) FROM public.catalogo_produtos) <> 1
  THEN
    RAISE EXCEPTION 'Assinatura vencida permaneceu publicada';
  END IF;
END $check_expired$;
RESET ROLE;

SET request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
DO $check_expired_owner$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    INSERT INTO storage.objects(bucket_id, name)
      VALUES ('catalogos', 'vagao-lanches/produtos/expirado.webp');
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'Assinatura vencida permitiu envio de imagem';
  END IF;
END $check_expired_owner$;
RESET ROLE;

DO $uploads$
BEGIN
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id = 'catalogos') <> 1
  THEN
    RAISE EXCEPTION 'Uploads indevidos foram aceitos pela política do Storage';
  END IF;
END $uploads$;

SELECT 'PASS: autorização de catálogos e uploads, isolamento entre donos, bloqueio e assinatura vencida' AS result;
