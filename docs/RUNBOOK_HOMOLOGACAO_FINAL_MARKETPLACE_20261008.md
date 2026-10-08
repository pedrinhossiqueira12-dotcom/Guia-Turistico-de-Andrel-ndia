# Guia Andrelândia — liberação final segura do marketplace

**Data da auditoria:** 8 de outubro de 2026.
**Escopo:** PR #35 (`logic/finalizacao-marketplace-2026-10-07`), sem merge.
**Status:** testes técnicos aprovados no workflow #327; **produção NÃO autorizada neste runbook**.
**Atenção ao destino:** PR #35 tem base `backup/pre-financeiro-2026-10-07`, **não** `main`. Um merge nesse PR não substitui a revisão de uma promoção posterior para `main`/Cloudflare Pages; confirmar explicitamente a branch-alvo e as diferenças antes de qualquer publicação. Os números abaixo são fotografia do momento da auditoria, não uma confirmação em tempo real futura.

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

**Verificação de conteúdo executada em 08/10/2026 (read-only):** o campo `supabase_migrations.schema_migrations.statements[1]` foi comparado ao texto integral dos três arquivos da branch. As três correspondências são **exatamente iguais, byte a byte**:
- `20261007233513` = `20261007173000` (10.766 caracteres);
- `20261007233535` = `20261007190000` (11.360 caracteres);
- `20261007233541` = `20261007203000` (15.346 caracteres).

As três migrations **já estão executadas** no banco remoto; os timestamps locais são aliases históricos, não scripts pendentes a reaplicar. O Supabase CLI compara **timestamps**, não SQL, no histórico de migrations. Ainda é necessário reconciliar as versões de forma controlada antes de `db push`; **nenhum `migration repair` foi executado**. A migração `20261007213000` continua realmente pendente, mas possui timestamp **anterior** ao último timestamp remoto; não assumir que um `db push` comum fará a seleção correta. Planejar sua promoção como única atualização de SQL validada, com um novo identificador de versão cronologicamente válido se apropriado, sem duplicar a aplicação em produção.

Um teste novo no CI usa um banco `catalogo_upgrade_ci` descartável clonado antes da migration final, com snapshots V1/V2 sintéticos que incluem arredondamento legado de 7% diferente do arredondamento único. Ele aplica só a migration final e exige preservação dos valores de pedidos e comissões. Este ensaio **não é substituto** da restauração dos dados reais.

## 2A. Pacote de versões alinhadas (somente preparo offline)

O projeto conserva os arquivos de migração originais para manter o CI e as
referências históricas reproduzíveis. **Não utilizar `supabase db push` diretamente
sobre a pasta `supabase/migrations` da branch:** três timestamps nela divergem
do histórico aplicado ao banco.

O gerador **não executa SQL, não cria backup e não acessa Supabase**.
Ele lê um manifesto auditado em 08/10/2026, verifica SHA-256 dos três SQLs
já aplicados e prepara uma pasta temporária com 29 arquivos:
28 versões exatas do histórico remoto e uma nova versão
`20261008080000_arredondamento_taxa_total_7.sql`.

Comandos de preparação local (sem credenciais; escolher destino ainda inexistente,
fora do repositório):

```bash
python3 scripts/validacao-pagamentos/test-release-migrations.py
python3 scripts/validacao-pagamentos/build-release-migrations.py
python3 scripts/validacao-pagamentos/build-release-migrations.py --output /tmp/catalogo-release-auditado
```

Arquivos resultantes:
`/tmp/catalogo-release-auditado/supabase/migrations/`,
`release-evidence.json` (versões e hashes), `README.txt` (alertas).

**Condição bloqueante:** o manifesto local é um *snapshot histórico*, não
prova de que o servidor continua igual na data do deploy. Antes de usar o
pacote em qualquer ambiente conectado, consultar novamente a tabela
`supabase_migrations.schema_migrations` em modo somente leitura,
confirmar as 28 versões e os hashes das três migrações equivalentes,
confirmar que a nova versão ainda não existe, e registrar o resultado.
Se a configuração ou o histórico remoto mudou, **invalidar o pacote**
até nova revisão. Não fazer `migration repair` sem autorização.

**Atenção:** o pacote contém migrations legadas já aplicadas em produção,
inclusive uma com agendamento/URL externa. Ele NÃO é adequado para
inicializar um projeto vazio ou staging sem sanitização separada.
O gerador não liga a um banco e não pode habilitar execução automática:
a implantação real permanece condicionada ao checklist abaixo.

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

## 3A. Auditoria dos bundles Edge e navegação real

Em 08/10/2026, a auditoria `docs/AUDITORIA_EDGE_DEPLOY_PR35_20261008.md`
comparou o código realmente publicado com a branch: cinco dos nove
`index.ts` analisados são idênticos; quatro divergem.
Há ainda três módulos compartilhados com divergências de conteúdo.
Isso impede supor que produção já está sincronizada com o código validado
e exige redeploy **atômico por função e respectivos arquivos importados**,
na janela autorizada.

A suíte Chromium em GitHub Actions executa 12 cenários com rede externa
bloqueada, em 1280px e 390px, verificando login de operador, comprador,
proprietário, motoboy e página legada. Encontrou e corrigiu bug em
`js/entregas-operacao.js`: sem sessão, o login administrativo ficava oculto.
Esse smoke valida páginas renderizadas sem autenticação real; **não equivale**
à homologação com contas reais de teste, Mercado Pago sandbox e navegador
conectado a ambiente isolado.

A suíte Node também contém `tests/catalogo-edge-dependencies.test.cjs`
para detectar imports relativos ausentes antes de publicar o bundle.

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
