# Guia Andrelândia — conferir titularidade do fator TOTP antes do desafio AAL1

**Etapa #42 · 10/10/2026 · PR #39 DRAFT · somente STAGING/CI**

## Qual lacuna esta etapa corrige

O contrato AAL1 → challenge → verify → AAL2 já distinguia a sessão inicial
sem fator associado do token final com AAL2. Mas, entre o JWT AAL1 e
a emissão de challenge, **não havia comprovação independente de que
o fator selecionado pertencia ao mesmo revisor**. O factorId
vindo da intenção documental poderia apontar para outro usuário ou
um fator revogado. Isso não libera Pix no protótipo, mas é uma
pré-condição importante para um serviço MFA bem desenhado.

## Mudança de banco

`supabase/pending-migrations/20261010016000_fator_totp_aal1_owner_guard_inerte.sql`

Função
`catalogo_private.catalogo_asaas_checar_fator_totp_aal1_inerte(uuid,uuid)`
aceita apenas `session_id` e `factor_id`; encontra a identidade
**no banco** (`auth.sessions.user_id`, não uma afirmação do navegador).
Retorna elegibilidade somente se:
- a sessão existe, é `aal1`, não expirou e não tem `factor_id`
  associado ainda;
- o fator é `totp`, está `verified` e pertence ao
  **mesmo `user_id` que abriu a sessão**;
- o usuário não está banido.

Resultados incluem `elegivel`, `userId`, `sessionId`, `factorId`
apenas na hipótese positiva; respostas negativas **não devolvem
identificadores**, evitando enumeração por essa interface.
Ambos retornam
`mfa_ja_verificado=false`,
`desafio_ja_emitido=false`,
`pagamento_autorizado=false`,
`status_operacional=HOLD_OBRIGATORIO`.

O código é `STABLE SECURITY INVOKER SET search_path=''`
em schema privado, **sem GRANT ou EXECUTE** a
`PUBLIC/anon/authenticated/service_role`, sem mutação das
tabelas Auth ou envio de OTP. Só o PostgreSQL owner controlado
pode executar a função.

## Mudança dos contratos TypeScript de laboratório

- `PortaDeAutenticacaoFalsa.verificarFatorTotpAal1` agora é
  **obrigatória**, chamada durante `SimuladorStepUpDocumental.iniciar`
  depois da validação de identidade/sessão AAL1 e **antes de criar
  o desafio**. Se o fator não pertence ao usuário, o backend cai,
  ou a consulta falha, nenhum desafio é emitido.
- `GoTrueMfaTransporteInerte` exige uma porta injetada
  `verificarFatorTotpAal1NoServidor`. Ela é um contrato de
  consulta privilegiada, ainda **sem implementação de conexão real**
  entre Edge/Auth/PostgreSQL. Não é suficiente confiar no
  `GET /user` nem no `factorId` que o cliente enviou.
- Ao voltar do `verify`, o verificador segue exigindo JWT
  **assinado, AAL2, mesma sessão/usuário e mesmo factorId**
  antes de aceitar a observação documental fictícia.

## Testes

- PostgreSQL descartável, com `ROLLBACK`:
  `supabase/tests/isolated/catalogo-asaas-fator-totp-aal1-owner-inerte-postgres.sql`.
  Com Auth sintético e roles reais de Postgres, exercita
  TOTP próprio positivo; fatores de terceiros, `unverified`,
  tipo `phone`, AAL2 indevido, sessão AAL1 com factor_id já
  preenchido, vencida/revogada, usuário banido e
  função inacessível para `authenticated`.
- Deno sem rede: `catalogo-asaas-stepup-documental-ensaio.test.ts`,
  `catalogo-asaas-gotrue-mfa-transporte-inerte.test.ts` e
  `catalogo-asaas-gotrue-jwt-assinado-integracao-inerte.test.ts`.
  Falha da consulta privada ou falso retorno impede emitir
  challenge. Todos os testes continuam com MFA fictício e
  flags financeiras bloqueadas.
- Node:
  `tests/catalogo-asaas-fator-totp-prechallenge-owner-inerte.test.cjs`
  impede retirar esses gates de segurança.

## Resultado verificado nesta rodada

- Migration `asaas_fator_totp_prechallenge_owner_hold_staging_20261010`
  **aplicada somente em STAGING** `jbttwihctuibchhcyqtl`.
- Função `catalogo_private.catalogo_asaas_checar_fator_totp_aal1_inerte(uuid,uuid)`
  confirmada `SECURITY INVOKER`; `anon`, `authenticated` e
  `service_role` **sem EXECUTE**.
- STAGING: **3 sessões AAL1**, todas reconhecidas pelo leitor prévio,
  **0 fatores MFA**, **0 revisores, 0 desafios, 0 tentativas**.
  UUIDs inválidos e `NULL` retornam `elegivel=false`,
  `pagamento_autorizado=false`, `HOLD_OBRIGATORIO`.
- O job financeiro Deno da [CI 38074842866](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/38074842866)
  passou **67 testes, 0 falhas**. CI financeira PostgreSQL
  descartável também passou; inclui consultas negativas, histórico
  e locks das migrações. Restava somente pgTAP nativo na última consulta.
- A primeira tentativa da CI falhou exclusivamente porque a migração
  usou `pg_catalog.coalesce`, quando `COALESCE` é construção
  especial SQL. Foi corrigida para `coalesce` antes da implantação
  de homologação. A execução posterior passou no job financeiro.

## Limites de segurança e decisão de implantação

No Supabase STAGING `jbttwihctuibchhcyqtl` havia três
sessões AAL1 mas **zero fatores TOTP**. Consequentemente,
mesmo após aplicar esta migração, não é possível obter
`elegivel=true` para usuários atuais. Não cadastrar fatores
falsos em homologação para simular sucesso de MFA.

**Isto não é uma prova de MFA recente.** Estar inscrito com
TOTP verificado significa que o fator pertence ao revisor,
mas ainda não que este revisor digitou um código válido para
**aquele challenge / aquela operação**. O fluxo real exige:
1. um backend revisado com assinatura JWT verificada e
   leitura segura das funções privadas;
2. chamada real GoTrue `/challenge` e `/verify`,
   sem registrar código nem refresh token, respeitando rotação,
   bloqueios e rate limits;
3. registro transacional durável do challenge, resultado de
   sessão AAL2 e nonce financeiro da mesma operação,
   com locks/replay, sem confiar em claims arbitrárias de GUC;
4. pelo menos dois revisores humanos independentes autorizados,
   prova bancária original (#41), autorização de baixa (#43)
   e revisão jurídica/contratual antes de liberar fundos.

Ainda não há Edge ativada, nenhuma requisição MFA externa,
Pix/saque/baixa/comissão, merge ou alterações de produção.

**HOLD_OBRIGATORIO até atendimento de todos os bloqueadores.**
