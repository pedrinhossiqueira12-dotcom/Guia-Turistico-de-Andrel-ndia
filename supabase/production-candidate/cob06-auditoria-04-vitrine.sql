-- Candidato forward-only; journal de reconciliacao, sem alterar quitacao/arquivamento.
BEGIN;
CREATE TABLE catalogo_private.catalogo_vitrine_reconciliacoes(
 comercio_id text PRIMARY KEY, sincronizado_em timestamptz,
 criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE catalogo_private.catalogo_vitrine_reconciliacoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON catalogo_private.catalogo_vitrine_reconciliacoes FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.catalogo_finalizar_encerramento_financeiro(text,uuid) RENAME TO catalogo_finalizar_encerramento_pre_vitrine;
ALTER FUNCTION public.catalogo_arquivar_sem_catalogo_admin(text,uuid) RENAME TO catalogo_arquivar_sem_catalogo_pre_vitrine;
REVOKE ALL ON FUNCTION public.catalogo_finalizar_encerramento_pre_vitrine(text,uuid),
 public.catalogo_arquivar_sem_catalogo_pre_vitrine(text,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.catalogo_finalizar_encerramento_financeiro(p_comercio text,p_admin uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb; BEGIN
 r:=public.catalogo_finalizar_encerramento_pre_vitrine(p_comercio,p_admin);
 IF r->>'ok'='true' AND r->>'situacao'='arquivado' THEN
  INSERT INTO catalogo_private.catalogo_vitrine_reconciliacoes(comercio_id) VALUES(p_comercio) ON CONFLICT DO NOTHING;
 END IF;
 RETURN r;
END $$;
CREATE FUNCTION public.catalogo_arquivar_sem_catalogo_admin(p_comercio text,p_admin uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb; BEGIN
 r:=public.catalogo_arquivar_sem_catalogo_pre_vitrine(p_comercio,p_admin);
 IF r->>'ok'='true' AND r->>'situacao'='arquivado' THEN
  INSERT INTO catalogo_private.catalogo_vitrine_reconciliacoes(comercio_id) VALUES(p_comercio) ON CONFLICT DO NOTHING;
 END IF;
 RETURN r;
END $$;
CREATE FUNCTION public.catalogo_confirmar_vitrine_admin(p_comercio text,p_admin uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_admin IS DISTINCT FROM '4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid
 OR NOT EXISTS(SELECT 1 FROM public.comercios_publicados WHERE local_id=p_comercio AND status='deletado')
 THEN RETURN jsonb_build_object('ok',false); END IF;
 UPDATE catalogo_private.catalogo_vitrine_reconciliacoes SET sincronizado_em=coalesce(sincronizado_em,clock_timestamp())
 WHERE comercio_id=p_comercio;
 RETURN jsonb_build_object('ok',FOUND);
END $$;
CREATE FUNCTION public.catalogo_listar_encerramentos_admin(p_admin uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb;
BEGIN
 IF p_admin IS DISTINCT FROM '4b9a0233-6b72-4573-aebd-d596c5b15e1b'::uuid THEN RAISE EXCEPTION 'Acesso negado'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO r FROM (
  SELECT coalesce(e.comercio_id,v.comercio_id) comercio_id,
   coalesce(e.situacao,'arquivado') situacao,coalesce(e.divida_apurada_centavos,0) divida_apurada_centavos,
   coalesce(e.solicitado_em,v.criado_em) solicitado_em,
   coalesce(e.situacao,'arquivado')='arquivado' AS sincronizacao_pendente
  FROM public.catalogo_encerramentos_comercio e FULL JOIN catalogo_private.catalogo_vitrine_reconciliacoes v USING(comercio_id)
  WHERE (e.comercio_id IS NOT NULL AND e.situacao<>'arquivado') OR v.sincronizado_em IS NULL
  ORDER BY coalesce(e.solicitado_em,v.criado_em),coalesce(e.comercio_id,v.comercio_id) LIMIT 100
 ) x;
 RETURN r;
END $$;
-- FULL JOIN: entradas sem catalogo com recibo sincronizado tambem saem da fila.
-- Todas as identidades administrativas sao validadas novamente nas funcoes originais.
REVOKE ALL ON FUNCTION public.catalogo_finalizar_encerramento_financeiro(text,uuid),public.catalogo_arquivar_sem_catalogo_admin(text,uuid),
 public.catalogo_confirmar_vitrine_admin(text,uuid),public.catalogo_listar_encerramentos_admin(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_finalizar_encerramento_financeiro(text,uuid),public.catalogo_arquivar_sem_catalogo_admin(text,uuid),
 public.catalogo_confirmar_vitrine_admin(text,uuid),public.catalogo_listar_encerramentos_admin(uuid) TO service_role;
COMMIT;
