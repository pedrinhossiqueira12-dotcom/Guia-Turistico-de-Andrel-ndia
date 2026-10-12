# COB-05 — Ensaio de recuperação com evento legítimo do Asaas Sandbox

**Somente Supabase STAGING** `jbttwihctuibchhcyqtl` e **Asaas SANDBOX**. Não envolve pagamento recebido, saque, transferência, fatura existente ou produção. Autorizado pelo proprietário em 12/10/2026, PR #39 permanece Draft.

## Objetivo e mecanismo real

Gerar um único `PAYMENT_CREATED` no provedor usando uma cobrança Pix **PENDENTE** de R$ 1 (sem pagar). A referência temporária `fatura-cob05-lab-<id>-2099-01` corresponderá ao padrão de uma fatura do Guia, mas sem vínculo no banco, reproduzindo a falha genuína **"Webhook recebido antes do vínculo local"**; `processarEventoAsaasPendente` obtém a cobrança autenticada no Asaas, identifica a referência e lança falha 503 interna, persistida como `erro` com backoff pela RPC. Não altera nem cria qualquer registro contábil.

Após confirmar o evento em `erro`, corrigir a própria referência no Asaas Sandbox para `cob05-lab-liberado-...`, deixando a cobrança **PENDENTE**. A nova referência sinaliza que não pertence a fatura do Guia. A retentativa deve ser feita pelo `cron.jobid=5`, levando o **mesmo ID de evento** de `erro` para `concluido` e incrementando `tentativas`, sem liberar créditos ou faturas. Essa correção é proposital no Sandbox e testa o cenário de vínculo ausente, **não** a baixa real de um pagamento.

## Preparação sem compartilhar credenciais

Usar no Windows PowerShell o script `scripts/asaas-cob05-retry-sandbox.ps1` versionado nesta PR. Ele permite somente `https://api-sandbox.asaas.com/v3` e solicita a chave Sandbox em prompt seguro, sem colocar valor no código, GitHub ou chat. Não reutilizar a chave de produção. O modo `Liberar` confere ID, referência, descrição, status pendente, Pix e exatamente R$ 1 antes de efetuar `PUT`.

1. Na pasta do repositório na branch da PR #39, executar `./scripts/asaas-cob05-retry-sandbox.ps1 -Modo Verificar`. Este modo exige que o **webhook já existente do STAGING** no Asaas Sandbox tenha `PAYMENT_CREATED` habilitado. Se estiver desabilitado, entrar no painel **Sandbox → Integrações → Webhooks** e habilitar **apenas esse evento** no webhook de STAGING, sem criar outro endpoint e sem tocar no webhook produtivo. A seleção de eventos pode ser restaurada depois do ensaio.
2. Executar `./scripts/asaas-cob05-retry-sandbox.ps1 -Modo Clientes` para obter o `cus_...` de um cliente de testes que o proprietário controla. Não copiar documentos/CPF nem API keys para o chat.
3. Executar `./scripts/asaas-cob05-retry-sandbox.ps1 -Modo Criar -ClienteId cus_...` **uma única vez**. O script emite somente a cobrança pendente R$1 e imprime `COBRANCA_COB05_ID` e `REFERENCIA_TEMPORARIA`. **Não pagar, não confirmar recebimento, não excluir nem repetir em caso de erro**: pesquisar cobrança existente primeiro. Informar ao assistente somente o ID e a referência.
4. O assistente verificará `catalogo_asaas_webhook_eventos`: deve existir `PAYMENT_CREATED` autêntico com `recurso_id=pay_...`, `estado=erro`, `tentativas>=1`, `proxima_tentativa_em` não nula. Se não chegar evento, verificar seleção `PAYMENT_CREATED` e logs de entrega no Asaas Sandbox. **Não fazer `UPDATE` direto em eventos.**
5. Após a confirmação da falha, executar `./scripts/asaas-cob05-retry-sandbox.ps1 -Modo Liberar -CobrancaId pay_...` no próprio Sandbox. O script faz GET e valida que é **a cobrança certa, pendente, sem pagamento** antes de alterar `externalReference`, nunca valor/pagador/status.
6. Conferir o **mesmo evento** com `estado=concluido`, `tentativas>=2`, `concluido_em` e execução HTTP 200 do Cron com `processados>=1`. Registrar event ID, tentativa, timestamps, run ID e comparação do livro financeiro antes/depois. Aceitar COB-05 somente se o Cron realmente finalizou o evento após o backoff.
7. Deixar a cobrança fictícia PENDENTE e identificada como ensaio; cancelar somente se necessário e depois de verificar que o evento já foi concluído. Registrar se `PAYMENT_CREATED` foi habilitado temporariamente e avaliar revertê-lo à seleção anterior.

**Nunca** executar `POST /transfers`, `confirmar pagamento`, criar fatura no Guia, modificar event ID/status via SQL, alterar Secret em produção nem pagar este Pix. O teste é bloqueado se ocorrer divergência de ID/valor/ref ou se a Edge/Sandbox receber evento real de outra cobrança que exija intervenção.

## Consultas seguras para verificação

```sql
-- Substituir o ID exclusivamente pelo pay_... retornado no teste.
SELECT id,evento,recurso_id,referencia_externa,estado,tentativas,
       proxima_tentativa_em,iniciado_em,concluido_em
FROM public.catalogo_asaas_webhook_eventos
WHERE recurso_id='PAY_ID_DO_ENSAIO'
ORDER BY criado_em;

SELECT jobid,runid,status,start_time,end_time
FROM cron.job_run_details WHERE jobid=5 ORDER BY start_time DESC LIMIT 10;

-- Controle de regressão das faturas antigas e saldo legítimo.
SELECT f.status,ch.status AS cobranca_status,ch.valor_centavos
FROM public.catalogo_fechamentos_offline f
JOIN public.catalogo_fatura_cobrancas ch ON ch.fechamento_id=f.id
WHERE f.id='53a2159f-1e6a-449d-b2cf-ea62e7a3e877';
```

## Limitações de honestidade técnica

A criação de cobrança PENDENTE pode disparar `PAYMENT_CREATED`, mas **somente se o webhook Asaas Sandbox estiver configurado para enviá-lo**. Nenhum evento desse tipo aparecia nos 7 eventos antigos. A atualização de referência de uma cobrança pendente é permitida pela API oficial do Asaas, mas depende da resposta e restrições aplicáveis à conta. Não declarar aprovado antes de verificar o comportamento real. Caso não haja `PAYMENT_CREATED` ou a alteração seja recusada, interromper e investigar, sem contaminar a contabilidade.

Referências: https://docs.asaas.com/docs/webhook-para-cobrancas ; https://docs.asaas.com/reference/atualizar-cobranca-existente ; https://docs.asaas.com/docs/sandbox
