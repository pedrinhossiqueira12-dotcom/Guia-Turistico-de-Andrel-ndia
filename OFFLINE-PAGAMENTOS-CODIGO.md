# Pagamentos presenciais com código de entrega

## Estado desta etapa

Esta etapa adiciona somente a base segura do fluxo offline. O checkout continua desligado porque a Edge Function exige:

```text
OFFLINE_CHECKOUT_ENABLED=true
```

Nenhum secret foi adicionado e nenhuma migration ou função foi publicada no Supabase de produção.

## Fluxo implementado

1. O pedido offline recebe `forma_pagamento` explícita: dinheiro, cartão de crédito, cartão de débito ou pagamento local/na entrega.
2. O backend consulta o catálogo, a modalidade, o método permitido e os produtos publicáveis.
3. O servidor calcula e congela:
   - subtotal dos produtos;
   - entrega;
   - total;
   - comissão de 5% somente sobre produtos.
4. O servidor cria um token privado do cliente e um código de entrega de seis dígitos.
5. Somente o hash do token e do código é salvo no banco.
6. O código fica válido por 48 horas e tem no máximo cinco tentativas.
7. A confirmação chama uma função SQL com `FOR UPDATE`, impedindo uso duplo ou corrida.
8. Somente depois da confirmação a comissão offline é registrada como aberta.
9. O fechamento mensal soma as comissões da competência.
10. A função de inadimplência pode marcar o fechamento bloqueado e bloquear o catálogo.

## Limitações ainda não ativadas

- A UI pública ainda não oferece o método offline.
- Ainda não há painel do vendedor/entregador para listar pedidos e confirmar o código.
- Ainda não há tela administrativa para gerar fechamento, registrar pagamento por Pix e reabrir após conferência.
- O bloqueio mensal ainda precisa ser chamado por uma rotina operacional agendada e auditada.
- A autenticação/ownership do painel de fulfillment deve ser implementada antes da ativação.
- A criação do pedido offline deve receber rate limit antes de produção.

## Regra financeira

```text
comissão = arredondar(subtotal_produtos_centavos × 5%)
total_cliente = subtotal_produtos + entrega
```

A entrega não compõe a comissão. Tarifas de máquina de cartão ou do provedor são despesas separadas.

## Ativação futura

Não ativar agora. Antes de configurar o secret, implementar e validar:

- painel de pedidos do comércio;
- confirmação do código no dispositivo do entregador;
- extrato mensal;
- pagamento da fatura por Pix;
- rotina de vencimento e bloqueio;
- auditoria de cancelamento e suporte;
- testes com banco efêmero e RLS;
- rate limit e observabilidade.
