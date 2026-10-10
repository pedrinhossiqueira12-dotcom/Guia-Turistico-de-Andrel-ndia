# Guia Andrelândia — desafio MFA persistente INERTE em PostgreSQL

**10/10/2026 | etapa #42 | PR #39 DRAFT | projeto de homologação apenas**

## O que foi criado

Migração `supabase/pending-migrations/20261010012000_stepup_desafio_vinculo_persistente_inerte.sql`.

Tabela `public.catalogo_asaas_stepup_desafios_documentais_ensaio`:
- Um `nonce` **único**, referenciando a intenção documental já persistida.
- Um `challenge_id` **único**, ainda artificial nos testes: a tabela
  não chama nem recebe atestado criptográfico do Supabase Auth real.
- `revisor_id`, `sessao_id`, `fator_id`, `separacao_id`, hash do dossiê,
  finalidade fixa de consulta documental e instante de criação/expiração.
- `estado` com **um único valor permitido**:
  `desafio_emitido_sem_verificacao`. Não existem colunas de aprovação
  ou transição de estado para `verificado`.
- Prazo de até **120 segundos**, mas nunca ultrapassando a expiração
  original do nonce de cinco minutos.

Trigger `catalogo_private.catalogo_asaas_preparar_stepup_desafio_inerte()`:
- Bloqueia a linha da intenção com `FOR UPDATE` para serializar
  emissões concorrentes do mesmo nonce; `UNIQUE(nonce)` e
  `UNIQUE(challenge_id)` impedem duplicidade após o lock.
- Rejeita nonce já observado, expirado ou ausente.
- Exige preflight AAL2 da própria sessão do revisor **de laboratório**,
  validade da indicação experimental e token recente; verifica no
  Auth o fator TOTP `verified` pertencente ao usuário.
- Revalida a integridade da evidência e se os créditos excepcionais
  continuam financiados antes de registrar o desafio de ensaio.
- Reescreve **todos** os campos de identidade, sessão, fator, operação,
  hash, finalidade, estado e horários a partir de registros do servidor.
  Só o `challenge_id` chega como entrada do dono do banco e **não
  contém prova Auth real**.

Segurança: RLS ativo, **nenhum SELECT/INSERT/UPDATE/DELETE aos papéis
`anon`, `authenticated`, `service_role`**, nem EXECUTE da função de
gatilho; UPDATE/DELETE vetados por trigger append-only.
Não há novo endpoint, Edge Function, RPC pública ou acesso ao navegador.

## O que não foi implementado

- **Nenhuma chamada MFA real** (`challenge`/`verify`) ao Auth.
- Nenhuma comprovação de desafio recente na sessão real.
- Nenhum fluxo de validação OTP nem atestado de challenge concluído.
- Nenhum registro de revisor credenciado ou aprovação por duas pessoas.
- Nenhuma alteração de saque, saldo, pagamento, liberação ou baixa.
- Nenhuma integração entre o simulador Deno em memória e esta tabela:
  ambos são protótipos separados; o desafio não sai da CI.

O nome `challenge_id` serve apenas para testar a **unicidade e
vinculação de contexto** do futuro fluxo. Um usuário que consegue
afirmar um UUID nunca poderá obter autorização financeira com isso.
Não usar essa tabela como identidade ou autorização de pagamento.

## Testes de segurança automatizados

A CI cria um PostgreSQL descartável `catalogo_asaas_guards_ci`, usa
as fixtures Auth **falsas** e faz `ROLLBACK` da transação de testes.

Na fixture
`supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql`:
- O banco ignora e corrige dados falsificados de revisor/sessão/fator/
  dossiê/horário; só admite o valor `desafio_emitido_sem_verificacao`.
- Um nonce não aceita dois desafios; um `challenge_id` não pode ser
  reutilizado em outro nonce.
- Outra sessão do mesmo usuário não registra desafio no nonce alheio.
- Um fator TOTP marcado como `unverified` é recusado.
- UPDATE/DELETE do desafio são recusados e as permissões Data API são
  examinadas explicitamente.
- Dois nonces distintos podem receber IDs de desafio distintos sem
  criar provas MFA positivas nem movimentações financeiras.

O teste de contrato
`tests/catalogo-asaas-stepup-desafio-persistente-inerte.test.cjs`
impede remover acidentalmente restrições de RLS, unicidade,
revogação de acesso e estado inerte.

## Status verificado no STAGING

Migração `asaas_stepup_challenge_duravel_sem_verificacao_pix_inerte_staging_20261010`
aplicada **somente no projeto de homologação**
`jbttwihctuibchhcyqtl` após o job PostgreSQL financeiro CI passar.

As verificações após instalação confirmaram:

- RLS ativo; `anon` não tem leitura, `authenticated` não tem
  INSERT e `service_role` não tem SELECT nem INSERT.
- Funções `catalogo_private.catalogo_asaas_preparar_stepup_desafio_inerte()`
  e `catalogo_private.catalogo_asaas_stepup_desafio_imutavel()` sem
  EXECUTE para `anon`, `authenticated` ou `service_role`.
- Ambos os triggers ativados; **zero** políticas RLS que abram acesso.
- **0 desafios, 0 nonces, 0 revisores, 0 pareceres** gravados.
- Nenhuma Edge, transferência, pagamento ou usuário MFA criado.

**Correção de teste:** `LEAST` é expressão especial do PostgreSQL,
sem prefixo `pg_catalog.`; a primeira CI sinalizou a sintaxe
equivocada no clone, corrigida antes da migração no STAGING.
O teste estático foi atualizado com a sintaxe correta e também exige
a verificação do fingerprint dos créditos e hash da matriz.

## Antes de qualquer uso real

1. Habilitar cadastro dos revisores reais e política de MFA por papel;
   **não usar as designações de ensaio**.
2. Desenvolver um backend verificando a sessão com Supabase Auth antes
   do challenge, guardando `challenge_id` em transação segura e
   realizando `mfa.verify` com revalidação do token retornado.
3. Persistir tentativas de **verificação**, contadores, rate limit,
   revogação, expiração, replay e prova de operação específica em
   infraestrutura durável multi-instância. Esta entrega guarda apenas
   **desafios emitidos sem verificação**.
4. Auditar funções `SECURITY DEFINER` e testá-las com tokens reais
   em sandbox separado; o Auth fictício de CI nunca prova assinatura.
5. Manter o bloqueio financeiro até evidência bancária independente
   do beneficiário original (#41), dupla revisão humana confiável
   (#42) e autorização transacional segregada (#43).

**Não mesclar PR #39, não ativar Pix, não utilizar esta tabela como
prova MFA, não alterar produção.**
