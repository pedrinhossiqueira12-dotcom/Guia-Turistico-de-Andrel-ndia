# Etapa #42 — Fechar preflight RPC e consultar sessão Auth privada

**10/10/2026 | Guia Andrelândia | PR #39 DRAFT | HARD HOLD | Homologação**

## Evidência real, somente leitura

Consultas ao Supabase **somente do projeto de homologação**
`jbttwihctuibchhcyqtl` (não o projeto de produção) mostraram:

- `auth.sessions`: **3 sessões** existentes no instante do diagnóstico.
- `auth.mfa_factors`: **0 fatores**; portanto nenhum revisor pode,
  neste instante, demonstrar sessão com fator TOTP verificado.
- `catalogo_asaas_revisores_escrow_ensaio`: **0 revisores**.
- `catalogo_asaas_stepup_desafios_documentais_ensaio`: **0 desafios**.
- `catalogo_asaas_stepup_tentativas_inertes`: **0 tentativas**.
- As estruturas reais `auth.sessions` e `auth.mfa_factors`
  contêm `aal`, `factor_id`, `not_after`, `factor_type`,
  `status`, `user_id`. A tabela `auth.mfa_challenges` tem
  `verified_at`, mas não `session_id`: observação por fator
  não comprova desafio recente da sessão.
- O Supabase Security Advisor acusou
  `authenticated_security_definer_function_executable` para
  `public.catalogo_asaas_preflight_sessao_revisor_inerte()`.
  A função era `SECURITY DEFINER` e tinha EXECUTE para
  `authenticated`, embora não autorize transferências.

## Implementação

Migração:
`supabase/pending-migrations/20261010014000_leitor_auth_privado_revogar_preflight_inerte.sql`.

1. `REVOKE ALL` em
   `public.catalogo_asaas_preflight_sessao_revisor_inerte()`
   dos papéis `PUBLIC`, `anon`, `authenticated` e
   `service_role`. O preflight fica **interno ao dono SQL**.
   Sua lógica continua devolvendo `HOLD_OBRIGATORIO`, mas
   não pode mais ser chamada como RPC de cliente.
2. Função
   `catalogo_private.catalogo_asaas_ler_sessao_fator_auth_inerte(uuid)`
   é `STABLE SECURITY INVOKER SET search_path=''` e
   sem EXECUTE a papéis da Data API. Ela lê o estado atual
   de `auth.sessions`, `auth.users`, `auth.mfa_factors`
   em consulta exclusiva do owner PostgreSQL. **Não cria fator**,
   **não inspeciona OTP**, não realiza `mfa.verify` nem
   valida a assinatura do JWT.
3. Só retorna objeto com dados mínimos, seguindo a interface de
   laboratório `AuthSessaoConsultada`, quando todos os predicados
   são atendidos: sessão existente e AAL2, TOTP `verified`
   pertencente ao mesmo titular, `not_after` não vencido
   e usuário não banido. Caso contrário, retorna `NULL`.
   Nenhuma função RPC pública é criada.
4. Isso ainda não liga a porta de sessão do validador Deno à
   base real: o futuro backend deverá autenticar o token,
   usar uma conta isolada de banco com alçadas definidas e
   vincular o resultado ao challenge específico e ao nonce.
   Não expor este leitor ao navegador ou `service_role`
   via PostgREST.

## Testes e regressões

- `supabase/tests/isolated/catalogo-asaas-auth-sessao-owner-inerte-postgres.sql`
  simula usuários, sessões e fatores **somente no banco CI
  `catalogo_asaas_guards_ci`** e reverte tudo com `ROLLBACK`.
  Acesso por `authenticated` à antiga RPC e ao leitor
  privado deve ser `insufficient_privilege`.
  Valida retorno de AAL2/TOTP correto e falha com fator
  ausente/não verificado, sessão AAL1/vencida/revogada,
  fator de outro usuário, tipo não TOTP e usuário banido.
- O antigo
  `supabase/tests/isolated/catalogo-asaas-preflight-mfa-inerte-postgres.sql`
  foi adaptado: a RPC passa a ser negada ao papel
  `authenticated`, enquanto o owner PostgreSQL sintético
  continua exercitando cenários de JWT falsa via GUC.
  Este último teste **não comprova assinatura real**.
- `tests/catalogo-asaas-auth-session-reader-private.test.cjs`
  vigia `REVOKE`, `SECURITY INVOKER`, predicados de
  validação e ausência de alterações em tabelas Auth.
- Workflow financeiro executa as fixtures em banco descartável
  e a CI nativa do Supabase também aplica as migrações novas.

## Bloqueios restantes

O endpoint JWKS real de homologação
`https://jbttwihctuibchhcyqtl.supabase.co/auth/v1/.well-known/jwks.json`
**não pôde ser consultado nas ferramentas disponíveis** nesta rodada.
Não é possível afirmar que o projeto tenha chaves assimétricas
ativas ou que os tokens reais sejam `ES256`/`RS256`.
Em projetos com `HS256` legado, o validador do laboratório
deve negar tokens em vez de aceitar o segredo simétrico.
A documentação oficial recomenda `supabase.auth.getClaims`
e explica que o JWKS público pode permanecer cacheado
na borda por 10 minutos: cache curto local não elimina
essa janela de revogação.

A migração somente fecha exposição e prepara leitura do Auth:
não comprova MFA recente da mesma operação, não cadastra revisores
independentes, não valida prova bancária original (#41) e não
autoriza liberação financeira (#43), lançamento (#44/#45).

**Não mesclar, implantar Edge, liberar Pix/saques, criar revisores
nem alterar produção.**

Fontes oficiais:
- https://supabase.com/docs/guides/auth/signing-keys
- https://supabase.com/docs/guides/auth/sessions
- https://supabase.com/docs/guides/database/database-linter
