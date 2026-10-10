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
| [#41](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/issues/41) | 2/6 — Conciliação bancária e destinatário Pix | **EM DESENVOLVIMENTO** | Matriz de conflitos em homologação; titularidade e prova bancária seguem pendentes |
| [#42](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/issues/42) | 3/6 — Autorização/dupla conferência | **PENDENTE** | #41, autorização apropriada |
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
2. Prosseguir #41: validar a matriz somente-leitura e a trilha de evidências; obter especificação e prova da identidade do destinatário original. Manter HOLD sempre que o provedor não comprovar os detalhes.
3. Paralelizar revisão de #46, #47, #48 e #54 sem liberar produção.

**Atualizado em:** 10 de outubro de 2026. **Backlog dinâmico:** issues do GitHub prevalecem sobre este documento quando houver edição posterior.
