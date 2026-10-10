# #42 — contrato GoTrue MFA transport-only (sem deploy ou autorizações)

**Guia Andrelândia • 10/10/2026 • PR #39 DRAFT • STAGING/CI apenas**

## Problema

A etapa anterior já guardava no PostgreSQL um ID de desafio **fictício**
e um livro de tentativas com limite de três por hora. Ainda não havia
um adaptador do transporte para as APIs oficiais do Supabase Auth.

Este incremento implementa **somente o transporte HTTP**, em módulo
independente sem handler Edge, com testagem inteiramente offline.
Ele **NÃO** fornece sozinho a evidência de que um segundo fator foi
validado na sessão/operação e não deve ser ativado em produção.

## Implementação

`supabase/functions/_shared/catalogo-asaas-gotrue-mfa-transporte-inerte.ts`
define uma porta compatível com o simulador documental. O módulo conhece
três endpoints oficiais do serviço GoTrue, segundo a implementação do
Supabase Auth:

- `GET /auth/v1/user` valida a identidade reconhecida pelo Auth, mas
  **não comprova sozinho o session_id, a revogação ou a assinatura do JWT**.
- `POST /auth/v1/factors/{factor_id}/challenge` cria um desafio para
  o fator verificado na operação.
- `POST /auth/v1/factors/{factor_id}/verify` recebe apenas
  `challenge_id` e `code`, retornando um access token. Um eventual
  refresh token da resposta é **deliberadamente descartado**.

A autenticação final do token retornado exige um callback explícito
`verificarAssinaturaJwtESessaoNoServidor` cujo **backend real ainda
não foi implementado**. Esse callback futuramente deverá verificar:
assinatura criptográfica, emissor e audiência, expiração, correspondência
de `sub` com `GET /user`, sessão original ainda existente e não
revogada em `auth.sessions` e fator que pertence ao usuário.

O adaptador só aceita URL HTTPS do domínio exato de projeto
`*.supabase.co` e **chave pública** `sb_publishable_...`;
recusa outros hosts, credenciais embutidas, portas e caminhos
inesperados. O cliente de transporte HTTP é **injetado**, sem
`fetch` global como fallback. Não há `service_role`.

Não existe função que registre aprovação financeira; mesmo quando o
simulador offline aceita uma resposta, devolve sempre
`desafio_mfa_real_comprovado=false`,
`parecer_financeiro_autorizado=false`,
`pagamento_autorizado=false`, `movimenta_dinheiro=false`,
`liberacao_autorizada=false` e `HOLD_OBRIGATORIO`.

## Testes

`supabase/functions/tests/catalogo-asaas-gotrue-mfa-transporte-inerte.test.ts`
executa com `deno test --no-check --allow-read=supabase/functions`:
**sem `--allow-net` e sem secrets de produção**. O provedor
`fetch` é uma função falsa em memória e o verificador da sessão
de CI também é sintético.

Cobertura: sequência `GET /user → challenge → verify → GET /user`,
proteção do `challenge_id`, não vazamento de refresh token,
user IDs conflitantes, assinatura/sessão recusadas antes de chamada,
sessão trocada após verificar, URLs forjadas, token Bearer com CRLF,
fator malformado, TOTP inválido, erro/JSON inválido da API e
negação de replay. O teste de tipo Deno roda na CI financeira.

## Para utilizar Auth real futuramente

1. Implementar verificação server-side assinada das claims com
   `supabase.auth.getClaims(token)` ou validador equivalente,
   **mais** verificação de `auth.sessions` e revogações; nunca usar
   apenas `getUser` ou confiar no JWT simplesmente decodificado.
2. Unir essa verificação real ao livro PostgreSQL de desafios com
   nonce de ação e consumo **transacional multi-instância**.
   Armazenar no banco somente metadados não sensíveis.
3. Aplicar políticas específicas contra brute force, substituição de
   fatores, mudanças de sessão e abuso de recuperação. Nunca
   registrar código TOTP ou bearer em logs.
4. Credenciar **dois revisores humanos** e vincular ações individuais
   e independentes ao mesmo conjunto imutável de evidências.
5. Completar evidência bancária independente de titularidade (#41),
   revalidação de liquidação e liberação segregada (#43), revisão
   jurídica, autorização contratual e go-live formal (#45).

**IMPORTANTE:** chamar endpoints oficiais com um HTTP fake na CI
não significa que o Supabase Auth real tenha sido testado. Nenhuma
conta, MFA, Pix, Edge Function ou migração foi ativada nesta rodada.

Referências oficiais:
- https://supabase.com/docs/reference/javascript/auth-mfa-challenge
- https://supabase.com/docs/reference/javascript/auth-mfa-verify
- https://supabase.com/docs/guides/auth/auth-mfa
- https://github.com/supabase/auth/blob/master/internal/api/api.go
