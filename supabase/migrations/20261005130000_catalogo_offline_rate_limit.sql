BEGIN;

CREATE TABLE IF NOT EXISTS public.catalogo_offline_rate_limits (
  chave_hash text PRIMARY KEY CHECK (char_length(chave_hash) = 64),
  janela_inicio timestamptz NOT NULL DEFAULT now(),
  requisicoes integer NOT NULL DEFAULT 0 CHECK (requisicoes >= 0),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.catalogo_offline_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.catalogo_offline_rate_limits FROM anon, authenticated;
GRANT ALL ON TABLE public.catalogo_offline_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.catalogo_offline_consumir_limite(
  p_chave_hash text,
  p_limite integer DEFAULT 10,
  p_janela_segundos integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_row public.catalogo_offline_rate_limits%ROWTYPE; v_now timestamptz := pg_catalog.now();
BEGIN
  IF p_limite < 1 OR p_janela_segundos < 1 OR char_length(p_chave_hash) <> 64 THEN RETURN false; END IF;
  SELECT * INTO v_row FROM public.catalogo_offline_rate_limits WHERE chave_hash = p_chave_hash FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.catalogo_offline_rate_limits (chave_hash, janela_inicio, requisicoes, atualizado_em) VALUES (p_chave_hash, v_now, 1, v_now);
    RETURN true;
  END IF;
  IF v_row.janela_inicio + make_interval(secs => p_janela_segundos) <= v_now THEN
    UPDATE public.catalogo_offline_rate_limits SET janela_inicio = v_now, requisicoes = 1, atualizado_em = v_now WHERE chave_hash = p_chave_hash;
    RETURN true;
  END IF;
  IF v_row.requisicoes >= p_limite THEN
    UPDATE public.catalogo_offline_rate_limits SET atualizado_em = v_now WHERE chave_hash = p_chave_hash;
    RETURN false;
  END IF;
  UPDATE public.catalogo_offline_rate_limits SET requisicoes = requisicoes + 1, atualizado_em = v_now WHERE chave_hash = p_chave_hash;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.catalogo_offline_consumir_limite(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_offline_consumir_limite(text, integer, integer) TO service_role;

COMMIT;
