-- Somente banco de testes descartavel, sem HTTP, PIX ou Secrets. Tudo ROLLBACK.
BEGIN;
SET LOCAL app.marketplace_test_withdrawal = 'enabled';
DO $withdrawal_fixtures$
DECLARE
 v_actor uuid := '00000000-0000-4000-8000-000000000341';
 v_order uuid := '00000000-0000-4000-8000-000000000351';
 v_second uuid := '00000000-0000-4000-8000-000000000352';
 v_rem uuid;
 v_rem2 uuid;
 v_first jsonb;
 v_second_request jsonb;
 v_s uuid;
 v_res jsonb;
 v_balance jsonb;
 v_n integer;
 v_pending text;
 v_cutoff timestamptz := date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
BEGIN
 IF current_database()<>'catalogo_ci' OR
    current_setting('app.marketplace_test_withdrawal',true)<>'enabled'
    OR (SELECT count(*) FROM public.catalogo_pedidos)<>0
    OR EXISTS(SELECT 1 FROM pg_extension WHERE extname IN ('pg_cron','pg_net'))
 THEN RAISE EXCEPTION 'Withdrawals test requires empty disposable catalogo_ci without cron/net'; END IF;

 INSERT INTO auth.users(id,email_confirmed_at) VALUES(v_actor,now());
 INSERT INTO public.catalogo_motoboys(comercio_id,usuario_id,nome,email,autorizado_por)
 VALUES ('comercio-de-exemplo',v_actor,'Motoboy Saque CI','saque-ci@example.invalid',
         '00000000-0000-4000-8000-000000000099');
 INSERT INTO public.catalogo_motoboy_perfis(usuario_id,apto,disponivel,chave_pix_enc)
 VALUES(v_actor,true,true,'pix-v2:AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB');
 UPDATE public.catalogo_fluxo_config SET ativo=true,comercios_piloto=NULL WHERE id=true;

 INSERT INTO public.catalogo_pedidos(
 id,comercio_id,referencia_externa,idempotency_key,modalidade,forma_pagamento,
 subtotal_produtos_centavos,entrega_centavos,total_centavos,taxa_plataforma_centavos,
 taxa_motoboy_centavos,taxa_total_centavos,repasse_bruto_comercio_centavos,
 versao_financeira,cliente_nome,cliente_telefone,status_token_hash,
 codigo_entrega_hash,codigo_entrega_expira_em,status,status_pagamento)
 SELECT x.id,'comercio-de-exemplo',x.external_ref,x.key,'entrega','pix',
 10000,0,10000,500,200,700,9300,2,'Comprador sintético','00000000000',
 repeat(md5(x.id::text),2),repeat(md5(x.id::text||':code'),2),now()+interval '1 hour','pago','aprovado'
 FROM (VALUES
   (v_order,'ci-saque-mes-fechado','00000000-0000-4000-8000-000000000361'::uuid),
   (v_second,'ci-saque-mes-atual','00000000-0000-4000-8000-000000000362'::uuid)
 ) x(id,external_ref,key);

 INSERT INTO public.catalogo_pagamentos_v2(pedido_id,status,valor_centavos,taxa_centavos,referencia)
 VALUES (v_order,'aprovado',10000,700,'CI-PIX-CREDITO-MES-ANTERIOR'),
        (v_second,'aprovado',10000,700,'CI-PIX-CREDITO-MES-ATUAL');

 INSERT INTO public.catalogo_remuneracoes_v2(pedido_id,comercio_id,motoboy_id,
     valor_centavos,status,financiamento_comprovado,disponibilizado_em)
 VALUES (v_order,'comercio-de-exemplo',v_actor,200,'disponivel',true,v_cutoff-interval '1 day')
 RETURNING id INTO v_rem;
 INSERT INTO public.catalogo_remuneracoes_v2(pedido_id,comercio_id,motoboy_id,
     valor_centavos,status,financiamento_comprovado,disponibilizado_em)
 VALUES (v_second,'comercio-de-exemplo',v_actor,200,'disponivel',true,now())
 RETURNING id INTO v_rem2;

 v_balance:=public.catalogo_motoboy_listar_saques_v2(v_actor);
 IF (v_balance->>'ok')::boolean IS DISTINCT FROM true OR
    (v_balance->>'disponivel_para_saque_centavos')::int<>200 THEN
   RAISE EXCEPTION 'Expected only closed-month R$2 eligible credit: %',v_balance;
 END IF;

 v_first:=public.catalogo_motoboy_solicitar_saque_v2(v_actor);
 IF (v_first->>'ok')::boolean IS DISTINCT FROM true OR
    (v_first->>'valor_centavos')::int<>200 OR
    (v_first->>'transferencia_executada')::boolean IS DISTINCT FROM false THEN
   RAISE EXCEPTION 'First withdraw should RESERVE, not transfer: %',v_first;
 END IF;
 v_s:=(v_first->>'saque_id')::uuid;
 IF (SELECT count(*) FROM public.catalogo_saque_creditos_v2 WHERE saque_id=v_s AND ativo)<>1
   OR NOT EXISTS(SELECT 1 FROM public.catalogo_saque_creditos_v2 WHERE saque_id=v_s AND remuneracao_id=v_rem)
   OR EXISTS(SELECT 1 FROM public.catalogo_saque_creditos_v2 WHERE saque_id=v_s AND remuneracao_id=v_rem2)
 THEN RAISE EXCEPTION 'Closed-month credit was not reserved exactly once'; END IF;
 v_second_request:=public.catalogo_motoboy_solicitar_saque_v2(v_actor);
 IF (v_second_request->>'http_status')::integer<>409 THEN
   RAISE EXCEPTION 'Double withdrawal request was not blocked: %',v_second_request;
 END IF;

 -- Tentativa de pagar manualmente o mesmo credito deve abortar sem afetar a reserva.
 BEGIN
   UPDATE public.catalogo_remuneracoes_v2 SET status='pago' WHERE id=v_rem;
   RAISE EXCEPTION 'DOUBLE PAY: reserved remuneration unexpectedly marked paid';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM NOT LIKE 'Crédito reservado a saque%' THEN RAISE; END IF;
 END;
 IF (SELECT status FROM public.catalogo_remuneracoes_v2 WHERE id=v_rem)<>'disponivel' THEN
   RAISE EXCEPTION 'Unauthorized repasse mutated reserved remuneration';
 END IF;

 v_res:=public.catalogo_saque_worker_v2('preparar',v_s);
 IF (v_res->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Prepare payout failed: %',v_res; END IF;
 v_res:=public.catalogo_saque_worker_v2('registrar',v_s,'POPCI123456','TOPCI123456','created');
 IF (v_res->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Register payout failed: %',v_res; END IF;
 v_res:=public.catalogo_saque_worker_v2('confirmar',v_s,'POPCI123456','TOPCI123456','created');
 IF (v_res->>'http_status')::integer<>409 THEN RAISE EXCEPTION 'HTTP 202/created wrongly accepted as paid: %',v_res; END IF;
 IF (SELECT status FROM public.catalogo_remuneracoes_v2 WHERE id=v_rem)='pago' THEN
   RAISE EXCEPTION 'Payout not credited but remuneration marked paid';
 END IF;
 v_res:=public.catalogo_saque_worker_v2('confirmar',v_s,'POPCI123456','TOPCI123456','success/accredited');
 IF (v_res->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Simulated bank confirmation failed: %',v_res; END IF;
 IF (SELECT status FROM public.catalogo_remuneracoes_v2 WHERE id=v_rem)<>'pago' OR
    (SELECT count(*) FROM public.catalogo_repasses_v2 WHERE metadata->>'saque_id'=v_s::text)<>1 THEN
   RAISE EXCEPTION 'Confirmed payout did not settle credit exactly once';
 END IF;
 v_res:=public.catalogo_saque_worker_v2('confirmar',v_s,'POPCI123456','TOPCI123456','success/accredited');
 IF (v_res->>'idempotente')::boolean IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'Repeat confirmed request must be idempotent: %',v_res;
 END IF;
 IF (SELECT count(*) FROM public.catalogo_repasses_v2 WHERE metadata->>'saque_id'=v_s::text)<>1 THEN
   RAISE EXCEPTION 'Duplicate payout record was created';
 END IF;
 v_balance:=public.catalogo_motoboy_listar_saques_v2(v_actor);
 IF (v_balance->>'disponivel_para_saque_centavos')::int<>0 OR
    (SELECT count(*) FROM public.catalogo_saque_creditos_v2 WHERE saque_id=v_s)<>1 THEN
   RAISE EXCEPTION 'Pending current month must stay excluded after the payout';
 END IF;
 RAISE NOTICE 'PASS: monthly eligibility, auth ledger, reservation, double payment, 202 non-credit, success/accredited, idempotent payout';
END;
$withdrawal_fixtures$;
ROLLBACK;
