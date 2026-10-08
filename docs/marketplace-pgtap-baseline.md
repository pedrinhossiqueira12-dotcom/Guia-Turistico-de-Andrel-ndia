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
