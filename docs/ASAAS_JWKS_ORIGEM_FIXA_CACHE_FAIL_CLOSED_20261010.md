# #42 — Resolvedor JWKS com origem fixada e cache fail-closed

**10/10/2026 | Guia Andrelândia | PR #39 Draft | HOLD obrigatório**

## Entrega implementada no código

O módulo
`supabase/functions/_shared/catalogo-asaas-jwks-fixo-cache-inerte.ts`
implementa um resolvedor **isolado** de chaves públicas de
assinatura JWT para as interfaces da etapa #42. Ele é compatível com
`ValidadorJwtSessaoInerte`, mas **nenhuma Edge Function importa ou
publica esse módulo**. Não existe chamada de dinheiro ou autorização.

**Origem estritamente fixada:** o backend fornece `projectRef` e
`projectUrl`, que devem corresponder exatamente a
`https://{projectRef}.supabase.co` (sem portas, credenciais, paths,
queries ou host semelhante). A única rota construída internamente é
`/auth/v1/.well-known/jwks.json`. O token do cliente não pode passar
`jwks_uri`, `jku`, `x5u`, `jwk` ou outra URL externa.

**Rede controlada:** o HTTP é obrigatoriamente injetado.
Na CI apenas uma função falsa recebe a chamada, sem `--allow-net`.
As opções utilizadas são `redirect:"error"`, `credentials:"omit"`,
`cache:"no-store"`, `Accept: application/json`, timeout de 3,5s,
máximo de 32 KiB de resposta **lidos em streaming** e validação de
tipo de conteúdo. Nunca envia Bearer nem `service_role` ao JWKS.

**Chaves aceitas:** apenas um conjunto não vazio de até 12 chaves
públicas `ES256` P-256 ou `RS256` RSA 2048+ bits, com `kid`
distinto, uso `sig`, nenhum campo de chave privada/simétrica ou
operação de assinatura. Chaves HS256, `oct`, `kid` duplicado,
payload malformado e HTTP inesperado são recusados.

**Cache controlado:** janela curta configurável de 1 a 60 segundos.
Consultas simultâneas compartilham a mesma busca HTTP. O cache
não serve chaves expiradas quando a origem fica indisponível, rejeita
recuo do relógio e devolve **cópias profundas** para impedir mutação
das chaves mantidas internamente pelo chamador. Se JWKS muda na
renovação, o verificador criptográfico passa a rejeitar JWT assinado
pela chave antiga e pode aceitar a nova.

O resolvedor só injeta a **consulta de sessão/fator** por uma porta
obrigatória. Não concede acesso a `auth.sessions` ao navegador ou
Data API; a implementação real dessa porta ainda está pendente.
A verificação completa também necessita do
`ValidadorJwtSessaoInerte` e do fluxo de MFA posterior.

## Cobertura dos testes

Arquivo:
`supabase/functions/tests/catalogo-asaas-jwks-fixo-cache-inerte.test.ts`.

A suíte Deno executa **sem rede** e gera pares de chaves reais em
memória, verificando:
- Domínio exato pinado, bloqueio de hosts maliciosos, redirect e cookies.
- Primeiro download e cache curto; paralelismo com uma única chamada.
- Assinatura ES256 real aceita somente com chave de origem confiável
  e sessão Auth fictícia ativa.
- Revogação por rotação da JWKS (JWT anterior deixa de validar depois
  da próxima busca) e **negação quando origem está offline e cache venceu**.
- Rejeição de material privado/simétrico, `kid` ausente/duplicado,
  chave que não permite verificação, JSON/HTTP/tamanho inválidos.
- Relógio retrocedendo bloqueia reuso de cache; arrays mutáveis em
  JWK retornado não modificam a cópia no cache.

`.github/workflows/database-tests.yml` inclui `deno check` e
os testes no job Deno offline.

## Limites críticos para produção

1. O Supabase **também faz cache na borda do JWKS por cerca de 10
   minutos**. O TTL de 1–60 segundos acima **não acelera a
   revogação global instantaneamente**. É imprescindível checar a
   sessão/fator corrente no Auth e definir política de emergências.
2. O JWKS também pode anunciar chaves assimétricas em estado
   `standby`. O protótipo não confirma o estado da chave de
   assinatura no servidor; revisão de confiança de chaves/certificados
   e da rotação é pendência **antes** de ativar o verificador.
3. Se o projeto ainda emite `HS256`, a lista de chaves assimétricas
   pode estar vazia e o resolvedor **recusará** a autenticação em vez
   de aceitar segredo compartilhado. Planejar migração de
   JWTs/Edge Functions sem interromper usuários.
4. A URL do projeto **não deve ser aceita de um parâmetro do usuário**:
   ela precisa ser configurada por implantação e revisada. O módulo
   não realiza descoberta livre nem fallback para outra origem.
5. A porta `consultarSessaoEFator` permanece **simulada**: nenhuma
   prova de sessão Auth real ou desafio recente foi produzida. O
   verificador e o transporte GoTrue continuam fora das Edge
   Functions publicadas.
6. O uso de rotinas criptográficas customizadas exige revisão
   independente; para integração real, avaliar preferencialmente
   `supabase.auth.getClaims` ou biblioteca `jose` com versão fixa,
   verificação de origem e tratamento de revogação.
7. Aprovação por dois revisores reais, prova bancária independente
   (#41), liberação segura (#43) e credenciais/regularização para
   produção (#44/#45) **continuam bloqueadas**.

O endpoint público JWKS da homologação não foi usado como fonte de
chaves reais nesta entrega. Não houve publicação de Edge, consulta
de dados de usuário no Auth, migração SQL nova, pagamento, Pix, baixa,
merge ou qualquer mudança no Supabase de produção.

**A aprovação financeira deve continuar `HOLD_OBRIGATORIO`.**

Fonte oficial: https://supabase.com/docs/guides/auth/signing-keys
