# #42 — Reserva persistente pré-MFA em PostgreSQL (laboratório, HOLD)

**Data:** 10/10/2026 · **Ambiente-alvo:** CI descartável e STAGING após validação.
**PR:** #39, DRAFT. **Não autoriza pagamentos, saques, pareceres ou baixa.**

## Problema

O primeiro simulador usava um `Set` de processo para reservar nonce e
desafio. Instâncias diferentes de Edge não compartilham esse objeto. A
proteção do fluxo financeiro não pode depender de memória volátil local.

## Implementação SQL proposta

Arquivo: `supabase/pending-migrations/20261010018000_reservas_prechallenge_compartilhadas_inertes.sql`

Cria três tabelas com RLS sem policies e revogação explícita de
`anon`, `authenticated` e `service_role`:

1. Reserva de contexto AAL1 (um nonce aleatório do servidor por
   `contexto_id`); mutex `SELECT ... FOR UPDATE` na linha do contexto.
2. Registro do desafio recebido de Auth, com `challenge_id UNIQUE`,
   `nonce PRIMARY KEY` e `tentativa UNIQUE`.
3. Consumo de desafio/tentativa, com `challenge_id PRIMARY KEY`,
   `nonce UNIQUE` e `tentativa UNIQUE`; segundo consumo é negado.

São registros **append-only**: UPDATE/DELETE são proibidos inclusive
para o owner SQL pelo trigger de auditoria. Cada etapa revalida o
contexto AAL1, titularidade do fator TOTP verificado na sessão,
indicação de revisor e revogação, validade, saldo segregado, integridade
do dossiê, hash da matriz e financiamento.

As três funções de gravação foram deliberadamente criadas em
`catalogo_private` como **SECURITY INVOKER** e têm EXECUTE revogado
para as roles da Data API. Só são exercitadas pelo owner no clone de CI.
Não existe endpoint público/Edge que as utilize.

## Semântica da operação

- **Reservar início:** exige contexto pré-MFA AAL1 válido e devolve nonce
  único. Repetição de contexto é recusada mesmo entre transações.
- **Registrar desafio:** requer nonce de reserva vigente; um challenge
  não pode ser associado a dois contextos nem a um nonce com dois desafios.
- **Consumir tentativa:** exige par nonce/challenge/tentativa exato e
  revalidação da mesma sessão e evidências antes de qualquer passo de
  autenticação externo. Replay, downgrade de sessão, alterações de
  evidência e expiração são recusados.

**Importante:** o resultado `ok=true` nessas funções significa somente
que um metadado documental de laboratório foi registrado. Todos os
resultados incluem `challenge_go_true_verificado=false`,
`desafio_mfa_da_sessao_comprovado=false`,
`pagamento_autorizado=false`, `baixa_realizada=false` e
`HOLD_OBRIGATORIO`. O banco nunca vê OTP/bearer/refresh token.
Nenhuma função se conecta a GoTrue, Asaas ou serviços financeiros.

## Validação e limites

- Regressão SQL em `supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql`:
  dois contextos AAL1 sintéticos, nonce duplicado, challenge duplicado
  entre contextos, tentativa adulterada, consumo único/replay, downgrade
  de elegibilidade após alterar a sessão e imutabilidade.
- Regressão Node em
  `tests/catalogo-asaas-prechallenge-persistente-inerte.test.cjs`:
  verifica estrutura, privilégios e invariantes de HOLD.
- CI executa PostgreSQL descartável sem network/pagamento.

**Ainda NÃO é um sistema MFA real.** Falta a integração de um backend
server-side confiável que una de forma auditável JWT assinado,
`auth.sessions`, `auth.mfa_factors`, `mfa.challenge`/`mfa.verify`,
nonce da operação, o par de revisores independentes e a decisão
financeira transacional. Essas funções owner-only intencionalmente
não aceitam JWT de cliente nem autorizam etapa financeira.

**Não aplicar à produção, não publicar Edge financeira nem enviar Pix.**
As pendências #41 (titularidade bancária) e #43 (segregação/autorização)
continuam impedindo go-live.


## Aplicacao e auditoria exclusiva do STAGING — 10/10/2026

- Projeto de homologacao Supabase: jbttwihctuibchhcyqtl.
- A migracao pendente no GitHub foi instalada exclusivamente neste projeto
  com nome asaas_prechallenge_reservas_duraveis_owner_only_hold_staging_20261010.
- Execucao anterior do GitHub Actions 38079327895 aprovada: 12/12 jobs,
  com teste financeiro PostgreSQL real, Node, Deno, pgTAP e smoke frontend.
- Auditoria de metadados do PostgreSQL depois da instalacao: as tres
  tabelas existem com relrowsecurity=true, uma trigger append-only ativa
  cada, sem privilege SELECT/INSERT/UPDATE/DELETE para anon, authenticated
  ou service_role. UNIQUE/PK de nonce, challenge e tentativa presentes.
- Cinco funcoes privadas revisadas: todas SECURITY INVOKER; EXECUTE negado
  para anon, authenticated e service_role.
- Auth real em homologacao: zero fatores TOTP verified. Nenhum reviewer MFA
  foi simulado no STAGING. Tres novos registros: 0 reservas, 0 desafios,
  0 consumos. Nao foi armazenado OTP ou token.
- Testes negativos read-only de nonce/contexto/challenge/tentativa ficticios
  receberam respectivamente contexto_aal1_invalido,
  reserva_expirada_ou_invalida, challenge_sessao_ou_tentativa_divergente.
  Todos retornaram HOLD_OBRIGATORIO e pagamento_autorizado=false.
- Security Advisor posterior: 3 novos avisos INFO
  rls_enabled_no_policy (proposital para tabelas privadas sem acesso),
  alem de avisos preexistentes de catalogo_status_publicacao e
  leaked-password-protection. Nenhuma concessao publica financeira nova.

STAGING nao tem fator real e nao existe backend GoTrue/MFA conectando
essas funcoes; portanto nao foi possivel comprovar MFA real ou permissao
financeira. CI testa a escrita com usuarios ficticios em banco descartavel,
nao cria fatores fake no projeto de homologacao.

**Supabase PROD nao foi acessado ou alterado; nao houve fatura, Pix, saque,
baixa, publicacao de Edge nem merge. PR #39 permanece DRAFT / HOLD.**
