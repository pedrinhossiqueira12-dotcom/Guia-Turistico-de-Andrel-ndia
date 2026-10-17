# Guia Andrelândia — etapa #42, revogação de pareceres sem autoridade financeira

**10/10/2026 | PR #39 Draft | apenas branch e Supabase STAGING.**

## Problema coberto

O protótipo anterior podia contar duas pessoas diferentes no histórico de
pareceres, embora não houvesse credenciamento ou comprovação de MFA. Também
não existia meio auditável de remover um revisor do total corrente quando
seu acesso precisasse ser revogado. Duas assinaturas em um dossiê **não podem
ser confundidas com duas aprovações financeiras**.

Esta versão conserva o `HOLD_OBRIGATORIO`, sem endpoint de inserção pela Edge,
sem transferência Pix e sem baixa ou liberação de comissões.

## Implementação verificável

Migração: `supabase/pending-migrations/20261010008000_pareceres_escrow_revisores_revogacoes_inertes.sql`.

- `catalogo_asaas_revisores_escrow_ensaio` registra indicações **apenas
  laboratoriais** de revisor, com indicador, motivo e hash SHA-256 de um
  documento de ensaio. Registro pelo PostgreSQL fixa `cadastrado_em` e
  `valido_ate` (7 dias); cliente não consegue falsificar o prazo.
- `catalogo_asaas_revisores_escrow_revogacoes_ensaio` registra revogação
  permanente da indicação, com motivo, autor e hora do servidor. Não altera
  nem apaga pareceres anteriores.
- As duas tabelas possuem RLS e não concedem escrita nem leitura a
  `anon` e `authenticated`. `service_role` tem **somente SELECT**.
  Não há CRUD nem RPC pública para habilitar ou revogar; apenas PostgreSQL
  OWNER pode simular os registros em uma fixture descartável.
- `BEFORE INSERT` do parecer exige indicação vigente e ausência de revogação,
  bloqueando com `23514` a pessoa ausente ou previamente revogada.
  O trigger também recusa **proprietário do comércio ligado a qualquer
  remuneração na separação**.
- Para evitar a corrida entre revogação e novo parecer, o gatilho de ambos
  os fluxos usa `SELECT ... FOR UPDATE` na mesma linha de indicação.
- O diagnóstico `catalogo_asaas_diagnosticar_dupla_conferencia_inerte(uuid)`
  conta apenas pareceres da versão de evidência atual, ainda não expirados,
  assinados por revisores de ensaio vigentes e sem revogação. A existência
  dos pareceres antigos e o número de revisores revogados continuam
  visíveis para investigação. Mesmo com dois registros vigentes, sempre
  retorna `mfa_recente_comprovado=false`,
  `revisores_credenciados_e_autenticados=false`,
  `dupla_aprovacao_financeira=false`, `pagamento_autorizado=false`,
  `liberacao_autorizada=false`, `baixa_realizada=false` e
  `status_operacional=HOLD_OBRIGATORIO`.

## Ensaios automatizados

- Contrato: `tests/catalogo-asaas-revisor-revogacao-inerte.test.cjs`.
- Banco real e descartável:
  `supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql`,
  incluindo autocredenciamento proibido, autoria ausente, datas falsificadas
  corrigidas, dois pareceres independentes da mesma evidência, revogação
  reduzindo o total corrente de 2 para 1, bloqueio de novos pareceres
  do revogado e recusa de UPDATE/DELETE do registro.
- PostgreSQL financeiro e regressões Node/Deno/Chromium executam CI na branch.
- Aplicação de schema somente ao STAGING `jbttwihctuibchhcyqtl`, sob nome
  `asaas_revisores_ensaio_revogacao_efetiva_sem_pix_staging_20261010`.
  Verificadas: 7 triggers ativos nas três tabelas, RLS ativo, 0 nomeações,
  0 revogações, nenhum INSERT do backend.

## Limites inegociáveis antes de aprovação REAL

1. Não confundir cadastro de ensaio com **identidade autenticada**. Nenhuma
   pessoa foi habilitada a aprovar transferências. O `revisor_id` de ensaio
   é submetido somente pelo dono do banco na fixture: não há garantia
   de autoria de um usuário da aplicação.
2. Autenticar individualmente com sessão recente, MFA `aal2` validado,
   identidade da conta e verificação de privilégios no backend.
   Jamais confiar em `user_metadata`, `revisor_id` arbitrário ou
   `service_role` exposto ao cliente.
3. Documentar responsáveis, impedimentos, separação de poderes,
   revogação e segunda revisão humana. Não basta que duas linhas
   tenham UUIDs diferentes.
4. A etapa #41 continua exigindo **prova bancária independente** do destino
   original e da liquidação. Mesmo `DONE` e hash local não autorizam baixa.
5. A etapa #43 exigirá revalidação transacional antes de qualquer pagamento
   e nova aprovação explícita do fluxo de produção. Os pareceres de
   laboratório nunca serão interpretados como autorização.

**Nenhum deploy da Edge, nenhuma alteração em produção, nenhum Pix real.**
