# Asaas Sandbox — autorização de saque por Webhook

Implementado na branch `feat/asaas-faturas-saques-seguros`. **NÃO ativar em produção**.
Esta camada é **diferente** do Webhook financeiro `/webhook` (eventos `TRANSFER_DONE`, etc.).

Referência oficial: https://docs.asaas.com/docs/mecanismo-para-validacao-de-saque-via-webhooks

## Endpoints

- Validação de saques (somente sandbox):
  `https://jbttwihctuibchhcyqtl.supabase.co/functions/v1/catalogo-asaas-financeiro/saque-autorizacao`
- Eventos financeiros já existentes:
  `https://jbttwihctuibchhcyqtl.supabase.co/functions/v1/catalogo-asaas-financeiro/webhook`

**Nunca** trocar a URL de eventos financeiros pela URL de autorização.

## Pré-requisitos (manuais)

1. Manter `ASAAS_ENVIRONMENT=sandbox`, `ASAAS_PAYOUTS_ENABLED=false` até iniciar teste supervisionado.
2. Em Supabase STAGING > Edge Functions > Secrets, criar:
   - `ASAAS_SAQUE_VALIDACAO_TOKEN`: valor aleatório longo (pelo menos 32 caracteres), **diferente** do `ASAAS_WEBHOOK_TOKEN`; nunca salvar no GitHub ou compartilhar em capturas;
   - `ASAAS_SAQUE_VALIDACAO_ENABLED=false` inicialmente.
3. Em Asaas Sandbox > menu do usuário > Integrações > Mecanismos de segurança > Validação de saque via Webhook:
   - informar a URL `/saque-autorizacao` acima;
   - informar **exatamente o token** cadastrado em `ASAAS_SAQUE_VALIDACAO_TOKEN`, campo `asaas-access-token`;
   - informar um e-mail de contato para falhas.
4. **Somente quando concluir os testes negativos** e confirmar o Webhook corretamente configurado, ativar
   `ASAAS_SAQUE_VALIDACAO_ENABLED=true` e `ASAAS_PAYOUTS_ENABLED=true` no STAGING.
5. Não ativar validação de transações solicitadas pelo painel do Asaas se quiser autorizar somente saques originados pela API Guia; operações desconhecidas sempre recebem `REFUSED`.
6. O Asaas documenta que o mecanismo de autorização permite dispensar a autenticação por Token SMS sob os mecanismos de segurança configurados. Confirmar a exigência específica com o Asaas antes de alterar o Token SMS; não desligar outras proteções sem homologação.

## Fluxo e verificações

1. O motoboy autenticado solicita um saque no Guia; o servidor reserva créditos elegíveis.
2. Antes do `POST /transfers`, a Edge salva no banco um HMAC do tipo e da chave Pix utilizada. A chave em si continua criptografada no perfil e não é armazenada em texto no saque.
3. O Asaas devolve o ID da transferência; a Edge o vincula ao saque com `externalReference = saque_id`.
4. O Asaas envia um `POST` com `type: "TRANSFER"`, `transfer.id`, `transfer.value`, `transfer.operationType`, `transfer.externalReference` e a chave Pix do favorecido.
5. A Edge valida o header com token exclusivo, tipo Pix, existência e estado da reserva, ID da transferência, referência, valor e HMAC do destino de Pix.
6. A Edge consulta `GET /v3/transfers/{id}` no Asaas e exige **correspondência independente** do identificador, valor, destino e referência.
7. Confere cadastro ativo do motoboy, aptidão e itens financeiros reservados com financiamento comprovado.
8. Salva `APPROVED` ou `REFUSED` em `catalogo_asaas_validacoes_saque`, de modo idempotente (chave saque+transferência). Se qualquer evidência estiver ausente, recusa.
9. A aprovação **não** baixa o crédito. A liquidação requer `TRANSFER_DONE` e `GET` bancário de status `DONE` na conciliação atual.

### Situações recusadas

- Token incorreto (401); token ausente ou flag desativada (não aprova);
- Operação `BILL`, `PIX_QR_CODE`, `PAYMENT_SPLIT`, desconhecida ou fora do Guia;
- Transferência ausente, referência, ID, valor, modalidade ou destino diferentes;
- Chave Pix ausente do payload ou da consulta ao provedor;
- Motoboy suspenso, em análise, sem crédito disponível ou sem cobertura da fatura;
- Saque já pago, estornado ou enviado para revisão.

Em falha transitória de banco/Asaas, não aprovar; a integração deve permitir a repetição do Webhook e alertar a administração. O Asaas pode cancelar após três falhas.

### Importante — transferência prévia de R$ 2,00

O saque `eee2dc83-1511-4c5b-97af-21358126f4c2` já está em `enviado` e aguardando Token SMS. Foi criado **antes** do snapshot de destino. **Não autorizá-lo retroativamente**, não liberar a reserva manualmente nem reenviar `POST /transfers`. Solicitar ao suporte a autorização ou cancelamento dessa operação; somente após conciliação usar nova transferência de homologação.

## Homologação antes de liberar Token SMS

- [ ] Verificar que as tabelas e o campo HMAC existem somente em STAGING.
- [ ] Sem flags/token: a URL de autorização não aprova operações.
- [ ] Token incorreto: resposta 401, nenhuma decisão gravada.
- [ ] Tipo não `TRANSFER` ou ID estranho: `REFUSED`, sem movimentação.
- [ ] Transferência legítima com novo saque, chave Pix fictícia e saldo: testar `APPROVED`, sem repasse antecipado.
- [ ] Reenvio idêntico: resposta idempotente, 1 registro de decisão.
- [ ] Valor ou chave divergente: `REFUSED`, sem movimentação.
- [ ] Desabilitar autorizações se houver falha de verificação; continuar consultando o status dos saques já enviados.
- [ ] Receber `TRANSFER_DONE` e validar o repasse, crédito `pago` e saldo correto; testar `FAILED` e `CANCELLED`.
- [ ] Após homologação, voltar `ASAAS_PAYOUTS_ENABLED=false` e `ASAAS_SAQUE_VALIDACAO_ENABLED=false` até abertura oficial.

Migração: `supabase/pending-migrations/20261009100000_asaas_validacao_saque_webhook.sql`.
A migração foi aplicada no projeto STAGING `jbttwihctuibchhcyqtl`, não em PROD `xdmbkflufsfqziixzpxc`. Não reaplicar a migração em STAGING.

## Observação sobre a auditoria

Somente a decisão e motivo genérico são persistidos. Logs não contêm chaves Pix, credenciais ou dados bancários. Alterar a chave criptográfica exige plano de migração; snapshots HMAC de saques pendentes anteriores à troca deixam de ser verificáveis.
