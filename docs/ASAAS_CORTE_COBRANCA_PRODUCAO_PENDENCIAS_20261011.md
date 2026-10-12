# Asaas — liberação definitiva da cobrança mensal: verificação de ambientes

**Data da auditoria:** 11/10/2026. **Escopo:** somente cobrança mensal dos comércios. **Não** libera Money Out nem saques automáticos.

## Resultado da verificação READ-ONLY em projetos existentes

| Item | Supabase testes `jbttwihctuibchhcyqtl` | Supabase produção `xdmbkflufsfqziixzpxc` |
| --- | --- | --- |
| Edge `catalogo-asaas-financeiro` | v44 ACTIVE | **não implantada** |
| `catalogo_asaas_clientes` | presente | ausente |
| `catalogo_asaas_emissoes` | presente | ausente |
| `catalogo_asaas_webhook_eventos` | presente | ausente |
| `catalogo_cobranca_preferencias` | presente | ausente |
| RPCs de registrar fatura, receber, claim e finalizar webhook | presentes | ausentes |
| Restrição do gateway | `asaas` e `mercadopago` | somente `mercadopago` |
| Leitura de pré-requisitos básicos | **aprovada** | **reprovada** |
| E2E bancário Asaas homologado nesta implantação | não | não |

**Comando para repetir sem risco:** `scripts/validacao-pagamentos/asaas-producao-readiness-readonly.sql`. Resultado de 11/10: **0 tabelas / 0 RPCs ausentes + gateway compatível no Sandbox; 4 tabelas / 4 RPCs ausentes + gateway incompatível em produção**.

A base de PRODUÇÃO tem histórico de migrações próprio e **não** é uma cópia da base de testes. Não aplicar um dump/restore do STAGING nem tentar copiar todas as migrations de teste automaticamente: algumas incluem controles de saque, MFA e experimentos exclusivos STAGING. Não alterar as faturas legadas Mercado Pago nem migrá-las implicitamente para Asaas.

## Etapa operacional 1 — prova bancária Sandbox (necessária antes de produção)

A estrutura já existe. O projeto de testes tem duas contas autenticadas confirmadas e um comércio com proprietário cadastrado. Porém, a conta autorizada à função administrativa QA deve ser configurada explicitamente no projeto, por decisão do operador.

1. No **Supabase do projeto de testes**, em Edge Functions / Secrets, conferir **sem revelar aqui** os nomes e estados das variáveis `ASAAS_API_KEY` (API key do **Sandbox**), `ASAAS_ENVIRONMENT=sandbox`, `ASAAS_BILLING_ENABLED=true`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_SANDBOX_ADMIN_USER_ID` (UUID do usuário QA autorizado da base de testes) e `ASAAS_SANDBOX_QA_CONFIRM_ENABLED=true`. Os nomes e flags não são segredos; **os valores da API key e dos tokens são**.
2. No painel **Asaas Sandbox**, registrar webhook para `https://jbttwihctuibchhcyqtl.supabase.co/functions/v1/catalogo-asaas-financeiro/webhook`, usando exatamente o token criado em `ASAAS_WEBHOOK_TOKEN`. Nunca usar tokens do Asaas de produção no Sandbox.
3. Concluir um pedido legítimo de teste no catálogo, gerar uma competência com comissão positiva e **fechá-la pelo fluxo normal**; não forçar saldo, cliente, pagamento nem crédito por SQL.
4. No preview do PR, usar `pages/entregas-operacao.html?asaas-sandbox=1` com a conta QA. Conferir fatura e QR, simular confirmação pelo botão de Sandbox (o servidor valida ID/referência/valor/pagador), observar o webhook na inbox e confirmar quitação **uma única vez**. Repetir webhook para validar idempotência e conferir que estorno/contestação bloqueiam Pix antigo. Não testar saque real.
5. **Guardar evidência verificável** do identificador de teste, situação antes/depois e webhook (sem chaves/tokens/documentos pessoais). Se faltar webhook real ou pagamento não for recebido, status permanece **HOLD**.

Documentação oficial: https://docs.asaas.com/docs/sandbox e https://docs.asaas.com/reference/confirmar-pagamento .

## Etapa operacional 2 — preparar implantação de cobrança em produção, SEM ativá-la

Somente após aprovação da etapa 1 e autorização expressa do proprietário:

1. Fazer backup/PITR e janela de manutenção, inventariar migrations de produção e validação de permissões. Montar sequência mínima forward-only de migrações da cobrança: restrição de gateway, tabelas e RPCs Asaas, política/termos e webhook durável. **Não ativar migrations de saques ou experimentos STAGING sem revisão**.
2. Executar novamente o gate SQL no clone de produção e na produção ao aplicar o esquema. Não prosseguir se `schema_pronto=false`.
3. Publicar Edge no projeto produtivo com flags de cobrança e saques desligadas. Confirmar `ASAAS_ENVIRONMENT=production`, `ASAAS_BILLING_ENABLED=false`, `ASAAS_PRODUCTION_BILLING_APPROVED=false`, `ASAAS_PAYOUTS_ENABLED=false` e `ASAAS_SANDBOX_QA_CONFIRM_ENABLED=false`. Criar chave Asaas e token de webhook **separados de Sandbox**, sem commit ou mensagem de chat.
4. Configurar webhook Asaas de produção com URL do projeto produtivo e revisar recuperação Cron/worker; testar assinatura/token, reentrega e idempotência.
5. Confirmar condições cadastrais/contratuais da conta Asaas produtiva, preços/tarifas e responsável financeiro. Só então, com autorização separada, ligar as flags de **cobrança de comércios** e liberar UI de Pix. Monitore primeira fatura real com valor e identidade confirmados.
6. **Nunca** ligar `ASAAS_PAYOUTS_ENABLED` durante este lançamento. Saques dos motoboys são outra decisão e dependem de regras e aprovações separadas.

## Decisão atual

- O esquema e o código **não estão liberados em produção**, intencionalmente.
- O obstáculo prioritário não é mais uma sequência de patches ou repetição de CI: é **configuração de credenciais e webhook de Sandbox**, **fatura aberta pelo fluxo legítimo**, **prova E2E do Asaas** e **autorização de implantação em produção**.
- Esta auditoria realizou apenas leituras SQL / listagens de funções e não efetuou transações.
