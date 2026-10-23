-- COB-06: SOMENTE Supabase STAGING jbttwihctuibchhcyqtl.
-- NÃO executar em PRODUÇÃO. Produto de catálogo fictício, SEM pedidos,
-- faturas, comissões, créditos, referências bancárias ou pagamentos.
-- O checkout e a entrega devem continuar pelos endpoints autenticados.
DO $qa$
DECLARE v_categoria uuid; v_preco numeric;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('qa-cob06-produto-baixo',0));
  IF (SELECT count(*) FROM public.catalogos WHERE comercio_id='asaas-cob02' AND proprietario_id IS NOT NULL AND NOT bloqueado) <> 1 THEN
    RAISE EXCEPTION 'Loja QA asaas-cob02 ausente, sem proprietario ou bloqueada';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.catalogo_produtos
    WHERE comercio_id='asaas-cob02' AND nome='Pedido teste Asaas - R$100'
      AND preco=100 AND disponivel AND deletado_em IS NULL
  ) THEN
    RAISE EXCEPTION 'Produto sentinela QA R$100 ausente ou alterado';
  END IF;
  SELECT categoria_id INTO v_categoria FROM public.catalogo_produtos
  WHERE comercio_id='asaas-cob02' AND nome='Pedido teste Asaas - R$100'
    AND preco=100 AND disponivel AND deletado_em IS NULL
  LIMIT 1;
  IF v_categoria IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.catalogo_categorias
    WHERE id=v_categoria AND comercio_id='asaas-cob02' AND ativa AND deletado_em IS NULL
  ) THEN RAISE EXCEPTION 'Categoria de produto QA inválida'; END IF;
  SELECT preco INTO v_preco FROM public.catalogo_produtos
  WHERE comercio_id='asaas-cob02' AND nome='COB-06 - Pedido teste R$40'
    AND deletado_em IS NULL LIMIT 1;
  IF v_preco IS NOT NULL AND v_preco <> 40 THEN
    RAISE EXCEPTION 'Produto COB-06 já existe com preço inesperado';
  END IF;
  IF v_preco IS NULL THEN
    INSERT INTO public.catalogo_produtos(
      comercio_id,categoria_id,nome,descricao,preco,disponivel,ordem
    ) VALUES(
      'asaas-cob02',v_categoria,'COB-06 - Pedido teste R$40',
      'Somente STAGING: simulação de entrega presencial, comissão total de R$2,80. Não gerar Pix abaixo de R$5.',
      40,true,2
    );
  END IF;
END $qa$;
