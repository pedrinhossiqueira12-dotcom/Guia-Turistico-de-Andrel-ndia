-- Public metadata and reversible media-retention queue; no Storage objects are deleted.
CREATE TABLE IF NOT EXISTS public.comercios_publicados (
  local_id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','pendente','rejeitado','deletado')),
  destaque boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  deletado_em timestamptz NULL,
  atualizado_por uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT comercios_publicados_deleted_timestamp_check CHECK (status <> 'deletado' OR deletado_em IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS comercios_publicados_status_destaque_idx ON public.comercios_publicados (status, destaque);
ALTER TABLE public.comercios_publicados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Comércios ativos visíveis ao público" ON public.comercios_publicados;
CREATE POLICY "Comércios ativos visíveis ao público" ON public.comercios_publicados
  FOR SELECT TO anon, authenticated USING (status = 'ativo');
REVOKE ALL ON TABLE public.comercios_publicados FROM anon, authenticated;
GRANT SELECT ON TABLE public.comercios_publicados TO anon, authenticated;
GRANT ALL ON TABLE public.comercios_publicados TO service_role;

CREATE TABLE IF NOT EXISTS public.storage_cleanup_queue (
  bucket_id text NOT NULL CHECK (bucket_id IN ('cadastros','mural-imagens')),
  object_name text NOT NULL CHECK (length(object_name) > 0),
  first_unreferenced_at timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz NOT NULL DEFAULT now(),
  checks_count integer NOT NULL DEFAULT 0 CHECK (checks_count >= 0),
  last_error text NULL,
  PRIMARY KEY (bucket_id, object_name)
);
ALTER TABLE public.storage_cleanup_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.storage_cleanup_queue FROM anon, authenticated;
GRANT ALL ON TABLE public.storage_cleanup_queue TO service_role;

-- Initial metadata copied from the deployed, public JSON catalog (139 unique IDs).
INSERT INTO public.comercios_publicados (local_id, status, destaque)
SELECT ids.local_id,
       CASE WHEN ids.local_id = 'pousada-exemplo' THEN 'pendente' ELSE 'ativo' END,
       false
FROM jsonb_array_elements_text('["vagao-lanches","mega-lanches","restaurante-andrelandia","restaurante-fazenda-pasto-grande","uaiso-gastronomia","paradex-dos-amigos","pizzaria-paulistana","cafe-memoria-de-andrelandia","doce-com-amor","padaria-do-carlinhos","padaria-do-areao","pub-house-choperia","bar-do-prudente","supermercado-santa-helena","mercado-sao-benedito","lojao-da-economia","rede-inova-andrelandia","drogaria-descontao","hotel-real","pousada-do-ribeirao","fernando-auto-pecas","gl-auto-pecas","oficina-do-marcos","rc-auto-mecanica-praca-joao-zuquim","rc-auto-mecanica-ribeiro-salgado","tr-oficina-borracharia","auto-mecanica-almeida","oficina-fernando-l-costa","oficina-antonio-marcos-almeida","gleydison-cassio-chagas","cpbyke-motos","cartorio-1-oficio-notas","despachante-oliveiros","lava-jato-do-xereco","vipebox-vidracaria","lojas-edmil","uticelulares-andrelandia","movimente-academia","cartorio-registro-imoveis","juninho-despachante","lava-jato-carioca","vidracaria-vidromar","maria-bonita","casa-das-artes-nossa-senhora-aparecida","bar-bante-bar-restaurante","bar-merceria-do-alcides","agencia-dos-correios","eletrozema-andrelandia","encantaris-presentes","gdois-graphics","krypton-solucoes","movelandia-informatica-tecnologia","net-video-eventos","raquel-com","simao-pedro-aparecido","sul-minas-embalagens","ti-z-tecnologia-informacao","valuty-andrelandia","e-telecom-comunicacoes","cr-comercios-gerais","comercial-j-mangia-moveis","andrade-paiva-reformas","aprolema-associacao-produtores-leite","wm-studio-fitness","rodoviaria-andrelandia","loja-da-dircea","eletromania-andrelandia","carola-sorveteria-artesanal","altos-acai","emporio-do-acai","japa-brasa","expresso-gourmet","re-r-empadas","doce-sabor-confeitaria","acai-da-celia","quiosque-avenida","raquel-confeitaria-lanchonete","casa-da-esfiha","lanchonete-ed-mais","pizzaria-la-fornalha","padaria-sao-dimas","restaurante-pizzaria-nova-era","lanchonete-pastelaria-bartalo","doce-com-amor-2","arte-cafe-cultura-armazem","emporio-alimentacao-andrelandia","bar-santos-dumont","bar-mercearia-sao-pedro","mouras-bar","bar-sao-jose","mercearia-santos-dumont","mercearia-do-rauzinho","mercearia-ideal","mercearia-salvador","padaria-mercearia-joao-paulo","toninho-lanches","agropecuaria-bom-pastor","agropecuaria-santos-dumont","agropecuaria-nsa","agrunutri","pet-shop-sao-francisco-assis","mil-bichos","jose-roberto-pio-materiais","marcio-eduardo-materiais","miudesa-da-casa","tudo-tem-construcoes-reparos","pizzaria-andrelandia","rn-pizzaria","brutus-burger","vinicola-abn","cariocas-bar","emporio-nova-alianca","horti-fruti-andrelandense","carlo-alberto-ribeiro-gaspar","pe-na-roca","bar-dorbal","bar-restaurante-bartalo","bar-restaurante-safira","edina-buffet","edson-f-silva-alimentacao","panificadora-nossa-senhora-aparecida","pastelaria-novo-milenio","desfrutti-confeitaria","bar-sao-jose-andrelandia","carola-cafeteria","minas-pastelaria","piratas-sushi","restaurante-sorveteria-trem-bom","cozinha-teca","lfv-buffet","bar-restaurante-neguita","minas-pastelaria-2","maysa-lanches","lanches-mil-grau","mercearia-do-doni","bar-do-marcio","churras-grelhados","pedrox-do-grau","pousada-exemplo"]'::jsonb) AS ids(local_id)
ON CONFLICT (local_id) DO NOTHING;

-- Link the exact approved cadastro to its verified public slug; fail on ambiguity.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.cadastros_comercios
  WHERE status = 'aprovado' AND lower(btrim(nome)) = 'pedrox do grau'
    AND (local_id IS NULL OR local_id = 'pedrox-do-grau');
  IF n <> 1 THEN RAISE EXCEPTION 'Expected exactly one approved commerce for the verified public slug; found %.', n; END IF;
  UPDATE public.cadastros_comercios SET local_id = 'pedrox-do-grau'
  WHERE local_id IS NULL AND status = 'aprovado' AND lower(btrim(nome)) = 'pedrox do grau';
END $$;

-- Standardize the mural status vocabulary while retaining archived history.
ALTER TABLE public.mural_cadastros DROP CONSTRAINT IF EXISTS mural_cadastros_status_check;
UPDATE public.mural_cadastros SET status = 'ativo' WHERE status = 'aprovado';
UPDATE public.mural_cadastros SET status = 'rejeitado' WHERE status = 'recusado';
ALTER TABLE public.mural_cadastros ADD CONSTRAINT mural_cadastros_status_check
  CHECK (status IN ('pendente','ativo','rejeitado','deletado'));

DROP POLICY IF EXISTS "Mural — público vê aprovados" ON public.mural_cadastros;
DROP POLICY IF EXISTS "Mural — público vê ativos" ON public.mural_cadastros;
CREATE POLICY "Mural — público vê ativos" ON public.mural_cadastros
  FOR SELECT TO anon USING (status = 'ativo');
DROP POLICY IF EXISTS "Mural — usuário vê próprio cadastro" ON public.mural_cadastros;
CREATE POLICY "Mural — usuário vê próprio cadastro" ON public.mural_cadastros
  FOR SELECT TO authenticated USING (((SELECT auth.uid()) = usuario_id) OR (status = 'ativo'));
DROP POLICY IF EXISTS "Mural — usuário exclui cadastro pendente" ON public.mural_cadastros;
DROP POLICY IF EXISTS "Mural — administrador vê todos os cadastros" ON public.mural_cadastros;
CREATE POLICY "Mural — administrador vê todos os cadastros" ON public.mural_cadastros
  FOR SELECT TO authenticated USING (auth.uid() = '4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid);

-- Clear references from already archived profiles only; keep the Storage objects.
UPDATE public.mural_cadastros
SET imagem = '', imagens = '[]'::jsonb, atualizado_em = now()
WHERE status = 'deletado'
  AND (COALESCE(imagem, '') <> '' OR COALESCE(imagens, '[]'::jsonb) <> '[]'::jsonb);
