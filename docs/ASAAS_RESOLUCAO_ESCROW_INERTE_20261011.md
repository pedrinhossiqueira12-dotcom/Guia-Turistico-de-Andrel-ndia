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
