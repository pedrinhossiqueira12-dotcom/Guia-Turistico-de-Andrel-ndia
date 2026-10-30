# Guia Andrelândia — etapa #42: duas conferências documentais inertes

Data: 10/10/2026. Branch `feat/asaas-faturas-saques-seguros`, PR #39 **Draft**.
**NÃO é implementação de aprovação financeira. NÃO gera Pix, não quita crédito, não libera escrow.**

## Fronteiras e responsabilidades

O fluxo futuro deverá diferenciar obrigatoriamente:

1. **Evidência observada**: log GET, webhook, extrato/comprovante bancário e informação do beneficiário original; registrar evidência não altera saldo.
2. **Investigação**: detectar duplicidade, conflito de ID/referência, divergência de titular, valor e estado fora de ordem.
3. **Parecer técnico preliminar**: documento que registra entendimento sobre uma **versão exata** do dossiê e matriz de riscos. Pode concluir somente `manter_hold`, `solicitar_documentos` ou `apontar_divergencia`.
4. **Aprovação financeira**: **INEXISTENTE NESTA FASE**. Exigirá pessoas autorizadas e autenticadas, MFA recente, segurança contra falsificação de autor, separação das funções, revogação e prazo próprio.
5. **Execução bancária/baixa**: **INEXISTENTE**. Exigirá prova bancária independente do destinatário original, checagem transacional final, caixa e autorização da plataforma/provedor.

## Migration implementada apenas para testes

Arquivo `supabase/pending-migrations/20261010007000_pareceres_escrow_dupla_conferencia_inerte.sql`.

A tabela `catalogo_asaas_escrow_pareceres_preliminares` está protegida por RLS.
`anon`, `authenticated` **e `service_role` não podem inserir, editar ou apagar
pareceres**, e nenhum endpoint da Edge consegue registrar pareceres.
A inserção é restrita ao *proprietário PostgreSQL* em ensaios isolados. Isso
não constitui um mecanismo de autenticação do revisor na aplicação.

Gatilho de inserção executado no PostgreSQL:

- Confere que a separação permanece `congelada`; trava o motoboy e a linha
  do escrow com a mesma ordem de locks das demais operações financeiras.
- Bloqueia revisor com mesmo ID que o beneficiário ou que já aparece como
  autor de uma evidência do dossiê, reduzindo conflitos diretos de interesse.
  **Não comprova identidade real nem a habilitação do revisor**.
- Exige dossiê local íntegro com pelo menos um evento e matriz de conciliação.
- Sobrescreve qualquer hash, sequência ou data fornecidos pelo chamador:
  guarda automaticamente a sequência do dossiê, o último hash do dossiê,
  o hash da matriz de conflitos e o fingerprint dos créditos congelados.
- Usa `clock_timestamp()` do servidor; validade de **24 horas**.
- `UNIQUE(separacao_id,revisor_id,dossie_hash_sha256,matriz_hash_sha256)`:
  o mesmo revisor não pode enviar dois pareceres para a mesma versão.
- UPDATE e DELETE dos pareceres são recusados (append-only).
- A versão do parecer fica obsoleta quando a matriz bancária ou o dossiê
  mudam. Os pareceres antigos continuam no histórico.

A RPC de **somente leitura** `catalogo_asaas_diagnosticar_dupla_conferencia_inerte(uuid)`
é executável exclusivamente por `service_role`. Exibe quantos registros da
versão corrente ainda estão válidos, o número de revisores distintos e
eventuais divergências. Mesmo com **dois pareceres**, retorna invariavelmente
`revisores_credenciados_e_autenticados=false`,
`dupla_aprovacao_financeira=false`,
`pagamento_autorizado=false`, `liberacao_autorizada=false`,
`baixa_realizada=false`, `movimenta_dinheiro=false` e
`status_operacional=HOLD_OBRIGATORIO`.

## Testes e limites

Teste de contrato:
`tests/catalogo-asaas-pareceres-dupla-conferencia-inerte.test.cjs`.

Fixture SQL transacional:
`supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql`.

Usa um escrow de dois créditos sintéticos. Verifica: autoconferência proibida,
dois revisores distintos, timestamps e hashes falsificados corrigidos pelo
banco, replay do mesmo revisor bloqueado, histórico append-only, expiração
definida pelo servidor e invalidação dos pareceres anteriores diante de novo
evento do dossiê. **Nenhuma evidência da fixture pertence ao banco Asaas real.**

## Critérios futuros que permanecem abertos na #42

- Escolher ao menos dois responsáveis habilitados e documentar impedimentos de
  parentesco, benefício próprio, operações feitas e relação com o comércio.
- Autenticar cada revisor independentemente com **MFA forte e sessão recente**;
  vincular o autor à sessão autenticada, nunca aceitar ID escolhido no payload.
- Definir alçada, valor-limite, possibilidade de revogação, expiração,
  necessidade de nova conferência ao mudar o conjunto de evidências.
- Exigir cadeia externa independente do banco, com recuperação verificável.
- Não tratar duas observações do mesmo provedor/conta como prova independente.
- **Antes de qualquer baixa futura**, revalidar no banco e com o provedor os
  créditos individualizados, autorização, destinatário original, valor,
  status bancário e inexistência de duplicidade; implementar em outra migração
  sujeita à revisão de segurança, com autorização expressa para produção.

A conclusão das duas conferências documentais **não fecha a etapa #42**,
que continua dependendo de comprovação de destino e responsáveis habilitados.
