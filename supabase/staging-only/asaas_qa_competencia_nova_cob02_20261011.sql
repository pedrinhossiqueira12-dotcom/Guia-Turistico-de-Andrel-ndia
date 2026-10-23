-- COB-02: APENAS STAGING jbttwihctuibchhcyqtl. PROIBIDO EM PRODUCAO.
-- Outra loja de TESTES e necessaria porque 2026-10 ja foi paga na loja antiga.
-- Somente categoria, produto e vinculo TESTE; SEM pedidos, comissoes, saques,
-- recebimentos, faturas, recebedores MP ficticios, pagamentos ou chaves.
DO $qa$
DECLARE v_owner uuid; v_cat uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('qa-cob02-asaas-sem-duplicidade',0));
  SELECT proprietario_id INTO v_owner FROM public.catalogos WHERE comercio_id='asaas-homologacao';
  IF v_owner IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=v_owner)
  THEN RAISE EXCEPTION 'Falta proprietario de QA autenticado'; END IF;
  INSERT INTO public.comercios_publicados(local_id,status,solicitante_id,dados)
  VALUES ('asaas-cob02','ativo',v_owner,'{"nome":"Loja financeira de homologacao COB-02","descricao":"Somente STAGING, nunca producao"}'::jsonb)
  ON CONFLICT(local_id) DO NOTHING;
  INSERT INTO public.catalogos(comercio_id,proprietario_id,modalidades,metodos_pagamento,bloqueado)
  VALUES ('asaas-cob02',v_owner,ARRAY['retirada'],ARRAY['dinheiro'],false)
  ON CONFLICT(comercio_id) DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM public.catalogos WHERE comercio_id='asaas-cob02' AND proprietario_id=v_owner AND NOT bloqueado)
  THEN RAISE EXCEPTION 'Comercio QA nao pertence ao proprietario esperado'; END IF;
  SELECT id INTO v_cat FROM public.catalogo_categorias
   WHERE comercio_id='asaas-cob02' AND nome='Produtos de homologação' AND ativa AND deletado_em IS NULL LIMIT 1;
  IF v_cat IS NULL THEN
    INSERT INTO public.catalogo_categorias(comercio_id,nome,ordem,ativa)
    VALUES ('asaas-cob02','Produtos de homologação',1,true) RETURNING id INTO v_cat;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.catalogo_produtos WHERE comercio_id='asaas-cob02' AND nome='Pedido teste Asaas - R$100' AND deletado_em IS NULL)
  THEN
    INSERT INTO public.catalogo_produtos(comercio_id,categoria_id,nome,descricao,preco,disponivel,ordem)
    VALUES('asaas-cob02',v_cat,'Pedido teste Asaas - R$100','Somente homologação financeira, sem mercadoria real.',100,true,1);
  END IF;
END $qa$;
-- Somente o conjunto EXATO de duas lojas de teste dispensa recebedor MP.
-- Mantem publicacao, titular, bloqueio e a exigencia MP para demais lojas.
CREATE OR REPLACE FUNCTION catalogo_private.catalogo_esta_ativo(p_comercio_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
  SELECT EXISTS(
    SELECT 1 FROM public.comercios_publicados cp
    JOIN public.catalogos c ON c.comercio_id=cp.local_id
    LEFT JOIN public.catalogo_recebedores r ON r.comercio_id=c.comercio_id
    WHERE cp.local_id=p_comercio_id
      AND cp.status='ativo'
      AND NOT c.bloqueado
      AND c.proprietario_id IS NOT NULL
      AND ((r.status='ativo' AND r.conta_externa_id IS NOT NULL)
           OR p_comercio_id IN ('asaas-homologacao','asaas-cob02'))
  );
$fn$;
-- Restore/rollback: usar definicao original de catalogo_esta_ativo, removendo
-- a OR e deixando os registros QA isolados sem operacao; nunca limpar historico.
