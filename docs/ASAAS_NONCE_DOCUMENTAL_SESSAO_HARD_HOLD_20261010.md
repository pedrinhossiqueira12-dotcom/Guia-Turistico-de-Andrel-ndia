# Etapa #42 — nonce de intenção documental vinculado à sessão, sem autorização financeira

**Guia Andrelândia | 10/10/2026 | PR #39 Draft | HOLD obrigatório**

## Propósito

A autenticação Supabase `aal2` e a existência de uma verificação
`auth.mfa_challenges.verified_at` recente no mesmo **fator** não
comprovam qual **sessão** realizou o desafio. É especialmente perigoso
quando duas sessões compartilham o mesmo fator TOTP.

Esta entrega cria somente uma infraestrutura *inerte* para vincular,
por prazo curto, **uma intenção de consulta documental** ao usuário,
à sessão Auth e à versão exata das evidências. Não verifica MFA
step-up recente. Não aprova saques, não permite criar pareceres e
não faz chamadas à API de pagamentos.

## Componentes (PostgreSQL)

Migração:
`supabase/pending-migrations/20261010011000_intencao_documental_nonce_sessao_hard_hold.sql`.

- `public.catalogo_asaas_intencoes_mfa_documentais_ensaio` guarda
  `nonce` **UUID gerado pelo próprio PostgreSQL**, `revisor_id`,
  `sessao_id`, `separacao_id`, a finalidade fixa
  `consulta_documental_ensaio`, hash do conjunto de créditos,
  sequência/hash final do dossiê, SHA-256 da matriz financeira,
  criação e expiração **cinco minutos após o registro**.
- `public.catalogo_asaas_usos_nonce_documentais_ensaio` guarda
  no máximo **uma observação documental por nonce**, exigida
  pela chave primária em `nonce`.
- Ambas as tabelas têm RLS e não concedem sequer SELECT ou
  INSERT para `anon`, `authenticated` ou `service_role`.
  UPDATE e DELETE são recusados por triggers append-only.
- Funções `catalogo_private.catalogo_asaas_iniciar_intencao_mfa_documental_ensaio(uuid)`
  e `catalogo_private.catalogo_asaas_observar_nonce_documental_ensaio(uuid)`:
  são **SECURITY DEFINER PRIVADAS, SEM GRANT a usuários nem backend**.
  Somente o proprietário PostgreSQL, em testes controlados e isolados,
  chama essas rotinas. Não existe endpoint para criá-las ou consumi-las.
- A criação exige uma sessão coerente na autoconsulta anterior,
  indicação de ensaio vigente, escrow congelado, dossiê íntegro,
  créditos financiados e ausência de conflito de interesses direto.
  O nonce **nunca é escolhido pelo cliente**.
- A observação usa `SELECT ... FOR UPDATE` na linha do nonce;
  a primeira pode registrar apenas `vinculo_documental_observado`.
  Tentativas subsequentes recebem `nonce_ja_observado`; mudança
  de sessão, revisor revogado, expiração, falta de financiamento
  ou mudança de versão de evidência impedem a observação.

## Limites que NÃO podem ser ignorados

O par `(session_id, nonce)` prende a **intenção documental** à
sessão apresentada. **Não há prova verificada de MFA recente para
essa sessão**, nem autorização de duplo aprovador real.

Uma nova API de aprovação jamais deve considerar `nonce_observado_uma_vez`
equivalente a MFA aprovado, a prova de beneficiário original, a
quitação bancária ou permissão de Pix. As funções atuais retornam
sempre `desafio_mfa_da_sessao_comprovado=false`,
`pode_registrar_parecer=false`,
`pagamento_autorizado=false`, `liberacao_autorizada=false`,
`baixa_realizada=false` e `status_operacional=HOLD_OBRIGATORIO`.

O mock de JWT da CI não verifica assinatura criptográfica e nunca
deve ser usado em ambiente real. Mesmo com JWT autêntico, `aal2`
só identifica a garantia MFA da sessão e não a hora da prova
step-up da operação específica.

## Homologação verificada

- **STAGING** `jbttwihctuibchhcyqtl`, migration
  `asaas_nonce_documental_sessao_nao_libera_pix_staging_20261010`
  aplicada somente às tabelas e rotinas inertes. Nenhum endpoint
  HTTP, pagamento ou Edge Function foi instalado.
- Duas tabelas com RLS ativo; `anon`, `authenticated` e
  `service_role` sem SELECT/INSERT direto. Funções privadas
  sem `EXECUTE` pelos três papéis.
- Ambos os gatilhos append-only foram confirmados habilitados.
  Contagens após instalação: **0 intenções, 0 usos, 0 pareceres,
  0 revisores**.
- CI funcional **12/12**: commit `61c5b7afcf2284121cbda96dea3da2694aae0711`,
  [run 38063491397](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/38063491397).
  Código executado no banco descartável sem chamadas a API real.

## Testes e critérios de segurança

- Teste SQL em transação descartável:
  `supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql`.
  Simula nonce sem JWT (recusado), emissão com dois revisores de
  laboratório, sessão B tentando usar nonce da sessão A (recusado),
  uso único e replay (recusado), nonce expirado (recusado), alteração
  de dossiê (recusada), tentativa de sobrescrever sessão e apagar
  consumo (ambas recusadas).
- Teste de contrato Node:
  `tests/catalogo-asaas-intencao-documental-nonce-hard-hold.test.cjs`,
  garante gates, RLS, restrição de acesso e saída sempre financeira negativa.
- Banco `catalogo_asaas_guards_ci` com mock Auth criado via
  `supabase/tests/baseline/catalogo-asaas-auth-mfa-ephemeral.sql`;
  todos os registros de credenciais, escrows, usuários e saldos são
  fictícios e descartados por ROLLBACK. Proibidos tokens de produção
  e quaisquer chamadas externas.
- **Concorrência real do mesmo nonce validada** no clone descartável
  `catalogo_asaas_race_ci`, usando duas conexões `psql` independentes
  e observando em `pg_stat_activity` a espera de bloqueio de linha /
  transação (`Lock:transactionid` ou `Lock:tuple`).
  Script: `scripts/validacao-pagamentos/test-asaas-advisory-concurrency.py`.
  Foram executadas duas provas:
  1. A transação A observa primeiro e **COMMIT**; B aguarda a trava,
     recebe `nonce_ja_observado`, e apenas um uso fica persistido.
     Os dois créditos fictícios de 6.000 centavos permanecem
     `disponivel`/separados, sem repasse/saque.
  2. A transação A observa primeiro e **ROLLBACK**; B aguarda a trava,
     prossegue e grava a observação documental **uma única vez**.
     Não pode haver perda nem duplicação após rollback.
- O teste também exige `PGHOST=localhost`, `PGDATABASE=catalogo_ci`,
  `PGUSER=postgres`, senha local de CI, ausência de variáveis de
  credenciais remotas e nome exato do clone. Os dois fluxos não
  acessam Asaas, Supabase remoto, API de Pix ou contas reais.
- **CI funcional 12/12:** commit
  `c5d8c97708dcb391cf9f04a52e2a3951ebc2f9f7`,
  execução [38064302366](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/38064302366):
  o job PostgreSQL financeiro aprovou os dois cenários com logs
  `PASS`; confirmação total do workflow depende do fechamento dos
  demais jobs na mesma execução.
- A prova testa atomicidade de **observação documental**, não valida
  autenticação real: o CI simula claims JWT através de GUCs do
  PostgreSQL local, executa a função como dono da base e nunca
  comprova step-up MFA recente. Ainda é necessária revisão de
  riscos de lock/deadlock para qualquer endpoint futuro.

## Bloqueios futuros da #42/#41

1. Definir os revisores humanos reais e MFA individual com prova
   diretamente do Auth da sessão, vinculada a um challenge/nonce de ação
   controlado pelo servidor e impedido de ser reproduzido.
2. Aprovar desenho de segunda revisão efetivamente independente,
   separando papel de investigações, autorizações e execuções.
3. Obter evidência bancária **independente** do beneficiário Pix
   original e da ausência de duplicidade (#41).
4. Implementar e revisar a revalidação transacional de alçadas,
   créditos e pagamento separado do mecanismo de parecer (#43).
5. Auditar o risco `SECURITY DEFINER` das funções de autoconsulta.
   Esta migration não adiciona endpoint e não modifica as grants antigas.

**PR Draft. Sem ativar Pix, sem pagar ou baixar comissões, sem merge
ou deploy de Edge financeira e sem mudanças em produção.**
