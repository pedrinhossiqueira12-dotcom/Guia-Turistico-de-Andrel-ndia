# Auditoria: encerramento financeiro x whatsapp-bot legado (2026-10-09)

**Escopo:** revisão somente-leitura da Edge `whatsapp-bot` implantada no projeto Supabase de produção `xdmbkflufsfqziixzpxc`, versão 90. Nenhum código, cobrança ou dado de produção foi modificado nesta auditoria. Alterações SQL e testes ocorreram somente na branch e no STAGING `jbttwihctuibchhcyqtl`.

## Resultado da inspeção da Edge implantada

- `verify_jwt=false` no gateway, mas a implementação executa verificação própria de identidade/proprietário/administrador antes de arquivar; isto **não** significa que a rota permita exclusão anônima. Os controles precisam passar por revisão independente.
- As ações `excluir_meu_comercio`, `marcar_meu_comercio_deletado` e `marcar_comercio_deletado` permanecem roteadas no serviço ativo.
- O método legado consulta `comercios_publicados` e modifica `status='deletado'` antes de atualizar `DATA/comercios.json` via GitHub, podendo remover referências a imagens. Em falhas intermediárias tenta compensar alterações; não há transação única envolvendo GitHub + banco.
- O fluxo legado **não consulta explicitamente faturas/comissões/pedidos** antes da tentativa de despublicação. A barreira de segurança deve existir no PostgreSQL e não depende da UI.
- A Edge antiga também possui caminho de publicação/upsert com `status='ativo'`; deve respeitar o encerramento já solicitado, inclusive quando a publicação anterior estava em `deletado` ou `pendente`.
- O novo botão na `local.js` já usa a Edge `catalogo-admin` para `solicitar_encerramento`, não a ação antiga. Isso não elimina o risco de chamadas diretas à rota antiga.

## Defesas já presentes na branch

- `20261009162000_bloquear_exclusao_debitos_e_finalizar_arquivamento.sql`: trigger consulta débitos e pedidos em andamento antes da despublicação; impede remoção física de histórico.
- `20261009163000_impedir_reabertura_encerramento.sql`: impede reabertura de catálogo bloqueado e republicação de lojas antes `arquivado`.
- **Novo:** `20261009183000_proteger_republicacao_legada_apos_encerramento.sql` faz a verificação de encerramento em **INSERT e UPDATE de status**, para qualquer situação aberta ou arquivada, independentemente do status anterior da publicação. Bloqueia também UPSERT. Usa lock na linha de `catalogos` para serializar com a solicitação de encerramento.
- **Novo:** `20261009184000_bloquear_despublicacao_legada_qualquer_status.sql` impede `DELETE` e alterações para estado não ativo quando há fatura, comissão ou pedido pendente, **mesmo se o estado anterior da publicação era `deletado` ou `pendente`**. Mantém o gatilho existente e o bloqueio por linha do catálogo.
- O frontend estático consulta a RPC pública e limitada `catalogo_status_publicacao`; um tombstone `arquivado` tem precedência sobre a cópia do JSON.

## Validação realizada no STAGING

Em transação única com `ROLLBACK`, foi simulada uma publicação com `status='deletado'` e encerramento `pendente_arquivamento`. Tentativas de `UPDATE status='ativo'` e `INSERT ... ON CONFLICT DO UPDATE status='ativo'` foram ambas rejeitadas por SQLSTATE `23514`. A consulta posterior confirmou que o registro de encerramento temporário não permaneceu no banco.

Um segundo teste, também completamente revertido, registrou uma fatura fictícia aberta de R$ 1,00 após marcar a publicação como `deletado`. Tentativas de `UPDATE status='arquivado'` e `DELETE` foram ambas rejeitadas por SQLSTATE `23514`; não ficaram faturas nem exclusões dessa simulação.

Foi adicionado `tests/catalogo-encerramento-legado.test.cjs` para verificar os contratos de proteção no CI. Esses testes não exercem a Edge antiga real e **não substituem** testes integrados de produção.

## Riscos e etapas bloqueantes

1. **Produção ainda não recebeu as migrações**: portanto, as proteções novas não estão garantidas na Edge produtiva. Não afirmar que a exclusão por dívida está protegida em produção até instalar/testar o bloqueio.
2. Testar fluxo completo com usuário fictício no STAGING: fatura não paga deve recusar o legado antes de escrever no GitHub; após quitação e arquivamento, edição/publicação não pode reativar o negócio.
3. Versionar e revisar o código fonte *não minificado* da Edge antiga antes de qualquer nova implantação. Preferir remover a ação de exclusão da rota antiga após migrar todos os consumidores, mantendo as demais operações legadas em funcionamento.
4. Garantir que o fechamento mensal e a criação de novas faturas concorrentes não permitam despublicação na janela entre consulta de pendências e gravação. Rever locks e transações envolvendo as tabelas de crédito.
5. Validar o impacto de inconsistência GitHub x Supabase e fluxo de recuperação, inclusive foto e status divergentes, sem realizar exclusões de histórico financeiro.
6. Revisar as permissões `SECURITY DEFINER` e a RPC pública no Security Advisor antes de ativar na produção.

**Status:** PR #39 permanece Draft. Nenhuma aprovação para mesclar, migrar produção, desativar funções existentes ou enviar Pix.

## Revalidacao read-only de 17/10/2026 — Edge candidata x implantada

- **Producao (xdmbkflufsfqziixzpxc):** a Edge implantada whatsapp-bot continua na versao 90. Ela executa UPDATE de comercios_publicados.status='deletado' antes de tentar PUT em DATA/comercios.json. O inventario pg_trigger confirmou ausencia das guardas financeiras de encerramento em comercios_publicados e catalogos (so catalogos_atualizado_em em catalogos). Portanto a protecao financeira da rota antiga **nao esta implantada em producao**. Nenhuma chamada POST foi feita.
- **STAGING (jbttwihctuibchhcyqtl):** os triggers catalogo_publicacao_sem_divida_guard e catalogo_encerramento_sem_republicacao estao ativos (tgenabled='O') e suas funcoes foram inspecionadas. Recusam despublicacao com pendencias e republicacao com encerramento registrado. Isso nao substitui ensaio HTTP E2E nem demonstra ausencia de concorrencia na criacao de novas obrigacoes.
- **Fonte candidata da PR #39, nao implantada:** a funcao ae ja permite ao proprietario somente solicitar catalogo_solicitar_encerramento_financeiro; somente admin pode chamar catalogo_finalizar_encerramento_financeiro ou RPC especifica sem catalogo, validando o banco antes do GitHub. Os testes asaas-cob06-whatsapp-encerramento.test.cjs e asaas-cob06-whatsapp-http-real-handler.test.cjs cobrem fluxos offline com Supabase e GitHub simulados, inclusive status ja deletado e retentativa. A lacuna da exclusao direta continua na Edge implantada, nao na Edge candidata. Nao duplicar a correcao na branch.
- **STAGING ainda nao pronto para E2E desta Edge:** whatsapp-bot nao consta nas Edge Functions implantadas; catalogo_arquivar_sem_catalogo_admin(text,uuid) nao esta instalada; catalogo_finalizar_encerramento_financeiro verifica UID fixo de admin de producao, diferente do admin de testes. Nao testar com a conta STAGING ate preparar um alvo isolado e coerente.
- **Isolamento do GitHub e obrigatorio:** a fonte candidata usa branch main para DATA/comercios.json. Um deploy em STAGING com GITHUB_TOKEN dotado de escrita poderia afetar a vitrine real; exige destino descartavel ou simulador, token e parametros separados antes de qualquer ensaio com escrita.
- **Gates:** revisar concorrencia com criacao de faturas e pedidos, configurar identities/RPCs e Edge num ambiente isolado, executar E2E com recusas e falhas recuperaveis, auditar a sincronizacao da vitrine e so entao propor corte sob aprovacao expressa. PR permanece Draft; nenhum merge, deploy da Edge, operacao produtiva ou Pix autorizado por esta verificacao.

## 17/10/2026 — trava de destino GitHub para QA (branch Draft, sem deploy)

- A advertencia de revalidacao anterior registrava o estado ANTERIOR da fonte candidata, que usava main como valor fixo. Isso foi corrigido em commit 3090ce14, exclusivamente na PR #39: COB06_GITHUB_BRANCH passou a ser obrigatoria antes de qualquer GET/PUT de DATA/comercios.json ou DATA/pessoas.json; destinos QA seguem o padrao restrito qa/nome.
- A branch descartavel qa/cob06-isolado foi criada a partir do commit 8b4b16f7 do PR; main continua intocada. Nenhuma Edge foi implantada, configurada com token nem invocada. A branch QA nao significa que haja um ambiente HTTP isolado pronto.
- Destino main e recusado a menos que SUPABASE_URL seja exatamente o projeto produtivo esperado E COB06_GITHUB_WRITE_MAIN tenha o valor literal AUTORIZADO_PARA_PRODUCAO. Esta trava tecnica nao substitui autorizacao do proprietario, gates de seguranca ou processo de liberacao; nunca configurar esta flag durante QA.
- Novo teste tests/asaas-cob06-whatsapp-github-branch.test.cjs usa VM Node e fetch simulado para recusar destinos ausentes, main em STAGING, main sem flag e refs ambiguas, e para conferir GET/PUT direcionados a qa/cob06-isolado. Execucao em mock JS confirmou cinco combinacoes: sem branch/sem rede; main em STAGING/sem rede; main sem liberacao/sem rede; QA com chamadas apenas simuladas; producao+flag liberada apenas na simulacao, sem rede externa.
- Para ensaio E2E futuro: disponibilizar uma Edge isolada sem tokens de producao, alinhar identidade admin/RPCs de teste e usar somente COB06_GITHUB_BRANCH=qa/cob06-isolado com credencial GitHub de menor privilegio. Nao usar a conta real da vitrine e nao implantar a funcao candidata ate completar essa segregacao.

## 17/10/2026 — finalizadores administrativos alinhados em STAGING somente

- Preflight somente leitura: conta admin QA d896cc0c-31e4-4ef7-8fa4-13d15f02dd2a confirmada e sem bloqueio; UID produtivo 4b9a0233-6b72-4573-aebd-d596c5b15e1b nao existe em auth.users do STAGING. A funcao legada instalada catalogo_finalizar_encerramento_financeiro ainda exigia UID de producao e usava status tecnico arquivado, divergente do contrato candidato (deletado na publicacao; arquivado apenas no tombstone financeiro).
- Alteracao aplicada apenas ao STAGING: substituida a definicao de catalogo_finalizar_encerramento_financeiro pela versao da migration pendente 20261009162000, trocando EXCLUSIVAMENTE o UID admin para a conta QA. Mantidos o lock, verificacao de pendencias, tombstone e SECURITY DEFINER; execucao continua somente para service_role. Script de execucao: supabase/staging-only/cob06_finalizador_admin_qa_20261017.sql. Rollback do corpo original capturado antes: supabase/staging-only/cob06_finalizador_admin_qa_rollback_20261017.sql.
- Criada tambem SOMENTE em STAGING a RPC catalogo_arquivar_sem_catalogo_admin(text,uuid) da mesma migration candidata, com UID admin QA e guardas contra catalogo existente e qualquer historico financeiro/operacional. Script supabase/staging-only/cob06_sem_catalogo_admin_qa_20261017.sql; rollback preparado em supabase/staging-only/cob06_sem_catalogo_admin_qa_rollback_20261017.sql (NAO EXECUTADO).
- Testes nao destrutivos executados apos as alteracoes: as duas RPCs reconhecem o UID QA mas recusam lojas inexistentes, rejeitam UID de producao, preservam SECURITY DEFINER e nao concedem EXECUTE a anon/authenticated; service_role permanece unico executor remoto. Nenhum pedido ou comercio real foi arquivado. O lote ficticio 583d761a-ecb9-49be-b484-e43f6183971e segue preparado com 560 centavos.
- Security Advisor apos alteracao: 62 informacoes de tabelas RLS sem policy intencional, 2 avisos conhecidos da RPC publica de status e 1 aviso de protecao de senhas vazadas desativada; nenhum aviso novo identificado. Edge whatsapp-bot permanece NAO implantada no STAGING; portanto estas verificacoes de RPC nao sao teste HTTP E2E.
- O teste de isolamento GitHub do ultimo commit havia concluido todos os 12 jobs de CI com sucesso (run 39061359867). Esta alteracao de STAGING NAO implica liberacao de producao, Pix, saque, merge ou publicacao de endpoint legado.


## 17/10/2026 — preflight HTTP somente leitura implantado em STAGING

- Adicionada Edge isolada `catalogo-cob06-encerramento-preflight`, versão 1, **apenas** em `jbttwihctuibchhcyqtl` com `verify_jwt=true`. Exige `getUser(jwt)` do Auth e UID + e-mail fixos do administrador QA. A função está na PR Draft em `supabase/functions/catalogo-cob06-encerramento-preflight/index.ts`.
- O código possui apenas quatro consultas SELECT via Supabase: verifica o lote `583d761a-ecb9-49be-b484-e43f6183971e` em `preparado` por 560 centavos, e ausência da sentinela fictícia em publicações, catálogos e encerramentos. **Não** invoca RPC de arquivamento, `INSERT/UPDATE/DELETE`, WhatsApp, GitHub, Asaas, emissão Pix ou qualquer rota financeira de escrita.
- Checagem direta de rede da função STAGING: POST sem JWT retornou **HTTP 401**; OPTIONS CORS retornou **HTTP 204**. O `supabase_get_edge_function` confirmou versão 1 ativa e `verify_jwt=true`. Consulta SQL posterior confirmou que o lote permanece `estado=preparado` e `total_centavos=560`.
- Acrescentado botão **Verificar HTTP de encerramento (sem alterações)** na página `pages/asaas-homologacao-sandbox.html` da mesma branch, visível apenas para admin QA. Esta etapa **ainda requer clique do usuário autenticado** para provar o HTTP 200; a chamada com JWT real não foi feita pelo agente e nenhuma credencial foi solicitada.
- Os testes `tests/asaas-cob06-encerramento-http-preflight.test.cjs` simulam o dispatcher HTTP, autenticacao, escopo de leitura e HOLD com falhas. O CI deve ser conferido no commit atual.
- Isto **não** é teste HTTP completo da ação `excluir_comercio` nem das RPCs de arquivamento sobre loja existente. `whatsapp-bot` de produção continua intocada; branch QA de GitHub `qa/cob06-isolado` não recebeu writes. Nada autoriza merge, deploy produtivo ou fluxo bancário.
