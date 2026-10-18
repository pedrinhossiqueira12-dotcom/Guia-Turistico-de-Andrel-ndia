# COB-06 — pacote mínimo CANDIDATO para cobranças (NÃO IMPLANTAR)

Data: 12/10/2026. PR #39: **Draft e sem merge**. Status: **preparação e análise concluída parcialmente; sem aceite de release**.

## Escopo decidido

Lançar futuramente apenas faturamento mensal Asaas, Pix manual de fatura, recebimento durável de webhooks, aceite de Termos/Privacidade e proteção contra exclusão de loja devedora. Preservar cobranças históricas Mercado Pago, estados de pedidos e repasses. **NÃO** ativar transferências Pix a motoboys, saques, escrow, MFA/step-up experimental nem Pix Automático. Não implantar nenhuma peça deste pacote sem restauração de backup testada em clone e autorização explícita futura.

A migration original `20261008180000_asaas_faturas_saques_controlados.sql` cria tanto cobrança quanto saques. A migration `20261009150000_termos_cobranca_futura_encerramento_e_saque_minimo.sql` inclui reservador de saque. **Elas NÃO são seguras para deploy produtivo completo dentro do escopo COB-07.**

### Sequência SQL proposta — uso SOMENTE em clone descartável até aprovação

| Ordem | Fonte | Escopo | Status |
|---|---|---|---|
| 1 | `supabase/production-candidate/01_asaas_cobrancas_inbox_sem_saques.sql` | Gateway compatível, clientes/emissões Asaas, registrar fatura, inbox, claim/finalizar e privilégios; sem criar estruturas de saque | Candidato extraído |
| 2 | `supabase/production-candidate/02_termos_encerramento_sem_saques.sql` | Preferência Pix **manual** por padrão, termos/privacidade, solicitação inicial de encerramento | Candidato extraído |
| 3 | `supabase/pending-migrations/20261009162000_bloquear_exclusao_debitos_e_finalizar_arquivamento.sql` | Apuração de débitos, finalização, proteção de despublicação e bloqueio de DELETE físico | Dependência a revisar |
| 4 | `supabase/pending-migrations/20261009163000_impedir_reabertura_encerramento.sql` | Impedir reabertura indevida de catálogo/registro publicado | Dependência a revisar |
| 5 | `supabase/pending-migrations/20261009180000_status_publicacao_publica_restrita.sql` | Leitura pública limitada de status da publicação, sem expor a tabela | Validar necessidade na UI |
| 6 | `supabase/pending-migrations/20261009183000_proteger_republicacao_legada_apos_encerramento.sql` | Proteger INSERT/UPSERT da rota antiga | Dependência a revisar |
| 7 | `supabase/pending-migrations/20261009184000_bloquear_despublicacao_legada_qualquer_status.sql` | Impedir despublicação indevida em status anteriores | Dependência a revisar |
| 8 | `supabase/pending-migrations/20261012104000_cob04_fechamento_apenas_entregas_confirmadas.sql` | Fechar apenas pedidos elegíveis ao faturamento | Validar no clone com histórico realista |
| 9 | `supabase/pending-migrations/20261012163000_cob04_pagamento_somente_componentes_da_fatura.sql` | Baixar/estornar somente componentes efetivamente fechados | Validar no clone, cenários Mercado Pago |

Os dois primeiros arquivos **não** pertencem a `supabase/migrations/` ou `pending-migrations/` e não são capturados em deploy automático. Os restantes são **fontes de revisão**, não autorização para aplicação por atacado. `20261011234500_asaas_webhook_inbox_incremental_staging.sql` é **excluído**: o candidato 1 já contém inbox inicial completa. Não usar arquivo de Cron/Vault rotulado `staging-only` em produção.

### Gate reproduzido em 12/10/2026 (nenhuma escrita)

`scripts/validacao-pagamentos/asaas-producao-readiness-readonly.sql`: STAGING **0 tabelas e 0 RPCs faltantes**, constraint Asaas/MP OK; produção **4 tabelas, 4 RPCs faltantes**, constraint MP somente. Gate complementar `scripts/validacao-pagamentos/asaas-cob06-seguranca-readonly.sql`, também executado em ambos:

| Controles | STAGING | Produção |
|---|---:|---:|
| 6 tabelas obrigatórias ausentes | 0 | **6** |
| RLS ausente dentre tabelas existentes | 0 | 0 |
| Acesso direto anônimo/autenticado dentre tabelas existentes | 0 | 0 |
| 4 gatilhos de proteção ausentes/inativos | 0 | **4** |
| 6 RPCs privadas ausentes | 0 | **6** |
| RPCs expostas indevidamente dentre existentes | 0 | 0 |

O gate não inspeciona eventuais sobrecargas de assinatura que precisem ser revisadas separadamente, nem prova ausência de bypass nas rotas antigas. Executar novamente após montar clone.

### Ensaio real em PostgreSQL descartável na CI (12/10/2026)

No workflow `Database tests`, job `All financial migrations except remote scheduling (disposable PostgreSQL)`, a etapa `COB-06 selective billing and safeguards on local production-like clone (no payouts)` foi acrescentada e **terminou com sucesso no run 38293614227** (verificado pelo estado da etapa). O job cria `catalogo_cob06_ci` a partir do baseline sintético de migrações reais já existentes, insere uma **fatura e cobrança Mercado Pago fictícias já pagas**, aplica em ordem as **nove** fontes selecionadas deste manifesto, executa os dois gates read-only e assegura que as estruturas e RPCs de saque **não** foram criadas. A cobrança MP de teste continua com `gateway=mercadopago`, `status=pago`, `valor_centavos=700`, uma linha e sem migração involuntária.

**Limitação crucial:** é um PostgreSQL 17 descartável construído com baseline sintético do repositório, **não** um clone comprovadamente idêntico ao estado real atual da produção. O teste é prova de compatibilidade técnica do pacote selecionado, **não** autoriza aplicar migrations em produção. Ainda será preciso confrontar o inventário real de migrations e extensões, validar restauração de backup e executar testes de rota legada de exclusão em clone apropriado.

### Prova das guardas legadas no banco descartável — 12/10/2026

O script `supabase/tests/isolated/asaas-cob06-guardas-legadas-clone.sql` foi incluído no teste seletivo do workflow GitHub Actions. A etapa COB-06 do run [38294353471](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/38294353471) terminou **success**. O PostgreSQL é local e descartável; o ensaio usa cobrança Mercado Pago sintética de R$7 paga e fatura fictícia de R$5 em aberto.

O teste SQL envolto em BEGIN/ROLLBACK comprova cinco bloqueios (SQLSTATE 23514): **1)** atualização direta de publicação para `deletado` como faz o `whatsapp-bot`; **2)** DELETE da publicação devedora; **3)** DELETE de `catalogos` com histórico financeiro; **4)** UPSERT de republicação após solicitação de encerramento; **5)** desbloqueio automático de catálogo encerrado. Confere ainda `aguardando_quitacao` na solicitação, recusa administrativa de arquivamento com débito, manutenção de fatura MP paga e ausência de fixtures persistidas.

Também foi inspecionada a Edge mista Asaas e adicionado teste de não regressão em `tests/asaas-cob06-pacote-minimo.test.cjs`: a ação de saque recusa produção ANTES de reservar crédito, o cliente HTTP recusa POST /transfers de produção antes do fetch, e a cobrança produtiva exige as duas flags de aprovação. Essa análise não é permissão de publicar a Edge mista, cujas demais rotas ainda merecem revisão.

**Limitação:** não foram exercitados o endpoint `whatsapp-bot` real nem a alteração do JSON público no GitHub; somente o SQL defensivo no clone sintético. A homologação da integração sem alterar dados produtivos segue pendente. **Inventário de código:** a Edge `whatsapp-bot` v90 está ativa em produção e foi inspecionada somente por leitura, mas o caminho esperado `supabase/functions/whatsapp-bot/index.ts` retorna 404 na branch da PR #39; o código efetivamente publicado não está versionado ali. Para revisão/deploy seguro, recuperar e versionar uma fonte auditável, sem copiá-la cegamente sobre o sistema, antes de testar a operação HTTP/JSON e de iniciar COB-07.
### Novo gate de equivalência da estrutura real de produção (12/10/2026)

O relatório `scripts/validacao-pagamentos/asaas-cob06-schema-fingerprint-readonly.sql` consulta **somente metadados** (tipos/ordens de colunas, defaults, NOT NULL, constraints e triggers), sem dados pessoais, pagamentos, tokens ou faturas. A captura PROD foi versionada em `scripts/validacao-pagamentos/asaas-cob06-esquema-producao-golden-20261012.txt` com hashes MD5 estruturais de **seis tabelas**: pedidos, comissões, fechamentos, cobranças, catálogos e publicações.

A comparação PROD/STAGING demonstrou **3 assinaturas iguais** (`catalogo_pedidos`, `catalogo_comissoes_offline`, `catalogo_fechamentos_offline`) e **3 diferentes** (`catalogo_fatura_cobrancas`, `catalogos`, `comercios_publicados`). Neste último caso, a tabela de publicações tem **7 colunas em produção e 4 no STAGING**, então copiar o STAGING não constitui clone representativo; gatilhos adicionais de encerramento e gateway Asaas também explicam diferenças. Produção PostgreSQL 17.6; STAGING PostgreSQL 17.11.

Adicionado ao GitHub Actions um gate que compara, **ANTES de aplicar qualquer SQL candidato**, o clone sintético do baseline original contra **as seis assinaturas capturadas da PRODUÇÃO**. Se houver deriva, a etapa deve falhar sem modificar produção e o pacote só poderá seguir após corrigir o baseline/planejamento. O resultado da execução deste novo gate precisa ser confirmado na CI; aprovação anterior não equivale a aceite automático deste gate.

**Limites:** igualdade de seis assinaturas não prova que toda a base, grants, Auth, Storage, extensões, jobs, rotas HTTP ou dados de negócio sejam idênticos. Ainda exigem teste independente antes de implantação.
### Limite financeiro real do Asaas — dívida mensal abaixo de R$ 5

Conforme a [documentação oficial do Asaas atualizada em 19/08/2026](https://central.ajuda.asaas.com/hc/pt-br/articles/31972480144795-Quais-s%C3%A3o-os-limites-para-cria%C3%A7%C3%A3o-de-cobran%C3%A7as), **contas PF e PJ só podem criar uma cobrança a partir de R$ 5,00**. O serviço atual trabalha com fechamento mensal pela comissão efetivamente vendida; meses de pouco movimento podem gerar R$ 0,01–R$ 4,99. A operação não pode cobrar R$ 5 quando a dívida real é inferior.

**Correção fail-closed 12/10/2026, PR #39:** `supabase/functions/catalogo-asaas-financeiro/index.ts` agora exige `invoiceCents>=ASAAS_COBRANCA_MINIMA_CENTAVOS` (500) **depois de tratar cobranças já existentes** e **antes da reserva, cadastro do pagador ou POST /payments**. Faturas menores recebem HTTP 409 informando que o Pix não foi emitido; permanecem registradas no valor original, sem alteração financeira. Testes da fixture em `tests/catalogo-asaas-cobranca-ciclo-completo-isolado.test.cjs` cobrem 1/100/499 centavos sem efeitos colaterais, 500 aceito e reconciliação de cobrança antiga inferior a R$5, sem segundo POST.

Leitura agregada realizada nos dois bancos PROD/STAGING em 12/10/2026 (sem dados pessoais): **0 faturas abertas inferiores a R$ 5 e 0 faturas em aberto >= R$5**, resultado válido apenas no instante da consulta. Futuros comércios reais ainda poderão gerar saldos pequenos.

**Decisão operacional pendente para COB-06/COB-07:** implementar mecanismo contábil de **acumulação de valores realmente devidos** até ultrapassar R$5, preservando competências e evitando duplicidade, *ou* escolher outro método de pagamento autorizado para faturas pequenas. A simples guarda impede tentativa rejeitada pelo provedor, mas **não resolve a cobrança desses valores**. Não aumentar artificialmente fatura, cancelar obrigação ou ignorar bloqueio de encerramento por dívida. Nenhuma regra de acumulação foi ativada.
### Arquivos de Edge e interface — pacote ainda NÃO fechado

- Edge `supabase/functions/catalogo-asaas-financeiro/index.ts` é grande e contém rotas de **cobranças e saques no mesmo código**. Não considerar pronto o release apenas porque as migrations foram separadas. Preparar versão/manifesto que mantenha rotas de saque inacessíveis na produção, com flags de saques desligadas, sem `POST /transfers`.
- Interface `js/catalogo-admin.js` já invoca `catalogo-asaas-financeiro` para criar/consultar cobrança; revisar `pages/catalogo-admin.html` e termos para ativação seletiva. `js/entregas-operacao.js` contém modo Sandbox e áreas de saques: **não promover como recurso de produção nesta etapa**.
- Analisar endpoint legado `supabase/functions/whatsapp-bot` efetivamente implantado e seus caminhos de exclusão/publicação. Triggers 3, 4, 6 e 7 são defesa adicional, mas o endpoint precisa de comportamento claro (bloquear exclusão de loja devedora e preservar histórico).
- **Auditoria read-only realizada em produção em 12/10/2026:** Edge `whatsapp-bot` v90 ACTIVE. As rotas `excluir_comercio`, `marcar_comercio_deletado` e `marcar_meu_comercio_deletado` convergem ao fluxo interno de exclusão/arquivamento. O código atual altera `comercios_publicados.status` para `deletado`, zera referências de fotos e atualiza o JSON público via GitHub, mas **não consulta antes o total devido na fatura/comissões**. Na produção os gatilhos `catalogo_publicacao_sem_divida_guard` e `catalogo_encerramento_sem_republicacao` estão ausentes; logo a rota legada precisa ser auditada/testada em clone e a barreira SQL é requisito de implantação. Em STAGING as guardas existem. **Não executar exclusão real para demonstrar o cenário**: usar fixture sintética no clone. Atualização do JSON público precisa permanecer coerente caso o banco rejeite despublicação.

- O pacote não tem requisitos produtivos de Cron resolvidos: criar processo independente somente com **Vault e Edge Secrets PROD** após autorização, sem copiar o token/URL do STAGING.

### Impedimentos e verificações obrigatórias antes de COB-07

1. Revisar `SECURITY DEFINER`, `GRANT/REVOKE`, RLS e permissões por assinatura real. A função `catalogo_finalizar_encerramento_financeiro` na migration 3 contém UUID de administrador fixo no SQL; não permitir sua promoção sem verificar identidade produtiva e preferencialmente substituir por uma autorização server-side segura com testes. **Auditoria de identidade somente-leitura de 12/10/2026:** o identificador administrativo embutido no SQL e na Edge existe em `auth.users` da PRODUÇÃO, mas **não existe** em `auth.users` do STAGING; nenhum e-mail/CPF ou informação de identidade foi consultado. Isso demonstra que as identidades não são equivalentes entre ambientes. A RPC `SECURITY DEFINER` confia em `p_admin` passado pelo chamador (restrito atualmente a `service_role`), enquanto a Edge verifica o UID da sessão contra a constante. Antes de lançar, documentar/validar explicitamente a identidade administrativa produtiva por token JWT real e manter a RPC inacessível a `anon` e `authenticated`, sem copiar identidade STAGING nem confiar em UID arbitrário de requisição.
2. Usar clone isolado com **estrutura equivalente à produção**, dados sintéticos e cenário de faturas Mercado Pago anteriores; jamais restaurar STAGING sobre produção. Aplicar somente as fontes selecionadas e provar 9 passos forward-only em ordem, sem depender de migrations de saque.
3. Executar pgTAP/regressões de cobrança, guarda para loja com dívida/pedidos abertos, reabertura via `comercios_publicados`, pedidos físicos, fechamento, estorno e concorrência. Rodar os **dois gates** no clone e confirmar zero faltantes.
4. Obter backup/PITR com restauração ensaiada e plano operacional de parada. Após deploy futuro, rollback preferencial é **desligar flags e interface** mantendo tabelas e registros financeiros; **não** dropar tabelas nem reverter pagamentos por SQL. Nunca fazer down migration destrutiva.
5. Credenciais da conta Asaas de produção, tarifas e titularidade seguem dependência externa. Liberação produtiva de cobrança requer aprovação distinta COB-07; saques e Pix Automático continuam desligados.

**Decisão presente:** candidatos SQL + gates auditáveis versionados, mas **nenhuma migração foi aplicada em produção, nenhum merge e nenhum Pix real**. Não declarar COB-06 concluída até existir teste do pacote seletivo em clone, revisão dos endpoints legados/Edge e runbook final de release.

## Revisão de corte COB-06 — 18/10/2026 (somente leitura, SEM autorização de release)

Esta revisão atualiza as evidências posteriores ao manifesto inicial, **sem substituir** os testes históricos de 12/10 nem autorizar implantação. A PR [#39](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/pull/39) continua **aberta, Draft e sem merge**. O pacote permanece **CANDIDATO**.

### Manifesto seletivo mantido

- **SQL base de cobrança:** fonte **01_asaas_cobrancas_inbox_sem_saques.sql** e **02_termos_encerramento_sem_saques.sql**, na pasta supabase/production-candidate.
- **Dependências do encerramento e fechamento:** somente as **sete fontes** de supabase/pending-migrations enumeradas nas ordens 3–9 deste documento, em sequência e após revisão de assinatura/função/trigger.
- **Excluídos:** migrations originais mistas de cobrança e saque, toda migration de carteira/repasse/transferência/escrow/MFA, scripts staging-only, alterações automáticas de Cron/Vault e os candidatos de acumulação **03–16** (os de numeração 11–16 incluem provas CI-only). Esses últimos **não** compõem o corte implantável.
- O utilitário **build-release-migrations.py** serve **apenas** para reconciliar as **29 migrations históricas já aplicadas** em produção; seu resultado de zero pendentes **não** significa que COB-06 esteja instalada ou liberada e **não** é um instalador destas nove fontes.

### Gates de banco reexecutados em 18/10 (ambos somente leitura)

| Gate asaas-cob06-seguranca-readonly.sql | STAGING | Produção |
|---|---:|---:|
| Tabelas obrigatórias ausentes | 0 | **6** |
| Tabelas existentes sem RLS | 0 | 0 |
| Tabelas existentes expostas a anon/autenticado | 0 | 0 |
| Gatilhos de proteção ausentes/inativos | 0 | **4** |
| RPCs privadas ausentes | 0 | **6** |
| RPCs existentes expostas a anon/autenticado | 0 | 0 |

O histórico real de migrations da **produção tem 29 versões**, terminando em **20261008120906**, sem as instalações Asaas candidatas. O histórico do STAGING é **diferente e inclui intervenções de homologação posteriores**; não usar seu dump, ordem de migrations ou valores de configuração como substituto de um clone produtivo. Os contadores de exposição **não avaliam objetos inexistentes** e o gate seleciona somente uma assinatura por nome de RPC; revisão de todas as sobrecargas, permissões herdadas e funções SECURITY DEFINER continua obrigatória.

A execução [Database tests #39135237733](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/39135237733) terminou com **12 de 12 jobs aprovados**, incluindo pgTAP e PostgreSQL descartável. O conserto da ferramenta de análise sintática (setup-python e pglast) não altera banco ou lógica financeira. **CI sintética verde não é ensaio em clone fiel da produção.**

### Riscos impeditivos identificados para revisão humana

1. A migration **20261009162000** define rotinas administrativas SECURITY DEFINER que comparam o parâmetro de administrador a um **UUID fixo**. Confirmar a identidade pela sessão autenticada no backend, revisar privilégios por assinatura e impedir que identidade fornecida no parâmetro seja tratada como autorização isolada. A RPC pública intencional **catalogo_status_publicacao(text[])** exige auditoria separada de escopo e informação exposta.
2. A função **catalogo_asaas_registrar_fatura** da fonte 01 impõe **uma cobrança por um único fechamento**, enquanto valores mensais menores que o mínimo de cobrança requerem consolidação **entre competências**. Os SQL 03–10 documentam livros e verificações ainda inertes, e 11–16 não são fluxo produtivo. **Não ampliar o valor da cobrança nem liberar emissão/baixa** sem contrato contábil e conciliação multicompetências aprovados.
3. A Edge **catalogo-asaas-financeiro** continua **mista (cobranças e saques)**. Ainda não há recorte de deploy aprovado que exponha só faturamento, conserve transferências inacessíveis e mantenha flags financeiras desligadas. GETs e liquidação/estorno de acumulação foram exercitados com provedores simulados/CI-only, não comprovados em Asaas real ponta a ponta.
4. A fonte do **whatsapp-bot** foi **recuperada e versionada na branch após o diagnóstico inicial deste documento**; isto corrige a falta de inventário do arquivo, **não** autoriza substituir a Edge ativa em produção. Exige revisão do dispatcher, autenticação/assinatura, exclusão com dívida, Storage e sincronização JSON, em cenário isolado representativo. O ensaio de encerramento da loja fictícia em STAGING/GitHub QA terminou sincronizado, com **hold financeiro preservado**, sem Pix; não prova deploy produtivo seguro.
5. O backup lógico real exportado pelo operador ainda precisa de **verificação independente de integridade, cópia externa e restauração isolada testada**. A divergência estrutural já identificada entre STAGING e produção e as tarefas externas de Cron/Vault impedem considerar STAGING um clone de produção.
6. Aprovação operacional/comercial Asaas, termos e privacidade, alertas, plano de parada, segregação de segredos, revisão independente do código e **autorização específica de COB-07** ainda são gates explícitos.

**Próximo corte seguro:** revisar as nove fontes e todas as assinaturas/privilégios em clone **isolado e compatível** com dados sintéticos, testar rotas HTTP reais contra esse clone sem rede externa, definir o tratamento completo de dívidas menores que o mínimo, registrar evidências de backup/restauração e só então preparar revisão humana de um pacote *billing-only*. **Nenhum comando desta revisão aplicou SQL, fez deploy, alterou GitHub main, criou Pix real ou liberou motoboy.**
