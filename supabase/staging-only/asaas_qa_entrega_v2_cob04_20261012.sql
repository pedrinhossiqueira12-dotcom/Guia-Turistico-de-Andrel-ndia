-- COB-04: preparacao exclusiva do projeto STAGING jbttwihctuibchhcyqtl.
-- NUNCA executar na producao. Nao inserir pedidos, comissoes, faturas ou Pix.
-- Permite um pedido de entrega ficticia na loja QA ja existente, sem habilitar
-- pagamento real, sem alterar proprietario, recebedor ou demais comercios.
DO $qa$
DECLARE
  v_modalidades text[];
  v_metodos text[];
  v_bloqueado boolean;
BEGIN
  SELECT modalidades, metodos_pagamento, bloqueado
    INTO v_modalidades, v_metodos, v_bloqueado
  FROM public.catalogos
  WHERE comercio_id='asaas-cob02'
  FOR UPDATE;

  IF NOT FOUND OR v_bloqueado IS DISTINCT FROM false
     OR v_metodos IS DISTINCT FROM ARRAY['dinheiro']::text[]
  THEN
    RAISE EXCEPTION 'COB-04 QA bloqueada: comercio inexistente ou fora da configuracao aprovada';
  END IF;

  IF v_modalidades = ARRAY['retirada']::text[] THEN
    UPDATE public.catalogos
    SET modalidades = ARRAY['retirada','entrega']::text[], atualizado_em=now()
    WHERE comercio_id='asaas-cob02';
  ELSIF v_modalidades IS DISTINCT FROM ARRAY['retirada','entrega']::text[] THEN
    RAISE EXCEPTION 'COB-04 QA bloqueada: modalidade inesperada';
  END IF;
END $qa$;

-- Verificacao de leitura: SELECT comercio_id, modalidades, metodos_pagamento
-- FROM public.catalogos WHERE comercio_id='asaas-cob02';
-- Rollback: retornar modalidade apenas 'retirada' se NAO existir pedido
-- de entrega pendente. NUNCA apagar faturas/comissoes ou historico.
