-- #42: leitura owner-only de sessao AAL1 antes de iniciar challenge TOTP.
-- Funcao de CONSULTA, sem credencial, sem OTP, sem comprovante financeiro.
-- So STATUS da sessao Auth. A API GoTrue precisa comprovar depois que o
-- factor_id indicado pertence ao usuario e que o challenge foi verificado.
-- NAO expor a Data API nem substituir o leitor final AAL2.
BEGIN;

CREATE FUNCTION catalogo_private.catalogo_asaas_ler_sessao_aal1_inerte(
 p_sessao_id uuid
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $basic$
 SELECT pg_catalog.jsonb_build_object(
   'id', s.id::text,
   'userId', s.user_id::text,
   'aal', s.aal::text,
   'notAfterMs', CASE WHEN s.not_after IS NULL THEN NULL
     ELSE (extract(epoch FROM s.not_after)*1000)::bigint END,
   'usuarioBloqueado', false
 )
 FROM auth.sessions s
 JOIN auth.users u ON u.id=s.user_id
 WHERE s.id=p_sessao_id
   AND s.aal::text='aal1'
   -- AAL1 ainda nao associa o fator TOTP a esta sessao.
   -- Se factor_id estiver marcado na sessao AAL1 inconsistente, negar.
   AND s.factor_id IS NULL
   AND (s.not_after IS NULL OR s.not_after>pg_catalog.now())
   AND (u.banned_until IS NULL OR u.banned_until<=pg_catalog.now())
 LIMIT 1;
$basic$;

REVOKE ALL ON FUNCTION
 catalogo_private.catalogo_asaas_ler_sessao_aal1_inerte(uuid)
 FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION catalogo_private.catalogo_asaas_ler_sessao_aal1_inerte(uuid) IS
 'Somente owner DB: sessao Auth AAL1 antes do segundo fator. Nao verifica MFA, fator, challenge, nonce, parecer ou Pix.';
COMMIT;
