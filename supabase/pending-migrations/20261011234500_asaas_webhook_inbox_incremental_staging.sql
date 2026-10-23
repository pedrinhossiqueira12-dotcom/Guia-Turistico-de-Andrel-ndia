-- PATCH INCREMENTAL para STAGING Asaas ja iniciado com a migracao antiga.
-- Replica somente inbox/RPCs versionados da migration base, NAO reenfileira,
-- NAO cria pagamento, NAO envia Pix e NAO altera as tabelas de creditos.
-- Os eventos historicos (ja processados pela Edge legada) ficam 'concluido'.
-- Em producao esta migration NAO deve ser aplicada isoladamente: segue HOLD.
BEGIN;

DO $preflight$
BEGIN
 IF to_regclass('public.catalogo_asaas_webhook_eventos') IS NULL THEN
  RAISE EXCEPTION 'Baseline Asaas ausente. Nao criar inbox sem instalar/verificar esquema anterior.';
 END IF;
END
$preflight$;

-- Upgrade aditivo da inbox financeira; deployment exige revisao e permissao explicita.
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
