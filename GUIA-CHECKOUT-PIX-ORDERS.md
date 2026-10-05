# Próxima etapa: checkout Pix com Orders API

## O que foi preparado

Esta etapa troca o botão de pedido apenas via WhatsApp por uma tela que coleta o e-mail do comprador, prepara um pedido Pix, calcula 5% de taxa somente sobre os produtos e envia `marketplace_fee` ao Mercado Pago usando o access token OAuth do comércio. Os preços são sempre relidos do banco; o navegador não pode alterar preço, taxa ou repasse.

Também foi preparado um webhook que consulta a Order diretamente no Mercado Pago e só marca o pedido como pago quando a referência externa, a assinatura do webhook e o status retornado forem válidos.

## Estado seguro

O checkout permanece desligado enquanto o secret `MARKETPLACE_CHECKOUT_ENABLED` não for `true`. Portanto, aplicar este patch e publicar as funções não cria cobrança por si só.

## Aplicação local

Na pasta do repositório atualizado:

```powershell
git switch main
git pull origin main
git apply --check .\guia-andrelandia-orders.patch
git apply .\guia-andrelandia-orders.patch
git switch -c checkout-pix-orders
```

Se a branch já existir, use `git switch checkout-pix-orders`.

Valide antes de publicar:

```powershell
node --test tests/*.test.js tests/*.test.mjs tests/*.test.cjs
git diff --check
```

## Migration

A migration adiciona o e-mail do comprador:

```powershell
npx supabase db push
```

Confirme com:

```powershell
npx supabase migration list
```

## Secrets

Mantenha os secrets OAuth já configurados. Adicione o secret do webhook somente depois de copiar, no painel Mercado Pago, o segredo de assinatura dos webhooks da aplicação de produção:

```powershell
npx supabase secrets set MARKETPLACE_CHECKOUT_ENABLED="false" MP_MARKETPLACE_WEBHOOK_SECRET="<SEGREDO_DO_WEBHOOK>"
```

Não coloque o segredo no GitHub e não o envie por mensagem.

## Deploy das funções

```powershell
npx supabase functions deploy catalogo-pedido-pix --no-verify-jwt
npx supabase functions deploy mercadopago-marketplace-webhook --no-verify-jwt
```

O callback OAuth existente continua sendo publicado separadamente quando necessário:

```powershell
npx supabase functions deploy mercadopago-oauth-callback --no-verify-jwt
```

## Configuração do webhook no Mercado Pago

Na aplicação de produção, em Webhooks, cadastre:

```text
https://xdmbkflufsfqziixzpxc.supabase.co/functions/v1/mercadopago-marketplace-webhook
```

Selecione o evento de Orders/Pedidos. O painel deve fornecer o segredo usado em `MP_MARKETPLACE_WEBHOOK_SECRET`.

## Teste controlado

Antes de habilitar o checkout, confirme que a função retorna a mensagem de checkout desligado. Só após revisar logs, webhook e ambiente de teste o administrador poderá decidir habilitar:

```powershell
npx supabase secrets set MARKETPLACE_CHECKOUT_ENABLED="true"
```

Essa alteração permite criação de Pix e pode gerar cobrança real. Faça essa alteração apenas quando estiver pronto para uma transação controlada.
