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

**Limitação:** não foram exercitados o endpoint `whatsapp-bot` real nem a alteração do JSON público no GitHub; somente o SQL defensivo no clone sintético. A homologação da integração sem alterar dados produtivos segue pendente.
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
