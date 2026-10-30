# #42 — Corrigir entrada AAL1 e saída AAL2 no desafio MFA

**Guia Andrelândia · 10/10/2026 · PR #39 Draft · sem Pix**

## Problema que a revisão encontrou

O fluxo anterior permitia uma simulação de challenge com token
`aal1` contendo `factorId` como se ele já estivesse associado
à sessão. O validador criptográfico posterior, por sua vez, exigia
`aal2` desde a primeira chamada. Em uma sessão real, esse contrato
era inconsistente: o Auth só deve declarar MFA concluído **depois**
de verificar um segundo fator.

No STAGING `jbttwihctuibchhcyqtl` foram observadas, apenas por
queries agregadas, **3 sessões AAL1, todas sem `factor_id` e nenhum
fator MFA cadastrado**. Assim, ainda não é possível provar a etapa
final AAL2 com um usuário real em homologação. Não se inventaram
fatores nem tokens de usuário para simular isso.

## Alterações de código (isoladas, sem Edge publicada)

- O módulo `catalogo-asaas-jwt-sessao-assinada-ensaio.ts` agora
  tem **dois modos explícitos**:
  `verificarInicio(jwt)`: aceita AAL1 com assinatura digital
  ES256/RS256 válida e **sessão AAL1 ativa obtida por consulta
  independente de Auth**; retorna `factorId:null`, nunca
  comprova segundo fator. Também pode aceitar AAL2 já validado.
  `verificar(jwt)`: modo final **estritamente AAL2**;
  exige fator TOTP `verified` associado à sessão.
- O transporte `catalogo-asaas-gotrue-mfa-transporte-inerte.ts`
  repassa a fase `inicio` ou `apos_verificacao` ao validador
  confiável fornecido pelo backend. Mesmo no início compara o
  usuário de `GET /auth/v1/user` ao principal já assinado.
- O `SimuladorStepUpDocumental` aceita `aal1/factorId:null`
  para iniciar, mantendo fixos no servidor
  `userId`, `sessionId`, fator **solicitado** no nonce e
  `challenge_id`; antes do verify confirma que a mesma sessão
  AAL1 ainda existe. Após `verify`, exige JWT novo AAL2,
  o **factorId exatamente igual ao declarado na intenção**, a
  mesma sessão e usuário, antes de concluir a **simulação**.
  Não reutiliza challenge concluído.

## Novo leitor SQL privado (não público)

Migração:
`supabase/pending-migrations/20261010015000_sessao_aal1_desafio_pre_mfa_inerte.sql`.

Função `catalogo_private.catalogo_asaas_ler_sessao_aal1_inerte(uuid)`:
- `SECURITY INVOKER SET search_path=''`, com EXECUTE revogado
  de `PUBLIC`, `anon`, `authenticated` e `service_role`.
- Retorna apenas `id`, `userId`, `aal`, `notAfterMs` e
  `usuarioBloqueado:false` quando a sessão real continua AAL1,
  sem fator associado, não venceu e o usuário não foi banido.
- Retorna `NULL` nos outros cenários; **não consulta nem
  envia OTP e não declara MFA, fator ou pagamento aprovado**.
- Um backend confiável precisará implementar a porta TypeScript
  e impedir que clientes controlem a resposta. A função
  **não é um RPC público e não deve ser exposta**.

## Testes de regressão

- Deno/WebCrypto: assina JWT AAL1 com chaves ES256 geradas em
  memória e demonstra que **não passa** no validador final;
  verifica que `verificarInicio` só aceita JWT assinado e
  sessão AAL1 existente, vigente, do mesmo usuário, não banido.
- O fluxo integrado `GoTrue` fake usa agora token **AAL1 antes
  do challenge** e token **AAL2 após verify**; confere o mesmo
  desafio/fator, revogação após verify, falhas de rede e
  resposta `HOLD_OBRIGATORIO`.
- SQL em banco descartável:
  `supabase/tests/isolated/catalogo-asaas-aal1-pre-desafio-inerte-postgres.sql`
  verifica recusa de acesso ao papel authenticated, AAL2 na porta
  AAL1, sessão expirada/revogada, banimento e `factor_id`
  presente de maneira inconsistente.
- Node:
  `tests/catalogo-asaas-aal1-aal2-transicao-inerte.test.cjs`
  impede regressão de privilégio SQL ou de separação das fases.

## Resultado verificado em homologação e CI

Migração
`asaas_sessao_aal1_private_prechallenge_sem_pix_staging_20261010`
aplicada **somente** no projeto Supabase STAGING
`jbttwihctuibchhcyqtl`.

Auditoria SQL posterior confirmou:
- Função `catalogo_private.catalogo_asaas_ler_sessao_aal1_inerte(uuid)`
  **SECURITY INVOKER**, sem permissão EXECUTE a
  `anon`, `authenticated` ou `service_role`.
- **3 sessões AAL1 existentes**, e o leitor identificou as **3**
  como sessões básicas elegíveis *para a etapa de desafio*.
  Nenhuma é AAL2 por esse fato.
- **0 fatores MFA, 0 revisores, 0 desafios e 0 tentativas**.
- UUID de sessão inexistente retorna `NULL`.
- Security Advisor não criou novos alertas: permanecem os
  alertas gerais conhecidos da RPC `catalogo_status_publicacao`
  e da proteção de senha vazada, não relacionados à nova função.

CI funcional do commit `27467bd2d298375e30db95ddb900790eb181a770`:
[workflow 38073827909](https://github.com/pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia/actions/runs/38073827909)
**12/12 jobs aprovados**, incluindo **65/65 testes Deno**
e os SQL de privacidade AAL1.

## Limites / bloqueadores

**Continua um laboratório sem autorização financeira**, não uma
implantação de MFA real. Os testes usam HTTP, provedor Auth e JWKS
falsos, com apenas a criptografia JWT local verdadeira.

O atual esquema de **nonce documental** e a função SQL de emissão
ainda exigem revisor AAL2. Portanto, mesmo após esta correção, o
caminho **iniciar AAL1 e usar o mesmo nonce bancário ainda não pode
ser ligado a operações reais**: será preciso projetar um protocolo
separado para obter o challenge AAL1, migrar a sessão a AAL2 e
então produzir o nonce documental autenticado, com prova recente
vinculada à ação, e não apenas ao fator.

Antes de liberar qualquer pagamento: MFA GoTrue real e token
validado em STAGING, reader com privilégios isolados, prova
de uso do challenge específico no banco multi-instância,
políticas de tentativas/revogação, dois revisores credenciados
e evidência bancária independente do Pix original (#41).
O provedor também precisará aprovar operações e
a titularidade/cadastro (PR #39 não foi mesclado).

**Nenhuma migração foi aplicada em produção. Nenhum Pix, baixa,
parecer financeiro ou saque real é permitido.**
