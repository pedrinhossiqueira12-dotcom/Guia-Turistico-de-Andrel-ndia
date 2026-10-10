-- Exclusao mutua ENTRE saque comum (reserva) e pedidos excepcionais.
-- Nenhum credito e reservado/pago por esta migration; somente sao recusadas
-- NOVAS operacoes quando existe reserva bancaria OU revisao em aberto.
--
-- O RPC existente catalogo_asaas_reservar_saque obtem o advisory lock
-- hashtextextended('asaas-saque:'||motoboy_id,0) ANTES de inserir
-- catalogo_asaas_saques. Os gatilhos usam exatamente a mesma chave.
-- A migration NAO habilita Pix Asaas de producao.
BEGIN;

DO $preflight$
BEGIN
 IF EXISTS (
  SELECT 1
  FROM public.catalogo_asaas_saques saque
  WHERE saque.status IN ('reservado','enviado','revisao')
    AND (
     EXISTS (
      SELECT 1 FROM public.catalogo_asaas_saldos_residuais r
      WHERE r.motoboy_id=saque.motoboy_id
        AND r.status IN ('pendente','em_analise')
     ) OR EXISTS (
      SELECT 1 FROM public.catalogo_asaas_regularizacoes_inativos s
      WHERE s.motoboy_id=saque.motoboy_id
        AND s.status IN ('pendente','em_analise')
     )
    )
 ) THEN
  RAISE EXCEPTION 'Existem reservas de saque e revisoes excepcionais abertas para o mesmo motoboy. Conciliar antes de migrar.'
    USING ERRCODE='23514';
 END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_bloquear_saque_com_revisao_aberta()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $guard$
BEGIN
 IF NEW.motoboy_id IS NULL THEN
  RAISE EXCEPTION 'Titular do saque ausente' USING ERRCODE='23514';
 END IF;

 -- Mesma trava usada na RPC atual de reservas regulares.
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('asaas-saque:'||NEW.motoboy_id::text,0)
 );

 IF EXISTS (
   SELECT 1 FROM public.catalogo_asaas_saldos_residuais r
   WHERE r.motoboy_id=NEW.motoboy_id
     AND r.status IN ('pendente','em_analise')
 ) OR EXISTS (
   SELECT 1 FROM public.catalogo_asaas_regularizacoes_inativos s
   WHERE s.motoboy_id=NEW.motoboy_id
     AND s.status IN ('pendente','em_analise')
 ) THEN
  RAISE EXCEPTION 'Motoboy possui revisao financeira excepcional em aberto; nao reservar saque regular.'
    USING ERRCODE='23514';
 END IF;

 RETURN NEW;
END
$guard$;

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_bloquear_revisao_com_saque_em_aberto()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $guard$
BEGIN
 IF NEW.motoboy_id IS NULL THEN
  RAISE EXCEPTION 'Titular do pedido financeiro ausente'
   USING ERRCODE='23514';
 END IF;

 -- A outra trava das revisoes cruzadas usa a chave
 -- 'revisao-financeira-motoboy'. Ambas as tabelas excepcionais executam
 -- primeiro a checagem de sobreposicao, depois esta segunda trava.
 -- O saque comum usa apenas a trava de 'asaas-saque'.
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('asaas-saque:'||NEW.motoboy_id::text,0)
 );

 IF EXISTS (
   SELECT 1 FROM public.catalogo_asaas_saques s
   WHERE s.motoboy_id=NEW.motoboy_id
     AND s.status IN ('reservado','enviado','revisao')
 ) THEN
  RAISE EXCEPTION 'Existe saque regular reservado ou em revisao. Conciliar o banco antes de abrir pedido excepcional.'
    USING ERRCODE='23514';
 END IF;

 RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION catalogo_private.catalogo_bloquear_saque_com_revisao_aberta()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_bloquear_revisao_com_saque_em_aberto()
  FROM PUBLIC,anon,authenticated,service_role;

DROP TRIGGER IF EXISTS catalogo_bloquear_saque_se_revisao_excepcional
 ON public.catalogo_asaas_saques;
CREATE TRIGGER catalogo_bloquear_saque_se_revisao_excepcional
 BEFORE INSERT ON public.catalogo_asaas_saques
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_bloquear_saque_com_revisao_aberta();

-- O nome 'z_...' garante que a checagem anterior de revisoes cruzadas
-- ('catalogo_asaas_residual_sem_sobreposicao') seja executada primeiro
-- em todas as tabelas, na mesma ordem de aquisicao de locks.
DROP TRIGGER IF EXISTS z_catalogo_bloquear_residual_se_saque_aberto
 ON public.catalogo_asaas_saldos_residuais;
CREATE TRIGGER z_catalogo_bloquear_residual_se_saque_aberto
 BEFORE INSERT ON public.catalogo_asaas_saldos_residuais
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_bloquear_revisao_com_saque_em_aberto();

DROP TRIGGER IF EXISTS z_catalogo_bloquear_saida_se_saque_aberto
 ON public.catalogo_asaas_regularizacoes_inativos;
CREATE TRIGGER z_catalogo_bloquear_saida_se_saque_aberto
 BEFORE INSERT ON public.catalogo_asaas_regularizacoes_inativos
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_bloquear_revisao_com_saque_em_aberto();

COMMIT;
