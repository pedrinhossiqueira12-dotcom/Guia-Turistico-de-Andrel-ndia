# Etapa #41 — Concorrência PostgreSQL: dois pagamentos com mesmo identificador

**Data:** 10/10/2026. **Status:** testes locais descartáveis do PR #39 (Draft).  
**Sem integração com Asaas, Pix, saque ou dados de produção.**

## Risco verificado

`catalogo_asaas_saques.transferencia_id` e
`catalogo_asaas_transferencias_excepcionais_auditoria.transferencia_id`
possuem restrições próprias. A migration
`20261010006000_reserva_regular_nao_reutiliza_id_excepcional.sql` impede
que um **novo saque regular** reivindique ID já usado como evidência
excepcional, mas continua permitindo **evidências tardias** do mesmo ID.

Como os registros são protegidos por locks PostgreSQL, simulações com uma
única sessão e `BEGIN/ROLLBACK` não bastam para demonstrar a serialização.

## Ensaio real de duas sessões

Arquivo: `scripts/validacao-pagamentos/test-asaas-advisory-concurrency.py`.

A CI `.github/workflows/database-tests.yml` monta todas as migrations no
PostgreSQL 17 efêmero e executa a fixture de segurança, depois:

1. Cria o banco `catalogo_asaas_race_ci` por cópia do clone
   `catalogo_asaas_guards_ci`. Nenhum dado real é importado.
2. Abre **duas conexões psql simultâneas e independentes**, coordenadas
   através de `pg_stat_activity.wait_event_type='Lock'` e
   `wait_event='advisory'`. Não usa somente sleeps ou testes sequenciais.
3. No cenário **evidência primeiro, titulares diferentes**, a sessão A
   insere a evidência, mantém transação aberta; a sessão B tenta associar
   o mesmo ID a saque regular de outro titular. O teste exige que B fique
   efetivamente aguardando lock e seja recusada com SQLSTATE **23514**
   após o COMMIT de A. Confirma que o saque não guardou o ID.
4. No cenário **saque primeiro, mesmo titular**, A associa o ID enquanto
   B tenta registrar evidência da solicitação excepcional. B espera,
   depois insere a evidência no banco, mesmo que o ID esteja em saque
   regular. O teste exige que o vínculo cruzado seja preservado como
   conflito **sem alterar `status='reservado'` para `concluido`**.
5. Mesmo com erro, CI usa `trap` para excluir o banco da corrida. O banco
   de validação principal permanece sem os dados sintéticos do teste e
   continua sujeito aos controles originais de contagem.

**Os valores de teste são fictícios:** saques regulares de R$ 120,00 e
solicitações residuais de R$ 25,00, respeitando a faixa legal da tabela
residual (1 a 9.999 centavos). Nenhuma conta bancária ou Pix é usado.

O script interrompe a execução se `PGHOST`, porta, usuário, senha,
banco de origem ou variáveis de conexão corresponderem a algo diferente
do PostgreSQL efêmero da CI. O clone de corrida tem nome fixo, e o
teste valida a presença dos gatilhos originais antes de executar.

## Limitações e próximos critérios

- Duas sessões atestam **esses dois entrelaçamentos concretos**, não provam
  ausência de todos os deadlocks ou races possíveis, nem garantem
  comportamento com muitas requisições simultâneas.
- O cenário com ID bancário cruzado testa a proteção contra duplicidade
  local; **não atesta que o Asaas liquidou Pix real ou que a chave pertence
  ao motoboy original**.
- Ainda faltam prova imutável do destino excepcional original,
  conciliação bancária independente e revisão operacional.
- Nenhuma credencial de produção, URL de projeto remoto ou chave Pix real
  foi disponibilizada ao processo.

**Fonte de referência:** PostgreSQL 17, [advisory locks transacionais](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS),
liberados automaticamente ao terminar a transação.
