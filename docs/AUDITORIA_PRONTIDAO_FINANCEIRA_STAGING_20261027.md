# Auditoria de prontidão financeira — STAGING — 27/10/2026

**Escopo:** revisão somente de leitura do Supabase STAGING (`jbttwihctuibchhcyqtl`) e código/CI da PR draft #57 (`fix/staging-oauth-qa-guard-20261026`). **Não é aprovação para produção.** Não gerar Pix, não chamar POST financeiro, não habilitar checkout, não fazer merge, não tocar em PROD.

## Estado comprovado

| Controle | Evidência | Resultado |
|---|---|---|
| OAuth de vendedor teste | 1 `catalogo_recebedores` para `asaas-homologacao`, `status='bloqueado'`, `oauth_live_mode=false`, tokens cifrados presentes | **Aprovado para QA**, não para recebimentos |
| Autorizações pendentes | 0 `catalogo_oauth_estados` ainda válidos e não consumidos; 1 consumido | Encerrado |
| Pagamentos | 0 `catalogo_pagamentos_v2`, 0 pedidos com `payment_id` | Nenhum pagamento registrado |
| OAuth novo desligado | Administrador confirmou `MP_OAUTH_QA_ENABLED=false`; workflow `staging-oauth-deny-smoke.yml` confirmou `503` no starter por chave pública, `401` no preflight sem autenticação e `400` no callback de erro sem state | **Fail closed** (HTTP 503 isoladamente não comprova o valor de um Secret) |
| Dados sensíveis | RLS ligado e permissões `SELECT/INSERT` ausentes para `anon` e `authenticated` em `catalogo_oauth_estados`, `catalogo_recebedores`, `catalogo_pedidos`, `catalogo_pagamentos_v2` | Protegidos para acesso direto dessas roles |
| Publicação | PR #57 `draft`, sem merge; produção não alterada nesta auditoria | Mantida em revisão |

## Bloqueio de implantação identificado

- **A função Pix publicada no STAGING não está alinhada ao código da PR**. A versão hospedada observada: **v87**; `receiverFor()` verifica `status='ativo'`, mas **não** seleciona nem verifica `oauth_live_mode`.
- O código revisado em `supabase/functions/catalogo-pedido-pix/index.ts` da PR #57 **inclui** `oauth_live_mode` na consulta e exige `receiver.oauth_live_mode === true` antes de qualquer chamada externa ao Mercado Pago.
- **Hoje o vendedor QA segue bloqueado por `status='bloqueado'` e pelo checkout desabilitado**, mas a diferença de versões é um risco de prontidão: um registro com status alterado incorretamente poderia escapar do bloqueio de sandbox do runtime antigo **se** o checkout também fosse habilitado.
- **Não publicar nem habilitar a função Pix sem plano separado de implantação e verificação de workers existentes**, pois podem existir tarefas/requests de pagamentos em voo. Guardas no código novo não provam parada das revisões antigas.
- **Go/No-go obrigatório:** em implantação isolada, comparar código hash/versão publicada ao artefato aprovado, verificar esgotamento de trabalhadores/requests antigos segundo capacidade da infraestrutura e comprovar os bloqueios contra recebedor `live_mode` falso, ausente e `status` bloqueado. Não declarar concluído antes disso.

## Regressões adicionadas nesta auditoria

No arquivo `tests/catalogo-v2-pix-endpoints.test.cjs`, testes isolados com provedor fictício devem provar:

1. `MARKETPLACE_CHECKOUT_ENABLED=false` → HTTP **503**, **0 POST/GET ao provedor**, nenhum pedido, nenhum item, nenhum RPC financeiro.
2. Mesmo que o registro esteja marcado como `status='ativo'`, `oauth_live_mode` em `false`, `null`, ausente, texto `"false"` ou número `0` → HTTP **409**, **0 POST/GET ao provedor**, nenhum `payment_id` e pedido local apenas pendente se criado.
3. O modo `true` permanece exercitado pelos testes prévios de pagamentos, fees, idempotência, webhook e reconciliação **com mocks apenas**. Não são autorizações reais de pagamentos.

## Avisos de segurança do Supabase a revisar, sem correção automática

- [`anon_security_definer_function_executable`](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) e [`authenticated_security_definer_function_executable`](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable): `public.catalogo_status_publicacao(p_ids text[])` está disponível via RPC e `SECURITY DEFINER`. Inspeção de leitura encontrou saída limitada a `(local_id,status)` e no máximo 100 IDs por chamada, aparentemente adequada a uma consulta pública de estado, **mas ainda requer confirmação de intenção** antes de produção; não revogar à cegas.
- [`auth_leaked_password_protection`](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection): proteção contra senhas comprometidas não está habilitada na configuração inspecionada. Ajustar pelo painel com revisão de políticas antes de produção.
- [`rls_enabled_no_policy`](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy): 64 tabelas sem policies, incluindo tabelas privadas/financeiras. Isso **não significa exposição pública** quando RLS está ativo; avaliar apenas se algum fluxo legítimo precisa de permissões, sem adicionar policies genéricas.

## Próximos critérios para liberar produção

1. Resolver divergência entre PR aprovada e função Pix hospedada, com plano de implantação seguro e evidência de bloqueio de revisões antigas.
2. Revisar configuração efetiva de checkout/desligamento e arquitetura Asaas/Mercado Pago, inclusive drenagem de `waitUntil`, rede de saída, chaves e segregação staging/prod.
3. Provar autenticação e autorização de proprietários/entregadores, webhook autêntico, deduplicação, idempotência, precificação 7%, conciliação, cancelamento, chargeback, estorno e auditoria de erros em **ambiente isolado com provedores simulados**.
4. Planejar QA ponta a ponta financeiro com contas sandbox e limites explícitos, após avaliação dos riscos de chamadas externas. **Não** usar contas de produção nem converter automaticamente o vínculo teste para `ativo`.
5. Somente depois, submeter revisão humana do release, plano de rollback, métricas/alertas e autorização específica para habilitar pagamentos reais.

**Decisão:** **NO-GO para checkout de produção**. OAuth QA concluído. Proteções existentes mantidas. Sem alteração de secrets, cobranças, pagamentos, lançamentos ou dados da produção durante esta auditoria.
