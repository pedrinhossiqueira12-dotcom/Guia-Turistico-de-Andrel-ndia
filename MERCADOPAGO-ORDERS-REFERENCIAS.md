# Referências oficiais da etapa Orders/Pix

- Pix com Checkout Transparente via Orders API: https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/payment-integration/pix
  - criação via `POST /v1/orders`;
  - `type: online`, `processing_mode: automatic`;
  - pagamento Pix com `payment_method.id: pix` e `payment_method.type: bank_transfer`;
  - `X-Idempotency-Key` obrigatório;
  - resposta traz `ticket_url`, `qr_code` e `qr_code_base64`.

- Marketplace com Checkout Transparente: https://www.mercadopago.com.br/developers/en/docs/checkout-pro-preferences/how-tos/integrate-marketplace
  - usar o access token do vendedor obtido por OAuth;
  - a taxa da plataforma no fluxo Checkout Transparente é enviada como `application_fee` na Payments API.

- Marketplace fee em Orders API: https://www.mercadopago.com.br/developers/en/docs/qr-code/resources/migrate-dynamic-qr-model-to-orders
  - `marketplace_fee` é exclusivo de integrações OAuth;
  - a aplicação deve ser identificada pelo access token OAuth;
  - a referência externa deve ser conferida no webhook antes de confirmar o pedido.

A implementação mantém `MARKETPLACE_CHECKOUT_ENABLED=false` por padrão. Nenhuma cobrança deve ser ativada sem validar o ambiente, webhook, payload e estratégia de split com uma transação de teste controlada.
