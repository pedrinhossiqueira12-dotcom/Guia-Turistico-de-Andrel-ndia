# PR #39 · Issue #42 — ponte privada de MFA: isolamento, não ativação

**10/10/2026. Somente branch e testes PostgreSQL descartáveis.** Sem
implantação desta ponte em STAGING ou produção, sem credenciais criadas.

## Motivação

As funções `catalogo_private` de reserva de contexto e desafio executam
como invocador e consultam tabelas privadas de Auth e do escrow. Não se deve
conceder EXECUTE dessas funções ou SELECT nas tabelas a `anon`,
`authenticated` ou `service_role` para conseguir chamar uma Edge Function.

O passo atual define apenas o limite SQL de um canal futuro, sem canal
de rede nem autenticação operacional:

- A migration **pendente**
  `supabase/pending-migrations/20261010021000_ponte_mfa_role_nologin_inerte.sql`
  cria `catalogo_mfa_ponte_ci_inerte`, papel **NOLOGIN, NOINHERIT,
  NOBYPASSRLS, NOSUPERUSER, NOCREATEROLE, NOCREATEDB**. Não define senha
  nem associa contas humanas ou serviços ao papel.
- Cria o **esquema exclusivo**
  `catalogo_mfa_ponte_ci_inerte`; só esse esquema concede USAGE ao papel
  de laboratório. Não concede USAGE ao conjunto geral de
  `catalogo_private`, nem direitos diretos a `public` ou `auth`.
- Cinco funções `SECURITY DEFINER` com `search_path` vazio chamam
  **somente** a reserva vinculada ao principal Auth, a leitura de contexto,
  o registro de desafio, a leitura de tentativa e o consumo documental.
  Cada função é explícita; não existe executor SQL arbitrário.
- Os wrappers foram projetados para devolver os mesmos contratos
  *inertes* das funções originais: `HOLD_OBRIGATORIO`, sem OTP,
  movimentação de dinheiro, baixa ou prova MFA financeira.

## Provas automatizadas

1. A migração é aplicada ao clone `catalogo_asaas_guards_ci` no workflow
   "All financial migrations except remote scheduling".
2. O teste
   `supabase/tests/isolated/catalogo-asaas-ponte-nologin-mfa-inerte-postgres.sql`
   utiliza `SET LOCAL ROLE` **somente em PostgreSQL temporário** para
   chamar os cinco wrappers com IDs inexistentes. Exige respostas
   negativas, flags financeiras falsas e zero nonce/desafio/consumo.
3. A mesma role precisa ser incapaz de ler as tabelas brutas ou executar
   diretamente as funções `catalogo_private`.
4. Confere ausência de EXECUTE para `anon`, `authenticated` e
   `service_role`, ausência de membership da Data API e atributos
   não privilegiados da role.
5. O teste
   `tests/catalogo-asaas-mfa-ponte-privada-nologin.test.cjs` evita
   regressões que criem credenciais, privilégios amplos ou mais de cinco
   wrappers.

## Bloqueios deliberados

**Esse papel NOLOGIN não permite acesso externo; não é um canal funcional.**
Não existe usuário LOGIN, senha, certificado, pooler, Edge handler ou
instrumento de autorização financeira. Não usar o papel `postgres`,
`service_role` ou `authenticator` como atalho.

As wrappers `SECURITY DEFINER` são privilegiadas: antes de qualquer
implantação em STAGING, passar por revisão independente de privilégios,
transações, concorrência, revogação, logs e rollback. Não adicionar
`LOGIN`, não conceder `SET ROLE` a usuários da Data API e não expor o
esquema novo no PostgREST.

Os parâmetros `userId/sessionId` da reserva vinculada **não autenticam
ninguém**: só podem vir de um backend que já verificou assinatura JWT,
sessão AAL1 atual, titularidade do fator TOTP e autorização de revisor
sem conflitos. Esse backend e o transporte de credenciais de mínimo
privilégio ainda **não existem**.

Falta GoTrue/TOTP verdadeiro no STAGING (última auditoria: zero fatores
verificados), titularidade Pix e exigências #41, e dupla aprovação/baixa
atômica #43. Nenhum dado bancário real foi usado. Não autorizar Pix
simplesmente porque um JWT apresenta AAL2.

**HOLD_OBRIGATORIO. PR #39 continua DRAFT; nenhuma movimentação financeira,
merge ou deploy desta ponte.**
