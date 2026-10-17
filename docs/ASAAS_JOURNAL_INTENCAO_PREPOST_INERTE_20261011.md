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

## Integração diagnóstica das etapas #41, #42 e #43 — 11/10/2026

A fixture descartável do journal agora contém `catalogo_ci_intencao_pix_inerte.diagnosticar_portas_hold(uuid,jsonb)`, função **sem operações de escrita**, sob o mesmo mutex transacional dos saques e lock `FOR UPDATE` da reserva. Ela:

- Relê a reserva congelada e confere as intenções com titular, valor, referência e fingerprint originais, além de contar marcos de início existentes no journal de laboratório.
- Executa os **diagnósticos reais, somente-leitura, já presentes no PR**: `public.catalogo_asaas_matriz_conciliacao_escrow` (#41) e `public.catalogo_asaas_diagnosticar_dupla_conferencia_inerte` (#42). Se qualquer diagnóstico falhar ou faltar prova, a avaliação permanece em HOLD; o resultado não altera nenhum estado.
- Expõe somente contagens e booleanos não sensíveis. A eventual existência de **duas conferências documentais** é distinta de credenciamento formal, MFA e duas aprovações financeiras. Mesmo com observação de `DONE`, o diagnóstico bancário atual não demonstra origem/destino e ausência de Pix anterior.
- Ignora deliberadamente o parâmetro de teste `p_sinais_cliente`, inclusive quando ele simula `mfa=true`, `dupla_aprovacao_financeira=true`, `pix_pago=true` ou dados de CPF/chave Pix. Os testes exigem que o resultado seja **idêntico com ou sem alegações falsas** e que nenhum dado sensível apareça.
- Em qualquer situação retorna `HOLD_OBRIGATORIO` com `pode_enviar_post=false`, `pode_reenviar_post=false`, `pagamento_autorizado=false`, `liberacao_autorizada=false`, `baixa_realizada=false`, `movimenta_dinheiro=false`. A função não concede o papel de revisor nem executa transferência.

O teste `scenario_intencao_prepost_duravel_concorrente` verifica o diagnóstico antes da intenção, após registrar intenção sem marco, após registrar o marco, durante a verificação de outro titular e com UUID inexistente. Os contratos Node são verificados no `tests/catalogo-asaas-journal-prepost-inerte.test.cjs`.

**Limites:** é apenas uma integração de **leitura e recusa** no clone `catalogo_asaas_race_ci`. Não conecta o journal à Edge, não cria autorização MFA, não prova dados bancários e não define o executor financeiro final. As etapas #41 (banco), #42 (revisores habilitados) e #43 (resolução real idempotente) continuam abertas; nenhuma migração foi disponibilizada para uso em produção.
