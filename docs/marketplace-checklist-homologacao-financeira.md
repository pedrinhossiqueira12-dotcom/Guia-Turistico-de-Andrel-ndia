# Homologação financeira do marketplace — Guia Andrelândia

> Documento de controle. Não autoriza migrações, deploy ou alterações em pedidos reais.

## Situação conhecida

- Desenvolvimento isolado na branch `logic/finalizacao-marketplace-2026-10-07` e PR #35; não fazer merge em `main` sem aprovação.
- A migração `20261007213000_arredondamento_taxa_total_7.sql` **não foi aplicada à produção**.
- Três migrações anteriores já estão na produção. O novo arredondamento de 7% deve ser implantado somente após autorização explícita.
- Testes Deno, sintaxe SQL, 28 migrações reais e **23/23 pgTAP** passaram em PostgreSQL isolado. A migração restante de Cron/Vault passou em **cópia sanitizada sem chamadas externas**. O job nativo `supabase test db` continua **SKIPPED** por falta de baseline Supabase completo; não interpretar `skipped` como `passed`.

## Evidências automatizadas validadas (CI — ambiente descartável)

- [x] Migrações financeiras: **28/29** arquivos SQL reais aplicados em ordem a `catalogo_ci` (PostgreSQL 17), com apenas o agendamento de rede excluído.
- [x] Migração de agendamento: teste de sua lógica em **cópia temporária sanitizada**, com endereço `.invalid`, sem `pg_cron`/`pg_net` reais e com stubs que não executam comandos. Uma nova aplicação mantém um único job inerte e o mesmo token.
- [x] `pgTAP` real: **23 assertions aprovadas** no esquema financeiro isolado, com verificação posterior de rollback.
- [x] Pix fictício por RPC: aprovação, divergência de valor, idempotência, cancelamento antes do aceite, bloqueio após aceite, oferta de entrega, disputa sequencial entre motoboys, confirmação por código e estorno de remuneração.
- [x] Dinheiro e cartão de débito fictícios por RPC: entrega comprovada gera crédito de **2% retido**; fatura de **7%** (5% plataforma + 2% logística) liquida o crédito; divergência não libera fundos; evento duplicado não duplica créditos; estorno volta a reter e bloqueia comércio.
- [x] Testes de RLS de catálogo e Storage: autorização dos proprietários, bloqueio de terceiros, imagens inválidas, suspensão e assinatura vencida.
- [x] Cenários Pix/offline executados dentro de **transações revertidas**, sem pedidos, pagamentos ou comissões de teste persistentes.
- [x] **Concorrência real**: duas conexões PostgreSQL independentes aguardaram bloqueio na mesma linha por duas rodadas. Em cada rodada houve exatamente um vencedor da oferta de motoboy, mesmo após desistência e reoferta. Conclusão física gerou apenas um crédito retido de 2%.
- [x] **Comprador x comércio simultâneos**: duas conexões disputaram o mesmo pedido em duas rodadas; foram observados tanto o aceite do comércio vencendo quanto o cancelamento do comprador vencendo. O perdedor recebeu HTTP 409; status, ocorrência, reembolso e ledger permaneceram consistentes.

**Evidência:** workflow `Database tests` no ramo de desenvolvimento, commit `d1c1b9535131b75161b798e3e3ebedadbc67b43b`, execuções `37717937694` e `37717941007` (sucesso). Os resultados validam o comportamento das RPCs com dados sintéticos, **não** a comunicação com o Mercado Pago, o frontend ou o Supabase completo.

**Evidência de concorrência:** commit `0896c858ee42171aa7655c2d2b6f442def5c983e`, execução GitHub Actions `37718565249`, job `113120670877` (**SUCCESS**), com duas sessões esperando simultaneamente no banco `catalogo_race_ci`, cópia descartável do schema. O CI destrói a cópia ao final. Isso não é prova de concorrência sob tráfego de produção, mas confirma o bloqueio atômico da RPC em PostgreSQL real.

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

1. Execução nativa `supabase db reset --local` e `supabase test db` com **todas** as dependências Supabase e o agendamento externo neutralizado; atualmente só foi executado pgTAP em PostgreSQL isolado.
2. Homologação ponta a ponta com frontend e **provedor de pagamento sandbox** (Pix, webhooks e chargebacks); concorrência real no banco isolado já passou, mas ainda falta verificar o comportamento da UI sob carga.
3. Backup e restauração verificáveis do banco real, auditoria de deploy e aprovação explícita para migração/implantação em produção.
