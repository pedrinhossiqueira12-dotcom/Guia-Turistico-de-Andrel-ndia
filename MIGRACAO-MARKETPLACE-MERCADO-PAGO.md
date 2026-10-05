# Migração para comissão por pedido — Mercado Pago

## Estado atual

A primeira etapa foi preparada sem ativar cobranças reais:

- criado o modelo de recebedores Mercado Pago;
- criado o modelo de pedidos e itens com snapshot dos produtos;
- criada a comissão fixa de 5% sobre produtos;
- entrega permanece fora da base da comissão;
- tarifa do provedor fica registrada separadamente e é atribuída ao comércio;
- tabelas privadas não são acessíveis diretamente por `anon` ou `authenticated`;
- nenhum token privado ou credencial foi incluído no repositório.

## Regra financeira

```text
subtotal_produtos = soma dos itens
comissao_plataforma = arredondar(subtotal_produtos × 5%)
total_cliente = subtotal_produtos + entrega
repasse_bruto_comercio = subtotal_produtos - comissao_plataforma + entrega
repasse_liquido_comercio = repasse_bruto_comercio - tarifa_mercado_pago
```

O cálculo deve ser repetido no backend a partir dos produtos vigentes. Valores enviados pelo navegador são apenas uma intenção do pedido.

## Próxima etapa

Antes de criar o checkout real, será necessário concluir o onboarding de marketplace do Mercado Pago para cada comércio e confirmar a modalidade de split disponível para a conta principal. Depois disso, a Edge Function poderá:

1. validar o catálogo e o recebedor;
2. reler produtos e preços no servidor;
3. criar o pedido com idempotência;
4. gerar Pix dinâmico;
5. enviar a regra de split;
6. processar webhook e consultar a ordem no Mercado Pago;
7. liberar o pedido somente quando o pagamento estiver confirmado.

A flag de produção deve permanecer desligada até o teste sandbox e a validação dos webhooks.
