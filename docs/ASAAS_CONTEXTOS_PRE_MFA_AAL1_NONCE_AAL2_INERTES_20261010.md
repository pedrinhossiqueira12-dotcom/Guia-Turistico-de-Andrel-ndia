# Etapa #42 — contexto preparatório AAL1 e nonce documental AAL2, sempre HOLD

**Guia Andrelândia · 10/10/2026 · PR #39 DRAFT · sem acesso a produção**

## Problema real identificado na revisão

O simulador `SimuladorStepUpDocumental.iniciar` executava
`await autenticarToken` e `await verificarFatorTotpAal1` **antes de
reservar o nonce**. Se duas chamadas concorrentes aguardassem
o Auth ou o PostgreSQL, ambas poderiam verificar que o nonce ainda
não tinha desafio e emitir dois challenges externos.

**Correção:** a reserva `Set<nonce>` e o teste de duplicidade são
síncronos, realizados **antes do primeiro `await`** em `iniciar`.
Se Auth ou consulta TOTP falhar, o nonce é consumido de maneira
conservadora e não pode ser reutilizado silenciosamente. A expiração
é revalidada **após** o preflight assíncrono e antes da chamada de
challenge. Essa proteção vale somente dentro de um processo isolado
de laboratório. **Servidores/Edge Functions multi-instância não podem
usar o Set: exigem banco transacional, UNIQUE, locks e idempotência.**

Testes Deno adicionados em
`supabase/functions/tests/catalogo-asaas-stepup-documental-ensaio.test.ts`:
concorrência durante autenticação inicial, concorrência durante
consulta de titularidade TOTP, nonce sem segundo uso após token
recusado e expiração enquanto o preflight estava suspenso.

Teste Node `tests/catalogo-asaas-stepup-nonce-race-preauth.test.cjs`
exige que a reserva anteceda o **primeiro `await`** e que haja
somente uma chamada de challenge.

## Elo documental persistente de duas fases

Migração **inativa**, sem permissões de Data API:
`supabase/pending-migrations/20261010017000_contexto_aal1_nonce_aal2_persistente_inerte.sql`.

Ela cria **duas tabelas RLS** com SELECT/INSERT/UPDATE/DELETE
revogados para `PUBLIC`, `anon`, `authenticated` e
`service_role`.

### 1. Contexto pré-MFA, enquanto a sessão ainda é AAL1

Tabela `public.catalogo_asaas_contextos_pre_mfa_inertes`:
cada linha é única por separação/revisor/sessão e registra
fator TOTP, fingerprint dos créditos, versão e SHA-256 do dossiê,
hash da matriz de conciliação e expiração em 2 minutos.

O trigger PostgreSQL `catalogo_asaas_fixar_contexto_pre_mfa_inerte`
**não confia em identidades ou valores carimbados pelo cliente**:
valida sessão AAL1, TOTP `verified` pertencente ao titular, revisor
designado e não revogado, separação de créditos congelada,
sem conflito de interesses e documentação/matriz/financiamento
íntegros. Ele substitui `id`, `revisor_id`, os hashes,
o horário e o estado pelos valores calculados no banco.

**Estado único:** `preparado_sem_challenge`. Nenhuma linha declara
desafio GoTrue criado, OTP verificado ou usuário MFA autorizado.

### 2. Associação posterior, quando existe um nonce AAL2

A função privada
`catalogo_private.catalogo_asaas_diagnosticar_vinculo_pre_mfa_nonce_inerte(uuid,uuid)`
compara uma linha do contexto AAL1 com
`catalogo_asaas_intencoes_mfa_documentais_ensaio` criada depois do
nível AAL2, mas **não valida o token assinado, nem o challenge ou OTP**.

Os predicados incluem:
- A mesma sessão, revisor, separação e fator TOTP corrente em AAL2.
- Nonce criado depois do preparo, dentro da janela de 2 minutos,
  e ambos ainda vigentes.
- Os mesmos hashes de créditos, versão de dossiê e matriz.
- Dossiê e financiamento conferidos novamente, separação ainda
  congelada, revisor ainda vigente e sem revogação.

O resultado `vinculo_documental_compativel=true` significa somente
que os dados **são compatíveis**. Ele sempre mantém
`challenge_go_true_verificado=false`,
`desafio_mfa_da_sessao_comprovado=false`,
`dupla_aprovacao_financeira=false`,
`pode_registrar_parecer=false`,
`pagamento_autorizado=false`,
`liberacao_autorizada=false`,
`baixa_realizada=false`,
`movimenta_dinheiro=false` e `HOLD_OBRIGATORIO`.

### 3. Registro auditável de vínculo, uma vez

Tabela `public.catalogo_asaas_vinculos_pre_mfa_nonce_inertes`
impõe `PRIMARY KEY(contexto_id)` e `UNIQUE(nonce)`.
O gatilho de inserção recusa contexto/nonce incompatíveis e
sobrescreve o timestamp/status externo. Os dois históricos
são append-only: UPDATE/DELETE são recusados.

**Importante:** uma linha no histórico não é prova de que `mfa.verify`
ocorreu, não é autorização de saque, não participa de nenhum
fluxo de pagamento e não concede EXECUTE a qualquer Edge publicada.

## Cobertura real dos testes offline

- Banco PostgreSQL descartável, dentro de transação `ROLLBACK`:
  a fixture `supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql`
  abre sessão AAL1 com fator fictício válido, registra snapshot,
  compara seu carimbo contra dados falsos, recusa repetição,
  converte sessão **somente na fixture** a AAL2, emite nonce
  fictício com GUC JWT mock e registra o par 1:1.
  Faz downgrade AAL2→AAL1 e troca o fator para provar que a
  comparação deixa de ser compatível; depois reverte.
  Testa reuso do vínculo, UPDATE/DELETE e flags financeiras.
- Node `tests/catalogo-asaas-contexto-aal1-nonce-aal2-inerte.test.cjs`:
  garante contratos de RLS, revogação, unicidade e flags HOLD.
- A execução CI usa Auth falso e isolamento sem rede externa.
  Não modifica dados de usuários STAGING ou produção.

## Dependências ainda não implementadas

1. A autenticação MFA real com um revisor TOTP cadastrado no
   STAGING e uma assinatura JWT assimétrica real do projeto.
   Atualmente o projeto de homologação possui **zero fatores MFA**.
2. A captura **autenticada e auditada** do `challenge_id`
   retornado pelo GoTrue, confirmação `mfa.verify` e
   prova de vínculo do evento real com o nonce específico,
   através de uma transação multi-instância e uma política
   de idempotência. Isso **não** é suprido pelo AAL2 nem pela
   comparação de dados; token AAL2 pode ter sido emitido em
   outra autenticação anterior.
3. Verificador JWT e leitores Auth conectados em backend
   seguro, com autorização de operadores e dois revisores
   independentes, após auditoria externa.
4. Evidência original e independente do beneficiário bancário
   (#41), liberação/baixa segregada (#43), revisão final e
   registro empresarial/autorização do provedor.

O PR #39 deve permanecer DRAFT. Não enviar Pix/transferência,
não ativar Money Out, não marcar saques pagos, não publicar Edge
financeira, não alterar Supabase de produção.

**HOLD_OBRIGATORIO sempre.**
