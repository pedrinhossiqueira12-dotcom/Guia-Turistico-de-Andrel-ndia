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
