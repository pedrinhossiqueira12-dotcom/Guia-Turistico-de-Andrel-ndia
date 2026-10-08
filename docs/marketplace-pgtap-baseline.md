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
