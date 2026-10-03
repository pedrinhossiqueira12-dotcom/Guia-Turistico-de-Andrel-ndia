# Mercado Pago — fluxo de teste do Catálogo Digital

## Limites

Esta etapa é **somente sandbox**. A integração aceita exclusivamente um vendedor de teste identificado em configuração, envia um comprador sintético `test_user_br@testuser.com` com `first_name=APRO` (cenário oficial de teste Mercado Pago), e valida a ordem consultando a API. O endpoint grava apenas `metadata.sandbox` em uma assinatura `pendente`; **não preenche `pago_em`, não altera `status` para `ativa` e não libera a vitrine**. A página de venda pública continua sem preços.

Os valores recebidos do proprietário do Guia são R$ 59,90 mensal e R$ 599,90 anual. O fluxo real, quando for autorizado, será uma cobrança Pix pontual por período: o pagador precisará pagar manualmente cada renovação no Mercado Pago; Pix aqui não é débito automático.

## O que precisa ser criado no Mercado Pago

1. Entre no [Mercado Pago Developers](https://www.mercadopago.com.br/developers/panel) com sua conta.
2. Crie uma aplicação para **Checkout Transparente / Orders API** (ou use a aplicação de teste já existente).
3. Em **Contas de teste**, use o vendedor de teste criado para a aplicação. Anote o **User ID** desse vendedor.
4. Em **Credenciais de teste**, copie o Access Token do vendedor de teste. Não use Access Token da sua conta real.
5. Se for testar webhooks, configure o tópico `order` e copie a chave secreta de assinatura. A tela/conta de teste pode não oferecer a mesma configuração do modo produtivo; o fluxo também consulta o estado por polling, portanto o webhook é opcional para a primeira prova. O callback previsto é `https://xdmbkflufsfqziixzpxc.supabase.co/functions/v1/catalogo-pix-sandbox?source=mercadopago`.

**Nunca cole token, chave secreta, senha ou QR de pagamento real nesta conversa.** As credenciais devem ser inseridas apenas nos secrets server-side do Supabase.

## Secrets do Supabase necessários

No projeto `xdmbkflufsfqziixzpxc`, configure os secrets server-side usados pelas Edge Functions:

| Secret | Valor |
|---|---|
| `MP_MODE` | `sandbox` |
| `MP_TEST_ACCESS_TOKEN` | Access Token do vendedor **de teste** |
| `MP_TEST_SELLER_ID` | User ID do vendedor **de teste** |
| `MP_TEST_WEBHOOK_SECRET` | Chave HMAC gerada para o webhook de teste (opcional para polling; obrigatória para receber webhooks) |

A função chama `GET /users/me` antes de criar uma order e exige que o ID corresponda a `MP_TEST_SELLER_ID`; isso ajuda a detectar a troca acidental de conta. A API usa o mesmo host para operações de teste e produção, e o prefixo do token não prova sozinho que ele é sandbox. Portanto, cadastre **somente** Access Token e User ID de uma conta de teste, confirme-os duas vezes e jamais use credenciais da conta real. O código exige `MP_MODE=sandbox`, envia o comprador de teste fixo e recusa `live_mode=true`, mas a segurança também depende da configuração correta dos secrets.

A configuração de Edge Functions deve usar `verify_jwt=false` apenas para que a rota `/webhook` receba chamadas do Mercado Pago. As ações chamadas pelo navegador validam por conta própria o Bearer JWT, o proprietário aprovado por `local_id` e o estado do comércio.

Ao configurar a notificação, use o callback acima com o tópico `order`. O Mercado Pago acrescenta `data.id` e `type` à URL; o handler só aceita uma assinatura HMAC válida, busca a order diretamente pela API e só atualiza `metadata.sandbox`.

## Como testar depois que os secrets forem configurados

1. Entre na página do Catálogo Digital com a conta autenticada e vinculada ao comércio. O link para o teste só aparece após confirmação server-side da propriedade; também é possível abrir `pages/catalogo-pix-teste.html?id=<id-do-comercio>` diretamente.
2. Escolher **Mensal** ou **Anual**. O valor vem do endpoint server-side e não aparece na página pública de venda.
3. A função retorna o Pix de sandbox (QR/código Copia e Cola) e a tela monitora a ordem. A documentação oficial usa `first_name=APRO`, que produz uma resposta de teste e aprovação automática; não faça um pagamento com dinheiro real.
4. Ao aparecer “Aprovado no sandbox”, confirmar que o registro continua `status='pendente'`, `pago_em IS NULL`, que `metadata.sandbox.status='paid'` e que o catálogo público continua fechado.

## Fontes oficiais consultadas

- [Teste Pix na Orders API](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/integration-test/pix)
- [Contas de teste](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/resources/test-accounts)
- [Status das orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/status/order-status)
- [Notificações Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications)
- [Validação da assinatura HMAC](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/optional-notifications)

A documentação tem páginas com orientações de credenciais divergentes; por isso o código usa apenas o vendedor de teste configurado e valida o resultado da API antes de seguir. Não configure credenciais reais nesta etapa.
