# COB-06 — retirada fictícia (CI e STAGING restrito)

Estado em 16/10/2026: **RPC candidata 16 e Edge exclusiva implantadas apenas no STAGING; bloqueio por flag confirmado. Nenhum cancelamento executado. PR #39 continua Draft.**

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

## Identidade real de revisao no STAGING (16/10/2026)

O convite para `pedrinhossiqueira12@gmail.com` foi aceito. A consulta **somente leitura** em `auth.users` no projeto STAGING `jbttwihctuibchhcyqtl` confirmou `id=d896cc0c-31e4-4ef7-8fa4-13d15f02dd2a`, `email_confirmed_at` preenchido e inicio de sessao registrado. A pagina `localhost:3000` nao abriu porque o redirecionamento do template Auth aponta para servidor local inexistente; isso **nao desfez** a confirmacao. Nao reemitir convite nem colar links/OTP em relatorios.

O candidato 16 e o endpoint independente `catalogo-cob06-qa` reconhecem **somente esse UID em STAGING**, e somente com projeto exato, flag explicita, pedido ficticio unico e revisao fundamentada. O UUID administrativo historico permanece inalterado para as demais operacoes, inclusive repasses. No clone CI, o candidato 16 continua exigindo o operador sintetico historico em uma transacao revertida. Em banco `postgres`, a instalacao da funcao exige **tambem** a existencia desse usuario Auth confirmado com e-mail exato, reduzindo o risco de instalacao em outro projeto.

**Estado:** RPC 16 instalada e Edge `catalogo-cob06-qa` ACTIVE v1 no STAGING, flag desligada, uma ocorrencia de cancelamento aberta e nenhuma revisao resolvida. O pedido continua `pronto` com entrega `cancelamento_solicitado`; a comissao permanece `aberta` e o lancamento `retido`. A Edge `catalogo-entregas` existente (v36) foi preservada; nenhuma funcao geral de entregas foi substituida. Para confirmar autoria real, o endpoint valida o JWT via `auth.getUser(token)` e encaminha exclusivamente o UID autenticado à RPC `service_role`.


## Preflight financeiro antes da instalacao (16/10/2026)

Consultas exclusivamente de leitura confirmaram: pedido `a4ca7c4e-465f-4342-ae18-5c7eea1dec15` continua `pronto`, retirada offline/dinheiro, pagamento `pendente`, sem ocorrencias, componentes de fatura, pagamentos, remuneracoes nem entregas atribuidas. A loja de testes tem **quatro faturas pagas**, que nao devem sofrer mudancas. Checksums da tabela de faturas pagas: `e7178b44eea23278122ce479db866f5e`; componentes historicos pagos: `864cafbaef0652cb8003b065299f9379`. Recalcular com a mesma ordenacao SQL antes e depois da eventual revisao; bloquear se houver divergencia, nao restaurar automaticamente.

## Impedimentos de publicação

1. O arquivo 15 é deliberadamente não instalável em STAGING/PROD. A RPC 16 e Edge exclusiva cobrem somente um UUID de testes no STAGING; a lacuna no fluxo administrativo geral `resolver_ocorrencia` permanece aberta.
2. Antes de promover: revisar concorrência, política e autorização JWT/service role, trilha de auditoria, estados de reembolso e impacto sobre outras modalidades; gerar **migration definitiva separada**, feature flag inicialmente desligada e testes de integração.
3. Antes de qualquer cancelamento real, obter autorização específica para o ID do pedido e executar novo preflight **somente leitura** de pagamento, cobrança, comissão, logística e fatura para detectar mudanças ocorridas desde a inspeção.
4. Nunca cancelar pedidos que possuam pagamento recebido, componentes faturados, entrega confirmada, motoboy ou qualquer saldo liberado, mesmo sob justificativa de teste.
5. COB-06 emissao/acumulo Asaas permanece HOLD. Nao executar Pix, repasse, saque, reconciliacao externa, merge ou qualquer alteracao PROD. Deploy permitido apenas de endpoint exclusivo no STAGING, sem alterar a Edge `catalogo-entregas`.

A aprovação do usuário de que o pedido é fictício **autoriza preparar e testar a correção**, não constitui registro de recebimento financeiro nem executa alterações no STAGING.


## Implantacao controlada STAGING-QA (flag desligada)

- `supabase/production-candidate/16_cob06_cancelamento_retirada_qa_staging_pendente.sql` replica o motor transacional validado para RPC pública com EXECUTE exclusivo de `service_role`; nega `anon` e `authenticated`. No clone CI permite apenas a fixture UUID terminada em `c606`. No banco `postgres` exige o UUID exato do pedido STAGING `a4ca7c4e-465f-4342-ae18-5c7eea1dec15`, comércio `asaas-cob02`, versão 2, retirada, pagamento pendente e status pronto. Qualquer outro pedido é barrado. **Instalada exclusivamente no banco STAGING** em 16/10/2026; acesso EXECUTE somente `service_role`, não a usuários/clientes.
- `supabase/functions/catalogo-cob06-qa/index.ts` e um endpoint novo e independente da `catalogo-entregas` em uso, disponivel apenas em STAGING; valida em Auth o JWT do revisor confirmado, URL do projeto, comercio e pedido fixos, decisao legitima, motivo e confirmacao de **nenhuma entrega e nenhum recebimento**. A variavel `COB06_QA_CANCELAMENTO_HABILITADO` exige exatamente `true`; ausente ou em outro valor bloqueia a RPC. Nao expor a chave `service_role` ao cliente. A interface de homologacao tem dois botoes distintos: o proprietario registra a solicitacao, e somente a conta de revisao (UID e e-mail Auth conferidos) pode acessar o botao de revisao. Esse segundo botao requer duas confirmacoes humanas, a flag do servidor e todas as protecoes atomicas da RPC; nao e habilitado automaticamente.
- `tests/catalogo-cob06-qa-endpoint.test.cjs` cobre PROD, flag ausente, JWT inexistente/invalido, usuario/admin historico divergente, comercio e UUID errados, identidade forjada e falta de atestado; `deno check` valida a funcao isolada.
- `supabase/tests/isolated/asaas-cob06-cancelamento-retirada-qa-publica-rollback.sql` cobre permissões, escopo do UUID, bloqueios financeiros, fatura preservada e rollback.

A existencia do codigo e dos servicos implantados **nao** implica execucao do cancelamento. Confirmado no STAGING: RPC instalada (sem EXECUTE para `anon` ou `authenticated`), Edge `catalogo-cob06-qa` ACTIVE v1, bloqueio HTTP 403 real sem credenciais e sem flag, funcao geral `catalogo-entregas` inalterada em v36, pedido ainda `pronto`, uma ocorrencia de cancelamento `aberta`, quatro faturas pagas e checksums historicos inalterados. PROD nao acessado nem modificado.

**Solicitacao humana concluida em 16/10/2026 (horario local 19:32):** o proprietario autenticado `pedrinhossiqueira@gmail.com` clicou uma unica vez no botao de solicitacao. API retornou `success:true`, `ocorrencia:true`, `entrega_status:"cancelamento_solicitado"`. Consulta SQL de preflight confirmou a ocorrencia `b8bc453b-810b-4e6a-af6d-b82c59b1db20` com `status=aberta`, `origem=comercio`, `categoria=cancelamento_comercio`, sem decisao nem revisor. O pedido `a4ca7c4e-465f-4342-ae18-5c7eea1dec15` segue `pronto`, `status_pagamento=pendente`, retirada `offline/dinheiro`; nenhum pagamento, evento de pagamento, entrega atribuida, logistica, remuneracao ou componente de fatura. Sua comissao de 700 centavos ainda esta `aberta` e o unico lancamento de 700 centavos `retido`. Quatro faturas pagas, checksums de faturas `e7178b44eea23278122ce479db866f5e` e componentes `864cafbaef0652cb8003b065299f9379`, identicos ao baseline.

**Proximo passo, ainda nao executado:** autenticar `pedrinhossiqueira12@gmail.com` no HTML QA atualizado; o botao de revisao administrativa fica visivel apenas com esse e-mail, mas a Edge ainda bloqueia HTTP com flag desativada. Antes de qualquer cancelamento, assegurar sessao Auth dessa conta, revalidar preflight e habilitar **temporariamente** `COB06_QA_CANCELAMENTO_HABILITADO=true` exclusivamente nos secrets da Edge STAGING, mediante controle humano. Clicar uma unica vez na revisao, desabilitar a flag imediatamente depois e verificar a trilha de auditoria e os checksums. Nao chamar diretamente a RPC por SQL contornando a autenticacao JWT/flag; nao fazer nada no PROD.

A operação é exclusiva de uma retirada fictícia identificada. O fluxo geral `resolver_ocorrencia` continua exigindo projeto separado para pagamentos confirmados, motoboys e reembolsos.
