# #42 — Validação criptográfica JWT + sessão Auth em laboratório

**Guia Andrelândia • 10/10/2026 • PR #39 DRAFT • SEM ATIVAÇÃO FINANCEIRA**

## Entrega do incremento

Criado `supabase/functions/_shared/catalogo-asaas-jwt-sessao-assinada-ensaio.ts` com validador
**experimental** que usa WebCrypto real para verificar JWT assimétrico
(`ES256` e `RS256`), chave pública no JWKS previamente confiável,
identificador de chave `kid` e campos obrigatórios do JWT.

As claims são examinadas **antes de consultar a sessão**. O validador
recusa algoritmos `none` e `HS256`, ausência ou duplicidade de `kid`,
chave secreta/simétrica, referências de JWKS controladas pelo token,
token malformado, assinatura inválida, emissor diferente, audiência
diferente de `authenticated`, função diferente de `authenticated`,
login anônimo, `aal` diferente de 2, token antigo, expirado ou
com data futura e IDs de usuário/sessão inválidos.

Somente após `crypto.subtle.verify()` retornar sucesso são consultados
`auth.sessions` e `auth.mfa_factors` por **interface privada
obrigatória**. A validação compara `sub` e `session_id` com a sessão
existente, verifica prazo (`not_after`), AAL2, `factor_id`,
titularidade do fator, tipo TOTP e status `verified`.
Se consulta/JWKS estiverem indisponíveis ou divergentes, retorna
`null` (fail-closed).

O código **não verifica que o último challenge MFA pertence à ação**
nem comprova a hora do segundo fator. AAL2, isoladamente, não é prova
de step-up recente. O módulo tampouco grava pareceres ou retorna
quaisquer autorizações de Pix.

## Integração experimental coberta na CI

Módulos:
- `supabase/functions/_shared/catalogo-asaas-jwt-sessao-assinada-ensaio.ts`;
- `supabase/functions/_shared/catalogo-asaas-gotrue-mfa-transporte-inerte.ts`;
- `supabase/functions/_shared/catalogo-asaas-stepup-documental-ensaio.ts`.

Testes:
- `supabase/functions/tests/catalogo-asaas-jwt-sessao-assinada-ensaio.test.ts`
  gera pares de chaves **ES256 e RS256 REAIS em memória**, assina
  tokens localmente e verifica criptograficamente a assinatura.
  Cobre assinatura/payload adulterados, `kid` incorreto e repetido,
  algoritmo indevido, issuer/audience incorretos, AAL1, token anônimo,
  expiração, emissão antiga/futura, sessão inexistente/revogada, fator
  alterado, erro na origem das chaves, falha do banco e
  `user_metadata` falso.
- `supabase/functions/tests/catalogo-asaas-gotrue-jwt-assinado-integracao-inerte.test.ts`
  combina token **assinado de verdade** com a sequência HTTP
  **falsa** `GET /user → POST challenge → POST verify → GET /user`
  e o simulador de nonce documental. Também revoga a sessão simulada
  entre a verificação do código e a revalidação do token de retorno.
  Em qualquer caminho, Pix, pareceres, liberações e baixas ficam
  explicitamente em `false` / `HOLD_OBRIGATORIO`.
- `tests/catalogo-asaas-jwt-sessao-assinada-inerte.test.cjs`
  proíbe importação em handlers Edge já publicados e protege a ordem
  assinatura → consulta de sessão.
- Todos os testes Deno usam portas de Auth/HTTP/JWKS/PG **falsas**,
  sem `--allow-net`, dados reais ou chaves reais do projeto.
  O PostgreSQL STAGING não é modificado nesta etapa.

## Limites e próximos bloqueios de segurança

**O protótipo não pode ser considerado um verificador de produção.**
Ele demonstra o contrato e o comportamento de um verificador
criptográfico, mas a interface `buscarJwksConfiavel` e a consulta a
`auth.sessions` são preenchidas apenas por mocks na CI.
Nunca permitir que cliente, navegador ou bearer token escolham a
URL de chaves ou o resultado da consulta da sessão.

Antes de integrar, é necessário:
1. Configurar/confirmar chave de assinatura **assimétrica** no
   projeto Supabase: instalações ainda em `HS256` devem **falhar
   fechadas** neste contrato até migração planejada. Evitar gestão
   manual de segredo simétrico.
2. Implementar resolvedor de JWKS de origem fixada a projeto,
   limites de resposta, estratégia de cache/revalidação e rotação
   de chaves. Preferir biblioteca de JWT **auditada** (como
   `jose` com versão fixa e lockfile) ou `supabase.auth.getClaims`
   com verificação documental da assinatura.
3. Implementar consulta de `auth.sessions` + `auth.mfa_factors`
   por backend **privilegiado e isolado**, revogação imediata,
   nenhum RPC público e nenhuma trust em `user_metadata`.
4. Associar resultado real de `mfa.verify` ao mesmo
   `challenge_id`, `nonce`, sessão, revisor, evidência e operação
   por transação **atômica e persistente**. Implementar registro
   de evento de prova, política de tentativas, refresh token e
   recoveries sem replay.
5. Credenciar revisores reais e independentes com MFA próprio.
6. Concluir prova independente da titularidade/resultado Pix
   (#41), autorização e baixa transacional (#43), auditoria e
   habilitação de produção (#44–45).

**Proibido:** merge PR #39, deploy financeiro, Pix, Money Out,
liberação/baixa de comissões, ativar o protótipo como autorização
ou modificar produção sem aprovação explícita.

Fontes Supabase:
- https://supabase.com/docs/guides/auth/signing-keys
- https://supabase.com/docs/guides/auth/jwts
- https://supabase.com/docs/guides/auth/sessions
- https://supabase.com/docs/guides/auth/auth-mfa
- https://supabase.com/docs/guides/auth/oauth-server/oauth-flows
