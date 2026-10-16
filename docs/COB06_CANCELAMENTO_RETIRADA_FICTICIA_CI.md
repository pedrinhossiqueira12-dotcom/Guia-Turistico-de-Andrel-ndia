# COB-06 — encerramento auditado de retirada fictícia (CI-only)

Estado em 16/10/2026: **protótipo isolado em PR #39 Draft; não implantado**.

## Fato constatado no STAGING (somente leitura)

Pedido `a4ca7c4e-465f-4342-ae18-5c7eea1dec15`, comércio de testes `asaas-cob02`: retirada em dinheiro de R$ 100,00, já aceita e pronta; pagamento pendente; código de entrega expirado; comissão integral de R$ 7,00 aberta (não faturada), nenhum componente na fatura paga, nenhuma remuneração/logística de motoboy. O usuário confirmou explicitamente que o pedido foi criado pelo assistente, é inteiramente fictício, sem entrega ou recebimento de dinheiro. **Essa confirmação humana não prova automaticamente o estado de pagamentos externos.**

A operação administrativa atual `resolver_ocorrencia` apenas registra a revisão e **não muda o pedido ou a comissão**. Usá-la, por si só, não constitui cancelamento. Não alterar manualmente `status` em uma coluna isolada.

## O que o protótipo testa

Arquivos:

- `supabase/production-candidate/15_cob06_cancelamento_retirada_ficticia_somente_ci.sql`: função **privada** e protegida por `current_database()='catalogo_cob06_ci'`; não invocável por `anon`, `authenticated` ou `service_role`. Requer administrador, ocorrência de cancelamento aberta e confirmação expressa de não recebimento.
- `supabase/tests/isolated/asaas-cob06-cancelamento-retirada-ficticia-rollback.sql`: pedido e fatura sintéticos em transação com `ROLLBACK`.
- `.github/workflows/database-tests.yml`: exige falha ao tentar instalar fora do clone e testa não persistência da fixture.

Condições indispensáveis no protótipo: pedido V2 offline de **retirada em dinheiro**, aceito e pronto, código expirado e não utilizado, nenhum valor recebido, nenhum motoboy, taxa de 7% integralmente de plataforma, comissão `aberta`, único lançamento `retido`, nenhuma cobrança faturada, pagamento/reembolso, componente de fatura, logística ou remuneração. Pedido, comissão e livro são bloqueados/inspecionados na mesma transação, incluindo lock de fechamento financeiro.

Efeito **somente na fixture CI** quando elegível: pedido `cancelado`, comissão `cancelada`, lançamento `estornado`, ocorrência revisada e evento administrativo com ID do pedido e referência de auditoria. **Fatura anterior paga permanece byte a byte idêntica**. Uma segunda tentativa deve ser rejeitada sem evento duplicado.

Os testes negativos cobrem usuário não autorizado, ausência de confirmação, decisão incorreta, código ainda válido, pagamento aprovado, componente numa fatura paga, reserva logística e pagamento registrado.

## Impedimentos de publicação

1. O arquivo 15 é deliberadamente não instalável em STAGING/PROD; a função não está integrada à Edge e a lacuna no fluxo `resolver_ocorrencia` real continua aberta.
2. Antes de promover: revisar concorrência, política e autorização JWT/service role, trilha de auditoria, estados de reembolso e impacto sobre outras modalidades; gerar **migration definitiva separada**, feature flag inicialmente desligada e testes de integração.
3. Antes de qualquer cancelamento real, obter autorização específica para o ID do pedido e executar novo preflight **somente leitura** de pagamento, cobrança, comissão, logística e fatura para detectar mudanças ocorridas desde a inspeção.
4. Nunca cancelar pedidos que possuam pagamento recebido, componentes faturados, entrega confirmada, motoboy ou qualquer saldo liberado, mesmo sob justificativa de teste.
5. COB-06 emissão/acúmulo Asaas permanece HOLD. Não executar Pix, repasse, saque, reconciliação externa, deploy/merge ou dados PROD neste trabalho.

A aprovação do usuário de que o pedido é fictício **autoriza preparar e testar a correção**, não constitui registro de recebimento financeiro nem executa alterações no STAGING.


## Avanço: candidata STAGING-QA com flag desligada (ainda não implantada)

- `supabase/production-candidate/16_cob06_cancelamento_retirada_qa_staging_pendente.sql` replica o motor transacional validado para RPC pública com EXECUTE exclusivo de `service_role`; nega `anon` e `authenticated`. No clone CI permite apenas a fixture UUID terminada em `c606`. No banco `postgres` exige o UUID exato do pedido STAGING `a4ca7c4e-465f-4342-ae18-5c7eea1dec15`, comércio `asaas-cob02`, versão 2, retirada, pagamento pendente e status pronto. Qualquer outro pedido é barrado. **Não foi instalada em Supabase remoto.**
- `supabase/functions/catalogo-entregas/index.ts` adiciona ação interna `cancelar_retirada_ficticia_qa` somente para JWT do administrador, URL STAGING exata, comércio/pedido fixos, decisão legítima, motivo fundamentado e confirmação expressa de **nenhuma entrega e nenhum recebimento**. A variável `COB06_QA_CANCELAMENTO_HABILITADO` exige exatamente `true`; ausente ou em outro valor bloqueia a RPC. Nenhuma interface pública oferece a ação.
- `tests/catalogo-v2-roteadores.test.cjs` cobre motoboy/comércio, PROD, flag ausente, UUID errado, identidade forjada e falta de atestado.
- `supabase/tests/isolated/asaas-cob06-cancelamento-retirada-qa-publica-rollback.sql` cobre permissões, escopo do UUID, bloqueios financeiros, fatura preservada e rollback.

A existência da candidata no PR **não** implica execução nem disponibilidade no STAGING. Sequência exigida: CI integral verde, revisão de SQL/Edge, preflight somente leitura de pedido/ocorrência/fatura, decisão específica sobre aplicação em STAGING, instalação controlada, habilitação temporária e explícita da flag para uma ação única autorizada, desabilitação da flag e conciliação final.

A operação é exclusiva de uma retirada fictícia identificada. O fluxo geral `resolver_ocorrencia` continua exigindo projeto separado para pagamentos confirmados, motoboys e reembolsos.
