# OAuth Mercado Pago — homologação isolada no STAGING
**Registro:** 26/10/2026 — PR #57 (Draft) — checkout financeiro não liberado.

## Evidência confirmada
- Projeto **STAGING** Supabase: `jbttwihctuibchhcyqtl`. PROD: `xdmbkflufsfqziixzpxc` **não modificado**.
- Deploy realizado no STAGING: `catalogo-oauth-qa-iniciar` v3, **ACTIVE**, `verify_jwt=true`. Código obtido da PR #57 e guardado por URL exata, opt-in explícito, proprietário autenticado e comércio permitido.
- Deploy realizado no STAGING: `mercadopago-oauth-callback` v2, **ACTIVE**, `verify_jwt=false` porque recebe redirecionamento GET do provedor sem JWT. Verifica `state` aleatório expirável, PKCE, uso único e exige `live_mode=false` somente quando modo QA estiver ativo. Não cria pagamentos.
- CI do commit `fbfc056ebcff5e0be36e62f9347755748deb2c08`: 13/13 verificações aprovadas. Suite Node 1.037/1.037; sete testes executáveis novos de OAuth com banco e provedor simulados passaram.
- Banco STAGING pós-deploy: `catalogo_oauth_estados=0`, `catalogo_recebedores=0`, `catalogo_pagamentos_v2=0`. Tabelas OAuth e recebedores com RLS ativo, sem privilégios explícitos a `anon`/`authenticated`.
- Os usuários proprietários dos catálogos `asaas-homologacao` e `asaas-cob02` existem no Auth do STAGING.
- Smoke test HTTP real executado com sucesso no GitHub Actions (sem credenciais privadas): callback com erro OAuth = HTTP 400; início OAuth sem autenticação = HTTP 401; início OAuth com chave pública do STAGING = HTTP 503. Evidência: https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/40393836115/job/121821508317. O HTTP 503 confirma que a função **não autoriza o início do OAuth nesta configuração**, mas **não identifica qual variável de QA está ausente**. Não é prova de que a flag específica esteja falsa.
- **Não** houve troca real de código OAuth com Mercado Pago, nem conexão de vendedor real/de teste.
- CI da mudança do status bloqueado: commit `c02b1a787c24acb6fefa1af43f18a3b8e16c3b8b`, 13/13 PASS. A conferência HTTP pública foi automatizada em `.github/workflows/staging-oauth-deny-smoke.yml`.

## Configuração necessária, SOMENTE no projeto STAGING
Configurar em **Supabase Dashboard > Edge Functions > Secrets**, usando a conta administradora, sem compartilhar valores no chat ou no repositório:

| Nome | Conteúdo/controle |
|---|---|
| `MP_OAUTH_QA_CLIENT_ID` | ID público da aplicação Mercado Pago destinada ao teste |
| `MP_OAUTH_QA_CLIENT_SECRET` | Secret correspondente; somente backend |
| `MP_OAUTH_QA_REDIRECT_URI` | `https://jbttwihctuibchhcyqtl.supabase.co/functions/v1/mercadopago-oauth-callback` |
| `MP_OAUTH_QA_ALLOWED_COMMERCE_ID` | Escolher **um** dos comércios aprovados: `asaas-homologacao` OU `asaas-cob02` |
| `MP_OAUTH_QA_ENCRYPTION_KEY` | **Nova chave exclusiva para tokens OAuth de teste**, 64 caracteres hexadecimais (32 bytes AES-256). Não reutilizar nem substituir `MP_OAUTH_ENCRYPTION_KEY`. |
| `MP_OAUTH_QA_ENABLED` | **Permanecer falso/ausente** até validar aplicação, credenciais e redirecionamento do provedor. Só então alterar para `true` com autorização |
| `MARKETPLACE_CHECKOUT_ENABLED` | **Não habilitar**. A homologação do OAuth não autoriza emissão de Pix |

A URL de callback precisa estar cadastrada **exatamente** como Redirect URL na aplicação OAuth Mercado Pago. O backend do STAGING usa `test_token=true` ao trocar o código, somente no modo QA; exige `live_mode=false` antes de salvar token cifrado. Referência oficial: https://www.mercadopago.com.br/developers/pt/docs/security/oauth/creation.

## Próximo teste seguro, após aprovação da configuração
1. Com `MP_OAUTH_QA_ENABLED` **ainda falso**, confirmar externamente que o starter rejeita solicitações e que o callback sem state não completa vinculação. Não usar credenciais reais nem POST de pagamentos.
2. Confirmar PKCE habilitado no aplicativo Mercado Pago e URL de retorno idêntica; usar **apenas contas de teste**.
3. Validar uma sessão Auth do STAGING para o proprietário do catálogo permitido; usar `pages/catalogo-oauth-qa.html` em uma origem de testes aprovada, sem misturar sessões com o site de produção.
4. Mediante autorização, habilitar somente `MP_OAUTH_QA_ENABLED` no STAGING e realizar uma autorização OAuth de vendedor de teste. Se falhar, preservar a configuração segura e examinar logs **sem imprimir tokens**.
5. Confirmar via consulta agregada/read-only que o recebedor salvo é `oauth_live_mode=false` **e status `bloqueado`**, que o state ficou consumido e que não apareceu registro em `catalogo_pagamentos_v2`. Não expor access/refresh tokens. **Nunca alterar o status de teste para `ativo`.**
6. Após o teste, desabilitar a flag de QA. A eventual remoção de vínculos e limpeza de estados deve ser planejada separadamente, sem apagar dados arbitrariamente.

## Limites e impedimentos
- Não há ferramenta conectada nesta sessão para gravar/inspecionar valores de **Secrets** hospedados; esse passo permanece manual no Dashboard. Nunca colocar Secrets em mensagens ou commits.
- O endpoint `catalogo-pedido-pix` implantado no STAGING anteriormente **não** foi alterado neste deploy. A proteção adicional por `oauth_live_mode` está somente na PR #57; por isso **não** ligar checkout.
- As funções OAuth (starter v3, callback v2) não têm rota de criação de Pix, Asaas ou transferências. Deploy dessas novas rotas não substituiu versões anteriores de funções Asaas.
- PR #57 deve permanecer **Draft**, sem merge ou publicação em produção até revisão e aprovação de homologação.

## Proteção adicional contra checkout antigo (revisada em 26/10/2026; implantada na v2)
- A Edge `catalogo-pedido-pix` **v78**, efetivamente publicada no STAGING, rejeita recebedores com `status != 'ativo'`, mas ainda não lê `oauth_live_mode`.
- Por isso o callback OAuth do STAGING agora registra a conta de teste como `status='bloqueado'`, impedindo que a função Pix v78 a considere elegível, mesmo se uma flag global mudar por engano.
- O banco confirma a existência de `bloqueado` no CHECK `catalogo_recebedores_status_check`. O caminho de produção do callback preserva `status='ativo'`.
- A proteção mais forte (checagem adicional de `oauth_live_mode=true` dentro do endpoint Pix) continua exclusivamente no código da PR #57. Não substituir a função Pix v78 sem revisão específica.
- O status bloqueado em QA significa **autorização armazenada para auditoria**, não habilitação de recebimentos. A interface comercial normal não deve declarar esse recebedor pronto para Pix.
- Observação de idempotência: a função Pix pode salvar um **pedido local `aguardando_pagamento` / `pendente`** antes de verificar se o recebedor está bloqueado. Esse registro não é pagamento: para recebedor de QA bloqueado, a chamada deve devolver HTTP 409 **antes de POST ao Mercado Pago**; `payment_id` e `pix_codigo` ficam vazios. O teste em `tests/catalogo-v2-pix-endpoints.test.cjs` verifica essa distinção. Não excluir automaticamente reservas pendentes sem reconciliação.
- A coluna legada `catalogo_recebedores.percentual_plataforma` permanece com CHECK/default de **5%**. A comissão operacional V2 de **7%** é calculada pela RPC `catalogo_fluxo_precificar` e usada como `application_fee` no checkout; não atualizar o legado como substituto da validação da RPC.

## Diagnóstico privado de configuração OAuth (starter v3)
- A função `catalogo-oauth-qa-iniciar` possui uma segunda ação: `verificar_configuracao_qa`. Ela exige JWT de usuário válido **e** valida que o usuário é proprietário do catálogo solicitado e que a publicação está ativa. Não requer que o modo QA já esteja habilitado.
- Retorno ao proprietário: `configuracao_pronta` (boolean) e `pendencias` (nomes dos parâmetros) — **sem valores de Secrets, tokens nem credenciais**. Verifica Client ID numérico, presença do Client Secret, URL de callback exata, allowlist do comércio, chave AES hex de 64 caracteres, flag QA e checkout financeiro desligado.
- O próprio início OAuth agora exige Client Secret e chave AES presentes, além das condições anteriores. A função continua recusando tentativas `iniciar_conexao_qa` incompletas com HTTP 503.
- A interface `pages/catalogo-oauth-qa.html` + `js/catalogo-oauth-qa.js` consulta esse diagnóstico após autenticação e só libera o botão de conectar quando o backend indicar disponibilidade. É uma medida de UX adicional, **não** substitui a validação no servidor.
- Evidência de teste isolado: novos testes HTTP simulados de diagnóstico (sessão inválida, proprietário diferente, ambiente incompleto, checkout habilitado) aprovados; suíte Node 1.041/1.041.
- Evidência HTTP hospedada para o starter v2: callback com erro = 400, inicio anônimo = 401, inicio com chave pública e sem habilitação = 503, diagnóstico com chave pública sem sessão de usuário = **401**. Job https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/40396240571/job/121829924397.
- A configuração real de Secrets **não foi lida**; o teste 503 não prova qual flag ou Secret está faltando. Para conhecer as pendências reais é necessário que o proprietário faça login no STAGING e clique em **Conferir configuração de homologação**.
- **Não realizar OAuth real até que o administrador confira a configuração e habilite o fluxo de forma consciente.** Nenhum Pix deve ser emitido no teste OAuth.

## URL oficial de autorização OAuth e CI (atualizado em 26/10/2026)
- Corrigido o destino da função de início para `https://auth.mercadopago.com/authorization`, conforme a [documentação oficial OAuth](https://www.mercadopago.com.br/developers/pt/docs/security/oauth/creation). O código anterior apontava para `auth.mercadopago.com.br` (domínio não documentado).
- Função `catalogo-oauth-qa-iniciar` **v3 ACTIVE** publicada no STAGING e código conferido após o deploy. Callback de QA continua v2; checkout Pix permanece v78, sem alterações.
- Teste executável de geração de URL/PKCE ajustado para exigir `auth.mercadopago.com`.
- Smoke CI de negação com chave pública aceita **401 ou 503**: ambos rejeitam um cliente sem sessão de usuário. Isso evita falhar em uma habilitação válida da configuração OAuth de QA. HTTP 200 continua inadmissível no smoke sem sessão.
- Este ajuste não prova a aceitação de credenciais pelo Mercado Pago: nenhum vendedor foi autenticado nem foi trocado código OAuth real. Continuar sem habilitar checkout financeiro.

## Chave exclusiva de QA — preservar dados históricos do STAGING (26/10/2026)
- Foi constatado por consultas agregadas que o STAGING contém **7 pedidos com códigos de entrega cifrados** e nenhum recebedor OAuth ainda cadastrado. Não ler os conteúdos nem alterar o segredo legado.
- O dashboard mostra que `MP_OAUTH_ENCRYPTION_KEY` já existe, porém o diagnóstico anterior o marcava pendente (valor ausente ou não conforme o formato hexadecimal esperado). **Não sobrescrever o segredo existente.**
- A partir desta correção, os dois handlers OAuth em STAGING exigem `MP_OAUTH_QA_ENCRYPTION_KEY` separado. O callback cifra **apenas** tokens de vendedores de teste usando esta nova chave; o fluxo de produção no código continua usando o segredo legado `MP_OAUTH_ENCRYPTION_KEY`.
- Gerar a nova chave localmente com um gerador criptográfico seguro de 32 bytes, codificar como **64 caracteres hexadecimais** e armazená-la **somente** em Supabase STAGING → Edge Functions → Secrets. Nunca enviar valores via chat nem salvar em git.
- O checkout do STAGING usa a chave legada e **não pode** usar recebedores QA: permanecem com `status='bloqueado'` e `oauth_live_mode=false`. `MARKETPLACE_CHECKOUT_ENABLED` deve continuar desligado.
- Até criar o novo segredo e habilitar conscientemente `MP_OAUTH_QA_ENABLED`, o botão de autorização permanecerá desabilitado. A verificação exibirá os nomes `MP_OAUTH_QA_ENCRYPTION_KEY` e `MP_OAUTH_QA_ENABLED` como pendentes.
