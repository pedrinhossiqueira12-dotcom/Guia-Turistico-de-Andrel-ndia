# Histórico do baseline e validação nativa Supabase

## Estado atual (2026-10-07)

O job original `database-tests` de `.github/workflows/database-tests.yml` permanece **SKIPPED** até `MARKETPLACE_TEST_BASELINE_READY=true`. **Entretanto, agora existe um job novo e aprovado de Supabase nativo local** com reset + 23/23 pgTAP; não confundir o `SKIPPED` histórico com falha ou sucesso desse novo job.

O teste `supabase/tests/database/marketplace_financeiro_v2.test.sql` contém 23 assertions e executa `UPDATE public.catalogo_fluxo_config` dentro de uma transação revertida ao final. Ele deve ser executado **somente em um banco descartável**, nunca no projeto de produção.

## Testes efetivamente aprovados no PostgreSQL isolado (2026-10-07)

O job `complete-chain-postgres-isolated` do GitHub Actions demonstrou a aplicação ordenada de **28 das 29 migrações SQL reais** em `catalogo_ci` (serviço efêmero PostgreSQL 17). A migração `20261002235010_schedule_storage_retention_dry_run_20261002.sql` foi **excluída deliberadamente**, pois contém URL do projeto de produção e agenda chamadas HTTP. A extensão `pg_cron` foi mantida indisponível no banco isolado, impedindo a criação de agendamentos.

As dependências históricas são preenchidas exclusivamente com stubs de Auth/Storage e seeds sintéticas, incluindo `comercio-de-exemplo`, exigido como chave estrangeira pela migração de allowlist. Nenhum cadastro, pedido, pagamento ou token real é copiado da produção.

No mesmo job, a extensão **pgTAP real** (`postgresql-17-pgtap`) executou `supabase/tests/database/marketplace_financeiro_v2.test.sql`. Resultado confirmado pelo log do CI: **23 assertions aprovadas, 0 falhas**, incluindo a função de arredondamento final e os snapshots históricos. A suíte usa `BEGIN`/`ROLLBACK` e o CI verifica que não persistiram pedidos ou lançamentos financeiros de teste.

Evidência: workflow no commit `5c67941b87fa846016251f0db960e635fbc0b087`, execução `37716952226`, job `113115498377`. O reforço de verificação após rollback foi adicionado em commit posterior.

**Atualização:** o teste PostgreSQL isolado descrito acima continua distinto do teste **Supabase nativo** realizado posteriormente. O job original `database-tests` permanece **SKIPPED**; o novo job nativo aprovado usa cópia temporária com 28 migrações originais + placeholder inerte no lugar do agendamento externo, não as 29 migrações literais.

## Avanço posterior: migração Cron/Vault e cenários end-to-end isolados

O job `scheduler-inert-migration-test` reproduz a lógica da **29ª migração** com uma cópia temporária gerada a partir do SQL original. O gerador exige os comandos e o endereço originais esperados, troca o endpoint de produção por `ci-no-network.invalid` e remove apenas os dois comandos de instalação de extensões. Stubs isolados implementam `cron.schedule`/`cron.unschedule` como inserção/remoção **de linhas locais**, nunca como execução de tarefas, e simulam o Vault com segredo sintético. A migração foi aplicada e reaplicada com sucesso: exatamente um job inerte, um token preservado e permissões restritas. **A migração original não foi aplicada integralmente a um Supabase local com Cron real**.

No banco descartável que já executa as 28 migrações, foram acrescentados dois cenários de integração transacionais, revertidos ao final:

1. `supabase/tests/isolated/catalogo-pedidos-entregas-e2e-postgres.sql`: Pix, cancelamento pré/pós-aceite, aceite sequencial de motoboys, desistência antes da coleta, prova física de entrega, remuneração de **2%** em pedido de R$ 1,01 e estorno.
2. `supabase/tests/isolated/catalogo-offline-fatura-e2e-postgres.sql`: entrega por dinheiro e cartão de débito, crédito retido de 2% por entrega, emissão de fatura de 7%, rejeição de valores divergentes, confirmação idempotente, liberação após pagamento da fatura e retenção/bloqueio após estorno.

Ambos passaram no workflow das execuções `37717937694` e `37717941007`, commit `d1c1b9535131b75161b798e3e3ebedadbc67b43b`.

### Corridas transacionais genuinamente simultâneas (aprovadas)

No job `complete-chain-postgres-isolated`, após o pgTAP e os cenários Pix/offline revertidos, o CI clona `catalogo_ci` para o banco descartável `catalogo_race_ci` e o destrói automaticamente ao final. O script `scripts/validacao-pagamentos/test-courier-concurrency.py` utiliza **três conexões independentes**: a primeira bloqueia a linha do pedido com `SELECT ... FOR UPDATE`; as outras duas chamam as RPCs reais simultaneamente. Somente quando o PostgreSQL confirma **duas sessões esperando um Lock** o controlador libera a linha.

- Duas corridas de motoboys foram aprovadas: **exatamente uma atribuição** e HTTP 409 para o segundo, antes e depois de desistência/reoferta. Somente o motoboy efetivamente atribuído coletou e confirmou a entrega, com **um único crédito de 2% retido**.
- Duas corridas simultâneas de **cancelamento de comprador x aceite do comércio** foram aprovadas: em uma o comerciante aceitou primeiro, na outra o comprador cancelou primeiro. Em ambos os casos o perdedor recebeu HTTP 409 e o banco confirmou status, ocorrência, marcação de reembolso e comissão da plataforma coerentes, sem duplicatas.

Evidência: commit `0896c858ee42171aa7655c2d2b6f442def5c983e`, execução `37718565249`, job `113120670877` (**SUCCESS**). Essa comprovação é de **concorrência real entre sessões PostgreSQL**, não de usuários reais ou testes de carga do frontend.

**Atualização dos pendentes:** o **teste nativo Supabase com pgTAP passou** usando cópia sanitizada do agendamento; continua pendente executar todas as migrações literais sem efeitos externos, testar Mercado Pago em sandbox e homologar o aplicativo/frontend e o deploy autorizado. A proteção contra execução remota permanece obrigatória.

## Resultado confirmado do novo Supabase CLI nativo — 8 de outubro de 2026

O job `supabase-native-local-pgtap` passou no GitHub Actions: [execução 37722544899](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/37722544899), job `113133291267`, commit `d155fe7d1e9e03730e3fa8fbe3eb9660af97ee19`.

O script `scripts/validacao-pagamentos/build-native-supabase-ci.py` cria em `/tmp/guia-supabase-native-ci` um projeto com `project_id` isolado, sem copiar o `config.toml` original, tokens, URLs ou quaisquer registros reais. O baseline pré-migrações tem apenas cadastros sintéticos. O histórico é reconstruído com **28 arquivos de migração SQL reais intactos**, **um placeholder inerte no lugar da migração Cron/Vault com endpoint de produção** e duas migrations temporárias de teste para suprir as tabelas legadas e a FK de allowlist.

No projeto isolado, o CI executou com sucesso `supabase start`, `supabase db reset --local` e `supabase test db`. Log: **`All tests successful. Files=1, Tests=23. Result: PASS`**.

**Limitações:** não se pode concluir que as 29 migrações originais foram reproduzidas literalmente num Supabase local, já que a de agendamento foi neutralizada. A lógica de agendamento foi verificada separadamente com cópia sanitizada + stubs. Também não comprova backup restaurável do projeto real ou pagamentos reais/sandbox do Mercado Pago. O job original `database-tests` continua **SKIPPED**, enquanto este novo teste nativo é efetivamente **SUCCESS**.

## Bloqueios a resolver

1. Reconstituir o estado inicial de schema anterior à primeira migração versionada. Verificar dependências de `public`, `auth`, `storage`, funções, triggers, grants, tipos e extensões. Não copiar dados de clientes nem segredos da produção.
2. Garantir que `supabase db reset --local` aplica **todas** as migrações, incluindo `20261007213000_arredondamento_taxa_total_7.sql`, em uma instância efêmera sem falhas.
3. Verificar a existência de `anon`, `authenticated`, `service_role` e da extensão pgTAP no banco de teste.
4. Executar `supabase test db` e confirmar **23 testes aprovados**, sem ignorados ou falhas.
5. Somente após reproduzir esse resultado no CI, habilitar `MARKETPLACE_TEST_BASELINE_READY=true`.

## Critérios de segurança

- Nunca apontar `supabase test db`, `db reset` ou os fixtures SQL para o projeto `xdmbkflufsfqziixzpxc`.
- Nunca usar `SUPABASE_DB_URL`, credenciais de produção, dados pessoais, pedidos reais ou valores de pagamentos reais para testes.
- Não interpretar sucesso de parser SQL como aplicação bem-sucedida de migrações.
- Não aplicar a migração `20261007213000_arredondamento_taxa_total_7.sql` à produção sem aprovação explícita.
- Não mesclar a PR #35 em `main` sem autorização explícita.

## Evidência necessária para liberar

Anexar os logs do reset local, execução completa do pgTAP, lista de jobs aprovados e auditoria das dependências legadas. Manter o job desabilitado até essa evidência existir.

## Dependências legadas identificadas na inspeção inicial

- `20261002233841_publication_metadata_reversible_archive_20261002.sql`: usa `auth.users` e roles `anon`, `authenticated` e `service_role`. Esses objetos são fornecidos pelo ambiente Supabase e não podem ser simulados apenas com PostgreSQL puro.
- `20261002235010_schedule_storage_retention_dry_run_20261002.sql`: instala `pg_cron` e `pg_net`, consulta `vault.secrets` e chama `vault.create_secret`. A migração exige que essas extensões e o Vault estejam disponíveis **antes** da execução. Também agenda atividade de retenção, portanto precisa ser inspecionada em ambiente isolado.
- `20261003013323_catalogo_digital_20261003000000.sql`: referencia `public.comercios_publicados` e `auth.users`, reforçando a necessidade de aplicar as migrações na ordem e com a infraestrutura Supabase inicializada.

**Limite da auditoria:** esta é uma inspeção parcial dos primeiros arquivos, não uma comprovação de que todas as dependências foram identificadas. O job pgTAP deve permanecer desabilitado até uma execução integral reproduzível.

## Dependências adicionais confirmadas

- `20261004110000_avaliacoes_avatar_url.sql` usa `ALTER TABLE public.avaliacoes` sem `CREATE TABLE IF NOT EXISTS`. A tabela `public.avaliacoes` precisa existir **antes** dessa migração; é uma dependência legada concreta.
- `20261006111500_corrigir_rls_cadastros_comercios.sql` cria uma policy diretamente sobre `public.cadastros_comercios`, que também precisa existir previamente. A policy depende ainda de `auth.uid()` e do campo `usuario_id`.
- `20261006130000_catalogo_gratuito_por_conexao.sql` define uma função no schema `catalogo_private` e consulta `public.catalogo_recebedores`, `public.catalogos` e `public.comercios_publicados`. A existência e a ordem de criação desses objetos precisam ser verificadas na reconstrução.

**Implicação:** as migrações versionadas não são, por si só, prova de que um `supabase db reset` vazio funcionará. Não criar tabelas fictícias em produção para contornar essa lacuna.

## Ordem de dependências verificada em mais duas migrações

- `20261004003000_perfil_fotos_e_politicas.sql` pressupõe o esquema gerenciado `storage`, incluindo `storage.buckets`, `storage.objects`, `storage.foldername(text)` e `storage.extension(text)`. Também altera a constraint de `public.storage_cleanup_queue`, criada em migração anterior.
- `20261004223000_catalogo_marketplace_pedidos.sql` cria `public.catalogo_recebedores` e `public.catalogo_pedidos`, com FKs para `public.catalogos`. Portanto, o recebedor consultado na migração `20261006130000_catalogo_gratuito_por_conexao.sql` tem origem versionada. Isso **não** resolve as tabelas legadas `avaliacoes` e `cadastros_comercios`.

**Conclusão parcial:** um ambiente Supabase local completo (Auth, Storage, Vault e extensões) é necessário; PostgreSQL simples com apenas fixtures financeiros não constitui um baseline pgTAP completo.

## Inspeção somente leitura do schema legado (2026-10-07)

A consulta `information_schema.columns` no projeto existente confirmou a estrutura das tabelas legadas, **sem ler nenhuma linha de clientes**:

- `public.avaliacoes`: `id bigint NOT NULL`, `local_id text NOT NULL`, `usuario_id uuid NOT NULL`, `nome_usuario text NOT NULL`, `nota integer NOT NULL`, `comentario text NOT NULL`, `criado_em timestamptz NOT NULL DEFAULT now()` e `avatar_url text NULL`. A coluna `avatar_url` é adicionada por uma migração posterior e, portanto, **não deve constar na definição inicial** do baseline.
- `public.cadastros_comercios`: `id uuid NOT NULL DEFAULT gen_random_uuid()`, `telefone_usuario text NOT NULL`, `etapa text NOT NULL DEFAULT 'inicio'`, `status text NOT NULL DEFAULT 'em_andamento'`, `criado_em` e `atualizado_em timestamptz NOT NULL DEFAULT now()`, além de `usuario_id uuid NULL`, `tipo text DEFAULT 'novo_comercio'`, `local_id text`, `imagens jsonb DEFAULT '[]'` e campos opcionais de contato, localização e revisão.

**Atenção:** `information_schema.columns` não demonstra PKs, FKs, índices, triggers, policies ou CHECKs. Antes de criar o baseline executável, consultar também `pg_constraint`, `pg_indexes`, `pg_trigger` e `pg_policies` (somente metadados). Não copiar dados reais.

## Constraints, índices e RLS verificados (somente metadados)

- `avaliacoes`: PK `(id)`; FK `usuario_id -> auth.users(id) ON DELETE CASCADE`; CHECK `nota BETWEEN 1 AND 5`; CHECK `char_length(comentario) BETWEEN 1 AND 500`; índices em `local_id` e `usuario_id`. RLS habilitado, com SELECT público e INSERT/UPDATE/DELETE do autor autenticado.
- `cadastros_comercios`: PK `(id)`; FK `usuario_id -> auth.users(id)`; CHECK para estados `em_andamento`, `pendente`, `aprovado`, `rejeitado`; CHECK de etapas predefinidas. Índices em `status`, `telefone_usuario`, `local_id`, `tipo` e `usuario_id`. RLS habilitado; políticas de leitura/alteração administrativa e políticas de cadastro/leitura pelo usuário. Existem duas políticas INSERT de proprietário, que devem ser analisadas por possível redundância.
- A consulta de metadados de triggers não retornou gatilhos nessas duas tabelas. Isso não prova ausência de funções associadas em outros objetos.

**Proteção de privacidade:** não transportar identificadores reais de administradores ou usuários para o baseline. Políticas dependentes de identidade administrativa devem usar uma identidade sintética exclusiva do ambiente de testes. O baseline executável ainda precisa preservar o comportamento de autorização sem usar dados reais.

## Primeiro artefato de baseline (executado em banco descartável no CI)

O arquivo `supabase/tests/baseline/legacy-public-tables.sql` cria exclusivamente em ambiente descartável as três tabelas legadas `avaliacoes`, `cadastros_comercios` e `mural_cadastros`. Inclui guarda que exige banco descartável `catalogo_ci`, `auth.users` presente e tabelas legadas ausentes. Não é uma migration e **não deve** ser aplicado à produção.

**Pendências antes da execução completa:** conferir sequência/identity de `avaliacoes.id` (metadados atuais não expõem default), reconstruir a evolução da constraint `cadastros_comercios_etapa_check` (o default histórico `inicio` diverge da lista atual), confirmar que a infraestrutura Supabase local suporta as extensões e jobs agendados, e testar aplicação integral das migrations. As policies administrativas com identidade real não foram copiadas.

## Bloqueio adicional crítico: migração inicial dependente de dados

A migração `20261002233841_publication_metadata_reversible_archive_20261002.sql` não é apenas DDL:

1. Exige **exatamente um** registro em `public.cadastros_comercios` com `status='aprovado'`, nome normalizado `pedrox do grau` e `local_id` nulo ou igual ao slug esperado. Sem essa linha, lança exceção e interrompe a reconstrução.
2. Faz `ALTER TABLE`, `UPDATE` e `CREATE POLICY` em `public.mural_cadastros`, outra tabela legada ainda ausente do baseline.
3. Insere IDs públicos predefinidos em `public.comercios_publicados`; isso **não** representa restauração de registros privados, mas exige avaliar os efeitos das migrações subsequentes.

**Plano seguro:** inspecionar somente metadados de `mural_cadastros`; construir seed sintética mínima de `cadastros_comercios` apenas no banco descartável, sem copiar dados de clientes; verificar toda dependência de dados das 29 migrações antes de ativar `database-tests`. Não executar a migração inicial em produção como tentativa de reconstrução.

## Mural legado e seed sintética

Consulta de metadados confirmou `public.mural_cadastros`: `id text` PK, `usuario_id uuid NOT NULL` FK `auth.users(id) ON DELETE CASCADE`, `nome` e `categoria` obrigatórios, textos opcionais `descricao`, `sobre`, `instagram`, `imagem`, `motivo_recusa`, `imagens jsonb DEFAULT '[]'`, `status text DEFAULT 'pendente'` e timestamps. Índices em `status` e `usuario_id`. O baseline agora inclui essa tabela sem dados de usuários.

O arquivo de baseline inclui uma linha **sintética** de `cadastros_comercios` para satisfazer a verificação de nome/estado da primeira migração. Não reproduz dados pessoais de produção. A constraint de status final do mural é adicionada pela própria primeira migração, depois da conversão de valores legados.

**Situação posterior:** as 28 migrações literais restantes e o teste nativo local foram validados; a 29ª migração só foi verificada separadamente com stubs e omitida do reset nativo. Não habilitar o job original com migração externa intacta enquanto houver risco de chamada para produção.
