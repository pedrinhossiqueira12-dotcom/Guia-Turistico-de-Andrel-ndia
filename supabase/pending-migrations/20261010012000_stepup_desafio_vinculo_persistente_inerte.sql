-- #42: persistencia INERTE de desafio MFA de consulta documental.
-- NAO chama Supabase Auth: challenge_id ainda pode ser ficticio, portanto
-- nenhuma prova de MFA real/recente, nenhum parecer ou pagamento.
-- SEM CREATE/INSERT/SELECT/EXECUTE para papeis Data API (anon/authenticated/service_role).
-- Somente owner PostgreSQL em testes CI de transacao descartavel.
BEGIN;

CREATE TABLE public.catalogo_asaas_stepup_desafios_documentais_ensaio (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 nonce uuid NOT NULL UNIQUE
   REFERENCES public.catalogo_asaas_intencoes_mfa_documentais_ensaio(nonce)
   ON DELETE RESTRICT,
 challenge_id uuid NOT NULL UNIQUE,
 revisor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 sessao_id uuid NOT NULL,
 fator_id uuid NOT NULL,
 separacao_id uuid NOT NULL
   REFERENCES public.catalogo_asaas_separacoes_excepcionais(id) ON DELETE RESTRICT,
 dossie_hash_sha256 text NOT NULL CHECK(dossie_hash_sha256 ~ '^[a-f0-9]{64}$'),
 finalidade text NOT NULL DEFAULT 'consulta_documental_ensaio'
   CHECK(finalidade='consulta_documental_ensaio'),
 estado text NOT NULL DEFAULT 'desafio_emitido_sem_verificacao'
   CHECK(estado='desafio_emitido_sem_verificacao'),
 iniciado_em timestamptz NOT NULL,
 expira_em timestamptz NOT NULL,
 CHECK(expira_em>iniciado_em),
 CHECK(expira_em<=iniciado_em+interval '2 minutes')
);
ALTER TABLE public.catalogo_asaas_stepup_desafios_documentais_ensaio
 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_asaas_stepup_desafios_documentais_ensaio
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION catalogo_private.catalogo_asaas_preparar_stepup_desafio_inerte()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $issue$
DECLARE
 v_i public.catalogo_asaas_intencoes_mfa_documentais_ensaio%ROWTYPE;
 v_preflight jsonb;
 v_dossie jsonb;
 v_financeiro jsonb;
 v_fator uuid;
 v_hora timestamptz;
BEGIN
 IF NEW.nonce IS NULL OR NEW.challenge_id IS NULL THEN
  RAISE EXCEPTION 'Nonce e challenge_id obrigatorios no ensaio'
   USING ERRCODE='23514';
 END IF;
 -- A linha da intencao e trancada: dois requests de desafio do MESMO nonce
 -- nao passam simultaneamente. A UNIQUE(nonce) e a segunda defesa.
 SELECT * INTO v_i
 FROM public.catalogo_asaas_intencoes_mfa_documentais_ensaio
 WHERE nonce=NEW.nonce FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Nonce de intencao documental ausente'
   USING ERRCODE='23514';
 END IF;
 v_hora:=pg_catalog.clock_timestamp();
 IF v_i.expira_em<=v_hora OR EXISTS(
  SELECT 1 FROM public.catalogo_asaas_usos_nonce_documentais_ensaio u
  WHERE u.nonce=v_i.nonce
 ) THEN
  RAISE EXCEPTION 'Nonce expirado ou ja utilizado; sem desafio MFA'
   USING ERRCODE='23514';
 END IF;

 -- Nao confiar em colunas de sessao/fator/revisor passadas pelo cliente.
 -- Em testes as GUCs request.jwt.* sao mocks locais, sem autenticacao.
 v_preflight:=public.catalogo_asaas_preflight_sessao_revisor_inerte();
 IF v_preflight->>'sessao_aal2_confirmada' IS DISTINCT FROM 'true'
  OR v_preflight->>'indicacao_ensaio_vigente' IS DISTINCT FROM 'true'
  OR v_preflight->>'jwt_recente_confirmado' IS DISTINCT FROM 'true'
  OR auth.uid() IS DISTINCT FROM v_i.revisor_id
  OR auth.jwt()->>'session_id' IS DISTINCT FROM v_i.sessao_id::text THEN
  RAISE EXCEPTION 'Sessao, identidade ou revisor sem elegibilidade de ensaio'
   USING ERRCODE='23514';
 END IF;
 SELECT s.factor_id INTO v_fator FROM auth.sessions s
 WHERE s.id=v_i.sessao_id AND s.user_id=v_i.revisor_id
  AND s.aal::text='aal2' AND s.factor_id IS NOT NULL
  AND (s.not_after IS NULL OR s.not_after>v_hora);
 IF v_fator IS NULL OR NOT EXISTS(
  SELECT 1 FROM auth.mfa_factors f
  WHERE f.id=v_fator AND f.user_id=v_i.revisor_id
   AND f.factor_type::text='totp' AND f.status::text='verified'
 ) THEN
  RAISE EXCEPTION 'Fator TOTP nao confirmado em Auth (somente ensaio)'
   USING ERRCODE='23514';
 END IF;

 v_dossie:=public.catalogo_asaas_verificar_integridade_dossie_escrow(v_i.separacao_id);
 v_financeiro:=public.catalogo_asaas_diagnosticar_separacao_excepcional(v_i.separacao_id);
 IF v_dossie->>'integridade_valida' IS DISTINCT FROM 'true'
  OR v_dossie->>'hash_final_registrado_sha256' IS DISTINCT FROM v_i.dossie_hash_sha256
  OR v_financeiro->>'composicao_inalterada_e_financiada' IS DISTINCT FROM 'true'
 THEN
  RAISE EXCEPTION 'Evidencia documental/financeira mudou desde o nonce'
   USING ERRCODE='23514';
 END IF;

 -- Todos os campos de contexto/tempo/estado sao carimbados pelo banco.
 -- O challenge_id vem de um provedor *falso* no laboratorio: NAO e prova!
 NEW.id:=pg_catalog.gen_random_uuid();
 NEW.revisor_id:=v_i.revisor_id;
 NEW.sessao_id:=v_i.sessao_id;
 NEW.fator_id:=v_fator;
 NEW.separacao_id:=v_i.separacao_id;
 NEW.dossie_hash_sha256:=v_i.dossie_hash_sha256;
 NEW.finalidade:='consulta_documental_ensaio';
 NEW.estado:='desafio_emitido_sem_verificacao';
 NEW.iniciado_em:=v_hora;
 NEW.expira_em:=pg_catalog.least(v_hora+interval '2 minutes',v_i.expira_em);
 IF NEW.expira_em<=NEW.iniciado_em THEN
  RAISE EXCEPTION 'Desafio emitido fora do prazo da intencao'
   USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $issue$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_preparar_stepup_desafio_inerte()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER catalogo_asaas_preparar_stepup_desafio_inerte
 BEFORE INSERT ON public.catalogo_asaas_stepup_desafios_documentais_ensaio
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_preparar_stepup_desafio_inerte();

CREATE FUNCTION catalogo_private.catalogo_asaas_stepup_desafio_imutavel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $immutable$
BEGIN
 RAISE EXCEPTION 'Desafio de ensaio imutavel, sem UPDATE/DELETE/credencial'
  USING ERRCODE='23514';
END $immutable$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_stepup_desafio_imutavel()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER catalogo_asaas_stepup_desafio_imutavel
 BEFORE UPDATE OR DELETE ON public.catalogo_asaas_stepup_desafios_documentais_ensaio
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_stepup_desafio_imutavel();

COMMENT ON TABLE public.catalogo_asaas_stepup_desafios_documentais_ensaio IS
 'LABORATORIO somente. ID desafio por nonce e sessao, sem chamada Auth real, sem prova MFA e sem autorizacao financeira. DB owner apenas.';
COMMIT;
