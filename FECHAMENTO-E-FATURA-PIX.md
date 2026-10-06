# Fechamento automático e cobrança Pix da fatura

**Estado desta entrega: preparado localmente; nada foi aplicado no Supabase, nenhuma função foi implantada e nenhuma cobrança foi criada.**

Este documento cobre os dois últimos blocos pendentes do marketplace de pagamentos presenciais:

1. o **fechamento mensal automático** das comissões offline (agendado e auditado);
2. a **cobrança Pix da fatura** mensal, paga pelo comércio à plataforma.

Ambos são instalados **desligados** e dependem de autorização e configuração posteriores.

## 1. Arquivos desta entrega

| Arquivo | Função |
|---|---|
| `supabase/migrations/20261005150000_catalogo_fechamento_automatico.sql` | Cria a configuração `catalogo_automacao_config` e a rotina de fechamento; agenda via `pg_cron` de forma defensiva |
| `supabase/migrations/20261005160000_catalogo_fatura_pix.sql` | Auditoria da automação, correção do cálculo do fechamento, tabelas/RPCs da cobrança Pix da fatura |
| `supabase/functions/catalogo-fatura-pix/index.ts` | Emissão, consulta e webhook da cobrança da fatura |
| `supabase/functions/catalogo-fatura-pix/fatura-utils.mjs` | Validação pura (valor, referência, recebedor, Pix, HMAC) |
| `pages/catalogo-admin.html`, `js/catalogo-admin.js`, `styles/catalogo-admin.css` | Bloco “Pix da fatura” no painel do comércio |
| `supabase/config.toml` | `catalogo-fatura-pix` com `verify_jwt = false` (webhook do provedor) |
| `supabase/migrations/20261005170000_catalogo_correcao_confirmacao_offline.sql` | Corrige a confirmação de entrega offline (alvo de conflito ambíguo) |
| `tests/catalogo-fechamento-automatico.test.cjs`, `tests/fatura-pix-utils.test.mjs`, `tests/catalogo-fatura-pix.test.cjs`, `tests/catalogo-correcao-confirmacao.test.cjs` | Testes de unidade e estáticos do bloco |

## 2. Correção obrigatória: confirmação de entrega offline

Antes de ligar o checkout presencial é preciso aplicar `20261005170000_catalogo_correcao_confirmacao_offline.sql`.

A função `catalogo_confirmar_pedido_offline` declara um parâmetro de saída chamado `pedido_id` (`RETURNS TABLE(ok, pedido_id, status, status_pagamento, mensagem)`) e o `INSERT` da comissão usava `ON CONFLICT (pedido_id)`. O PL/pgSQL não consegue decidir se esse alvo é a coluna da tabela ou a variável de saída e aborta a execução:

```text
ERROR: column reference "pedido_id" is ambiguous
DETAIL: It could refer to either a PL/pgSQL variable or a table column.
```

Consequência prática: **toda confirmação válida falhava depois de aceitar o código**. O pedido era marcado como entregue, mas a comissão não era registrada e o entregador recebia erro genérico (“Falha ao validar o código de entrega”, HTTP 500). Como essa etapa ainda não havia sido executada de ponta a ponta em produção, o defeito passou pelas revisões anteriores — os testes existentes eram estáticos, lendo o texto dos arquivos SQL — e só apareceu na execução real do SQL em banco.

A correção troca o alvo pelo nome da constraint (`ON CONFLICT ON CONSTRAINT catalogo_comissoes_offline_pedido_id_key`), o que elimina a ambiguidade sem alterar os nomes devolvidos nem o contrato consumido pela Edge Function `catalogo-pedido-offline`. Nenhuma regra de negócio mudou: token, código, expiração de 48 h, limite de tentativas, confirmação única e comissão de 5% sobre os produtos continuam iguais.

Evidência local, no mesmo banco com dois pedidos: antes da correção a primeira confirmação válida retornava o erro de ambiguidade; depois dela o pedido correto é concluído, o outro permanece intacto e a comissão de 5% é registrada.

## 3. Fechamento mensal automático

### Como funciona

- A rotina `catalogo_processar_fechamentos_offline(p_data, p_origem)` calcula a competência do **mês anterior** a `p_data`.
- Ela só age se `catalogo_automacao_config.fechamento_offline_ativo = true` (padrão **false**).
- Para cada comércio com comissões `aberta`/`faturada` na competência, chama `catalogo_gerar_fechamento_offline`, que congela total de pedidos, total de comissão e vencimento (`competência + 1 mês + 5 dias`).
- Em seguida chama `catalogo_bloquear_inadimplentes_offline()`, que marca o fechamento como `vencido` → `bloqueado` e bloqueia o catálogo do comércio devedor.
- Cada execução grava uma linha em `catalogo_automacao_execucoes` (origem, competência, fechamentos gerados, bloqueios, erro).

### Correção importante em relação à versão anterior

A primeira versão do gerador somava apenas comissões com status `aberta`/`faturada`. Depois que uma comissão passava para `bloqueado` ou `paga`, um novo recálculo **reduzia o total da fatura — podendo zerá-lo** — e ainda podia rebaixar um fechamento `bloqueado`/`vencido` para `faturado`. Isso poderia apagar o valor histórico devido de um comércio inadimplente.

A versão desta entrega:

- soma todas as comissões da competência **exceto** `cancelada` e `contestada`;
- nunca recalcula um fechamento já `pago`;
- preserva `vencido` e `bloqueado` quando o fechamento é regerado;
- não cria fechamento vazio quando não existe linha prévia e não há comissão.

### Agendamento

- Job `andrelandia-fechamento-offline-diario`, expressão `15 3 * * *` (diário, 03:15 UTC).
- O agendamento é criado/reagendado dentro de um bloco com tratamento de exceção: se `pg_cron` não estiver habilitado no projeto, a migration **não aborta**, apenas registra um `RAISE NOTICE`.
- Como não há cobrança externa nessa rotina, ela apenas prepara faturas e bloqueios.

## 4. Cobrança Pix da fatura

### Estrutura

- `catalogo_fatura_cobrancas`: uma cobrança por fechamento (`UNIQUE (fechamento_id)`), com `order_id` único, valor, QR, copia e cola, ticket, expiração, status, tentativas e divergência.
- `catalogo_fatura_eventos`: histórico de eventos da cobrança (criação, reemissão, divergência, pagamento, revogação).
- Estados aceitos: `pendente`, `pago`, `expirado`, `cancelado`, `estornado`, `contestado`, `divergente`.
- RLS ligada e acesso restrito a `service_role` — o navegador nunca lê nem grava essas tabelas diretamente.

### RPCs

`catalogo_registrar_cobranca_fatura(...)`
- Exige fechamento existente, não pago, com valor **idêntico** ao total da fatura.
- Reemissão atualiza a mesma linha e incrementa `tentativas`, registrando evento.
- Não registra cobrança sem `order_id` do provedor.

`catalogo_confirmar_cobranca_fatura(p_order_id, p_estado, p_payment_id, p_valor_centavos, p_detalhe)`
- `pago`: só efetiva com valor **idêntico**; confirmação repetida é idempotente; quita o fechamento, marca as comissões como `paga` e remove **apenas** o bloqueio financeiro (`motivo_bloqueio` da dívida de comissão).
- Valor divergente: grava status `divergente` e **não** quita nada — a conferência é manual.
- `estornado` / `contestado`: revogam a quitação (fechamento volta a `vencido`, comissões voltam a `faturada`) e rebloqueiam o catálogo pelo motivo financeiro.
- `cancelado` / `expirado`: encerram a cobrança sem tocar na fatura.
- `pendente`: atualiza a última consulta.

### Edge Function `catalogo-fatura-pix`

Ações autenticadas (sessão Bearer validada; proprietário do comércio ou administrador):

- `obter_fatura`: devolve fechamento e cobrança da competência e se o pagamento está disponível.
- `criar_cobranca`: exige `FATURA_PIX_ENABLED=true`, `MP_PLATFORM_ACCESS_TOKEN`, `MP_PLATFORM_SELLER_ID` e `MP_PLATFORM_WEBHOOK_SECRET`; confere `/users/me` contra o recebedor configurado; cria uma Order Pix (`processing_mode: automatic`) com `X-Idempotency-Key` derivada do fechamento; valida a order devolvida (order, referência, recebedor, valor, país, método Pix, ticket HTTPS sem “sandbox”) antes de registrar; reapresenta o Pix pendente em vez de emitir outro.
- `consultar_cobranca`: reconsulta a order no provedor e concilia pela RPC transacional.

Webhook público (`/webhook`, alcançável por `verify_jwt = false`):

- Exige assinatura HMAC (`x-signature` + `x-request-id`) do Mercado Pago.
- Reconsulta a order na API antes de qualquer alteração e confere a referência da fatura.
- Idempotente: notificações repetidas não alteram o resultado.

## 5. Sequência de implantação (não executar sem revisão)

1. Revisar os dois SQL e as funções nesta branch.
2. Habilitar `pg_cron` no painel do Supabase (Database → Extensions) **antes** de aplicar a migration, para o agendamento ser criado de imediato.
3. Aplicar as migrations no SQL Editor do projeto, uma por vez, conferindo o resultado — nesta ordem: `20261005150000_catalogo_fechamento_automatico.sql`, `20261005160000_catalogo_fatura_pix.sql` e `20261005170000_catalogo_correcao_confirmacao_offline.sql`. Não usar `supabase db push` sem conferir a lista completa de migrações pendentes.
4. Implantar a função:

   ```bash
   supabase functions deploy catalogo-fatura-pix --project-ref xdmbkflufsfqziixzpxc
   ```

5. Configurar os secrets no Dashboard (sem colocar valores no Git, no HTML ou em mensagens):
   - `MP_PLATFORM_ACCESS_TOKEN`: Access Token da conta recebedora **da plataforma**;
   - `MP_PLATFORM_SELLER_ID`: ID numérico da mesma conta;
   - `MP_PLATFORM_WEBHOOK_SECRET`: segredo HMAC do webhook de Orders;
   - `FATURA_PIX_ENABLED`: manter `false` durante instalação e conferência.
6. Cadastrar no painel do Mercado Pago a URL de notificação:

   ```text
   https://xdmbkflufsfqziixzpxc.supabase.co/functions/v1/catalogo-fatura-pix/webhook
   ```

7. Testar em faturas controladas: fechamento manual de uma competência de teste, emissão de Pix de valor baixo, confirmação por webhook, confirmação repetida, pagamento de valor divergente e estorno.
8. Só então avaliar a mudança de `FATURA_PIX_ENABLED` para `true` e a ativação de `fatura_pix_ativo` na configuração — duas travas independentes.

## 6. O que **não** foi feito

- Nenhuma migration aplicada no Supabase.
- Nenhuma Edge Function implantada.
- Nenhum secret configurado, nenhuma conta recebedora cadastrada.
- Nenhuma Order criada, nem em sandbox nem em produção.
- Nenhuma alteração no repositório remoto do GitHub.
- Nenhuma cobrança real, nenhum reembolso e nenhuma exclusão de dados.

## 7. Pendências conhecidas

- **Vínculo do recebedor da plataforma:** o token pertence à conta da plataforma; a decisão de qual conta recebe a comissão precisa ser confirmada.
- **Divergência de valor:** hoje exige conferência manual. Uma política automática de tolerância (ou de cobrança complementar) ainda não existe.
- **Bloqueio administrativo distinto:** o desbloqueio automático só remove o bloqueio cujo motivo é exatamente a dívida de comissão. O caminho antigo `registrar_pagamento` do painel administrativo continua desbloqueando sem essa checagem; alinhar antes de produção.
- **Comissão Pix online (5% por pedido online):** permanece no fluxo do marketplace, sem fatura mensal.
- **Estorno parcial:** tratado como revogação total da quitação; revisar antes de uso real.
- **Observabilidade:** não há alerta quando uma execução automática falha; a evidência fica em `catalogo_automacao_execucoes`.

## 8. Validações executadas nesta entrega

- Suíte Node: **118 testes aprovados, 0 falhas** (eram 92 antes desta entrega).
- `deno check supabase/functions/catalogo-fatura-pix/index.ts`: passou.
- `node --check` em `js/catalogo-admin.js`, `fatura-utils.mjs` e nos testes novos: passou.
- Migrations executadas em PostgreSQL 16 local descartável (papéis `anon`, `authenticated` e `service_role` simulados), com `ON_ERROR_STOP`:
  - as seis migrations do bloco (inclusive as já aplicadas de pagamentos offline) aplicaram sem erro;
  - quando `pg_cron` não está disponível, o agendamento apenas registra aviso e não aborta a transação;
  - cinco cenários funcionais executados e verificados: confirmação única e recusa de código errado/expirado; automação desligada sem efeito; total do fechamento estável após bloqueio, com auditoria da execução; ciclo completo da cobrança Pix (valor divergente, cancelamento, quitação, idempotência, estorno e eventos); e preservação de bloqueio administrativo que não é dívida de comissão.
- Nenhuma chamada real à API de pagamentos foi feita; não há credenciais no ambiente.
