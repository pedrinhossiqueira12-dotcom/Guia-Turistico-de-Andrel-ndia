# Etapa #42 — Elegibilidade de revisores em laboratório isolado

**11 de outubro de 2026 · PR #39 em Draft · HOLD_OBRIGATORIO**

## Escopo de segurança

Este incremento é **apenas uma prova de predicados no PostgreSQL descartável da CI**. Não é autenticação real, não verifica JWT assinado, não executa challenge/verify do GoTrue, não confere posse de TOTP em aparelho nem concede qualquer permissão de aprovação bancária. Um valor `aal_mock='aal2'` ou `fator_estado_mock='verified'` é **apenas um registro sintético inserido por um teste**, nunca prova de MFA.

O arquivo `supabase/tests/isolated/catalogo-asaas-revisores-identidade-race-inerte.sql` aceita instalação **somente** no banco `catalogo_asaas_race_ci`, executado como `postgres` e com opt-in `app.catalogo_ci_revisores_test=enabled`. Cria um schema dedicado sem GRANT para `anon`, `authenticated` ou `service_role`, e tabelas com RLS e vínculos de chaves estrangeiras para registrar:

- Credencial fictícia por revisor, com papel documental `revisor_escrow` ou `leitor`, situação `habilitado` ou `revogado` e prazo.
- Sessão/fator fictícios ligados a uma única identidade, AAL1/AAL2, estado do fator, horário do último desafio, expiração e revogação.
- Parecer documental de teste, com autor, sessão da **mesma pessoa**, ID da separação, fingerprint do crédito, resultado `manter_hold/solicitar_documentos/apontar_divergencia` e validade. O par `(separacao_id, revisor_id)` é único.

A função `catalogo_ci_revisores_inertes.diagnosticar_elegibilidade_mock` usa lock de saque compartilhado (`asaas-saque:<titular>`), `FOR UPDATE` na reserva congelada e `FOR SHARE` sobre as linhas de credenciais, pareceres e sessões. Ela compara **registros internos**, não informações oferecidas no corpo da requisição. Exige revisor distinto do beneficiário, papel adequado, vínculo correto da sessão, credencial ativa e não expirada, parecer vigente da mesma fingerprint, sessão não revogada e não expirada, fator sintético `verified`, AAL2 fictício, último desafio fictício dentro de cinco minutos e ausência do revisor entre os autores dos eventos do dossiê.

O teste Python `scenario_revisores_credenciais_mock_hold()` acrescenta dados de cinco usuários e quatro pareceres fictícios, com dois revisores elegíveis. Depois confirma que **proprietário e leitor não contam**, que a identidade da sessão não pode ser atribuída a outra pessoa, e que a contagem cai após revogar credencial, envelhecer desafio, trocar AAL2 por AAL1, revogar fator/sessão, expirar sessão/parecer e alterar a fingerprint. O JSON de teste forjado, contendo suposta autorização e CPF/chave Pix, é deliberadamente ignorado. O contrato Node correspondente está em `tests/catalogo-asaas-revisores-credenciais-ci-inertes.test.cjs`.

## Limites operacionais

- A saída **sempre** declara `mfa_real_validado=false`, `credenciamento_formal_confirmado=false`, `dupla_aprovacao_financeira=false`, `pagamento_autorizado=false`, `liberacao_autorizada=false`, `baixa_realizada=false`, `movimenta_dinheiro=false`, `status_operacional=HOLD_OBRIGATORIO`. O campo `duas_credenciais_sinteticas_elegiveis` **não é** aprovação.
- A fixture não é migration e não pertence ao Supabase remoto; nenhum endpoint de aplicação ou Edge pode chamá-la. Os dados não são prova de cargo, de identidade civil ou de TOTP.
- A implementação real deve usar JWT assinada e verificada, sessão ativa de servidor, fator TOTP/GoTrue realmente verificado e associado à operação, autorização de papel externo à requisição, prevenção de autoaprovação e credenciais formalmente nomeadas e revogáveis. As provas independentes do banco (#41) e a resolução atômica (#43) seguem bloqueadores antes de qualquer autorização.

**Proibido:** merge da PR #39, mudança de status de escrow real, deploy financeiro, Pix de teste/produção, liberação de crédito ou mudança de chaves Asaas enquanto o HOLD estiver ativo.
