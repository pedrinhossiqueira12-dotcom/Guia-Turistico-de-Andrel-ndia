# Homologação financeira do marketplace — Guia Andrelândia

> Documento de controle. Não autoriza migrações, deploy ou alterações em pedidos reais.

## Situação conhecida

- Desenvolvimento isolado na branch `logic/finalizacao-marketplace-2026-10-07` e PR #35; não fazer merge em `main` sem aprovação.
- A migração `20261007213000_arredondamento_taxa_total_7.sql` **não foi aplicada à produção**.
- Três migrações anteriores já estão na produção. O novo arredondamento de 7% deve ser implantado somente após autorização explícita.
- Testes Deno, sintaxe SQL, 28 migrações reais e **23/23 pgTAP** passaram em PostgreSQL isolado. O novo job **Supabase nativo local** também passou (`supabase start`, `db reset --local`, `test db`: **23/23**) num projeto temporário, com migrations legadas sintéticas e agendamento externo substituído apenas na cópia efêmera. O job original `database-tests` permanece **SKIPPED**; não interpretar seu `skipped` como `passed`.

## Evidências automatizadas validadas (CI — ambiente descartável)

- [x] Migrações financeiras: **28/29** arquivos SQL reais aplicados em ordem a `catalogo_ci` (PostgreSQL 17), com apenas o agendamento de rede excluído.
- [x] Migração de agendamento: teste de sua lógica em **cópia temporária sanitizada**, com endereço `.invalid`, sem `pg_cron`/`pg_net` reais e com stubs que não executam comandos. Uma nova aplicação mantém um único job inerte e o mesmo token.
- [x] `pgTAP` real: **23 assertions aprovadas** no esquema financeiro isolado, com verificação posterior de rollback.
- [x] **Supabase CLI nativo**: stack local iniciada, `supabase db reset --local` concluído e `supabase test db` executado com **23 testes aprovados**. Foram usadas **28 migrações SQL reais inalteradas** e uma substituição local inerte da migração Cron/Vault, mais duas seeds sintéticas; nenhum acesso ao projeto de produção.
- [x] Pix fictício por RPC: aprovação, divergência de valor, idempotência, cancelamento antes do aceite, bloqueio após aceite, oferta de entrega, disputa sequencial entre motoboys, confirmação por código e estorno de remuneração.
- [x] Dinheiro e cartão de débito fictícios por RPC: entrega comprovada gera crédito de **2% retido**; fatura de **7%** (5% plataforma + 2% logística) liquida o crédito; divergência não libera fundos; evento duplicado não duplica créditos; estorno volta a reter e bloqueia comércio.
- [x] Testes de RLS de catálogo e Storage: autorização dos proprietários, bloqueio de terceiros, imagens inválidas, suspensão e assinatura vencida.
- [x] Cenários Pix/offline executados dentro de **transações revertidas**, sem pedidos, pagamentos ou comissões de teste persistentes.
- [x] **Concorrência real**: duas conexões PostgreSQL independentes aguardaram bloqueio na mesma linha por duas rodadas. Em cada rodada houve exatamente um vencedor da oferta de motoboy, mesmo após desistência e reoferta. Conclusão física gerou apenas um crédito retido de 2%.
- [x] **Comprador x comércio simultâneos**: duas conexões disputaram o mesmo pedido em duas rodadas; foram observados tanto o aceite do comércio vencendo quanto o cancelamento do comprador vencendo. O perdedor recebeu HTTP 409; status, ocorrência, reembolso e ledger permaneceram consistentes.

**Evidência:** workflow `Database tests` no ramo de desenvolvimento, commit `d1c1b9535131b75161b798e3e3ebedadbc67b43b`, execuções `37717937694` e `37717941007` (sucesso). Os resultados validam o comportamento das RPCs com dados sintéticos, **não** a comunicação com o Mercado Pago, o frontend ou o Supabase completo.

**Evidência de concorrência:** commit `0896c858ee42171aa7655c2d2b6f442def5c983e`, execução GitHub Actions `37718565249`, job `113120670877` (**SUCCESS**), com duas sessões esperando simultaneamente no banco `catalogo_race_ci`, cópia descartável do schema. O CI destrói a cópia ao final. Isso não é prova de concorrência sob tráfego de produção, mas confirma o bloqueio atômico da RPC em PostgreSQL real.

## Ensaios adicionais aprovados — handlers HTTP e recuperação de backup sintético

- [x] **Handlers HTTP reais de Edge Functions:** `supabase/functions/tests/catalogo-edge-http.test.ts` importou as funções de Pix, pedidos offline, fatura Pix e webhook sem abrir sockets, com `fetch` completamente interceptado e sem permissão `--allow-net` no runtime Deno. **4/4 testes passaram.** Foram verificadas as respostas ao checkout desligado, tentativa de confirmação de entrega por endpoint público, método HTTP inválido e ausência de autenticação/HMAC.
- [x] **Conciliação do webhook com respostas do provedor simuladas:** POST assinado com HMAC válido consulta pedido e credenciais do comércio na API simulada, busca valores e taxas no mock do Mercado Pago e aplica `catalogo_aplicar_pagamento_v2` com **R$ 1,01 e taxa de R$ 0,07**, ignorando valores arbitrários enviados no corpo da notificação. Valor divergente é rejeitado antes do RPC; `application_fee` divergente é registrado para revisão com tarifa não comprovada; tarifa ausente não produz confirmação de financiamento. Nenhuma chamada ao Mercado Pago real foi efetuada.
- [x] **Backup/restauração de ensaio:** o CI executou `pg_dump` PostgreSQL 17 em `catalogo_ci` com dados **exclusivamente fictícios** e restaurou o arquivo em `catalogo_restore_ci`. Conferiu schema completo, tabelas, RLS, constraints, ausência de pedidos/pagamentos reais, dados sintéticos e RPC de 7% após o restore. A cópia de recuperação é descartada. **Não houve leitura, cópia, backup nem restauração da produção.**

Evidências: job HTTP `113126792656` e job financeiro/restore `113126792843`, workflow `37720497432`, commit `a353f9d773e4a044d196ff03ffc67643c72d66ca`. O job financeiro/restore passou; o job original `supabase test db` permanece **SKIPPED**.

**Importante:** o sucesso no backup sintético comprova o procedimento em PostgreSQL, **não** valida backup da produção ou restauração real de Auth/Storage gerenciados pelo Supabase. Mantemos a exigência de backup restaurável do ambiente real antes de qualquer deploy.

## Bloqueio comprovado na produção: CHECK legado de taxa fixa em 5%

Na auditoria **somente leitura**, o schema do projeto de produção ainda possui `catalogo_pedidos_check1` com a fórmula `taxa_plataforma_centavos = round(subtotal_produtos_centavos * 0.05)`. Essa constraint contraria a regra de V2 sem entrega, em que a plataforma deve receber **7%**. Consequência: pedidos novos de retirada/consumo local podem falhar ao gravar, mesmo se a precificação da RPC estiver correta. Também pode impedir a divisão por arredondamento único em certas entregas V2.

A migração **ainda não aplicada à produção**, `supabase/migrations/20261007213000_arredondamento_taxa_total_7.sql`, passou a remover **exclusivamente** o CHECK legado quando sua definição realmente corresponde à fórmula de 5%. A nova `catalogo_pedidos_taxas_v2_check` continua exigindo 5% em V1 e aceita snapshots V2 antigos e novos. Se o CHECK antigo tiver sido reaproveitado para outra regra, a migração **interrompe** em vez de removê-lo.

**Prova automatizada:** commit `26d88c3340c972b8a8259b18c70a8f7578a93bf1`, execução CI `37719415442` aprovada. A suíte real `catalogo-pix-revisao-e-chargeback-postgres.sql` agora consegue inserir um pedido V2 de retirada a 7% e testa cobrança duplicada, taxa do provedor informada depois, estorno parcial, estorno integral e chargeback sem liberar dinheiro de motoboy antes da entrega. O CI também aprovou o fluxo offline de contestação de fatura: após a contestação os créditos voltam a ficar retidos e o comércio é bloqueado.

**Regressão adicional de modalidades:** `supabase/tests/isolated/catalogo-modalidades-e-constraints-postgres.sql` insere pedidos sintéticos V1 (5%), V2 entrega de **R$ 0,33** (taxa total 2 centavos, com diferença do arredondamento antigo de 5% para plataforma), V2 retirada e consumo local a 7%. Rejeita um V2 de retirada com apenas 5% e um V1 com 7%. Resultado no job PostgreSQL descartável `113123865572` (execução `37719569034`): **PASS**, com rollback final. O teste SQL anterior de chargeback também passou no mesmo job, assim como as 23 assertions pgTAP.

**Auditoria Supabase Auth (somente leitura):** o verificador de segurança informou que **Leaked Password Protection** está desativado (`WARN`). Avaliar ativação em [Supabase Auth — proteção de senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) antes da publicação; esta configuração **não foi alterada**. Os outros avisos `INFO` de RLS ativo sem política recaem sobre 28 tabelas financeiras/internas de acesso restrito; confirmar concessões `GRANT` e RPCs antes de tratar isso como vulnerabilidade ou abrir políticas públicas.

**Não executar SQL em produção sem autorização explícita e backup restaurável.** Nenhum dado real foi modificado nesses testes.

**Evidência nativa Supabase:** commit `d155fe7d1e9e03730e3fa8fbe3eb9660af97ee19`, execução CI [37722544899](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/37722544899), job `113133291267` (**SUCCESS**): CLI gerou projeto em `/tmp/guia-supabase-native-ci`, executou `supabase start`, `supabase db reset --local`, `supabase test db` e reportou `Files=1, Tests=23, Result: PASS`. A migração de agendamento perigosa foi neutralizada SOMENTE no diretório temporário. O banco de produção não foi alterado.

## Auditoria final de compatibilidade de snapshots — produção (somente leitura)

Consulta executada em **8 de outubro de 2026**, sobre os dados já existentes, sem retornar nomes, IDs, endereços, compradores ou valores individuais. A expressão de validação reproduziu os **CHECKs da migração pendente** `20261007213000_arredondamento_taxa_total_7.sql`, usando `IS DISTINCT FROM true` para contabilizar também resultados nulos.

| Tabela real | Total | V1 | V2 | Entregas | Sem entrega | Incompatíveis com novo CHECK |
|---|---:|---:|---:|---:|---:|---:|
| `catalogo_pedidos` | 17 | 9 | 8 | 17 | 0 | **0** |
| `catalogo_comissoes_offline` | 7 | 5 | 2 | 7 | 0 | **0** |

**Conclusão limitada:** os 24 registros financeiros conferidos satisfazem as regras propostas; isso não demonstra que os novos fluxos de retirada e consumo local funcionam na produção, pois não há pedidos dessas modalidades. O CHECK legado de 5% continua presente no esquema de produção até autorização para aplicar a migração pendente. **Não houve UPDATE, INSERT, DELETE, DDL, deploy ou cobrança real durante a auditoria**.

A consulta deverá ser repetida imediatamente antes de uma eventual implantação; esses totais são um retrato, não um monitoramento permanente.

## Critérios obrigatórios antes de qualquer deploy

- [ ] CI verde no commit exato a publicar; verificar todos os jobs, inclusive os pulados.
- [ ] Base de homologação **sem dados pessoais ou pagamentos reais**, com esquema compatível e testes de RPC e RLS.
- [ ] Revisão de diferenças entre o esquema de produção e as migrações propostas.
- [ ] Backup **verificável e restaurável** do banco e dos objetos relevantes; checkpoint Git não equivale a backup do banco.
- [ ] Plano de reversão para aplicação e migração, incluindo efeitos de snapshots históricos.
- [ ] Aprovação explícita do responsável antes de aplicar SQL ou alterar produção.

## Cenários de homologação funcional

- [ ] Entrega por Pix, cartão e dinheiro: 7% total do subtotal dos produtos, 2% do motoboy e restante da plataforma, em centavos inteiros.
- [ ] Retirada e consumo no local: 7% da plataforma, sem parcela de motoboy.
- [ ] Valores-limite de arredondamento, inclusive centavos e histórico V1/V2.
- [ ] Pix aprovado **não** credita motoboy antes da entrega confirmada.
- [ ] Aceite concorrente de entrega: somente um motoboy ganha a atribuição; acesso restrito à lista autorizada pelo comércio.
- [ ] Cancelamento do comprador antes do aceite; após aceite, apenas fluxo de ocorrência/reembolso autorizado.
- [ ] Repetição de webhooks, eventos fora de ordem, estorno parcial/total e chargeback sem créditos duplicados.
- [ ] Cobrança mensal, repasse e suspensão por inadimplência sem alterar pedidos históricos.
- [ ] Perfis comprador, lojista, motoboy e administrador sem escalada de privilégios; RLS e RPCs verificadas.
- [ ] Fluxos antigos V1/V2 continuam legíveis e financeiramente consistentes.

## Sequência sugerida de publicação (somente com autorização)

1. Registrar commit e resultados de CI; congelar escopo da implantação.
2. Validar backup e restauração em ambiente separado.
3. Aplicar a migração pendente **primeiro em homologação**; executar testes e verificar constraints com snapshots históricos sintéticos.
4. Obter autorização específica para a migração de produção.
5. Executar migração em janela controlada e verificar contagens, constraints, precificação e pedidos antigos sem reescrever valores.
6. Implantar funções e frontend compatíveis somente após checagens de regressão.
7. Monitorar pagamentos, eventos de entrega, ledger e cobranças; suspender rollout se houver divergências.

## Bloqueios atuais

1. O **Supabase nativo isolado** já passou com `db reset --local` e 23/23 pgTAP. Ainda falta a reconstrução literalmente idêntica de todas as migrações originais, pois a Cron/Vault original continua **excluída e substituída por NO-OP** no ambiente nativo; sua lógica foi testada separadamente com stubs.
2. Homologação ponta a ponta com frontend e **provedor de pagamento sandbox** (Pix, webhooks e chargebacks); concorrência real no banco isolado já passou, mas ainda falta verificar o comportamento da UI sob carga.
3. Backup e restauração verificáveis do banco real, auditoria de deploy e aprovação explícita para migração/implantação em produção.


## Auditoria de prontidão do PR #35 — 8 de outubro de 2026

> Registro de validação, não autorização de deploy. Todo acesso a produção nesta auditoria foi **somente leitura**.

- Commit técnico `6f9d16f0e27a0892e8cd33b7f62463e010a26270` inclui correção de testes Node de frontend/checkout/painéis, preservando as regras V1. Job Node do GitHub Actions #325 (`37724236158`): **363 aprovados, 0 falhas, 0 ignorados**. Os jobs SQL, Edge HTTP e PostgreSQL isolado estavam aprovados na leitura de status; a validação Supabase CLI nativa ainda estava em andamento quando este registro foi elaborado. A suíte histórica `database-tests` permanece **SKIPPED**, distinta do job nativo efetivamente executado.
- Consulta ao projeto real retornou **17 pedidos (9 V1, 8 V2; nenhum sem entrega)** e **7 comissões offline (5 V1, 2 V2)**. Nenhuma linha foi modificada. A constraint `catalogo_pedidos_check1` ainda exige 5% da plataforma, bloqueando retirada/consumo V2 a 7% até a migração final autorizada.
- **Divergência do histórico de migrações:** entre 29 arquivos SQL locais e 28 versões registradas remotamente, aparecem como *locais mas não registradas com o mesmo timestamp* `20261007173000`, `20261007190000`, `20261007203000` e `20261007213000`; aparecem apenas no histórico remoto `20261007233513`, `20261007233535` e `20261007233541`. Os nomes das duas últimas sugerem equivalência de conteúdo com migrações locais de 7%/offline, **mas nomes iguais não provam SQL idêntico**. Não usar `supabase db push` nem `supabase migration repair` sem auditar, comparar e registrar formalmente essa correspondência e fazer backup restaurável.
- A execução final com **Mercado Pago sandbox real**, a checagem de frontend em navegador, o backup verificável/restaurável do projeto de produção (incluindo objetos de Storage, que não fazem parte do dump SQL), a homologação em staging e a aprovação de deploy **continuam pendentes**. Testes simulados e backups sintéticos não substituem esses critérios.
- **Go/no-go:** sem backup restaurável, reconciliação de histórico, testes externos de homologação e autorização explícita, o resultado é **NO-GO** para produção, independentemente da porcentagem estimada de desenvolvimento. Preservar PR #35 como rascunho, não mesclar na `main`.
