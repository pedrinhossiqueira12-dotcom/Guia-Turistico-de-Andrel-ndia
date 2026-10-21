# COB-06 — inventário não sensível de variáveis usadas por Edge Functions

**Captura por inspeção de código em 21/10/2026 — documentação somente na branch PR #39 Draft.** Objetivo: organizar uma futura recuperação da configuração, **sem acessar valores secretos, executar deploy, recuperar tokens ou alterar banco/Edge**.

## Escopo e limitações

- Supabase PRODUÇÃO: `xdmbkflufsfqziixzpxc`. Na consulta de metadados do Supabase foram encontradas **14 Edge Functions ACTIVE**. Todos os 14 diretórios possuem `index.ts` no repositório da PR #39. As versões da coluna abaixo são as versões **implantadas**; os nomes das variáveis foram coletados **exclusivamente do código candidato GitHub da PR**, não do ambiente publicado. Não se pode afirmar igualdade binária entre eles.
- Extração estática das chamadas literais `Deno.env.get('NOME')` nos 14 `index.ts`; a lista **não é exaustiva** para dependências importadas, funções auxiliares, configurações de painel ou acessos dinâmicos. A ausência de um nome não prova que a função não o usa.
- Em 13 dos 14 arquivos `index.ts` da branch aparecem `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`; a função `conta-usuario` também usa essas duas. Portanto, **todos os 14** têm essas duas referências literais. `SUPABASE_SECRET_KEYS` aparece em 13/14 (a exceção é `conta-usuario`). A mera referência não indica obrigatoriedade, valor preenchido nem comportamento produtivo.
- **Nenhum Secret foi lido**. Nunca divulgar valores em GitHub, chat, PowerShell com logging, prints ou arquivos de diagnóstico.

## Variáveis adicionais referenciadas por função na PR

| Edge PROD | Versão ativa Supabase | Variáveis adicionais do `index.ts` da PR |
|---|---:|---|
| `whatsapp-bot` | 90 | `ADMIN_USER_ID`, `COB06_GITHUB_BRANCH`, `COB06_GITHUB_WRITE_MAIN`, `GITHUB_TOKEN`, `WHATSAPP_API_VERSION`, `WHATSAPP_APP_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TOKEN`, `WHATSAPP_VERIFY_TOKEN` |
| `storage-cleanup` | 50 | Nenhuma além das comuns no `index.ts` |
| `catalogo-admin` | 52 | Nenhuma além das comuns no `index.ts` |
| `noticias-admin` | 50 | `CLOUDFLARE_PAGES_DEPLOY_HOOK` |
| `catalogo-pix-sandbox` | 45 | `MP_MODE`, `MP_TEST_ACCESS_TOKEN`, `MP_TEST_SELLER_ID`, `MP_TEST_WEBHOOK_SECRET` |
| `catalogo-pix-producao` | 52 | `MARKETPLACE_CHECKOUT_ENABLED`, `MP_OAUTH_CLIENT_ID`, `MP_OAUTH_REDIRECT_URI`, `MP_PRODUCTION_ENABLED`, `MP_PROD_ACCESS_TOKEN`, `MP_PROD_SELLER_ID`, `MP_PROD_WEBHOOK_SECRET` |
| `conta-usuario` | 32 | Nenhuma além das comuns no `index.ts` |
| `mercadopago-oauth-callback` | 36 | `MP_OAUTH_CLIENT_ID`, `MP_OAUTH_CLIENT_SECRET`, `MP_OAUTH_ENCRYPTION_KEY`, `MP_OAUTH_REDIRECT_URI`, `MP_PROD_SELLER_ID`, `SITE_URL` |
| `catalogo-pedido-pix` | 34 | `MARKETPLACE_CHECKOUT_ENABLED`, `MP_OAUTH_ENCRYPTION_KEY` |
| `mercadopago-marketplace-webhook` | 36 | `MP_MARKETPLACE_WEBHOOK_SECRET`, `MP_OAUTH_ENCRYPTION_KEY` |
| `catalogo-pedidos-offline-admin` | 31 | Nenhuma além das comuns no `index.ts` |
| `catalogo-pedido-offline` | 44 | `CATALOGO_COMPROVANTE_KEY`, `MP_OAUTH_ENCRYPTION_KEY`, `OFFLINE_CHECKOUT_ENABLED`, `SUPABASE_COMPROVANTE_KEY` |
| `catalogo-entregas` | 8 | `CATALOGO_DATA_ENCRYPTION_KEY`, `MP_OAUTH_ENCRYPTION_KEY` |
| `catalogo-fatura-pix` | 9 | `ADMIN_USER_ID`, `FATURA_PIX_ENABLED`, `MP_PLATFORM_ACCESS_TOKEN`, `MP_PLATFORM_SELLER_ID`, `MP_PLATFORM_WEBHOOK_SECRET` |

### Contexto financeiro exclusivamente STAGING / candidatos de cobrança

A função `catalogo-asaas-financeiro` encontra-se no **STAGING** `jbttwihctuibchhcyqtl` (v89 ACTIVE), **não** na produção. No `index.ts` candidato, referências relevantes para o corte de cobrança incluem: `ASAAS_API_KEY`, `ASAAS_BILLING_ENABLED`, `ASAAS_ENVIRONMENT`, `ASAAS_PRODUCTION_BILLING_APPROVED`, `ASAAS_PAYOUTS_ENABLED`, `ASAAS_SAQUE_VALIDACAO_ENABLED`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_WEBHOOK_WORKER_ENABLED`, `ASAAS_WEBHOOK_WORKER_TOKEN`.

Outras chaves **de teste/guarda no mesmo arquivo** (não pressupor ativação): `ASAAS_COB06_BAIXA_AUDITORIA_ADMIN_ENABLED`, `ASAAS_COB06_DUPLICIDADE_ADMIN_ENABLED`, `ASAAS_COB06_GET_ADMIN_READONLY_ENABLED`, `ASAAS_COB06_OBSERVACAO_ADMIN_ENABLED`, `ASAAS_COB06_PREPARACAO_ADMIN_ENABLED`, `ASAAS_SANDBOX_ADMIN_USER_ID`, `ASAAS_SANDBOX_QA_CONFIRM_ENABLED`, `ASAAS_SAQUE_VALIDACAO_TOKEN`, `CATALOGO_DATA_ENCRYPTION_KEY`, `MP_OAUTH_ENCRYPTION_KEY`. A Edge `catalogo-asaas-cob06-auditoria` (STAGING v48 ACTIVE) contém: `ASAAS_API_KEY`, `ASAAS_COB06_AUDITORIA_ISOLADA_ENABLED`, `ASAAS_COB06_GET_ADMIN_READONLY_ENABLED`, `ASAAS_COB06_GET_PERSISTENCIA_QA_ENABLED`, `ASAAS_COB06_NOVO_COMERCIO_QA_ID`, `ASAAS_COB06_NOVO_CORTE_QA`, `ASAAS_COB06_NOVO_LOTE_QA_ID`, `ASAAS_COB06_NOVO_QA_PREFLIGHT_ENABLED`, `ASAAS_COB06_NOVO_VALOR_QA_CENTAVOS`, `ASAAS_COB06_STAGING_ADMIN_UID`, `ASAAS_ENVIRONMENT`.

**Não copiar valores de STAGING para produção**, não habilitar rotas de saque e não assumir que `ASAAS_BILLING_ENABLED` ou `ASAAS_PRODUCTION_BILLING_APPROVED` já foram configuradas. Chave/ambiente Asaas produtivos, webhook, permissões e eventual cron requerem verificação e autorização específicas COB-07 após COB-06.

## Procedimento seguro de verificação futura, sem extrair segredos

1. No destino de recuperação e somente após isolamento, confirmar no Dashboard a **existência e o nome** das configurações necessárias para cada serviço conforme o código realmente publicado, incluindo as dependências importadas. Nunca exportar valores para este documento.
2. Identificar responsáveis e procedimento de reemissão por integração (Supabase, Mercado Pago, Asaas, WhatsApp, GitHub, Cloudflare) e outras configurações: Auth/SMTP, URLs de redirecionamento, DNS, políticas de Storage, cron, webhooks. Os **estados efetivos** desses provedores não foram auditados aqui.
3. Manter serviços externos desligados no clone. Preparar endpoint de webhook isolado/sem envio e credenciais exclusivas de teste; não reutilizar tokens produtivos em clone.
4. Validar equivalência de fonte, contrato de rota, `verify_jwt` e autenticação própria, versões de dependências, RLS e permissões. `verify_jwt=false` por si só **não** significa ausência de segurança interna: exige auditoria do handler.
5. Qualquer instalação, migração, edição de Secrets, DNS, Edge, cron, Pix ou alteração de produção continua **fora desta etapa** e exige autorização específica. Não operar os endpoints produtivos como teste de recuperação.

**Estado do gate:** inventário de referências preparado; presença e restauração efetivas das configurações operacionais **PENDENTES**. **COB-06 HOLD / PR #39 Draft**.
