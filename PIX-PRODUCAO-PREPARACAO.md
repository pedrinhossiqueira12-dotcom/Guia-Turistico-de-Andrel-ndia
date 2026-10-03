# Preparação do Pix real — Catálogo Digital

**Estado desta entrega: preparado localmente; sem implantação e sem cobrança real.**

## O que foi preparado

- Edge Function separada, `catalogo-pix-producao`, independente da função sandbox.
- Tela autenticada e `noindex`, com planos visíveis apenas depois da validação de propriedade no servidor.
- Flag `MP_PRODUCTION_ENABLED` desligada por padrão. A criação de uma nova Order exige a flag explicitamente igual a `true`, o access token, o ID do recebedor e o segredo do webhook. Sem isso, não há emissão de Pix.
- Order criada com Pix e `processing_mode: automatic`; o cliente não escolhe o preço nem informa o recebedor.
- Ativação somente após o servidor consultar a Order na API do Mercado Pago e confirmar valor, referência, vendedor associado ao token, país e meio Pix, além dos estados `processed/accredited` na Order e na transação.
- RPC SQL transacional para atualizar pagamento e assinatura em conjunto, com execução concedida somente a `service_role`.
- Índice único impede duas tentativas de pagamento para a mesma assinatura; a migração falha com mensagem clara se já encontrar duplicidades, e o código também recusa múltiplas linhas.
- Criação concorrente do catálogo é revalidada após `23505`; o servidor confirma novamente proprietário e estado bloqueado antes de reservar uma assinatura.
- Uma emissão Pix pendente inicial exige ID da transação e `ticket_url` HTTPS válido do Mercado Pago; URL sandbox falha fechada. Em reconciliação posterior, uma Order terminal de estorno/chargeback pode ser processada mesmo se o provedor omitir ticket/detalhes de transação, desde que order, referência, valor e o payment ID previamente validado continuem correspondendo. Status desconhecidos falham fechados. Se `user_id` vier na Order, precisa corresponder ao recebedor; além disso, o servidor consulta `/users/me` e compara conta e `site_id=MLB` antes de anunciar ou processar o checkout.
- O e-mail do proprietário fica apenas em metadata privada durante retries de criação idempotente e é removido por RPC atômica assim que a Order fica vinculada.
- A página apaga QR/código e interrompe polling ao encerrar/trocar sessão ou perder autorização; o polling considera apenas o pagamento da assinatura mais recente.
- Estorno total ou parcial confirmado cancela a assinatura e bloqueia a vitrine; contestação/chargeback confirmado faz o mesmo. **O sistema não inicia reembolsos.**
- O bloqueio aqui é **público**: a assinatura cancelada tira a vitrine do público pelo gate existente. Não grava `catalogos.bloqueado=true` como bloqueio administrativo permanente; uma nova contratação aprovada poderá reativar a vitrine.
- A renovação é manual: mensal (30 dias) ou anual (365 dias), sem cobrança recorrente automática.
- Migração preparada para encerrar somente assinaturas sandbox pendentes identificadas como teste, preservando seus registros e metadata; isso libera o índice de uma assinatura pendente por comércio.
- A configuração Supabase mantém `verify_jwt = false` para que o provedor possa alcançar o webhook. As ações do proprietário validam a sessão Bearer com `auth.getUser`; o webhook exige HMAC do Mercado Pago.

## O que **não** foi feito

- Não apliquei a migração no Supabase.
- Não implantei a Edge Function nem publiquei os arquivos do site.
- Não configurei credenciais de produção, conta recebedora ou webhook.
- Não habilitei `MP_PRODUCTION_ENABLED` e não criei Order de produção.
- Não alterei o repositório remoto do GitHub.

As alterações estão em uma branch **local** baseada no commit `c03903d84351`; o patch pode ser revisado e aplicado após aprovação. O estado atual permanece desligado.

## Arquivos principais

- `supabase/functions/catalogo-pix-producao/index.ts`
- `supabase/functions/catalogo-pix-producao/mercadopago-utils.mjs`
- `supabase/migrations/20261003140000_catalogo_pagamento_producao.sql`
- `pages/catalogo-pix-producao.html` e `js/catalogo-pix-producao.js`
- `supabase/config.toml`

## Sequência para continuar — ainda não executar sem a revisão final

1. **Revisar o SQL** em `supabase/migrations/20261003140000_catalogo_pagamento_producao.sql`. A atualização inicial da migração só encerra linhas com `status='pendente'`, `gateway='mercadopago_sandbox'` e `metadata.sandbox_only=true` (na raiz ou dentro de `sandbox`). Ela não mexe em assinaturas ativas.
2. Aplicar **somente essa migração** no SQL Editor do projeto Supabase e conferir o resultado. Não usar `supabase db push` sem antes conferir toda a lista de migrações pendentes do projeto remoto.
3. Fazer deploy apenas da função, com o Supabase CLI já autenticado e ligado ao projeto correto:

   ```bash
   supabase functions deploy catalogo-pix-producao --project-ref xdmbkflufsfqziixzpxc
   ```

   O `supabase/config.toml` configura a função para receber o webhook público; a validação de sessão/HMAC fica dentro do código. Este comando **não liga** a flag de cobrança.
4. Publicar os arquivos do site somente depois de revisar a tela privada e a política exibida.
5. Criar os secrets no Supabase Dashboard, sem colocar valores no Git, no HTML ou em mensagens:
   - `MP_PROD_ACCESS_TOKEN`: Access Token **de produção** da integração Mercado Pago;
   - `MP_PROD_SELLER_ID`: ID numérico da mesma conta recebedora;
   - `MP_PROD_WEBHOOK_SECRET`: chave secreta HMAC configurada para o webhook de Orders;
   - `MP_PRODUCTION_ENABLED`: manter exatamente `false` durante instalação e conferência.
6. No painel da integração Mercado Pago, cadastrar como notificação de Order a URL:

   ```text
   https://xdmbkflufsfqziixzpxc.supabase.co/functions/v1/catalogo-pix-producao/webhook
   ```

   Selecionar eventos de Orders e configurar o segredo correspondente em `MP_PROD_WEBHOOK_SECRET`. O webhook consulta a Order atual na API do provedor antes de alterar qualquer assinatura.
7. No painel Mercado Pago, selecionar explicitamente a credencial **Production credentials**; a documentação informa que Access Tokens de teste também podem começar com `APP_USR`, portanto o prefixo não distingue os ambientes. `/users/me` confirma a identidade da conta e `site_id=MLB`, mas não prova sozinho que o token é live. Conferir, sem expor o token, que o ID retornado corresponde ao recebedor esperado. O código repete a comparação antes de criar, consultar ou processar notificações. A referência da Orders API documenta `country_code` como `BR` e não promete os campos `live_mode` ou `user_id` na Order; por isso o uso da credencial de produção correta é um pré-requisito manual, além da validação do seller e da rejeição de URLs de ticket marcadas como sandbox quando o campo vier.
8. **Somente após uma conferência final da conta recebedora, valores, webhook, página e SQL**, alterar `MP_PRODUCTION_ENABLED` para `true`. Esse passo é a habilitação de novas Orders Pix reais e deve ter autorização final explícita. A tela apresentará a confirmação do comércio, plano e preço antes de gerar cada Pix.

Desligar a flag interrompe **novas** cobranças, mas não interrompe a consulta/webhook de Orders já emitidas; isso é necessário para reconciliar pagamentos pendentes e revogações. Enquanto houver Orders pendentes, não remover os secrets do token/recebedor/webhook.

Não envie Access Token nem segredo HMAC no chat. Insira-os diretamente como secrets do projeto Supabase. O Access Token não deve ser impresso em logs.

## Valores e política implementados

| Plano | Valor | Período | Renovação |
|---|---:|---:|---|
| Mensal | R$ 59,90 | 30 dias | Manual |
| Anual | R$ 599,90 | 365 dias | Manual |

Um pagamento pendente, falho, cancelado ou expirado não ativa o catálogo. Aprovação só ativa se a Order e a transação Pix forem `processed/accredited`, e a migração/RPC também protege contra regressão por notificação antiga. Estorno parcial ou integral e chargeback cancelam a assinatura e bloqueiam a vitrine imediatamente.

## Validações locais executadas

- Suíte Node: **60 testes passaram, 0 falharam**.
- `deno check supabase/functions/catalogo-pix-producao/index.ts`: passou.
- `node --check` nos clientes JS, manifesto JSON e `git diff --check`: passaram.
- Parser PostgreSQL (sintaxe externa da migração): passou. **O corpo PL/pgSQL não foi executado em uma instância de banco**; precisa de validação no Supabase antes da aplicação.
- O patch também foi aplicado a uma cópia limpa do commit-base para validar que os arquivos novos e modificados estão incluídos e podem ser aplicados.
- Nenhum teste de cobrança live foi feito; não há credenciais de produção no ambiente.

## Referências oficiais consultadas

- [Pix — Checkout Transparente via Orders API](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/payment-integration/pix)
- [Referência POST /v1/orders](https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/create-order/post)
- [Status de Orders API](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/payment-management/status/order-status)
- [Notificações Orders](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/notifications)
- [Credenciais — Mercado Pago](https://www.mercadopago.com.br/developers/en/docs/your-integrations/credentials)
- [Aplicação e credenciais de teste — Orders API](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/create-application)
- [Secrets de Edge Functions — Supabase](https://supabase.com/docs/guides/functions/secrets)
- [Deploy de Edge Functions — Supabase](https://supabase.com/docs/guides/functions/deploy)
- [Configuração local do Supabase CLI](https://supabase.com/docs/guides/local-development/cli/config)
