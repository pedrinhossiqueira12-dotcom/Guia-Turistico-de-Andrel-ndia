-- COB-05 - somente leitura no SQL Editor do Supabase STAGING jbttwihctuibchhcyqtl
-- Evento autentico Asaas Sandbox pay_z7ei9tof446wxbjo.
-- NAO atualiza, NAO reprocessa manualmente e NAO revela chaves/segredos.
-- Passa somente se o MESMO evento tiver concluido, com tentativas >= 2,
-- e uma execucao HTTP do Cron indicar processados >= 1 no intervalo.

SELECT
  id AS evento_id, evento, recurso_id, estado, tentativas,
  criado_em, iniciado_em, proxima_tentativa_em, concluido_em,
  (estado = 'concluido' AND tentativas >= 2 AND concluido_em IS NOT NULL)
    AS recuperacao_da_fila_confirmada
FROM public.catalogo_asaas_webhook_eventos
WHERE recurso_id = 'pay_z7ei9tof446wxbjo'
ORDER BY criado_em DESC;

-- O pg_cron 'succeeded' prova agendamento, nao consumo: conferir HTTP abaixo.
SELECT
  runid, status, start_time, end_time
FROM cron.job_run_details
WHERE jobid = 5 AND start_time >= '2026-10-12 18:00:00+00'
ORDER BY start_time DESC LIMIT 12;

-- Exibir somente respostas do worker; nao consultar headers, body de terceiros ou Vault.
SELECT
  created AS resposta_em, status_code,
  left(content, 250) AS resposta_do_worker
FROM net._http_response
WHERE created >= '2026-10-12 18:00:00+00'
  AND status_code = 200
  AND content LIKE '%"processados"%'
ORDER BY created DESC LIMIT 15;

-- O ensaio de R$5 nunca pode aparecer como uma fatura local real.
SELECT
  (SELECT count(*) FROM public.catalogo_fatura_cobrancas
   WHERE order_id='pay_z7ei9tof446wxbjo') AS cobranças_de_ensaio_lancadas,
  (SELECT status FROM public.catalogo_fechamentos_offline
   WHERE id='53a2159f-1e6a-449d-b2cf-ea62e7a3e877') AS fatura_antiga,
  (SELECT status FROM public.catalogo_fatura_cobrancas
   WHERE fechamento_id='53a2159f-1e6a-449d-b2cf-ea62e7a3e877') AS cobranca_antiga,
  (SELECT status FROM public.catalogo_remuneracoes_v2
   WHERE pedido_id='5fba336a-64d2-421b-9afa-83f878a00d54') AS credito_motoboy,
  (SELECT repasse_id FROM public.catalogo_remuneracoes_v2
   WHERE pedido_id='5fba336a-64d2-421b-9afa-83f878a00d54') AS repasse_motoboy;
