-- #42: fechamento da superficie publica do preflight experimental.
-- Nao prova MFA step-up real; nao verifica JWT assinado; nao aprova pagamentos.
-- A leitura de auth.sessions + auth.mfa_factors e SOMENTE para o owner
-- SQL / backend futuro auditado. Nenhuma funcao Edge importa este contrato.
BEGIN;

-- O preflight foi criado como RPC publica autenticada na fase de ensaio,
-- embora exponha um SECURITY DEFINER que le auth.*. As funcoes internas
-- continuam acessando-o como owner PostgreSQL (SECURITY DEFINER); a
-- interface direta de navegador NAO e necessaria, e fica fechada.
REVOKE ALL ON FUNCTION
 public.catalogo_asaas_preflight_sessao_revisor_inerte()
 FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.catalogo_asaas_preflight_sessao_revisor_inerte() IS
 'Somente chamada interna por owner SQL. RPC direto authenticated foi REVOGADO; AAL2 nao comprova step-up de operacao, nem libera parecer/Pix.';

-- O verificador JWT de laboratorio consome um contrato de sessao,
-- mas este leitor NAO valida tokens, nonce ou o challenge real.
-- SECURITY INVOKER (nao DEF), schema privado, zero API grants.
-- O usuario/sessao/fator retornados sao os atuais do AUTH,
-- nunca de claims ou JSON de um navegador.
CREATE FUNCTION catalogo_private.catalogo_asaas_ler_sessao_fator_auth_inerte(
 p_sessao_id uuid
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $auth_reader$
 SELECT pg_catalog.jsonb_build_object(
   'id',s.id::text,
   'userId',s.user_id::text,
   'aal',s.aal::text,
   'factorId',f.id::text,
   'notAfterMs',CASE WHEN s.not_after IS NULL THEN NULL
     ELSE (extract(epoch FROM s.not_after)*1000)::bigint END,
   'factorUserId',f.user_id::text,
   'factorType',f.factor_type::text,
   'factorStatus',f.status::text
 )
 FROM auth.sessions s
 JOIN auth.users u ON u.id=s.user_id
 JOIN auth.mfa_factors f ON f.id=s.factor_id
   AND f.user_id=s.user_id
 WHERE s.id=p_sessao_id
   AND s.aal::text='aal2'
   AND f.factor_type::text='totp'
   AND f.status::text='verified'
   AND (s.not_after IS NULL OR s.not_after>pg_catalog.now())
   AND (u.banned_until IS NULL OR u.banned_until<=pg_catalog.now())
 LIMIT 1;
$auth_reader$;

REVOKE ALL ON FUNCTION
 catalogo_private.catalogo_asaas_ler_sessao_fator_auth_inerte(uuid)
 FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION catalogo_private.catalogo_asaas_ler_sessao_fator_auth_inerte(uuid) IS
 'Leitor owner-only da sessao/fator Auth atuais para integrar backend de sessao. Sem jwt verify, sem MFA recente da operacao, nenhuma permissao de parecer/pagamento.';

COMMIT;
