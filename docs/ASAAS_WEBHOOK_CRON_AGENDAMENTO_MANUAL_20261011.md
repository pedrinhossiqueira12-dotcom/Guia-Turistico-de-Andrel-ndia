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

**O agendamento abaixo é um procedimento manual de implantação. Nenhum Cron foi criado no Supabase remoto.** Use somente após revisar migrações, fazer homologação ponta a ponta em STAGING, conferir o escopo e obter autorização expressa para alterar o projeto escolhido.

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

## Critério de pronto

**Código e testes da rota** não são implantação. Antes de ativar, exigir: CI verde, testes HTTP de autenticação e fila em STAGING, teste de reconciliação com Asaas Sandbox, revisão das migrations, conta apta a cobranças, agendamento/alertas ativos e aprovação explícita para o projeto de produção. O recebimento das faturas pode ser homologado separadamente dos repasses, sem permitir dívidas escondidas ao motoboy.
