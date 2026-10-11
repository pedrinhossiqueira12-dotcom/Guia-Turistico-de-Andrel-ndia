# Etapa #43 — Ensaio inerte de resolução de reservas excepcionais (11/10/2026)

## Objetivo

Modelar os **quatro estados finais ou de investigação** de um saldo excepcional — `revisao`, `contestacao`, `pago_comprovado` e `liberado_sem_pagamento` — sem abrir nenhum caminho executável para pagamento, devolução ou baixa.

O artefato `scripts/validacao-pagamentos/simular-resolucao-escrow-inerte.cjs` é **uma função pura de CI**. Não é uma Edge Function nem uma RPC, não lê o Supabase nem o Asaas, não altera uma reserva, não consulta conta bancária e **não pode comprovar fatos externos**. Os rótulos `pago_comprovado` e `liberado_sem_pagamento` aparecem apenas como **estados futuros modelados**, nunca como resultado de execução. A classificação observada se restringe a `revisao` e `contestacao`.

## Contratos exercitados no laboratório

1. A separação deve estar `congelada` com valor positivo, inteiro e seguro em centavos. A amostra contém `remuneracao_id`, `valor_centavos` e `competencia` em cada linha.
2. A função **não corta as primeiras 1.000 remunerações**. Soma toda a lista recebida usando `BigInt`, detectando valores inválidos, centavos excedendo precisão segura, IDs duplicados, competência irregular, soma divergente e contagem de amostra diferente da contagem declarada.
3. A contagem `contagem_creditos_no_livro`, mesmo coincidente, **não prova que todas as páginas do banco foram lidas**. Apenas compara dois números fornecidos ao ensaio; `cobertura_integral_do_livro_comprovada=false` sempre.
4. Modela saldos abaixo de R$ 100 sem os descartar e carteiras acima de R$ 5.000 sem as limitar. O teto de R$ 5.000 é apenas uma referência por **Pix individual no protótipo**, não um teto da carteira nem uma autorização de saque.
5. Estados bancários `DONE`, `PENDING`, `FAILED`, `CANCELLED` são observações não confiáveis para quitação. `DONE` com `FAILED/CANCELLED` sinaliza investigação como `contestacao`; `DONE` isolado continua `revisao`. Ausência de GET não comprova ausência de Pix anterior.
6. Todas as saídas são `HOLD_OBRIGATORIO` com `pagamento_autorizado=false`, `liberacao_autorizada=false`, `baixa_realizada=false`, `movimenta_dinheiro=false`. Inputs alegando aprovações, dados bancários ou beneficiário confirmado são **ignorados**. Saída não inclui ID, CPF nem chave Pix.

## Testes CI

`tests/catalogo-asaas-resolucao-escrow-inerte.test.cjs` é executado automaticamente pelo `npm test` do GitHub Actions. Contém casos de 1.601 e 1.801 remunerações, três competências, carteira abaixo do mínimo, carteira acima de R$ 5.000, soma com `BigInt`, duplicidade, inconsistência de contagem, estados contraditórios, entradas falsas que alegam aprovação, determinismo, imutabilidade e ausência de acesso externo.

## Pendências críticas antes de qualquer movimentação (#43)

- [ ] Realizar **leitura autoritativa de TODOS os créditos** diretamente no PostgreSQL com cursor/locks adequados, não a partir de array enviado pelo browser; validar ausência de duplicidade e lacunas de paginação.
- [ ] Comprovar **independentemente** pagamento, beneficiário Pix original ou inexistência de Pix pendente (#41). O Asaas Sandbox e um GET paginado não bastam.
- [ ] Conectar **dois revisores habilitados** com MFA válido, sessões reais e segregação de funções (#42), incluindo renovação/revogação.
- [ ] Projetar e testar migração de estados e baixa/liberação **atômica por remuneração**, com locks comuns, proteção idempotente contra replay, concorrência, estorno, compensação e recuperação de falha.
- [ ] Validar totais de remunerações com mais de 1.000 registros, vários meses de retenção e saldo abaixo de R$ 100 **no banco**, não apenas neste ensaio.
- [ ] Requer autorização contratual e regularização antes de piloto controlado (#45), revisão de segurança de go-live (#44) e aprovação explícita do usuário.

**Estado de entrega:** somente branch do PR #39, mantido DRAFT. `HOLD_OBRIGATORIO`. Sem merge, implantação da Edge financeira, migração de resolução, saque/PIX real, alterações no Supabase de produção ou confirmação de quitação.

## Incremento PostgreSQL real descartável — 11/10/2026

A fixture `supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql` passou a definir, **dentro de uma transação de CI**, a função `pg_temp.catalogo_asaas_previsualizar_resolucao_inerte(uuid)`. A função não está numa migração e não é disponibilizada por REST, Edge Function ou SQL de produção. O `ROLLBACK` final desfaz todas as linhas sintéticas; o esquema `pg_temp` não permanece instalado.

O preview consulta exclusivamente tabelas reais do PostgreSQL efêmero, sem usar array de créditos do cliente:

- Busca a titularidade da separação, adquire o advisory lock transacional `asaas-saque:<motoboy UUID>` e trava a linha da separação.
- Em uma CTE `MATERIALIZED`, lê **todos** os itens da separação e suas remunerações com `FOR UPDATE OF i,r`, sem `LIMIT` nem `OFFSET`.
- Conta créditos, soma os centavos com `numeric`, reconstrói a fingerprint SHA-256 ordenada por remuneração e verifica titular, valor atual, status, financiamento, repasse e prova de financiamento do pedido.
- A fixture usa dois créditos sintéticos válidos (R$ 120) e depois revoga o financiamento de um deles: o segundo diagnóstico deve marcar `contestacao` e manter HOLD, sem baixa.

**Limites não resolvidos:** o teste SQL ainda não estressa 1.000+ linhas em uma reserva efetiva; a simulação Node exercita até 1.801 itens, mas não prova comportamento de locks/tempos sob concorrência real. Nem a consulta transacional local equivale a extrato bancário independente. Nenhuma função efetiva de resolução foi publicada. Antes de uma migração de produção será necessário ensaio SQL com alto volume, múltiplas conexões, dados reais anonimizados, revisão de segurança, prova do destinatário original (#41) e autorização dos revisores (#42).

**Tudo permanece `HOLD_OBRIGATORIO`, com `pagamento_autorizado=false`, `liberacao_autorizada=false` e `baixa_realizada=false`. Nenhum Pix é enviado.**

## Ensaio de alto volume e duas sessões — 11/10/2026

- **Volume real no clone PostgreSQL da CI:** a fixture de `supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql` insere **1.201 pedidos, 1.201 comissões e 1.201 remunerações** em duas competências (601 + 600), com fechamentos, componentes da fatura, cobranças fictícias pagas e financiamento verificado pelo esquema local. As linhas são sintéticas e todas desaparecem no `ROLLBACK`; não se criam cobranças no Asaas.
- **Escopo do teste de volume:** a separação de 1.201 itens é montada **diretamente com linhas sintéticas** no PostgreSQL descartável, após conferir contagem, soma e fingerprint. Ela **não** executa 1.201 vezes a RPC de reserva: essa RPC continua testada separadamente com dois créditos reais de CI. O ensaio de 1.201 registros testa especificamente o leitor transacional e suas verificações HOLD, sem produção ou transferência externa.
- Para manter a CI repetível, os pedidos e componentes são gerados por operações SQL **set-based** (`generate_series` e `INSERT ... SELECT`), e não 1.201 loops de requisições; a conferência final continua lendo cada remuneração da reserva por `FOR UPDATE` numa CTE `MATERIALIZED`, **sem LIMIT/OFFSET**, verificando 1.201 créditos, valor total exato e HOLD.
- **Concorrência em duas conexões PostgreSQL:** o script já existente `scripts/validacao-pagamentos/test-asaas-advisory-concurrency.py` instala a mesma função `pg_temp` apenas na conexão de ensaio, enquanto outra sessão mantém o mutex `asaas-saque:<motoboy>`. O diagnóstico deve realmente **esperar o advisory lock** e continuar congelado tanto após `COMMIT` quanto após `ROLLBACK` da primeira transação. O teste também verifica a ausência de saque comum criado.
- Estas verificações **não são uma migração de resolução**, não autenticam revisores reais, não comprovam transferência externa nem habilitam Pix. O laboratório usa banco de CI descartável, não STAGING nem PROD. Nenhum código desta etapa pode mover dinheiro.

**Ainda pendente para finalizar #43:** produção de extratos/conciliação independente (#41); MFA e dupla aprovação de responsáveis reais (#42); projeto e validação da máquina de estados, transações de baixa/liberação idempotentes, compensação e recuperação; revisão de segurança e piloto autorizado. Os limites acima dizem respeito a testes, não a garantias de produção.

## Incremento de idempotência documental com duas sessões — 11/10/2026

O novo `supabase/tests/isolated/catalogo-asaas-resolucao-idempotencia-race-inerte.sql` é **uma fixture, não uma migração**. Existe somente no banco `catalogo_asaas_race_ci` do GitHub Actions e exige uma configuração de laboratório presente na sessão. A criação de schema/tabela/função é rejeitada em qualquer outro banco. O clone é destruído ao final do job. Não há grants para `anon`, `authenticated` nem `service_role`; nenhuma aplicação ou Edge financeira chama essa fixture.

A fixture contém um livro **append-only de decisões puramente documentais** (`revisao` ou `contestacao`). O banco trava primeiro o mesmo mutex `asaas-saque:<titular>`, depois a linha da reserva, confere `situacao='congelada'` e sua fingerprint local e só então olha a tentativa e a versão. Duas restrições únicas impõem:

- **Mesma `tentativa_id`, mesmos dados e versão:** retorno idempotente, sem nova linha; não equivale a segunda revisão, aprovação financeira ou pagamento.
- **Mesma `tentativa_id` com classificação/escrow diferentes:** conflito, sem escrita.
- **Outro identificador para a mesma separação+fingerprint:** conflito, sem escrita.
- **Tentativa em transação que sofreu `ROLLBACK`:** uma segunda sessão que aguardou o mutex pode registrar apenas **uma** linha documental; testes confirmam não haver registro duplicado.
- **Tentativa de classificar como `pago_comprovado` ou liberar:** entrada inválida e HOLD, já que só `revisao/contestacao` são permitidos.
- **UPDATE/DELETE:** proibidos por trigger de laboratório.

O cenário `scenario_resolucao_documental_idempotente_concorrente()`, no script de testes com duas sessões PostgreSQL reais, verifica espera pelo mutex, COMMIT, replay, troca de dados, reutilização de identificadores, ROLLBACK e ausência de saques; contrato Node adicional detecta regressões no isolamento da fixture.

**Limite fundamental:** esse livro não prova pagamento, ausência de Pix anterior, identidade bancária, consentimento, MFA nem dupla aprovação. Sua singularidade não demonstra idempotência de uma transferência real no Asaas. A futura resolução transacional de créditos permanece bloqueada por #41, #42 e pelas demais tarefas de #43. Nenhuma tabela de produção, crédito ou saldo é modificado por esta etapa.

**Toda resposta tem `HOLD_OBRIGATORIO`, `pagamento_autorizado=false`, `liberacao_autorizada=false`, `baixa_realizada=false` e `movimenta_dinheiro=false`.**
