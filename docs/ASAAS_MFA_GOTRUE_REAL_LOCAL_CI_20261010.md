# PR #39 / Issue #42 — TOTP real com GoTrue LOCAL, sem autorizações financeiras

Data: 10/10/2026. Escopo: testes automáticos do Supabase nativo em CI.

## O que este incremento comprova

A suíte anterior ensaiava GoTrue por transporte HTTP **simulado**, com
assinatura JWT ES256 feita pela própria CI. Este incremento acrescenta um
teste com **o servidor GoTrue verdadeiro**, levantado via `supabase start`
em um workspace temporário, sem ligação ao STAGING ou à produção.

Arquivo: `scripts/validacao-pagamentos/test-gotrue-mfa-real-local.ts`.

1. Verifica `--native-ci-local-only`, variáveis sensíveis proibidas e
   restringe a origem a `http://127.0.0.1:54321/auth/v1`.
2. Cria usuário de teste por `POST /auth/v1/signup`, com email e senha
   gerados com entropia local. Nunca imprime ou versiona esses dados.
3. Obtém acesso autenticado AAL1; confirma com `GET /auth/v1/user`.
4. Inscreve fator `totp` usando `POST /auth/v1/factors`.
   O segredo Base32 gerado pelo **GoTrue real** só existe na memória do
   processo e nunca é mostrado na saída do CI.
5. Cria um challenge real; gera OTP 6 dígitos com HMAC-SHA1 em WebCrypto
   e envia `challenge_id` + `code` a `/factors/{id}/verify`.
6. Confere resposta AAL2, mesmo `sub` e `session_id`, além de
   `GET /auth/v1/user` no novo access token.
7. Sai indicando `moneyAuthorized:false`. Não chama nenhuma
   função de pagamentos, parecer, crédito, fatura, saque ou transferência.

O código implementa gerador TOTP auditável e os testes
`scripts/validacao-pagamentos/test-gotrue-mfa-real-local.unit.test.ts`
comparam os códigos com vetores públicos RFC 6238. Testes Node
`tests/catalogo-asaas-gotrue-real-local-ci.test.cjs` vigiam os limites
de rede, ambiente e a ausência de endpoints de dinheiro.

A CI também gera uma configuração temporária com
`[auth.email] enable_confirmations=false` e
`[auth.mfa.totp] enroll_enabled=true, verify_enabled=true`.
**Somente essa configuração local descartável é modificada**, no script
`scripts/validacao-pagamentos/build-native-supabase-ci.py`; o
`supabase/config.toml` real do projeto é preservado.

A execução Deno recebe exclusivamente a ANON_KEY gerada por
`supabase status -o env` do projeto temporário, sem imprimir o conteúdo
do comando. A opção `--allow-net=127.0.0.1:54321` impede acesso a
serviços externos. A conta criada é destruída quando a stack para.

## Limites desta prova

- É um teste com GoTrue **real, porém LOCAL** — não é uma inscrição TOTP
  real em `jbttwihctuibchhcyqtl` (STAGING). A última conferência do
  STAGING encontrou **zero fatores TOTP verificados**.
- O parsing das claims JWT nesse *smoke test* não substitui verificação
  criptográfica pelo backend financeiro. O teste também confirma o token
  contra o `/user` REAL, mas **não realiza consulta privada** à
  `auth.sessions` em operação de pagamento.
- Não conecta a nova role `NOLOGIN`, não instala a migration 21000,
  não concede `EXECUTE` a PostgREST nem liga essa prova a endpoints Edge.
- AAL2 não prova sozinho a autorização daquele saque nem a titularidade
  bancária. Seguem pendentes #41 (Pix) e #43 (dupla revisão/baixa).
- Login, segredo de segundo fator e OTP **nunca devem ser enviados
  na conversa, num issue GitHub ou em logs CI**.

## Etapas remanescentes

O responsável deverá criar/usar uma **conta de teste controlada em
STAGING**, realizar `supabase.auth.mfa.enroll({factorType:'totp'})`,
`mfa.challenge` e `mfa.verify` com um app autenticador, validando AAL2
numa sessão autêntica, sem qualquer movimentação financeira. O backend
privilegiado de privilégio mínimo e a prova bancária/dupla aprovação
precisam ser revisados separadamente antes de produção.

Documentação de referência:
- https://supabase.com/docs/guides/auth/auth-mfa/totp
- https://supabase.com/docs/guides/local-development/cli/config
- https://www.rfc-editor.org/rfc/rfc6238

**HOLD_OBRIGATORIO. PR #39 DRAFT. Nenhuma ativação Asaas de produção,
sem deploy da ponte de CI, sem saques ou Pix reais.**
