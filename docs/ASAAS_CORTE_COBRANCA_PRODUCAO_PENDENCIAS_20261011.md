# Asaas — liberação definitiva da cobrança mensal: verificação de ambientes

**Data da auditoria:** 11/10/2026. **Escopo:** somente cobrança mensal dos comércios. **Não** libera Money Out nem saques automáticos.

## Atualização de 12/10/2026 — COB-05 aprovada, início da COB-06 SEM implantação

**COB-05 concluída e auditada:** Asaas Sandbox produziu `PAYMENT_CREATED` verdadeiro para cobrança fictícia pendente `pay_z7ei9tof446wxbjo`, R$5. A integração registrou erro de vínculo local não existente, usou backoff e recuperou automaticamente o mesmo evento em três tentativas. Cron `jobid=5/runid=53` às 18:04 UTC e `net._http_response.id=50` **HTTP 200, `processados=1,em_erro=0`**; evento `concluido_em=18:04:03.435282 UTC`. A execução 18:02 mostrou `em_erro=1`, 18:06 mostrou `processados=0`; nenhuma duplicação. O ensaio não recebeu pagamento; 0 cobranças de laboratório foram registradas no financeiro local, fatura anterior paga e saldo de motoboy disponível sem repasse. Evidência canônica registrada na seção COB-05 de `docs/BACKLOG_FINANCEIRO_PR39_EXECUCAO.md`.

**Gate `scripts/validacao-pagamentos/asaas-producao-readiness-readonly.sql` reexecutado sem mutação nos dois bancos em 12/10/2026:**

| Métrica | STAGING `jbttwihctuibchhcyqtl` | PRODUÇÃO `xdmbkflufsfqziixzpxc` |
|---|---|---|
| `schema_pronto` | **true** | **false** |
| Tabelas faltando | 0 | **4** |
| RPCs faltando | 0 | **4** |
| Restrição gateway Asaas + Mercado Pago | compatível | **incompatível** |
| Gatilho proteção exclusão física `catalogo_historico_guard_delete` | ativo | **ausente** |
| Gatilho `catalogo_encerramento_sem_reabertura` | ativo | **ausente** |
| Gatilho `catalogo_encerramento_sem_republicacao` | ativo | **ausente** |
| Edge `catalogo-asaas-financeiro` | homologada em Sandbox | **não encontrada** |

As quatro tabelas ainda ausentes de PRODUÇÃO são `catalogo_asaas_clientes`, `catalogo_asaas_emissoes`, `catalogo_asaas_webhook_eventos`, `catalogo_cobranca_preferencias`; faltam as RPCs `catalogo_asaas_registrar_fatura`, `catalogo_asaas_webhook_claim`, `catalogo_asaas_webhook_finalizar`, `catalogo_asaas_webhook_receber`. Todos os nomes foram confirmados pela própria consulta do catálogo do PostgreSQL.

**Implicação de segurança COB-06:** a proteção de encerramento comercial do STAGING não está implantada em produção. A mera execução do gate de tabela/RPC **não detecta** os três gatilhos de proteção nem audita o caminho legado de excluir/despublicar. É obrigatório incluir essas barreiras na seleção mínima de migrações e testá-las em **clone descartável** da estrutura atual de produção, inclusive convivência de cobranças antigas Mercado Pago. Não copiar um banco STAGING sobre produção.

**Status:** COB-06 **iniciada apenas como auditoria e preparação**; esquema produtivo incompatível, sem merge, migrations, Secrets, deploy ou habilitação de cobrança/saque de produção. Passos seguintes: definir pacote seletivo forward-only e dependências, revisar privilégios/RLS e legado de exclusão, exercitar pacote em clone com testes de dados legados, estabelecer backup/rollback, depois solicitar autorização específica para COB-07. A cobrança de laboratório R$5 permanece **pendente no Sandbox**, identificada como teste: nunca pagar.

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
