# Fontes oficiais consultadas — 06/10/2026

## Mercado Pago: split marketplace

- [Visão geral do Split Payments 1:1](https://www.mercadopago.com.br/developers/en/docs/split-payments/split-1-1/overview).
- [Integração do checkout com Split Payments 1:1](https://www.mercadopago.com.br/developers/en/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace).

A página de integração foi lida integralmente nesta tarefa. Ela documenta o access token OAuth do vendedor no backend. Para Checkout Pro, a comissão usa `marketplace_fee` em `/checkout/preferences`. Para Checkout Transparente/Payments API, usa `application_fee` em `/v1/payments`. O exemplo documentado envia `transaction_amount` e `application_fee` numéricos. A tarifa do próprio Mercado Pago e a comissão marketplace são componentes distintos.

O split documentado é entre vendedor e marketplace. Isso não estabelece um terceiro repasse automático ao motoboy. O código deve separar a reserva/remuneração do entregador, e nunca chamar saldo virtual de dinheiro transferido. Nesta implementação, um repasse real será realizado fora do aplicativo e depois registrado/conferido pelo administrador; nenhuma transferência automática foi autorizada com destinatário e valor específicos.

A documentação informa que estornos reduzem proporcionalmente as parcelas do vendedor e marketplace; falta de saldo do vendedor pode impedir estorno integral. Por isso, cancelar transporte não pode ser tratado como estorno financeiro já executado.

A documentação acima sustenta o uso da Payments API com `application_fee` para novos pagamentos. Não constitui evidência de que um pagamento real deste projeto tenha sido gerado, aprovado ou dividido corretamente. Isso ainda requer teste controlado com credenciais, conta recebedora e webhook reais, sem confundir mocks com operação financeira.

## Pix da fatura (Orders API)

Documentação oficial: https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/payment-integration/pix — consulta em 6/10/2026. `payer.email` é obrigatório; documento de identificação não aparece como obrigatório no exemplo Pix. A emissão utiliza o e-mail da sessão autenticada, não uma alegação do body, e reconsulta `/v1/orders/{id}` antes de registrar. O perfil da conta usa https://api.mercadolibre.com/users/me.
