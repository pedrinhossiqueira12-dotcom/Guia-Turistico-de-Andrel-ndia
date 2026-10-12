# Asaas — agendamento e recuperação da fila de webhooks

**11 de outubro de 2026 · Guia Andrelândia · PR #39 em Draft · NÃO EXECUTAR EM PRODUÇÃO AINDA**

## Implementado no código

A Edge `catalogo-asaas-financeiro` agora disponibiliza exclusivamente para chamadas de servidor:

`POST /functions/v1/catalogo-asaas-financeiro/cron-webhooks`

Proteções:
- Exige um segredo **independente** de no mínimo 48 caracteres em `ASAAS_WEBHOOK_WORKER_TOKEN`, enviado pelo header `x-guia-asaas-worker-token`. Não reutilizar token de webhook Asaas, service_role ou chave Pix.
- Exige **`ASAAS_WEBHOOK_WORKER_ENABLED=true`** e também `ASAAS_BILLING_ENABLED=true` / `ASAAS_API_KEY`. Em ambiente Asaas **production**, exige adicionalmente `ASAAS_PRODUCTION_BILLING_APPROVED=true`.
- Com token ausente/incorreto ou flags desligadas não consulta a fila nem o provedor.
- Processa até 10 eventos por invocação. Usa as RPCs atômicas da fila existente: `SKIP LOCKED`, lease, backoff e token por tentativa impedem duplicar a execução. Essa rota **não emite cobrança, não inicia transferência Pix, não desbloqueia saques nem ignora estados de estorno**.
- `verify_jwt=false` da Edge não é autorização: essa rota tem checagem própria do segredo, e **nunca deve ser invocada por navegador ou código público**.

**Atualização 12/10/2026:** o agendamento **já foi criado e ativado exclusivamente no STAGING `jbttwihctuibchhcyqtl`**, após autorização do proprietário, sob `cron.jobid=5`, nome `guia-asaas-reconciliar-webhook`, frequência `*/2 * * * *`. `pg_net` foi instalado, os dois valores de Vault foram preparados, e autenticação real do endpoint respondeu **401** para token inválido e **200** para token válido. A fila estava vazia no ensaio HTTP (0 processados). A primeira execução automática foi observada às **16:32 UTC de 12/10/2026**: `cron.jobid=5`, `runid=7` `succeeded`, requisição `net._http_response.id=4` com **HTTP 200**, `success=true`, `processados=0` (fila vazia). Não confundir sucesso de agendamento com prova de recuperação de evento com falha; esta última continua pendente. A execução periódica e o consumo/retry de novo evento legítimo permanecem a confirmar. **Em produção nenhum job desta rotina foi instalado**, e as instruções abaixo seguem sendo referência manual para outro ambiente e não devem ser reexecutadas no STAGING que já tem o job. Nenhum token constou deste documento. Use somente após revisar migrações, fazer homologação ponta a ponta em STAGING, conferir o escopo e obter autorização expressa para alterar o projeto escolhido.

## Preparação após a autorização

1. Verifique que a Edge correta e a migração contendo `catalogo_asaas_webhook_receber`, `catalogo_asaas_webhook_claim` e `catalogo_asaas_webhook_finalizar` foram implantadas *na mesma instância*, com backup e rollback definidos. Não aplique este PR gigantesco integralmente sem revisão.
2. No Supabase Secret da Edge **do ambiente apropriado**, defina `ASAAS_WEBHOOK_WORKER_TOKEN` com 48+ caracteres aleatórios. Deixe `ASAAS_WEBHOOK_WORKER_ENABLED=false` até concluir o teste manual. Nunca coloque valor de token em SQL de migração, código, logs ou GitHub.
3. Confira extensões `pg_cron`, `pg_net` e Supabase Vault disponíveis no banco correto; crie no Vault **do mesmo projeto** segredos com nomes `guia_asaas_webhook_worker_url_v1` (URL HTTPS exata desse endpoint) e `guia_asaas_webhook_worker_token_v1` (exatamente o segredo da Edge). O Vault mantém o valor criptografado; o corpo do job contém apenas consultas aos nomes. Caso o segredo seja substituído, faça rotação coordenada na Edge e no Vault.
4. Teste o endpoint com credencial de servidor em STAGING e token incorreto e correto, inicialmente com fila de sandbox criada para essa finalidade; monitore a resposta e o estado SQL. Em **production** a chamada só pode ocorrer após aprovação explícita da cobrança e revisão das credenciais do Asaas.

## Exemplo de SQL **manual** para um DBA autorizado

**NÃO EXECUTAR agora.** Conferir o URL e os nomes do Vault antes de criar o agendamento. Abaixo não existe nenhum token literal.

```sql
-- Pré-checagem: deve retornar exatamente 2 segredos no projeto correto.
SELECT name FROM vault.decrypted_secrets
WHERE name IN (
  'guia_asaas_webhook_worker_url_v1',
  'guia_asaas_webhook_worker_token_v1'
);
-- Apenas DEPOIS da autorização, configure o job a cada 2 minutos.
SELECT cron.schedule(
  'guia-asaas-reconciliar-webhook',
  '*/2 * * * *',
  $job$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'guia_asaas_webhook_worker_url_v1' LIMIT 1
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-guia-asaas-worker-token', (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'guia_asaas_webhook_worker_token_v1' LIMIT 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 12000
    );
  $job$
);
-- Observabilidade:
SELECT jobid, jobname, schedule, active
FROM cron.job WHERE jobname='guia-asaas-reconciliar-webhook';
```

Para interromper em caso de falha:

```sql
SELECT cron.unschedule('guia-asaas-reconciliar-webhook');
```

Desative também a flag da Edge para bloqueio em profundidade.

## Operação

- Revisar periodicamente os webhooks `pendente`, `erro` e `processando` por meio do painel **Entregas — Operação → Confirmações Asaas pendentes** e dos logs do agendamento. A amostra de 100 eventos do painel não é uma contagem integral de backlog.
- Alertar se `erro` persistente, `processando` acima do lease de 5 minutos, job Cron sem execução recente, `HTTP 401` do worker ou tempo de fila acima do esperado. Um `HTTP 200` da Edge **não prova** que todos os eventos do lote foram conciliados: o retorno informa `processados` e `em_erro`.
- Se houver confirmação de pagamento recebida, mas não baixada, **não gerar nova fatura automaticamente**. Reconciliar a cobrança existente por ID e inspecionar a fila.
- Se o job falhar, os eventos permanecem no banco e o administrador pode usar o botão de reprocessar, mas isso não substitui o agendamento para operação contínua.
- **Saques de motoboys:** `ASAAS_PAYOUTS_ENABLED=false` e proibição de `POST /transfers` em produção permanecem. O job não altera essas salvaguardas.

Referências oficiais: https://supabase.com/docs/guides/cron/quickstart ; https://supabase.com/docs/guides/database/extensions/pg_net ; https://supabase.com/docs/guides/functions/background-tasks

## Acompanhamento somente leitura (COB-05, STAGING)

Executar as consultas no **SQL Editor do projeto de testes** `jbttwihctuibchhcyqtl`. Elas não criam eventos, não expõem segredos e não movimentam dinheiro.

**Execuções do Cron nas últimas 24 horas:**

```sql
SELECT j.jobid, j.jobname, j.active, j.schedule,
       max(d.start_time) AS ultima_execucao,
       count(*) FILTER (WHERE d.status='succeeded') AS execucoes_bem_sucedidas_24h,
       count(*) FILTER (WHERE d.status<>'succeeded') AS execucoes_com_problema_24h
FROM cron.job j
LEFT JOIN cron.job_run_details d
  ON d.jobid=j.jobid AND d.start_time > now()-interval '24 hours'
WHERE j.jobname='guia-asaas-reconciliar-webhook'
GROUP BY j.jobid,j.jobname,j.active,j.schedule;
```

**Fila dos webhooks e próximo horário de retentativa:**

```sql
SELECT estado, count(*) AS quantidade,
       min(criado_em) AS evento_mais_antigo,
       min(proxima_tentativa_em)
         FILTER (WHERE estado IN ('erro','pendente')) AS proxima_tentativa
FROM public.catalogo_asaas_webhook_eventos
GROUP BY estado ORDER BY estado;
```

**Respostas HTTP do `pg_net`, sem corpo e sem headers:**

```sql
SELECT status_code, count(*) AS respostas, max(created) AS resposta_mais_recente
FROM net._http_response
WHERE created > now()-interval '24 hours'
GROUP BY status_code ORDER BY status_code;
```

A tabela `net._http_response` inclui também **chamadas manuais de teste** (HTTP 401 e 503 esperados nos testes de acesso). Assim, a agregação não é específica do Cron: correlacione o horário de um erro com `cron.job_run_details` antes de considerá-lo uma falha operacional. `succeeded` no Cron apenas confirma a execução do comando SQL; a resposta HTTP do worker precisa ser **200**. Um HTTP 200 com `processados=0` não prova recuperação de evento falho: comprova somente que o agendador conectou à Edge com autenticação válida.

Se o Cron ficar sem executar, responder diferente de 200 ou a fila acumular `erro` além do backoff, investigar o evento e a origem do provedor sem gerar outra cobrança. Para interromper somente o agendamento de STAGING: `SELECT cron.unschedule('guia-asaas-reconciliar-webhook');`. Não alterar outros jobs nem as flags de saques.

**Evidência inicial:** 12/10/2026, primeira chamada automática às 16:32 UTC; execuções subsequentes às 16:34, 16:36, 16:38 e 16:40 UTC, todas com HTTP 200, 0 eventos processados (fila limpa). Validação da recuperação real de um evento com falha permanece em aberto na backlog COB-05.

## Duas filas distintas: recebimento Asaas × processamento interno

O `pg_cron` recupera **somente eventos que já foram persistidos** na tabela `catalogo_asaas_webhook_eventos`. Não consegue buscar eventos que o **Asaas ainda não conseguiu entregar** por erro de rede, token incorreto ou falha antes da gravação no endpoint. Há, portanto, dois caminhos independentes de recuperação:

- **Erro antes do ACK HTTP 200:** verificar **Integrações → Logs de Webhooks** no Asaas Sandbox; o próprio Asaas tenta reenviar. A documentação Asaas informa que **15 falhas consecutivas** podem interromper a fila de envio e que eventos da fila interrompida são preservados por **até 14 dias**. Corrigir a causa e reativar a fila no painel, se necessário; não criar outra fatura para compensar evento não recebido.
- **ACK 200 após persistir, seguido de falha na reconciliação:** o evento permanece como `pendente`/`erro` no PostgreSQL, a RPC `catalogo_asaas_webhook_finalizar` aplica backoff e o worker agendado usa `SKIP LOCKED` e lease com token para tentar novamente. Conferir `cron.job_run_details`, `net._http_response` e a tabela da fila antes de qualquer intervenção.

A prova de que o worker executa automaticamente (HTTP 200, fila vazia) **não substitui** um teste de recuperação de evento persistido e falho; e reenviar um evento **já concluído** prova idempotência, não retentativa.

Referências oficiais Asaas: [recebimento e logs de Webhook](https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook), [status HTTP e fila de retentativas](https://central.ajuda.asaas.com/hc/pt-br/articles/55716750746907-Como-funciona-o-status-de-resposta-HTTP-nos-webhooks-do-Asaas), [fila interrompida e retenção](https://central.ajuda.asaas.com/hc/pt-br/articles/55669757165211-O-que-fazer-quando-a-fila-de-sincroniza%C3%A7%C3%A3o-do-Webhook-for-interrompida).

## Critério de pronto

**Código e testes da rota** não são implantação. Antes de ativar, exigir: CI verde, testes HTTP de autenticação e fila em STAGING, teste de reconciliação com Asaas Sandbox, revisão das migrations, conta apta a cobranças, agendamento/alertas ativos e aprovação explícita para o projeto de produção. O recebimento das faturas pode ser homologado separadamente dos repasses, sem permitir dívidas escondidas ao motoboy.
