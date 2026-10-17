# Auditoria: encerramento financeiro x whatsapp-bot legado (2026-10-09)

**Escopo:** revisão somente-leitura da Edge `whatsapp-bot` implantada no projeto Supabase de produção `xdmbkflufsfqziixzpxc`, versão 90. Nenhum código, cobrança ou dado de produção foi modificado nesta auditoria. Alterações SQL e testes ocorreram somente na branch e no STAGING `jbttwihctuibchhcyqtl`.

## Resultado da inspeção da Edge implantada

- `verify_jwt=false` no gateway, mas a implementação executa verificação própria de identidade/proprietário/administrador antes de arquivar; isto **não** significa que a rota permita exclusão anônima. Os controles precisam passar por revisão independente.
- As ações `excluir_meu_comercio`, `marcar_meu_comercio_deletado` e `marcar_comercio_deletado` permanecem roteadas no serviço ativo.
- O método legado consulta `comercios_publicados` e modifica `status='deletado'` antes de atualizar `DATA/comercios.json` via GitHub, podendo remover referências a imagens. Em falhas intermediárias tenta compensar alterações; não há transação única envolvendo GitHub + banco.
- O fluxo legado **não consulta explicitamente faturas/comissões/pedidos** antes da tentativa de despublicação. A barreira de segurança deve existir no PostgreSQL e não depende da UI.
- A Edge antiga também possui caminho de publicação/upsert com `status='ativo'`; deve respeitar o encerramento já solicitado, inclusive quando a publicação anterior estava em `deletado` ou `pendente`.
- O novo botão na `local.js` já usa a Edge `catalogo-admin` para `solicitar_encerramento`, não a ação antiga. Isso não elimina o risco de chamadas diretas à rota antiga.

## Defesas já presentes na branch

- `20261009162000_bloquear_exclusao_debitos_e_finalizar_arquivamento.sql`: trigger consulta débitos e pedidos em andamento antes da despublicação; impede remoção física de histórico.
- `20261009163000_impedir_reabertura_encerramento.sql`: impede reabertura de catálogo bloqueado e republicação de lojas antes `arquivado`.
- **Novo:** `20261009183000_proteger_republicacao_legada_apos_encerramento.sql` faz a verificação de encerramento em **INSERT e UPDATE de status**, para qualquer situação aberta ou arquivada, independentemente do status anterior da publicação. Bloqueia também UPSERT. Usa lock na linha de `catalogos` para serializar com a solicitação de encerramento.
- **Novo:** `20261009184000_bloquear_despublicacao_legada_qualquer_status.sql` impede `DELETE` e alterações para estado não ativo quando há fatura, comissão ou pedido pendente, **mesmo se o estado anterior da publicação era `deletado` ou `pendente`**. Mantém o gatilho existente e o bloqueio por linha do catálogo.
- O frontend estático consulta a RPC pública e limitada `catalogo_status_publicacao`; um tombstone `arquivado` tem precedência sobre a cópia do JSON.

## Validação realizada no STAGING

Em transação única com `ROLLBACK`, foi simulada uma publicação com `status='deletado'` e encerramento `pendente_arquivamento`. Tentativas de `UPDATE status='ativo'` e `INSERT ... ON CONFLICT DO UPDATE status='ativo'` foram ambas rejeitadas por SQLSTATE `23514`. A consulta posterior confirmou que o registro de encerramento temporário não permaneceu no banco.

Um segundo teste, também completamente revertido, registrou uma fatura fictícia aberta de R$ 1,00 após marcar a publicação como `deletado`. Tentativas de `UPDATE status='arquivado'` e `DELETE` foram ambas rejeitadas por SQLSTATE `23514`; não ficaram faturas nem exclusões dessa simulação.

Foi adicionado `tests/catalogo-encerramento-legado.test.cjs` para verificar os contratos de proteção no CI. Esses testes não exercem a Edge antiga real e **não substituem** testes integrados de produção.

## Riscos e etapas bloqueantes

1. **Produção ainda não recebeu as migrações**: portanto, as proteções novas não estão garantidas na Edge produtiva. Não afirmar que a exclusão por dívida está protegida em produção até instalar/testar o bloqueio.
2. Testar fluxo completo com usuário fictício no STAGING: fatura não paga deve recusar o legado antes de escrever no GitHub; após quitação e arquivamento, edição/publicação não pode reativar o negócio.
3. Versionar e revisar o código fonte *não minificado* da Edge antiga antes de qualquer nova implantação. Preferir remover a ação de exclusão da rota antiga após migrar todos os consumidores, mantendo as demais operações legadas em funcionamento.
4. Garantir que o fechamento mensal e a criação de novas faturas concorrentes não permitam despublicação na janela entre consulta de pendências e gravação. Rever locks e transações envolvendo as tabelas de crédito.
5. Validar o impacto de inconsistência GitHub x Supabase e fluxo de recuperação, inclusive foto e status divergentes, sem realizar exclusões de histórico financeiro.
6. Revisar as permissões `SECURITY DEFINER` e a RPC pública no Security Advisor antes de ativar na produção.

**Status:** PR #39 permanece Draft. Nenhuma aprovação para mesclar, migrar produção, desativar funções existentes ou enviar Pix.

## Revalidacao read-only de 17/10/2026 — Edge candidata x implantada

- **Producao (xdmbkflufsfqziixzpxc):** a Edge implantada whatsapp-bot continua na versao 90. Ela executa UPDATE de comercios_publicados.status='deletado' antes de tentar PUT em DATA/comercios.json. O inventario pg_trigger confirmou ausencia das guardas financeiras de encerramento em comercios_publicados e catalogos (so catalogos_atualizado_em em catalogos). Portanto a protecao financeira da rota antiga **nao esta implantada em producao**. Nenhuma chamada POST foi feita.
- **STAGING (jbttwihctuibchhcyqtl):** os triggers catalogo_publicacao_sem_divida_guard e catalogo_encerramento_sem_republicacao estao ativos (tgenabled='O') e suas funcoes foram inspecionadas. Recusam despublicacao com pendencias e republicacao com encerramento registrado. Isso nao substitui ensaio HTTP E2E nem demonstra ausencia de concorrencia na criacao de novas obrigacoes.
- **Fonte candidata da PR #39, nao implantada:** a funcao ae ja permite ao proprietario somente solicitar catalogo_solicitar_encerramento_financeiro; somente admin pode chamar catalogo_finalizar_encerramento_financeiro ou RPC especifica sem catalogo, validando o banco antes do GitHub. Os testes asaas-cob06-whatsapp-encerramento.test.cjs e asaas-cob06-whatsapp-http-real-handler.test.cjs cobrem fluxos offline com Supabase e GitHub simulados, inclusive status ja deletado e retentativa. A lacuna da exclusao direta continua na Edge implantada, nao na Edge candidata. Nao duplicar a correcao na branch.
- **STAGING ainda nao pronto para E2E desta Edge:** whatsapp-bot nao consta nas Edge Functions implantadas; catalogo_arquivar_sem_catalogo_admin(text,uuid) nao esta instalada; catalogo_finalizar_encerramento_financeiro verifica UID fixo de admin de producao, diferente do admin de testes. Nao testar com a conta STAGING ate preparar um alvo isolado e coerente.
- **Isolamento do GitHub e obrigatorio:** a fonte candidata usa branch main para DATA/comercios.json. Um deploy em STAGING com GITHUB_TOKEN dotado de escrita poderia afetar a vitrine real; exige destino descartavel ou simulador, token e parametros separados antes de qualquer ensaio com escrita.
- **Gates:** revisar concorrencia com criacao de faturas e pedidos, configurar identities/RPCs e Edge num ambiente isolado, executar E2E com recusas e falhas recuperaveis, auditar a sincronizacao da vitrine e so entao propor corte sob aprovacao expressa. PR permanece Draft; nenhum merge, deploy da Edge, operacao produtiva ou Pix autorizado por esta verificacao.
