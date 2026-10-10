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

## Resultado de homologação e validação observados

Após os testes Deno, Node e PostgreSQL financeiro passarem no banco
descartável, a migration
`asaas_contexto_aal1_nonce_aal2_persistente_inerte_staging_20261010`
foi aplicada **exclusivamente** ao projeto de homologação Supabase
`jbttwihctuibchhcyqtl`.

Consultas SQL independentes posteriores confirmaram:

- `catalogo_asaas_contextos_pre_mfa_inertes` e
  `catalogo_asaas_vinculos_pre_mfa_nonce_inertes`:
  ambas com RLS ativo e sem SELECT para `anon`, sem INSERT
  para `authenticated` ou `service_role`.
- Nenhuma das 3 novas funções privadas pode ser chamada
  por `anon`, `authenticated` ou `service_role`.
  A função de diagnóstico é `SECURITY INVOKER`.
- **Zero** contextos preparatórios, vínculos, fatores MFA,
  revisores e intenções documentais em homologação.
- Diagnóstico com contexto/nonce inexistentes devolve
  `ok=false`, `vinculo_documental_compativel=false`,
  `challenge_go_true_verificado=false`,
  `pagamento_autorizado=false`, `movimenta_dinheiro=false`,
  `HOLD_OBRIGATORIO`.

O commit funcional `65784db56d26ea3462127f86461bb9466650f712`
passou nos jobs financeiros Deno/Node/PostgreSQL, e a última
execução documental verificada do commit
`c920a43322b651f609bbeabcd11e81855f3ed06c`
concluiu **12/12 jobs com sucesso**, incluindo
reset nativo Supabase e 23 pgTAP. O relatório está em
[CI 38076218294](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/38076218294).

**Nenhum challenge GoTrue real foi criado, nenhuma sessão
AAL2 real foi iniciada, nenhuma comissão ou saldo foi movimentado.**

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


## Ensaio de contrato de reserva compartilhada entre instancias (10/10/2026)

Foi adicionado um contrato opcional de laboratorio,
PortaReservaCompartilhadaMfaEmEnsaio, ao SimuladorStepUpDocumental.
A porta realiza duas decisoes independentes:
- reservarInicio: consumo do nonce antes do primeiro request ao Auth;
- reservarVerificacao: consumo do challenge_id + tentativa + identidade
  e versao da evidencia ANTES da verificacao do OTP.

O payload da porta contem somente identificadores e hash de evidencia;
NUNCA leva bearer, OTP, refresh_token ou chave de API. Qualquer negativa,
exception ou vencimento durante a reserva interrompe o passo em modo
HOLD_OBRIGATORIO. O nonce e queimado mesmo se a reserva falhar, evitando
retry acidental dentro da instancia de CI.

Novo ensaio Deno com DUAS instancias de SimuladorStepUpDocumental
e UMA porta compartilhada falsa confirma:
- mesmo nonce -> somente um desafio e enviado ao Auth simulado;
- mesmo challengeId com dois nonces -> apenas uma verificacao;
- erro/indisponibilidade da porta -> nenhuma chamada de challenge/verify;
- expirar durante reserva -> sem envio de OTP;
- nenhuma resposta autoriza parecer, Pix, baixa ou liberacao.

**NAO E PERSISTENCIA REAL.** A porta falsa usa Set em memoria e nao
protege multiplos processos/instancias de Edge em producao. Ela define
um contrato para futura transacao real PostgreSQL, com
UNIQUE/locks/idempotencia, estado compartilhado duravel, prova de
challenge/verify GoTrue real e revalidacao de sessao e operacao.
As tabelas SQL atuais protegem outros registros, mas NAO implementam
esse novo contrato pre-challenge. Nenhuma migration ou Edge foi
publicada nesta entrega.

Permanece inalterado: zero MFA real comprovado, sem usuarios revisores
nomeados, duas aprovacoes independentes ainda ausentes e toda execucao
financeira bloqueada. Nao mesclar PR #39 nem liberar Pix.


### Snapshot contra mutacao TOCTOU durante o preflight

Como o chamador do simulador consegue alterar um objeto JavaScript enquanto
a porta aguarda um resultado assincrono, a intencao e copiada e congelada
imediatamente apos as validacoes iniciais, ANTES do primeiro await.
Todos os usos posteriores na inicializacao — reserva local/global,
conferencia de usuario/sessao/fator, emissao do challenge e registro da
tentativa — utilizam apenas a copia da operacao original.

Teste Deno adversarial muda nonce, usuario, sessao, fator, separacao,
hash da evidencia, expiracao e campo consumed durante a espera da
reserva, e confirma que tanto o challenge quanto o consumo posterior
permanecem ligados ao mesmo snapshot. Nao passa TOTP ou JWT ao gate.
Commits: c0af97129d8e0659436f2fcd72ef761e5677152a e
c3c4bf43758865c7eeaa8ebbc73a2590029c221b.

Trata-se de defesa no LABORATORIO JS. Em integracao real, hashes e
identidades devem ser recalculados de fontes server-side dentro de
transacao PostgreSQL, e a etapa de verify deve ter prova do GoTrue
associada ao challenge correto. Nunca converter snapshot em
permissao de parecer, pagamento ou baixa.
