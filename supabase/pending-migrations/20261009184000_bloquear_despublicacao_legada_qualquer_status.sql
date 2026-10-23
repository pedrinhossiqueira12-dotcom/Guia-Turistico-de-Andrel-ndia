-- Defesa complementar: impedir despublicação/exclusão por rotas legadas
-- mesmo quando a publicação atual não tem status 'ativo'.
-- Requer 20261009162000 e mantém a mesma assinatura do trigger existente.
-- Aplicar somente em STAGING até a aprovação de produção.
BEGIN;

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_proteger_despublicacao()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $guard$
DECLARE
  v_id text;
  v_p jsonb;
BEGIN
  v_id := OLD.local_id;

  IF TG_OP='UPDATE' THEN
    -- Alterações sem troca de status não são despublicação.
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
    -- A republicação é validada por catalogo_impedir_republicacao_encerrada.
    IF NEW.status='ativo' THEN RETURN NEW; END IF;
  END IF;

  -- Compartilha o lock de catalogo_solicitar_encerramento_financeiro.
  -- A guarda não depende de OLD.status: pendente/deletado também podem ter dívida.
  PERFORM 1 FROM public.catalogos WHERE comercio_id=v_id FOR UPDATE;
  v_p := catalogo_private.catalogo_pendencias_encerramento(v_id);
  IF (v_p->>'divida_centavos')::bigint>0
     OR (v_p->>'faturas_pendentes')::bigint>0
     OR (v_p->>'pedidos_em_andamento')::bigint>0
  THEN
    RAISE EXCEPTION
      'Estabelecimento com faturas, comissões ou pedidos pendentes: arquivamento negado'
      USING ERRCODE='23514';
  END IF;

  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$guard$;

REVOKE ALL ON FUNCTION catalogo_private.catalogo_proteger_despublicacao()
  FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
