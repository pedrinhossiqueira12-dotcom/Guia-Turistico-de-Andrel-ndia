# Guia Andrelândia — plano controlado para produção Asaas

Data: 2026-10-09. Status: **NÃO AUTORIZADO PARA PRODUÇÃO**.
Branch de trabalho: `feat/asaas-faturas-saques-seguros`, PR #39 (Draft).

## Evidência disponível

- Asaas Sandbox: fatura offline quitada, remuneração financiada e saque Pix de R$ 2,00.
- Saque de homologação `f22c7cdf-53c1-4ab7-95b1-eacdce0c57c7`:
  autorização `APPROVED`, transferência `DONE`, baixa interna `concluido`.
- Exatamente um repasse e remuneração `pago` para a transferência; testes
  de reenvio, rejeição tardia e tentativa de reabrir crédito pago passaram.
- Flags de saque e autorização desativadas no Sandbox pelo operador; o teste
  de saída sem token obteve `REFUSED` com motivo de mecanismo indisponível.
- **Sandbox não comprova permissão de produção nem autoriza envio de dinheiro.**

## Dependências externas — comprovação manual

- [ ] Confirmar aprovação cadastral e aptidão da conta Asaas de **produção**.
- [ ] Confirmar por escrito com Asaas autorização e limites para Pix enviados
      pela conta do Guia a entregadores terceiros (modelo de negócio,
      beneficiários, documentação, segurança e regras contratuais).
- [ ] Conferir tarifas efetivas de recebimento por cobrança Pix, tarifas de
      saques Pix, franquia e qualquer condição da conta específica.
- [ ] Definir quem assume a tarifa de transferência: plataforma, motoboy
      ou outro arranjo, com informação prévia transparente.
- [ ] Conferir saldo disponível Asaas e previsões de caixa antes de saques.
- [ ] Validar termos, privacidade/LGPD, consentimentos necessários, vínculo dos
      entregadores e regras de contestação/estorno com assessoria competente.

Referências: https://docs.asaas.com/docs/prepara%C3%A7%C3%A3o-para-produ%C3%A7%C3%A3o
https://docs.asaas.com/docs/mecanismo-para-validacao-de-saque-via-webhooks
https://docs.asaas.com/docs/transferencia-para-contas-de-outra-instituicao-pix-ted
https://central.ajuda.asaas.com/hc/pt-br/articles/32059618254875-Como-funcionam-as-taxas-e-a-gratuidade-para-transfer%C3%AAncias-Pix-no-Asaas

## Pendências técnicas antes de autorizar lançamento

- [ ] Revisão formal do código, segurança, políticas RLS e funções
      `SECURITY DEFINER` que movimentam créditos.
- [ ] Revisão da migração SQL e simulação completa em banco descartável com
      estrutura equivalente à de produção, incluindo rollback e backup.
- [ ] Implantar uma estratégia de alertas para falhas de Webhook, fila parada,
      saques em revisão, falta de saldo e cobranças duplicadas.
- [ ] Estabelecer limites operacionais de saque por pedido, por motoboy e por
      janela de tempo; aprovar limites antes de implementá-los.
- [ ] Definir tratamento financeiro se uma fatura for estornada depois de o
      crédito do motoboy já ter sido pago.
- [ ] Testar falhas de timeout/rede após `POST /transfers` e conciliação sem
      envio de segunda transferência.
- [ ] Confirmar que cobranças Mercado Pago existentes nunca viram
      financiamento disponível para o saque Asaas.
- [ ] Aprovar o procedimento de conciliação/contabilidade: baixa do motoboy
      ocorre exclusivamente após `GET /transfers/{id}` retornar `DONE`.
- [ ] Separar URL, chave API, tokens dos dois Webhooks e recursos Asaas para
      cada ambiente. Nunca reutilizar secrets de Sandbox em produção.
- [ ] Configurar os dois Webhooks produtivos em URLs distintas: eventos e
      validação de saques. Fazer teste de autenticação e idempotência.
- [ ] Concluir CI em PR revisado e registrar aprovação explícita de go-live.

## Ordem de implantação futura — requer autorização expressa

1. Manter branch de trabalho e PR sem merge; conferir migrações pendentes.
2. Obter comprovações comerciais/operacionais e definir as tarifas e limites.
3. Planejar janela, backup e aplicação das migrations, com revisão humana.
4. Configurar ambiente **produção**, credenciais e Webhooks separados, com
   flags `ASAAS_BILLING_ENABLED=false`,
   `ASAAS_PAYOUTS_ENABLED=false` e
   `ASAAS_SAQUE_VALIDACAO_ENABLED=false`.
5. Implantar somente com autorização; validar acesso, Webhooks e leituras
   sem criar Pix real. Não reutilizar URLs nem IDs de homologação.
6. Ativar emissão de faturas primeiro, sob janela monitorada e critérios
   de aceite. Pix do motoboy permanece desligado.
7. **Saques reais só com aprovação adicional e específica**, após adaptar
   a barreira de código que proíbe `POST /transfers` fora do Sandbox.
   Criar limites e revisão independente antes do primeiro pagamento real.

## Parada segura e recuperação

- Para suspender **novos saques**, usar `ASAAS_PAYOUTS_ENABLED=false`.
  Para suspender aprovações no Webhook, manter também
  `ASAAS_SAQUE_VALIDACAO_ENABLED=false`. Isso não cancela transferências
  já enviadas: reconciliação continua obrigatória.
- **Não desligar** o Webhook de eventos financeiros se existir cobrança ou
  transferência pendente; é essencial para confirmar estados finais.
- Em falha de rede/timeout, manter saldo reservado e consultar o Asaas,
  nunca reenviar automaticamente o mesmo Pix.
- Nunca apagar repasses, créditos, cobranças ou logs para "desfazer" operação.
  Estorno deve ser fluxo compensatório comprovado pelo provedor.

## Critérios de aceite

Nenhuma operação de produção foi disparada nesta preparação. Somente liberar
mediante: documentação Asaas/contratual confirmada, revisão de segurança,
migrações aprovadas, credenciais isoladas, limites definidos, monitoramento e
**autorização explícita do proprietário para produção**.
