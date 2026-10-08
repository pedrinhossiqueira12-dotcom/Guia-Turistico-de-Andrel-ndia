# Guia Andrelândia — liberação final segura do marketplace

**Data da auditoria:** 8 de outubro de 2026.
**Escopo:** PR #35 (`logic/finalizacao-marketplace-2026-10-07`), sem merge.
**Status:** testes técnicos aprovados no workflow #327; **produção NÃO autorizada neste runbook**. Os números abaixo são fotografia do momento da auditoria, não uma confirmação em tempo real futura.

## 1. Evidências já confirmadas

- Workflow técnico [#327](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/37724464886) terminou com sucesso. Inclui 363 testes Node, pgTAP com 23 assertions em Supabase local temporário, SQL/Edge Deno e concorrência em PostgreSQL descartável. Um job legado permanece SKIPPED por configuração; não foi contado como PASS.
- Em consulta exclusivamente de leitura à produção, o script `scripts/validacao-pagamentos/preflight-historico-v2-readonly.sql` retornou: `pedidos | 17 | 9 V1 | 8 V2 | 0 incompatibilidades | 0 totais históricos divergentes` e `comissoes | 7 | 5 V1 | 2 V2 | 0 incompatibilidades | 0 totais históricos divergentes`. Não foram consultados dados identificáveis de clientes.
- `catalogo_fluxo_config`: ativo, global, somente_pix=false, taxa_sem_entrega_percentual=7.00 e monitor ativo, no momento da leitura.
- A produção ainda tem `catalogo_pedidos_check1` (limite legado de 5% da plataforma) e regra `catalogo_pedidos_taxas_v2_check` que calcula 5% + 2% com arredondamentos separados. Isso impede a conclusão de que a migração final de arredondamento já foi aplicada. **Não houve alteração no banco.**

## 2. Bloqueio de histórico — não usar db push automaticamente

**Arquivos existentes apenas no repositório com os respectivos timestamps:**
`20261007173000` — corrigir liberação do motoboy após entrega;
`20261007190000` — taxa fixa de 7%;
`20261007203000` — finalizar regras financeiras e offline;
`20261007213000` — arredondamento final de 7% (ainda não aplicado remotamente).

**Versões existentes apenas no histórico remoto:**
`20261007233513` — corrigir liberação do motoboy;
`20261007233535` — taxa fixa de 7%;
`20261007233541` — finalizar regras financeiras e offline.

Os três primeiros itens locais e remotos têm nomes/efeitos parecidos, mas é necessário comparar SQL e dependências de cada um **antes** de qualquer `migration repair`, alteração de timestamp ou implantação. Tratar `20261007213000` como migração nova **somente depois** de reconciliar o histórico e conferir que sua aplicação numa cópia restaurada não destrói objetos existentes. Nunca reaplicar cegamente scripts financeiros sobre produção.

## 3. Pré-requisitos obrigatórios para GO

- [ ] Criar backup íntegro do **banco real** com hora, tamanho e hash; armazenar fora do projeto.
- [ ] Salvar também o conteúdo real dos **buckets de Storage**; backup SQL contém metadados, mas não os arquivos binários.
- [ ] Restaurar o banco e os arquivos em ambiente separado; confirmar tabelas, constraints, usuários/objetos necessários e contagem de pedidos/comissões, sem apontar webhooks ou cron para endpoints produtivos.
- [ ] Conciliar o histórico remoto/local por comparação de conteúdo. Documentar cada correspondência e suas evidências. `migration repair` modifica histórico e requer aprovação.
- [ ] Aplicar a migration de arredondamento no **ambiente restaurado**, executar a mesma auditoria somente leitura e comparar total de registros e todos os snapshots antes/depois.
- [ ] Realizar homologação de Mercado Pago em **sandbox verdadeira e isolada**, com contas/credenciais de teste; verificar criação Pix, assinatura de webhook, retry idempotente, cancelamento pré/pós-aceite, estorno/chargeback simulados pelo provedor e emissão/pagamento de fatura de teste. Nunca usar um pagamento real para validar o sandbox.
- [ ] Navegar no frontend em celular e computador com perfis de comprador, proprietário e motoboy; verificar carrinho, código, notificações, telas de aceite/reoferta e mensagens de cancelamento, sem expor dados privados antes do aceite.
- [ ] Revisar aviso de segurança do Supabase sobre *Leaked Password Protection* desabilitada e habilitar a proteção conforme disponibilidade do plano, após planejamento e autorização.
- [ ] Obter aprovação explícita do proprietário para cada execução sobre produção, com janela de mudança, plano de rollback e reconciliação financeira.
- [ ] Somente então considerar merge autorizado do PR, aplicar migrations selecionadas/validadas, publicar funções e frontend na ordem definida e monitorar erros, pagamentos e filas.

## 4. Checagens financeiras de aceitação

- V1: manter snapshots antigos a 5% sem regravar valores históricos.
- V2: cobrança de **7% do subtotal de produtos, arredondados uma única vez**; nas entregas, motoboy recebe `round(2%)` e plataforma fica com o restante da taxa de 7%; retirada/consumo: 7% plataforma, 0% motoboy.
- Frete não entra na base da comissão dos produtos.
- Pix aprovado não comprova entrega física; código/aceite com autenticação controla a comprovação de entrega.
- Crédito do motoboy não representa transferência automática; valores disponíveis precisam de lastro e repasse efetivo registrado.
- Cancelamento anterior ao aceite respeita transação e desfaz a obrigação conforme modelo; pós-aceite não pode apagar obrigação sem auditoria/revisão.
- Divergência de aplicação de taxa do provedor não libera o crédito, mesmo com webhook assinado.
- Em pagamentos presenciais, fechamento de fatura não é garantia de recebimento até a confirmação validada da cobrança.

## 5. Evidência pós-publicação

Registrar em ata: SHA final, migrações aplicadas (versão real), início/fim da janela, dump/teste de restauração, hashes de código e de funções implantadas, URLs de staging, identificadores **sintéticos** dos pagamentos de teste, resultados dos testes, status das filas e rollback praticável. Sem estes itens, marcar resultado **NO-GO**, mesmo com workflow verde.

**Importante:** esta documentação e o script de pré-auditoria são seguros para leitura e testes, não executam backup real, restauração, cobrança ou implantação.
