-- #42: preflight do FATOR TOTP pertencente ao usuario da sessao AAL1.
-- Apenas prechallenge em laboratorio. Nao emite challenge, nao valida TOTP,
-- nao verifica assinatura JWT nem o nonce do escrow. ZERO AUTORIZACAO.
-- SECURITY INVOKER, sem EXECUTE a anon/authenticated/service_role.
BEGIN;

CREATE FUNCTION catalogo_private.catalogo_asaas_checar_fator_totp_aal1_inerte(
 p_sessao_id uuid,
 p_fator_id uuid
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $check_factor$
 SELECT pg_catalog.coalesce(
   (
     SELECT pg_catalog.jsonb_build_object(
       'elegivel', true,
       'userId', s.user_id::text,
       'sessionId', s.id::text,
       'factorId', f.id::text,
       'mfa_ja_verificado', false,
       'desafio_ja_emitido', false,
       'pagamento_autorizado', false,
       'status_operacional', 'HOLD_OBRIGATORIO'
     )
     FROM auth.sessions s
     JOIN auth.users u ON u.id=s.user_id
     JOIN auth.mfa_factors f ON f.id=p_fator_id
       AND f.user_id=s.user_id
     WHERE s.id=p_sessao_id
       AND s.aal::text='aal1'
       AND s.factor_id IS NULL
       AND f.factor_type::text='totp'
       AND f.status::text='verified'
       AND (s.not_after IS NULL OR s.not_after>pg_catalog.now())
       AND (u.banned_until IS NULL OR u.banned_until<=pg_catalog.now())
     LIMIT 1
   ),
   pg_catalog.jsonb_build_object(
     'elegivel', false,
     'mfa_ja_verificado', false,
     'desafio_ja_emitido', false,
     'pagamento_autorizado', false,
     'status_operacional', 'HOLD_OBRIGATORIO'
   )
 );
$check_factor$;

REVOKE ALL ON FUNCTION
 catalogo_private.catalogo_asaas_checar_fator_totp_aal1_inerte(uuid,uuid)
 FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION catalogo_private.catalogo_asaas_checar_fator_totp_aal1_inerte(uuid,uuid) IS
 'Somente owner DB: prova que fator TOTP verificado pertence ao usuario da sessao AAL1, nao que MFA do desafio ocorreu. Sem acesso Data API, Pix/baixa sempre HOLD.';

COMMIT;
