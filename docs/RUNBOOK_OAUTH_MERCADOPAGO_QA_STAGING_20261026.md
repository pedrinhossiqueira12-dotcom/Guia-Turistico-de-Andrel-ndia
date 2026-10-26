# OAuth Mercado Pago — homologação isolada no STAGING
**Registro:** 26/10/2026 — PR #57 (Draft) — checkout financeiro não liberado.

## Evidência confirmada
- Projeto **STAGING** Supabase: `jbttwihctuibchhcyqtl`. PROD: `xdmbkflufsfqziixzpxc` **não modificado**.
- Deploy realizado no STAGING: `catalogo-oauth-qa-iniciar` v1, **ACTIVE**, `verify_jwt=true`. Código obtido da PR #57 e guardado por URL exata, opt-in explícito, proprietário autenticado e comércio permitido.
- Deploy realizado no STAGING: `mercadopago-oauth-callback` v1, **ACTIVE**, `verify_jwt=false` porque recebe redirecionamento GET do provedor sem JWT. Verifica `state` aleatório expirável, PKCE, uso único e exige `live_mode=false` somente quando modo QA estiver ativo. Não cria pagamentos.
- CI do commit `fbfc056ebcff5e0be36e62f9347755748deb2c08`: 13/13 verificações aprovadas. Suite Node 1.037/1.037; sete testes executáveis novos de OAuth com banco e provedor simulados passaram.
- Banco STAGING pós-deploy: `catalogo_oauth_estados=0`, `catalogo_recebedores=0`, `catalogo_pagamentos_v2=0`. Tabelas OAuth e recebedores com RLS ativo, sem privilégios explícitos a `anon`/`authenticated`.
- Os usuários proprietários dos catálogos `asaas-homologacao` e `asaas-cob02` existem no Auth do STAGING.
- **Não** foi possível realizar um smoke test HTTP de fora do Supabase nesta sessão: a resolução DNS externa falhou. Status ACTIVE + inspeção do código publicado **não** equivalem a teste de rede.
- **Não** houve troca real de código OAuth com Mercado Pago, nem conexão de vendedor real/de teste.

## Configuração necessária, SOMENTE no projeto STAGING
Configurar em **Supabase Dashboard > Edge Functions > Secrets**, usando a conta administradora, sem compartilhar valores no chat ou no repositório:

| Nome | Conteúdo/controle |
|---|---|
| `MP_OAUTH_QA_CLIENT_ID` | ID público da aplicação Mercado Pago destinada ao teste |
| `MP_OAUTH_QA_CLIENT_SECRET` | Secret correspondente; somente backend |
| `MP_OAUTH_QA_REDIRECT_URI` | `https://jbttwihctuibchhcyqtl.supabase.co/functions/v1/mercadopago-oauth-callback` |
| `MP_OAUTH_QA_ALLOWED_COMMERCE_ID` | Escolher **um** dos comércios aprovados: `asaas-homologacao` OU `asaas-cob02` |
| `MP_OAUTH_ENCRYPTION_KEY` | 64 caracteres hexadecimais de chave AES-256 **exclusiva do STAGING**, criada por gerenciador de segredos |
| `MP_OAUTH_QA_ENABLED` | **Permanecer falso/ausente** até validar aplicação, credenciais e redirecionamento do provedor. Só então alterar para `true` com autorização |
| `MARKETPLACE_CHECKOUT_ENABLED` | **Não habilitar**. A homologação do OAuth não autoriza emissão de Pix |

A URL de callback precisa estar cadastrada **exatamente** como Redirect URL na aplicação OAuth Mercado Pago. O backend do STAGING usa `test_token=true` ao trocar o código, somente no modo QA; exige `live_mode=false` antes de salvar token cifrado. Referência oficial: https://www.mercadopago.com.br/developers/pt/docs/security/oauth/creation.

## Próximo teste seguro, após aprovação da configuração
1. Com `MP_OAUTH_QA_ENABLED` **ainda falso**, confirmar externamente que o starter rejeita solicitações e que o callback sem state não completa vinculação. Não usar credenciais reais nem POST de pagamentos.
2. Confirmar PKCE habilitado no aplicativo Mercado Pago e URL de retorno idêntica; usar **apenas contas de teste**.
3. Validar uma sessão Auth do STAGING para o proprietário do catálogo permitido; usar `pages/catalogo-oauth-qa.html` em uma origem de testes aprovada, sem misturar sessões com o site de produção.
4. Mediante autorização, habilitar somente `MP_OAUTH_QA_ENABLED` no STAGING e realizar uma autorização OAuth de vendedor de teste. Se falhar, preservar a configuração segura e examinar logs **sem imprimir tokens**.
5. Confirmar via consulta agregada/read-only que o recebedor salvo é `oauth_live_mode=false`, que o state ficou consumido e que não apareceu registro em `catalogo_pagamentos_v2`. Não expor access/refresh tokens.
6. Após o teste, desabilitar a flag de QA. A eventual remoção de vínculos e limpeza de estados deve ser planejada separadamente, sem apagar dados arbitrariamente.

## Limites e impedimentos
- Não há ferramenta conectada nesta sessão para gravar/inspecionar valores de **Secrets** hospedados; esse passo permanece manual no Dashboard. Nunca colocar Secrets em mensagens ou commits.
- O endpoint `catalogo-pedido-pix` implantado no STAGING anteriormente **não** foi alterado neste deploy. A proteção adicional por `oauth_live_mode` está somente na PR #57; por isso **não** ligar checkout.
- As funções OAuth v1 não têm rota de criação de Pix, Asaas ou transferências. Deploy dessas novas rotas não substituiu versões anteriores de funções Asaas.
- PR #57 deve permanecer **Draft**, sem merge ou publicação em produção até revisão e aprovação de homologação.
