-- Defesa pós-liquidação: bloquear a reabertura ou adulteração de remuneração
-- com item de saque Asaas ativo, sem impedir a baixa bancária legítima.
-- A baixa do Asaas cria primeiro um repasse cuja metadata.saque_asaas_id
-- corresponde exatamente ao saque, então altera somente status/repasse_id/pago_em.
BEGIN;

CREATE OR REPLACE FUNCTION catalogo_private.catalogo_asaas_proteger_credito_reservado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $saque_guard$
DECLARE v_reserva uuid; v_repasse_saque text;
BEGIN
 IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;

 SELECT i.saque_id INTO v_reserva
 FROM public.catalogo_asaas_saque_itens i
 WHERE i.remuneracao_id=OLD.id AND i.ativo
 LIMIT 1;

 IF v_reserva IS NULL THEN RETURN NEW; END IF;

 -- Crédito já pago não pode ser reaberto, duplicado nem ter valor/destino alterado.
 IF OLD.status='pago' THEN
  RAISE EXCEPTION 'Crédito de saque Asaas liquidado; alteração financeira proibida'
   USING ERRCODE='23514';
 END IF;

 -- Para crédito ainda reservado, a ÚNICA alteração permitida é a baixa
 -- atômica após confirmação DONE pelo backend: status, repasse e hora.
 IF NEW.status<>'pago'
    OR NEW.repasse_id IS NULL
    OR NEW.pago_em IS NULL
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.pedido_id IS DISTINCT FROM OLD.pedido_id
    OR NEW.comercio_id IS DISTINCT FROM OLD.comercio_id
    OR NEW.motoboy_id IS DISTINCT FROM OLD.motoboy_id
    OR NEW.valor_centavos IS DISTINCT FROM OLD.valor_centavos
    OR NEW.financiamento_comprovado IS DISTINCT FROM OLD.financiamento_comprovado
    OR NEW.origem IS DISTINCT FROM OLD.origem
    OR NEW.criado_em IS DISTINCT FROM OLD.criado_em
    OR NEW.disponibilizado_em IS DISTINCT FROM OLD.disponibilizado_em
    OR NEW.metadata IS DISTINCT FROM OLD.metadata
 THEN
  RAISE EXCEPTION 'Crédito reservado para saque Asaas; alteração manual proibida'
   USING ERRCODE='23514';
 END IF;

 SELECT rep.metadata->>'saque_asaas_id' INTO v_repasse_saque
 FROM public.catalogo_repasses_v2 rep WHERE rep.id=NEW.repasse_id;

 IF v_repasse_saque IS DISTINCT FROM v_reserva::text THEN
  RAISE EXCEPTION 'Crédito reservado para saque Asaas; repasse divergente'
   USING ERRCODE='23514';
 END IF;

 RETURN NEW;
END;
$saque_guard$;

-- Abrange mudanças de valor, beneficiário, origem, repasse, estado, data e metadados.
DROP TRIGGER IF EXISTS catalogo_asaas_reserva_guard ON public.catalogo_remuneracoes_v2;
CREATE TRIGGER catalogo_asaas_reserva_guard
 BEFORE UPDATE ON public.catalogo_remuneracoes_v2
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_proteger_credito_reservado();

REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_proteger_credito_reservado()
 FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
