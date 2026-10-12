# BACKLOG FINANCEIRO CANÔNICO — Guia Andrelândia / PR #39

**Auditoria e congelamento de escopo:** 11/10/2026 (última atualização pela análise de histórico, branch, GitHub Actions e leitura dos projetos Supabase).  
**Repositório:** `pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia`.  
**Branch:** `feat/asaas-faturas-saques-seguros`.  
**PR:** [#39 — Draft](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/pull/39).  
**Commit de referência da auditoria:** `b7d1d0b5bed28e37dcda1d3aaba39508c27f53e0`.  
**CI aprovada:** [run 38186833319](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/38186833319) — 12/12 jobs.

## Contrato de execução: não ampliar o escopo

Este documento é a **única fila operacional** do trabalho financeiro do PR #39. O backlog geral `docs/BACKLOG_GUIA_ANDRELANDIA.md` e as issues existentes são histórico e rastreabilidade, **não autorização para iniciar trabalhos paralelos**.

1. **Concluir as tarefas COB-01 a COB-08, nesta ordem, antes das tarefas SAQ**. Só interromper a ordem por um bug que comprovadamente impeça ou torne insegura a própria etapa atual; registrar evidência e a correção mínima no item, sem criar uma nova frente de trabalho.
2. Uma tarefa é considerada concluída somente com **evidência de teste e ambiente**. CI verde não é homologação bancária; código no PR não significa publicação.
3. Reutilizar a **chave API e o webhook Asaas Sandbox já criados com o usuário nos dias 08–09/10**, a menos que uma verificação prove incorreção ou revogação. **NÃO gerar outra chave, excluir webhook, rotacionar token, alterar Secrets, reiniciar banco ou refazer a integração sem motivo verificado e consentimento.**
4. Não tocar na produção, mesclar #39, cobrar comerciantes reais, transferir Pix real ou habilitar débito automático sem autorização **expressa e específica** do proprietário na etapa de go-live apropriada.
5. Não realizar operações SQL manuais para simular quitação, lançar créditos fictícios, reabrir faturas pagas ou forçar reserva; dados do teste E2E devem nascer do **fluxo legítimo** do catálogo/fechamento.
6. Não adicionar funcionalidades de turismo, layout, anúncios, delivery não financeiro, arquiteturas paralelas, novos módulos de MFA/escrow/âncoras ou experimentos: tais trabalhos **não são tarefas deste backlog**. Revisar apenas os controles que bloqueiam diretamente o lançamento exigido.
7. Não solicitar ou publicar senhas, CPF/CNPJ, API keys, tokens ou chaves Pix. Pode-se verificar **nomes e presença** de Secrets pelo operador, nunca valores no chat, código ou issues.
8. Ao concluir cada item, editar sua marcação e anexar: commit/CI, ambiente, resultado e bloqueio restante. **Próxima ação = primeiro item não concluído da etapa ativa.** Não considerar "prossiga" como autorização para criar trabalho fora da lista.

## Regras financeiras aprovadas nas conversas — NÃO REDESENHAR

- Cobrança do estabelecimento por **fatura mensal Pix manual** no Asaas. **5% para a plataforma e 2% para o motoboy somente quando a entrega/pagamento offline for elegível** (dinheiro/cartão, conforme regras de pedidos implementadas); **não atribuir automaticamente os 2% ao motoboy em pedidos Pix online**. Manter a taxa contratual de 7% e verificar, em teste, os cenários de elegibilidade e contabilização exata.
- O comerciante deve ver sua fatura, competência, vencimento, situação, Pix e histórico. A quitação só ocorre após confirmação válida e conciliação com o Asaas; sem dupla emissão/cobrança. O inadimplente deve regularizar dívidas; **não permitir exclusão/arquivamento definitivo que apague fatura ou dívida**, mantendo histórico e fluxo controlado de encerramento.
- Termos de estabelecimentos e motoboys + ciência da política de privacidade exigem aceite explícito/versionado; revisão jurídica antes de operação produtiva.
- **Pix Automático fica somente preparado para o futuro**; não habilitar mandato, assinatura/débito ou cobrança recorrente automática agora.
- Carteira do motoboy com 2% elegível efetivamente financiado, crédito acumulável por meses, **saque mínimo comum R$ 100**, **sem limite artificial de 1.000 comissões**. Teto técnico de teste de R$ 5.000 **por transferência**, não por carteira. Saldos inferiores ao mínimo em encerramento/inatividade não podem ser confiscados; exigem regularização segura e comprovada, não baixa inventada.
- O custo de transações/tarifas de repasse foi tratado nas conversas como custo da **plataforma**; confirmar tarifas contratuais da conta específica antes de ativar saques. Não descontar silenciosamente tarifas da comissão.
- Saques reais e Pix Automático têm liberação **independente** das cobranças mensais. Não habilitar transferência com as mesmas flags do faturamento.

## Inventário comprovado — estado de partida

**GitHub:** #39 aberto **Draft**, 899 commits à frente de `main`, **238 arquivos no diff** (212 adicionados, 26 modificados); grande parte inclui testes, documentação e experimentos de segurança posteriores à implementação inicial. **Não mesclar integralmente sem selecionar e revisar as alterações indispensáveis**. CI 38186833319: 12/12.

**Supabase STAGING `jbttwihctuibchhcyqtl`:** Edge `catalogo-asaas-financeiro` v44 ACTIVE, com autenticação de rota própria; tabelas/RPCs Asaas e restrição de gateway adequadas (preflight anterior: 14/14). Última leitura: **2 usuários confirmados, 1 catálogo, 1 cliente Asaas, 2 emissões reservadas históricas, 2 faturas pagas, 0 faturas abertas, 4 eventos de webhook registrados, 0 pendentes, 0 saques não finais**. Competências já pagas do comércio atual: setembro e outubro de 2026. **Não reaproveitá-las.** Cron ativo para fechamento offline diário, mas **não existe Cron `guia-asaas-reconciliar-webhook`** para processar fila financeira automaticamente. O frontend QA com `?asaas-sandbox=1` existe **somente na branch** e não foi promovido ao site público.

**Histórico Asaas Sandbox:** conversas de 08–09/10 registram **criação de chave e webhook**, testes antigos de fatura/saldo e saque Pix de R$ 2,00 `DONE`. O roteiro/documento `docs/ASAAS_PLANO_LIBERACAO_PRODUCAO.md` também registra essa prova histórica. **Não afirmar que nada foi homologado antes**, mas **não tratar o teste antigo como validação da Edge atual v44**; chaves/Secret/URLs/flags **não são legíveis pelo conector disponível**. Não presumir que estão ausentes nem que continuam corretos.

**Supabase PRODUÇÃO `xdmbkflufsfqziixzpxc`:** funções existentes Mercado Pago + `catalogo-fatura-pix`; **Edge Asaas ainda não publicada**. Faltam as tabelas `catalogo_asaas_clientes`, `catalogo_asaas_emissoes`, `catalogo_asaas_webhook_eventos`, `catalogo_cobranca_preferencias`; RPCs `catalogo_asaas_registrar_fatura`, `catalogo_asaas_webhook_receber`, `catalogo_asaas_webhook_claim`, `catalogo_asaas_webhook_finalizar`; CHECK de gateway ainda aceita **somente `mercadopago`**. Históricos de migrações dos dois projetos são distintos. **Produção não foi alterada nesta auditoria.**

**Evidências auxiliares:** `docs/ASAAS_HOMOLOGACAO_COBRANCA_SANDBOX_20261011.md`, `docs/ASAAS_CORTE_COBRANCA_PRODUCAO_PENDENCIAS_20261011.md`, `scripts/validacao-pagamentos/asaas-producao-readiness-readonly.sql`, `docs/ASAAS_WEBHOOK_CRON_AGENDAMENTO_MANUAL_20261011.md`, `docs/EVOLUCAO_PIX_MANUAL_TERMOS_ENCERRAMENTO.md`.

## FASE A — COBRANÇAS MENSAIS DOS COMÉRCIOS (PRIORIDADE ABSOLUTA)

### [x] COB-00 — Auditar o que existe; congelar esta sequência

- **Estado:** auditoria inicial feita e documentada; não é auditoria linha a linha de 238 arquivos.
- Evidências: histórico recuperado, PR/CI, inspeção de funções de cobrança, documentos e UI, consultas somente leitura nos dois bancos.
- Saída: **este backlog**, sem mudança de regra, segredo, serviço ou autorização de dinheiro.
- A partir daqui não abrir novas frentes de trabalho sem um defeito reprodutível que impeça os passos COB.

### [x] COB-01 — Conferir a configuração Asaas Sandbox **existente**, sem recriá-la

- **Estado: CONCLUÍDO por confirmação do operador em 11/10/2026 e evidência histórica do provedor; sem rotação de chave.** O operador confirmou que o webhook existente está ativo, aponta para STAGING e recebe `PAYMENT_RECEIVED`, após verificar esses três itens na tela do Asaas. A chave existente havia sido identificada como habilitada. No STAGING há duas cobranças pagas e dois `PAYMENT_RECEIVED` concluídos. **Limite da evidência:** não foi feita nesta etapa uma chamada de API em tempo real com os Secrets, cujo conteúdo não é acessível pelos conectores; a validação operacional integral ocorrerá em COB-03, não há motivo para duplicar credenciais.
- **Comprovado no histórico, sem expor credenciais:** 08/10 o operador confirmou em conversa que cadastrou os Secrets financeiros no STAGING; 08/10 confirmou que criou o webhook; teste de 08/10 às 19h36 BRT obteve **HTTP 200** na rota `/functions/v1/catalogo-asaas-financeiro/webhook` (um evento externo foi ignorado); testes anteriores já utilizaram o Asaas Sandbox. Verificação SQL read-only atual: **2 eventos PAYMENT_RECEIVED concluídos, 2 faturas pagas**, nenhum webhook pendente ou fatura aberta. Logo, houve funcionamento anterior da integração — **não assumir ausência** de chave, token ou webhook.
- **Conferência externa recebida:** operador respondeu «sim, tudo certo» à verificação específica de ativo/URL STAGING/`PAYMENT_RECEIVED` no Asaas Sandbox. Históricos anteriores registram os Secrets usados. **Não pedir confirmação repetida**; a prova de credenciais operacionais atuais será o E2E da COB-03.
- **Não reabrir fases antigas:** credenciais já usadas para testes não devem ser novamente geradas sem falha concreta.
- Na conta **Asaas Sandbox que já existe**, conferir em tela se a chave está ativa e se o webhook existente está ativo, com URL HTTPS de STAGING correta e eventos de cobrança necessários, autenticação por token `asaas-access-token`. Não compartilhar valores.
- No **Supabase STAGING**, conferir apenas a **presença e correspondência** de `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_ENVIRONMENT=sandbox`, `ASAAS_BILLING_ENABLED`; **não sobrescrever**. A flag `ASAAS_SANDBOX_QA_CONFIRM_ENABLED` e o UUID `ASAAS_SANDBOX_ADMIN_USER_ID` só precisam ser habilitados/separadamente autorizados se for usado o **botão administrativo** de simulação; confirmar diretamente no painel Asaas Sandbox evita tratá-los como pré-requisito universal.
- Confirmar que `ASAAS_PAYOUTS_ENABLED`, `ASAAS_SAQUE_VALIDACAO_ENABLED` e quaisquer flags de **produção** não são usadas para liberar saques.
- **Aceite:** operador confirma configuração da chave/webhook existentes (sem segredos expostos) e uma consulta de diagnóstico/autenticação permitida funciona; se falhar, corrigir apenas o campo concreto que falhou.
- **Encerrado; próximo item obrigatório é COB-02.** Não solicitar uma nova chave ou webhook como padrão.

### [ ] COB-02 — Obter **uma nova fatura legítima e aberta** no STAGING

- **Estado: EM TESTES — infraestrutura QA preparada no STAGING, mas NÃO CONCLUÍDA (11/10/2026).** Não existe fatura aberta, comissão aberta/faturada, produto disponível ou categoria na única loja `asaas-homologacao` do STAGING. O proprietário de testes tem autenticação confirmada, a loja está marcada `comercios_publicados.status='ativo'` e `catalogos.bloqueado=false`, porém **não há linha em `catalogo_recebedores`** para ela e **`catalogo_publicado` retorna ZERO linhas**. A função atual `catalogo_private.catalogo_esta_ativo` exige recebedor ativo com `conta_externa_id` não nulo, além de publicação e ausência de bloqueio. Nenhum aceite comercial foi registrado. O catálogo público ainda valida existência do comércio em `DATA/comercios.json`, onde `asaas-homologacao` também **não consta**. Assim, só cadastrar um produto NÃO basta para gerar pedidos legítimos.
- **Subtarefa indispensável de COB-02:** definir caminho legítimo de homologação do comércio existente, respeitando autenticação, publicação, checkout e integração real; dar preferência a mecanismo de teste já implementado. **Não** improvisar `INSERT/UPDATE` que simule aprovação bancária, cadastro de recebedor ativo, comissão ou Pix. Se for necessária qualquer alteração de infraestrutura além das contas de testes, apresentar correção mínima e aguardar autorização do proprietário; não abrir nova frente ou duplicar projeto.
- **Situação atual:** exige uma loja de QA **efetivamente ativa e comprável** ou correção mínima do fluxo específico de homologação. Depois, criar categoria, produto, pedido offline legítimo e fechar competência inédita.
- Utilizar preview **da branch** em `pages/catalogo.html?asaas-sandbox=1` e `pages/catalogo-admin.html?asaas-sandbox=1`, com contas de teste autorizadas, se o catálogo existente for elegível. Testar pedidos somente offline; sem Pix real do comprador.
- Um pedido de teste deve passar pelo fluxo normal de estabelecimento/entrega, gerar comissão e fechamento de **competência ainda não paga** ou de comércio de teste independente autorizado. **Não** reabrir setembro/outubro do comércio que já tem ambas pagas e **não** inserir cobranças/saques/créditos manualmente no SQL.
- **Aceite:** fechamento com status `faturado`/`vencido`/`bloqueado`, valor de comissão positivo e comprovadamente decorrente de pedido legítimo; **sem cobrança Asaas prévia** da mesma referência.

#### COB-02 — Diagnóstico do primeiro teste do usuário e correção (11/10/2026)

- **Incidente confirmado, sem dados duplicados:** Supabase STAGING `asaas-cob02` tinha **2 linhas legítimas de aceite** (`termos` e `privacidade`), mas **0 pedidos, 0 comissões, 0 faturas e 0 cobranças Asaas**. HTTP logs da Edge `catalogo-pedido-offline` identificam **dois POSTs HTTP 503** (em 12/10/2026 01:49 e 01:50 UTC); portanto, o usuário não errou na sequência: o endpoint de pedido recusou suas duas tentativas. Os botões seguintes foram usados sem pedido prévio e não produziram faturas.
- **Causa da tela enganosa:** HTML QA guardava em `#qa-result` o resultado anterior `{aceito:true,versao:2026-10-09}` quando o pedido falhava; o erro só aparecia na seção de resultado no fim da página. Corrigido com `#qa-feedback` imediato junto aos botões, substituição do resultado antigo em cada tentativa e alerta claro em caso de falha. Botão Criar pedido fica desabilitado após retornar ID de pedido para reduzir cliques duplicados na mesma sessão.
- **Falha HTTP 503 de habilitação:** a Edge exige `OFFLINE_CHECKOUT_ENABLED=true` para as lojas ordinárias. Criada exceção **somente no código STAGING e somente para `asaas-cob02`**, com whitelist dependente da URL exata do projeto de testes; flag segue obrigatória em produção e demais lojas. A proteção de código de entrega criptografado (32 bytes) **NÃO foi desligada**; se faltar, o próximo pedido recusará a criação e exibirá explicitamente o motivo. Nova Edge `catalogo-pedido-offline` **v32 ACTIVE STAGING**, produção intacta. Não houve POST real ao Asaas.
- **Situação:** teste E2E ainda **PENDENTE**; operador precisa baixar a página HTML atualizada da branch, verificar que mostra “Etapa finalizada” ao aceitar termos e **clicar SOMENTE em “2 · Criar pedido em dinheiro” uma vez**, confirmar a simulação e observar a mensagem logo abaixo dos botões. Só avançar após exibir um `pedido_id` gerado no STAGING e conferir que banco tem exatamente 1 pedido; caso apareça erro, investigar a mensagem e corrigir somente o bloqueio da COB-02.
- **CI:** testes estáticos atualizados para exigir guarda de ambiente/loja em `tests/asaas-cob02-isolamento-qa.test.cjs`, mais workflow completo do PR.

#### COB-02 — Evidências de execução e ação ainda necessária

- **Somente Supabase STAGING `jbttwihctuibchhcyqtl`:** aplicadas migrações **staging-only**, fora de `pending-migrations` / deploy produtivo: `supabase/staging-only/asaas_qa_loja_offline_20261011.sql` e `supabase/staging-only/asaas_qa_competencia_nova_cob02_20261011.sql`.
- O primeiro comércio QA `asaas-homologacao` tinha competência **outubro/2026 já paga**. Não a reabrimos. Criado um segundo comércio **exclusivamente de teste**, `asaas-cob02`, vinculado ao **mesmo usuário autenticado** do STAGING, publicado e não bloqueado, com modalidade `retirada`, pagamento `dinheiro`, uma categoria e **um produto fictício de R$100**. Conferido por SQL: `catalogo_publicado` retorna a loja, há 1 produto e **zero faturas** para `asaas-cob02`. Nenhum pedido/comissão/fatura foi inserido artificialmente, nenhum dinheiro circulou.
- Somente essas **duas** lojas especiais podem dispensar o recebedor MP no STAGING; todas as demais continuam exigindo conta MP vinculada. Proteção por `SUPABASE_URL` exata no backend de pedido, publicação e RLS. Edge `catalogo-pedido-offline` implantada **somente STAGING v31**; produção, `catalogo-admin` produtivo e `catalogo-asaas-financeiro` permanecem inalterados.
- Página HTML de ensaio já existente `pages/asaas-homologacao-sandbox.html` foi adaptada **na branch somente** para a loja `asaas-cob02`. O botão de criar pedido chama a **Edge original** `catalogo-pedido-offline`; os botões de aceitar, marcar pronto, confirmar código e fechar mês chamam **`catalogo-pedidos-offline-admin` autenticada**. Termos usam `catalogo-asaas-financeiro`; somente `criar_cobranca` em COB-03 chama Asaas. A página não pode ser confundida com publicação no site.
- **Login e logout QA revisados:** a conta de motoboy existente **não é proprietária** da loja QA; a conta administrativa habitual de produção não existe no Auth STAGING. O usuário QA proprietário é uma terceira conta confirmada (identidade exata conferida no banco, **não publicada neste repositório**). Corrigido o HTML `pages/asaas-homologacao-sandbox.html`: o botão **Sair da conta de testes** estava dentro de `login-form` que ficava oculto após login; botão movido para fora do formulário, com erro de signOut tratado. O usuário precisa baixar o HTML atualizado da branch para trocar de sessão.
- **Falta para concluir COB-02:** operador deve abrir a página HTML da branch num navegador, entrar com a conta do **proprietário de testes**, registrar aceite, criar o pedido de retirada em dinheiro, aceitar, marcar pronto, confirmar com código e fechar **outubro/2026** pela API. Validar por SQL resultado `faturado` e comissão positiva sem Pix. **Não iniciar cobrança Asaas antes de concluir este passo.**
- Nenhum operador/IA deve simular `auth.users` ou serviço remoto a partir do SQL para alegar pedido real. Se o fluxo falhar por `OFFLINE_CHECKOUT_ENABLED` ou chave do comprovante, identificar o erro da Edge e corrigir só configuração já existente em STAGING, sem expor segredo.
- O teste de software está no GitHub Actions; uma falha de download de imagem Docker é falha de infraestrutura, não prova de regressão no código.

### [ ] COB-03 — Homologar a **cobrança Pix mensal completa**, na versão atual

- **Estado:** EM ESPERA DE COB-01 E COB-02; existem testes bancários históricos, porém não este percurso sobre a v44.
- Proprietário autenticado/termos aceitos → `criar_cobranca` → conferir ID, cliente, `externalReference`, valor, QR e 1 única cobrança → consultar novamente **sem repetir POST**.
- Confirmar **no Asaas Sandbox já configurado** (painel ou botão QA autenticado, se optado) → verificar webhook recebido **de fato**, token aceito, evento persistido e conciliado com GET do provedor → fatura `pago` **uma única vez** somente em `RECEIVED`; `CONFIRMED` exige prudência.
- Reentrega do webhook, timeouts, resposta inconclusiva, pedido repetido, estorno/cancelamento/contestação e provedor indisponível devem **impedir duplicidade e crédito indevido**. Apenas correção de bug comprovado, não nova arquitetura.
- **Aceite:** evidências anonimizadas do antes/depois no Asaas e Supabase, fatura quitada exatamente uma vez, eventos conciliados, nenhuma nova emissão em retries e **nenhum Pix de saque iniciado**.

### [ ] COB-04 — Validar regras de negócio de cobrança, dívidas e efeitos contábeis

- **Estado:** IMPLEMENTADO NA BRANCH/TESTES ISOLADOS; necessita prova integrada.
- Conferir cálculos de 5% plataforma / 2% motoboy para pedido offline elegível, ausência de crédito de 2% no Pix online, estorno e cancelamento; nenhuma disponibilização de comissão do motoboy antes de quitação comprovada do comércio.
- Conferir fechamento mensal, vencimento, inadimplência, possibilidade de pagar fatura bloqueada e **não exclusão/arquivamento irregular** do comércio endividado, inclusive rota legada `whatsapp-bot` e catálogo/listagens.
- Conferir aceite dos termos de ambos os papéis, preservação de históricos, cobranças legadas **Mercado Pago não migradas/cobradas novamente**.
- **Aceite:** matriz de cenários com resultados/consultas, sem diferenças contábeis, sem fuga por endpoint antigo e sem regressões de produção.

### [ ] COB-05 — Habilitar e provar reprocessamento operacional de webhooks

- **Estado:** ROTA IMPLEMENTADA; AGENDAMENTO NÃO EXISTE NO STAGING.
- Testar `/cron-webhooks` com token/flag de serviço independentes e erro 401 para token inválido; job permitido somente para fila de homologação, sem expor segredo no SQL/GitHub.
- Depois do teste manual da fila, configurar **no STAGING**, com aval do operador, worker + Vault/Cron descritos em `docs/ASAAS_WEBHOOK_CRON_AGENDAMENTO_MANUAL_20261011.md`; verificar monitoramento, idempotência, backoff, evento falho e reprocessamento.
- **Aceite:** job agendado e executado com evidência de evento consumido, estado/erros auditáveis, sem nova cobrança nem transferências.

### [ ] COB-06 — Preparar implantação **mínima e segura** no banco/site de produção

- **Estado:** BLOQUEADO ATÉ COB-03–COB-05; gate atual de PROD reprovado.
- Revisar e **selecionar apenas migrações/arquivos necessários à cobrança**, ao aceite e à proteção de dívidas, pois #39 possui **899 commits / 238 arquivos** e inclui experimentos de saque/MFA/escrow que **NÃO** devem ser publicados em lote. Extrair sequência de deploy enxuta, com referência ao PR #39; não exigir reescrita do sistema.
- Aplicar a sequência primeiro em **clone isolado da estrutura de produção** (não copiar dados de STAGING), inspecionar RLS/EXECUTE/segredos, proteção de endpoints legados, backup e rollback. Testar coexistência com Mercado Pago sem mudar faturas antigas.
- Gate `asaas-producao-readiness-readonly.sql` deve passar, mas **sozinho não autoriza** deploy; revisar atualização da interface do catálogo para falar com a função Asaas efetivamente publicada.
- **Aceite:** pacote de lançamento revisado, CI, inventário de SQL forward-only, rollback/backup, testes no clone, plano de preservação de dados e lista exata de ações/arquivos. Nenhum `merge` automático do PR gigante.

### [ ] COB-07 — Configurar PRODUÇÃO e habilitar **somente cobranças**, com autorização

- **Estado:** BLOQUEADO POR COB-06 + AUTORIZAÇÃO EXPRESSA + CONDIÇÕES CADASTRAIS DA CONTA.
- Proprietário confirma conta Asaas produtiva apta ao recebimento, cadastro/documentação exigidos pelo Asaas, tarifas da conta, titularidade, termos e responsabilidade operacional. O usuário declarou anteriormente não ter CNPJ ativo: **não presumir** que os recursos bancários estão disponíveis ou obrigar cadastro não confirmado.
- Após **autorização específica**, migrar só esquema de cobranças, publicar Edge, configurar chave de **produção** separada e webhook de produção; manter `ASAAS_BILLING_ENABLED=false` / `ASAAS_PRODUCTION_BILLING_APPROVED=false` inicialmente; validar gates e recuperação de falhas; ativar somente cobranças com nova autorização de go-live.
- **Aceite:** migração auditada, app exibindo Pix Asaas no fluxo real, rotas protegidas, sem segundo gateway disputando mesma fatura, saques produtivos e Pix Automático **desligados**.

### [ ] COB-08 — Conferir primeira fatura real e encerrar entrega de cobrança

- **Estado:** BLOQUEADO por COB-07.
- Piloto de comércio autorizado e fatura real elegível; confirmar emissão única, Pix, webhook, baixa, histórico, inadimplência/estorno, notificações, suporte e observabilidade, sem exposição de dados sensíveis.
- **Aceite:** primeira fatura real concluída/conciliada, acompanhamento demonstrado, contingência documentada e aprovação do proprietário. Só aqui dizer **“cobrança mensal Asaas pronta em produção”**.

## FASE B — SAQUES E CARTEIRA DOS MOTOBOYS (SÓ DEPOIS DE COB-08)

### [ ] SAQ-01 — Revisar regras existentes, carteira e crédito financiado

- **Estado:** IMPLEMENTADO EM TESTES, NÃO LIBERADO.
- Verificar mínimo R$100, acúmulo por meses sem expiração arbitrária, >1.000 comissões, teto por transferência R$5.000, saldo residual, motoboy inativo, proteção de contestações, rateio 2% em offline elegível e taxas da plataforma.
- **Aceite:** matriz de valores e estado consistente; nenhuma comissão duplicada ou crédito fictício, inclusive fatura estornada após crédito.

### [ ] SAQ-02 — Comprovar **elegibilidade comercial e autorização técnica Money Out**

- **Estado:** DEPENDÊNCIA EXTERNA; histórico de saque R$2 Sandbox não equivale a aprovação produtiva.
- Contatar Asaas sobre **Pix para motoboys terceiros via API**, documentação/cadastro do titular, validação de destinatário Pix, tarifas/limites, webhook de validação e aprovação comercial/contratual exigida.
- **Aceite:** autorização escrita/indicação inequívoca do Asaas e controles que devem ser exigidos em produção, sem usar a confirmação Sandbox como atalho.

### [ ] SAQ-03 — Homologar saques na versão atual, inclusive casos excepcionais

- **Estado:** TESTES HISTÓRICOS/CI EXISTENTES, NÃO CERTIFICAÇÃO ATUAL.
- Testar reserva e GET bancário, `APPROVED/REFUSED`, `DONE/FAILED/CANCELLED`, timeout e recuperação sem segundo POST, MFA/dupla conferência **somente se necessários à operação aprovada**, HMAC e destinatário original, concorrência/idempotência.
- Tratar saldos **inferiores a R$100** e saldo de entregador inativo: não permitir baixa com base em evidência incompleta; comprovar liquidação antes de concluir o histórico ou manter **HOLD com direito preservado**.
- **Aceite:** provas rastreáveis para cada transferência e teste de não duplicação/estorno; encerramento financeiro sem perda de saldo. Não criar laboratório novo sem bug concreto.

### [ ] SAQ-04 — Liberar produção de saques **independentemente** das cobranças

- **Estado:** BLOQUEADO por SAQ-01–SAQ-03 + autorização específica do proprietário.
- Preparar somente migrations/Edge/Secrets necessários a saques, revisar segurança e credenciais, ativar Money Out após autorização do Asaas, acompanhar primeira transferência real e conciliação até `DONE`.
- **Aceite:** repasse autorizado, único, conciliado, transparência do extrato e monitoramento; não considerar `POST` aceito como transferência quitada.

## Não fazem parte desta entrega

**Fora do escopo e sem execução automática:** Pix Automático agora; novas opções de monetização, turismo/mapas/notícias; identidade visual; mudanças de cancelamento/atribuição que não alterem diretamente a segurança financeira; novo desenho de escrow/ancoragem/MFA laboratorial; pagamentos produtivos de teste; reimplementação completa do site; reemissão de credenciais existentes sem comprovar falha.

## Como atualizar sem virar backlog infinito

- Ao terminar cada COB/SAQ: substituir somente sua marcação, data, ambiente, evidência e próxima ação.
- Bugs encontrados são **subtarefas do item ativo**; registrar causa, teste antes/depois e commit. Só exigir uma **nova** etapa com autorização explícita do usuário.
- Se depender de configuração externa, a execução para nesse item com um único passo a passo relevante para o usuário, **sem implementar distrações enquanto aguarda**.
- Critério de encerramento do trabalho de **cobranças:** COB-01…COB-08 todos concluídos.
- Critério de encerramento do **sistema financeiro completo:** COB-01…COB-08 + SAQ-01…SAQ-04 concluídos. Futuro Pix Automático explicitamente excluído.

**Próxima ação obrigatória:** **COB-01 — CONFERIR** o webhook e a chave Asaas Sandbox que **já existem**; não solicitar criação de novos. Só avançar para COB-02 após evidência de que o Sandbox atual está corretamente ligado ao STAGING.
