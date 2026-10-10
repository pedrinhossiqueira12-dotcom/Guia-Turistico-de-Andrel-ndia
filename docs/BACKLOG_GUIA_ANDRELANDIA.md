# Backlog de desenvolvimento — Guia Andrelândia

**Índice oficial do backlog:** [GitHub Issue #56](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/issues/56)

**Referência técnica da fase financeira:** [PR #39 (Draft)](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/pull/39).

O backlog organiza **o que falta fazer**. Ele não equivale a prometer que tudo está implementado. Uma funcionalidade presente em commit de branch, mas não implantada e verificada em produção, continua **EM TESTES**.

## Prioridades

| Prioridade | Significado | Critério de ordenação |
|---|---|---|
| **P0 — crítica** | Risco financeiro, fraude, segurança de pagamento ou go-live bloqueado | Resolver antes de pagamentos reais |
| **P1 — alta** | Segurança de contas, negócios, faturamento e entregas | Executar em paralelo com P0 quando não criar risco |
| **P2 — média** | Qualidade da interface, acessibilidade, editorial e conteúdo | Depois dos riscos mais altos |
| **P3 — ideia** | Ideia ainda dependente de recurso externo/viabilidade | Não tratar como funcionalidade contratada |

## Estados

**PENDENTE:** não começou ou ainda precisa de auditoria do estado atual.
**EM DESENVOLVIMENTO:** em implementação.
**EM TESTES:** código existente em branch/STAGING, sujeito à revisão e sem liberação operacional.
**BLOQUEADO:** depende de autorização externa, jurídico, recurso ou etapa anterior.
**CONCLUÍDO:** critérios de aceite atendidos, com revisão/CI e lançamento confirmado quando aplicável.

Não marcar uma issue como concluída apenas porque possui commit. Registrar o hash do commit, testes realizados, limitações e ambiente.

## Financeiro — P0

| Issue | Etapa | Estado | Dependência principal |
|---|---|---|---|
| [#40](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/issues/40) | 1/6 — Âncora externa de auditoria | **EM TESTES** | Guardar e recuperar cópias independentes |
| [#41](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/issues/41) | 2/6 — Conciliação bancária e destinatário Pix | **EM DESENVOLVIMENTO** | GET, varredura bancária, HMAC imutável e trava assimétrica contra reuso de ID entre saques e evidências em STAGING; **destinatário excepcional não comprovado** |
| [#42](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/issues/42) | 3/6 — Autorização/dupla conferência | **EM DESENVOLVIMENTO** | Indicações e revogações somente de ensaio em STAGING; **MFA, revisor formal, prova bancária e aprovação real** pendentes |
| [#43](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/issues/43) | 4/6 — Liberação ou quitação de reserva | **PENDENTE** | #41–#42; prova bancária e consistência transacional |
| [#44](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/issues/44) | 5/6 — Testes finais de segurança | **PENDENTE** | #40–#43 |
| [#45](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/issues/45) | 6/6 — Preparação de produção | **BLOQUEADO** | #44, regularização e aprovação do provedor |

**O marco 1/6 não está formalmente encerrado:** o manifesto SHA-256 e o comparador offline foram implementados no PR #39, mas a conservação independente do arquivo e seu processo de recuperação ainda precisam ser demonstrados. Não chamar isso de âncora externa já concluída.

## Operação do marketplace — P1

| Issue | Tema | Estado |
|---|---|---|
| [#46](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/issues/46) | Faturas manuais, inadimplência e Pix Automático futuro | EM TESTES |
| [#47](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/issues/47) | Termos e aceite versionado | EM TESTES |
| [#48](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/issues/48) | Prevenção de cadastros falsos | PENDENTE |
| [#49](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/issues/49) | Motoboys disponíveis, atribuição e cancelamentos | PENDENTE |
| [#50](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/issues/50) | Catálogos, carrinho, pedidos e WhatsApp | PENDENTE |
| [#53](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/issues/53) | Exclusão de conta e retenção de dados | PENDENTE |
| [#54](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/issues/54) | Logs, backups, incidentes e deploy | PENDENTE |

As issues #48–#54 usam **PENDENTE** quando ainda não foi feita auditoria completa do código atual: não presumir que as funcionalidades estão ausentes ou que precisam ser reescritas do zero.

## Qualidade, conteúdo e melhorias futuras

| Issue | Prioridade | Tema | Estado |
|---|---|---|---|
| [#51](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/issues/51) | P2 | Identidade visual, navbar e acessibilidade | PENDENTE |
| [#52](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/issues/52) | P2 | Notícias, eventos, turismo e mapa | PENDENTE |
| [#55](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/issues/55) | P3 | Rastreio do Tarifa Grátis | AGUARDANDO VIABILIDADE |

## Orientação de execução e fechamento

1. Escolher issue aberta pela prioridade e dependências. Evitar executar pagamentos reais só para demonstrar funcionalidade.
2. Ao iniciar, usar `[EM DESENVOLVIMENTO]` no título e adicionar referência da branch/PR ao corpo.
3. Em STAGING, usar `[EM TESTES]`; anotar testes, ambiente e quaisquer problemas conhecidos.
4. Se depender de terceiro, marcar `[BLOQUEADO]` e explicitar a condição para retomada.
5. Somente fechar após satisfazer cada item dos critérios de aceite, revisar o código, manter a CI verde e confirmar implantação **quando a issue exigir produção**.
6. Atualizar [#56](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/issues/56) e esta tabela quando o estado mudar.
7. Criar subissue apenas quando o trabalho independente justificar; evitar duplicatas.

## Restrições de segurança da fase financeira

- **Não mesclar o PR #39 nem implantar as funções financeiras sem autorização explícita.**
- Utilizar Supabase **STAGING** em ensaios e dados fictícios.
- Não alterar Supabase de produção nem fazer Pix, transferência, débito automático ou baixa real durante testes.
- O escrow excepcional atual é uma separação contábil preparada para teste **sem processo de liberação/quitação em operação**. Nunca usar sua RPC sobre saldos reais.
- O direito de receber comissões não desaparece por recusa de revisão, inatividade do motoboy ou encerramento do comércio.
- Não incluir chaves secretas, IDs de pagamento reais, CPF nem dados de comprovantes em issues públicas.
- O limite por transferência não é limite de saldo e não há paginação artificial de 1.000 comissões.

## Próxima execução sugerida

1. Completar #40 (armazenamento realmente independente das âncoras).
2. Prosseguir #41: HMAC write-once dos saques regulares futuros validado em STAGING e CI 12/12; para reservas excepcionais anteriores, **não há prova retrospectiva** de destino original. Confirmar com banco, revisão independente e dupla conferência antes de qualquer baixa. Manter HOLD.
3. Paralelizar revisão de #46, #47, #48 e #54 sem liberar produção.

**Progresso técnico #41 (10/10/2026):** `20261010004000_proteger_compromisso_pix_saque_antes_post.sql` aplicada apenas em STAGING `jbttwihctuibchhcyqtl`; PostgreSQL carimba e torna imutável o HMAC do destino Pix do saque **regular futuro** antes do POST ao banco. Sem retrofit de histórico e sem destinatário excepcional comprovado. O PR #39 continua Draft, sem produção; CI 12/12 verde no commit `0cd8338448cea7030045ee0835eec3d372be7ac4`. Ver `docs/ASAAS_COMPROMISSO_PIX_ORIGINAL_20261010.md`.

**Defesa de baixa adicional #41 (10/10/2026):** a Edge passou a exigir `pix_destino_registrado_em` nos saques, conciliação e Webhook de autorização; `20261010005000_impedir_baixa_saque_sem_compromisso_pix.sql` aplicada **somente em STAGING**, bloqueando `status='concluido'` sem HMAC original carimbado. Saques legados/escrow excepcional não adquirem prova retrospectiva. Titularidade e liquidação bancária externa continuam pendentes.

**Defesa adicional #41 (10/10/2026):** `20261010006000_reserva_regular_nao_reutiliza_id_excepcional.sql` instalada somente em STAGING: impede que saque regular anexe ID bancário já observado em evidência excepcional e torna esse vínculo imutável; evidência **tardia** continua permitida e append-only para não ocultar conflitos históricos. Testes Node e PostgreSQL descartável cobrem os dois sentidos e não executam Pix. Não comprova identidade do beneficiário ou quitação.

**Concorrência multissessão #41 (10/10/2026):** duas conexões PostgreSQL independentes confirmaram a espera real por advisory lock para impedir reutilização de ID já observado em evidência excepcional (SQLSTATE 23514), e a preservação de evidência bancária tardia quando o saque chega primeiro. CI executa teste em banco descartável próprio `catalogo_asaas_race_ci`, excluído após o ensaio, sem alterar STAGING nem produção. Ver `docs/ASAAS_CONCORRENCIA_MULTISSESSAO_20261010.md`. Mesmo com o teste, a prova independente do destinatário excepcional ainda falta.

**Etapa #42 iniciada (10/10/2026):** somente em STAGING, migração `20261010007000_pareceres_escrow_dupla_conferencia_inerte.sql` acrescenta dois pareceres documentais preliminares por versão, snapshot e prazo de 24 horas, histórico imutável e relatório de HOLD. Backend `service_role` **não tem INSERT/UPDATE/DELETE**, nenhum endpoint concede aprovação. Testes CI incluem cenários com dois autores distintos, tentativa de autoavaliação, replay e invalidação por evidência nova. Revisores autenticados/MFA e aprovação financeira real **não existem**; #42 permanece aberta. Ver `docs/ASAAS_PARECERES_INDEPENDENTES_DRY_RUN_20261010.md`.

**Etapa #42 — revogação (10/10/2026):** migração `20261010008000_pareceres_escrow_revisores_revogacoes_inertes.sql` aplicada somente em STAGING. Indicação de revisor válida 7 dias (laboratório), revogação imutável e veto ao dono de comércio envolvido; diagnóstico reconta pareceres após revogação, mantendo `dupla_aprovacao_financeira=false`, `mfa_recente_comprovado=false`, HOLD e 0 Pix. Tabelas privadas com RLS e sem escrita por `service_role`. **Cadastro de ensaio não é credenciamento/autenticação de pessoa real.** Ver `docs/ASAAS_REVOGACAO_REVISORES_INERTES_20261010.md`.

**Etapa #42 — pré-verificação AAL2 (10/10/2026):** `20261010009000_preflight_sessao_mfa_revisor_inerte.sql` faz autoconsulta sem argumentos de `auth.uid()`, claims JWT de sessão, `auth.sessions` AAL2/fator, token emitido recentemente, não revogação e validade do revisor de ensaio. **Não comprova desafio MFA recente nem cria credenciamento verdadeiro**; os campos `apto_a_registrar_parecer`, `pagamento_autorizado`, `dupla_aprovacao_financeira` e `liberacao_autorizada` continuam sempre `false`. Migração aplicada somente em STAGING, com permissões conferidas. SQL PostgreSQL CI em banco isolado usa mock Auth específico, jamais enviado à nuvem. **CI 12/12** no commit `5cffa4450517b378bc144958b0d9e09ac230cf08` (run 38061793752). Ver `docs/ASAAS_MFA_PREFLIGHT_INERTE_20261010.md`. MFA verdadeiro, duplo parecer autorizado e prova bancária continuam pendentes.

**Etapa #42 — desafio TOTP por fator (10/10/2026):** `20261010010000_preflight_mfa_desafio_fator_sem_prova_sessao.sql` observa `auth.mfa_challenges.verified_at` em até 2 minutos, ligado ao mesmo usuário/fator TOTP verificado que consta da sessão Auth. Como **`auth.mfa_challenges` não contém `session_id`**, essa observação pode ter origem em **outra sessão** do mesmo titular. O retorno informa apenas `desafio_recente_observado_no_fator_sem_vinculo_sessao`; `mfa_com_desafio_recente_comprovado`, `desafio_recente_comprovado_na_sessao_atual`, `pagamento_autorizado` e `apto_a_registrar_parecer` continuam `false`, **HOLD**. CI ensaia fator alheio, desafio antigo, desafio recente e **duas sessões no mesmo fator**; STAGING atualizado sem credenciar ninguém nem mexer em produção. Ver `docs/ASAAS_MFA_VERIFIED_AT_FATOR_SEM_VINCULO_SESSAO_20261010.md`.

**Etapa #42 — nonce documental vinculado à sessão (10/10/2026):** migration `20261010011000_intencao_documental_nonce_sessao_hard_hold.sql` implementa **intenção de consulta somente de ensaio**, com nonce gerado pelo servidor, validade de 5 minutos, vínculo ao revisor, à sessão Auth, à separação de créditos e hashes da versão das evidências. Observação `FOR UPDATE` uma única vez; replay, sessão trocada, prazo vencido, financiamento inconsistente e alteração de dossiê são recusados. **Não comprova step-up MFA na sessão, não habilita parecer/pagamento**, mantém `HOLD_OBRIGATORIO`. Funções privadas **sem EXECUTE ao backend/usuários**, tabelas com RLS e sem SELECT/INSERT público. CI funcional **12/12** commit `61c5b7afcf2284121cbda96dea3da2694aae0711` (run 38063491397). Aplicado somente em STAGING `jbttwihctuibchhcyqtl`: 0 intenções, 0 usos, 0 revisores, 0 pareceres. PR #39 Draft. Ver `docs/ASAAS_NONCE_DOCUMENTAL_SESSAO_HARD_HOLD_20261010.md`.

**Etapa #42 — concorrência real do mesmo nonce (10/10/2026):** teste Python com dois processos `psql` autênticos de PostgreSQL, no clone **descartável** `catalogo_asaas_race_ci`. No cenário A, a segunda sessão fica em lock e recebe `nonce_ja_observado` depois do COMMIT da primeira; no cenário B, o ROLLBACK da primeira permite que a segunda registre a observação. Em ambos os casos, **um único registro**, 2 créditos sintéticos de R$60 cada sem baixa e **zero Pix**. Job financeiro CI `38064302366` aprovado. Acrescentada guarda de contrato Node e atualizado runbook `docs/ASAAS_NONCE_DOCUMENTAL_SESSAO_HARD_HOLD_20261010.md`. **Não prova MFA de sessão, não aprova revisão financeira e não fecha a etapa #42**. Sem novas migrações ou alterações em produção.

**Etapa #42 — contrato step-up MFA isolado (10/10/2026):** protótipo Deno `supabase/functions/_shared/catalogo-asaas-stepup-documental-ensaio.ts` com injeção de provedor Auth **FALSO** valida que `challengeId` é guardado no servidor, associa tentativa a nonce/sessão/usuário/fator e exige nova validação da sessão após `verify`, com limite de 120 segundos e proteção contra replay. **10 testes Deno novos**, fluxo financeiro Deno **41/41**, na CI do código; nenhuma função Edge importa o módulo. O resultado do laboratório `protocolo_mock_validado=true` jamais equivale a MFA real nem a permissão: `desafio_mfa_real_comprovado=false`, `pagamento_autorizado=false`, `HOLD_OBRIGATORIO`. **Não há deploy, migration nova, uso de Auth real ou comprovante bancário novo.** Ver `docs/ASAAS_STEPUP_MFA_PROTOCOLO_OFFLINE_SEM_PIX_20261010.md`.

**Atualizado em:** 10 de outubro de 2026. **Backlog dinâmico:** issues do GitHub prevalecem sobre este documento quando houver edição posterior.
