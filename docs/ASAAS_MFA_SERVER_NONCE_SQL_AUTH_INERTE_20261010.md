# PR #39 / #42 — Contrato de nonce gerado no PostgreSQL e GoTrue (INERTE)

Data: 10/10/2026. Escopo: contrato e testes offline, nenhuma nova implantacao.

## Problema resolvido no contrato

O simulador antigo partia de um nonce existente na intencao, mas a nova
reserva SQL duravel gera esse nonce no servidor. Conectar os dois sem
adaptacao permitiria discordancia sobre a identidade da operacao.

A classe OrquestradorPrechallengeInerte agora modela a ordem correta:

1. Recebe somente contextoId e bearer. Reserva contexto na porta privada
   do PostgreSQL antes de consultar Auth. O banco gera nonce inalteravel.
2. Le snapshot do contexto owner-only: usuario, sessao, TOTP verificado,
   separacao contabil, hash do dossie e expiracao. Revalida a sessao AAL1
   autenticada e a titularidade do fator via backend independente.
3. Solicita challenge Auth no fator original. Antes de disponibilizar
   tentativa ao chamador, grava no banco desafio e tentativa com UNIQUE.
   Nao devolve nonce, challenge_id, fator ou hash ao cliente.
4. No confirmar(), consulta novamente a tentativa no banco (nao utiliza
   Map em memoria), valida sessao e fator originais, consome o desafio
   no banco antes do OTP e somente depois chama Auth verify.
5. Exige que a resposta assinada de Auth seja AAL2 na MESMA sessao com
   o MESMO fator. Todos os retornos continuam com HOLD_OBRIGATORIO;
   autenticar nao e autorizar pagamento.

As flags de parecer, dupla aprovacao, autorizacao Pix, baixa e movimentacao
de dinheiro devem permanecer false inclusive nas respostas do banco.

## Testes

- Contrato e Deno: supabase/functions/_shared/catalogo-asaas-mfa-orquestrador-prechallenge-inerte.ts
- Testes novos: supabase/functions/tests/catalogo-asaas-mfa-orquestrador-prechallenge-inerte.test.ts
- Pipeline: Financial snapshot tests (Deno, isolated) em .github/workflows/database-tests.yml
- PostgreSQL concorrente real separado: scripts/validacao-pagamentos/test-asaas-advisory-concurrency.py

Cenarios: duas instancias, nonce exclusivamente SQL, challenge exclusivo,
replay de OTP bloqueado, fator falso, JWT divergente, sessao AAL2 diferente,
falha do Auth, banco indisponivel, expiracao, SQL que indevidamente libera
dinheiro e recibos adulterados. Nenhum teste acessa rede financeira.

## LIMITES REAIS E PENDENCIAS

- A classe e o livro SQL sao portas INERTES de testes, nao sao um
  endpoint MFA implantado. O livro simulado por Map nao substitui
  o teste de concorrencia verdadeiro de duas conexoes PostgreSQL na CI.
- O PostgreSQL de STAGING tem as funcoes em catalogo_private acessiveis
  apenas ao owner SQL, com EXECUTE revogado para anon, authenticated e
  service_role. Nao conceder acesso via Data API para integrar um Edge.
  Falta desenhar canal backend privado auditado com privilegios minimos.
- Falta inscricao de fatores TOTP reais em STAGING; a ultima auditoria
  encontrou zero fatores TOTP verificados.
- AAL2 de sessao por si nao comprova vinculo de challenge a operacao.
  E obrigatoria uma trilha independente, revisores sem conflito (#43)
  e prova bancaria/titularidade da chave Pix original (#41).
- Nenhum endpoint, secret, migration, webhook, transferencia ou Asaas
  producao foi alterado neste incremento. PR #39 continua Draft/HOLD.

Fontes Supabase:
https://supabase.com/docs/reference/javascript/auth-mfa-challenge
https://supabase.com/docs/reference/javascript/auth-mfa-verify
https://supabase.com/docs/reference/javascript/auth-getclaims
https://supabase.com/docs/guides/auth/auth-mfa


## Incremento posterior — leitor owner-only duravel (10/10/2026)

A nova migration pendente
`20261010019000_leituras_privadas_unchallenge_mfa_inertes.sql`
implementa as DUAS consultas que faltavam entre o orquestrador TypeScript
e o livro PostgreSQL da migration 18000:

- `catalogo_private.catalogo_asaas_ler_contexto_prechallenge_inerte(uuid)`:
  verifica reserva ja existente, validade, sessão AAL1 e elegibilidade
  independente e devolve apenas o snapshot imutavel com os nomes
  `id`, `userId`, `sessionId`, `factorId`, `separationId`,
  `evidenceHash` e `expiresAt` em milissegundos Unix.
- `catalogo_private.catalogo_asaas_ler_tentativa_prechallenge_inerte(uuid)`:
  relê exclusivamente o par `nonce`, `challengeId`, `tentativa`
  documentado nas tabelas persistentes e o snapshot respectivo; devolve
  NULL quando a tentativa ja tiver sido consumida, quando estiver
  expirada ou quando a sessao original deixar de estar elegivel.

AMBAS são SECURITY INVOKER em schema catalogo_private, EXECUTE
revogado para PUBLIC, anon, authenticated e service_role. Não contêm
OTP, bearer ou refresh_token e **não permitem acionamento pela Data API**.

Testes no arquivo `supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql`
checando snapshot original, nonce/challenge exatos, lookup inválido,
replay após consumo, sessao convertida a AAL2 e ausência de grants.
Testes estáticos correspondentes:
`tests/catalogo-asaas-mfa-leituras-privadas.test.cjs`.

**Ainda não há implementacao de canal owner-only para Edge, nem TOTP real
ou autenticação financeira aprovada.** Não conceder GRANT a service_role
para tentar conectar a Edge; projetar backend privado com credenciais,
métodos e auditoria independentes antes de habilitar MFA.


## Incremento 14 — migration 19000 aplicada no STAGING e adaptador SQL parametrizado

- Aplicada **somente no projeto de homologacao** `jbttwihctuibchhcyqtl`
  com nome `asaas_prechallenge_leituras_owner_only_inertes_hold_staging_20261010`.
- CI anterior ao deploy de homologacao: GitHub Actions run 38084774968
  concluida **12/12 SUCCESS**, inclusive migrations reais no banco descartavel e pgTAP.
- Auditoria posterior em PostgreSQL STAGING: duas funcoes SECURITY INVOKER,
  EXECUTE permitido somente ao owner; NEGADO para `anon`, `authenticated` e
  `service_role`. Confirmado tambem executando chamadas sob cada um desses
  3 papéis em transacoes revertidas: acesso negado.
- Leitura de contexto/tentativa inexistentes ou NULL retornou SQL NULL.
  0 reservas, 0 desafios, 0 consumos e 0 fatores TOTP verificados.
- O schema `catalogo_private` possui USAGE para `anon` e `authenticated`
  herdado da configuracao existente; as duas funcoes novas **NAO** podem
  ser executadas por esses papeis. Nao foram feitas revogacoes globais
  capazes de quebrar outros fluxos.
- Adicionado `supabase/functions/_shared/catalogo-asaas-livro-owner-sql-inerte.ts`.
  E apenas tradutor para cinco SELECT com placeholders `$1::uuid` etc.,
  e um executor injetado nos testes, que recusa databases fora dos clones
  `catalogo_asaas_guards_ci`/`catalogo_asaas_race_ci`. Sem driver real,
  rede, senha, token ou permissao para PostgREST/Edge.
- Testes Deno `catalogo-asaas-livro-owner-sql-inerte.test.ts` exercitam
  cinco operacoes bind-only, schema retornado, rejeicao de payload SQL
  perigoso, status HOLD e tentativa de usar entradas nao UUID.

Proximo bloqueio: criacao e revisao independentes de um processo
privilegiado de minimo acesso para ler o PostgreSQL sem usar role
administrativa no frontend/Edge e prova GoTrue TOTP REAL no STAGING.
Nao ativar esta classe de testes diretamente em producao.

**Sem mexer no Asaas, sem implantacao Edge, sem PROD, sem saque ou Pix real,
sem merge. PR #39 DRAFT e HOLD_OBRIGATORIO.**
