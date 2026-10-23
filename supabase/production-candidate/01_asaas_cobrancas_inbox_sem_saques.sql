-- CANDIDATO COB-06: SOMENTE TESTAR EM CLONE DESCARTAVEL da estrutura de producao.
-- NAO executar no Supabase PROD ou STAGING sem revisao/autoridade futura.
-- Extraido de 20261008180000_asaas_faturas_saques_controlados.sql.
-- Escopo: cobranca mensal Asaas + inbox de webhook (NAO saques/Money Out).
-- Nao inclui transferencias, carteiras, reservas de saque nem habilitacao de flags.
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

CREATE TABLE IF NOT EXISTS public.catalogo_asaas_webhook_eventos (
 id text PRIMARY KEY,
 evento text NOT NULL,
 recurso_id text,
 criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.catalogo_asaas_clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_asaas_emissoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_asaas_webhook_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_asaas_clientes,public.catalogo_asaas_emissoes,
 public.catalogo_asaas_webhook_eventos FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.catalogo_asaas_clientes,public.catalogo_asaas_emissoes,
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

REVOKE ALL ON FUNCTION public.catalogo_asaas_registrar_fatura(uuid,text,integer,text,text,text,timestamptz)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalogo_asaas_registrar_fatura(uuid,text,integer,text,text,text,timestamptz)
 TO service_role;

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
