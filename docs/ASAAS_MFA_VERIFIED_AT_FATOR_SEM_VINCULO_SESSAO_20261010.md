# Etapa #42 — evidência Auth de desafio TOTP por fator, sem vínculo de sessão

Guia Andrelândia | 10/10/2026 | PR #39 Draft | **HOLD obrigatório**.

## Qual fato novo é comprovável

A inspeção apenas de schema do **STAGING** confirmou:

- `auth.mfa_challenges` possui `id`, `factor_id`, `created_at`
  e `verified_at`. O registro permite identificar a hora em que um
  desafio daquele fator foi verificado.
- `auth.mfa_factors` possui `id`, `user_id`, `status` e
  `factor_type`; restringir a TOTP verificado.
- `auth.sessions` contém `id`, `user_id`, `factor_id`, `aal`
  e `not_after`.
- **`auth.mfa_challenges` não contém `session_id`**. Duas sessões
  distintas do mesmo usuário podem usar o mesmo `factor_id`. Uma
  verificação do fator em outro dispositivo/sessão **não comprova
  step-up MFA da sessão que está solicitando a decisão**.

## Implementação

A migration
`supabase/pending-migrations/20261010010000_preflight_mfa_desafio_fator_sem_prova_sessao.sql`
atualiza SOMENTE a função de autoconsulta já protegida
`public.catalogo_asaas_preflight_sessao_revisor_inerte()`.

Somente após validação básica JWT `aal2`, token fresco e sessão
`auth.sessions` atual, consulta uma verificação TOTP para o fator
associado à sessão e ao mesmo titular:

- `ch.factor_id=f.id=s.factor_id`;
- `s.id` e `s.user_id` equivalentes ao token autenticado;
- `f.user_id` igual ao usuário, `factor_type=totp`,
  `status=verified`;
- `ch.verified_at` não nulo, entre **2 minutos atrás** e **30
  segundos à frente** (tolerância de relógio);
- `ch.verified_at` entre `ch.created_at` e no máximo 10 minutos
  após a criação, rejeitando cronologia impossível.

O resultado possui um **sinal estritamente forense**:

- `desafio_recente_observado_no_fator_sem_vinculo_sessao`: verdadeiro
  somente se algum desafio TOTP do fator satisfizer os filtros.
- `desafio_recente_comprovado_na_sessao_atual=false` e
  `mfa_com_desafio_recente_comprovado=false` **sempre**.
- `apto_a_registrar_parecer=false`,
  `dupla_aprovacao_financeira=false`,
  `pagamento_autorizado=false`, `liberacao_autorizada=false`,
  `baixa_realizada=false`, `movimenta_dinheiro=false`,
  `status_operacional=HOLD_OBRIGATORIO` **sempre**.

Nenhum ID de desafio ou fator, segredo MFA, telefone, token ou documento
é retornado. O tratamento de tokens externos continua sob
Supabase Auth/PostgREST; funções do banco **não assinam nem validam JWT
criptograficamente**.

## Testes CI

- Mock Auth efêmero guardado pelo nome e opt-in de
  `catalogo_asaas_guards_ci`:
  `supabase/tests/baseline/catalogo-asaas-auth-mfa-ephemeral.sql`.
- Teste transacional SQL
  `supabase/tests/isolated/catalogo-asaas-preflight-mfa-inerte-postgres.sql`
  inclui challenge recente do **outro titular** (recusado), challenge
  recente do fator correto (**observado**, mas sem autorização), e
  challenge antigo (**não observado** apesar de JWT recém-renovado).
- Contrato Node
  `tests/catalogo-asaas-mfa-challenge-fator-inerte.test.cjs`
  garante predicados do diagnóstico, ausência de DML e flags fail-closed.
- CI executa bancos descartáveis `catalogo_asaas_guards_ci` e
  `catalogo_asaas_race_ci` sem rede e sem credenciais de pagamento.
  O mock é **proibido** em qualquer Supabase real.

## Próximas exigências para autorização futura

1. Comprovar **no próprio fluxo backend** que a sessão autenticada
   completou um desafio MFA recente, associado a ação e nonce de
   autorização de uso único, com registro de confirmação derivado
   do **provedor**, não alegado pelo cliente.
2. Avaliar se Auth oferece associação de `session_id` no evento
   verificado ou implementar fluxo controlado de MFA step-up cujo
   resultado servidor-side seja vinculado à sessão e à operação.
3. Fazer threat modeling de challenge em **outra sessão com mesmo
   fator**, refresh de token após MFA antigo, replay de nonce,
   revogação do fator e troca de dispositivo.
4. Ter revisores humanos independentes nomeados, com MFA real, papéis,
   alçadas, suspensão e anti-colusão — inexistentes no protótipo.
5. Ainda é obrigatória a conciliação bancária independente do
   beneficiário Pix original (#41). Nenhuma mudança no #42 deve
   autorizar sair do HOLD sem esse requisito e #43.

**Alertas remanescentes:** Supabase Security Advisor já aponta
`authenticated_security_definer_function_executable` para a função
anterior. A alteração conserva `SECURITY DEFINER SET search_path=''`,
escopo somente do próprio usuário e saída sem autoridade; o alerta
precisa revisão independente antes de produção financeira.

**Não implantar Edge financeira, não habilitar pagamentos, não
mesclar PR #39, não modificar Supabase de produção.**
