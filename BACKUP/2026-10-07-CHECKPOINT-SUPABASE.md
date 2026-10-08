# CHECKPOINT DE BACKUP — SUPABASE

Data/hora do checkpoint: 2026-10-07 20:38 UTC
Projeto: xdmbkflufsfqziixzpxc
PostgreSQL: 17.6
Tabelas públicas: 38
Funções públicas: 29

## IMPORTANTE

Este arquivo é um manifesto de recuperação, não substitui o dump completo do banco.

O dump completo e portátil deve ser gerado pelo Supabase CLI/Dashboard antes de qualquer alteração estrutural. O dump deve preservar schema, dados, políticas/RLS, funções e triggers. Os objetos do Supabase Storage (arquivos) precisam de backup separado.

## Migrações presentes no banco

- 20261002233841 publication_metadata_reversible_archive_20261002
- 20261002235010 schedule_storage_retention_dry_run_20261002
- 20261003013323 catalogo_digital_20261003000000
- 20261003134656 editorial_pagamentos_20261003
- 20261003140000 catalogo_pagamento_producao
- 20261004003000 perfil_fotos_e_politicas
- 20261004110000 avaliacoes_avatar_url
- 20261004223000 catalogo_marketplace_pedidos
- 20261005010000 catalogo_marketplace_oauth
- 20261005090000 catalogo_pedidos_email
- 20261005120000 catalogo_pagamentos_offline
- 20261005123000 catalogo_pedidos_offline_auditoria
- 20261005130000 catalogo_offline_rate_limit
- 20261005133000 catalogo_marketplace_test_allowlist
- 20261005150000 catalogo_fechamento_automatico
- 20261005160000 catalogo_fatura_pix
- 20261005170000 catalogo_correcao_confirmacao_offline
- 20261006111500 corrigir_rls_cadastros_comercios
- 20261006130000 catalogo_gratuito_por_conexao
- 20261006175809 confirmacao_entrega_painel
- 20261006184332 catalogo_motoboys_acesso_restrito
- 20261007010434 catalogo_entregas_v2
- 20261007010439 catalogo_monitor_entregas_v2
- 20261007015513 catalogo_checkout_permissao_funcao_privada
- 20261007040955 catalogo_banner_personalizavel

## Tabelas públicas

avaliacoes
cadastros_comercios
catalogo_assinaturas
catalogo_automacao_config
catalogo_automacao_execucoes
catalogo_categorias
catalogo_comissoes_offline
catalogo_entregas_atribuidas
catalogo_entregas_gestao_eventos
catalogo_fatura_cobrancas
catalogo_fatura_componentes_v2
catalogo_fatura_eventos
catalogo_fechamentos_offline
catalogo_fluxo_config
catalogo_lancamentos_financeiros_v2
catalogo_logistica_offline_v2
catalogo_marketplace_testes
catalogo_motoboy_perfis
catalogo_motoboys
catalogo_oauth_estados
catalogo_ocorrencias_v2
catalogo_offline_rate_limits
catalogo_pagamento_eventos_v2
catalogo_pagamentos
catalogo_pagamentos_v2
catalogo_pedido_eventos
catalogo_pedido_itens
catalogo_pedidos
catalogo_produtos
catalogo_recebedores
catalogo_remuneracoes_v2
catalogo_repasses_v2
catalogos
comercios_publicados
conteudos_editoriais
mural_cadastros
storage_cleanup_queue
votos_pessoas

## Snapshot de dados no momento do checkpoint

- catalogo_pedidos: 16
- catalogo_pagamentos_v2: 2
- catalogo_lancamentos_financeiros_v2: 6
- catalogo_remuneracoes_v2: 2
- catalogo_repasses_v2: 0
- catalogo_fechamentos_offline: 0
- catalogo_fatura_cobrancas: 0
- catalogo_comissoes_offline: 7

## Regra financeira que NÃO pode ser alterada por engano

- Plataforma: 5%
- Reserva/remuneração do motoboy: 2%
- Total: 7%
- Exemplo R$100: R$5 plataforma + R$2 motoboy + R$93 comércio.
- O valor do motoboy é contabilizado no saldo/razão do motoboy e o pagamento pode ser feito manualmente pelo administrador.
- Cancelamentos/estornos precisam reverter os lançamentos correspondentes.

## Procedimento para criar o backup portátil antes de mudanças

1. No Supabase Dashboard, abrir Database > Backups.
2. Para um arquivo portátil/reconstruível, gerar um logical dump usando Supabase CLI.
3. Guardar separadamente:
   - roles.sql
   - schema.sql
   - data.sql
4. Fazer backup separado dos objetos do Storage.
5. Guardar os arquivos fora do repositório público.
6. Testar restauração em um projeto Supabase novo antes de considerar o backup válido.

Comando recomendado pelo Supabase para um dump portátil:

supabase db dump --db-url "[CONNECTION_STRING]" -f roles.sql --role-only
supabase db dump --db-url "[CONNECTION_STRING]" -f schema.sql
supabase db dump --db-url "[CONNECTION_STRING]" -f data.sql --use-copy --data-only

A connection string e a senha do banco NÃO devem ser colocadas neste repositório.

## Estado do trabalho

Nenhuma alteração financeira ou estrutural foi aplicada ao banco neste checkpoint.

A branch de segurança do código é:
backup/pre-financeiro-2026-10-07

Próxima etapa: validar o dump portátil e, depois disso, auditar as estruturas financeiras existentes antes de criar qualquer nova migration.
