# Pré-requisitos para habilitar pgTAP no CI

## Estado atual (2026-10-07)

O job `database-tests` de `.github/workflows/database-tests.yml` permanece **SKIPPED** até a variável `MARKETPLACE_TEST_BASELINE_READY=true` ser configurada. Os jobs de sintaxe SQL, testes Deno e PostgreSQL isolado não substituem esta suíte.

O teste `supabase/tests/database/marketplace_financeiro_v2.test.sql` contém 23 assertions e executa `UPDATE public.catalogo_fluxo_config` dentro de uma transação revertida ao final. Ele deve ser executado **somente em um banco descartável**, nunca no projeto de produção.

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
