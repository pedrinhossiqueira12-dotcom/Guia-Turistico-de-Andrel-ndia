-- Integração Asaas isolada. Não remove tabelas, faturas ou históricos existentes.
-- Sem credenciais/feature flags, não há cobrança ou transferência externa.
BEGIN;

ALTER TABLE public.catalogo_fatura_cobrancas
  DROP CONSTRAINT IF EXISTS catalogo_fatura_cobrancas_gateway_check;
ALTER TABLE public.catalogo_fatura_cobrancas
  ADD CONSTRAINT catalogo_fatura_cobrancas_gateway_check
  CHECK (gateway IN ('mercadopago','asaas'));

CREATE TABLE IF NOT EXISTS public.catalogo_asaas_clientes (
 comercio_id text PRIMARY KEY REFERENCES public.catalogos(comercio_id) ON DELETE RESTRICT,
 cliente_id text NOT NULL UNIQUE,
 criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.catalogo_asaas_emissoes (
 fechamento_id uuid PRIMARY KEY REFERENCES public.catalogo_fechamentos_offline(id) ON DELETE RESTRICT,
 operacao_id uuid NOT NULL DEFAULT gen_random_uuid(),
 estado text NOT NULL DEFAULT 'reservado' CHECK(estado IN ('reservado','registrado','revisao')),
 criado_em timestamptz NOT NULL DEFAULT now(),
 atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.catalogo_asaas_saques (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 motoboy_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 status text NOT NULL DEFAULT 'reservado'
   CHECK(status IN ('reservado','enviado','concluido','falhou','revisao')),
 valor_centavos integer NOT NULL CHECK(valor_centavos>0),
 transferencia_id text UNIQUE,
 comprovante text,
 mensagem text,
 criado_em timestamptz NOT NULL DEFAULT now(),
 atualizado_em timestamptz NOT NULL DEFAULT now(),
 concluido_em timestamptz
);
CREATE TABLE IF NOT EXISTS public.catalogo_asaas_saque_itens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 saque_id uuid NOT NULL REFERENCES public.catalogo_asaas_saques(id) ON DELETE RESTRICT,
 remuneracao_id uuid NOT NULL REFERENCES public.catalogo_remuneracoes_v2(id) ON DELETE RESTRICT,
 ativo boolean NOT NULL DEFAULT true,
 criado_em timestamptz NOT NULL DEFAULT now(),
 UNIQUE (saque_id, remuneracao_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS catalogo_asaas_saque_credito_ativo_uq
 ON public.catalogo_asaas_saque_itens(remuneracao_id) WHERE ativo;
CREATE INDEX IF NOT EXISTS catalogo_asaas_saques_motoboy_idx
 ON public.catalogo_asaas_saques(motoboy_id,criado_em DESC);
CREATE TABLE IF NOT EXISTS public.catalogo_asaas_webhook_eventos (
 id text PRIMARY KEY,
 evento text NOT NULL,
 recurso_id text,
 criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.catalogo_asaas_clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_asaas_emissoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_asaas_saques ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_asaas_saque_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_asaas_webhook_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_asaas_clientes,public.catalogo_asaas_emissoes,
 public.catalogo_asaas_saques,public.catalogo_asaas_saque_itens,
 public.catalogo_asaas_webhook_eventos FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.catalogo_asaas_clientes,public.catalogo_asaas_emissoes,
 public.catalogo_asaas_saques,public.catalogo_asaas_saque_itens,
 public.catalogo_asaas_webhook_eventos TO service_role;

-- A fatura de Asaas tem identificação própria; jamais substitua uma cobrança MP.
CREATE OR REPLACE FUNCTION public.catalogo_asaas_registrar_fatura(
 p_fechamento uuid,p_payment text,p_valor integer,p_qr text,p_imagem text,p_url text,p_expira timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.catalogo_fechamentos_offline%ROWTYPE;
        c public.catalogo_fatura_cobrancas%ROWTYPE;
BEGIN
 SELECT * INTO f FROM public.catalogo_fechamentos_offline WHERE id=p_fechamento FOR UPDATE;
 IF NOT FOUND OR f.status NOT IN ('faturado','vencido','bloqueado')
   OR p_valor IS NULL OR p_valor<=0 OR p_valor<>f.total_comissao_centavos
   OR coalesce(length(p_payment),0)<5 THEN
   RETURN jsonb_build_object('ok',false,'mensagem','Fechamento ou valor inválido.');
 END IF;
 SELECT * INTO c FROM public.catalogo_fatura_cobrancas WHERE fechamento_id=f.id FOR UPDATE;
 IF FOUND THEN
   IF c.gateway IS DISTINCT FROM 'asaas' OR c.order_id IS DISTINCT FROM p_payment
      OR c.valor_centavos IS DISTINCT FROM p_valor
      OR c.comercio_id IS DISTINCT FROM f.comercio_id
      OR c.competencia IS DISTINCT FROM f.competencia THEN
     RETURN jsonb_build_object('ok',false,'mensagem','Já existe outra cobrança ou dados divergentes vinculados à fatura.');
   END IF;
   -- Uma segunda tentativa de registro jamais reabre uma fatura liquidada,
   -- contestada ou cancelada nem substitui o comprovante bancário anterior.
   IF c.status NOT IN ('pendente','vencido') THEN
     RETURN jsonb_build_object('ok',false,'mensagem','Cobrança já liquidada ou bloqueada. Não modificar o Pix.');
   END IF;
   UPDATE public.catalogo_fatura_cobrancas
     SET qr_code=p_qr,qr_code_base64=p_imagem,ticket_url=p_url,expira_em=p_expira
     WHERE id=c.id;
 ELSE
   INSERT INTO public.catalogo_fatura_cobrancas
    (fechamento_id,comercio_id,competencia,gateway,order_id,status,valor_centavos,
     qr_code,qr_code_base64,ticket_url,expira_em,tentativas,ultima_consulta_em)
   VALUES(f.id,f.comercio_id,f.competencia,'asaas',p_payment,'pendente',p_valor,
     p_qr,p_imagem,p_url,p_expira,1,pg_catalog.now()) RETURNING * INTO c;
   PERFORM public.catalogo_registrar_evento_fatura(c.id,p_payment,'cobranca_criada',
     NULL,'pendente',p_valor,'asaas');
 END IF;
 UPDATE public.catalogo_asaas_emissoes SET estado='registrado',atualizado_em=pg_catalog.now()
 WHERE fechamento_id=f.id;
 RETURN jsonb_build_object('ok',true,'cobranca_id',c.id,'order_id',p_payment);
END; $$;

-- A seleção e reserva de créditos são atômicas: dois cliques nunca selecionam
-- o mesmo crédito. Somente cobranças liquidadas NO ASAAS financiam esta carteira.
CREATE OR REPLACE FUNCTION public.catalogo_asaas_reservar_saque(p_motoboy uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_ids uuid[];v_total integer;v_saque uuid;v_pix text;
BEGIN
 IF p_motoboy IS NULL OR NOT catalogo_private.catalogo_v2_autorizado(p_motoboy) THEN
   RETURN jsonb_build_object('ok',false,'mensagem','Motoboy não autorizado.');
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('asaas-saque:'||p_motoboy::text,0));
 SELECT chave_pix_enc INTO v_pix FROM public.catalogo_motoboy_perfis
 WHERE usuario_id=p_motoboy AND NOT em_analise FOR UPDATE;
 IF v_pix IS NULL THEN RETURN jsonb_build_object('ok',false,'mensagem','Cadastre sua chave Pix e aguarde a liberação do perfil.'); END IF;

 -- Locks em ordem estável; mesmo crédito não pode ficar em dois saques ativos.
 SELECT array_agg(id ORDER BY id),coalesce(sum(valor_centavos),0)::integer
 INTO v_ids,v_total
 FROM (
   SELECT r.id,r.valor_centavos
   FROM public.catalogo_remuneracoes_v2 r
   JOIN public.catalogo_pedidos p ON p.id=r.pedido_id
   JOIN public.catalogo_comissoes_offline c ON c.pedido_id=p.id
   JOIN public.catalogo_fechamentos_offline f ON f.comercio_id=c.comercio_id
     AND f.competencia=c.competencia
   JOIN public.catalogo_fatura_cobrancas b ON b.fechamento_id=f.id
   WHERE r.motoboy_id=p_motoboy AND r.status='disponivel'
     AND r.financiamento_comprovado AND r.repasse_id IS NULL
     AND p.provedor='offline' AND p.entrega_status='entregue'
     AND NOT p.reembolso_pendente AND NOT p.pagamento_revisao_pendente
     AND c.status='paga' AND f.status='pago'
     AND b.gateway='asaas' AND b.status='pago' AND b.pago_em IS NOT NULL
     AND NOT EXISTS(SELECT 1 FROM public.catalogo_asaas_saque_itens i
       WHERE i.remuneracao_id=r.id AND i.ativo)
   ORDER BY r.id LIMIT 100 FOR UPDATE OF r
 ) elegiveis;
 IF v_total IS NULL OR v_total<=0 THEN
   RETURN jsonb_build_object('ok',false,'mensagem','Nenhum crédito liquidado no Asaas disponível para saque.');
 END IF;
 INSERT INTO public.catalogo_asaas_saques(motoboy_id,valor_centavos)
 VALUES(p_motoboy,v_total) RETURNING id INTO v_saque;
 INSERT INTO public.catalogo_asaas_saque_itens(saque_id,remuneracao_id)
 SELECT v_saque,unnest(v_ids);
 RETURN jsonb_build_object('ok',true,'saque_id',v_saque,'valor_centavos',v_total);
END; $$;

-- Alteração de saque só após GET autenticado da transferência na API do Asaas.
-- Estados desconhecidos ficam bloqueados em revisão: NÃO liberar para novo envio.
CREATE OR REPLACE FUNCTION public.catalogo_asaas_atualizar_saque(
 p_saque uuid,p_estado text,p_transferencia text DEFAULT NULL,p_mensagem text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.catalogo_asaas_saques%ROWTYPE;
 v_credito record;v_qtd integer:=0;v_total integer:=0;v_repasse uuid;v_atualizados integer:=0;
BEGIN
 SELECT * INTO v FROM public.catalogo_asaas_saques WHERE id=p_saque FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'mensagem','Saque não encontrado.'); END IF;
 IF v.status IN ('concluido','falhou') THEN
   RETURN jsonb_build_object('ok',v.status=p_estado,'status',v.status,'idempotente',true);
 END IF;
 IF p_estado NOT IN ('enviado','concluido','falhou','revisao') THEN
   RETURN jsonb_build_object('ok',false,'mensagem','Estado não permitido.');
 END IF;
 IF v.transferencia_id IS NOT NULL AND (p_transferencia IS NULL OR p_transferencia<>v.transferencia_id) THEN
   RETURN jsonb_build_object('ok',false,'mensagem','ID de transferência divergente.');
 END IF;
 IF p_estado='enviado' THEN
   IF v.status<>'reservado' OR coalesce(length(p_transferencia),0)<4 THEN
     RETURN jsonb_build_object('ok',false,'mensagem','Transferência inválida.');
   END IF;
   UPDATE public.catalogo_asaas_saques SET status='enviado',transferencia_id=p_transferencia,
    atualizado_em=now() WHERE id=v.id;
   RETURN jsonb_build_object('ok',true,'status','enviado');
 END IF;
 IF p_estado='falhou' THEN
   -- Falha só pode ser marcada quando a API efetivamente informa FAILED/CANCELLED.
   UPDATE public.catalogo_asaas_saque_itens SET ativo=false WHERE saque_id=v.id;
   UPDATE public.catalogo_asaas_saques SET status='falhou',transferencia_id=coalesce(v.transferencia_id,p_transferencia),
    mensagem=left(p_mensagem,500),atualizado_em=now() WHERE id=v.id;
   RETURN jsonb_build_object('ok',true,'status','falhou');
 END IF;
 IF p_estado='revisao' THEN
   UPDATE public.catalogo_asaas_saques SET status='revisao',
    transferencia_id=coalesce(v.transferencia_id,p_transferencia),mensagem=left(p_mensagem,500),
    atualizado_em=now() WHERE id=v.id;
   RETURN jsonb_build_object('ok',true,'status','revisao');
 END IF;
 IF v.status NOT IN ('enviado','revisao') OR coalesce(v.transferencia_id,p_transferencia) IS NULL THEN
   RETURN jsonb_build_object('ok',false,'mensagem','Transferência ainda não identificada.');
 END IF;
 -- Alinha com a operação administrativa existente: pagamento só após confirmação.
 PERFORM 1 FROM public.catalogo_pedidos p
 WHERE p.id IN (SELECT r.pedido_id FROM public.catalogo_remuneracoes_v2 r
 JOIN public.catalogo_asaas_saque_itens i ON i.remuneracao_id=r.id WHERE i.saque_id=v.id AND i.ativo)
 ORDER BY p.id FOR UPDATE;
 FOR v_credito IN SELECT r.* FROM public.catalogo_remuneracoes_v2 r
   JOIN public.catalogo_asaas_saque_itens i ON i.remuneracao_id=r.id
   WHERE i.saque_id=v.id AND i.ativo ORDER BY r.pedido_id FOR UPDATE OF r
 LOOP
   IF v_credito.motoboy_id<>v.motoboy_id OR v_credito.status<>'disponivel'
     OR v_credito.repasse_id IS NOT NULL OR NOT v_credito.financiamento_comprovado
     OR NOT catalogo_private.catalogo_v2_financiado(v_credito.pedido_id) THEN
     UPDATE public.catalogo_asaas_saques SET status='revisao',atualizado_em=now(),
       mensagem='Crédito alterado após transferência bancária. Revisar manualmente.'
       WHERE id=v.id;
     RETURN jsonb_build_object('ok',false,'status','revisao','mensagem','Transferência executada: há divergência no saldo.');
   END IF;
   v_qtd:=v_qtd+1;v_total:=v_total+v_credito.valor_centavos;
 END LOOP;
 IF v_qtd=0 OR v_total<>v.valor_centavos THEN
   UPDATE public.catalogo_asaas_saques SET status='revisao',atualizado_em=now(),
     mensagem='Composição do saque alterada. Revisar manualmente.' WHERE id=v.id;
   RETURN jsonb_build_object('ok',false,'status','revisao');
 END IF;
 INSERT INTO public.catalogo_repasses_v2(motoboy_id,valor_centavos,referencia,comprovante,metadata)
 VALUES(v.motoboy_id,v_total,'asaas:'||coalesce(v.transferencia_id,p_transferencia),
   'Pix confirmado pela API Asaas',jsonb_build_object('saque_asaas_id',v.id))
 RETURNING id INTO v_repasse;
 UPDATE public.catalogo_remuneracoes_v2 SET status='pago',repasse_id=v_repasse,pago_em=now()
 WHERE id IN (SELECT remuneracao_id FROM public.catalogo_asaas_saque_itens WHERE saque_id=v.id AND ativo);
 GET DIAGNOSTICS v_atualizados=ROW_COUNT;
 IF v_atualizados<>v_qtd THEN RAISE EXCEPTION 'Divergência entre créditos e transferência; operação abortada'; END IF;
 UPDATE public.catalogo_lancamentos_financeiros_v2 SET status='pago',
  referencia='asaas:'||coalesce(v.transferencia_id,p_transferencia),atualizado_em=now()
 WHERE remuneracao_id IN
   (SELECT remuneracao_id FROM public.catalogo_asaas_saque_itens WHERE saque_id=v.id AND ativo);
 UPDATE public.catalogo_asaas_saques SET status='concluido',
  transferencia_id=coalesce(v.transferencia_id,p_transferencia),comprovante='Pix confirmado pela API Asaas',
  atualizado_em=now(),concluido_em=now() WHERE id=v.id;
 RETURN jsonb_build_object('ok',true,'status','concluido','repasse_id',v_repasse);
END; $$;

REVOKE ALL ON FUNCTION public.catalogo_asaas_registrar_fatura(uuid,text,integer,text,text,text,timestamptz),
 public.catalogo_asaas_reservar_saque(uuid),
 public.catalogo_asaas_atualizar_saque(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_registrar_fatura(uuid,text,integer,text,text,text,timestamptz),
 public.catalogo_asaas_reservar_saque(uuid),
 public.catalogo_asaas_atualizar_saque(uuid,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.catalogo_asaas_saldo_sacavel(p_motoboy uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
  'disponivel_centavos',coalesce(sum(r.valor_centavos),0)::integer,
  'creditos',count(*)::integer
 ) FROM public.catalogo_remuneracoes_v2 r
 JOIN public.catalogo_pedidos p ON p.id=r.pedido_id
 JOIN public.catalogo_comissoes_offline c ON c.pedido_id=p.id
 JOIN public.catalogo_fechamentos_offline f ON f.comercio_id=c.comercio_id AND f.competencia=c.competencia
 JOIN public.catalogo_fatura_cobrancas b ON b.fechamento_id=f.id
 WHERE r.motoboy_id=p_motoboy AND catalogo_private.catalogo_v2_autorizado(p_motoboy)
  AND r.status='disponivel' AND r.financiamento_comprovado AND r.repasse_id IS NULL
  AND p.provedor='offline' AND p.entrega_status='entregue'
  AND NOT p.reembolso_pendente AND NOT p.pagamento_revisao_pendente
  AND c.status='paga' AND f.status='pago'
  AND b.gateway='asaas' AND b.status='pago' AND b.pago_em IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM public.catalogo_asaas_saque_itens i WHERE i.remuneracao_id=r.id AND i.ativo);
$$;
REVOKE ALL ON FUNCTION public.catalogo_asaas_saldo_sacavel(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_saldo_sacavel(uuid) TO service_role;


-- Proteção retrocompatível: o operador do sistema antigo não pode registrar
-- um repasse manual sobre uma remuneração já comprometida pelo saque Asaas.
-- A finalização Asaas é autorizada somente se o registro de repasse possuir
-- o mesmo ID do saque em metadados. Sem reserva, o legado continua funcionando.
CREATE OR REPLACE FUNCTION catalogo_private.catalogo_asaas_proteger_credito_reservado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $asaas_guard$
DECLARE v_reserva uuid;v_repasse_saque text;
BEGIN
 IF (NEW.status='pago' OR NEW.repasse_id IS DISTINCT FROM OLD.repasse_id)
    AND EXISTS(
      SELECT 1 FROM public.catalogo_asaas_saque_itens i
      WHERE i.remuneracao_id=NEW.id AND i.ativo
    ) THEN
    SELECT i.saque_id INTO v_reserva FROM public.catalogo_asaas_saque_itens i
       WHERE i.remuneracao_id=NEW.id AND i.ativo;
    SELECT rep.metadata->>'saque_asaas_id' INTO v_repasse_saque
    FROM public.catalogo_repasses_v2 rep WHERE rep.id=NEW.repasse_id;
    IF NEW.status<>'pago' OR NEW.repasse_id IS NULL OR
       v_repasse_saque IS DISTINCT FROM v_reserva::text THEN
       RAISE EXCEPTION 'Crédito reservado para saque Asaas; repasse manual proibido'
         USING ERRCODE='23514';
    END IF;
 END IF;
 RETURN NEW;
END;
$asaas_guard$;
DROP TRIGGER IF EXISTS catalogo_asaas_reserva_guard ON public.catalogo_remuneracoes_v2;
CREATE TRIGGER catalogo_asaas_reserva_guard
 BEFORE UPDATE OF status,repasse_id ON public.catalogo_remuneracoes_v2
 FOR EACH ROW EXECUTE FUNCTION catalogo_private.catalogo_asaas_proteger_credito_reservado();
REVOKE ALL ON FUNCTION catalogo_private.catalogo_asaas_proteger_credito_reservado()
 FROM PUBLIC,anon,authenticated,service_role;


-- Webhook inbox de producao (AINDA NAO APLICAR REMOTAMENTE).
-- O Asaas exige ACK 200 apos gravar a notificacao; o processamento ocorre
-- depois, com reconciliacao por GET e reentrega/reprocessamento idempotente.
-- As linhas antigas eram inseridas APOS processamento: manter como concluidas.
ALTER TABLE public.catalogo_asaas_webhook_eventos
 ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'concluido',
 ADD COLUMN IF NOT EXISTS tentativas integer NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS iniciado_em timestamptz,
 ADD COLUMN IF NOT EXISTS concluido_em timestamptz,
 ADD COLUMN IF NOT EXISTS proxima_tentativa_em timestamptz,
 ADD COLUMN IF NOT EXISTS tentativa_token uuid,
 ADD COLUMN IF NOT EXISTS referencia_externa text;
DO $webhook_check$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_constraint
  WHERE conrelid='public.catalogo_asaas_webhook_eventos'::regclass
  AND conname='catalogo_asaas_webhook_estado_check'
 ) THEN
  ALTER TABLE public.catalogo_asaas_webhook_eventos ADD CONSTRAINT
   catalogo_asaas_webhook_estado_check
   CHECK (estado IN ('pendente','processando','erro','concluido'));
 END IF;
END
$webhook_check$;
CREATE INDEX IF NOT EXISTS catalogo_asaas_webhook_pendentes_idx
 ON public.catalogo_asaas_webhook_eventos (criado_em,id)
 WHERE estado IN ('pendente','erro','processando');

CREATE OR REPLACE FUNCTION public.catalogo_asaas_webhook_receber(
 p_id text,p_evento text,p_recurso text,p_referencia text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $receive$
DECLARE v_row public.catalogo_asaas_webhook_eventos%ROWTYPE;
        v_created boolean:=false;
BEGIN
 IF p_id IS NULL OR pg_catalog.length(p_id)<3 OR pg_catalog.length(p_id)>180
 OR p_evento IS NULL OR pg_catalog.length(p_evento)>80
 OR NOT (p_evento LIKE 'PAYMENT_%' OR p_evento LIKE 'TRANSFER_%')
 OR p_recurso IS NULL OR pg_catalog.length(p_recurso)<3
 OR pg_catalog.length(p_recurso)>150
 OR (p_referencia IS NOT NULL AND pg_catalog.length(p_referencia)>180)
 THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','evento_invalido');
 END IF;
 INSERT INTO public.catalogo_asaas_webhook_eventos(
  id,evento,recurso_id,estado,tentativas,referencia_externa
 ) VALUES (p_id,p_evento,p_recurso,'pendente',0,p_referencia)
 ON CONFLICT (id) DO NOTHING
 RETURNING * INTO v_row;
 v_created:=FOUND;
 IF NOT v_created THEN
  SELECT * INTO v_row FROM public.catalogo_asaas_webhook_eventos WHERE id=p_id;
 END IF;
 IF v_row.id IS NULL OR v_row.evento IS DISTINCT FROM p_evento OR
    v_row.recurso_id IS DISTINCT FROM p_recurso OR
    (v_row.referencia_externa IS NOT NULL AND p_referencia IS NOT NULL
     AND v_row.referencia_externa IS DISTINCT FROM p_referencia) THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','evento_id_divergente');
 END IF;
 RETURN pg_catalog.jsonb_build_object('ok',true,
  'novo',v_created,'estado',v_row.estado,
  'duplicado',NOT v_created);
END
$receive$;

-- Pega as tarefas em uma transacao curta. SKIP LOCKED evita que duas
-- instancias Edge reservem o mesmo evento. Token impede fechamento tardio.
CREATE OR REPLACE FUNCTION public.catalogo_asaas_webhook_claim(
 p_limite integer DEFAULT 5
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $claim$
DECLARE v_result jsonb;
BEGIN
 IF p_limite IS NULL OR p_limite<1 OR p_limite>20 THEN
  RAISE EXCEPTION 'Limite invalido' USING ERRCODE='22023';
 END IF;
 WITH bloqueadas AS (
   SELECT id FROM public.catalogo_asaas_webhook_eventos
   WHERE estado='pendente'
      OR (estado='erro' AND (proxima_tentativa_em IS NULL
        OR proxima_tentativa_em<=pg_catalog.clock_timestamp()))
      OR (estado='processando' AND iniciado_em<
        pg_catalog.clock_timestamp()-interval '5 minutes')
   ORDER BY criado_em,id
   FOR UPDATE SKIP LOCKED
   LIMIT p_limite
 ), tomadas AS (
   UPDATE public.catalogo_asaas_webhook_eventos w
   SET estado='processando',tentativa_token=pg_catalog.gen_random_uuid(),
       tentativas=w.tentativas+1,
       iniciado_em=pg_catalog.clock_timestamp(),proxima_tentativa_em=NULL
   WHERE w.id IN (SELECT id FROM bloqueadas)
   RETURNING w.id,w.evento,w.recurso_id,w.referencia_externa,w.tentativa_token
 )
 SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'id',id,'evento',evento,'recurso_id',recurso_id,
   'referencia_externa',referencia_externa,'tentativa_token',tentativa_token
 )), '[]'::jsonb)
 INTO v_result FROM tomadas;
 RETURN v_result;
END
$claim$;

CREATE OR REPLACE FUNCTION public.catalogo_asaas_webhook_finalizar(
 p_id text,p_token uuid,p_sucesso boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $finish$
DECLARE v_count integer;
BEGIN
 IF p_id IS NULL OR p_token IS NULL OR p_sucesso IS NULL THEN
  RETURN pg_catalog.jsonb_build_object('ok',false,'motivo','argumentos_invalidos');
 END IF;
 UPDATE public.catalogo_asaas_webhook_eventos w
 SET estado=CASE WHEN p_sucesso THEN 'concluido' ELSE 'erro' END,
     concluido_em=CASE WHEN p_sucesso THEN pg_catalog.clock_timestamp()
                        ELSE NULL END,
     proxima_tentativa_em=CASE WHEN p_sucesso THEN NULL ELSE
        pg_catalog.clock_timestamp()+
        (LEAST(900,30*pg_catalog.power(
           2,LEAST(GREATEST(w.tentativas-1,0),5)
         ))*interval '1 second') END,
     tentativa_token=NULL
 WHERE w.id=p_id AND w.estado='processando' AND w.tentativa_token=p_token;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 RETURN pg_catalog.jsonb_build_object('ok',v_count=1,
   'status',CASE WHEN p_sucesso THEN 'concluido' ELSE 'erro' END);
END
$finish$;
REVOKE ALL ON FUNCTION public.catalogo_asaas_webhook_receber(text,text,text,text)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.catalogo_asaas_webhook_claim(integer)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.catalogo_asaas_webhook_finalizar(text,uuid,boolean)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_webhook_receber(text,text,text,text)
 TO service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_webhook_claim(integer)
 TO service_role;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_webhook_finalizar(text,uuid,boolean)
 TO service_role;


COMMIT;
