# Guia Andrelândia — livro transacional de tentativas MFA, sem MFA real

**10/10/2026 | #42 | PR #39 Draft | HOLD OBRIGATÓRIO**

## O que foi implementado

Migração: `supabase/pending-migrations/20261010013000_tentativa_stepup_unica_limiter_inerte.sql`.

A tabela privada `catalogo_asaas_stepup_tentativas_inertes`
registra **apenas a reserva fictícia** de uma tentativa sobre um
`challenge_id` já gravado. O `challenge_id` é chave primária, e
`nonce` é também único. O resultado SQL só pode ser
`tentativa_reservada_sem_verificacao`: jamais aprovado, verificado,
apto para parecer ou liquidado. Não há colunas OTP ou segredo MFA.

A função privada
`catalogo_private.catalogo_asaas_reservar_tentativa_stepup_inerte(uuid)`
não recebe OTP, não chama Supabase Auth, não executa Pix e não usa
`service_role` da aplicação. Ela executa apenas no contexto
PostgreSQL owner controlado por fixtures de CI.

Um `pg_advisory_xact_lock` por UUID do revisor serializa tentativas,
inclusive sobre *diferentes* nonces. Depois disso, a função obtém
`SELECT ... FOR UPDATE` do desafio e verifica sua ausência no
livro antes do INSERT. A sequência impede o conflito entre COUNT
e INSERT de tentativas simultâneas para o mesmo revisor.

Uma única tentativa pode ser reservada por challenge; uma repetição
retorna `tentativa_ja_registrada`. No máximo **três reservas distintas
por revisor na janela móvel de uma hora** são aceitas. A quarta retorna
`limite_tres_por_hora`. A política é propositalmente restritiva em
laboratório; futuras políticas reais exigem discussão de suporte,
recuperação de MFA e prevenção de bloqueios abusivos.

Cada reserva revalida antes de registrar:
- Sessão no Supabase Auth, `aal2`, identidade própria e indicação
  de revisor de **ensaio** ainda vigente/não revogada.
- Mesmo `user_id`, `session_id` e `factor_id` do desafio original,
  com fator TOTP em estado `verified`. `aal2` não comprova step-up
  recente nem momento do desafio.
- `nonce` e challenge dentro de suas janelas, nonce ainda não
  observado, mesmo escrow, hash final do dossiê, hash da matriz e
  fingerprint dos créditos.
- Reserva financeira continua congelada, consistente e financiada.

## Privacidade, privilégios e segurança operacional

A tabela tem RLS ligado, **sem qualquer SELECT/INSERT/UPDATE/DELETE
concedido a `anon`, `authenticated` ou `service_role`**. A função
é `SECURITY DEFINER SET search_path=''`, também sem EXECUTE aos
papéis da Data API. Os triggers impedem UPDATE e DELETE do log.

As ações **não criam nem verificam nenhum fator MFA real**. Os testes
autenticam de maneira falsa usando `request.jwt.*` em um banco
efêmero chamado `catalogo_asaas_guards_ci` ou
`catalogo_asaas_race_ci`. Isso não equivale a usar GoTrue ou
PostgREST reais. O mecanismo é uma guarda adicional de laboratório,
não uma aprovação de segurança em produção.

Mesmo se a reserva fictícia retorna `ok=true`, a resposta sempre
contém `desafio_mfa_da_sessao_comprovado=false`,
`verificacao_otp_realizada=false`, `pode_registrar_parecer=false`,
`dupla_aprovacao_financeira=false`, `pagamento_autorizado=false`,
`baixa_realizada=false`, `movimenta_dinheiro=false`,
`liberacao_autorizada=false` e `HOLD_OBRIGATORIO`.

## Testes

Em `supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql`,
numa transação que termina em ROLLBACK: rejeição de outra sessão,
um único registro por challenge, replay negado, fator desativado,
quota de três por hora e quarta tentativa recusada; triggers
append-only e privilégios testados.

`scripts/validacao-pagamentos/test-asaas-advisory-concurrency.py`
inclui cenário de duas conexões PostgreSQL `psql` reais, sem acesso
à Internet nem contas reais, para:
- Commit da transação A enquanto B espera no `Lock:advisory` e
  depois encontra o desafio já utilizado.
- Rollback da transação A enquanto B espera; B assume a tentativa
  sem duplicação.
- Duas outras tentativas para completar o teto de 3/h, com a quarta
  sendo recusada pelo banco, preservando 0 saques reais.

Teste de contrato Node:
`tests/catalogo-asaas-stepup-tentativa-limiter-inerte.test.cjs`.

## Próximo incremento — trabalho ainda pendente

**Não existe fluxo real de `mfa.verify` ligado a essa tabela.**
É necessário implementar, auditar e testar autenticação MFA real
em cada sessão; gravação de resultado do provedor vinculada à ação
específica; proteção de OTP contra vazamento e brute-force;
revogação de dispositivo/fator; isolamento das funções `SECURITY
DEFINER`; revisor independente e dupla aprovação financeira.

A etapa #41 ainda exige evidência bancária independente do Pix
original; #43, autorização transacional e revisão de alçadas.
Sem esses requisitos **nenhum pagamento pode sair de HOLD**.

**Somente STAGING, sem publicação Edge ou merge, e produção intocada.**
