# Etapa #42 — pré-verificação de sessão AAL2, sem autoridade de pagamento

**Guia Andrelândia | 10/10/2026 | PR #39 Draft**  
Código e Supabase STAGING apenas. Nenhuma Edge Function financeira foi implantada.

## Objetivo e fronteira

Um parecer técnico experimental de dupla conferência não equivale a um
pagamento autorizado. Para desenhar o próximo passo, acrescentamos uma
autoconsulta independente que verifica se o **próprio usuário conectado**
apresenta indícios coerentes de autenticação forte no Supabase.

Migração:
`supabase/pending-migrations/20261010009000_preflight_sessao_mfa_revisor_inerte.sql`.

RPC de leitura:
`public.catalogo_asaas_preflight_sessao_revisor_inerte()`, **sem argumentos**.

A RPC só está disponível ao papel PostgreSQL `authenticated` e
não aceita `revisor_id`, `user_id`, UUID de sessão ou sinalizador AAL
via parâmetros. A identidade vem de `auth.uid()` e `auth.jwt()`,
que em requisições normais são derivados de token autenticado pelo
gateway Supabase/PostgREST; não dos campos editáveis do perfil.

Valida em tempo de consulta:

- `sub` do JWT corresponde a `auth.uid()`; papel é `authenticated`.
- `session_id` do JWT tem formato UUID e existe em `auth.sessions`
  para **aquele mesmo usuário**.
- JWT tem `aal='aal2'`, `iat` emitido há no máximo cinco minutos e
  `exp` ainda futuro; não aceita usuário marcado como anônimo.
- A linha `auth.sessions` declara `aal2`, segundo fator (`factor_id`),
  vigência (`not_after`) e conta não banida.
- Cadastro **de ensaio** do próprio usuário ainda está válido e não
  existe revogação permanente daquele revisor.

O retorno informa `sessao_aal2_confirmada`, `jwt_recente_confirmado`,
`indicacao_ensaio_vigente` e motivos técnicos, **sem dados de terceiros**.

## Alerta essencial: JWT recente não é desafio MFA recente

O `iat` atesta apenas quando o token foi **emitido**. Ele pode ter sido
renovado sem o usuário repetir o segundo fator. Uma sessão `aal2` pode
persistir mesmo quando a última verificação MFA aconteceu anteriormente.

Portanto, a RPC **sempre** retorna:

`mfa_com_desafio_recente_comprovado=false`,
`revisor_real_credenciado=false`,
`apto_a_registrar_parecer=false`,
`dupla_aprovacao_financeira=false`,
`pagamento_autorizado=false`,
`liberacao_autorizada=false`,
`baixa_realizada=false`,
`movimenta_dinheiro=false`,
`status_operacional=HOLD_OBRIGATORIO`.

**Não alterar esses campos com base apenas em `aal2` ou `iat`.**

### Implicações do modelo de confiança

A assinatura do JWT é validada no caminho real Supabase Auth + PostgREST.
A função PostgreSQL não verifica assinatura criptográfica por conta própria.
Clientes não devem poder definir GUCs `request.jwt.*` diretamente.

O PostgreSQL CI **não possui Auth real**. Seu mock de `auth.sessions` e
`auth.jwt()` em
`supabase/tests/baseline/catalogo-asaas-auth-mfa-ephemeral.sql`
é guardado pelo nome da base `catalogo_asaas_guards_ci` e opt-in;
**não é migration nem deve ser implantado no Supabase real.**

O teste
`supabase/tests/isolated/catalogo-asaas-preflight-mfa-inerte-postgres.sql`
exercita a função real com contexto JWT **sintético** via `SET LOCAL ROLE
authenticated`. Simula AAL1, AAL2, token velho, sessão ausente, usuário
diferente, usuário anônimo, indicação ausente, indicação sintética válida e
revogação. Todo ensaio executa `BEGIN/ROLLBACK`; não autentica pessoas reais
nem se comunica com bancos/pagamentos.

## Alerta do Security Advisor Supabase

O Security Advisor do STAGING sinalizou
`authenticated_security_definer_function_executable` para esta RPC:
`SECURITY DEFINER` é invocável pelo papel `authenticated` via Data API.

Esse sinal é **real e intencional apenas neste protótipo**: a função
precisa ler `auth.sessions`, tabela privada, sem conceder leitura direta
aos usuários. O código não aceita identificador-alvo em parâmetro,
consulta somente o `auth.uid()` derivado do token autenticado e não
possui DML financeira. `SET search_path=''` reduz shadowing de objetos.

**O alerta não está “resolvido”**: ele exige revisão independente de
`SECURITY DEFINER`, validação com tokens reais de teste controlado,
teste de vazamento entre contas e eventual migração de acesso por um
backend com autenticação própria antes de habilitar qualquer operação
sensível. Não reclassificar este diagnóstico como autorização MFA.

## Requisitos antes da habilitação real (#42 e #43)

1. Definir responsáveis autorizados, governança de duas pessoas, conflito
   de interesses, suspensão, segredos, alçadas e regras de troca de função.
2. Implementar inscrição MFA e challenge/verify usando Supabase Auth; criar
   atestado **servidor-side, vinculado à sessão e ao desafio**, de segundo
   fator recente, com proteção contra replay e janela curta. **Não confiar
   em um campo arbitrário no JWT ou na data de emissão do token**.
3. Validar a sessão autenticada de cada revisor novamente no momento de
   registrar o parecer, sob transação de banco, com escopo mínimo. Esse
   registro ainda não é aprovação financeira.
4. Separar o ato de autorizar do ato de executar pagamento, exigindo
   verificações independentes dos créditos, do beneficiário original,
   da inexistência de duplicidade e da liquidação bancária (#41).
5. Obter testes de simultaneidade, revogação, expiração e revisão externa
   antes de pensar em desbloquear dinheiro.

Docs Supabase: [MFA e níveis AAL](https://supabase.com/docs/guides/auth/auth-mfa);
[segurança de API e RLS](https://supabase.com/docs/guides/api/securing-your-api);
[sessões Auth](https://supabase.com/docs/guides/auth/sessions).

**Ambiente STAGING:** migration
`asaas_preflight_aal2_somente_autoconsulta_inerte_staging_20261010`.
Verificados: `anon` sem `EXECUTE`, `authenticated` com autoconsulta,
`service_role` sem `EXECUTE`; consulta sem JWT mantém todas as flags
financeiras falsas. 0 revisores, 0 revogações, 0 pareceres de teste na
homologação. Nenhum Pix e nenhuma alteração em produção.
