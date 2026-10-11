# Etapa #43 — journal de intenção anterior a Pix (ensaio inerte)

**Data:** 11/10/2026. **Estado:** PR #39 Draft; `HOLD_OBRIGATORIO`. Código de **laboratório exclusivo do banco de CI** `catalogo_asaas_race_ci`, nunca de STAGING, produção ou Edge financeira.

## Problema abordado

Depois que uma aplicação inicia o envio de um Pix, uma resposta HTTP perdida, erro 5xx ou timeout **não garante que o banco tenha recusado a transferência**. Repetir um POST com nova identidade pode pagar duas vezes. A ausência de um registro local também não prova que um POST nunca saiu. O livro contábil não pode resolver sozinho a ausência de Pix bancário anterior.

## Implementação restrita a CI

A fixture `supabase/tests/isolated/catalogo-asaas-journal-intencao-prepost-race-inerte.sql` cria **somente no clone descartável**:

- `catalogo_ci_intencao_pix_inerte.intencoes`: um `tentativa_id` único e **uma intenção por separação**, vinculados ao titular, referência externa determinada pelo tipo e solicitação, centavos e fingerprint original.
- `catalogo_ci_intencao_pix_inerte.marcos_inicio`: **no máximo um marco de início por tentativa**, com `marco_id` único. É anotação local, **não afirma que houve POST, Pix, liquidação nem autorização**.
- Funções `preparar` e `marcar_inicio`: primeiro adquirem o `pg_advisory_xact_lock('asaas-saque:<titular>')` e travam a reserva (`FOR UPDATE`), depois verificam invariantes e unicidade. Ambas retornam **sempre** `HOLD_OBRIGATORIO` e todas as permissões de enviar, reenviar, baixar ou liberar como `false`.
- Triggers tornam ambas as tabelas **append-only**; RLS e `REVOKE` bloqueiam acesso para `anon`, `authenticated` e `service_role`. Não existe GRANT nem rota pública.
- O SQL exige o nome exato do banco de CI e um parâmetro de sessão de laboratório. O banco é destruído após os testes. Não foi criada migração nem função implantada no Supabase remoto.

O script `scripts/validacao-pagamentos/test-asaas-advisory-concurrency.py` acrescenta duas sessões PostgreSQL reais para verificar:

1. **Registro antes do hipotético POST:** marco sem intenção falha. Uma sessão registra a intenção e segura a transação; a outra espera pelo mutex. Após COMMIT, a segunda reconhece a mesma tentativa, **sem registrar outra intenção**.
2. **Tentativa alterada:** valor incorreto ou outro ID para a mesma separação falham.
3. **Marco sem duplicidade:** duas sessões disputam o mesmo marco; após COMMIT da primeira, a segunda é recusada, mesmo com identificador igual. Identificador diferente para a mesma tentativa também é rejeitado.
4. **Falhas e recuperação:** após ROLLBACK da primeira sessão, a segunda pode registrar **uma única intenção** e **um único marco local**, nunca duas linhas.
5. **Proteção de integridade:** UPDATE/DELETE em tabelas de journal são proibidos; o aplicativo e `service_role` não têm privilégios; reservas permanecem congeladas, sem saque criado.

Os contratos de revisão de fonte estão em `tests/catalogo-asaas-journal-prepost-inerte.test.cjs`.

## Limitações e condições para a implementação real

**Este journal não envia Pix.** A intenção e seu marco não autorizam POST nem equivalem a idempotência verificada no Asaas. No fluxo real, intenção e marco de tentativa precisam estar **duravelmente confirmados no banco antes da chamada externa**, com uma única identidade externa por pagamento e decisão explícita para falhas entre os commits e a rede. Mesmo havendo `FAILED`, `CANCELLED`, `DONE`, GET vazio ou ausência de marco, a recuperação deve permanecer em **HOLD** até obter prova bancária independente do beneficiário original, liquidação e de **todos** os possíveis envios anteriores (#41). Requer dois revisores segregados com MFA real (#42) e resolução contábil por remuneração atômica, idempotente e auditada (#43).

**Proibido:** ligar este protótipo à Edge financeira, converter `pode_enviar_post` em `true`, publicar RPC, aplicar migração em STAGING/PROD, enviar Pix de teste ou real, mesclar PR #39 ou remover HOLD sem aprovação explícita, provas e homologação.
