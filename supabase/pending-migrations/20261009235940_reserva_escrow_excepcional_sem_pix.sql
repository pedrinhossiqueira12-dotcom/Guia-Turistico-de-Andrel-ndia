-- Reserva de comissões ESPECÍFICAS para análise excepcional; SEM LIQUIDAÇÃO.
-- Não expõe endpoint a cliente/admin e não habilita transferências.
-- Uma separação não pode ser liberada/paga por esta migração.
-- A conciliação futura exigirá prova bancária e outra migração auditada.
BEGIN;

CREATE TABLE IF NOT EXISTS public.catalogo_asaas_separacoes_excepcionais (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tipo text NOT NULL CHECK(tipo IN ('residual','saida')),
 solicitacao_id uuid NOT NULL,
 motoboy_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 valor_centavos bigint NOT NULL CHECK(valor_centavos>0),
 creditos bigint NOT NULL CHECK(creditos>0),
 fingerprint_sha256 text NOT NULL CHECK(fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
 situacao text NOT NULL DEFAULT 'congelada' CHECK(situacao='congelada'),
 criado_em timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tipo,solicitacao_id),
 UNIQUE(motoboy_id)
);
CREATE TABLE IF NOT EXISTS public.catalogo_asaas_separacoes_excepcionais_itens (
 separacao_id uuid NOT NULL REFERENCES public.catalogo_asaas_separacoes_excepcionais(id)
  ON DELETE RESTRICT,
 remuneracao_id uuid NOT NULL UNIQUE REFERENCES public.catalogo_remuneracoes_v2(id)
  ON DELETE RESTRICT,
 valor_centavos integer NOT NULL CHECK(valor_centavos>0),
 PRIMARY KEY(separacao_id,remuneracao_id)
);
ALTER TABLE public.catalogo_asaas_separacoes_excepcionais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_asaas_separacoes_excepcionais_itens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_asaas_separacoes_excepcionais
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.catalogo_asaas_separacoes_excepcionais_itens
 FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.catalogo_asaas_separacoes_excepcionais TO service_role;
GRANT SELECT ON public.catalogo_asaas_separacoes_excepcionais_itens TO service_role;

-- O mesmo lock do saque ordinário, comprovacao bancaria e revisoes.
-- Garante que INSERT do saque comum nao ignore separacao excepcional
-- caso a solicitacao venha a ser recusada.
CREATE OR REPLACE FUNCTION catalogo_private.catalogo_asaas_guardar_saque_sem_escrow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $guard$
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('asaas-saque:'||NEW.motoboy_id::text,0)
 );
 IF EXISTS(
  SELECT 1 FROM public.catalogo_asaas_separacoes_excepcionais e
  WHERE e.motoboy_id=NEW.motoboy_id
 ) THEN
  RAISE EXCEPTION 'Motoboy tem créditos separados em revisao excepcional; sem saque comum.'
   USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_guardar_saque_sem_escrow()
 FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS zzz_catalogo_asaas_guardar_saque_sem_escrow
 ON public.catalogo_asaas_saques;
CREATE TRIGGER zzz_catalogo_asaas_guardar_saque_sem_escrow
 BEFORE INSERT ON public.catalogo_asaas_saques
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_guardar_saque_sem_escrow();

-- EXCLUSIVAMENTE para ensaios isolados; nenhum endpoint da Edge chama esta RPC.
-- A existencia desta RPC nao significa aprovacao ou realizacao de transferencia.
CREATE OR REPLACE FUNCTION public.catalogo_asaas_separar_creditos_excepcionais(
 p_tipo text,p_solicitacao uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $reserve$
DECLARE
 v_uid uuid;
 v_snapshot bigint;
 v_status text;
 v_check jsonb;
 v_separacao uuid;
 v_ids uuid[];
 v_total bigint;
 v_count bigint;
 v_hash text;
 v_existing public.catalogo_asaas_separacoes_excepcionais%ROWTYPE;
BEGIN
 IF p_tipo IS NULL OR p_tipo NOT IN('residual','saida') OR p_solicitacao IS NULL THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Solicitacao invalida.');
 END IF;
 IF p_tipo='residual' THEN
  SELECT motoboy_id,saldo_snapshot_centavos::bigint,status
   INTO v_uid,v_snapshot,v_status
  FROM public.catalogo_asaas_saldos_residuais
  WHERE id=p_solicitacao FOR UPDATE;
 ELSE
  SELECT motoboy_id,saldo_snapshot_centavos::bigint,status
   INTO v_uid,v_snapshot,v_status
  FROM public.catalogo_asaas_regularizacoes_inativos
  WHERE id=p_solicitacao FOR UPDATE;
 END IF;
 IF v_uid IS NULL THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Solicitacao inexistente.');
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('asaas-saque:'||v_uid::text,0)
 );
 SELECT * INTO v_existing
 FROM public.catalogo_asaas_separacoes_excepcionais
 WHERE motoboy_id=v_uid;
 IF FOUND THEN
  RETURN jsonb_build_object('ok',false,
   'mensagem','Ja existe separacao excepcional imutavel para este titular.',
   'separacao_id',v_existing.id);
 END IF;
 IF v_status NOT IN('pendente','em_analise') THEN
  RETURN jsonb_build_object('ok',false,'mensagem','Pedido nao esta em analise.');
 END IF;

 -- Proibir fotos bancarias anteriores e reservas comuns abertas.
 v_check:=public.catalogo_asaas_preconferir_pagamento_excepcional(
  p_tipo,p_solicitacao
 );
 IF v_check->>'sem_impedimentos_identificados' IS DISTINCT FROM 'true'
  OR v_check->>'pagamento_autorizado' IS DISTINCT FROM 'false'
  OR (v_check->>'saldo_snapshot_centavos')::bigint IS DISTINCT FROM v_snapshot THEN
  RETURN jsonb_build_object('ok',false,
   'mensagem','Comissoes nao conferem com o snapshot ou existe bloqueio.');
 END IF;

 -- Trancar cada linha elegível em ordem estável; sem LIMIT/PAGINACAO.
 WITH elegiveis AS MATERIALIZED (
  SELECT r.id,r.valor_centavos
  FROM public.catalogo_remuneracoes_v2 r
  JOIN public.catalogo_pedidos p ON p.id=r.pedido_id
  JOIN public.catalogo_comissoes_offline c ON c.pedido_id=p.id
  JOIN public.catalogo_fechamentos_offline f
   ON f.comercio_id=c.comercio_id AND f.competencia=c.competencia
  JOIN public.catalogo_fatura_cobrancas b ON b.fechamento_id=f.id
  WHERE r.motoboy_id=v_uid AND r.status='disponivel'
   AND r.financiamento_comprovado AND r.repasse_id IS NULL
   AND r.valor_centavos>0 AND p.provedor='offline'
   AND p.entrega_status='entregue'
   AND NOT p.reembolso_pendente AND NOT p.pagamento_revisao_pendente
   AND c.status='paga' AND f.status='pago'
   AND b.gateway='asaas' AND b.status='pago' AND b.pago_em IS NOT NULL
   AND catalogo_private.catalogo_v2_financiado(r.pedido_id)
   AND NOT EXISTS(SELECT 1 FROM public.catalogo_asaas_saque_itens i
    WHERE i.remuneracao_id=r.id AND i.ativo)
   AND NOT EXISTS(SELECT 1 FROM public.catalogo_asaas_separacoes_excepcionais_itens e
    WHERE e.remuneracao_id=r.id)
  ORDER BY r.id FOR UPDATE OF r
 )
 SELECT pg_catalog.array_agg(id ORDER BY id),
        coalesce(sum(valor_centavos::bigint),0),
        count(*)::bigint,
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
         pg_catalog.string_agg(id::text||':'||valor_centavos::text,
          '|' ORDER BY id),'UTF8')),'hex')
 INTO v_ids,v_total,v_count,v_hash
 FROM elegiveis;

 IF v_count<=0 OR v_total<>v_snapshot
  OR v_count<>(v_check->>'creditos_individuais_validos')::bigint
  OR v_hash IS DISTINCT FROM v_check->>'fingerprint_creditos_sha256' THEN
  RETURN jsonb_build_object('ok',false,
   'mensagem','Composicao mudou durante a preparacao. Rever sem pagar.');
 END IF;

 INSERT INTO public.catalogo_asaas_separacoes_excepcionais(
  tipo,solicitacao_id,motoboy_id,valor_centavos,creditos,fingerprint_sha256
 ) VALUES(p_tipo,p_solicitacao,v_uid,v_total,v_count,v_hash)
 RETURNING id INTO v_separacao;

 INSERT INTO public.catalogo_asaas_separacoes_excepcionais_itens(
  separacao_id,remuneracao_id,valor_centavos
 )
 SELECT v_separacao,r.id,r.valor_centavos
 FROM public.catalogo_remuneracoes_v2 r
 WHERE r.id=ANY(v_ids);

 RETURN jsonb_build_object(
  'ok',true,'separacao_id',v_separacao,
  'creditos_separados',v_count,'valor_centavos',v_total,
  'fingerprint_sha256',v_hash,
  'pagamento_autorizado',false,'transferencia_criada',false,
  'baixa_realizada',false,'somente_contabil',true
 );
END $reserve$;
REVOKE ALL ON FUNCTION public.catalogo_asaas_separar_creditos_excepcionais(text,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
-- Permitir apenas para testes controlados do backend, NUNCA via usuário comum.
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_separar_creditos_excepcionais(text,uuid)
 TO service_role;

COMMENT ON TABLE public.catalogo_asaas_separacoes_excepcionais IS
 'Separacao contabil IMUTAVEL para revisao futura. Nao paga, nao libera, nao autoriza Pix.';
COMMIT;
