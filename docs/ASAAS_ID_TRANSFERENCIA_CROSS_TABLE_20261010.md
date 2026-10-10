# Etapa #41 — colisão de identificadores bancários sem descarte de provas

**Data:** 10/10/2026. **Ambiente:** PR #39 Draft, somente branch/STAGING.
**Sem Pix, baixa, liberação de créditos ou autorização de produção.**

## Motivo

O banco grava IDs Asaas em **duas fontes independentes**:

1. `catalogo_asaas_saques.transferencia_id`: transferências regulares do motoboy, com uma UNIQUE local.
2. `catalogo_asaas_transferencias_excepcionais_auditoria.transferencia_id`:
   vínculo de evidências de saídas/residuais excepcionais, também UNIQUE local.

Uma UNIQUE em cada tabela **não impede** que o mesmo ID seja utilizado nas duas.
Isso deve ser um bloqueio na tentativa de **novo vínculo regular**, antes que o
backend atribua pagamento a outro saque. Entretanto, evidências de uma
transferência excepcional podem ser descobertas **depois** de um pagamento
regular. Proibir sua inserção apagaria um conflito importante da auditoria.

## Regra assimétrica implementada

Migração pendente:
`supabase/pending-migrations/20261010006000_reserva_regular_nao_reutiliza_id_excepcional.sql`

- `saque regular → ID já observado na tabela excepcional`: **REJEITAR** com erro PostgreSQL `23514`, mantendo o saque sem associação e sob revisão. Também impedir trocar ou limpar um ID bancário regular uma vez gravado.
- `evidência excepcional → ID já existente em saque regular`: **PRESERVAR a evidência**; ela é fato forense, não pedido de pagamento. A matriz `catalogo_asaas_matriz_conciliacao_escrow` já detecta cruzamentos com saque comum e mantém HOLD.
- `evidência excepcional → UPDATE/DELETE`: **PROIBIR**: registros persistidos são append-only.
- Controles de concorrência: locks transacionais por motoboy e por ID bancário, sempre na ordem *motoboy → ID* nos dois caminhos. Eles serializam tentativas concorrentes que dependem dos mesmos identificadores. A ordem funciona com o lock de reserva existente; não implica que o Asaas garanta unicidade de `externalReference`.
- Apenas o vínculo novo é vetado. Se o conflito histórico já existia antes da migração ou foi descoberto tardiamente, **nunca** inventar ausência de Pix, efetuar nova transferência ou apagar a linha antiga.
- Nenhum endpoint extra de pagamento ou consulta pública é adicionado.

## Cenários de teste

`tests/catalogo-asaas-id-bancario-assimetrico.test.cjs` e
`supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql`:

1. Saque regular com HMAC previamente registrado não consegue anexar ID já
   observado na evidência excepcional.
2. Um ID novo e diferente continua passível de vinculação; depois de associado,
   não pode ser trocado ou apagado.
3. Evidência excepcional pode ser descoberta **após** o ID já estar em um saque
   regular, para o mesmo motoboy, mesmo com valor divergente; o conflito
   permanece registrado e a baixa continua bloqueada.
4. UPDATE/DELETE da evidência excepcional são recusados.
5. Fixture usa transação `BEGIN/ROLLBACK`, usuários e IDs sintéticos.
   Nenhuma chamada de pagamento é realizada.

## O que ainda falta para #41

- Prova bancária independente de que a transferência efetivamente liquidou e
  de **qual foi o destinatário Pix original**, antes da conclusão financeira.
- Evidência e revisão humana de operações anteriores à trilha local.
- Homologação integrada com API/conta Asaas autorizada, limites e possível
  instabilidade de resultados de paginação.
- Verificação de concorrência em sessões de banco distintas e inspeção dos
  bloqueios/deadlocks; os fixtures transacionais sequenciais não são prova
  de concorrência real.
- Aprovação contratual/comercial e autorização expressa antes de alterar
  qualquer fluxo bancário em produção.

Referências:
- [PostgreSQL — advisory locks transacionais](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS).
- [Asaas — transferências e idempotência por eventos](https://docs.asaas.com/docs/transfers-faq).

**Status:** nunca inferir `pago` de um registro local de observação. Escrow
excepcional permanece congelado mesmo quando um GET retorna `DONE`.
