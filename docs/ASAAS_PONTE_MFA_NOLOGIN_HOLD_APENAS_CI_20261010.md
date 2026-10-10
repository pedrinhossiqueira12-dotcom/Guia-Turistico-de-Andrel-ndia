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


## Incremento 17 — guarda de instalacao (10/10/2026)

**Bloqueio material acrescentado ao comeco da propria migration 21000**:
antes de CREATE ROLE, schema ou wrapper, a migration executa
`DO $ci_only_bridge$` e aborta toda a transacao caso algum criterio
seja falso:

- `current_database()='catalogo_asaas_guards_ci'`;
- `current_setting('app.catalogo_ci_mfa_bridge',true)='enabled'`
  configurado explicitamente para ESSA sessao psql de CI;
- `session_user='postgres'` no container efemero de testes.

Uma aplicacao acidental em STAGING/PROD usa o banco `postgres`,
portanto falha mesmo que alguem repita o opt-in. Não transformar essa
proteção num segredo; a garantia é não instalar em ambientes reais, não
autenticar um requisitante HTTP.

No workflow `database-tests.yml` o arquivo 21000 e o único cuja
aplicação tem opt-in explícito. ANTES da aplicação normal o CI testa
duas recusas reais: no clone autorizado sem opt-in; no banco
`catalogo_ci` com opt-in. Ambos DEVEM gerar `CI_ONLY_MFA_BRIDGE`,
e o papel NÃO pode existir depois das recusas. Somente após essas
checagens o CI executa a migração no clone permitido e os testes
SQL de papel, wrappers e grants.

Este é um *fail-closed de engenharia*, não um canal privado operacional:
não existe endpoint Auth MFA financeiro, credencial técnica real,
delegação a Edge ou permissão de transferência. O status continua
`HOLD_OBRIGATORIO`. Em especial, executar scripts de migração sem
revisão em bancos de produção continua proibido.


## Incremento 18 — concessoes transitivas e revoke dinamico (10/10/2026)

A auditoria identificou um risco real do PostgreSQL 17: uma conta pode
receber a capacidade de `SET ROLE` por uma **cadeia transitiva de grants**,
mesmo que o alvo seja `NOLOGIN`, e ainda que o papel autenticado nao
apresente `EXECUTE` herdado diretamente. Portanto, verificar apenas
membros imediatos em `pg_auth_members` nao prova isolamento.

A migration 21000 agora estabelece DUAS barreiras adicionais:

1. **Instalacao** — recusa se a role da ponte tiver QUALQUER membro
   (inclusive papel intermediario/role desconhecida). Tambem audita
   explicitamente `pg_has_role(...,'MEMBER')` para os papeis Data API,
   cobrindo grants indiretos.
2. **Cada invocacao** — as cinco wrappers `SECURITY DEFINER` consultam
   `pg_auth_members` para identificar QUALQUER concessao direta do
   papel privilegiado a terceiros e usam `WHERE NOT EXISTS`. Caso alguem
   crie uma associacao posteriormente, retornam `NULL` sem chamar a
   funcao privada. A verificacao de membership transitiva para
   `anon/authenticated/service_role/authenticator` tambem permanece
   aplicada.

Os novos testes PostgreSQL simulam uma cadeia
`authenticated -> catalogo_ci_mfa_pivot_inerte -> ponte` com
`SET TRUE` e `INHERIT FALSE`: `pg_has_role(...,'MEMBER')` e
`pg_has_role(...,'SET')` detectam a possibilidade de impersonacao,
mesmo quando `has_function_privilege(...,'EXECUTE')` nao revela
heranca. Em seguida invocam **TODAS as cinco wrappers** sob papel da
ponte, exigindo retorno SQL NULL. Outro teste concede membership a
uma role *que nao pertence ao Supabase*, exigindo a mesma recusa.

Todas as roles/grants maliciosos dos testes sao criados em banco de CI
descartavel sob `SAVEPOINT` e revertidos, antes dos ensaios de resposta
normal em `HOLD_OBRIGATORIO`. Teste estatico Node confere essas regras.

**Decisao de design:** nesta fase a role ponte continua SEM MEMBROS,
SEM LOGIN, SEM USUARIO DE SERVICO. Integrar backend real exigira
uma migration diferente, auditoria de role/credencial propria, testes
de revogacao e controle de alcance; **nao remover estes guards apenas
para conseguir conectar o frontend/Edge**.

Referencias de semantica PostgreSQL 17:
https://www.postgresql.org/docs/17/sql-grant.html
https://www.postgresql.org/docs/17/role-membership.html

Status permanece `HOLD_OBRIGATORIO` e **migration 21000 nao foi
aplicada em STAGING ou PROD**.
